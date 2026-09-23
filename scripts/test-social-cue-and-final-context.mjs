import assert from "node:assert/strict";
import test from "node:test";
import { buildBudgetedRecentContext } from "../supabase/functions/api/brain_orchestrator.ts";
import {
  buildOpenAiBrainContextMessage,
  validateConversationBrainPlan,
  validateResponseGenerationInvariant,
} from "../supabase/functions/api/openai_brain.ts";
import * as openAiBrain from "../supabase/functions/api/openai_brain.ts";
import { SOCIAL_CUE_AND_DELTA_GUIDANCE } from "../supabase/functions/api/brain_conversation_guidance.ts";
import { buildCanonicalAgentInstructions, VENDEO_AGENT_INSTRUCTIONS_VERSION } from "../supabase/functions/api/openai_agent_instructions.ts";

const fixture = [
  { id: "larissa-age", sender: "larissa", text: "tenho 23, obrigada 😊", createdAt: "2026-09-22T22:40:00-03:00" },
  { id: "larissa-reciprocity", sender: "larissa", text: "vou cobrar esse esbarrão kkkkk e vc tem quantos?", createdAt: "2026-09-22T22:40:05-03:00" },
  { id: "inbound-age", sender: "pretendente", text: "Tenho 26 anos meu bem", createdAt: "2026-09-22T22:40:10-03:00" },
];

test("o Agent recebe a janela final com as duas outbound recentes e o inbound uma única vez", () => {
  const currentInbound = fixture[2];
  const budgeted = buildBudgetedRecentContext({
    messages: fixture,
    claimedMessageIds: [currentInbound.id],
    candidateCount: fixture.length,
  });
  const built = openAiBrain.buildOpenAiBrainContextMessageWithObservability({
    conversationId: "fixture-social-context",
    currentStageId: "descoberta",
    currentObjectiveId: "idade",
    currentObjectiveLabel: "Descobrir idade",
    inboundMessages: [currentInbound.text],
    currentInboundMessages: [{
      id: currentInbound.id,
      text: currentInbound.text,
      createdAt: currentInbound.createdAt,
    }],
    recentMessages: budgeted.messages.map((message) => ({
      id: message.id,
      sender: message.sender === "pretendente" ? "user" : "larissa",
      text: message.text,
      createdAt: message.createdAt,
    })),
    contextPipeline: {
      candidateCount: budgeted.candidateCount,
      deduplicatedCount: budgeted.deduplicatedCount,
      budgetedCount: budgeted.budgetedCount,
      messageLimitCut: budgeted.messageLimitCut,
      tokenBudgetCut: budgeted.tokenBudgetCut,
      mandatoryTokenOverflow: budgeted.mandatoryTokenOverflow,
      lastLarissaOutboundId: budgeted.lastLarissaOutboundId,
      mandatoryMessageIds: budgeted.mandatoryMessageIds,
      replyTargetIds: budgeted.replyTargetIds,
    },
  });
  const context = built.contextMessage;

  assert.ok(context.includes('[Larissa | id="larissa-age"'));
  assert.ok(context.includes("tenho 23, obrigada 😊"));
  assert.ok(context.includes('[Larissa | id="larissa-reciprocity"'));
  assert.ok(context.includes("vou cobrar esse esbarrão kkkkk e vc tem quantos?"));
  assert.ok(context.includes('[MENSAGEM id="inbound-age"'));
  assert.equal(context.split("Tenho 26 anos meu bem").length - 1, 1, "o inbound atual não pode duplicar janela recente e bloco inbound");
  assert.ok(context.indexOf('id="larissa-age"') < context.indexOf('id="larissa-reciprocity"'));
  assert.ok(context.indexOf('id="larissa-reciprocity"') < context.indexOf('id="inbound-age"'));
  assert.equal(budgeted.candidateCount, fixture.length);
  assert.equal(budgeted.deduplicatedCount, fixture.length);
  assert.equal(budgeted.budgetedCount, fixture.length);
  assert.equal(built.contextWindow.includedCount, fixture.length);
  assert.deepEqual(built.contextWindow.includedMessages.map((message) => message.sender), ["Larissa", "Larissa", "Pretendente"]);
  assert.equal(built.contextWindow.includedMessages[0].timestamp, fixture[0].createdAt);
  assert.equal(built.contextWindow.lastLarissaOutboundId, "larissa-reciprocity");
  assert.equal(built.contextWindow.lastLarissaOutboundIncluded, true);
  assert.equal(built.contextWindow.mandatoryCount, 2);
  assert.ok(built.contextWindow.finalMandatoryMessageIds.includes("inbound-age"));
  assert.equal(built.contextWindow.currentInboundDuplicateCount, 1, "a janela recente continha o inbound, que foi removido antes de anexar o bloco inbound");
  assert.deepEqual(built.contextWindow.cuts, {
    messageLimit: false,
    tokenBudget: false,
    finalCharacters: false,
    messageTextLimit: false,
    mandatoryTokenOverflow: false,
  });
});

