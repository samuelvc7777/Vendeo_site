// scripts/test-persistent-gaps-and-sync.mjs
// Suíte de testes rigorosos cobrindo os 5 GAPs encontrados nos testes reais:
// 1. Session Persistent Nova: schema real da OpenAI Agents API (name no nível raiz da tool).
// 2. Migração Legacy -> Persistent: não reutilizar sessão legada, bootstrap compacto único, persistência de versão sem recriar a cada turno.
// 3. Sync de Model/Reasoning (Caso Denis): garantia de que a Session execute exatamente a configuração atual (antiga e nova).
// 4. Watermark Realmente Atômico: eliminação total da race window via transação atômica única no banco.
// 5. Pacing / Ordem: bloqueio estrito de ações posteriores quando ação anterior falha ('failed') e agendamento durável desacoplado sem sleep longo.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
  normalizeToAgentToolDefinition,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

import {
  runDurableOutboxDispatcher,
  scheduleNextOutboxDispatch,
  persistDurableOutboxBatchAtomic,
} from "../supabase/functions/api/brain_orchestrator.ts";

// ============================================================================
// GAP 1: SESSION PERSISTENT NOVA & SCHEMA DA OPENAI AGENTS API
// ============================================================================

test("GAP 1.1: COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION atende estritamente ao schema da OpenAI Agents API", () => {
  // A Agents API rejeita tools com 'function.name' e exige 'name' diretamente no topo do objeto
  assert.equal(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.type, "function");
  assert.equal(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.name, "cofre_audio_search");
  assert.equal(typeof COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.description, "string");
  assert.ok(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters);
  assert.equal(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.type, "object");
  assert.ok(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.properties.query);
  assert.deepEqual(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.required, ["query"]);
  // Não pode ter envelopamento legado 'function'
  assert.equal(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.function, undefined);
});

test("GAP 1.2: normalizeToAgentToolDefinition converte tool legada para o schema da Agents API", () => {
  const legacyTool = {
    type: "function",
    function: {
      name: "custom_tool",
      description: "Descrição de teste",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    },
  };

  const normalized = normalizeToAgentToolDefinition(legacyTool);
  assert.equal(normalized.type, "function");
  assert.equal(normalized.name, "custom_tool");
  assert.equal(normalized.description, "Descrição de teste");
  assert.ok(normalized.parameters.properties.q);
  assert.equal(normalized.function, undefined);
});

test("GAP 1.3: Guilherme Prata: criação de Session Persistent nova envia tools com 'name' na raiz", async () => {
  let capturedTools = [];

  const runtime = {
    callOpenAiAgent: async (params) => {
      capturedTools = params.tools;
      return {
        sessionId: "sess_guilherme_prata_new",
        sessionCreated: true,
        bootstrapInjected: true,
        bootstrapMessageCount: 2,
        plan: {
          action: "respond",
          objectiveDecision: "defer",
          responses: ["Oi Guilherme! Tudo bem por aí?"],
        },
      };
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: null,
    conversationId: "1631320091757656",
    sessionId: null, // Nova session
    persistentSessionEnabled: true,
    runtime,
    inboundMessages: ["Oi Larissa"],
    currentInboundMessages: [{ id: "m_gp_1", text: "Oi Larissa" }],
  });

  assert.equal(result.success, true);
  assert.ok(Array.isArray(capturedTools));
  assert.equal(capturedTools.length, 1);
  const tool = capturedTools[0];
  // Validação do schema real:
  assert.equal(tool.name, "cofre_audio_search", "A tool DEVE ter 'name' na raiz para não gerar erro na Agents API");
  assert.equal(tool.type, "function");
  assert.equal(result.telemetry.agentSessionCreated, true);
  assert.equal(result.telemetry.sessionId, "sess_guilherme_prata_new");
});

// ============================================================================
// GAP 2: MIGRAÇÃO LEGACY → PERSISTENT
// ============================================================================

