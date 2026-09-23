import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAiBrainContextMessage,
  validateConversationBrainPlan,
  validateResponseGenerationInvariant,
} from "../supabase/functions/api/openai_brain.ts";

test("contexto do Brain inclui anti-papagaio, ponte natural e regras de defer", () => {
  const context = buildOpenAiBrainContextMessage({
    conversationId: "schema-check",
    currentStageId: "stage-check",
    currentObjectiveId: "objective-check",
    currentObjectiveLabel: "objetivo atual",
    inboundMessages: [],
    recentMessages: [],
    contactMemorySummary: "",
    landmarksSummary: "",
    liveStateContext: "",
  });

  assert.match(context, /não devolva apenas uma paráfrase/i);
  assert.match(context, /procure uma ponte semântica entre o assunto atual e o objetivo ativo/i);
  assert.match(context, /Use defer se não houver ponte genuína/i);
  assert.match(context, /objectiveBridgeDetected/);
  assert.match(context, /objectiveBridgeEvidence/);
  assert.match(context, /coveredHooks/);
  assert.match(context, /ignoredRelevantHooks/);
});

test("campos de observabilidade são opcionais e não invalidam o plano existente", () => {
  const basePlan = {
    action: "reply",
    objectiveDecision: "defer",
    responses: ["resposta"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 1,
      responseShape: "free_conversation",
      maxBalloons: 1,
    },
  };
  assert.equal(validateConversationBrainPlan({ ...basePlan }).valid, true);
  assert.equal(validateResponseGenerationInvariant({ ...basePlan }).valid, true);

  const planWithTelemetry = {
    ...basePlan,
    objectiveBridgeDetected: true,
    objectiveBridgeEvidence: "evidência curta",
    coveredHooks: ["gancho usado"],
    ignoredRelevantHooks: [],
  };
  assert.equal(validateConversationBrainPlan(planWithTelemetry).valid, true);
  assert.equal(validateResponseGenerationInvariant(planWithTelemetry).valid, true);
});
