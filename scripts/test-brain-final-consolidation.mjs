import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeObjectiveEvidence,
  objectiveEvidenceExists,
} from "../supabase/functions/api/objective_evidence.ts";
import { isPrivilegedOperationalRequest } from "../supabase/functions/api/operational_authorization.ts";
import { resolveCurrentStageId } from "../src/domain/entities/stageAuthority.ts";
import {
  selectMessagesForLateTurn,
  runDurableOutboxDispatcher,
} from "../supabase/functions/api/brain_orchestrator.ts";
import { validateConversationBrainPlan } from "../supabase/functions/api/openai_brain.ts";

const evidenceRows = {
  instagram_messages: [{ id: "msg-a", conversation_id: "conv-a" }],
  contact_memory_facts: [{ id: "fact-a", conversation_id: "conv-a" }],
  contact_memory_quotes: [{ id: "quote-a", conversation_id: "conv-a" }],
  conversation_episodic_memory: [{ id: "episode-a", conversation_id: "conv-a" }],
  persona_memory: [{ key: "manual-a", persona_id: "larissa", category: "manual_resolution" }],
};

function evidenceDb(rows = evidenceRows) {
  return {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          const data = (rows[table] || []).find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null;
          return { data, error: null };
        },
      };
    },
  };
}

test("todas as proveniências persistidas aceitam apenas registros do escopo certo", async () => {
  const examples = [
    ["message", "msg-a"],
    ["contact_fact", "fact-a"],
    ["contact_quote", "quote-a"],
    ["episode", "episode-a"],
    ["manual_fact", "manual-a"],
  ];
  for (const [type, id] of examples) {
    const evidence = normalizeObjectiveEvidence({ type, id });
    assert.deepEqual(evidence, { type, id });
    assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", evidence), true, `${type} deve existir`);
  }
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-b", { type: "message", id: "msg-a" }), false);
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", { type: "manual_fact", id: "manual-a" }), true);
  assert.equal(normalizeObjectiveEvidence({ type: "other", id: "1" }), null);
  assert.deepEqual(normalizeObjectiveEvidence(null, "legacy-msg"), { type: "message", id: "legacy-msg" });
});

test("a etapa normalizada vence projeções JSON conflitantes", () => {
  assert.equal(resolveCurrentStageId("stage-normalized", "stage-json"), "stage-normalized");
  assert.equal(resolveCurrentStageId(null, "stage-configured-default"), "stage-configured-default");
  assert.equal(resolveCurrentStageId(null, null), "");
});

test("autorização operacional aceita somente bearer de serviço exato", () => {
  const key = "service-key-test";
  const accepted = new Request("https://local.test/brain-events", { headers: { authorization: `Bearer ${key}` } });
  const wrong = new Request("https://local.test/brain-events", { headers: { authorization: "Bearer anon-key" } });
  const missing = new Request("https://local.test/brain-events");
  assert.equal(isPrivilegedOperationalRequest(accepted, key), true);
  assert.equal(isPrivilegedOperationalRequest(wrong, key), false);
  assert.equal(isPrivilegedOperationalRequest(missing, key), false);
  assert.equal(isPrivilegedOperationalRequest(accepted, ""), false);
});

test("turno tardio só retoma inbounds originais e deixa mensagens novas para revisão", () => {
  const selection = selectMessagesForLateTurn([
    { id: "in-old-a" }, { id: "in-new-b" }, { id: "in-old-c" },
  ], ["in-old-a", "in-old-c"]);
  assert.deepEqual(selection.messages.map((message) => message.id), ["in-old-a", "in-old-c"]);
  assert.deepEqual(selection.deferredIds, ["in-new-b"]);
});

test("mensagem inbound pendente bloqueia o dispatcher antes de chamar o provedor", async () => {
  let dispatchCalls = 0;
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: { ai_auto_respond: true, stage_completed_rules: { orchestration: { messageLedger: { "new-inbound": "pending" }, outbox: {} } } }, error: null };
        },
      };
    },
    rpc: async () => { dispatchCalls++; return { data: { success: true }, error: null }; },
  };
  const result = await runDurableOutboxDispatcher({
    supabase,
    conversationId: "conv-a",
    outboxMap: { action: { id: "action", status: "pending", cycleId: "cycle-a" } },
    targetCycleId: "cycle-a",
    runtime: { dispatchMessage: async () => { dispatchCalls++; } },
  });
  assert.equal(result.dispatchedCount, 0);
  assert.ok(result.errors.includes("pending_inbound_requires_brain_review"));
  assert.equal(dispatchCalls, 0);
});

test("Brain suporta KEEP, CANCEL e REPLACE sem deixar backend escolher significado", () => {
  const base = {
    action: "reply", responses: ["Resposta nova"], outboundActions: [{ type: "text", text: "Resposta nova" }],
    turnContract: { mustAnswerFirst: true, responseShape: "natural", directQuestions: [], maxBalloons: 2 },
  };
  assert.equal(validateConversationBrainPlan({ ...base, pendingActionResolution: { cancelActionIds: [] } }, ["old-action"]).valid, true);
  assert.equal(validateConversationBrainPlan({ ...base, pendingActionResolution: { cancelActionIds: ["old-action"] } }, ["old-action"]).valid, true);
  assert.equal(validateConversationBrainPlan({ ...base, pendingActionResolution: { cancelActionIds: ["foreign-action"] } }, ["old-action"]).valid, false);
  assert.equal(validateConversationBrainPlan({ ...base, objectiveDecision: "already_satisfied", satisfiedObjectiveId: "objective-a", objectiveEvidence: { type: "episode", id: "ep-1" } }).valid, true);
});