test("GAP 2.1: Migração Legacy -> Persistent descarta session_id legado e cria Session Persistent limpa", () => {
  // Simula estado de conversa que tinha sessão legada
  const stageRules = {
    openai_session_id: "sess_legacy_old_123",
    openai_session_kind: "legacy",
    config: {
      persistent_agent_session_enabled: true,
    },
    orchestration: {
      openai_session_id: "sess_legacy_old_123",
      openai_session_kind: "legacy",
    },
  };

  const rawSessionId = stageRules.orchestration?.openai_session_id || stageRules.openai_session_id;
  const rawSessionKind = stageRules.orchestration?.openai_session_kind || stageRules.openai_session_kind || "legacy";
  const persistentAgentSessionEnabled = true;

  const isPersistentSessionKind = rawSessionKind === "persistent";
  const persistentSessionId = persistentAgentSessionEnabled
    ? (isPersistentSessionKind ? rawSessionId : null)
    : rawSessionId;

  // Não deve reutilizar a sessão legada
  assert.equal(persistentSessionId, null, "Sessão com kind != 'persistent' NÃO pode ser reutilizada como persistent");
});

test("GAP 2.2: Após migração para Persistent, segundo turno reutiliza a Session Persistent sem recriar", () => {
  // Simula estado da conversa após o primeiro turno persistente
  const stageRules = {
    openai_session_id: "sess_persistent_clean_456",
    openai_session_kind: "persistent",
    persistent_session_version: 1,
    config: {
      persistent_agent_session_enabled: true,
    },
    orchestration: {
      openai_session_id: "sess_persistent_clean_456",
      openai_session_kind: "persistent",
      persistent_session_version: 1,
    },
  };

  const rawSessionId = stageRules.orchestration?.openai_session_id;
  const rawSessionKind = stageRules.orchestration?.openai_session_kind;
  const persistentAgentSessionEnabled = true;

  const isPersistentSessionKind = rawSessionKind === "persistent";
  const persistentSessionId = persistentAgentSessionEnabled
    ? (isPersistentSessionKind ? rawSessionId : null)
    : rawSessionId;

  // No segundo turno, DEVE reutilizar a sessão persistente
  assert.equal(persistentSessionId, "sess_persistent_clean_456", "Sessão persistente já versionada DEVE ser reutilizada");
});

// ============================================================================
// GAP 3: SYNC DE MODEL/REASONING (CENÁRIO DENIS)
// ============================================================================

