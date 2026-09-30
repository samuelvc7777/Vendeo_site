import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
  brain_sessions: [{ id: "session-a", conversation_id: "conv-a", provider_session_id: "provider-session-a" }],
  brain_manual_facts: [{ id: "manual-a", conversation_id: "conv-a", session_id: "session-a", turn_id: "turn-a", fact: "dado local" }],
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
  for (const [type, id] of examples.filter(([type]) => type !== "manual_fact")) {
    const evidence = normalizeObjectiveEvidence({ type, id });
    assert.deepEqual(evidence, { type, id });
    assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", evidence), true, `${type} deve existir`);
  }
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-b", { type: "message", id: "msg-a" }), false);
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", { type: "manual_fact", id: "manual-a" }, "provider-session-a"), true);
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", { type: "manual_fact", id: "manual-a" }, "other-session"), false);
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-b", { type: "manual_fact", id: "manual-a" }, "provider-session-a"), false);
  assert.equal(await objectiveEvidenceExists(evidenceDb(), "conv-a", { type: "manual_fact", id: "manual-a" }), false);
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

test("inbound pendente mantém lote ainda não iniciado bloqueado na claim atômica", async () => {
  let rpcCalls = 0;
  let providerCalls = 0;
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
    rpc: async () => {
      rpcCalls++;
      return { data: { success: false, reason: "pending_inbound_requires_brain_review" }, error: null };
    },
  };
  const result = await runDurableOutboxDispatcher({
    supabase,
    conversationId: "conv-a",
    outboxMap: { action: { id: "action", status: "pending", cycleId: "cycle-a", content: "oi", messageType: "text" } },
    targetCycleId: "cycle-a",
    runtime: { sendMetaTextMessage: async () => { providerCalls++; return { message_id: "msg-provider" }; } },
  });
  assert.equal(result.dispatchedCount, 0);
  assert.ok(result.errors.includes("pending_inbound_requires_brain_review"));
  assert.equal(rpcCalls, 1);
  assert.equal(providerCalls, 0);
});

test("lote já iniciado atravessa inbound novo e revisão concorrente", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20260930033410_allow_started_outbox_batch_during_new_inbound.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /queued\.entry->>'status' = 'sent'/);
  assert.equal((sql.match(/AND NOT v_batch_started/g) || []).length, 2);
  assert.match(sql, /pending_inbound_requires_brain_review/);
  assert.match(sql, /brain_review_in_progress/);
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
