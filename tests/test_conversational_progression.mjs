import test from "node:test";
import assert from "node:assert/strict";
import {
  LARISSA_INTERACTION_DNA,
  LARISSA_INTERACTION_DNA_VERSION,
  LARISSA_INTERACTION_DNA_HASH,
} from "../supabase/functions/api/larissa_interaction_dna.ts";
import {
  buildOpenAiBrainContextMessage,
  runOpenAiBrainTurn,
} from "../supabase/functions/api/openai_brain.ts";

test("CONTRATO 0: Metadados do DNA e princípios de Progressão Oportunística", () => {
  assert.match(LARISSA_INTERACTION_DNA_VERSION, /^1\.\d+\.\d+$/);
  assert.equal(LARISSA_INTERACTION_DNA_HASH, "dna_v1_5_8_1ff730ca");
  assert.ok(LARISSA_INTERACTION_DNA.includes("Progressão Oportunística"));
  assert.ok(LARISSA_INTERACTION_DNA.includes("CONVERSATIONAL MOMENTUM"));
  assert.ok(LARISSA_INTERACTION_DNA.includes("acknowledgements vazios"));
  assert.ok(LARISSA_INTERACTION_DNA.includes("REGRA UNIVERSAL DE BEM-ESTAR EM TODA SAUDAÇÃO"));
});

test("CONTRATO 1: Saudação + objetivo cidade pendente -> pode pursue de forma fluida", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "pursue",
    reasoning: "Saudação recíproca respondida e avanço de objetivo cidade na mesma abertura",
    responses: ["Tô bem tbm, obrigada", "E vc é de onde?"],
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
    conversationId: "conv_test_progression_1",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: true,
    currentObjectiveDescription: "Descobrir onde mora ou contexto geográfico",
    inboundMessages: ["Oii, estou bem sim e vc?"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 60 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "pursue");
  assert.ok(result.plan.responses.length <= 2);
  assert.ok(result.plan.responses.some((r) => /onde/i.test(r) || /mora/i.test(r)));
});

test("CONTRATO 2: Ack social 'ah que bom rs' + objetivo pendente -> não gerar acknowledgement vazio ('bom saber')", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "pursue",
    reasoning: "Mensagem fática sem novo tópico, aproveita abertura para avançar cidade sem loop de ack",
    responses: ["E vc é de onde?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 1,
      responseShape: "ask_objective",
      preferNoEmoji: true,
      maxBalloons: 1,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_progression_2",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: false, // Mesmo opcional!
    currentObjectiveDescription: "Descobrir onde mora ou contexto geográfico",
    inboundMessages: ["Ah que bom rs"],
    recentMessages: [
      { sender: "user", text: "Oii, estou bem sim e vc?" },
      { sender: "larissa", text: "Tô bem tbm, obrigada" },
      { sender: "user", text: "Ah que bom rs" },
    ],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 55 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "pursue");
  // Proibido respostas secas de acknowledgement vazio como "bom saber"
  for (const r of result.plan.responses) {
    assert.ok(!/^bom saber$/i.test(r.trim()), "PROIBIDO responder apenas 'bom saber'");
    assert.ok(!/^entendi$/i.test(r.trim()), "PROIBIDO responder apenas 'entendi'");
    assert.ok(!/^que bom$/i.test(r.trim()), "PROIBIDO responder apenas 'que bom'");
  }
});

test("CONTRATO 3: Desabafo + objetivo pendente -> defer (acolhimento vem primeiro)", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "defer",
    reasoning: "Mãe internada, momento exige acolhimento humano total",
    responses: ["Tadinho, sinto muito", "Vai dar tudo certo com ela se Deus quiser"],
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
    conversationId: "conv_test_progression_3",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: true,
    inboundMessages: ["minha mãe tá internada, tô super preocupado"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 60 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "defer");
  // Não deve forçar pergunta de cidade
  for (const r of result.plan.responses) {
    assert.ok(!/onde você mora/i.test(r));
    assert.ok(!/de onde vc é/i.test(r));
  }
});

test("CONTRATO 4: Tópico substantivo interessante + objetivo pendente -> pode defer", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "defer",
    reasoning: "Ele contou sobre a viagem à praia, aprofunda no tópico vivo antes de puxar cidade",
    responses: ["Nossa que delícia kkk", "Aproveitou bastante o sol?"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: "react_and_ask",
      preferNoEmoji: true,
      maxBalloons: 2,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_progression_4",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: true,
    inboundMessages: ["fui pra praia esse fim de semana"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 60 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "defer");
});

test("CONTRATO 5: Cidade espontaneamente informada -> already_satisfied", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "already_satisfied",
    satisfiedObjectiveId: "goal_city",
    evidenceMessageId: "msg_inbound_barbacena",
    reasoning: "Ele revelou espontaneamente que mora em Barbacena",
    responses: ["Barbacena é pertinho daqui né"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 0,
      responseShape: "comment",
      preferNoEmoji: true,
      maxBalloons: 1,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_progression_5",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: true,
    inboundMessages: ["moro em Barbacena, e vc?"],
    currentInboundMessages: [
      { id: "msg_inbound_barbacena", text: "moro em Barbacena, e vc?" },
    ],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 65 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "already_satisfied");
  assert.equal(result.plan.satisfiedObjectiveId, "goal_city");
});

test("CONTRATO 6: Cidade já conhecida -> não perguntar novamente / none", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "none",
    reasoning: "Cidade já conhecida pelo ContactMemory, sem objetivo ativo pendente",
    responses: ["Pois é kkk"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 0,
      responseShape: "react",
      preferNoEmoji: true,
      maxBalloons: 1,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_progression_6",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: null, // Sem objetivo pendente
    currentObjectiveLabel: null,
    contactMemorySummary: "• city: Juiz de Fora",
    inboundMessages: ["pois é"],
    recentMessages: [],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 45 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "none");
});

test("CONTRATO 7: Pergunta sobre cidade feita recentemente -> não repetir / defer", async () => {
  const subagents = [{ id: "conexao_inicial", name: "Conexão Inicial", mission: "Conectar e quebrar o gelo" }];
  const mockPlan = {
    action: "reply",
    responsibleSubagent: "conexao_inicial",
    objectiveDecision: "defer",
    reasoning: "Já perguntei onde ele mora no turno anterior e ele ainda não respondeu, não repetir",
    responses: ["Pois é kkk"],
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: false,
      newQuestionBudget: 0,
      responseShape: "wait_or_react",
      preferNoEmoji: true,
      maxBalloons: 1,
    },
  };

  const result = await runOpenAiBrainTurn({
    supabase: {},
    conversationId: "conv_test_progression_7",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_city",
    currentObjectiveLabel: "Cidade",
    currentObjectiveRequired: true,
    inboundMessages: ["sim"],
    recentMessages: [
      { sender: "larissa", text: "e vc é de onde?" },
      { sender: "user", text: "sim" },
    ],
    availableSubagents: subagents,
    runtime: { callOpenAiAgent: async () => ({ plan: mockPlan, tokens: 50 }) },
    strictOpenAiPilot: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.objectiveDecision, "defer");
  for (const r of result.plan.responses) {
    assert.ok(!/de onde/i.test(r), "Não deve repetir pergunta recém-feita");
  }
});
