import test from "node:test";
import assert from "node:assert/strict";
import { validateObjectiveProgressionInvariant } from "../supabase/functions/api/openai_brain.ts";

test("Cenário 1: Plano com decision='defer' e deferralReason='strong_live_topic' e opportunity='semantic_bridge' deve ser válido", () => {
  const plan = {
    action: "reply",
    objectiveDecision: "defer",
    objectiveDeferralReason: "strong_live_topic",
    objectiveProgressionOpportunity: "semantic_bridge",
    responses: ["sou nascida aqui simm kkk", "e vc mora aqui faz tempo?"],
    outboundActions: [
      { type: "text", text: "sou nascida aqui simm kkk" },
      { type: "text", text: "e vc mora aqui faz tempo?" }
    ]
  };

  const params = {
    currentObjectiveId: "goal_job",
    currentObjectiveRequired: true,
    currentObjectiveKind: "fact"
  };

  const validation = validateObjectiveProgressionInvariant(plan, params);
  assert.equal(validation.valid, true, `Validação falhou: ${validation.error}`);
  assert.equal(plan.objectiveProgressionOpportunity, "none");
});

test("Cenário 2: Plano com decision='defer' e deferralReason='emotional_priority' e opportunity='natural_transition' deve ser válido", () => {
  const plan = {
    action: "reply",
    objectiveDecision: "defer",
    objectiveDeferralReason: "emotional_priority",
    objectiveProgressionOpportunity: "natural_transition",
    responses: ["tadinho, descansa um pouco agr"],
    outboundActions: [
      { type: "text", text: "tadinho, descansa um pouco agr" }
    ]
  };

  const params = {
    currentObjectiveId: "goal_1790861876963_d8oti",
    currentObjectiveRequired: true,
    currentObjectiveKind: "action"
  };

  const validation = validateObjectiveProgressionInvariant(plan, params);
  assert.equal(validation.valid, true, `Validação falhou: ${validation.error}`);
  assert.equal(plan.objectiveProgressionOpportunity, "none");
});

test("Cenário 3: Plano com decision='defer' e deferralReason='no_natural_transition' mas alegando oportunidade deve acusar contradição", () => {
  const plan = {
    action: "reply",
    objectiveDecision: "defer",
    objectiveDeferralReason: "no_natural_transition",
    objectiveProgressionOpportunity: "semantic_bridge",
    responses: ["conversa"],
    outboundActions: [{ type: "text", text: "conversa" }]
  };

  const params = {
    currentObjectiveId: "goal_job",
    currentObjectiveRequired: true,
    currentObjectiveKind: "fact"
  };

  const validation = validateObjectiveProgressionInvariant(plan, params);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /PLAN_OBJECTIVE_OPPORTUNITY_IGNORED/);
});

test("Cenário 4: Plano com decision='defer' sem deferralReason deve falhar", () => {
  const plan = {
    action: "reply",
    objectiveDecision: "defer",
    responses: ["conversa"],
    outboundActions: [{ type: "text", text: "conversa" }]
  };

  const params = {
    currentObjectiveId: "goal_job",
    currentObjectiveRequired: true,
    currentObjectiveKind: "fact"
  };

  const validation = validateObjectiveProgressionInvariant(plan, params);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /PLAN_OBJECTIVE_DEFER_WITHOUT_REASON/);
});
