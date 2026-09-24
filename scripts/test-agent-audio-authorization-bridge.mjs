#!/usr/bin/env node
/**
 * scripts/test-agent-audio-authorization-bridge.mjs
 *
 * Testes rigorosos da Bridge Canônica de Autorização de Áudio do OpenAI Agent:
 *
 * CENÁRIO A: Áudio escolhido ∈ candidatos -> autorizado, 1x reserva, dispatch mock executado com sucesso
 * CENÁRIO B: Áudio escolhido ∉ candidatos -> fail-closed, executor_audio_id_not_authorized, zero reserva, zero dispatch
 * CENÁRIO C: action=wait com outboundActions residual -> canonicalOutboundActions = [], zero reserva, zero dispatch
 * CENÁRIO D: Rejeição de integridade de áudio -> outboundActions limpo, zero reserva presa
 * CENÁRIO E: Reserva criada + abort comprovadamente pré-dispatch -> release_audio_delivery_reservation
 * CENÁRIO F: dispatch_uncertain -> NÃO libera a reserva automaticamente (fail-closed)
 * CENÁRIO G: Resincronização/Freshness: mensagem histórica com created_at recente não preempciona ciclo
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  runBrainOrchestration,
  checkFreshnessGate,
  releaseAudioDeliveryReservation,
} from "../supabase/functions/api/brain_orchestrator.ts";

function createMockSupabase(params = {}) {
  const { conversationRecord, personaAudios = [], deliveryHistory = [], newerMessages = [] } = params;
  const rpcCalls = [];
  const audioHistory = [...deliveryHistory];

  const mock = {
    __mockPersonaAudios: personaAudios,
    __mockAudioHistory: audioHistory,
    channel: () => ({
      send: async () => ({}),
      subscribe: () => ({}),
    }),
    from: (table) => {
      const defaultData =
        table === "persona_audios"
          ? personaAudios
          : table === "instagram_conversations"
          ? conversationRecord
          : table === "instagram_messages"
          ? newerMessages
          : table === "audio_delivery_history"
          ? audioHistory
          : [];

      const queryResult = {
        data: defaultData,
        error: null,
      };

      const chainable = {
        ...queryResult,
        eq: (col, val) => {
          if (table === "audio_delivery_history") {
            const filtered = audioHistory.filter((h) => h[col] === val);
            return {
              ...chainable,
              data: filtered,
              maybeSingle: async () => ({ data: filtered[0] || null, error: null }),
            };
          }
          return chainable;
        },
        in: () => chainable,
        order: () => chainable,
        limit: () => chainable,
        select: () => chainable,
        maybeSingle: async () => ({
          data:
            table === "instagram_conversations"
              ? conversationRecord
              : table === "persona_audios"
              ? personaAudios[0] || null
              : null,
          error: null,
        }),
        single: async () => ({
          data:
            table === "instagram_conversations"
              ? conversationRecord
              : table === "persona_audios"
              ? personaAudios[0] || null
              : null,
          error: null,
        }),
        then: (onfulfilled, onrejected) => Promise.resolve(queryResult).then(onfulfilled, onrejected),
      };

      return {
        select: () => chainable,
        insert: async (data) => {
          if (table === "audio_delivery_history") {
            audioHistory.push(data);
          }
          return { data, error: null };
        },
        upsert: () => chainable,
        update: (updates) => {
          return {
            eq: (_col1, val1) => ({
              eq: (_col2, val2) => {
                if (table === "audio_delivery_history") {
                  const entry = audioHistory.find((h) => h.conversation_id === val1 && h.audio_id === val2);
                  if (entry) Object.assign(entry, updates);
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        },
        delete: () => chainable,
      };
    },
    rpc: async (fnName, args) => {
      rpcCalls.push({ fnName, args });
      if (fnName === "ack_cycle_preemption_atomic" || fnName === "ack_experimental_cycle_preemption") {
        return { data: { acknowledged: true }, error: null };
      }
      if (fnName === "claim_experimental_cycle_messages_atomic" || fnName === "claim_experimental_cycle_messages") {
        return {
          data: {
            success: true,
            claimed_count: 1,
            claimed_ids: ["msg_inbound_test"],
            inbound_revision: 1,
          },
          error: null,
        };
      }
      if (fnName === "prepare_experimental_outbox_entry") {
        return {
          data: {
            success: true,
            reason: "prepared",
            outboxKey: args?.p_outbox_entry?.idempotencyKey,
          },
          error: null,
        };
      }
      if (fnName === "claim_outbox_entry_atomic" || fnName === "claim_outbox_entry") {
        return {
          data: {
            success: true,
            reason: "claimed",
            entry: { status: "claimed_to_send" },
          },
          error: null,
        };
      }
      if (fnName === "claim_audio_delivery_reservation") {
        const { p_conversation_id, p_audio_id, p_reservation_token, p_cycle_id } = args;
        const existing = audioHistory.find((h) => h.conversation_id === p_conversation_id && h.audio_id === p_audio_id);
        if (existing && existing.status === "sent") {
          return { data: { claimed: false, reason: "already_delivered" }, error: null };
        }
        if (existing && existing.status === "reserved" && existing.reservation_token === p_reservation_token) {
          return { data: { claimed: true, reason: "idempotent_reclaim", status: "reserved" }, error: null };
        }
        const record = {
          conversation_id: p_conversation_id,
          audio_id: p_audio_id,
          cycle_id: p_cycle_id,
          reservation_token: p_reservation_token,
          status: "reserved",
          reserved_at: new Date().toISOString(),
        };
        audioHistory.push(record);
        return { data: { claimed: true, reason: "reserved", status: "reserved" }, error: null };
      }
      if (fnName === "update_audio_delivery_status") {
        const { p_conversation_id, p_audio_id, p_reservation_token, p_status, p_error } = args;
        const entry = audioHistory.find((h) => h.conversation_id === p_conversation_id && h.audio_id === p_audio_id && h.reservation_token === p_reservation_token);
        if (entry) {
          entry.status = p_status;
          if (p_error) entry.last_error = p_error;
        }
        return { data: { success: true, status: p_status }, error: null };
      }
      if (fnName === "commit_audio_delivery_sent") {
        const { p_conversation_id, p_audio_id, p_reservation_token, p_provider_message_id } = args;
        const entry = audioHistory.find((h) => h.conversation_id === p_conversation_id && h.audio_id === p_audio_id && h.reservation_token === p_reservation_token);
        if (entry) {
          entry.status = "sent";
          entry.provider_message_id = p_provider_message_id;
        }
        return { data: { committed: true, reason: "committed" }, error: null };
      }
      if (fnName === "release_audio_delivery_reservation") {
        const { p_conversation_id, p_audio_id, p_reservation_token, p_reason } = args;
        const idx = audioHistory.findIndex((h) => h.conversation_id === p_conversation_id && h.audio_id === p_audio_id && h.reservation_token === p_reservation_token && h.status === "reserved");
        if (idx >= 0) {
          audioHistory.splice(idx, 1);
          return { data: { success: true, released: true, reason: p_reason }, error: null };
        }
        return { data: { success: false, released: false, reason: "not_found" }, error: null };
      }
      if (fnName === "commit_experimental_cycle_if_owned") {
        return { data: { committed: true, reason: "committed" }, error: null };
      }
      if (fnName === "release_experimental_cycle_if_owned") {
        return { data: { released: true, reason: "released" }, error: null };
      }
      return { data: { success: true }, error: null };
    },
  };

  return { mock, rpcCalls, audioHistory };
}

function withAcceleratedTimers(fn) {
  return async (...args) => {
    const realSetTimeout = globalThis.setTimeout;
    const origDateNow = Date.now;
    let virtualTime = origDateNow();

    Date.now = () => {
      virtualTime += 15000;
      return virtualTime;
    };
    globalThis.setTimeout = (callback) => setImmediate(callback);

    try {
      return await fn(...args);
    } finally {
      Date.now = origDateNow;
      globalThis.setTimeout = realSetTimeout;
    }
  };
}

const mockPersonaAudios = [
  {
    id: "aud_rotina_enfermagem",
    title: "Rotina de enfermagem e estágio",
    audioUrl: "https://storage.vendeo.com/audios/rotina_enfermagem.mp3",
    audio_url: "https://storage.vendeo.com/audios/rotina_enfermagem.mp3",
    transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio no hospital e as aulas de enfermagem.",
    full_transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio no hospital e as aulas de enfermagem.",
    usage_instruction: "Usar quando ele perguntar sobre a rotina da Larissa ou dia a dia.",
    when_to_use: "Usar quando ele perguntar sobre a rotina da Larissa ou dia a dia.",
    enabled: true,
  },
];

test("CENÁRIO A — áudio escolhido está autorizado (∈ candidatos do mesmo Turn)", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_authorized_a";
  const correlationId = "corr_audio_authorized_a";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "como é sua rotina?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async (_sb, convId, text) => {
        metaDispatches.push({ convId, text });
        return { ok: true, message_id: `meta_msg_${metaDispatches.length}` };
      },
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 220,
          sessionId: "sess_mock_audio_auth",
          telemetry: {
            authorizedCandidateAudios: [
              {
                audioId: "aud_rotina_enfermagem",
                title: "Rotina de enfermagem e estágio",
                transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio...",
                whenToUse: "Usar quando ele perguntar sobre a rotina da Larissa ou dia a dia.",
              },
            ],
            toolsRequested: ["cofre_audio_search"],
          },
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Respondendo sobre rotina via áudio autorizado",
            outboundActions: [
              { type: "audio", audioId: "aud_rotina_enfermagem" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  if (!result.sentToMeta) {
    console.error("DIAGNOSTICO CENARIO A TRACE:", result.trace);
  }
  // Validações determinísticas
  assert.equal(result.handled, true, "Ciclo deve ser completado com sucesso");
  assert.equal(result.sentToMeta, true, "sentToMeta deve ser true");

  // Prova 1: ZERO executor_audio_id_not_authorized no trace
  assert.ok(!result.trace?.some((t) => t.includes("executor_audio_rejected")), "NÃO deve rejeitar áudio autorizado");
  assert.ok(!result.trace?.some((t) => t.includes("executor_audio_id_not_authorized")), "ZERO executor_audio_id_not_authorized");

  // Prova 2: Reserva de áudio executada 1x
  const claimAudioCalls = rpcCalls.filter((c) => c.fnName === "claim_audio_delivery_reservation");
  assert.equal(claimAudioCalls.length, 1, "claim_audio_delivery_reservation deve ser chamado exatamente 1x");
  assert.equal(claimAudioCalls[0].args.p_audio_id, "aud_rotina_enfermagem");

  // Prova 3: Chega até a outbox e o dispatch mock
  const commitAudioCalls = rpcCalls.filter((c) => c.fnName === "commit_audio_delivery_sent");
  assert.equal(commitAudioCalls.length, 1, "commit_audio_delivery_sent deve ser chamado após entrega mockada");
  assert.equal(metaDispatches.length, 1, "Mock Meta deve receber exatamente 1 dispatch");
  assert.ok(metaDispatches[0].text.startsWith("[audio:"), "Payload despachado deve ser um áudio");

  // Prova 4: Histórico reflete sent
  assert.equal(audioHistory[0]?.status, "sent", "Status do áudio no histórico deve ser sent");
}));

test("CENÁRIO B — áudio escolhido NÃO está autorizado (∉ candidatos do mesmo Turn)", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_unauthorized_b";
  const correlationId = "corr_audio_unauthorized_b";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "como é sua rotina?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async (_sb, convId, text) => {
        metaDispatches.push({ convId, text });
        return { ok: true, message_id: `meta_msg_${metaDispatches.length}` };
      },
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 220,
          sessionId: "sess_mock_audio_unauth",
          telemetry: {
            authorizedCandidateAudios: [
              {
                audioId: "aud_rotina_enfermagem",
                title: "Rotina de enfermagem e estágio",
                transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio...",
                whenToUse: "Usar quando ele perguntar sobre a rotina da Larissa ou dia a dia.",
              },
            ],
            toolsRequested: ["cofre_audio_search"],
          },
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Tentando usar áudio fake não retornado",
            outboundActions: [
              { type: "audio", audioId: "audio_test_fake" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  // Validações determinísticas
  assert.equal(result.sentToMeta, false, "NENHUM envio para a Meta quando áudio não autorizado");

  // Prova 1: executor_audio_rejected: executor_audio_id_not_authorized registrado no trace
  assert.ok(result.trace?.includes("executor_audio_rejected: executor_audio_id_not_authorized"), "Deve rejeitar áudio não autorizado");

  // Prova 2: ZERO reservation
  const claimAudioCalls = rpcCalls.filter((c) => c.fnName === "claim_audio_delivery_reservation");
  assert.equal(claimAudioCalls.length, 0, "ZERO chamadas de claim_audio_delivery_reservation");
  assert.equal(audioHistory.length, 0, "Nenhuma reserva no banco");

  // Prova 3: ZERO dispatch
  assert.equal(metaDispatches.length, 0, "ZERO dispatch para Meta");
}));

test("CENÁRIO C — wait com outboundActions residual", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_wait_c";
  const correlationId = "corr_audio_wait_c";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "mensagem aleatória",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async (_sb, convId, text) => {
        metaDispatches.push({ convId, text });
        return { ok: true, message_id: `meta_msg_${metaDispatches.length}` };
      },
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 150,
          sessionId: "sess_mock_wait_residual",
          telemetry: {},
          plan: {
            action: "wait",
            currentStage: "stage_1_conexao",
            objectiveDecision: "defer",
            reasoning: "Esperando pretendente falar mais",
            // Residual indevido com áudio em ação wait
            outboundActions: [
              { type: "audio", audioId: "aud_rotina_enfermagem" },
            ],
          },
        };
      },
    },
  });

  // Validações determinísticas
  assert.equal(result.sentToMeta, false, "ZERO envio para Meta quando action=wait");

  // Prova: canonicalOutboundActions=[] -> ZERO reserva, ZERO outbox, ZERO dispatch
  const claimAudioCalls = rpcCalls.filter((c) => c.fnName === "claim_audio_delivery_reservation");
  assert.equal(claimAudioCalls.length, 0, "ZERO reserva chamada quando action=wait");
  assert.equal(audioHistory.length, 0, "ZERO registro de histórico");
  assert.equal(metaDispatches.length, 0, "ZERO despacho para Meta");
  assert.ok(result.trace?.includes("cycle_completed_wait"), "Ciclo deve completar em wait");
}));

test("CENÁRIO D — Rejeição de integridade limpa outboundActions e não deixa reserva presa", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_integrity_d";
  const correlationId = "corr_audio_integrity_d";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "como é seu dia?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async () => ({ ok: true, message_id: "m1" }),
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 200,
          sessionId: "sess_mock_integ_d",
          telemetry: {
            authorizedCandidateAudios: [], // Sem candidatos autorizados no Turn
            toolsRequested: [],
          },
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Tentativa de áudio não autorizado",
            outboundActions: [
              { type: "audio", audioId: "aud_rotina_enfermagem" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  assert.equal(result.sentToMeta, false);
  assert.ok(result.trace?.includes("executor_audio_rejected: executor_audio_id_not_authorized"));

  // Nenhuma reserva deve ter sido feita
  const claimCalls = rpcCalls.filter((c) => c.fnName === "claim_audio_delivery_reservation");
  assert.equal(claimCalls.length, 0, "Nenhuma reserva pode ser feita se audioIntegrity rejeitou");
  assert.equal(audioHistory.length, 0, "audioHistory deve estar vazio");
}));

test("CENÁRIO E — Reserva criada + abort comprovadamente pré-dispatch libera reserva via release_audio_delivery_reservation", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_abort_e";
  const correlationId = "corr_audio_abort_e";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });

  // Simula aborto durante prepare_experimental_outbox_entry (falha comprovada pré-dispatch)
  const originalRpc = mockSupabase.rpc;
  mockSupabase.rpc = async (fnName, args) => {
    if (fnName === "prepare_experimental_outbox_entry") {
      return { data: { success: false, reason: "mock_db_failure_pre_dispatch" }, error: null };
    }
    return originalRpc(fnName, args);
  };

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "como é seu dia?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async () => ({ ok: true, message_id: "m1" }),
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 200,
          sessionId: "sess_mock_abort_e",
          telemetry: {
            authorizedCandidateAudios: [
              {
                audioId: "aud_rotina_enfermagem",
                title: "Rotina de enfermagem",
                transcript: "Meu dia a dia é bem corrido...",
                whenToUse: "Quando perguntar de rotina",
              },
            ],
            toolsRequested: ["cofre_audio_search"],
          },
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Tentativa de áudio",
            outboundActions: [
              { type: "audio", audioId: "aud_rotina_enfermagem" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  assert.equal(result.sentToMeta, false, "Zero envio para Meta");

  // Deve ter chamado release_audio_delivery_reservation
  const releaseCalls = rpcCalls.filter((c) => c.fnName === "release_audio_delivery_reservation");
  assert.equal(releaseCalls.length, 1, "Deve chamar release_audio_delivery_reservation");
  assert.equal(releaseCalls[0].args.p_audio_id, "aud_rotina_enfermagem");
  assert.equal(releaseCalls[0].args.p_reservation_token, correlationId);

  // Status não permanece 'reserved'
  assert.equal(audioHistory.length, 0, "Reserva foi removida do banco mock");
}));

test("CENÁRIO F — dispatch_uncertain NÃO libera reserva automaticamente (preserva fail-closed)", withAcceleratedTimers(async () => {
  const conversationId = "conv_audio_uncertain_f";
  const correlationId = "corr_audio_uncertain_f";

  const conversationRecord = {
    id: conversationId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      active_cycle_token: correlationId,
      cancel_current_cycle: false,
      orchestration: {
        currentStageId: "stage_1_conexao",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        stageChecklist: {
          goals: [{ id: "goal_age", label: "Descobrir idade", required: true, status: "pending" }],
          currentObjective: { id: "goal_age", label: "Descobrir idade" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls, audioHistory } = createMockSupabase({
    conversationRecord,
    personaAudios: mockPersonaAudios,
  });

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "como é seu dia?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      // Simula incerteza de rede durante dispatch (ex: timeout HTTP Meta)
      sendMetaTextMessage: async () => {
        const err = new Error("Gateway timeout na Meta");
        err.name = "TimeoutError";
        throw err;
      },
      callOpenAiAgent: async () => {
        return {
          success: true,
          tokens: 200,
          sessionId: "sess_mock_uncertain_f",
          telemetry: {
            authorizedCandidateAudios: [
              {
                audioId: "aud_rotina_enfermagem",
                title: "Rotina de enfermagem",
                transcript: "Meu dia a dia é bem corrido...",
                whenToUse: "Quando perguntar de rotina",
              },
            ],
            toolsRequested: ["cofre_audio_search"],
          },
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Tentativa de áudio",
            outboundActions: [
              { type: "audio", audioId: "aud_rotina_enfermagem" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 0,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  // NÃO deve liberar a reserva
  const releaseCalls = rpcCalls.filter((c) => c.fnName === "release_audio_delivery_reservation");
  assert.equal(releaseCalls.length, 0, "NÃO deve liberar reserva em dispatch_uncertain");

  // O áudio no histórico deve ter status dispatch_uncertain
  const entry = audioHistory.find((h) => h.audio_id === "aud_rotina_enfermagem");
  assert.ok(entry, "Registro deve existir no histórico");
  assert.equal(entry.status, "dispatch_uncertain", "Status deve ser dispatch_uncertain");
}));

test("CENÁRIO G — Resincronização: mensagem histórica com created_at recente não preempciona ciclo", async () => {
  const conversationId = "conv_resync_freshness";
  const cycleStartedAt = "2026-09-24T00:17:00.000Z";

  // Mensagem sincronizada agora (created_at recente), mas enviada pelo pretendente há 2 dias (timestamp antigo)
  const historicalMessageSyncedNow = {
    id: "msg_historical_1",
    is_mine: false,
    sender_id: "pretendente_123",
    text: "mensagem de 2 dias atras",
    timestamp: "2026-09-22T10:00:00.000Z", // Antiga!
    created_at: "2026-09-24T00:17:05.000Z", // Inserida durante o sync agora!
    direction: "inbound",
  };

  const { mock: mockSupabase } = createMockSupabase({
    newerMessages: [historicalMessageSyncedNow],
  });

  const freshness = await checkFreshnessGate({
    supabase: mockSupabase,
    conversationId,
    claimedMessageIds: [],
    cycleStartedAt,
    initialInboundRevision: 0,
  });

  // A mensagem histórica NÃO deve ser considerada nova/fresca a ponto de invalidar o ciclo
  assert.equal(freshness.isFresh, true, "Gate deve permanecer fresh para mensagem histórica");
  assert.equal(freshness.newerInboundCount, 0, "newerInboundCount deve ser 0");
});
