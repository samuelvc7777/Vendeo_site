#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { runOpenAiBrainTurn } from "../supabase/functions/api/openai_brain.ts";

const subagents = [{ id: "conexao_inicial", name: "Conexão", mission: "Conversar" }];
const basePlan = (overrides = {}) => ({
  action: "delegate_mission",
  responsibleSubagent: "conexao_inicial",
  objectiveDecision: "defer",
  liveStatePatch: {},
  missionPackage: {
    subagentId: "conexao_inicial",
    objectiveDirective: "defer",
    conversationIntent: "acolher o assunto",
    emotionalTone: "leve",
    currentTopic: "profissão",
    bestHook: "gancho",
    curiosityOpportunity: "aprofundar",
    questionRecommendation: "none",
    relevantPersonaFacts: [],
    memoryConsulted: false,
    memoryRationale: "saudação trivial",
    turnContract: { directQuestions: [], mustAnswerFirst: false, newQuestionBudget: 0, responseShape: "free_conversation", maxBalloons: 1, preferNoEmoji: true },
  },
  ...overrides,
});

const run = (runtime) => runOpenAiBrainTurn({
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
  conversationId: "tool_execution_invariant",
  currentStageId: "conexao_inicial",
  inboundMessages: ["Sou enfermeiro."],
  recentMessages: [],
  availableSubagents: subagents,
  strictOpenAiPilot: true,
  runtime,
});

test("rejeita plano que descreve consulta futura sem tool call", async () => {
  let attempts = 0;
  const result = await run({ callOpenAiAgent: async () => ({ tokens: 1, plan: basePlan({
    missionPackage: { ...basePlan().missionPackage, memoryConsulted: true, memoryRationale: "vou consultar depois", personaMemoryQuery: "enfermagem", conversationIntent: "consultar PersonaMemory e então responder" },
  }) }) });
  attempts += 1;
  assert.equal(result.success, false, "strict mode deve falhar fechado após retry estrutural");
});

test("aceita fato grounded quando a tool foi executada", async () => {
  const result = await run({ callOpenAiAgent: async ({ executeTool }) => {
    await executeTool("persona_memory_search", { query: "enfermagem profissão", limit: 2 });
    return { tokens: 1, plan: basePlan({ missionPackage: {
      ...basePlan().missionPackage,
      memoryConsulted: true,
      memoryRationale: "busca executada para checar afinidade profissional",
      personaMemoryQuery: "enfermagem profissão",
      relevantPersonaFacts: [{ fact: "Larissa cursa Enfermagem", memoryId: "pm_1", origin: "persona_memory", reason: "afinidade profissional" }],
    } }) };
  } });
  assert.equal(result.success, true);
  assert.equal(result.telemetry.toolsRequested.includes("persona_memory_search"), true);
});

test("aceita saudação sem tool call quando o plano declara consulta desnecessária", async () => {
  const result = await run({ callOpenAiAgent: async () => ({ tokens: 1, plan: basePlan() }) });
  assert.equal(result.success, true);
  assert.equal(result.telemetry.toolsRequested.length, 0);
});
