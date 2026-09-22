import test from "node:test";
import assert from "node:assert/strict";
import {
  LARISSA_INTERACTION_DNA,
  LARISSA_INTERACTION_DNA_VERSION,
  LARISSA_INTERACTION_DNA_HASH,
  formatRecentStyleStateForPrompt,
} from "../supabase/functions/api/larissa_interaction_dna.ts";
import {
  buildOpenAiBrainContextMessage,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

test("LARISSA_INTERACTION_DNA possui versão estável e hash válido", () => {
  assert.equal(LARISSA_INTERACTION_DNA_VERSION, "1.0.0");
  assert.ok(LARISSA_INTERACTION_DNA_HASH.startsWith("dna_v1_0_0_"));
  assert.ok(LARISSA_INTERACTION_DNA.includes("=== LARISSA_INTERACTION_DNA (v1.0.0) ==="));
  assert.ok(LARISSA_INTERACTION_DNA.includes("ZERO PAPAGAIO"));
  assert.ok(LARISSA_INTERACTION_DNA.includes("FEW-SHOTS COMPORTAMENTAIS"));
});

test("formatRecentStyleStateForPrompt formata restrições dinâmicas de anti-repetição e emoji", () => {
  // Caso 8: se emojiRecentHistory tem emoji recente ou budget = 0 -> teto zero
  const snippetZeroEmoji = formatRecentStyleStateForPrompt(
    { recent_reactions: ["nossa"], recent_emojis: ["🥰"] },
    { budget: 0, allowEmoji: false, blockedEmojis: ["🥰"], recentEmojis: ["🥰"] }
  );
  assert.ok(snippetZeroEmoji.includes("Teto de emoji neste turno: 0"));
  assert.ok(snippetZeroEmoji.includes('Última reação de abertura: "nossa" (varie a abertura'));
  assert.ok(snippetZeroEmoji.includes("🥰"));

  // Se permite emoji
  const snippetAllow = formatRecentStyleStateForPrompt(
    { recent_reactions: [], recent_emojis: [] },
    { budget: 1, allowEmoji: true, blockedEmojis: [], recentEmojis: [] }
  );
  assert.ok(snippetAllow.includes("máximo 1 emoji se for estritamente natural"));
});

test("CASO 1: Saudação direta deve gerar resposta curta, natural, sem ponto final e sem emoji por padrão", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "pursue",
    reasoning: "Saudação leve e recíproca",
    responses: ["oiii", "tô simm e vc?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: false,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_1",
    currentStageId: "stage_conexao",
    inboundMessages: ["Oii, tudo bem?"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 60 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.responses.length, 2);
  for (const b of result.plan.responses) {
    assert.ok(!b.endsWith("."), "Balão não deve terminar com ponto final");
    assert.ok(!b.includes("!"), "Balão não deve conter exclamação");
    assert.ok(!/[\uD800-\uDFFF]/.test(b), "Zero emoji por padrão em saudação");
  }
});

test("CASO 2: Mensagem seca permite cutucada meiga sem textão e sem SAC", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "none",
    reasoning: "Ele foi seco, cutuca de leve",
    responses: ["nossa que animação kkkkk"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 0,
      responseShape: "tease",
      preferNoEmoji: true,
      maxBalloons: 1,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_2",
    currentStageId: "stage_conexao",
    inboundMessages: ["blz"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 40 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.responses[0], "nossa que animação kkkkk");
  assert.ok(result.plan.responses[0].length < 35, "Sem textão para mensagem seca");
});

test("CASO 3: Cantada precoce aplica postura de moça de família e limite meigo", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "none",
    reasoning: "Cantada invasiva, corta com moça de família",
    responses: ["vai sonhando kkkkk", "sou moça de família"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 0,
      responseShape: "limit",
      preferNoEmoji: true,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_3",
    currentStageId: "stage_conexao",
    inboundMessages: ["vem dormir comigo"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 50 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.ok(result.plan.responses.some((r) => r.includes("moça de família") || r.includes("vai sonhando")));
});

test("CASO 4: Assunto sério/hospital prioriza acolhimento sem risadas automáticas nem metas forçadas", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "defer",
    reasoning: "Mãe no hospital, momento pede acolhimento humano total",
    responses: ["tadinho, sinto muito", "vai dar tudo certo se Deus quiser, se precisar conversar tô aqui"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 0,
      responseShape: "comfort",
      preferNoEmoji: true,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_4",
    currentStageId: "stage_conexao",
    inboundMessages: ["tô destruído hoje, minha mãe tá no hospital"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 60 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "defer");
  for (const b of result.plan.responses) {
    assert.ok(!b.toLowerCase().includes("kkk"), "PROIBIDO risada em assunto sério/hospital");
    assert.ok(!b.includes("!"), "Sem exclamação");
  }
});

test("CASO 5: Fato pessoal com PersonaMemory relevante compartilha afinidade curta sem despejar biografia", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "pursue",
    reasoning: "Enfermagem confirmada na memória",
    relevantPersonaFacts: [{ fact: "Estuda enfermagem e faz estágio em hospital", origin: "persona_memory" }],
    memoryConsulted: true,
    responses: ["faço estágio em hospital tbm, estudo enfermagem", "vc trabalha em qual área?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "answer_and_reciprocate",
      preferNoEmoji: true,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_5",
    currentStageId: "stage_conexao",
    inboundMessages: ["sou enfermeiro"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: {
      callOpenAiAgent: async ({ executeTool }) => {
        await executeTool("persona_memory_search", { query: "enfermagem hospital" });
        return { plan: mockPlan, tokens: 80 };
      },
    },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.telemetry.actualMemoryToolCalled, true);
  assert.ok(result.plan.responses[0].length < 60, "Compartilhamento curto, sem monólogo");
});

test("CASO 6: Fato pessoal sem PersonaMemory reage com curiosidade sem inventar vivência própria", async () => {
  const subagents = [{ id: "subagent_conexao_inicial", name: "Conexão", mission: "Conectar" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "subagent_conexao_inicial",
    objectiveDecision: "pursue",
    reasoning: "Sem fatos de motocross na memória, apenas reage ao assunto",
    relevantPersonaFacts: [],
    memoryConsulted: true,
    responses: ["gente do céu kkk", "deve dar uma adrenalina absurda, não tem medo não?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 1,
      responseShape: "react_and_ask",
      preferNoEmoji: true,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_dna_case_6",
    currentStageId: "stage_conexao",
    inboundMessages: ["adoro motocross"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: {
      callOpenAiAgent: async ({ executeTool }) => {
        await executeTool("persona_memory_search", { query: "motocross moto" });
        return { plan: mockPlan, tokens: 75 };
      },
    },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  const text = result.plan.responses.join(" ");
  assert.ok(!text.includes("nunca andei"), "Não inventa negação categórica");
  assert.ok(!text.includes("eu ando"), "Não inventa falsa afinidade");
});

test("CASO 9: Lista negra proíbe termos de SAC, gírias masculinas pesadas e 'trampo'", () => {
  const blacklisted = [
    "trampo",
    "trampar",
    "brother",
    "parça",
    "mano",
    "firmeza",
    "daora",
    "top",
    "topzera",
    "compreendo perfeitamente",
    "que bacana saber disso",
    "fico muito feliz em",
    "de fato",
    "inclusive",
  ];

  for (const term of blacklisted) {
    const isForbiddenInDna = LARISSA_INTERACTION_DNA.toLowerCase().includes(term.toLowerCase());
    assert.ok(isForbiddenInDna, `Termo da lista negra '${term}' deve constar no LARISSA_INTERACTION_DNA como proibido`);
  }
});
