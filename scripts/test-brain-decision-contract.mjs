import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
  buildPersistentTurnContext,
  validateConversationBrainPlan,
  validateResponseGenerationInvariant,
} from "../supabase/functions/api/openai_brain.ts";
import {
  createBrainOutboxBatch,
  deriveBrainDeliveryStatus,
  mergeRecentQuestionIntents,
  persistCanonicalBrainDecision,
  selectConfirmedBrainActions,
  validatePhaseTransition,
} from "../supabase/functions/api/brain_orchestrator.ts";

test("o Brain solicita candidatos somente por objective_id", () => {
  assert.deepEqual(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.required, ["objective_id"]);
  assert.deepEqual(Object.keys(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.properties), ["objective_id"]);
});

test("manual_resolution é uma decisão válida sem ações para o cliente", () => {
  const plan = {
    action: "manual_resolution",
    manualResolution: { question: "A Larissa já visitou os Estados Unidos?", context: "O cliente perguntou durante a conversa." },
  };
  assert.equal(validateConversationBrainPlan(plan).valid, true);
  assert.equal(validateResponseGenerationInvariant(plan).valid, true);
  assert.deepEqual(plan.responses, []);
  assert.deepEqual(plan.outboundActions, []);
  assert.equal(validateConversationBrainPlan({ action: "manual_resolution" }).valid, false);
});

test("delay_before_send é validado como campo estrutural e normalizado", () => {
  const plan = {
    action: "reply",
    responses: ["Oi"],
    outboundActions: [{ type: "text", text: "Oi", delay_before_send: 9 }],
    turnContract: { mustAnswerFirst: true, responseShape: "natural", directQuestions: [], maxBalloons: 4 },
  };
  assert.equal(validateConversationBrainPlan(plan).valid, true);
  assert.equal(plan.outboundActions[0].delayBeforeSendSeconds, 9);
  assert.equal(validateConversationBrainPlan({
    ...plan,
    outboundActions: [{ type: "text", text: "Oi", delay_before_send: -1 }],
  }).valid, false);
});

test("cadência do Brain é persistida exatamente; duração real do áudio agenda a próxima ação", () => {
  const nowMs = Date.UTC(2026, 8, 26, 12, 0, 0);
  const base = { conversationId: "conv-test", cycleId: "cycle-test", idempotencyKey: "idem-test", nowMs };
  const short = createBrainOutboxBatch({ ...base, actions: [
    { type: "text", text: "A" }, { type: "text", text: "B", delayBeforeSendSeconds: 5 },
  ] });
  const long = createBrainOutboxBatch({ ...base, actions: [
    { type: "text", text: "A" }, { type: "text", text: "B", delayBeforeSendSeconds: 14 },
  ] });
  const withAudio = createBrainOutboxBatch({ ...base, resolvedAudio: {
    id: "audio-1", title: "Áudio", audioUrl: "https://audio.test/a.mp3", duration: 38,
    transcript: "", usageInstruction: "", enabled: true,
  }, actions: [
    { type: "text", text: "A" },
    { type: "audio", audioId: "audio-1", delayBeforeSendSeconds: 6 },
    { type: "text", text: "B", delayBeforeSendSeconds: 7 },
  ] });
  assert.equal(Date.parse(short[1].notBefore) - nowMs, 5_000);
  assert.equal(Date.parse(long[1].notBefore) - nowMs, 14_000);
  assert.equal(withAudio[2].audioDurationSeconds, null);
  assert.equal(Date.parse(withAudio[1].notBefore) - nowMs, 6_000);
  assert.equal(Date.parse(withAudio[2].notBefore) - nowMs, 51_000);
  assert.equal(withAudio[1].audioDurationSeconds, 38);
});

test("Brain recebe ações pendentes e só pode cancelar IDs apresentados no contexto", () => {
  const plan = {
    action: "reply",
    responses: ["Vi sua mensagem nova"],
    outboundActions: [{ type: "text", text: "Vi sua mensagem nova" }],
    turnContract: { mustAnswerFirst: true, responseShape: "natural", directQuestions: [], maxBalloons: 4 },
    pendingActionResolution: { cancelActionIds: ["action-old"] },
  };
  assert.equal(validateConversationBrainPlan(plan, ["action-old"]).valid, true);
  assert.equal(validateConversationBrainPlan({ ...plan, pendingActionResolution: { cancelActionIds: ["action-other"] } }, ["action-old"]).valid, false);
  const context = buildPersistentTurnContext({
    currentStageId: "stage-configured",
    currentInboundMessages: [{ id: "in-new", text: "mudou de assunto" }],
    pendingOutboundActions: [{ actionId: "action-old", actionIndex: 1, type: "text", preview: "resposta antiga" }],
  });
  assert.match(context, /action_id="action-old"/);
  assert.match(context, /para substituir, cancele as antigas escolhidas/);
});