test("o runtime do Agent recebe o mesmo contexto que a telemetria descreve", async () => {
  assert.equal(typeof openAiBrain.buildOpenAiBrainContextMessageWithObservability, "function");
  assert.equal(typeof openAiBrain.runOpenAiBrainTurn, "function");
  let sentContext = "";
  const currentInbound = fixture[2];
  const result = await openAiBrain.runOpenAiBrainTurn({
    supabase: {},
    conversationId: "fixture-runtime-payload",
    currentStageId: "descoberta",
    currentObjectiveId: "idade",
    currentObjectiveLabel: "Descobrir idade",
    inboundMessages: [currentInbound.text],
    currentInboundMessages: [{ id: currentInbound.id, text: currentInbound.text, createdAt: currentInbound.createdAt }],
    recentMessages: fixture.map((message) => ({
      id: message.id,
      sender: message.sender === "pretendente" ? "user" : "larissa",
      text: message.text,
      createdAt: message.createdAt,
    })),
    runtime: {
      async callOpenAiAgent({ context }) {
        sentContext = context;
        return {
          plan: {
            action: "reply",
            objectiveDecision: "already_satisfied",
            satisfiedObjectiveId: "idade",
            evidenceMessageId: currentInbound.id,
            responses: ["Que legal 😊"],
            turnContract: {
              directQuestions: [],
              mustAnswerFirst: false,
              newQuestionBudget: 1,
              responseShape: "free_conversation",
              maxBalloons: 1,
            },
          },
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.telemetry.contextWindow?.includedCount, 3);
  assert.ok(sentContext.includes("tenho 23, obrigada 😊"));
  assert.ok(sentContext.includes("vou cobrar esse esbarrão kkkkk e vc tem quantos?"));
  assert.equal(sentContext.split("Tenho 26 anos meu bem").length - 1, 1);
  assert.ok(sentContext.indexOf('id="larissa-age"') < sentContext.indexOf('id="larissa-reciprocity"'));
  assert.ok(sentContext.indexOf('id="larissa-reciprocity"') < sentContext.indexOf('id="inbound-age"'));
  assert.equal(result.telemetry.contextWindow?.lastLarissaOutboundIncluded, true);
});

function makeRecentMessage(index, { sender = "user", text = `mensagem normal ${index}` } = {}) {
  return {
    id: `message-${index}`,
    sender,
    text,
    createdAt: new Date(Date.UTC(2026, 8, 23, 12, 0, index)).toISOString(),
  };
}

function buildFinalWindow(recentMessages, { mandatoryMessageIds = [], replyTargetIds = [], lastLarissaOutboundId = null } = {}) {
  return openAiBrain.buildOpenAiBrainContextMessageWithObservability({
    conversationId: "fixture-mandatory-context",
    currentStageId: "descoberta",
    inboundMessages: [],
    currentInboundMessages: [],
    recentMessages,
    contextPipeline: {
      candidateCount: recentMessages.length,
      deduplicatedCount: recentMessages.length,
      budgetedCount: recentMessages.length,
      messageLimitCut: false,
      tokenBudgetCut: false,
      mandatoryTokenOverflow: false,
      lastLarissaOutboundId,
      mandatoryMessageIds,
      replyTargetIds,
    },
  });
}

test("o corte de 20 preserva outbound obrigatória e remove primeiro mensagens normais antigas", () => {
  const recentMessages = [
    makeRecentMessage(0, { sender: "larissa", text: "última outbound obrigatória" }),
    ...Array.from({ length: 25 }, (_, index) => makeRecentMessage(index + 1)),
  ];
  const built = buildFinalWindow(recentMessages, {
    mandatoryMessageIds: ["message-0"],
    lastLarissaOutboundId: "message-0",
  });

  assert.match(built.contextMessage, /última outbound obrigatória/);
  assert.doesNotMatch(built.contextMessage, /id="message-1"/);
  assert.equal(built.contextWindow.includedCount, 20);
  assert.equal(built.contextWindow.lastLarissaOutboundIncluded, true);
  assert.equal(built.contextWindow.droppedNonMandatoryCount, 6);
  assert.equal(built.contextWindow.cutByMessageLimit, true);
});

test("o corte de caracteres remove mensagens normais antes da outbound obrigatória", () => {
  const recentMessages = [
    makeRecentMessage(0, { sender: "larissa", text: `outbound preservada ${"L".repeat(580)}` }),
    ...Array.from({ length: 15 }, (_, index) => makeRecentMessage(index + 1, { text: `normal ${"N".repeat(580)}` })),
  ];
  const built = buildFinalWindow(recentMessages, {
    mandatoryMessageIds: ["message-0"],
    lastLarissaOutboundId: "message-0",
  });

  assert.match(built.contextMessage, /outbound preservada/);
  assert.equal(built.contextWindow.lastLarissaOutboundIncluded, true);
  assert.equal(built.contextWindow.cuts.finalCharacters, true);
  assert.equal(built.contextWindow.cutByCharLimit, true);
  assert.ok(built.contextWindow.droppedNonMandatoryCount > 0);
  assert.ok(built.contextWindow.windowCharacterCount <= 9000);
});

test("reply target e outbound sobrevivem juntos ao corte quando há mensagens descartáveis", () => {
  const target = makeRecentMessage(0, { sender: "larissa", text: "reply target que precisa permanecer" });
  const recentMessages = [
    target,
    ...Array.from({ length: 23 }, (_, index) => makeRecentMessage(index + 1)),
    makeRecentMessage(24, { sender: "larissa", text: "última outbound mais recente" }),
  ];
  const inbound = { ...makeRecentMessage(25), sender: "user", replyToMessageId: target.id };
  const budgeted = buildBudgetedRecentContext({
    messages: [...recentMessages, inbound],
    claimedMessageIds: [inbound.id],
  });
  const built = buildFinalWindow(budgeted.messages.map((message) => ({
    id: message.id,
    sender: message.sender === "pretendente" ? "user" : "larissa",
    text: message.text,
    createdAt: message.createdAt,
  })), {
    mandatoryMessageIds: budgeted.mandatoryMessageIds,
    replyTargetIds: budgeted.replyTargetIds,
    lastLarissaOutboundId: budgeted.lastLarissaOutboundId,
  });

  assert.ok(budgeted.replyTargetIds.includes(target.id));
  assert.ok(budgeted.mandatoryMessageIds.includes(target.id));
  assert.ok(budgeted.mandatoryMessageIds.includes("message-24"));
  assert.ok(budgeted.mandatoryMessageIds.includes(inbound.id));
  assert.ok(built.contextMessage.includes("reply target que precisa permanecer"));
  assert.ok(built.contextMessage.includes("última outbound mais recente"));
  assert.equal(built.contextWindow.replyTargetRequiredCount, 1);
  assert.equal(built.contextWindow.replyTargetsIncludedCount, 1);
  assert.equal(built.contextWindow.lastLarissaOutboundRequired, true);
  assert.equal(built.contextWindow.lastLarissaOutboundIncluded, true);
});

test("overflow de contexto composto só por obrigatórias é explícito e não descarta nenhuma", () => {
  const recentMessages = Array.from({ length: 15 }, (_, index) => makeRecentMessage(index, {
    sender: index === 14 ? "larissa" : "user",
    text: `obrigatória ${index} ${"X".repeat(580)}`,
  }));
  const mandatoryMessageIds = recentMessages.map((message) => message.id);
  const built = buildFinalWindow(recentMessages, {
    mandatoryMessageIds,
    lastLarissaOutboundId: "message-14",
  });

  assert.equal(built.contextWindow.mandatoryContextOverflow, true);
  assert.equal(built.contextWindow.includedCount, recentMessages.length);
  assert.equal(built.contextWindow.mandatoryCount, recentMessages.length);
  assert.equal(built.contextWindow.cuts.mandatoryTokenOverflow, false);
  for (const message of recentMessages) assert.ok(built.contextMessage.includes(message.id));
});

test("overflow acima de 20 mensagens obrigatórias é visível e preserva todas", () => {
  const recentMessages = Array.from({ length: 21 }, (_, index) => makeRecentMessage(index, {
    text: `contexto obrigatório ${index}`,
  }));
  const built = buildFinalWindow(recentMessages, {
    mandatoryMessageIds: recentMessages.map((message) => message.id),
  });

  assert.equal(built.contextWindow.mandatoryContextOverflow, true);
  assert.equal(built.contextWindow.cutByMessageLimit, true);
  assert.equal(built.contextWindow.includedCount, 21);
  for (const message of recentMessages) assert.ok(built.contextMessage.includes(message.id));
});

test("orientação do Agent diferencia função social, conteúdo principal, delta novo e repetição própria", () => {
  const context = buildOpenAiBrainContextMessage({
    conversationId: "fixture-social-guidance",
    currentStageId: "descoberta",
    currentObjectiveId: "idade",
    currentObjectiveLabel: "Descobrir idade",
    inboundMessages: ["Tenho 26 anos meu bem"],
    recentMessages: [],
  });

  assert.match(context, /elogio direto/i);
  assert.match(context, /vocativo|forma de tratamento/i);
  assert.match(context, /conteúdo principal|intenção global/i);
  assert.match(context, /delta novo|informação nova/i);
  assert.match(context, /não repita|não reencene/i);
  assert.match(context, /social cue|sinal social secundário/i);
  assert.match(context, /socialCueInterpretation/);
  assert.match(context, /selfFactRepeatedRisk/);
});

test("exemplos contrastivos ficam na orientação sem criar classificador determinístico", () => {
  const canonical = buildCanonicalAgentInstructions();
  const examples = [
    "vc é linda",
    "vc tem quantos anos, linda?",
    "boa noite meu bem",
    "nossa linda, vc é maravilhosa",
    "amor, vc mora onde?",
    "tenho 26 anos meu bem",
    "vc tem 26, e se vc continuar assim vou acabar apaixonando",
  ];
  for (const example of examples) assert.ok(SOCIAL_CUE_AND_DELTA_GUIDANCE.toLowerCase().includes(example.toLowerCase()), `exemplo contrastivo ausente: ${example}`);
  assert.ok(canonical.includes(SOCIAL_CUE_AND_DELTA_GUIDANCE));
  assert.ok(VENDEO_AGENT_INSTRUCTIONS_VERSION === "2.8.2" || VENDEO_AGENT_INSTRUCTIONS_VERSION === "2.9.0" || VENDEO_AGENT_INSTRUCTIONS_VERSION === "2.9.1" || VENDEO_AGENT_INSTRUCTIONS_VERSION === "2.9.2");
  assert.doesNotMatch(SOCIAL_CUE_AND_DELTA_GUIDANCE, /includes\s*\(\s*["'`](?:linda|amor|meu bem)/i);
});

test("observabilidade social opcional não invalida o plano conversacional", () => {
  const basePlan = {
    action: "reply",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "idade",
    evidenceMessageId: "inbound-age",
    responses: ["Que legal, 26 😊"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 1,
      responseShape: "free_conversation",
      maxBalloons: 1,
    },
  };
  const withTelemetry = {
    ...basePlan,
    socialCueInterpretation: {
      primaryIntent: "answer_age",
      socialCueType: "vocative",
      socialCueExpression: "meu bem",
      requiresExplicitAcknowledgement: false,
    },
    selfFactRepeatedRisk: false,
  };

  assert.equal(validateConversationBrainPlan(withTelemetry).valid, true);
  assert.equal(validateResponseGenerationInvariant(withTelemetry).valid, true);
});
