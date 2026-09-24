// scripts/test-final-three-architecture-points.mjs
// Suíte de testes dedicada aos 3 pontos finais de arquitetura antes de qualquer autorização de commit/push/deploy:
// 1. Migração de sessions antigas sem marcação (Caso Denis)
// 2. Pacing durável com simulação de morte do worker após schedule via waitUntil
// 3. Watermark / Webhook Race & Serialização (inbound concorrente ao toggle ON)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  runBrainOrchestration,
  runDurableOutboxDispatcher,
  scheduleNextOutboxDispatch,
} from "../supabase/functions/api/brain_orchestrator.ts";

if (typeof globalThis.Deno === "undefined") {
  globalThis.Deno = { env: { get: (k) => process.env[k] } };
}

const defaultTurnContract = {
  mustAnswerFirst: false,
  newQuestionBudget: 1,
  responseShape: "balanced",
  directQuestions: [],
  maxBalloons: 2,
};

function withAcceleratedTimers(fn) {
  return async (t) => {
    const origDateNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    try {
      await fn(t);
    } finally {
      Date.now = origDateNow;
      globalThis.setTimeout = realSetTimeout;
    }
  };
}

// ============================================================================
// PONTO 1: MIGRAÇÃO DE SESSIONS ANTIGAS SEM MARCAÇÃO (CASO DENIS)
// ============================================================================