test("transição de etapa não tem regras semânticas nem nomes de etapa fixos", () => {
  assert.deepEqual(validatePhaseTransition("etapa_a", "etapa_b", "qualquer checkpoint"), {
    allowed: true,
    validatedNextPhase: "etapa_b",
  });
  assert.equal(validatePhaseTransition("etapa_a", "inexistente", "", [{ id: "etapa_b", order: 1 }]).allowed, false);
});

test("decisão de objetivo e etapa é commitada com outbox pending antes do primeiro envio", async () => {
  let rpcCall;
  const supabase = {
    rpc: async (name, args) => {
      rpcCall = { name, args };
      return { data: { success: true, semantic_state_committed: true }, error: null };
    },
  };
  const future = new Date(Date.now() + 60_000).toISOString();
  const result = await persistCanonicalBrainDecision({
    supabase,
    conversationId: "conv-1",
    sessionId: "session-1",
    providerTurnId: "provider-turn-1",
    turnId: "turn-1",
    decisionId: "decision-1",
    inboundMessageIds: ["in-1"],
    decisionType: "respond",
    decisionPayload: {
      action: "reply",
      semanticState: {
        cycleToken: "cycle-1",
        completedGoalIds: ["objective-1"],
        objectiveProgress: { "objective-1": { status: "completed" } },
        currentPhase: "stage-b",
        currentStageId: "stage-b",
      },
    },
    outboxEntries: [{
      id: "out-1", cycleId: "cycle-1", conversationId: "conv-1", idempotencyKey: "key-1",
      content: "Oi", messageType: "text", status: "pending", attempts: 0, maxAttempts: 3,
      createdAt: new Date().toISOString(), actionIndex: 0, notBefore: null,
    }],
    actions: [
      { id: "action-1", actionIndex: 0, actionType: "text", payload: { text: "Oi" }, notBefore: null, idempotencyKey: "key-1" },
      { id: "action-2", actionIndex: 1, actionType: "audio", payload: { audioId: "audio-1" }, notBefore: future, idempotencyKey: "key-2", status: "waiting_delay" },
    ],
  });
  assert.equal(result.success, true);
  assert.equal(rpcCall.name, "persist_brain_decision_with_outbox");
  assert.deepEqual(rpcCall.args.p_actions.map((action) => action.id), ["action-1", "action-2"]);
  assert.equal(rpcCall.args.p_actions[1].status, "waiting_delay");
  assert.equal(rpcCall.args.p_actions[0].status, "pending");
  assert.equal(rpcCall.args.p_outbox_entries[0].id, "out-1");
  assert.equal(rpcCall.args.p_turn.provider_turn_id, "provider-turn-1");
  assert.equal(rpcCall.args.p_decision.payload.semanticState.currentStageId, "stage-b");
  assert.equal(deriveBrainDeliveryStatus(["pending", "waiting_delay"]), "delivery_pending");
});

test("falha retryable no primeiro envio e dispatch_uncertain preservam a decisão persistida", async () => {
  let savedDecision;
  const result = await persistCanonicalBrainDecision({
    supabase: { rpc: async (_name, args) => {
      savedDecision = args.p_decision;
      return { data: { success: true, semantic_state_committed: true }, error: null };
    } },
    conversationId: "conv-retry",
    sessionId: "session-retry",
    providerTurnId: "provider-turn-retry",
    turnId: "turn-retry",
    decisionId: "decision-retry",
    inboundMessageIds: ["in-retry"],
    decisionType: "respond",
    decisionPayload: { action: "reply", semanticState: {
      cycleToken: "cycle-retry", completedGoalIds: ["objective-retry"],
      objectiveProgress: { "objective-retry": { status: "completed" } },
      currentPhase: "stage-next", currentStageId: "stage-next",
    } },
    actions: [{ id: "action-retry", actionIndex: 0, actionType: "text", payload: { text: "Oi" }, notBefore: null, idempotencyKey: "idem-retry" }],
    outboxEntries: [],
  });
  assert.equal(result.success, true);
  assert.deepEqual(savedDecision.payload.semanticState.completedGoalIds, ["objective-retry"]);
  assert.equal(deriveBrainDeliveryStatus(["failed_retryable"]), "delivery_pending");
  assert.equal(deriveBrainDeliveryStatus(["dispatch_uncertain", "pending"]), "dispatch_uncertain");
  assert.equal(deriveBrainDeliveryStatus(["sent", "pending"]), "partially_sent");
  assert.equal(deriveBrainDeliveryStatus(["sent", "sent"]), "fully_sent");
});