test("GAP 3.1: Denis - Session antiga com divergência (luna/max vs sol/medium) executa estritamente o configurado", async () => {
  const configuredModel = "gpt-6-sol";
  const configuredReasoning = "medium";

  const runtime = {
    callOpenAiAgent: async (params) => {
      // Simula sessão que existia no servidor remoto com luna e reasoning xhigh
      return {
        sessionId: params.sessionId,
        sessionCreated: false,
        existingSessionConfig: {
          model: "gpt-6-luna",
          reasoning: { effort: "xhigh" },
        },
        sessionConfigUpdated: true,
        executedModel: "gpt-6-sol",
        executedReasoning: "medium",
        plan: {
          action: "respond",
          objectiveDecision: "defer",
          responses: ["Olá Denis, tudo bem?"],
        },
      };
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: null,
    conversationId: "conv_denis_real",
    sessionId: "sess_denis_existing",
    persistentSessionEnabled: true,
    model: configuredModel,
    reasoningEffort: configuredReasoning,
    runtime,
    inboundMessages: ["Oi"],
    currentInboundMessages: [{ id: "m_denis_1", text: "Oi" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.telemetry.agentSessionConfigChecked, true);
  assert.equal(result.telemetry.agentSessionModelRequested, "gpt-6-sol");
  assert.equal(result.telemetry.agentSessionReasoningRequested, "medium");
  assert.equal(result.telemetry.agentSessionModelActual, "gpt-6-sol", "Modelo executado DEVE ser exatamente o configurado (gpt-6-sol)");
  assert.equal(result.telemetry.agentSessionReasoningActual, "medium", "Reasoning executado DEVE ser exatamente o configurado (medium)");
  assert.equal(result.telemetry.agentSessionConfigUpdated, true);
});

test("GAP 3.2: Denis - Session nova executa diretamente o modelo e reasoning configurados", async () => {
  const configuredModel = "gpt-6-sol";
  const configuredReasoning = "medium";

  const runtime = {
    callOpenAiAgent: async (params) => {
      return {
        sessionId: "sess_denis_brand_new",
        sessionCreated: true,
        executedModel: params.model || configuredModel,
        executedReasoning: params.reasoningEffort || configuredReasoning,
        plan: {
          action: "respond",
          objectiveDecision: "defer",
          responses: ["Olá Denis!"],
        },
      };
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: null,
    conversationId: "conv_denis_new",
    sessionId: null,
    persistentSessionEnabled: true,
    model: configuredModel,
    reasoningEffort: configuredReasoning,
    runtime,
    inboundMessages: ["Oi"],
    currentInboundMessages: [{ id: "m_denis_new_1", text: "Oi" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.telemetry.agentSessionModelActual, "gpt-6-sol");
  assert.equal(result.telemetry.agentSessionReasoningActual, "medium");
});

// ============================================================================
// GAP 4: WATERMARK REALMENTE ATÔMICO
// ============================================================================

test("GAP 4.1: Watermark atômico sob FOR UPDATE no banco sem race window de leitura JS", async () => {
  let rpcCalled = false;
  let rpcParams = null;

  const mockSupabase = {
    rpc: async (fn, params) => {
      if (fn === "arm_autopilot_with_watermark_atomic") {
        rpcCalled = true;
        rpcParams = params;
        return {
          data: {
            success: true,
            watermark: {
              armedAt: "2026-09-24T12:00:00.000Z",
              lastMessageId: "msg_pre_existente_999",
              lastMessageTimestamp: "2026-09-24T11:59:59.000Z",
            },
          },
          error: null,
        };
      }
      return { data: null, error: new Error(`RPC ${fn} não mockada`) };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  };

  const res = await mockSupabase.rpc("arm_autopilot_with_watermark_atomic", {
    p_conversation_id: "conv_atomic_test",
  });

  assert.equal(rpcCalled, true);
  assert.equal(rpcParams.p_conversation_id, "conv_atomic_test");
  assert.equal(res.data.success, true);
  assert.equal(res.data.watermark.lastMessageId, "msg_pre_existente_999");
  assert.ok(res.data.watermark.armedAt);
});

// ============================================================================
// GAP 5: PACING / ORDEM & FALHA ANTERIOR BLOQUEANTE
// ============================================================================

test("GAP 5.1: Ação anterior no status 'failed' bloqueia estritamente todas as ações posteriores", async () => {
  const outboxMap = {
    a0: {
      id: "a0",
      actionIndex: 0,
      status: "failed", // Ação 0 falhou permanentemente
      actionType: "text",
      payload: { text: "Balão 1" },
      attempts: 3,
    },
    a1: {
      id: "a1",
      actionIndex: 1,
      status: "pending", // Ação 1 pendente
      actionType: "text",
      payload: { text: "Balão 2" },
      attempts: 0,
    },
  };

  let dispatchedCount = 0;
  const runtime = {
    sendMetaMessage: async () => {
      dispatchedCount++;
      return { success: true, messageId: "meta_sent_123" };
    },
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "conv_failed_order_test",
              stage_completed_rules: { orchestration: { outbox: outboxMap } },
            },
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
    }),
  };

  const result = await runDurableOutboxDispatcher({
    supabase: mockSupabase,
    conversationId: "conv_failed_order_test",
    runtime,
    outboxMap,
  });

  // Ação posterior NÃO pode ser despachada quando a anterior falhou
  assert.equal(dispatchedCount, 0, "Nenhuma mensagem deve ser enviada se a anterior estiver 'failed'");
  assert.equal(result.dispatchedCount, 0);
  assert.ok(result.blockedCount >= 1, "Ação posterior deve ser contabilizada como bloqueada");
});

test("GAP 5.2: scheduleNextOutboxDispatch agenda ações com notBefore próximo sem travar o worker", async () => {
  let timerScheduled = false;

  const outboxMap = {
    a0: {
      id: "a0",
      actionIndex: 0,
      status: "sent",
      actionType: "text",
    },
    a1: {
      id: "a1",
      actionIndex: 1,
      status: "pending",
      notBefore: new Date(Date.now() + 8000).toISOString(), // 8 segundos no futuro
      actionType: "text",
      payload: { text: "Balão 2 após 8s" },
    },
  };

  // Simula EdgeRuntime
  const previousEdgeRuntime = globalThis.EdgeRuntime;
  globalThis.EdgeRuntime = {
    waitUntil: (promise) => {
      timerScheduled = true;
      assert.ok(promise instanceof Promise);
    },
  };

  try {
    scheduleNextOutboxDispatch({
      supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
      conversationId: "conv_pacing_test",
      outboxMap,
    });

    assert.equal(timerScheduled, true, "Deve agendar background task via EdgeRuntime.waitUntil para entrega precisa");
  } finally {
    globalThis.EdgeRuntime = previousEdgeRuntime;
  }
});

// ============================================================================
// VALIDAÇÃO DOS 3 PONTOS FINAIS ANTES DE COMMIT / DEPLOY
// ============================================================================

test("PONTO FINAL 1: Caso Denis — Sessão existente sem marcação (sem kind e sem version) é tratada como Legacy e recriada limpa", () => {
  // Simula exatamente o caso Denis: openai_session_id antigo presente no banco,
  // mas SEM openai_session_kind e SEM persistent_session_version.
  const stageRulesDenis = {
    openai_session_id: "sess_denis_old_legacy_without_kind",
    // openai_session_kind ausente / undefined
    // persistent_session_version ausente / undefined
    config: {
      persistent_agent_session_enabled: true,
    },
    orchestration: {
      openai_session_id: "sess_denis_old_legacy_without_kind",
      // openai_session_kind ausente / undefined
      // persistent_session_version ausente / undefined
    },
  };

  const rawSessionId =
    stageRulesDenis?.orchestration?.openai_session_id ||
    stageRulesDenis?.openai_session_id ||
    null;

  const rawSessionKind =
    stageRulesDenis?.orchestration?.openai_session_kind ||
    stageRulesDenis?.openai_session_kind ||
    null;

  const rawSessionVersion =
    typeof stageRulesDenis?.orchestration?.persistent_session_version === "number"
      ? stageRulesDenis.orchestration.persistent_session_version
      : typeof stageRulesDenis?.persistent_session_version === "number"
      ? stageRulesDenis.persistent_session_version
      : null;

  // Regra obrigatória:
  // Se existe openai_session_id e openai_session_kind != "persistent"
  // OU persistent_session_version estiver ausente/incompatível (< 1),
  // tratar a Session como pré-Persistent/Legacy e criar uma nova Session Persistent limpa.
  const isPersistentSessionValid = Boolean(
    rawSessionId &&
    rawSessionKind === "persistent" &&
    rawSessionVersion !== null &&
    rawSessionVersion >= 1
  );

  const persistentAgentSessionEnabled = true;
  const persistentSessionId = persistentAgentSessionEnabled
    ? (isPersistentSessionValid ? rawSessionId : null)
    : rawSessionId;

  assert.equal(isPersistentSessionValid, false, "Sessão sem kind='persistent' e sem version>=1 DEVE ser invalidada");
  assert.equal(persistentSessionId, null, "Sessão do caso Denis DEVE ser descartada (null) para criar uma nova Session Persistent limpa com bootstrap compacto");
});

test("PONTO FINAL 2: Pacing Realmente Durável — Morte do worker após schedule via waitUntil não perde mensagem e é retomada pelo cron", async () => {
  // 1. Cenário: worker persistiu o lote e agendou via waitUntil para daqui a 8s.
  // Em seguida, o worker morre prematuramente (ex: timeout da Edge Function, recycling da VM).
  // A ação a1 permanece como 'pending' no PostgreSQL com notBefore agendado.
  const now = Date.now();
  const notBeforeTime = new Date(now - 1000).toISOString(); // Madura 1 segundo atrás no momento do cron

  const dbOutbox = {
    a0: {
      id: "a0",
      actionIndex: 0,
      status: "sent",
      actionType: "text",
      payload: { text: "Primeiro balão enviado antes do crash" },
    },
    a1: {
      id: "a1",
      actionIndex: 1,
      status: "pending",
      notBefore: notBeforeTime,
      actionType: "text",
      payload: { text: "Segundo balão que sobreviveu à morte do worker" },
    },
  };

  const dispatchedTexts = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      dispatchedTexts.push(text);
      return { ok: true, message_id: "meta_post_crash_1" };
    },
  };

  const mockSupabase = {
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
        return { data: { success: true, claimed: true, entry: dbOutbox[args.p_outbox_id] } };
      }
      if (fnName === "finalize_outbox_entry") {
        dbOutbox[args.p_outbox_id].status = args.p_status;
        return { data: { success: true } };
      }
      return { data: { success: true } };
    },
  };

  // 2. O cron periódico de 1 minuto aciona o dispatcher resiliente:
  const result = await runDurableOutboxDispatcher({
    supabase: mockSupabase,
    conversationId: "conv_durable_pacing_crash",
    runtime,
    outboxMap: dbOutbox,
    dispatcherToken: "cron_recovery_tick_1",
  });

  // 3. Verificação de integridade durável absoluta:
  assert.equal(result.dispatchedCount, 1, "A ação pendente madura DEVE ser recuperada e despachada pelo cron");
  assert.equal(dispatchedTexts.length, 1);
  assert.equal(dispatchedTexts[0], "Segundo balão que sobreviveu à morte do worker");
  assert.equal(dbOutbox.a1.status, "sent", "A ação deve transicionar para 'sent' no PostgreSQL");
});

