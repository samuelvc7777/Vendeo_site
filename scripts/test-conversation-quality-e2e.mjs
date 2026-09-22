#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  runOpenAiBrainTurn,
  validateConversationBrainPlan,
  buildOpenAiBrainContextMessage,
} from "../supabase/functions/api/openai_brain.ts";
import { normalizeBrainTurnContract } from "../supabase/functions/api/ConversationQualityGate.ts";
import { buildObjectiveCandidateEvidence } from "../supabase/functions/api/brain_orchestrator.ts";

const subagents = [
  { id: "descoberta", name: "Descoberta", mission: "Aprofundar assuntos" },
  { id: "conexao_inicial", name: "Conexão", mission: "Criar conexão" },
];

function plan(overrides = {}) {
  return {
    action: "delegate_mission",
    responsibleSubagent: "descoberta",
    objectiveDecision: "none",
    liveStatePatch: {},
    missionPackage: {
      subagentId: "descoberta",
      objectiveDirective: "none",
      conversationIntent: "reagir ao assunto atual",
      emotionalTone: "interessada",
      currentTopic: "assunto atual",
      bestHook: "gancho específico",
      curiosityOpportunity: "aprofundar só se for natural",
      questionRecommendation: "none",
      relevantPersonaFacts: [],
      turnContract: {
        directQuestions: [], mustAnswerFirst: false, newQuestionBudget: 0,
        responseShape: "free_conversation", maxBalloons: 2, preferNoEmoji: false,
      },
    },
    ...overrides,
  };
}

async function runScenario(name, inbound, brainPlan, expectTool = false) {
  let toolCalls = 0;
  const result = await runOpenAiBrainTurn({
    supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
    conversationId: `shadow_${name}`,
    currentStageId: "stage_2_descoberta",
    inboundMessages: [inbound],
    recentMessages: [{ sender: "user", text: inbound }],
    availableSubagents: subagents,
    strictOpenAiPilot: true,
    runtime: {
      callOpenAiAgent: async ({ executeTool }) => {
        if (expectTool) { toolCalls++; await executeTool("persona_memory_search", { query: "enfermagem", limit: 2 }); }
        return { tokens: 10, plan: brainPlan };
      },
    },
  });
  assert.equal(result.success, true, `${name}: plano estrutural válido`);
  assert.equal(Boolean(result.telemetry.toolsRequested.length), expectTool, `${name}: uso de memória esperado`);
  return result.plan;
}

test("quality E2E: oito decisões do Brain em shadow", async () => {
  const hobby = await runScenario("hobby", "Eu gosto muito de motocross", plan({ missionPackage: { ...plan().missionPackage, bestHook: "motocross", questionRecommendation: "qual parte te prende mais no motocross?", relevantPersonaFacts: [{ fact: "Larissa admira esportes radicais", memoryId: "pm_1", origin: "persona_memory", reason: "conexão com motocross" }], turnContract: { ...plan().missionPackage.turnContract, newQuestionBudget: 1 } } }), true);
  assert.equal(hobby.missionPackage.relevantPersonaFacts.length, 1, "hobby leva apenas fato relevante");

  const nurse = await runScenario("nurse", "Sou enfermeiro", plan({ missionPackage: { ...plan().missionPackage, bestHook: "profissão em comum", relevantPersonaFacts: [{ fact: "Larissa cursa Enfermagem", memoryId: "pm_2", origin: "persona_memory", reason: "afinidade profissional" }] } }), true);
  assert.equal(nurse.missionPackage.bestHook, "profissão em comum");

  const both = await runScenario("nurse_hobby", "Sou enfermeiro e curto motocross", plan({ missionPackage: { ...plan().missionPackage, bestHook: "afinidade profissional", questionRecommendation: "qual parte do motocross te chama mais?" } }), false);
  assert.match(both.missionPackage.bestHook, /profissional/);

  const vent = await runScenario("vent", "Meu dia foi horrível, meu chefe me estressou demais", plan({ objectiveDecision: "defer", missionPackage: { ...plan().missionPackage, objectiveDirective: "defer", emotionalTone: "acolhedora", questionRecommendation: "none" } }));
  assert.equal(vent.objectiveDecision, "defer");

  const city = await runScenario("city", "Sou de Barbacena", plan({ objectiveDecision: "already_satisfied", satisfiedObjectiveId: "goal_city", evidenceMessageId: "m_city" }));
  assert.equal(city.objectiveDecision, "already_satisfied");

  const study = await runScenario("study", "Você faz faculdade de quê?", plan({ missionPackage: { ...plan().missionPackage, turnContract: { ...plan().missionPackage.turnContract, directQuestions: [{ id: "q", text: "Você faz faculdade de quê?", mustAnswer: true, answerIntent: "responder", answerKind: "persona_fact", requiredFacts: ["Enfermagem"] }], mustAnswerFirst: true } } }), true);
  assert.equal(study.missionPackage.turnContract.mustAnswerFirst, true);

  await runScenario("greeting", "Oii, tudo bem?", plan({ responsibleSubagent: "conexao_inicial", missionPackage: { ...plan().missionPackage, subagentId: "conexao_inicial" } }), false);
  const travel = await runScenario("travel", "Eu trabalho viajando o estado inteiro", plan({ missionPackage: { ...plan().missionPackage, bestHook: "rotina de viagens", questionRecommendation: "qual cidade te surpreendeu mais trabalhando?", turnContract: { ...plan().missionPackage.turnContract, newQuestionBudget: 1 } } }));
  assert.match(travel.missionPackage.questionRecommendation, /cidade/);
});

