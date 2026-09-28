import test from "node:test";
import assert from "node:assert/strict";
import {
  validateConversationBrainPlan,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

test("validateConversationBrainPlan valida rigorosamente o contrato do Brain único", () => {
  // 1. Rejeita nulo / não objeto
  assert.equal(validateConversationBrainPlan(null).valid, false);
  assert.equal(validateConversationBrainPlan("string").valid, false);

  // 2. Rejeita actions fora do contrato oficial reply/wait
  const legacyDelegate = validateConversationBrainPlan({
    action: "delegate_mission",
    responsibleSubagent: "subagent_inexistente",
  });
  assert.equal(legacyDelegate.valid, false);
  assert.match(legacyDelegate.error || "", /reply.*wait|Ação do plano/);

  // 3. Rejeita turnContract inválido
  const invalidContractPlan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "teste",
    responses: ["oi"],
    turnContract: {
      mustAnswerFirst: "not_boolean",
      newQuestionBudget: "1",
      responseShape: "",
    },
  };
  assert.equal(validateConversationBrainPlan(invalidContractPlan).valid, false);

  // 4. Aceita plano válido do Brain único
  const validPlan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "resposta direta",
    responses: ["oii, tudo bem?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };
  assert.equal(validateConversationBrainPlan(validPlan).valid, true);
});

test("runOpenAiBrainTurn no strict mode (strictOpenAiPilot: true) FALHA e não sintetiza plano se inválido", async () => {
  // Mock runtime devolvendo plano nulo / texto comum não parseado
  const mockRuntimeInvalid = {
    callOpenAiAgent: async () => ({
      plan: null,
      tokens: 50,
    }),
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_strict",
    currentStageId: "stage_01",
    inboundMessages: ["Oi"],
    recentMessages: [],
    runtime: mockRuntimeInvalid,
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, false, "Deveria ter retornado success: false no strict mode");
  assert.equal(result.plan, null, "Não pode sintetizar plano no strict mode!");
  assert.equal(result.telemetry.finalPlanParsed, false, "finalPlanParsed deve ser false");
  assert.equal(result.telemetry.status, "failed");
  assert.match(result.error, /Strict Mode/);
});

test("runOpenAiBrainTurn no modo flexível (strictOpenAiPilot: false) usa fallback e sintetiza plano", async () => {
  const mockRuntimeInvalid = {
    callOpenAiAgent: async () => ({
      plan: "Resposta direta em texto puro do modelo sem JSON",
      tokens: 50,
    }),
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_non_strict",
    currentStageId: "stage_01",
    inboundMessages: ["Oi"],
    recentMessages: [],
    runtime: mockRuntimeInvalid,
    strictOpenAiPilot: false,
  });

  assert.equal(result.success, true, "Modo não-strict deve recuperar graciosamente");
  assert.ok(result.plan, "Modo não-strict deve prover plano sintetizado");
  assert.equal(result.telemetry.finalPlanParsed, false, "finalPlanParsed deve marcar false para indicar que houve recuperação");
  assert.equal(result.plan.action, "reply");
  assert.equal(result.plan.responsibleSubagent, undefined);
});

test("runOpenAiBrainTurn no strict mode (strictOpenAiPilot: true) TEM SUCESSO quando plano é válido", async () => {
  const validPlan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "resposta direta válida do Brain único",
    responses: ["tô bemm, e vc?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  };

  const mockRuntimeValid = {
    callOpenAiAgent: async () => ({
      plan: validPlan,
      tokens: 80,
    }),
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_strict_success",
    currentStageId: "stage_01",
    inboundMessages: ["Tudo bem?"],
    recentMessages: [],
    runtime: mockRuntimeValid,
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.action, "reply");
  assert.deepEqual(result.plan.responses, ["tô bemm, e vc?"]);
  assert.equal(result.plan.responsibleSubagent, undefined);
  assert.equal(result.telemetry.finalPlanParsed, true);
});

test("runOpenAiBrainTurn valida com sucesso o novo plano unificado de turno único (action: 'reply' e responses)", async () => {
  const singleTurnPlan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "Acolhimento caloroso e reciprocidade",
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 2,
    },
    responses: ["Oi tudo bem", "Como vc tá por aí?"],
  };

  const mockRuntimeValid = {
    callOpenAiAgent: async () => ({
      plan: singleTurnPlan,
      tokens: 95,
    }),
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_single_turn",
    currentStageId: "stage_01",
    inboundMessages: ["Oi Larissa"],
    recentMessages: [],
    runtime: mockRuntimeValid,
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.action, "reply");
  assert.deepEqual(result.plan.responses, ["Oi tudo bem", "Como vc tá por aí?"]);
  assert.ok(result.plan.missionPackage, "bloco de compatibilidade do contrato deve permanecer disponível");
  assert.equal(result.telemetry.finalPlanParsed, true);
});
