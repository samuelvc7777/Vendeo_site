import test from "node:test";
import assert from "node:assert/strict";
import {
  validateConversationBrainPlan,
  buildFallbackBrainPlan,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

const contract = {
  directQuestions: [],
  mustAnswerFirst: true,
  newQuestionBudget: 1,
  responseShape: "answer_and_reciprocate",
  preferNoEmoji: false,
  maxBalloons: 2,
};

test("validateConversationBrainPlan aceita somente o contrato do Brain único", () => {
  assert.equal(validateConversationBrainPlan(null).valid, false);
  assert.equal(validateConversationBrainPlan({ action: "delegate_mission" }).valid, false);

  const validPlan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "Resposta direta e natural",
    turnContract: contract,
    responses: ["Oi, tudo bem"],
  };
  const result = validateConversationBrainPlan(validPlan);
  assert.equal(result.valid, true);
  assert.equal(validPlan.missionPackage?.turnContract, contract);
});

test("buildFallbackBrainPlan permanece fail-closed e não cria delegação", () => {
  const fallback = buildFallbackBrainPlan("texto sem JSON");
  assert.equal(fallback.action, "reply");
  assert.deepEqual(fallback.responses, []);
  assert.equal("responsibleSubagent" in fallback, false);
  assert.equal("subagentId" in fallback.missionPackage, false);
});

test("runOpenAiBrainTurn em strict mode falha sem sintetizar resposta", async () => {
  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_strict",
    currentStageId: "stage_01",
    inboundMessages: ["Oi"],
    recentMessages: [],
    runtime: { callOpenAiAgent: async () => ({ plan: null, tokens: 50 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.plan, null);
  assert.equal(result.telemetry.finalPlanParsed, false);
});

test("runOpenAiBrainTurn aceita o plano unificado de turno único", async () => {
  const plan = {
    action: "reply",
    objectiveDecision: "none",
    reasoning: "Acolhimento caloroso",
    turnContract: contract,
    responses: ["Oi tudo bem", "Como vc tá por aí?"],
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_single_turn",
    currentStageId: "stage_01",
    inboundMessages: ["Oi Larissa"],
    recentMessages: [],
    runtime: { callOpenAiAgent: async () => ({ plan, tokens: 95 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.action, "reply");
  assert.deepEqual(result.plan.responses, plan.responses);
  assert.equal(result.telemetry.finalPlanParsed, true);
});