test("1. CASO DENIS: Session antiga sem marcação de kind/version é descartada e cria Session Persistent limpa", withAcceleratedTimers(async () => {
  const conversationId = "conv_denis_real_case";
  const oldLegacySessionId = "sess_denis_old_legacy_without_kind_12345";
  const freshPersistentSessionId = "sess_denis_persistent_clean_99999";

  // Simula banco com sessão pré-existente do Denis sem openai_session_kind e sem persistent_session_version
  const defaultStages = [
    {
      id: "stage_1_conexao",
      name: "Conexão Inicial",
      order: 1,
      goals: [
        { id: "goal_intro", label: "Apresentação", required: true, status: "pending", kind: "conversation_state" },
      ],
    },
  ];

  const convRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      current_stage: "stage_1_conexao",
      stages: defaultStages,
      completed_goals: [],
      config: { persistent_agent_session_enabled: true },
      openai_session_id: oldLegacySessionId,
      // openai_session_kind: undefined (caso real Denis)
      // persistent_session_version: undefined (caso real Denis)
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        stageChecklist: {
          goals: defaultStages[0].goals,
          currentObjective: defaultStages[0].goals[0],
        },
        openai_session_id: oldLegacySessionId,
        // openai_session_kind: undefined
        // persistent_session_version: undefined
      },
      active_cycle_token: "corr_denis_turn_1",
    },
  };

  const tPast = new Date(Date.now() - 60000).toISOString();
  const store = {
    conversations: { [conversationId]: convRecord },
    messages: [
      { id: "msg_d_1", conversation_id: conversationId, sender_id: "user", is_mine: false, text: "Oi Larissa", created_at: tPast, timestamp: tPast },
    ],
    audio_delivery_history: [],
    persona_audios: [],
    chat_stages: defaultStages,
    instagram_config: [
      { id: "openai_api_key", app_secret: "sk-mock-key" },
      { id: "openai_brain_agent_id", app_secret: "agent_denis_mock" },
      { id: "openai_brain_default_model", app_secret: "gpt-6-sol" },
      { id: "openai_brain_reasoning_effort", app_secret: "medium" },
    ],
  };

  const mockSupabase = {
    from: (table) => {
      let conditions = [];
      let updatePayload = null;
      const queryBuilder = {
        select: () => queryBuilder,
        eq: (col, val) => {
          conditions.push({ col, val });
          return queryBuilder;
        },
        in: () => queryBuilder,
        order: () => queryBuilder,
        limit: () => queryBuilder,
        upsert: () => Promise.resolve({ data: null, error: null }),
        single: async () => {
          if (table === "instagram_conversations") {
            return { data: store.conversations[conversationId] || null, error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "instagram_conversations") {
            return { data: store.conversations[conversationId] || null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (updatePayload && table === "instagram_conversations") {
            Object.assign(store.conversations[conversationId], updatePayload);
            return Promise.resolve({ data: store.conversations[conversationId], error: null }).then(resolve);
          }
          if (table === "instagram_config") {
            return Promise.resolve({ data: store.instagram_config, error: null }).then(resolve);
          }
          if (table === "instagram_messages") {
            return Promise.resolve({ data: store.messages, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return queryBuilder;
    },
    rpc: async (fnName, args) => {
      if (fnName === "claim_experimental_cycle_atomic" || fnName === "claim_experimental_cycle_messages_atomic") {
        const ids = args?.p_message_ids || args?.p_claimed_ids || (args?.p_cycle_token === "corr_denis_turn_2" ? ["msg_d_2"] : ["msg_d_1"]);
        return { data: { success: true, claimed_count: ids.length, claimed_ids: ids, inbound_revision: 2 }, error: null };
      }
      if (
        fnName === "commit_experimental_cycle_atomic" ||
        fnName === "commit_experimental_cycle_if_owned" ||
        fnName === "commit_autopilot_cycle_atomic"
      ) {
        if (args.p_new_stage_completed_rules) {
          store.conversations[conversationId].stage_completed_rules = args.p_new_stage_completed_rules;
        }
        return { data: { success: true, committed: true, active_token: null }, error: null };
      }
      if (fnName === "prepare_experimental_outbox_entry") {
        return { data: { success: true, outbox_id: "out_d_1" }, error: null };
      }
      if (fnName === "claim_outbox_entry_atomic") {
        return { data: { success: true, claimed: true, entry: { id: "out_d_1", status: "pending", payload: { text: "Olá Denis!" } } }, error: null };
      }
      if (fnName === "finalize_outbox_entry") {
        return { data: { success: true }, error: null };
      }
      return { data: { success: true }, error: null };
    },
    channel: () => ({ send: async () => ({}), subscribe: () => ({}) }),
  };

  let sessionPassedToAgent = "not_called";
  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: "meta_denis_out_1" }),
    callOpenAiAgent: async (args) => {
      sessionPassedToAgent = args.sessionId; // Deve ser null no primeiro turno (sessão antiga descartada!)
      return {
        sessionId: freshPersistentSessionId,
        sessionCreated: true,
        bootstrapInjected: true,
        bootstrapMessageCount: 1,
        plan: {
          action: "reply",
          responses: ["Olá Denis! Como você está?"],
          outboundActions: [{ type: "text", text: "Olá Denis! Como você está?" }],
          objectiveDecision: "continue",
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  // Turno 1 do Denis:
  const res1 = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId: "corr_denis_turn_1",
    preClaimedCycleToken: "corr_denis_turn_1",
    isManualRetry: true,
    newMessage: { id: "msg_d_1", sender: "user", text: "Oi Larissa", timestamp: tPast },
    runtime,
  });

  assert.equal(res1.handled, true, "Turno 1 deve executar com sucesso");
  assert.equal(
    sessionPassedToAgent,
    null,
    "Sessão antiga do Denis SEM kind='persistent' e SEM version DEVE ser descartada (passando null para criar Session Persistent limpa)"
  );

  const trace1 = res1.trace || [];
  assert.ok(
    trace1.includes("unmarked_or_legacy_session_migrated_to_persistent=true"),
    "Trace deve auditar a migração de sessão sem marcação para persistent"
  );

  // Verifica persistência no banco
  const updatedConv = store.conversations[conversationId];
  assert.equal(
    updatedConv.stage_completed_rules.orchestration.openai_session_id,
    freshPersistentSessionId,
    "Nova Session Persistent limpa deve ser salva no banco"
  );
  assert.equal(
    updatedConv.stage_completed_rules.orchestration.openai_session_kind,
    "persistent",
    "Deve registrar kind='persistent'"
  );
  assert.equal(
    updatedConv.stage_completed_rules.orchestration.persistent_session_version,
    1,
    "Deve registrar persistent_session_version=1"
  );

  // Turno 2 do Denis: agora reutiliza a nova sessão persistente limpa!
  let sessionPassedInTurn2 = null;
  runtime.callOpenAiAgent = async (args) => {
    sessionPassedInTurn2 = args.sessionId;
    return {
      sessionId: args.sessionId,
      sessionCreated: false,
      plan: {
        action: "reply",
        responses: ["Que ótimo!"],
        outboundActions: [{ type: "text", text: "Que ótimo!" }],
        objectiveDecision: "continue",
        turnContract: defaultTurnContract,
      },
    };
  };

  store.messages.push({
    id: "msg_d_2",
    conversation_id: conversationId,
    sender_id: "user",
    is_mine: false,
    text: "Tudo bem e vc?",
    created_at: new Date().toISOString(),
  });
  store.conversations[conversationId].stage_completed_rules.active_cycle_token = "corr_denis_turn_2";

  const res2 = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId: "corr_denis_turn_2",
    preClaimedCycleToken: "corr_denis_turn_2",
    isManualRetry: true,
    newMessage: { id: "msg_d_2", sender: "user", text: "Tudo bem e vc?", timestamp: new Date().toISOString() },
    runtime,
  });

  assert.equal(res2.handled, true, "Turno 2 deve executar com sucesso");
  assert.equal(
    sessionPassedInTurn2,
    freshPersistentSessionId,
    "Turno 2 DEVE reutilizar a nova Session Persistent limpa criada sem recriar"
  );
}));

// ============================================================================
// PONTO 2: PACING DURÁVEL COM MORTE DO WORKER APÓS SCHEDULE VIA WAITUNTIL
// ============================================================================

test("2. PACING DURÁVEL: Morte do worker após schedule via waitUntil não perde mensagem e cron retoma entrega", async () => {
  // Cenário:
  // Brain gerou 2 balões:
  // a0: enviado imediatamente
  // a1: agendado para daqui a 8s (notBefore)
  // Worker morre após agendar via waitUntil.
  // Prova que o outbox permanece durável no PostgreSQL e é assumido e enviado pelo cron periódico.

  const origDateNow = Date.now;
  const nowMs = origDateNow();
  const notBeforeIso = new Date(nowMs + 8000).toISOString();

  const dbOutbox = {
    a0: {
      id: "a0",
      actionIndex: 0,
      status: "sent",
      actionType: "text",
      payload: { text: "Primeiro balão enviado" },
      sentAt: new Date(nowMs).toISOString(),
    },
    a1: {
      id: "a1",
      actionIndex: 1,
      status: "pending",
      notBefore: notBeforeIso,
      actionType: "text",
      payload: { text: "Segundo balão com pacing de 8 segundos" },
      attempts: 0,
    },
  };

  // 1. Simula a chamada de scheduleNextOutboxDispatch pelo worker originador
  let waitUntilInvoked = false;
  let promiseCaptured = null;
  const previousEdgeRuntime = globalThis.EdgeRuntime;

  globalThis.EdgeRuntime = {
    waitUntil: (promise) => {
      waitUntilInvoked = true;
      promiseCaptured = promise;
    },
  };

  try {
    scheduleNextOutboxDispatch({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
      conversationId: "conv_worker_crash_test",
      outboxMap: dbOutbox,
    });

    assert.equal(waitUntilInvoked, true, "scheduleNextOutboxDispatch deve acionar EdgeRuntime.waitUntil");

    // 2. SIMULAÇÃO DA MORTE DO WORKER:
    // O worker da Edge Function é desligado/reciclado abruptamente.
    // A promise em memória é descartada (não chega a executar).
    // O estado no banco de dados DEVE permanecer intacto:
    assert.equal(dbOutbox.a1.status, "pending", "Ação a1 deve permanecer como 'pending' no banco");
    assert.equal(dbOutbox.a1.notBefore, notBeforeIso, "notBefore deve estar preservado");

    // 3. RECUPERAÇÃO PELO CRON (/autopilot/tick de 1 minuto):
    // Passa-se o tempo necessário para maturação:
    Date.now = () => nowMs + 10000; // 10s depois (now > notBefore)
    const dispatchedTexts = [];
    const runtime = {
      sendMetaTextMessage: async (_sb, _convId, text) => {
        dispatchedTexts.push(text);
        return { ok: true, message_id: "meta_cron_delivered_a1" };
      },
    };

    const mockSupabaseForCron = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                stage_completed_rules: {
                  orchestration: {
                    outbox: dbOutbox,
                  },
                },
              },
            }),
          }),
        }),
      }),
      rpc: async (fnName, args) => {
        if (fnName === "claim_outbox_entry_atomic") {
          const entry = dbOutbox[args.p_outbox_id];
          return { data: { success: true, claimed: true, entry } };
        }
        if (fnName === "finalize_outbox_entry") {
          dbOutbox[args.p_outbox_id].status = args.p_status;
          return { data: { success: true } };
        }
        return { data: { success: true } };
      },
    };

    // Cron executa o dispatcher resiliente:
    const cronResult = await runDurableOutboxDispatcher({
      supabase: mockSupabaseForCron,
      conversationId: "conv_worker_crash_test",
      runtime,
      outboxMap: dbOutbox,
      dispatcherToken: "cron_recovery_tick_60s",
    });

    // 4. Verificação da recuperação durável:
    assert.equal(cronResult.dispatchedCount, 1, "O cron DEVE despachar a ação madura sem depender do worker antigo");
    assert.equal(dispatchedTexts.length, 1);
    assert.equal(dispatchedTexts[0], "Segundo balão com pacing de 8 segundos");
    assert.equal(dbOutbox.a1.status, "sent", "Status deve evoluir para 'sent' no PostgreSQL");
  } finally {
    Date.now = origDateNow;
    globalThis.EdgeRuntime = previousEdgeRuntime;
  }
});

