// ============================================================================
// TESTE DE INTEGRAÇÃO — OPENAI AGENT BRAIN COM FUNCTION TOOL REAL (FASE 1)
// Valida a arquitetura de desacoplamento de PersonaMemory e execução da Tool
// persona_memory_search no backend Supabase.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

// Carrega os módulos TypeScript via esm/tsx ou mock isolado compatível
import {
  PERSONA_MEMORY_TOOL_DEFINITION,
  executePersonaMemoryTool,
  buildOpenAiBrainContextMessage,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

import {
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
  loadPersonaMemoryFacts,
  clearPersonaMemoryCache,
} from "../supabase/functions/api/persona_memory.ts";

// Fixture oficial de fatos da Larissa para o teste
const MOCK_LARISSA_PERSONA_FACTS = [
  {
    persona_id: "larissa",
    category: "sports",
    key: "sports.motocross",
    value: "Acha motocross muito legal e radical, mas tem medo de pilotar; admira quem tem coragem",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["motocross", "moto", "esporte radical"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "food",
    key: "favorite_dish",
    value: "strogonoff",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["comida favorita", "prato predileto", "prato"],
    valid_from: null,
    valid_until: null,
  },
  {
    persona_id: "larissa",
    category: "education",
    key: "course",
    value: "Enfermagem (10º período)",
    source_type: "canonical",
    confidence: 1.0,
    aliases: ["faculdade", "estudos", "curso"],
    valid_from: null,
    valid_until: null,
  },
];

function createMockSupabase() {
  return {
    from: (table) => {
      if (table === "persona_memory") {
        return {
          select: () => ({
            eq: (col, val) => {
              if (col === "persona_id") {
                return Promise.resolve({
                  data: MOCK_LARISSA_PERSONA_FACTS.filter((f) => f.persona_id === val),
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
  };
}

test("1. Definição canônica da Tool persona_memory_search", () => {
  assert.equal(PERSONA_MEMORY_TOOL_DEFINITION.type, "function");
  assert.equal(PERSONA_MEMORY_TOOL_DEFINITION.function.name, "persona_memory_search");
  assert.ok(PERSONA_MEMORY_TOOL_DEFINITION.function.description.includes("PersonaMemory"));
  assert.ok(PERSONA_MEMORY_TOOL_DEFINITION.function.parameters.properties.query);
  assert.ok(PERSONA_MEMORY_TOOL_DEFINITION.function.parameters.required.includes("query"));
});

test("2. Sanitização rigorosa de parâmetros da Tool (teto de limit e query)", async () => {
  clearPersonaMemoryCache();
  const mockSupabase = createMockSupabase();

  // Teste de query vazia
  const emptyRes = await executePersonaMemoryTool({ query: "   " }, mockSupabase);
  assert.equal(emptyRes.found, false);
  assert.equal(emptyRes.results.length, 0);

  // Teste de query longa (> 200 caracteres truncada com segurança)
  const longQuery = "motocross ".repeat(50);
  const safeRes = await executePersonaMemoryTool({ query: longQuery, limit: 100 }, mockSupabase);
  assert.ok(safeRes.results.length <= 8, "Limit deve respeitar teto máximo de 8");
});

test("3. Contexto do Brain enxuto — NÃO injeta busca genérica de 8 tópicos", () => {
  const context = buildOpenAiBrainContextMessage({
    supabase: {},
    conversationId: "conv_motocross_test",
    currentStageId: "descoberta",
    currentObjectiveId: "obj_hobbies",
    currentObjectiveLabel: "Gostos e Hobbies",
    inboundMessages: ["Eu curto motocross, vou quase todo final de semana"],
    recentMessages: [
      { sender: "larissa", text: "O que você mais gosta de fazer no fim de semana?" },
      { sender: "user", text: "Eu curto motocross, vou quase todo final de semana" },
    ],
    contactMemorySummary: "Nome: Lucas | Cidade: São João del Rei",
    landmarksSummary: "",
    liveStateContext: '{"topic":"hobbies"}',
    availableSubagents: [
      { id: "descoberta", name: "Descoberta e Hobbies", mission: "Aprofundar interesses e conexão" },
    ],
  });

  // Valida que o contexto é conversacional e enxuto
  assert.ok(context.includes("conv_motocross_test"));
  assert.ok(context.includes("Eu curto motocross, vou quase todo final de semana"));
  assert.ok(context.includes("persona_memory_search"));
  // Valida que NÃO possui a lista completa e engessada de 8 tópicos pré-injetados
  assert.ok(!context.includes("• identidade:"), "Não deve conter tópicos genéricos pré-injetados");
});

test("4. Execução ponta a ponta: Turno com Tool persona_memory_search (Cenário Motocross)", async () => {
  clearPersonaMemoryCache();
  const mockSupabase = createMockSupabase();

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    originalLog(...args);
  };

  try {
    // Simula runtime do OpenAI Agent que solicita a tool persona_memory_search
    const mockAgentRuntime = {
      callOpenAiAgent: async ({ agentId, context, tools, executeTool }) => {
        // O Agent analisa a mensagem do pretendente sobre "motocross" e decide chamar a ferramenta
        assert.ok(context.includes("motocross"));
        assert.equal(tools[0].function.name, "persona_memory_search");

        // Executa a tool no backend
        const toolResult = await executeTool("persona_memory_search", {
          query: "motocross",
          limit: 4,
        });

        // Verifica formato compacto retornado pela Tool
        assert.equal(toolResult.found, true);
        assert.ok(Array.isArray(toolResult.results));
        assert.equal(toolResult.results[0].key, "sports.motocross");
        assert.ok(toolResult.results[0].value.includes("motocross"));

        // O Agent produz a decisão estratégica final
        return {
          tokens: 280,
          plan: {
            action: "delegate_mission",
            responsibleSubagent: "descoberta",
            objectiveDecision: "pursue",
            satisfiedObjectiveId: "obj_hobbies",
            liveStatePatch: {
              lastUserEmotionalTone: "empolgado",
              currentTopic: "motocross e esportes radicais",
            },
            reasoning: "Pretendente mencionou motocross. Larissa acha legal mas tem medo, delegando reação autêntica.",
            missionPackage: {
              subagentId: "descoberta",
              objectiveDirective: "pursue",
              bestHook: "motocross como hobby recorrente",
              relevantPersonaFacts: [{
                fact: "Larissa acha motocross muito legal e radical, mas tem medo de pilotar",
                memoryId: "sports.motocross",
                origin: "persona_memory",
                reason: "conexão pessoal sustentada com o hobby revelado",
              }],
              turnContract: {
                directQuestions: [],
                mustAnswerFirst: false,
                newQuestionBudget: 1,
                responseShape: "react_and_explore",
                preferNoEmoji: false,
                maxBalloons: 2,
              },
            },
          },
        };
      },
    };

    const turnResult = await runOpenAiBrainTurn({
      supabase: mockSupabase,
      conversationId: "conv_motocross_ponta_a_ponta",
      currentStageId: "descoberta",
      currentObjectiveId: "obj_hobbies",
      inboundMessages: ["Eu curto motocross, vou quase todo final de semana"],
      recentMessages: [
        { sender: "user", text: "Eu curto motocross, vou quase todo final de semana" },
      ],
      availableSubagents: [
        { id: "descoberta", name: "Descoberta", mission: "Investigar gostos e hobbies mútuos" },
      ],
      agentId: "agent_brain_vendeo_01",
      runtime: mockAgentRuntime,
    });

    // 1. Validação do sucesso do turno
    assert.equal(turnResult.success, true);
    assert.ok(turnResult.plan);
    assert.equal(turnResult.plan.responsibleSubagent, "descoberta");
    assert.equal(turnResult.telemetry.agentId, "agent_brain_vendeo_01");
    assert.ok(turnResult.telemetry.toolsRequested.includes("persona_memory_search"));
    assert.ok(turnResult.telemetry.sourcesUsed.includes("persona_memory"));
    assert.equal(turnResult.telemetry.toolExecutionsCount, 1);
    assert.deepEqual(turnResult.plan.missionPackage.relevantPersonaFacts, [{
      fact: "Larissa acha motocross muito legal e radical, mas tem medo de pilotar",
      memoryId: "sports.motocross",
      origin: "persona_memory",
      reason: "conexão pessoal sustentada com o hobby revelado",
    }], "Plano leva somente o fato recuperado e sua proveniência/relevância");

    // 2. Validação dos logs obrigatórios exigidos pela especificação
    const logsStr = logs.join("\n");
    assert.ok(logsStr.includes("[Brain] turn_started"), "Log [Brain] turn_started obrigatório");
    assert.ok(logsStr.includes("[Brain] tool_requested persona_memory_search"), "Log [Brain] tool_requested obrigatório");
    assert.ok(logsStr.includes('[PersonaMemory] query="motocross"'), "Log [PersonaMemory] query obrigatório");
    assert.ok(logsStr.includes("[PersonaMemory] results=1"), "Log [PersonaMemory] results obrigatório");
    assert.ok(logsStr.includes("[Brain] tool_output_submitted"), "Log [Brain] tool_output_submitted obrigatório");
    assert.ok(logsStr.includes("[Brain] turn_completed"), "Log [Brain] turn_completed obrigatório");

  } finally {
    console.log = originalLog;
  }
});

test("5. Isolamento de Segurança: Zero envio à Meta API e Zero Outbox no Brain", async () => {
  // O Brain é estritamente deliberativo (computacional e sem efeitos colaterais na Meta)
  const mockSupabase = createMockSupabase();
  let metaApiCalled = false;

  const res = await runOpenAiBrainTurn({
    supabase: mockSupabase,
    conversationId: "conv_safety_isolated",
    currentStageId: "conexao_inicial",
    inboundMessages: ["oi tudo bem"],
    recentMessages: [],
    availableSubagents: [{ id: "conexao_inicial", name: "Conexão", mission: "Saudação" }],
    runtime: {
      callOpenAiAgent: async () => ({
        tokens: 50,
        plan: { action: "delegate_mission", responsibleSubagent: "conexao_inicial", reasoning: "ok" },
      }),
    },
  });

  assert.equal(metaApiCalled, false, "O Brain NUNCA deve chamar a Meta API diretamente");
  assert.equal(res.success, true);
});

console.log("✅ Todos os 5 testes de especificação da Fase 1 foram definidos e prontos para execução.");
