import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersistentTurnContext,
  validateQuestionIntentsInvariant,
} from "../supabase/functions/api/openai_brain.ts";
import {
  buildPersistentAgentInstructions,
  QUESTION_INTENTS_CONTRACT_EXAMPLE,
} from "../supabase/functions/api/openai_agent_instructions.ts";

const validQuestionIntent = {
  responseIndex: 1,
  intentKey: "discover.age",
  canonicalMeaning: "descobrir a idade do pretendente",
  kind: "discovery",
  target: "pretendente",
};

test("questionIntents canônico válido usa responseIndex=1", () => {
  const result = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["tudo bem", "e você tem quantos anos?"],
    questionIntents: [validQuestionIntent],
  });

  assert.deepEqual(result, { valid: true });
});

test("pergunta sem anotação é rejeitada", () => {
  const result = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["tudo bem", "e você tem quantos anos?"],
    questionIntents: [],
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /^PLAN_MISSING_QUESTION_INTENTS:/);
});

test("responseIndex inexistente é rejeitado", () => {
  const result = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["tudo bem?"],
    questionIntents: [{ ...validQuestionIntent, responseIndex: 1 }],
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /^PLAN_INVALID_QUESTION_INTENTS:/);
});

test("formato legado id/question/objectiveId é rejeitado", () => {
  const result = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["tudo bem", "e você tem quantos anos?"],
    questionIntents: [{ id: "age", question: "idade", objectiveId: "discover.age" }],
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /^PLAN_INVALID_QUESTION_INTENTS:/);
});

test("kind inválido é rejeitado pelo mesmo contrato do prompt", () => {
  const result = validateQuestionIntentsInvariant({
    action: "reply",
    responses: ["tudo bem", "e você tem quantos anos?"],
    questionIntents: [{ ...validQuestionIntent, kind: "new_kind" }],
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /kind deve ser/);
});

test("contexto persistente e instruções usam exatamente o exemplo canônico em TypeScript", () => {
  const context = buildPersistentTurnContext({
    currentInboundMessages: ["oi"],
  });
  const instructions = buildPersistentAgentInstructions();

  assert.ok(context.includes('"questionIntents": []'));
  assert.ok(context.includes(QUESTION_INTENTS_CONTRACT_EXAMPLE));
  assert.ok(instructions.includes(QUESTION_INTENTS_CONTRACT_EXAMPLE));
  for (const field of ["responseIndex", "intentKey", "canonicalMeaning", "kind", "target"]) {
    assert.match(context, new RegExp(`"${field}"`));
    assert.match(instructions, new RegExp(`"${field}"`));
  }
});
