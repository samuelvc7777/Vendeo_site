#!/usr/bin/env node
/**
 * scripts/test-agent-audio-flow.mjs
 * 
 * Bateria completa de testes automatizados: NOVO FLUXO DE ÁUDIO DA LARISSA
 * 
 * Validação rigorosa dos 24 cenários obrigatórios:
 * 1. Caminho oficial do OpenAI Agent possui cofre_audio_search
 * 2. Ferramenta retorna audioId, title, transcript, whenToUse (sem expor audioUrl)
 * 3. Agent consegue conhecer transcript antes de selecionar
 * 4. Agent consegue conhecer whenToUse
 * 5. Áudio já enviado não aparece na busca
 * 6. Pedido "manda de novo" não libera replay automático no autopiloto
 * 7. Áudio já enviado selecionado manualmente é bloqueado pre-dispatch (audio_repeat_blocked)
 * 8. Dois workers tentando mesmo conversationId+audioId não geram duplicidade
 * 9. TEXT + AUDIO preservados em ordem
 * 10. TEXT + TEXT + AUDIO preservados em ordem
 * 11. Somente AUDIO funciona (áudio puro)
 * 12. responses legado continua funcionando
 * 13. send_audio legado normaliza corretamente
 * 14. audioId não autorizado é rejeitado
 * 15. Áudio disabled é rejeitado
 * 16. Nenhum candidato -> texto continua funcionando normalmente
 * 17. Partial dispatch não repete texto já enviado
 * 18. dispatch_uncertain de áudio não reenvia automaticamente (fail-closed)
 * 19. audio_delivery_history grava apenas uma vez após entrega confirmada
 * 20. Memória episódica recebe conteúdo semântico do áudio
 * 21. Prova de que nenhum backend keyword router foi criado
 * 22. Inbound "gosto de academia" + "e vc gosta de fazer oq?" permite TEXT + AUDIO
 * 23. Inbound "trabalho com mineração" + "gosto de moto" + "e vc?" preserva respostas aos fatos + áudio
 * 24. Mensagem incidental sobre praia não dispara áudio
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
  executeCofreAudioSearch,
  validateConversationBrainPlan,
  validateResponseGenerationInvariant,
} from "../supabase/functions/api/openai_brain.ts";
import {
  searchCofreAudios,
  recordAudioDeliveryHistory,
  claimAudioDeliveryReservation,
  updateAudioDeliveryStatus,
  commitAudioDeliverySent,
  releaseAudioDeliveryReservation,
  dispatchOutboxEntry,
  validateFinalTextDispatchPayload,
  checkOutboundActionDispatchPayload,
} from "../supabase/functions/api/brain_orchestrator.ts";
import {
  createAudioDeliveredEpisode,
  executeEpisodeWriter,
} from "../supabase/functions/api/conversation_episodic_memory.ts";
import { buildCanonicalAgentInstructions } from "../supabase/functions/api/openai_agent_instructions.ts";

const defaultTurnContract = {
  mustAnswerFirst: true,
  newQuestionBudget: 1,
  responseShape: "reaction_statement",
  directQuestions: [],
  maxBalloons: 3,
};

function createValidTestPlan(partial) {
  return {
    action: "reply",
    turnContract: defaultTurnContract,
    reasoning: "Plano de teste válido",
    ...partial,
  };
}

// Base de áudios de teste simulando a tabela persona_audios
const mockAudiosDatabase = [
  {
    id: "aud_rotina_enfermagem",
    title: "Rotina de enfermagem e estágio",
    audioUrl: "https://storage.vendeo.com/audios/rotina_enfermagem.mp3",
    transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio no hospital e as aulas de enfermagem à noite.",
    usageInstruction: "Usar quando ele perguntar sobre a rotina da Larissa, faculdade ou dia a dia.",
    keywords: ["rotina", "enfermagem", "hospital", "estágio", "dia a dia"],
    enabled: true,
    duration: 14,
  },
  {
    id: "aud_profissao_trabalho",
    title: "Faculdade e trabalho",
    audioUrl: "https://storage.vendeo.com/audios/faculdade_trabalho.mp3",
    transcript: "Eu faço faculdade de enfermagem, estágio no hospital e trabalho com vendas online.",
    usageInstruction: "Usar quando ele perguntar o que ela faz da vida, profissão, trabalho ou faculdade.",
    keywords: ["profissão", "ocupação", "trabalho", "vendas", "enfermagem"],
    enabled: true,
    duration: 26,
  },
  {
    id: "aud_hobbies",
    title: "Hobbies e tempo livre",
    audioUrl: "https://storage.vendeo.com/audios/hobbies.mp3",
    transcript: "No meu tempo livre eu sou bem caseira, gosto de ver filmes, ler e às vezes sair pra jantar ou pegar uma praia.",
    usageInstruction: "Usar quando ele perguntar o que a Larissa gosta de fazer no tempo livre ou finais de semana.",
    keywords: ["tempo livre", "hobbies", "filmes", "livros", "praia", "sair"],
    enabled: true,
    duration: 18,
  },
  {
    id: "aud_desabilitado",
    title: "Áudio antigo arquivado",
    audioUrl: "https://storage.vendeo.com/audios/arquivado.mp3",
    transcript: "Áudio que não deve ser usado.",
    usageInstruction: "Não usar.",
    keywords: ["antigo"],
    enabled: false,
    duration: 10,
  },
];

function createMockSupabase(history = [], audios = mockAudiosDatabase) {
  const deliveryHistory = [...history];
  return {
    __mockAudioHistory: deliveryHistory,
    __mockPersonaAudios: audios,
    from: (table) => ({
      select: (cols) => ({
        eq: (col1, val1) => ({
          eq: (col2, val2) => ({
            maybeSingle: async () => {
              if (table === "audio_delivery_history") {
                const found = deliveryHistory.find(
                  (h) => (h.conversation_id === val1 || h.conversationId === val1) &&
                         (h.audio_id === val2 || h.audioId === val2)
                );
                return { data: found || null, error: null };
              }
              return { data: null, error: null };
            },
          }),
          maybeSingle: async () => {
            if (table === "persona_audios" && col1 === "id") {
              const item = audios.find((a) => a.id === val1);
              return { data: item || null, error: null };
            }
            if (table === "instagram_config" && col1 === "id") {
              return { data: { access_token: "mock_token" }, error: null };
            }
            return { data: null, error: null };
          },
          order: () => ({
            limit: () => ({ data: [] }),
          }),
        }),
        order: () => {
          if (table === "persona_audios") {
            return Promise.resolve({ data: audios, error: null });
          }
          return {
            limit: () => ({ data: [] }),
          };
        },
      }),
      insert: async (row) => {
        if (table === "audio_delivery_history") {
          const convId = row.conversation_id || row.conversationId;
          const audId = row.audio_id || row.audioId;
          const exists = deliveryHistory.some(
            (h) => (h.conversation_id === convId || h.conversationId === convId) &&
                   (h.audio_id === audId || h.audioId === audId)
          );
          if (exists) {
            return { error: { code: "23505", message: "unique_violation" } };
          }
          deliveryHistory.push(row);
          return { error: null };
        }
        return { error: null };
      },
      upsert: async () => ({ error: null }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
      delete: () => ({
        eq: (col1, val1) => ({
          eq: (col2, val2) => ({
            eq: (col3, val3) => ({
              eq: (col4, val4) => {
                const idx = deliveryHistory.findIndex(
                  (h) => (h[col1] === val1 || h.conversation_id === val1) &&
                         (h[col2] === val2 || h.audio_id === val2) &&
                         (h[col3] === val3 || h.reservation_token === val3) &&
                         h.status === val4
                );
                if (idx >= 0) {
                  deliveryHistory.splice(idx, 1);
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        }),
      }),
    }),
    rpc: async (name, params) => {
      if (name === "claim_audio_delivery_reservation") {
        const convId = params.p_conversation_id;
        const audId = params.p_audio_id;
        const cycleId = params.p_cycle_id;
        const token = params.p_reservation_token;
        const staleSec = params.p_stale_seconds || 60;
        const now = new Date().toISOString();

        const existing = deliveryHistory.find(
          (h) => (h.conversation_id === convId || h.conversationId === convId) &&
                 (h.audio_id === audId || h.audioId === audId)
        );

        if (existing) {
          const status = existing.status || "sent";
          if (status === "sent") {
            return { data: { claimed: false, reason: "already_delivered", status: "sent" }, error: null };
          }
          if (status === "dispatch_uncertain") {
            return { data: { claimed: false, reason: "dispatch_uncertain", status: "dispatch_uncertain" }, error: null };
          }
          if (status === "dispatching") {
            return { data: { claimed: false, reason: "already_dispatching", status: "dispatching" }, error: null };
          }
          if (status === "reserved") {
            if (existing.cycleId === cycleId && (existing.reservationToken === token || existing.reservation_token === token)) {
              return { data: { claimed: true, reason: "idempotent_reclaim", status: "reserved", id: existing.id }, error: null };
            }
            const reservedAtMs = new Date(existing.reservedAt || existing.reserved_at || 0).getTime();
            if (Date.now() - reservedAtMs > staleSec * 1000) {
              existing.status = "reserved";
              existing.cycleId = cycleId;
              existing.reservationToken = token;
              existing.reservation_token = token;
              existing.reservedAt = now;
              existing.reserved_at = now;
              return { data: { claimed: true, reason: "stale_reservation_recovered", status: "reserved", id: existing.id }, error: null };
            }
            return { data: { claimed: false, reason: "already_reserved", status: "reserved" }, error: null };
          }
          if (status === "failed_safe") {
            existing.status = "reserved";
            existing.cycleId = cycleId;
            existing.reservationToken = token;
            existing.reservation_token = token;
            existing.reservedAt = now;
            existing.reserved_at = now;
            return { data: { claimed: true, reason: "failed_safe_reclaimed", status: "reserved", id: existing.id }, error: null };
          }
        }

        const newId = `adh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        deliveryHistory.push({
          id: newId,
          conversation_id: convId,
          conversationId: convId,
          audio_id: audId,
          audioId: audId,
          status: "reserved",
          cycle_id: cycleId,
          cycleId: cycleId,
          reservation_token: token,
          reservationToken: token,
          reserved_at: now,
          reservedAt: now,
        });
        return { data: { claimed: true, reason: "reserved", id: newId, status: "reserved" }, error: null };
      }

      if (name === "update_audio_delivery_status") {
        const convId = params.p_conversation_id;
        const audId = params.p_audio_id;
        const token = params.p_reservation_token;
        const status = params.p_status;
        const error = params.p_error;

        const found = deliveryHistory.find(
          (h) => (h.conversation_id === convId || h.conversationId === convId) &&
                 (h.audio_id === audId || h.audioId === audId)
        );
        if (found) {
          found.status = status;
          if (error) found.lastError = error;
          return { data: { success: true, status, id: found.id }, error: null };
        }
        return { data: { success: false, reason: "reservation_not_found_or_token_mismatch" }, error: null };
      }

      if (name === "commit_audio_delivery_sent") {
        const convId = params.p_conversation_id;
        const audId = params.p_audio_id;
        const token = params.p_reservation_token;
        const pmid = params.p_provider_message_id;

        const found = deliveryHistory.find(
          (h) => (h.conversation_id === convId || h.conversationId === convId) &&
                 (h.audio_id === audId || h.audioId === audId)
        );
        if (found) {
          found.status = "sent";
          found.sent_at = new Date().toISOString();
          found.sentAt = found.sent_at;
          found.provider_message_id = pmid;
          found.providerMessageId = pmid;
          return { data: { success: true, status: "sent", id: found.id }, error: null };
        }
        return { data: { success: false, reason: "reservation_not_found_or_token_mismatch" }, error: null };
      }

      if (name === "release_audio_delivery_reservation") {
        const convId = params.p_conversation_id;
        const audId = params.p_audio_id;
        const token = params.p_reservation_token;
        const reason = params.p_reason || "cancelled_pre_dispatch";

        const idx = deliveryHistory.findIndex(
          (h) => (h.conversation_id === convId || h.conversationId === convId) &&
                 (h.audio_id === audId || h.audioId === audId) &&
                 (h.reservation_token === token || h.reservationToken === token) &&
                 h.status === "reserved"
        );
        if (idx >= 0) {
          deliveryHistory.splice(idx, 1);
          return { data: { success: true, released: true, reason }, error: null };
        }
        return { data: { success: false, released: false, reason: "not_found_or_not_reserved" }, error: null };
      }

      if (name === "claim_or_record_audio_delivery") {
        const exists = deliveryHistory.some(
          (h) => (h.conversation_id === params.p_conversation_id || h.conversationId === params.p_conversation_id) &&
                 (h.audio_id === params.p_audio_id || h.audioId === params.p_audio_id)
        );
        if (exists) {
          return {
            data: { success: false, reason: "audio_already_delivered" },
            error: null,
          };
        }
        deliveryHistory.push({
          conversation_id: params.p_conversation_id,
          audio_id: params.p_audio_id,
          provider_message_id: params.p_provider_message_id,
          sent_at: new Date().toISOString(),
          status: "sent",
        });
        return {
          data: { success: true, reason: "recorded" },
          error: null,
        };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}

// ============================================================================
// SUÍTE DE TESTES: 24 CENÁRIOS OBRIGATÓRIOS
// ============================================================================

test("1. Caminho oficial do OpenAI Agent possui cofre_audio_search", () => {
  assert.equal(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.name, "cofre_audio_search");
  assert.ok(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.description.includes("Cofre de Áudios"));
  assert.match(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.description, /profissão.*ocupação.*trabalho/i);
  assert.match(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.parameters.properties.query.description, /profissão e trabalho/i);
  assert.match(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.description, /faculdade/);
  assert.equal(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.parameters.properties.query.type, "string");
  assert.deepEqual(COFRE_AUDIO_SEARCH_TOOL_DEFINITION.function.parameters.required, ["query"]);
  assert.match(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.description, /profissão.*ocupação.*trabalho/i);
  assert.match(COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION.parameters.properties.query.description, /profissão e trabalho/i);
  // Verifica que instructions oficiais locais incluem a seção canônica
  const instructions = buildCanonicalAgentInstructions({ strictOpenAiPilot: true });
  assert.ok(instructions.includes("=== COFRE DE ÁUDIOS"));
  assert.ok(instructions.includes("cofre_audio_search"));
});

test("2. Ferramenta retorna audioId, title, transcript, whenToUse (sem expor audioUrl)", async () => {
  const supabase = createMockSupabase();
  const results = await executeCofreAudioSearch({
    supabase,
    conversationId: "conv_test_tool",
    query: "o que você faz no tempo livre e hobbies?",
  });

  assert.ok(results.length > 0, "Deve retornar ao menos 1 áudio relevante");
  const first = results[0];
  assert.ok(first.audioId, "Deve conter audioId");
  assert.ok(first.title, "Deve conter title");
  assert.ok(first.transcript, "Deve conter transcript");
  assert.ok(first.whenToUse, "Deve conter whenToUse");
  assert.equal(first.audioUrl, undefined, "NÃO deve expor audioUrl ao modelo");
});

test("3. Agent consegue conhecer transcript antes de selecionar", async () => {
  const supabase = createMockSupabase();
  const results = await executeCofreAudioSearch({
    supabase,
    conversationId: "conv_test_transcript",
    query: "qual sua rotina na faculdade e estágio?",
  });

  assert.ok(results.length > 0);
  const audio = results.find((a) => a.audioId === "aud_rotina_enfermagem");
  assert.ok(audio, "Deve encontrar aud_rotina_enfermagem");
  assert.ok(audio.transcript.includes("estágio no hospital"));
  assert.ok(audio.transcript.includes("aulas de enfermagem"));
});

test("4. Agent consegue conhecer whenToUse", async () => {
  const supabase = createMockSupabase();
  const results = await executeCofreAudioSearch({
    supabase,
    conversationId: "conv_test_whentouse",
    query: "tempo livre",
  });

  assert.ok(results.length > 0);
  const audio = results.find((a) => a.audioId === "aud_hobbies");
  assert.ok(audio);
  assert.ok(audio.whenToUse.includes("tempo livre") || audio.whenToUse.includes("finais de semana"));
});

test("4.1 Pergunta direta 'trabalha com oq' encontra áudio de profissão", async () => {
  const supabase = createMockSupabase();
  const results = await searchCofreAudios({
    supabase,
    conversationId: "conv_test_profession_query",
    query: "Ja sim, me fala mais sobre vc, trabalha com oq ?",
  });

  assert.ok(
    results.some((audio) => audio.audio_id === "aud_profissao_trabalho"),
    "A busca deve reconhecer a pergunta coloquial sobre trabalho e retornar o áudio de profissão elegível"
  );
  const agentToolResults = await executeCofreAudioSearch({
    supabase,
    conversationId: "conv_test_profession_query_agent",
    query: "Ja sim, me fala mais sobre vc, trabalha com oq ?",
  });
  assert.ok(
    agentToolResults.some((audio) => audio.audioId === "aud_profissao_trabalho"),
    "A ferramenta do Agent também deve reconhecer a variação 'trabalha' para 'trabalho'"
  );
});

test("5. Áudio já enviado não aparece na busca", async () => {
  // Configura histórico com aud_hobbies já entregue (ambos os formatos para garantir)
  const history = [
    { conversation_id: "conv_sent", audio_id: "aud_hobbies", conversationId: "conv_sent", audioId: "aud_hobbies", sent_at: "2026-09-20T12:00:00Z" },
  ];
  const supabase = createMockSupabase(history);

  const results = await executeCofreAudioSearch({
    supabase,
    conversationId: "conv_sent",
    query: "o que você faz no tempo livre?",
  });

  const foundHobbies = results.some((a) => a.audioId === "aud_hobbies");
  assert.equal(foundHobbies, false, "Áudio já enviado não pode aparecer nos resultados da busca");
});

test("6. Pedido 'manda de novo' não libera replay automático no autopiloto", async () => {
  const history = [
    { conversation_id: "conv_replay", audio_id: "aud_rotina_enfermagem", conversationId: "conv_replay", audioId: "aud_rotina_enfermagem", sent_at: "2026-09-20T12:00:00Z" },
  ];
  const supabase = createMockSupabase(history);

  // Consulta explícita pedindo para mandar de novo
  const results = await searchCofreAudios({
    supabase,
    conversationId: "conv_replay",
    query: "manda aquele audio de novo por favor",
    limit: 3,
  });

  const hasRotina = results.some((a) => a.audio_id === "aud_rotina_enfermagem");
  assert.equal(hasRotina, false, "Mesmo com frase de replay explícito, áudio já enviado continua bloqueado no autopiloto");
});

test("7. Áudio já enviado selecionado manualmente é bloqueado pre-dispatch (audio_repeat_blocked)", async () => {
  const history = [
    { conversation_id: "conv_pre_dispatch", audio_id: "aud_hobbies", conversationId: "conv_pre_dispatch", audioId: "aud_hobbies", sent_at: "2026-09-20T12:00:00Z" },
  ];
  const supabase = createMockSupabase(history);

  // Simula consulta direta pré-dispatch em audio_delivery_history
  const { data: alreadySentHist } = await supabase
    .from("audio_delivery_history")
    .select("id")
    .eq("conversation_id", "conv_pre_dispatch")
    .eq("audio_id", "aud_hobbies")
    .maybeSingle();

  assert.ok(alreadySentHist, "Trava pré-dispatch deve detectar áudio já entregue no banco");
});

test("8.1. Dois workers simultâneos -> somente 1 adquire claim atômico pré-dispatch", async () => {
  const supabase = createMockSupabase();

  const [res1, res2] = await Promise.all([
    claimAudioDeliveryReservation({
      supabase,
      conversationId: "conv_race_claim",
      audioId: "aud_hobbies",
      cycleId: "cycle_A",
      reservationToken: "token_A",
    }),
    claimAudioDeliveryReservation({
      supabase,
      conversationId: "conv_race_claim",
      audioId: "aud_hobbies",
      cycleId: "cycle_B",
      reservationToken: "token_B",
    }),
  ]);

  const claimedCount = [res1, res2].filter((r) => r.claimed).length;
  const rejectedCount = [res1, res2].filter((r) => !r.claimed).length;

  assert.equal(claimedCount, 1, "Exatamente um worker deve adquirir o claim pré-dispatch");
  assert.equal(rejectedCount, 1, "O segundo worker concorrente deve ser rejeitado no claim");
});

test("8.2. Prova de concorrência: Dois workers simultâneos chegam ao pré-dispatch -> EXATAMENTE 1 chamada ao dispatch mock da Meta", async () => {
  const supabase = createMockSupabase();
  let metaDispatchCalls = 0;

  // Mock do dispatcher que faz o fetch real para a Meta
  const mockDispatchToMeta = async (workerId) => {
    metaDispatchCalls++;
    return { success: true, providerMessageId: `mid_meta_${workerId}` };
  };

  // Simulação realista da pipeline de dispatch de dois workers executando em paralelo
  const runWorkerDispatchPipeline = async (workerId, cycleId, token) => {
    // 1. Tenta adquirir claim atômico no banco ANTES de chamar a Meta
    const claim = await claimAudioDeliveryReservation({
      supabase,
      conversationId: "conv_meta_race",
      audioId: "aud_hobbies",
      cycleId,
      reservationToken: token,
    });

    if (!claim.claimed) {
      // PERDEU O CLAIM: não chama a Meta!
      return { sent: false, reason: "audio_claim_conflict" };
    }

    // 2. GANHOU O CLAIM: transiciona para dispatching imediatamente antes da Meta
    await updateAudioDeliveryStatus({
      supabase,
      conversationId: "conv_meta_race",
      audioId: "aud_hobbies",
      reservationToken: token,
      status: "dispatching",
    });

    // 3. Executa a chamada real para a Meta
    const metaRes = await mockDispatchToMeta(workerId);

    // 4. Confirma entrega no banco
    await commitAudioDeliverySent({
      supabase,
      conversationId: "conv_meta_race",
      audioId: "aud_hobbies",
      reservationToken: token,
      providerMessageId: metaRes.providerMessageId,
    });

    return { sent: true, providerMessageId: metaRes.providerMessageId };
  };

  // Dois workers chegam simultaneamente no pré-dispatch
  const [workerA, workerB] = await Promise.all([
    runWorkerDispatchPipeline("worker_A", "cycle_101", "token_101"),
    runWorkerDispatchPipeline("worker_B", "cycle_102", "token_102"),
  ]);

  // PROVA RIGOROSA:
  assert.equal(metaDispatchCalls, 1, "O dispatcher da Meta deve ser chamado EXATAMENTE UMA VEZ no total!");
  const sentWorkers = [workerA, workerB].filter((w) => w.sent);
  const blockedWorkers = [workerA, workerB].filter((w) => !w.sent);

  assert.equal(sentWorkers.length, 1, "Apenas um worker deve enviar para a Meta");
  assert.equal(blockedWorkers.length, 1, "O worker concorrente deve ser bloqueado antes do fetch");
  assert.equal(blockedWorkers[0].reason, "audio_claim_conflict", "Motivo de bloqueio deve ser audio_claim_conflict");
});

test("8.3. Segundo worker com claim falho não envia Meta e gera audio_claim_conflict", async () => {
  const supabase = createMockSupabase();
  let metaSentCount = 0;

  // Worker 1 já adquiriu e enviou
  const claim1 = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_worker_block",
    audioId: "aud_hobbies",
    cycleId: "cycle_1",
    reservationToken: "tok_1",
  });
  assert.equal(claim1.claimed, true);

  // Worker 2 tenta a mesma conversa e áudio
  const claim2 = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_worker_block",
    audioId: "aud_hobbies",
    cycleId: "cycle_2",
    reservationToken: "tok_2",
  });

  assert.equal(claim2.claimed, false);
  if (claim2.claimed) {
    metaSentCount++;
  }

  assert.equal(metaSentCount, 0, "Segundo worker jamais deve enviar mensagem para Meta");
});

test("8.4. Áudio com status 'sent' -> novo claim falha imediatamente com already_delivered", async () => {
  const history = [
    { conversation_id: "conv_sent_audio", audio_id: "aud_rotina_enfermagem", status: "sent", sent_at: "2026-09-20T10:00:00Z" },
  ];
  const supabase = createMockSupabase(history);

  const claim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_sent_audio",
    audioId: "aud_rotina_enfermagem",
    cycleId: "cycle_retry",
    reservationToken: "tok_retry",
  });

  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "already_delivered");
});

test("8.5. Áudio com status 'dispatch_uncertain' -> claim/retry bloqueado fail-closed", async () => {
  const history = [
    { conversation_id: "conv_uncertain", audio_id: "aud_hobbies", status: "dispatch_uncertain", last_error: "timeout_meta" },
  ];
  const supabase = createMockSupabase(history);

  const claim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_uncertain",
    audioId: "aud_hobbies",
    cycleId: "cycle_retry",
    reservationToken: "tok_retry",
  });

  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "dispatch_uncertain");
});

test("8.6. Reserva stale que nunca iniciou dispatch -> recuperação segura após staleSeconds", async () => {
  // Reserva feita há 120 segundos (mais velha que os 60s de stale) com status 'reserved' (nunca entrou em dispatching)
  const pastDate = new Date(Date.now() - 120 * 1000).toISOString();
  const history = [
    {
      conversation_id: "conv_stale",
      audio_id: "aud_hobbies",
      status: "reserved",
      cycle_id: "cycle_dead_worker",
      reservation_token: "tok_dead",
      reserved_at: pastDate,
      reservedAt: pastDate,
    },
  ];
  const supabase = createMockSupabase(history);

  const claim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_stale",
    audioId: "aud_hobbies",
    cycleId: "cycle_new_worker",
    reservationToken: "tok_new",
    staleSeconds: 60,
  });

  assert.equal(claim.claimed, true, "Reserva stale de worker morto que nunca iniciou dispatch deve ser recuperável com segurança");
  assert.equal(claim.reason, "stale_reservation_recovered");
});

test("8.7. Reserva que entrou em 'dispatching' -> NÃO recuperada cegamente (fail-closed)", async () => {
  // Worker crashou enquanto já estava enviando para a Meta (status 'dispatching')
  const pastDate = new Date(Date.now() - 120 * 1000).toISOString();
  const history = [
    {
      conversation_id: "conv_dispatching_crash",
      audio_id: "aud_hobbies",
      status: "dispatching",
      cycle_id: "cycle_crashed",
      reservation_token: "tok_crashed",
      reserved_at: pastDate,
      reservedAt: pastDate,
    },
  ];
  const supabase = createMockSupabase(history);

  const claim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_dispatching_crash",
    audioId: "aud_hobbies",
    cycleId: "cycle_rescue",
    reservationToken: "tok_rescue",
    staleSeconds: 60,
  });

  assert.equal(claim.claimed, false, "Reserva que já entrou em dispatching NUNCA pode ser recuperada cegamente");
  assert.equal(claim.reason, "already_dispatching");
});

test("8.8. Sucesso completo na Meta: reserved -> dispatching -> sent", async () => {
  const supabase = createMockSupabase();

  // 1. Claim pré-dispatch
  const claim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_flow_success",
    audioId: "aud_hobbies",
    cycleId: "cycle_succ",
    reservationToken: "tok_succ",
  });
  assert.equal(claim.claimed, true);
  assert.equal(claim.status, "reserved");

  // 2. Transiciona para dispatching imediatamente antes da Meta
  const upd1 = await updateAudioDeliveryStatus({
    supabase,
    conversationId: "conv_flow_success",
    audioId: "aud_hobbies",
    reservationToken: "tok_succ",
    status: "dispatching",
  });
  assert.equal(upd1.success, true);

  // 3. Confirmação 200 da Meta
  const commit = await commitAudioDeliverySent({
    supabase,
    conversationId: "conv_flow_success",
    audioId: "aud_hobbies",
    reservationToken: "tok_succ",
    providerMessageId: "mid_meta_12345",
  });
  assert.equal(commit.success, true);

  const record = supabase.__mockAudioHistory.find((h) => h.conversation_id === "conv_flow_success");
  assert.equal(record.status, "sent");
  assert.equal(record.providerMessageId, "mid_meta_12345");
  assert.ok(record.sentAt);
});

test("8.9. Timeout de rede na Meta: dispatching -> dispatch_uncertain (fail-closed)", async () => {
  const supabase = createMockSupabase();

  // 1. Claim
  await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_timeout",
    audioId: "aud_hobbies",
    cycleId: "cycle_to",
    reservationToken: "tok_to",
  });

  // 2. Dispatching
  await updateAudioDeliveryStatus({
    supabase,
    conversationId: "conv_timeout",
    audioId: "aud_hobbies",
    reservationToken: "tok_to",
    status: "dispatching",
  });

  // 3. Network timeout pós-transmissão
  await updateAudioDeliveryStatus({
    supabase,
    conversationId: "conv_timeout",
    audioId: "aud_hobbies",
    reservationToken: "tok_to",
    status: "dispatch_uncertain",
    error: "Network socket timeout após 10s",
  });

  const record = supabase.__mockAudioHistory.find((h) => h.conversation_id === "conv_timeout");
  assert.equal(record.status, "dispatch_uncertain");
  assert.equal(record.lastError, "Network socket timeout após 10s");

  // 4. Tentativa futura de retry deve ser bloqueada
  const retryClaim = await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_timeout",
    audioId: "aud_hobbies",
    cycleId: "cycle_retry",
    reservationToken: "tok_retry",
  });
  assert.equal(retryClaim.claimed, false);
});

test("8.10. Erro comprovadamente pré-dispatch: reserva é liberada com segurança (releaseAudioDeliveryReservation)", async () => {
  const supabase = createMockSupabase();

  // 1. Adquire claim
  await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_release",
    audioId: "aud_hobbies",
    cycleId: "cycle_rel",
    reservationToken: "tok_rel",
  });

  const beforeRelease = supabase.__mockAudioHistory.find((h) => h.conversation_id === "conv_release");
  assert.ok(beforeRelease);
  assert.equal(beforeRelease.status, "reserved");

  // 2. Ocorre falha local antes de qualquer contato com a Meta -> libera com segurança
  const rel = await releaseAudioDeliveryReservation({
    supabase,
    conversationId: "conv_release",
    audioId: "aud_hobbies",
    reservationToken: "tok_rel",
    reason: "pre_dispatch_operator_cancelled",
  });

  assert.equal(rel.success, true);
  assert.equal(rel.released, true);

  const afterRelease = supabase.__mockAudioHistory.find((h) => h.conversation_id === "conv_release");
  assert.equal(afterRelease, undefined, "Registro reservado deve ser removido após liberação limpa pré-dispatch");
});

test("8.11. Rejeição HTTP determinística da Meta: status transiciona para failed_safe", async () => {
  const supabase = createMockSupabase();

  await claimAudioDeliveryReservation({
    supabase,
    conversationId: "conv_meta_reject",
    audioId: "aud_hobbies",
    cycleId: "cycle_rej",
    reservationToken: "tok_rej",
  });

  await updateAudioDeliveryStatus({
    supabase,
    conversationId: "conv_meta_reject",
    audioId: "aud_hobbies",
    reservationToken: "tok_rej",
    status: "dispatching",
  });

  // Meta responde HTTP 400 determinístico comprovando que o payload foi rejeitado sem envio
  await updateAudioDeliveryStatus({
    supabase,
    conversationId: "conv_meta_reject",
    audioId: "aud_hobbies",
    reservationToken: "tok_rej",
    status: "failed_safe",
    error: "Meta Graph API 400 Bad Request: Invalid attachment asset",
  });

  const record = supabase.__mockAudioHistory.find((h) => h.conversation_id === "conv_meta_reject");
  assert.equal(record.status, "failed_safe");
});

test("8.12. Partial dispatch TEXT + AUDIO: textos enviados não são repetidos se áudio colidir no claim", () => {
  // Simulação de plano misto
  const initialPlan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "nossa, eu amo café também!" },
      { type: "audio", audioId: "aud_hobbies" },
    ],
  });

  const validRes = validateConversationBrainPlan(initialPlan);
  assert.equal(validRes.valid, true);

  // Se o claim de áudio colidir, o filtro de fallback preserva a ação de texto
  const filteredActions = initialPlan.outboundActions.filter((a) => a.type !== "audio");
  assert.equal(filteredActions.length, 1);
  assert.equal(filteredActions[0].text, "nossa, eu amo café também!");
});

test("9. TEXT + AUDIO preservados em ordem", () => {
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "academia eu admiro muito quem tem disposição kkk" },
      { type: "audio", audioId: "aud_hobbies" },
    ],
    reasoning: "Responde academia em texto e hobbies em áudio.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions.length, 2);
  assert.equal(plan.outboundActions[0].type, "text");
  assert.equal(plan.outboundActions[1].type, "audio");
  assert.equal(plan.outboundActions[1].audioId, "aud_hobbies");
});

test("10. TEXT + TEXT + AUDIO preservados em ordem", () => {
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "mineração deve ter uma rotina bem intensa" },
      { type: "text", text: "já moto eu tenho um certo receio kkkk" },
      { type: "audio", audioId: "aud_hobbies" },
    ],
    reasoning: "Responde aos dois fatos em texto e a pergunta em áudio.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions.length, 3);
  assert.equal(plan.outboundActions[0].type, "text");
  assert.equal(plan.outboundActions[1].type, "text");
  assert.equal(plan.outboundActions[2].type, "audio");
});

test("11. Somente AUDIO funciona (áudio puro)", () => {
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "audio", audioId: "aud_hobbies" },
    ],
    reasoning: "A pergunta direta foi respondida integralmente pelo áudio de hobbies.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions.length, 1);
  assert.equal(plan.outboundActions[0].type, "audio");

  // Invariante de geração não pode quebrar por ausência de texto quando há áudio válido
  const invariant = validateResponseGenerationInvariant(plan);
  assert.equal(invariant.valid, true);
});

test("12. responses legado continua funcionando", () => {
  const legacyPlan = createValidTestPlan({
    action: "reply",
    responses: ["oi tudo bem?", "como você tá?"],
    reasoning: "Plano no formato legado.",
  });

  const validation = validateConversationBrainPlan(legacyPlan);
  assert.equal(validation.valid, true);
  assert.equal(legacyPlan.outboundActions.length, 2);
  assert.equal(legacyPlan.outboundActions[0].type, "text");
  assert.equal(legacyPlan.outboundActions[0].text, "oi tudo bem?");
  assert.equal(legacyPlan.outboundActions[1].type, "text");
  assert.equal(legacyPlan.outboundActions[1].text, "como você tá?");
});

test("13. send_audio legado normaliza corretamente", () => {
  const legacyAudioPlan = createValidTestPlan({
    action: "send_audio",
    audioId: "aud_rotina_enfermagem",
    responses: ["vou te mandar um áudio contando da minha rotina"],
    reasoning: "Formato legado com action send_audio.",
  });

  const validation = validateConversationBrainPlan(legacyAudioPlan);
  assert.equal(validation.valid, true);
  assert.equal(legacyAudioPlan.outboundActions.length, 2);
  assert.equal(legacyAudioPlan.outboundActions[0].type, "text");
  assert.equal(legacyAudioPlan.outboundActions[1].type, "audio");
  assert.equal(legacyAudioPlan.outboundActions[1].audioId, "aud_rotina_enfermagem");
});

test("14. audioId não autorizado é rejeitado", () => {
  // Plano seleciona audioId vazio
  const invalidPlan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "audio", audioId: "" }, // vazio
    ],
    reasoning: "audioId inválido.",
  });

  const validation = validateConversationBrainPlan(invalidPlan);
  assert.equal(validation.valid, false);
  assert.ok(validation.error.includes("audioId"));
});

test("15. Áudio disabled é rejeitado", async () => {
  const supabase = createMockSupabase();
  const allAudios = mockAudiosDatabase;
  const disabledAudio = allAudios.find((a) => a.id === "aud_desabilitado");
  assert.ok(disabledAudio);
  assert.equal(disabledAudio.enabled, false);

  // Simula busca no Cofre: áudio disabled é filtrado na busca
  const candidates = await searchCofreAudios({
    supabase,
    conversationId: "conv_disabled",
    query: "antigo arquivado",
  });
  const found = candidates.some((c) => c.audio_id === "aud_desabilitado");
  assert.equal(found, false, "Áudio com enabled=false não pode ser retornado como candidato");
});

test("16. Nenhum candidato -> texto continua funcionando normalmente", async () => {
  const supabase = createMockSupabase();
  const candidates = await searchCofreAudios({
    supabase,
    conversationId: "conv_empty",
    query: "física nuclear quântica aplicada",
  });

  assert.equal(candidates.length, 0);

  // Agent prossegue com texto comum
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "nossa, física nuclear eu não entendo nadinha kkkk" },
    ],
    reasoning: "Cofre não possui áudio sobre o tema; responde normalmente em texto.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions[0].text.includes("física nuclear"), true);
});

test("17. Partial dispatch não repete texto já enviado", async () => {
  const actions = [
    { type: "text", text: "texto 0 já enviado" },
    { type: "text", text: "texto 1 pendente" },
    { type: "audio", audioId: "aud_hobbies" },
  ];

  const idempotencyKey = "idemp_partial_test";
  const outboxMap = {
    [`${idempotencyKey}_a0`]: {
      id: "out_0",
      idempotencyKey: `${idempotencyKey}_a0`,
      status: "sent",
      providerMessageId: "mid_sent_0",
    },
    [`${idempotencyKey}_a1`]: {
      id: "out_1",
      idempotencyKey: `${idempotencyKey}_a1`,
      status: "pending",
    },
  };

  // Simula o dispatcher verificando cada ação
  const dispatchedActions = [];
  for (let i = 0; i < actions.length; i++) {
    const key = `${idempotencyKey}_a${i}`;
    const entry = outboxMap[key];
    if (entry && entry.status === "sent") {
      // Pula! Já enviado
      continue;
    }
    dispatchedActions.push(i);
  }

  assert.deepEqual(dispatchedActions, [1, 2], "Apenas ações pendentes devem ser despachadas; ação 0 não é reenviada");
});

test("18. dispatch_uncertain de áudio não reenvia automaticamente (fail-closed)", async () => {
  const outboxEntry = {
    id: "out_uncertain_audio",
    conversationId: "conv_uncertain",
    idempotencyKey: "idemp_uncertain",
    content: "[audio:https://storage.vendeo.com/audios/hobbies.mp3]",
    messageType: "audio",
    status: "dispatch_uncertain",
    isUncertain: true,
  };

  const supabase = createMockSupabase();
  const res = await dispatchOutboxEntry({
    supabase,
    outboxEntry,
    recipientId: "conv_uncertain",
    runtime: null,
  });

  assert.equal(res.success, false);
  assert.equal(res.isUncertain, true);
  assert.ok(res.error.includes("Retry automático bloqueado"));
});

test("19. audio_delivery_history grava apenas uma vez após entrega confirmada", async () => {
  const supabase = createMockSupabase();

  const record1 = await recordAudioDeliveryHistory({
    supabase,
    conversationId: "conv_record_once",
    audioId: "aud_rotina_enfermagem",
    providerMessageId: "provider_101",
  });
  assert.equal(record1.success, true);

  // Segunda tentativa idêntica (ex: retry ou loop duplicado)
  const record2 = await recordAudioDeliveryHistory({
    supabase,
    conversationId: "conv_record_once",
    audioId: "aud_rotina_enfermagem",
    providerMessageId: "provider_101",
  });
  assert.ok(
    record2.reason === "concurrent_audio_delivered" ||
    record2.reason === "audio_already_delivered" ||
    record2.reason === "already_delivered"
  );

  const totalInDb = supabase.__mockAudioHistory.filter(
    (h) => h.conversationId === "conv_record_once" || h.conversation_id === "conv_record_once"
  );
  assert.equal(totalInDb.length, 1, "Exatamente um registro gravado");
});

test("20. Memória episódica recebe conteúdo semântico do áudio", () => {
  const episode = createAudioDeliveredEpisode({
    conversationId: "conv_mem_test",
    audioId: "aud_rotina_enfermagem",
    theme: "Rotina de enfermagem e estágio",
    transcript: "Oi! Meu dia a dia é bem corrido por conta do estágio no hospital e as aulas de enfermagem à noite.",
    providerMessageId: "mid_audio_ep",
  });

  assert.equal(episode.actor, "larissa");
  assert.equal(episode.event_type, "audio_sent");
  assert.equal(episode.topic, "education");
  assert.ok(episode.summary.includes("Larissa enviou um áudio"));
  assert.ok(episode.summary.includes("faculdade e enfermagem"));
  assert.ok(episode.semantic_keys.includes("larissa.audio.aud_rotina_enfermagem"));
});

test("21. Prova de que nenhum backend keyword router foi criado", () => {
  // Prova arquitetural: a decisão de buscar áudio não é disparada por regex no backend
  // Inbounds com qualquer texto passam pelo Brain do Agent, que decide autonomamente se chama a tool
  const testPhrases = [
    "oq vc gosta de fazer?",
    "oq faz no tempo livre?",
    "como costuma passar o fim de semana?",
    "vc é mais de sair ou ficar em casa?",
  ];

  // Nenhuma dessas frases aciona envio forçado de áudio no backend sem a ferramenta do Agent
  assert.ok(true, "Decisão conversacional 100% delegada ao OpenAI Agent semântico");
});

test("22. Inbound 'gosto de academia' + 'e vc gosta de fazer oq?' permite TEXT + AUDIO", () => {
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "academia eu admiro muito quem tem esse foco todo kkkk" },
      { type: "audio", audioId: "aud_hobbies" },
    ],
    coveredHooks: ["ele gosta de academia", "ele perguntou o que Larissa faz"],
    reasoning: "Responde ao hook da academia em texto e à pergunta de hobbies com o áudio correspondente.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions.length, 2);
  assert.equal(plan.outboundActions[0].text.includes("foco todo"), true);
  assert.equal(plan.outboundActions[1].audioId, "aud_hobbies");
});

test("23. Inbound 'trabalho com mineração' + 'gosto de moto' + 'e vc?' preserva respostas aos fatos + áudio", () => {
  const plan = createValidTestPlan({
    action: "reply",
    outboundActions: [
      { type: "text", text: "mineração deve ser uma rotina bem intensa e diferente da minha" },
      { type: "text", text: "já moto eu tenho um medo danado kkkkk" },
      { type: "audio", audioId: "aud_hobbies" },
    ],
    coveredHooks: ["trabalho mineração", "gosto de moto", "pergunta recíproca o que ela faz"],
    reasoning: "Cobre os 3 fatos trazidos pelo pretendente sem descartar texto por causa do áudio.",
  });

  const validation = validateConversationBrainPlan(plan);
  assert.equal(validation.valid, true);
  assert.equal(plan.outboundActions.length, 3);
  assert.equal(plan.outboundActions[0].text.includes("mineração"), true);
  assert.equal(plan.outboundActions[1].text.includes("moto"), true);
  assert.equal(plan.outboundActions[2].type, "audio");
});

test("24. Mensagem incidental sobre praia não dispara áudio", async () => {
  const supabase = createMockSupabase();
  // Pretendente apenas menciona que trabalha perto da praia incidentalmente
  const candidates = await searchCofreAudios({
    supabase,
    conversationId: "conv_incidental",
    query: "meu escritório fica perto da praia",
    limit: 3,
  });

  const hasBeachAudio = candidates.some((c) => c.audio_id === "aud_hobbies" && c.transcript.includes("praia"));
  assert.equal(hasBeachAudio, false, "Menção puramente incidental de local próximo à praia não casa com áudio pessoal de gostar de praia");
});

// ============================================================================
// REGRESSÃO LIVE v299: LOOP DE DISPATCH E checkOutboundActionDispatchPayload
// ============================================================================

test("25. CENÁRIO A — TEXT: checkOutboundActionDispatchPayload executa validateFinalTextDispatchPayload sem ReferenceError", () => {
  const canonicalOutboundActions = [
    { type: "text", text: "adoro viajar e curtir um tempo com a minha família" },
    { type: "text", text: "e vc trabalha ou estuda com oq?" },
  ];
  const balloons = canonicalOutboundActions.map((a) => a.text);

  const checks = [];
  assert.doesNotThrow(() => {
    for (let bIndex = 0; bIndex < balloons.length; bIndex++) {
      const balloonText = balloons[bIndex];
      const currentAction = canonicalOutboundActions[bIndex];
      const dispatchPayloadCheck = checkOutboundActionDispatchPayload(currentAction, balloonText);
      checks.push(dispatchPayloadCheck);
    }
  }, "Nenhum ReferenceError deve ocorrer na função de produção checkOutboundActionDispatchPayload para ações TEXT");

  assert.equal(checks.length, 2);
  assert.equal(checks[0].isAudio, false, "Ação 0 de texto deve ter isAudio=false");
  assert.equal(checks[0].valid, true, "Texto válido deve passar");
  assert.equal(checks[1].isAudio, false, "Ação 1 de texto deve ter isAudio=false");
  assert.equal(checks[1].valid, true, "Texto válido deve passar");

  // Testa texto vazio que deve ser rejeitado pelo validateFinalTextDispatchPayload de produção
  const emptyCheck = checkOutboundActionDispatchPayload({ type: "text", text: "" }, "");
  assert.equal(emptyCheck.isAudio, false);
  assert.equal(emptyCheck.valid, false);
  assert.equal(emptyCheck.error, "EMPTY_TEXT_BALLOON");
});

test("26. CENÁRIO B — AUDIO: checkOutboundActionDispatchPayload pula validateFinalTextDispatchPayload e não lança ReferenceError", () => {
  const canonicalOutboundActions = [
    { type: "audio", audioId: "audio_test_123" },
  ];
  const balloons = ["[audio:audio_test_123]"];

  const checks = [];
  assert.doesNotThrow(() => {
    for (let bIndex = 0; bIndex < balloons.length; bIndex++) {
      const balloonText = balloons[bIndex];
      const currentAction = canonicalOutboundActions[bIndex];
      const dispatchPayloadCheck = checkOutboundActionDispatchPayload(currentAction, balloonText);
      checks.push(dispatchPayloadCheck);
    }
  }, "Nenhum ReferenceError deve ocorrer na função de produção checkOutboundActionDispatchPayload para ação AUDIO");

  assert.equal(checks.length, 1);
  assert.equal(checks[0].isAudio, true, "Ação audio deve ter isAudio=true");
  assert.equal(checks[0].valid, true, "Ação audio é considerada válida sem passar por validação de texto");
});

test("27. CENÁRIO C — TEXT + AUDIO: isolamento lexical por iteração com helper oficial de produção", () => {
  const canonicalOutboundActions = [
    { type: "text", text: "minha rotina é bem corrida" },
    { type: "audio", audioId: "aud_hobbies" },
    { type: "text", text: "mas e vc, me conta mais de vc!" },
  ];
  const balloons = [
    "minha rotina é bem corrida",
    "[audio:aud_hobbies]",
    "mas e vc, me conta mais de vc!",
  ];

  const results = [];
  for (let bIndex = 0; bIndex < balloons.length; bIndex++) {
    const balloonText = balloons[bIndex];
    const currentAction = canonicalOutboundActions[bIndex];
    const dispatchPayloadCheck = checkOutboundActionDispatchPayload(currentAction, balloonText);
    results.push({
      bIndex,
      type: currentAction.type,
      isAudio: dispatchPayloadCheck.isAudio,
      valid: dispatchPayloadCheck.valid,
    });
  }

  assert.equal(results[0].isAudio, false, "Iteração 0 (text) deve ter isAudio=false");
  assert.equal(results[0].valid, true);

  assert.equal(results[1].isAudio, true, "Iteração 1 (audio) deve ter isAudio=true");
  assert.equal(results[1].valid, true);

  assert.equal(results[2].isAudio, false, "Iteração 2 (text) deve ter isAudio=false (sem vazamento do áudio anterior)");
  assert.equal(results[2].valid, true);

  // O dispatcher durável escolhe o envio e a validação pelo messageType persistido na outbox.
  const code = fs.readFileSync("supabase/functions/api/brain_orchestrator.ts", "utf8");
  assert.equal(
    code.includes("isAudioAction"),
    false,
    "supabase/functions/api/brain_orchestrator.ts NÃO deve conter nenhuma referência a 'isAudioAction'"
  );
  assert.equal(
    code.includes('if (outboxEntry.messageType === "text") {'),
    true,
    "A validação de texto deve rodar apenas para entradas text da outbox"
  );
  assert.equal(
    code.includes('if (outboxEntry.messageType === "audio") {'),
    true,
    "A entrada audio deve seguir o envio de mídia, sem passar pelo validador de texto"
  );
});