test("três textos com somente action 0 sent projetam somente a primeira fala", () => {
  const confirmed = selectConfirmedBrainActions([
    { id: "a0", action_index: 0, action_type: "text", status: "sent", payload: { text: "primeira", deliveryProjectionId: "out-0" } },
    { id: "a1", action_index: 1, action_type: "text", status: "pending", payload: { text: "segunda", deliveryProjectionId: "out-1" } },
    { id: "a2", action_index: 2, action_type: "text", status: "pending", payload: { text: "terceira", deliveryProjectionId: "out-2" } },
  ]);
  assert.deepEqual(confirmed.map((action) => action.text), ["primeira"]);
  assert.deepEqual(confirmed.map((action) => action.projectionMessageId), ["out-0"]);
});

test("texto sent, áudio pending e texto pending mantêm só o texto entregue na memória", () => {
  const confirmed = selectConfirmedBrainActions([
    { id: "t0", action_index: 0, action_type: "text", status: "sent", payload: { text: "texto entregue" } },
    { id: "au1", action_index: 1, action_type: "audio", status: "pending", payload: { audioId: "audio-1" } },
    { id: "t2", action_index: 2, action_type: "text", status: "pending", payload: { text: "texto ainda pendente" } },
  ]);
  assert.deepEqual(confirmed.map((action) => action.text), ["texto entregue"]);
  assert.deepEqual(confirmed.map((action) => action.audioId), [null]);
});

test("texto e áudio sent com terceiro texto pending projetam somente os dois confirmados", () => {
  const confirmed = selectConfirmedBrainActions([
    { id: "t0", action_index: 0, action_type: "text", status: "sent", payload: { text: "texto entregue" } },
    { id: "au1", action_index: 1, action_type: "audio", status: "sent", payload: { audioId: "audio-1" } },
    { id: "t2", action_index: 2, action_type: "text", status: "pending", payload: { text: "texto pendente" } },
  ]);
  assert.deepEqual(confirmed.map((action) => action.id), ["t0", "au1"]);
  assert.deepEqual(confirmed.map((action) => action.projectionMessageId), ["out_action_t0", "out_action_au1"]);
});

test("nenhuma action sent não gera projeção de fala outbound", () => {
  assert.deepEqual(selectConfirmedBrainActions([
    { id: "a0", action_index: 0, action_type: "text", status: "pending", payload: { text: "planejada" } },
    { id: "a1", action_index: 1, action_type: "audio", status: "dispatch_uncertain", payload: { audioId: "audio-1" } },
  ]), []);
});

test("action só é projetada quando action e outbox registram sent", () => {
  const action = { id: "a0", action_index: 0, action_type: "text", status: "sent", payload: { text: "confirmada", outboxId: "out-0" } };
  assert.deepEqual(selectConfirmedBrainActions([action], { "key-0": { id: "out-0", status: "pending" } }), []);
  assert.deepEqual(selectConfirmedBrainActions([action], { "key-0": { id: "out-0", status: "sent" } }).map((item) => item.text), ["confirmada"]);
});

test("ações entregues depois entram por ID estável uma vez, sem duplicar a anterior", async () => {
  const planned = [
    { id: "a0", action_index: 0, action_type: "text", status: "sent", payload: { text: "primeira", deliveryProjectionId: "out-0" } },
    { id: "a1", action_index: 1, action_type: "text", status: "pending", payload: { text: "segunda", deliveryProjectionId: "out-1" } },
  ];
  const projection = new Map(selectConfirmedBrainActions(planned).map((action) => [action.projectionMessageId, action.text]));
  planned[1].status = "sent";
  for (const action of selectConfirmedBrainActions(planned)) projection.set(action.projectionMessageId, action.text);
  for (const action of selectConfirmedBrainActions(planned)) projection.set(action.projectionMessageId, action.text);
  assert.deepEqual([...projection.entries()], [["out-0", "primeira"], ["out-1", "segunda"]]);
  assert.deepEqual(mergeRecentQuestionIntents(
    [{ intentKey: "q0", sourceMessageId: "out-0" }],
    [{ intentKey: "q0", sourceMessageId: "out-0" }, { intentKey: "q1", sourceMessageId: "out-1" }],
  ).map((item) => item.sourceMessageId), ["out-0", "out-1"]);
  const episodic = await readFile(new URL("../supabase/functions/api/conversation_episodic_memory.ts", import.meta.url), "utf8");
  assert.match(episodic, /onConflict: "conversation_id,episode_fingerprint"[\s\S]*?ignoreDuplicates: true/);
});