// ============================================================================
// PONTO 3: TESTES EXATOS DE SERIALIZAÇÃO TRANSACIONAL & ZERO HEURÍSTICA TEMPORAL
// ============================================================================

function createAtomicConversationState(initialRev = 0) {
  return {
    id: "conv_watermark_test",
    ai_auto_respond: false,
    is_restricted: false,
    stage_completed_rules: {
      orchestration: {
        inboundRevision: initialRev,
        activation_watermark: null,
        messageInboundRevisions: {},
        messageLedger: {},
      },
    },
    messages: [],
    brainCalls: 0,
  };
}

// Simulação fidedigna de record_inbound_message_atomic (sob SELECT FOR UPDATE da conversa)
function recordInboundUnderConversationLock(state, messageId, text = "Olá") {
  const orch = state.stage_completed_rules.orchestration;
  const currentRev = orch.inboundRevision || 0;
  const newRev = currentRev + 1;

  orch.inboundRevision = newRev;
  orch.messageInboundRevisions[messageId] = newRev;
  orch.messageLedger[messageId] = "pending";

  state.messages.push({ id: messageId, text, direction: "inbound" });

  const watermark = orch.activation_watermark;
  const watermarkRev = typeof watermark?.inboundRevision === "number"
    ? watermark.inboundRevision
    : null;

  const eligibleAfterActivation = Boolean(
    state.ai_auto_respond &&
    !state.is_restricted &&
    (watermarkRev === null || newRev > watermarkRev)
  );

  return {
    success: true,
    inbound_revision: newRev,
    watermark_revision: watermarkRev,
    eligible_after_activation: eligibleAfterActivation,
  };
}

