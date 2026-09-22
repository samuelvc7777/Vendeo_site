import test from "node:test";
import assert from "node:assert/strict";
import {
  validateConversationBrainPlan,
  buildFallbackBrainPlan,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

test("validateConversationBrainPlan valida rigorosamente a estrutura do plano", () => {
  const subagents = [
    { id: "subagent_conexao_inicial", name: "Conexão", mission: "Iniciar rapport" },
    { id: "subagent_engajamento", name: "Engajamento", mission: "Aprofundar conversa" },
  ];

  // 1. Rejeita nulo / não objeto
  assert.equal(validateConversationBrainPlan(null, subagents).valid, false);
  assert.equal(validateConversationBrainPlan("string", subagents).valid, false);

  // 2. Rejeita action incorreta
  assert.equal(
    validateConversationBrainPlan({ action: "send_message" }, subagents).valid,
    false
  );

  // 3. Rejeita subagente não listado
  const unknownSubagentPlan = {
    action: "delegate_mission",
    responsibleSubagent: "subagent_inexistente",
    missionPackage: {
      turnContract: {
        mustAnswerFirst: true,
        newQuestionBudget: 1,
        responseShape: "answer_and_reciprocate",
      },
    },
  };
  const unknownRes = validateConversationBrainPlan(unknownSubagentPlan, subagents);
  assert.equal(unknownRes.valid, false);
  assert.match(unknownRes.error, /não pertence aos subagentes disponíveis/);

  // 4. Rejeita turnContract inválido
  const invalidContractPlan = {
    action: "delegate_mission",
    responsibleSubagent: "subagent_conexao_inicial",
    missionPackage: {
      turnContract: {
        mustAnswerFirst: "not_boolean",
        newQuestionBudget: "1",
        responseShape: "",
      },
    },
  };
  assert.equal(validateConversationBrainPlan(invalidContractPlan, subagents).valid, false);

  // 5. Aceita plano válido
  const validPlan = {
    action: "delegate_mission",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "none",
    missionPackage: {
      subagentId: "subagent_conexao_inicial",
      objectiveDirective: "none",
      turnContract: {
        directQuestions: [],
        mustAnswerFirst: true,
        newQuestionBudget: 1,
        responseShape: "answer_and_reciprocate",
        preferNoEmoji: false,
        maxBalloons: 2,
      },
    },
  };
  assert.equal(validateConversationBrainPlan(validPlan, subagents).valid, true);
});

test("runOpenAiBrainTurn no strict mode (strictOpenAiPilot: true) FALHA e não sintetiza plano se inválido", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];

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
    availableSubagents: subagents,
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
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];

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
    availableSubagents: subagents,
    runtime: mockRuntimeInvalid,
    strictOpenAiPilot: false,
  });

  assert.equal(result.success, true, "Modo não-strict deve recuperar graciosamente");
  assert.ok(result.plan, "Modo não-strict deve prover plano sintetizado");
  assert.equal(result.telemetry.finalPlanParsed, false, "finalPlanParsed deve marcar false para indicar que houve recuperação");
  assert.equal(result.plan.responsibleSubagent, "subagent_conexao_inicial");
});

test("runOpenAiBrainTurn no strict mode (strictOpenAiPilot: true) TEM SUCESSO quando plano é válido", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];

  const validPlan = {
    action: "delegate_mission",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "none",
    missionPackage: {
      subagentId: "subagent_conexao_inicial",
      objectiveDirective: "none",
      turnContract: {
        directQuestions: [],
        mustAnswerFirst: true,
        newQuestionBudget: 1,
        responseShape: "answer_and_reciprocate",
        preferNoEmoji: false,
        maxBalloons: 2,
      },
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
    availableSubagents: subagents,
    runtime: mockRuntimeValid,
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.plan, validPlan);
  assert.equal(result.telemetry.finalPlanParsed, true);
});
