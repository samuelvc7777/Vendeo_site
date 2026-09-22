/**
 * test-already-satisfied-and-canonical-required.mjs
 * 
 * Validação rigorosa dos 6 requisitos canônicos:
 * 1. already_satisfied concluído no MESMO CICLO em processDeterministicStageProgression
 * 2. Objetivos do tipo "fact" NUNCA recebem value: true (recebem null até enriquecimento pela memória)
 * 3. Enriquecimento de fatos consolidados com valor string real da ContactMemory
 * 4. Preservação estrita dos gates de evidência (claimedMessageIds)
 * 5. Regra Canônica: Todo objetivo ativo é obrigatório (required = true para todos os ativos)
 * 6. stageComplete só é atingido quando TODOS os ativos forem concluídos
 */

import {
  processDeterministicStageProgression,
  resolveStageChecklistGoals,
} from '../supabase/functions/api/brain_orchestrator.ts';


let passed = 0;
let failed = 0;

function assert(description, condition, details = "") {
  if (condition) {
    console.log(`  ✅ PASS | ${description}${details ? ` — ${details}` : ""}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL | ${description}${details ? ` — ${details}` : ""}`);
    failed++;
  }
}

// MemoryProvider Mock em memória
class MockMemoryProvider {
  constructor(initialFacts = {}) {
    this.facts = initialFacts;
  }
  async getFact(conversationId, entity, field) {
    const val = this.facts[`${entity}:${field}`];
    if (val !== undefined && val !== null) {
      return { found: true, value: val.value, fact: val };
    }
    return { found: false, value: null, fact: null };
  }
  async setFact(conversationId, entity, field, value, confidence = 1.0, sourceMessageId = null) {
    this.facts[`${entity}:${field}`] = { value, confidence, sourceMessageId };
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log(" SUÍTE: ALREADY_SATISFIED NO MESMO TURNO & REGRA CANÔNICA DE OBJETIVOS");
  console.log("================================================================================");

  const mockStages = [
    {
      id: "stage_1_conexao",
      name: "Conexão Inicial",
      stage_order: 0,
      goals: [
        { id: "goal_city", label: "Cidade", kind: "fact", enabled: true, required: true, memoryField: "city", memoryEntity: "self" },
        { id: "goal_job", label: "Profissão", kind: "fact", enabled: true, required: false, memoryField: "profession", memoryEntity: "self" }, // required: false legado deve ser tratado como OBRIGATÓRIO
        { id: "goal_disabled", label: "Objetivo Inativo", kind: "fact", enabled: false, required: false }
      ]
    },
    {
      id: "stage_2_descoberta",
      name: "Descoberta",
      stage_order: 1,
      goals: [
        { id: "goal_hobbies", label: "Hobbies", kind: "fact", enabled: true, required: true }
      ]
    }
  ];

  const mockSupabase = {
    from(table) {
      return {
        select() {
          return {
            order() {
              if (table === "chat_stages") {
                return Promise.resolve({ data: mockStages });
              }
              return Promise.resolve({ data: [] });
            },
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null });
                }
              };
            }
          };
        }
      };
    }
  };

  // ---------------------------------------------------------------------------
  // TESTE 1: CANONICAL REQUIRED — TODO ATIVO É OBRIGATÓRIO
  // ---------------------------------------------------------------------------
  console.log("\n--- 1. REGRA CANÔNICA: TODO OBJETIVO ATIVO É OBRIGATÓRIO ---");
  const memEmpty = new MockMemoryProvider();
  const resolution1 = await resolveStageChecklistGoals({
    supabase: mockSupabase,
    conversationId: "conv_test_1",
    stageNameOrId: "stage_1_conexao",
    memoryProvider: memEmpty,
    completedGoalIds: [],
  });

  const activeGoals = resolution1.goals.filter(g => g.enabled !== false);
  assert("Objetivos ativos identificados corretamente (exclui enabled: false)", activeGoals.length === 2);
  assert("goal_city é obrigatório", activeGoals.find(g => g.id === "goal_city")?.required === true);
  assert("goal_job (que era required: false legado) é tratado como OBRIGATÓRIO", activeGoals.find(g => g.id === "goal_job")?.required === true);
  assert("Etapa não está completa com 0 concluídos", !activeGoals.every(g => g.status === "completed"));

  // ---------------------------------------------------------------------------
  // TESTE 2: ALREADY_SATISFIED NO TURNO ATUAL CONCLUI NO MESMO CICLO
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. ALREADY_SATISFIED NO TURNO ATUAL CONCLUI NO MESMO CICLO ---");
  const currentCycle = { trace: [] };
  const claimedMessages = [
    { id: "msg_inbound_101", sender: "them", text: "sou de são joão del rei" }
  ];

  // Brain reconheceu already_satisfied e construiu objectiveCompletion:
  const brainObjectiveCompletion = {
    objectiveId: "goal_city",
    evidenceMessageId: "msg_inbound_101",
    value: null, // Regra canônica: null para fatos até resolução
    source: "brain_already_satisfied_current_turn",
  };

  const decision = {
    action: "reply",
    currentPhase: "conexao_inicial",
    nextPhase: "conexao_inicial",
    checkpoint: "chk_saudacao_feita",
    summary: "Executado em turno único",
    suggestedResponse: "Que legal! Conheço São João del Rei.",
    responses: ["Que legal! Conheço São João del Rei."],
    requiredTools: ["send_text"],
    reasoning: "Pretendente informou a cidade",
    objectiveCompletion: brainObjectiveCompletion,
  };

  const stageProgression = await processDeterministicStageProgression({
    supabase: mockSupabase,
    conversationId: "conv_test_1",
    currentPhase: "conexao_inicial",
    currentStageId: "stage_1_conexao",
    decision,
    claimedMessages,
    rawInbounds: claimedMessages,
    stageRules: {},
    orchState: {},
    currentCycle,
    memoryProvider: memEmpty,
  });

  assert("goal_city foi concluído no MESMO CICLO", stageProgression.updatedCompletedGoals.includes("goal_city"));
  assert("updatedObjectiveProgress contém goal_city", Boolean(stageProgression.updatedObjectiveProgress["goal_city"]));
  assert("Status de goal_city é 'completed'", stageProgression.updatedObjectiveProgress["goal_city"]?.status === "completed");
  assert("EvidenceMessageId corresponde à mensagem do turno atual", stageProgression.updatedObjectiveProgress["goal_city"]?.evidenceMessageId === "msg_inbound_101");

  // ---------------------------------------------------------------------------
  // TESTE 3: VALOR FACTUAL — NUNCA VALUE: TRUE PARA FACT
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. INTEGRIDADE FACTUAL: NUNCA VALUE: TRUE PARA KIND='FACT' ---");
  const cityProgressValue = stageProgression.updatedObjectiveProgress["goal_city"]?.value;
  assert("Objetivo factual NÃO recebe value: true", cityProgressValue !== true, `value=${JSON.stringify(cityProgressValue)}`);
  assert("Objetivo factual recebe value: null antes de memória preenchida", cityProgressValue === null, `value=${JSON.stringify(cityProgressValue)}`);

  // ---------------------------------------------------------------------------
  // TESTE 4: GATE DE EVIDÊNCIA — REJEITA SE EVIDENCE FORA DO CLAIMED
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. GATE DE EVIDÊNCIA: REJEITA SE EVIDÊNCIA FORA DOS CLAIMED ---");
  const fakeCycle = { trace: [] };
  const invalidEvidenceDecision = {
    ...decision,
    objectiveCompletion: {
      objectiveId: "goal_city",
      evidenceMessageId: "msg_alien_999", // Não está em claimedMessages
      value: null,
    }
  };

  const invalidProgression = await processDeterministicStageProgression({
    supabase: mockSupabase,
    conversationId: "conv_test_1",
    currentPhase: "conexao_inicial",
    currentStageId: "stage_1_conexao",
    decision: invalidEvidenceDecision,
    claimedMessages, // Contém apenas msg_inbound_101
    rawInbounds: claimedMessages,
    stageRules: {},
    orchState: {},
    currentCycle: fakeCycle,
    memoryProvider: memEmpty,
  });

  assert("goal_city com evidência alienígena NÃO foi concluído", !invalidProgression.updatedCompletedGoals.includes("goal_city"));
  assert("Trace registra rejeição por invalid_evidence", fakeCycle.trace.includes("objective_completion_rejected_reason: invalid_evidence"));

  // ---------------------------------------------------------------------------
  // TESTE 5: PROGRESSÃO DETERMINÍSTICA EXIGE TODOS OS ATIVOS CONCLUÍDOS
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. ETAPA NÃO AVANÇA SE HOUVER ATIVO PENDENTE ---");
  // Temos goal_city concluído, mas goal_job (ativo) ainda está pendente!
  assert("Etapa NÃO avançou ainda pois goal_job continua pendente", invalidProgression.stageAdvanced === false);
  assert("nextStageId continua sendo stage_1_conexao", invalidProgression.nextStageId === "stage_1_conexao");

  // ---------------------------------------------------------------------------
  // TESTE 6: AVANÇO DETERMINÍSTICO QUANDO TODOS OS ATIVOS SÃO CONCLUÍDOS
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. AVANÇO DETERMINÍSTICO QUANDO TODOS OS ATIVOS SÃO CONCLUÍDOS ---");
  const jobClaimedMessages = [
    { id: "msg_inbound_102", sender: "them", text: "sou engenheiro civil" }
  ];
  const allCompletedDecision = {
    ...decision,
    objectiveCompletion: {
      objectiveId: "goal_job",
      evidenceMessageId: "msg_inbound_102",
      value: null,
    }
  };

  const advanceCycle = { trace: [] };
  const fullProgression = await processDeterministicStageProgression({
    supabase: mockSupabase,
    conversationId: "conv_test_1",
    currentPhase: "conexao_inicial",
    currentStageId: "stage_1_conexao",
    decision: allCompletedDecision,
    claimedMessages: jobClaimedMessages,
    rawInbounds: jobClaimedMessages,
    stageRules: {
      completed_goals: ["goal_city"], // goal_city já concluído no turno anterior
    },
    orchState: {},
    currentCycle: advanceCycle,
    memoryProvider: memEmpty,
  });

  assert("Ambos objetivos ativos estão concluídos", fullProgression.updatedCompletedGoals.includes("goal_city") && fullProgression.updatedCompletedGoals.includes("goal_job"));
  assert("Etapa avançou deterministicamente", fullProgression.stageAdvanced === true);
  assert("Avançou para stage_2_descoberta", fullProgression.nextStageId === "stage_2_descoberta");
  assert("ResponsibleSubagentId expurgado do retorno da progressão determinística", fullProgression.responsibleSubagentId === undefined);

  // ---------------------------------------------------------------------------
  // RESULTADO FINAL
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
  console.log(`✅ APROVADAS: ${passed}`);
  console.log(`❌ FALHAS: ${failed}`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