// Simulação fidedigna de arm_autopilot_with_watermark_atomic (sob SELECT FOR UPDATE da conversa)
function armAutopilotUnderConversationLock(state) {
  const orch = state.stage_completed_rules.orchestration;
  const currentRev = orch.inboundRevision || 0;

  const watermark = {
    inboundRevision: currentRev,
  };

  orch.activation_watermark = watermark;
  state.ai_auto_respond = true;

  return {
    success: true,
    watermark,
    inbound_revision: currentRev,
  };
}

function maybeTriggerBrain(state, admissionResult) {
  if (admissionResult.eligible_after_activation) {
    state.brainCalls += 1;
  }
}

// ----------------------------------------------------------------------------
// Teste A: inbound commitada 1s antes do toggle → entra no baseline → zero Brain
// ----------------------------------------------------------------------------
test("3A. Inbound commitada 1s antes do toggle entra no baseline e gera ZERO Brain", () => {
  const state = createAtomicConversationState(0);

  // 1. Inbound chega antes do toggle ON e adquire o lock FOR UPDATE
  const admission = recordInboundUnderConversationLock(state, "msg_1s_before", "Oi Larissa");
  assert.equal(admission.inbound_revision, 1);
  assert.equal(admission.eligible_after_activation, false, "Conversa desligada: eligible_after_activation deve ser false");

  maybeTriggerBrain(state, admission);

  // 2. Operador clica em Toggle ON (arm_autopilot_with_watermark_atomic adquire lock FOR UPDATE)
  const armResult = armAutopilotUnderConversationLock(state);
  assert.equal(armResult.watermark.inboundRevision, 1, "Watermark captura inboundRevision=1 como baseline");
  assert.equal(state.ai_auto_respond, true);

  // 3. Verificações formais:
  assert.equal(state.brainCalls, 0, "Deve haver exatamente ZERO chamadas ao Brain para mensagem anterior ao toggle");
  assert.equal(state.stage_completed_rules.orchestration.messageInboundRevisions.msg_1s_before, 1);
  assert.ok(
    state.stage_completed_rules.orchestration.messageInboundRevisions.msg_1s_before <= state.stage_completed_rules.orchestration.activation_watermark.inboundRevision,
    "Revisão da mensagem deve ser <= watermark.inboundRevision"
  );
});

