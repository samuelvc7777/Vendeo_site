#!/usr/bin/env node
/**
 * scripts/test-dispatch-loop-real.mjs
 *
 * Teste regressivo de integração do loop REAL de dispatch de runBrainOrchestration:
 * Executa runBrainOrchestration de produção de ponta a ponta com dependências/mocks
 * controlados, provando que:
 * 1. O loop real `for (let bIndex = 0; bIndex < balloons.length; bIndex++)` executa;
 * 2. `checkOutboundActionDispatchPayload` executa sem nenhum ReferenceError;
 * 3. Chega nas boundaries de prepareExperimentalOutboxEntryAtomic / claimOutboxEntryAtomic;
 * 4. Meta é mockado com ZERO despacho para Meta real;
 * 5. Cobre cenários TEXT (2 balões), AUDIO (1 balão) e TEXT + AUDIO (sequência mista).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runBrainOrchestration } from "../supabase/functions/api/brain_orchestrator.ts";

function createMockSupabase(params = {}) {
  const { conversationRecord, personaAudios = [] } = params;
  const rpcCalls = [];

  const mock = {
    __mockPersonaAudios: personaAudios,
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
          : [];

      const queryResult = {
        data: defaultData,
        error: null,
      };

      const chainable = {
        ...queryResult,
        eq: () => chainable,
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
        insert: async (data) => ({ data, error: null }),
        upsert: () => chainable,
        update: () => chainable,
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
            entry: {
              status: "claimed_to_send",
            },
          },
          error: null,
        };
      }
      if (fnName === "claim_audio_delivery_reservation") {
        return { data: { claimed: true, reason: "claimed" }, error: null };
      }
      if (fnName === "commit_audio_delivery_sent") {
        return { data: { committed: true, reason: "committed" }, error: null };
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

  return { mock, rpcCalls };
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

test("CENÁRIO A — TEXT: loop REAL de runBrainOrchestration executa dispatch de 2 balões de texto sem ReferenceError", withAcceleratedTimers(async () => {
  const conversationId = "conv_dispatch_text_real";
  const correlationId = "corr_dispatch_text_real";

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

  const { mock: mockSupabase, rpcCalls } = createMockSupabase({ conversationRecord });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "oi Larissa, como vai?",
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
          tokens: 180,
          sessionId: "sess_mock_text_real",
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Plano mock com 2 balões de texto",
            responses: [
              "adoro viajar e curtir um tempo com a minha família",
              "e vc trabalha ou estuda com oq?",
            ],
            canonicalOutboundActions: [
              { type: "text", text: "adoro viajar e curtir um tempo com a minha família" },
              { type: "text", text: "e vc trabalha ou estuda com oq?" },
            ],
            outboundActions: [
              { type: "text", text: "adoro viajar e curtir um tempo com a minha família" },
              { type: "text", text: "e vc trabalha ou estuda com oq?" },
            ],
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 1,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 2,
            },
          },
        };
      },
    },
  });

  assert.equal(result.handled, true, "Ciclo deve ser tratado com sucesso");
  assert.equal(result.sentToMeta, true, "sentToMeta deve ser true");
  assert.equal(result.blockLegacyFallback, true, "Fallback legado deve ser bloqueado");

  // Prova que executou o loop real de dispatch de balões de ponta a ponta
  assert.equal(metaDispatches.length, 2, "Meta mock deve receber exatamente 2 balões");
  assert.equal(metaDispatches[0].text, "adoro viajar e curtir um tempo com a minha família");
  assert.equal(metaDispatches[1].text, "e vc trabalha ou estuda com oq?");

  // Prova de boundaries de outbox por balão
  const prepCalls = rpcCalls.filter((c) => c.fnName === "prepare_experimental_outbox_entry");
  const claimCalls = rpcCalls.filter((c) => c.fnName === "claim_outbox_entry" || c.fnName === "claim_outbox_entry_atomic");
  assert.equal(prepCalls.length, 2, "Deve preparar outbox para cada um dos 2 balões");
  assert.equal(claimCalls.length, 2, "Deve efetuar claim atômico de outbox para cada balão");

  // Prova de ausência de erros no trace
  assert.ok(result.trace?.includes("cycle_completed"), "Ciclo deve ser completado no trace");
  assert.ok(result.trace?.includes("dispatch_payload_source=decision.responses"), "Fonte deve ser decision.responses");
}));

test("CENÁRIO B — AUDIO: loop REAL de runBrainOrchestration executa dispatch de áudio sem ReferenceError", withAcceleratedTimers(async () => {
  const conversationId = "conv_dispatch_audio_real";
  const correlationId = "corr_dispatch_audio_real";

  const personaAudios = [
    {
      id: "aud_praia_hobbies",
      audio_id: "aud_praia_hobbies",
      audio_url: "https://example.com/aud_praia_hobbies.mp3",
      title: "Praia e hobbies",
      full_transcript: "eu adoro ir pra praia descansar e curtir o mar",
      transcript: "eu adoro ir pra praia descansar e curtir o mar",
      when_to_use: "quando perguntarem sobre praia ou hobbies",
      duration: 10,
      enabled: true,
    },
  ];

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
          goals: [{ id: "goal_hobbies", label: "Descobrir hobbies", required: true, status: "pending" }],
          currentObjective: { id: "goal_hobbies", label: "Descobrir hobbies" },
        },
      },
    },
  };

  const { mock: mockSupabase, rpcCalls } = createMockSupabase({ conversationRecord, personaAudios });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "vc curte praia?",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async (_sb, convId, text) => {
        metaDispatches.push({ convId, text });
        return { ok: true, message_id: `meta_msg_${metaDispatches.length}` };
      },
      callOpenAiAgent: async ({ executeTool }) => {
        if (typeof executeTool === "function") {
          await executeTool("cofre_audio_search", { query: "praia" });
        }
        return {
          tokens: 150,
          sessionId: "sess_mock_audio_real",
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Plano mock com áudio autorizado do cofre",
            responses: [],
            canonicalOutboundActions: [
              { type: "audio", audioId: "aud_praia_hobbies" },
            ],
            outboundActions: [
              { type: "audio", audioId: "aud_praia_hobbies" },
            ],
            missionPackage: {
              selectedAudioId: "aud_praia_hobbies",
              candidateAudios: [
                { audioId: "aud_praia_hobbies", title: "Praia e hobbies", transcript: "eu adoro ir pra praia descansar" },
              ],
            },
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

  assert.equal(result.handled, true, "Ciclo de áudio deve ser tratado com sucesso");
  assert.equal(result.sentToMeta, true, "sentToMeta deve ser true");

  // Prova de despacho do áudio
  assert.equal(metaDispatches.length, 1, "Meta mock deve receber exatamente 1 despacho de áudio");
  assert.equal(metaDispatches[0].text, "[audio:https://example.com/aud_praia_hobbies.mp3]");

  // Prova de reserva atômica de áudio e boundaries de outbox
  const audioReservations = rpcCalls.filter((c) => c.fnName === "claim_audio_delivery_reservation");
  const audioCommits = rpcCalls.filter((c) => c.fnName === "commit_audio_delivery_sent");
  assert.equal(audioReservations.length, 1, "Deve reservar o áudio atomicamente antes do dispatch");
  assert.equal(audioCommits.length, 1, "Deve confirmar o áudio enviado após o dispatch");

  assert.ok(result.trace?.includes("audio_claim_reserved: aud_praia_hobbies"), "Trace deve conter reserva de áudio");
  assert.ok(result.trace?.includes("audio_delivered: aud_praia_hobbies"), "Trace deve conter entrega de áudio");
}));

test("CENÁRIO C — TEXT + AUDIO: loop REAL sequencial prova isolamento e dispatch misto", withAcceleratedTimers(async () => {
  const conversationId = "conv_dispatch_mixed_real";
  const correlationId = "corr_dispatch_mixed_real";

  const personaAudios = [
    {
      id: "aud_hobbies_natureza",
      audio_id: "aud_hobbies_natureza",
      audio_url: "https://example.com/aud_hobbies_natureza.mp3",
      title: "Natureza",
      full_transcript: "eu adoro curtir a natureza",
      transcript: "eu adoro curtir a natureza",
      when_to_use: "falar de natureza",
      duration: 7,
      enabled: true,
    },
  ];

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
          goals: [{ id: "goal_interests", label: "Interesses", required: true, status: "pending" }],
          currentObjective: { id: "goal_interests", label: "Interesses" },
        },
      },
    },
  };

  const { mock: mockSupabase } = createMockSupabase({ conversationRecord, personaAudios });
  const metaDispatches = [];

  const result = await runBrainOrchestration({
    supabase: mockSupabase,
    conversationId,
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: "msg_inbound_test",
      text: "me conta o que vc gosta de fazer",
      sender: "user",
      timestamp: new Date().toISOString(),
    },
    runtime: {
      sendMetaTextMessage: async (_sb, convId, text) => {
        metaDispatches.push({ convId, text });
        return { ok: true, message_id: `meta_msg_${metaDispatches.length}` };
      },
      callOpenAiAgent: async ({ executeTool }) => {
        if (typeof executeTool === "function") {
          await executeTool("cofre_audio_search", { query: "natureza" });
        }
        return {
          tokens: 220,
          sessionId: "sess_mock_mixed_real",
          plan: {
            action: "reply",
            currentStage: "stage_1_conexao",
            objectiveDecision: "pursue",
            reasoning: "Plano mock com TEXT + AUDIO + TEXT",
            responses: [
              "minha rotina é bem corrida kkk",
              "mas e vc, me conta mais de vc!",
            ],
            canonicalOutboundActions: [
              { type: "text", text: "minha rotina é bem corrida kkk" },
              { type: "audio", audioId: "aud_hobbies_natureza" },
              { type: "text", text: "mas e vc, me conta mais de vc!" },
            ],
            outboundActions: [
              { type: "text", text: "minha rotina é bem corrida kkk" },
              { type: "audio", audioId: "aud_hobbies_natureza" },
              { type: "text", text: "mas e vc, me conta mais de vc!" },
            ],
            missionPackage: {
              selectedAudioId: "aud_hobbies_natureza",
              candidateAudios: [
                { audioId: "aud_hobbies_natureza", title: "Natureza", transcript: "eu adoro curtir a natureza" },
              ],
            },
            turnContract: {
              mustAnswerFirst: false,
              newQuestionBudget: 1,
              responseShape: "balanced",
              directQuestions: [],
              maxBalloons: 3,
            },
          },
        };
      },
    },
  });

  assert.equal(result.handled, true, "Ciclo misto deve ser tratado com sucesso");
  assert.equal(result.sentToMeta, true, "sentToMeta deve ser true");

  // Prova da sequência exata entregue à Meta mock: TEXT -> AUDIO -> TEXT
  assert.equal(metaDispatches.length, 3, "Meta mock deve receber exatamente 3 despachos");
  assert.equal(metaDispatches[0].text, "minha rotina é bem corrida kkk");
  assert.equal(metaDispatches[1].text, "[audio:https://example.com/aud_hobbies_natureza.mp3]");
  assert.equal(metaDispatches[2].text, "mas e vc, me conta mais de vc!");

  assert.ok(result.trace?.includes("audio_claim_reserved: aud_hobbies_natureza"));
  assert.ok(result.trace?.includes("audio_delivered: aud_hobbies_natureza"));
  assert.ok(result.trace?.includes("cycle_completed"));
}));