test("autoridade: backend valida subagente, evidência e QualityGate sem substituir", () => {
  assert.equal(validateConversationBrainPlan(plan({ responsibleSubagent: "conexao_inicial" }), subagents).valid, true);
  assert.equal(validateConversationBrainPlan(plan({ responsibleSubagent: "invasor" }), subagents).valid, false, "subagente não autorizado é rejeitado");
  const candidates = buildObjectiveCandidateEvidence([{ objectiveId: "goal_city", memoryEntity: "self", memoryField: "city", field: "city", value: "Barbacena", evidenceMessageId: "m1", summary: "cidade revelada" }]);
  assert.deepEqual(candidates, [{ objectiveId: "goal_city", evidenceMessageId: "m1", summary: "cidade revelada" }], "heurística vira somente evidência");
  const contract = normalizeBrainTurnContract({ newQuestionBudget: 1, responseShape: "react_and_question", maxBalloons: 2 });
  assert.equal(contract.newQuestionBudget, 1, "teto técnico não remove pergunta natural do Brain");
  const source = fs.readFileSync("supabase/functions/api/experimental_orchestrator.ts", "utf8");
  assert.match(source, /conversation_quality_observe_only=true/, "QualityGate registra lint no caminho OpenAI");
  assert.match(source, /brain_subagent_rejected_unauthorized/, "não há substituição silenciosa de subagente");
  const brainSource = fs.readFileSync("supabase/functions/api/openai_brain.ts", "utf8");
  assert.match(brainSource, /\[\.\.\.items\]\.reverse\(\)\.find/, "Agents API seleciona a última resposta final válida");
});

test("prompt: PersonaMemory é sob demanda e recebe evidência candidata", () => {
  const context = buildOpenAiBrainContextMessage({ supabase: {}, conversationId: "shadow", currentStageId: "stage", inboundMessages: ["Sou de Barbacena"], recentMessages: [], availableSubagents: subagents, candidateEvidence: [{ objectiveId: "goal_city", evidenceMessageId: "m1", summary: "cidade revelada" }] });
  assert.match(context, /NÃO CONCLUEM NADA SOZINHAS/);
  assert.match(context, /Não use a ferramenta mecanicamente em saudações simples/);
});

test("strict: ocorre no máximo um retry estrutural e nunca fallback semântico", async () => {
  let calls = 0;
  const result = await runOpenAiBrainTurn({
    supabase: {}, conversationId: "strict_retry", currentStageId: "stage", inboundMessages: ["oi"], recentMessages: [], availableSubagents: subagents, strictOpenAiPilot: true,
    runtime: { callOpenAiAgent: async () => ({ tokens: 1, plan: ++calls === 1 ? { action: "delegate_mission" } : plan() }) },
  });
  assert.equal(calls, 2, "um feedback de schema gera exatamente uma segunda tentativa");
  assert.equal(result.success, true);
});