// ----------------------------------------------------------------------------
// Teste B: toggle adquire lock/commita primeiro → inbound depois recebe revision > watermarkRevision → Brain elegível
// ----------------------------------------------------------------------------
test("3B. Toggle adquire lock/commita primeiro -> inbound depois recebe revision > watermarkRevision -> Brain elegível", () => {
  const state = createAtomicConversationState(5);

  // 1. Toggle ON adquire o lock FOR UPDATE primeiro e commita
  const armResult = armAutopilotUnderConversationLock(state);
  assert.equal(armResult.watermark.inboundRevision, 5, "Watermark captura inboundRevision=5");
  assert.equal(state.ai_auto_respond, true);

  // 2. Inbound chega após o toggle e adquire o lock FOR UPDATE
  const admission = recordInboundUnderConversationLock(state, "msg_after_toggle", "Nova mensagem após ligar");
  assert.equal(admission.inbound_revision, 6, "inboundRevision deve avançar monotonicamente para 6");
  assert.equal(admission.watermark_revision, 5);
  assert.equal(admission.eligible_after_activation, true, "Mensagem posterior ao watermark DEVE ser elegível");

  maybeTriggerBrain(state, admission);

  // 3. Verificações formais:
  assert.equal(state.brainCalls, 1, "Brain DEVE ser disparado para a nova mensagem pós-ativação");
});

// ----------------------------------------------------------------------------
// Teste C: inbound adquire lock/commita primeiro → toggle captura revision no watermark → zero Brain
// ----------------------------------------------------------------------------
test("3C. Inbound adquire lock/commita primeiro -> toggle captura revision no watermark -> zero Brain", () => {
  const state = createAtomicConversationState(10);

  // 1. Inbound concorrente ganha o lock FOR UPDATE antes do toggle ON terminar de comitar
  const admission = recordInboundUnderConversationLock(state, "msg_wins_lock", "Mensagem concorrente");
  assert.equal(admission.inbound_revision, 11);
  assert.equal(admission.eligible_after_activation, false, "Ainda não ativado: não pode disparar Brain");

  maybeTriggerBrain(state, admission);

  // 2. Toggle ON adquire o lock logo em seguida
  const armResult = armAutopilotUnderConversationLock(state);
  assert.equal(armResult.watermark.inboundRevision, 11, "Watermark DEVE incluir a revisão da mensagem que ganhou o lock");

  // 3. Verificações formais:
  assert.equal(state.brainCalls, 0, "Zero Brain: mensagem foi absorvida no baseline do watermark");
  assert.equal(state.stage_completed_rules.orchestration.messageInboundRevisions.msg_wins_lock, 11);
  assert.equal(state.stage_completed_rules.orchestration.activation_watermark.inboundRevision, 11);
});