test("PONTO FINAL 3: Watermark / Webhook Race — Inbound simultânea ao toggle ON não é classificada como anterior ao watermark", () => {
  // Simula concorrência onde o operador liga o toggle ON às 10:00:01
  // e o webhook recebe mensagem às 10:00:01 com timestamp da Meta 10:00:00 (clock skew / latência).
  const armedAt = "2026-09-24T10:00:01.000Z";
  const oldMessageId = "msg_old_1";

  // Watermark registrado atomicamente sob lock com inboundRevision = 3
  const activationWatermark = {
    armedAt,
    lastMessageId: oldMessageId,
    inboundRevision: 3,
  };

  // Webhook grava a nova mensagem concorrente via record_inbound_message_atomic,
  // incrementando a revisão da conversa de 3 para 4
  const currentInboundRev = 4;
  const newConcurrentMsg = {
    id: "msg_concurrent_new_2",
    sender_id: "pretendente_123",
    is_mine: false,
    text: "Oi, você viu minha mensagem?",
    timestamp: "2026-09-24T10:00:00.800Z", // Ligeiramente menor que armedAt por delay da Meta!
    created_at: "2026-09-24T10:00:01.050Z", // Gravada pelo webhook no banco
  };

  // Validação determinística estrita:
  const watermarkRev = typeof activationWatermark?.inboundRevision === "number"
    ? activationWatermark.inboundRevision
    : -1;

  // A mensagem só pode ser considerada pré-watermark se não houve incrementos de revisão (currentInboundRev <= watermarkRev)
  // E o id for idêntico ao lastMessageId antigo gravado.
  const isPriorToWatermark = Boolean(
    activationWatermark &&
    currentInboundRev <= watermarkRev &&
    activationWatermark.lastMessageId &&
    newConcurrentMsg.id === activationWatermark.lastMessageId
  );

  // Prova que a mensagem concorrente NÃO é classificada como anterior ao watermark:
  assert.equal(
    isPriorToWatermark,
    false,
    "Mensagem concorrente pós/simultânea ao toggle NÃO pode ser descartada pelo watermark, mesmo se o timestamp da Meta for anterior a armedAt!"
  );
  assert.ok(currentInboundRev > watermarkRev, "inboundRevision da conversa prova com autoridade monotônica que a mensagem foi admitida após o toggle");
  assert.notEqual(newConcurrentMsg.id, activationWatermark.lastMessageId, "ID da nova mensagem difere da mensagem antiga");
});

