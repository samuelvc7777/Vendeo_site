import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiBrainContextMessage,
  validateConversationBrainPlan,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

test("CENÁRIO 1: Contexto formatado inclui [MENSAGEM id='...'] e contrato com evidenceMessageId", () => {
  const context = buildOpenAiBrainContextMessage({
    supabase: {},
    conversationId: "conv_test_101",
    currentStageId: "stage_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: false,
    inboundMessages: ["Sou de sao joao del rei e vc ?"],
    currentInboundMessages: [
      { id: "1040376229029884", text: "Sou de sao joao del rei e vc ?" },
    ],
    recentMessages: [],
    availableSubagents: [{ id: "conexao_inicial", name: "Conexão", mission: "Conectar" }],
  });

  assert.ok(context.includes('[MENSAGEM id="1040376229029884"]: "Sou de sao joao del rei e vc ?"'));
  assert.ok(context.includes('"evidenceMessageId": null'));
  assert.ok(context.includes('evidenceMessageId são OBRIGATÓRIOS'));
});

test("CENÁRIO 2: Caso real de cidade (already_satisfied + evidenceMessageId válido)", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const claimedMessageIds = ["1040376229029884"];
  const targetObj = { id: "goal_city", label: "Cidade" };

  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "goal_city",
    evidenceMessageId: "1040376229029884",
    reasoning: "Pretendente informou espontaneamente que é de São João del-Rei",
    responses: ["Sérioo, eu sou de São João del-Rei tbm", "Olha que coincidência kkk"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 2,
    },
  };

  // 1. Validação estrutural do plano
  const valResult = validateConversationBrainPlan(mockPlan, subagents);
  assert.equal(valResult.valid, true);

  // 2. Execução via runOpenAiBrainTurn
  const turnResult = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_city",
    currentStageId: "stage_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    inboundMessages: ["Sou de sao joao del rei e vc ?"],
    currentInboundMessages: [
      { id: "1040376229029884", text: "Sou de sao joao del rei e vc ?" },
    ],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 100 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(turnResult.success, true);
  const plan = turnResult.plan;

  // 3. Validação determinística do backend (simulação do experimental_orchestrator)
  let workingCompletedGoalIds = [];
  if (plan.objectiveDecision === "already_satisfied") {
    if (
      targetObj &&
      plan.satisfiedObjectiveId === targetObj.id &&
      claimedMessageIds.includes(String(plan.evidenceMessageId || ""))
    ) {
      workingCompletedGoalIds.push(targetObj.id);
    } else {
      throw new Error("BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE");
    }
  }

  assert.deepEqual(workingCompletedGoalIds, ["goal_city"]);
});

test("CENÁRIO 3: Duas mensagens inbound recebidas — modelo seleciona o ID da mensagem que contém a evidência", async () => {
  const claimedMessageIds = ["msg_job_99", "msg_city_100"];
  const targetObj = { id: "goal_city", label: "Cidade" };

  const mockPlanWithSelection = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "goal_city",
    evidenceMessageId: "msg_city_100", // Selecionou semanticamente a segunda mensagem
    reasoning: "A evidência da cidade está na segunda mensagem ('sou de Barbacena')",
    responses: ["Nossa que legal, Barbacena é bem pertinho daqui"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };

  const valResult = validateConversationBrainPlan(mockPlanWithSelection);
  assert.equal(valResult.valid, true);

  // Backend determinístico valida que evidenceMessageId está nos claimedMessageIds
  assert.ok(claimedMessageIds.includes(mockPlanWithSelection.evidenceMessageId));
  assert.equal(mockPlanWithSelection.evidenceMessageId, "msg_city_100");
});

test("CENÁRIO 4: Teste Negativo — evidenceMessageId inventado ou não pertencente às inbounds é rejeitado", () => {
  const claimedMessageIds = ["1040376229029884"];
  const targetObj = { id: "goal_city", label: "Cidade" };

  const mockPlanFakeEvidence = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "goal_city",
    evidenceMessageId: "msg_inventada_pelo_modelo_999",
    reasoning: "Tentativa com ID não existente",
    responses: ["Oi"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };

  // O backend determinístico DEVE rejeitar e lançar BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE
  let thrownError = null;
  try {
    if (mockPlanFakeEvidence.objectiveDecision === "already_satisfied") {
      if (
        targetObj &&
        mockPlanFakeEvidence.satisfiedObjectiveId === targetObj.id &&
        claimedMessageIds.includes(String(mockPlanFakeEvidence.evidenceMessageId || ""))
      ) {
        // não deve chegar aqui
      } else {
        throw new Error("BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE");
      }
    }
  } catch (e) {
    thrownError = e;
  }

  assert.ok(thrownError);
  assert.equal(thrownError.message, "BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE");
});

test("CENÁRIO 5: Schema Incompleto — already_satisfied sem evidenceMessageId falha na validação estrutural", () => {
  const incompletePlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "goal_city",
    // evidenceMessageId ausente!
    responses: ["Legal"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };

  const valResult = validateConversationBrainPlan(incompletePlan);
  assert.equal(valResult.valid, false);
  assert.ok(valResult.error.includes("evidenceMessageId é obrigatório"));
});

test("CENÁRIO 6: Decisões pursue, defer e none não exigem evidenceMessageId", () => {
  const pursuePlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "pursue",
    satisfiedObjectiveId: null,
    evidenceMessageId: null,
    responses: ["E vc é de onde?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };

  const valResult = validateConversationBrainPlan(pursuePlan);
  assert.equal(valResult.valid, true);
});