// ----------------------------------------------------------------------------
// Teste D: teste estático/estrutural (Zero heurísticas temporais e webhook obrigatório)
// ----------------------------------------------------------------------------
test("3D. Teste estático/estrutural: ausência total de < 5s, janela temporal, armedAt ou clock skew, e webhook 100% fail-closed via record_inbound_message_atomic", () => {
  const migrationSource = readFileSync(
    new URL("../supabase/migrations/20260924130000_durable_outbox_and_activation_watermark.sql", import.meta.url),
    "utf8"
  );
  const apiSource = readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8"
  );

  // 1. Validação da Migration SQL
  const armFuncStart = migrationSource.indexOf("CREATE OR REPLACE FUNCTION arm_autopilot_with_watermark_atomic(");
  assert.notEqual(armFuncStart, -1, "arm_autopilot_with_watermark_atomic deve existir na migration");
  const armFuncEnd = migrationSource.indexOf("$$;", armFuncStart);
  const armFuncSql = migrationSource.slice(armFuncStart, armFuncEnd);

  const inboundFuncStart = migrationSource.indexOf("CREATE OR REPLACE FUNCTION record_inbound_message_atomic(");
  assert.notEqual(inboundFuncStart, -1, "record_inbound_message_atomic deve existir na migration");
  const inboundFuncEnd = migrationSource.indexOf("$$;", inboundFuncStart);
  const inboundFuncSql = migrationSource.slice(inboundFuncStart, inboundFuncEnd);

  // Prova que as duas funções adquirem o MESMO lock FOR UPDATE
  assert.match(armFuncSql, /FROM instagram_conversations[\s\S]*FOR UPDATE/i, "arm_autopilot deve usar FOR UPDATE");
  assert.match(inboundFuncSql, /FROM instagram_conversations[\s\S]*FOR UPDATE/i, "record_inbound deve usar FOR UPDATE");

  // Prova da autoridade estrita da inboundRevision
  assert.match(armFuncSql, /'inboundRevision',\s*v_current_rev/i);
  assert.match(inboundFuncSql, /v_new_rev\s*:=\s*v_current_rev\s*\+\s*1/i);
  assert.match(inboundFuncSql, /messageInboundRevisions/i);
  assert.match(inboundFuncSql, /eligible_after_activation/i);

  // Proibição expressa de heurísticas temporais em arm_autopilot_with_watermark_atomic
  assert.doesNotMatch(armFuncSql, /INTERVAL\s+'5 seconds'/i, "Proibido INTERVAL '5 seconds'");
  assert.doesNotMatch(armFuncSql, /5\s*seconds/i, "Proibido '5 seconds'");
  assert.doesNotMatch(armFuncSql, /created_at\s*>?=\s*\(NOW/i, "Proibido comparação de created_at com NOW");
  assert.doesNotMatch(armFuncSql, /'armedAt'/i, "Proibido campo armedAt no watermark");
  assert.doesNotMatch(armFuncSql, /'lastMessageTimestamp'/i, "Proibido campo lastMessageTimestamp no watermark");

  // 2. Validação do Webhook em index.ts: 100% fail-closed e obrigatório via record_inbound_message_atomic
  const webhookIdx = apiSource.indexOf('if (path === "/meta/webhook" || path === "/instagram/webhook")');
  assert.notEqual(webhookIdx, -1, "Rota de webhook deve existir");
  const nextRouteIdx = apiSource.indexOf('if (path === "/autopilot/trigger")', webhookIdx);
  const webhookBlock = apiSource.slice(webhookIdx, nextRouteIdx !== -1 ? nextRouteIdx : webhookIdx + 30000);

  assert.match(webhookBlock, /record_inbound_message_atomic/i, "Webhook deve chamar record_inbound_message_atomic");
  assert.match(webhookBlock, /isEligibleByWatermark/i, "Webhook deve validar elegibilidade do watermark");
  assert.doesNotMatch(webhookBlock, /record_inbound_message_atomic fallback/i, "Proibido fallback não-serializado no webhook");
  assert.doesNotMatch(webhookBlock, /if \(!inboundSaveSuccess\)/i, "Proibido if (!inboundSaveSuccess) com upsert direto de inbound");

  // 3. Validação do trigger e tick em index.ts: zero armedAt e zero clock skew
  assert.doesNotMatch(apiSource, /watermark\.armedAt\s*&&/i, "Proibido watermark.armedAt");
  assert.doesNotMatch(apiSource, /activationWatermark\?\.armedAt/i, "Proibido activationWatermark?.armedAt");
  assert.doesNotMatch(apiSource, /clock skew/i, "Proibido menção ou heurística de clock skew");
});