test("commit semântico é transacional, idempotente e independente do despacho", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260927005646_brain_decision_delivery_independence.sql", import.meta.url), "utf8");
  assert.match(migration, /semantic_state_committed_at/);
  assert.match(migration, /\(v_rules->>'active_cycle_token'\) IS DISTINCT FROM \(v_semantic_state->>'cycleToken'\)/);
  assert.match(migration, /expectedCurrentStageId/);
  assert.match(migration, /semantic_state_committed_at IS NULL/);
  assert.match(migration, /UPDATE public\.instagram_conversations[\s\S]*?current_stage_id = COALESCE\(v_next_stage_id, current_stage_id\)/);
  assert.ok(migration.indexOf("UPDATE public.instagram_conversations") < migration.indexOf("RETURN jsonb_build_object"));
  assert.doesNotMatch(migration, /sentBalloonsCount|dispatchResult|delivery_status[^\n]*IS DISTINCT FROM 'fully_sent'[\s\S]{0,200}semantic/);
});

test("inbound novo mantém a decisão auditável e deixa ações pendentes para revisão", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260926212713_brain_decision_outbox_sessions.sql", import.meta.url), "utf8");
  const delivery = await readFile(new URL("../supabase/migrations/20260927005646_brain_decision_delivery_independence.sql", import.meta.url), "utf8");
  assert.match(migration, /pending_inbound_requires_brain_review/);
  assert.match(delivery, /'semantic_state_committed'/);
  assert.match(delivery, /'delivery_pending'/);
  assert.match(delivery, /persist_durable_outbox_batch/);
});

test("crash depois da persistência não exige primeiro envio para recuperar semântica", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260927005646_brain_decision_delivery_independence.sql", import.meta.url), "utf8");
  const atomicRpc = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.persist_brain_decision_with_outbox"));
  assert.match(atomicRpc, /PERFORM public\.persist_brain_decision/);
  assert.match(atomicRpc, /persist_durable_outbox_batch/);
  assert.match(atomicRpc, /semantic_state_committed_at = COALESCE\(semantic_state_committed_at, now\(\)\)/);
  assert.match(atomicRpc, /semantic_state_committed/);
  assert.match(atomicRpc, /'semantic_state_committed', 'semantic_state_committed'/);
});

test("episódios outbound só são gravados após entrega confirmada", async () => {
  const brain = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  const episodeWriter = brain.indexOf("await executeEpisodeWriter({", brain.indexOf("const hasConfirmedDelivery"));
  const confirmedGate = brain.lastIndexOf("if (hasConfirmedDelivery)", episodeWriter);
  assert.ok(episodeWriter > -1);
  assert.ok(confirmedGate > -1 && episodeWriter - confirmedGate < 1200);
  assert.doesNotMatch(brain, /isConfirmedSuccess/);
});

test("envio manual só reabre falha confirmada e bloqueia sent, sending e dispatch_uncertain", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260926212713_brain_decision_outbox_sessions.sql", import.meta.url), "utf8");
  assert.match(migration, /COALESCE\(v_action\.status, ''\) <> 'failed_confirmed'/);
  assert.match(migration, /v_entry->>'status' IN \('sent', 'sending', 'dispatch_uncertain'\)/);
  assert.match(migration, /v_entry->>'status' <> 'failed'/);
  assert.match(migration, /'deliveryMode', 'manual'/);
  assert.match(migration, /prepare_brain_action_manual_retry/);
  assert.match(migration, /claim_outbox_entry_brain_safe/);
  assert.match(migration, /pending_inbound_requires_brain_review/);
  assert.match(migration, /status IN \('pending', 'waiting_delay'\)/);
  assert.match(migration, /pendingActionResolution\.cancelActionIds/);
  assert.match(migration, /pending action % is no longer safely cancellable/);
  assert.match(migration, /action_cancelled/);
  assert.doesNotMatch(migration, /CREATE POLICY brain_turn_events_authenticated_read[\s\S]*?USING \(true\)/);
  assert.match(migration, /REVOKE ALL ON public\.brain_turn_events FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT SELECT, INSERT ON public\.brain_turn_events TO service_role/);
  assert.doesNotMatch(migration, /GRANT (?:ALL|[^;]*\bUPDATE\b|[^;]*\bDELETE\b) ON public\.brain_turn_events/);
});

test("a interface de operações lê eventos persistidos e expõe somente ações failed_confirmed", async () => {
  const api = await readFile(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");
  assert.match(api, /from\("brain_turn_events"\)/);
  assert.match(api, /eq\("status", "failed_confirmed"\)/);
  assert.match(api, /retry-failed-action/);
  assert.match(view, /brainOperatorFetch\(`\/operator\/brain\/events\?/);
  assert.match(view, /Enviar manualmente/);
  assert.match(view, /brainOperatorFetch\("\/operator\/brain\/retry-failed-action/);
  const brain = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  assert.match(brain, /pendingInboundIds\.length > 0/);
  assert.match(brain, /lateTurnForResume\.inbound_message_ids/);
  assert.match(brain, /late_turn_new_inbounds_deferred/);
  assert.match(brain, /entry\.status = "cancelled"/);
});
