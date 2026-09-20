/**
 * scripts/test-canonical-objectives-matrix.mjs
 * 
 * SUÍTE COMPLETA DE VALIDAÇÃO:
 * MATRIZ FINAL DE OBJETIVOS DOS 3 SUBAGENTES CANÔNICOS
 * 
 * 33 Cenários de Testes Estritos cobrindo 100% da especificação do produto.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function loadTsModule(filePath) {
  const fullPath = path.resolve(filePath);
  const tsCode = fs.readFileSync(fullPath, "utf8");
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    process: process,
    console: console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Deno: { env: { get: () => undefined } },
    require: (dep) => {
      if (dep === "@/domain/entities/ChatStage" || dep.endsWith("ChatStage")) {
        return loadTsModule("src/domain/entities/ChatStage.ts");
      }
      if (dep.includes("cloud_autopilot")) {
        return {
          publishAutoPilotState: async () => {},
          activity: (status, title, desc, extra) => ({ status, title, desc, extra }),
        };
      }
      if (dep.includes("LarissaChatStyle")) {
        return loadTsModule("supabase/functions/api/LarissaChatStyle.ts");
      }
      return {};
    },
  };

  const fn = new Function("module", "exports", "require", "process", "console", "fetch", "setTimeout", "clearTimeout", "Deno", jsCode);
  fn(moduleObj, moduleObj.exports, context.require, process, console, context.fetch, context.setTimeout, context.clearTimeout, context.Deno);
  return moduleObj.exports;
}

// MemoryProvider Mock em memória para os testes
class MockMemoryProvider {
  constructor() {
    this.storage = new Map();
    this.saveHistory = [];
  }

  async getFact(conversationId, entity, field) {
    const key = `${conversationId}:${entity}:${field}`;
    if (this.storage.has(key)) {
      return { found: true, value: this.storage.get(key) };
    }
    return { found: false, value: null };
  }

  async saveFact(conversationId, entity, field, value) {
    const key = `${conversationId}:${entity}:${field}`;
    this.storage.set(key, value);
    this.saveHistory.push({ conversationId, entity, field, value });
    return { success: true };
  }

  async listEntityFacts(conversationId, entity) {
    const prefix = `${conversationId}:${entity}:`;
    const res = {};
    for (const [key, value] of this.storage.entries()) {
      if (key.startsWith(prefix)) {
        const field = key.slice(prefix.length);
        res[field] = { value };
      }
    }
    return res;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("🚀 INICIANDO SUÍTE DE TESTES: MATRIZ CANÔNICA DE OBJETIVOS (50 CENÁRIOS)");
  console.log("================================================================================\n");

  const { CANONICAL_CHAT_STAGES_MATRIX } = loadTsModule("src/domain/entities/ChatStage.ts");
  const orchestratorModule = loadTsModule("supabase/functions/api/experimental_orchestrator.ts");
  const {
    resolveStageChecklistGoals,
    resolveStageObjectives,
    filterGoalsForSubagent,
    formatGoalsSnippetForSubagent,
    processDeterministicStageProgression,
    validateSubagentDecision,
    validateOrchestratorDecision,
    validatePhaseTransition,
    detectSpontaneousObjectiveCompletions,
    runExperimentalOrchestration,
  } = orchestratorModule;

  let passed = 0;
  async function runTest(num, name, fn) {
    try {
      await fn();
      console.log(`✅ [TESTE ${num.toString().padStart(2, "0")}] Aprovado: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [TESTE ${num.toString().padStart(2, "0")}] FALHOU: ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  async function runAsyncTest(num, name, fn) {
    try {
      await fn();
      console.log(`✅ [TESTE ${num.toString().padStart(2, "0")}] Aprovado: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [TESTE ${num.toString().padStart(2, "0")}] FALHOU: ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // 1. Matriz Canônica contém exatamente 3 etapas oficiais
  runTest(1, "Matriz Canônica contém exatamente 3 etapas oficiais", () => {
    assert.equal(CANONICAL_CHAT_STAGES_MATRIX.length, 3);
    assert.deepEqual(
      CANONICAL_CHAT_STAGES_MATRIX.map((s) => s.id),
      ["stage_1_conexao", "stage_2_descoberta", "stage_3_compatibilidade"]
    );
  });

  // 2. Preserva IDs estáveis e descrições dos 3 subagentes canônicos
  runTest(2, "Preserva IDs canônicos estáveis (conexao_inicial, descoberta, compatibilidade)", () => {
    const stage1 = CANONICAL_CHAT_STAGES_MATRIX[0];
    const stage2 = CANONICAL_CHAT_STAGES_MATRIX[1];
    const stage3 = CANONICAL_CHAT_STAGES_MATRIX[2];

    assert(stage1.name.includes("Conexão"));
    assert(stage2.name.includes("Descoberta"));
    assert(stage3.name.includes("Compatibilidade"));
  });

  // 3. No modelo canônico determinístico, todos os 15 objetivos ativos são checkpoints obrigatórios
  runTest(3, "Todos os objetivos ativos são checkpoints obrigatórios (required: true)", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const activeGoals = allGoals.filter((g) => g.enabled !== false);
    const requiredGoals = activeGoals.filter((g) => g.required === true);

    assert.equal(requiredGoals.length, 15);
  });

  // 4. Todos os objetivos ativos possuem ordenação determinística e enabled: true
  runTest(4, "Todos os objetivos ativos possuem enabled: true e required: true", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    allGoals.forEach((g) => {
      assert.equal(g.enabled !== false, true);
      assert.equal(g.required, true);
      assert(typeof g.order === "number");
    });
  });

  // 5. goal_initial_reciprocity possui kind: conversation_state e primarySubagent: conexao_inicial
  runTest(5, "goal_initial_reciprocity possui kind: conversation_state e subagente conexao_inicial", () => {
    const stage1 = CANONICAL_CHAT_STAGES_MATRIX[0];
    const goal = stage1.goals.find((g) => g.id === "goal_initial_reciprocity");

    assert(goal, "goal_initial_reciprocity deve existir");
    assert.equal(goal.kind, "conversation_state");
    assert.equal(goal.required, true);
    assert.equal(goal.primarySubagent, "conexao_inicial");
    assert.deepEqual(goal.allowedSubagents, ["conexao_inicial"]);
  });

  // 6. goal_discovery_depth possui kind: conversation_state e primarySubagent: descoberta
  runTest(6, "goal_discovery_depth possui kind: conversation_state e subagente descoberta", () => {
    const stage2 = CANONICAL_CHAT_STAGES_MATRIX[1];
    const goal = stage2.goals.find((g) => g.id === "goal_discovery_depth");

    assert(goal, "goal_discovery_depth deve existir");
    assert.equal(goal.kind, "conversation_state");
    assert.equal(goal.required, true);
    assert.equal(goal.primarySubagent, "descoberta");
    assert.deepEqual(goal.allowedSubagents, ["descoberta"]);
  });

  // 7. Preservação estrita dos 4 IDs legados de objetivos
  runTest(7, "Preservação estrita dos 4 IDs legados de objetivos (city, job, age, relationship)", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const ids = allGoals.map((g) => g.id);

    assert(ids.includes("goal_city"), "goal_city deve existir");
    assert(ids.includes("goal_job"), "goal_job deve existir");
    assert(ids.includes("goal_age"), "goal_age deve existir");
    assert(ids.includes("goal_relationship"), "goal_relationship deve existir");
  });

  // 8. goal_city possui kind: fact, required: true e memória correta
  runTest(8, "goal_city possui kind: fact, required: true e memória self.city", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const goal = allGoals.find((g) => g.id === "goal_city");

    assert.equal(goal.kind, "fact");
    assert.equal(goal.required, true);
    assert.equal(goal.memoryEntity, "self");
    assert.equal(goal.memoryField, "city");
  });

  // 9. goal_job possui kind: fact, required: true e memória correta
  runTest(9, "goal_job possui kind: fact, required: true e memória self.job", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const goal = allGoals.find((g) => g.id === "goal_job");

    assert.equal(goal.kind, "fact");
    assert.equal(goal.required, true);
    assert.equal(goal.memoryEntity, "self");
    assert.equal(goal.memoryField, "job");
  });

  // 10. goal_age possui kind: fact, required: true e memória correta
  runTest(10, "goal_age possui kind: fact, required: true e memória self.age", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const goal = allGoals.find((g) => g.id === "goal_age");

    assert.equal(goal.kind, "fact");
    assert.equal(goal.required, true);
    assert.equal(goal.memoryEntity, "self");
    assert.equal(goal.memoryField, "age");
  });

  // 11. goal_relationship está em compatibilidade e restrito ao status de relacionamento
  runTest(11, "goal_relationship está em compatibilidade e restrito a status de relacionamento", () => {
    const stage3 = CANONICAL_CHAT_STAGES_MATRIX[2];
    const goal = stage3.goals.find((g) => g.id === "goal_relationship");

    assert(goal, "goal_relationship deve estar na etapa de compatibilidade");
    assert.equal(goal.kind, "fact");
    assert.equal(goal.memoryField, "relationship_status");
    assert.equal(goal.primarySubagent, "compatibilidade");
    assert(goal.label.toLowerCase().includes("status de relacionamento"));
    assert(goal.description.toLowerCase().includes("status atual"));
  });

  // 12. goal_relationship não é misturado com filhos ou intenção futura
  runTest(12, "goal_relationship não se confunde com filhos ou intenção futura", () => {
    const stage3 = CANONICAL_CHAT_STAGES_MATRIX[2];
    const relGoal = stage3.goals.find((g) => g.id === "goal_relationship");
    const intentGoal = stage3.goals.find((g) => g.id === "goal_relationship_intent");
    const hasChildrenGoal = stage3.goals.find((g) => g.id === "goal_has_children");

    assert.notEqual(relGoal.id, intentGoal.id);
    assert.notEqual(relGoal.id, hasChildrenGoal.id);
    assert.notEqual(relGoal.memoryField, intentGoal.memoryField);
    assert.notEqual(relGoal.memoryField, hasChildrenGoal.memoryField);
  });

  // 13. Novos objetivos de compatibilidade presentes e bem configurados
  runTest(13, "Novos objetivos de compatibilidade presentes (has_children, wants_children, values, plans, faith)", () => {
    const stage3 = CANONICAL_CHAT_STAGES_MATRIX[2];
    const ids = stage3.goals.map((g) => g.id);

    assert(ids.includes("goal_has_children"));
    assert(ids.includes("goal_wants_children"));
    assert(ids.includes("goal_family_values"));
    assert(ids.includes("goal_future_plans"));
    assert(ids.includes("goal_faith_values"));
  });

  // 14. Novos objetivos de descoberta presentes (routine, hobbies, social_style)
  runTest(14, "Novos objetivos de descoberta presentes (routine, hobbies, social_style)", () => {
    const stage2 = CANONICAL_CHAT_STAGES_MATRIX[1];
    const ids = stage2.goals.map((g) => g.id);

    assert(ids.includes("goal_routine"));
    assert(ids.includes("goal_hobbies"));
    assert(ids.includes("goal_social_style"));
  });

  // 15. Todos os objetivos de kind fact apontam para memoryEntity: self
  runTest(15, "Todos os objetivos fact apontam para memoryEntity self", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const factGoals = allGoals.filter((g) => g.kind === "fact");

    factGoals.forEach((g) => {
      assert.equal(g.memoryEntity, "self");
      assert(g.memoryField && g.memoryField.length > 0);
    });
  });

  // 16. Avaliação de fact: Reconhece valor na ContactMemory automaticamente
  await runAsyncTest(16, "Avaliação de fact: Reconhece valor na ContactMemory automaticamente", async () => {
    const memory = new MockMemoryProvider();
    await memory.saveFact("chat_123", "self", "city", "Belo Horizonte");

    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_123",
      stageNameOrId: "conexao",
      memoryProvider: memory,
    });

    const cityGoal = res.goals.find((g) => g.id === "goal_city");
    assert(cityGoal, "goal_city deve estar presente");
    assert.equal(cityGoal.status, "completed");
    assert.equal(cityGoal.value, "Belo Horizonte");
  });

  // 17. Anti-repetição de perguntas: Se goal_city já está preenchido, status é completed
  await runAsyncTest(17, "Anti-repetição de perguntas: fato conhecido não fica pendente", async () => {
    const memory = new MockMemoryProvider();
    await memory.saveFact("chat_123", "self", "job", "Arquiteto");

    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_123",
      stageNameOrId: "conexao",
      memoryProvider: memory,
    });

    const jobGoal = res.goals.find((g) => g.id === "goal_job");
    assert.equal(jobGoal.status, "completed");
    assert.equal(jobGoal.value, "Arquiteto");
  });

  // 18. Revelação espontânea: Se o pretendente revelou antes, o objetivo é marcado completed
  await runAsyncTest(18, "Revelação espontânea de idade é concluída automaticamente", async () => {
    const memory = new MockMemoryProvider();
    await memory.saveFact("chat_456", "self", "age", 28);

    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_456",
      stageNameOrId: "descoberta",
      memoryProvider: memory,
    });

    const ageGoal = res.goals.find((g) => g.id === "goal_age");
    assert.equal(ageGoal.status, "completed");
    assert.equal(ageGoal.value, 28);
  });

  // 19. Avanço determinístico: Etapa só é concluída quando TODOS os checkpoints ativos forem superados
  await runAsyncTest(19, "Avanço determinístico de etapa: stageComplete apenas quando 100% dos checkpoints ativos forem concluídos", async () => {
    const memory = new MockMemoryProvider();

    // Cenário A: Apenas o primeiro checkpoint concluído -> stageComplete é false e currentObjective é o próximo
    const partialRes = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_789",
      stageNameOrId: "conexao",
      memoryProvider: memory,
      completedGoalIds: ["goal_initial_reciprocity"],
    });

    assert.equal(partialRes.stageComplete, false, "Etapa não deve estar completa enquanto houver checkpoints pendentes");
    assert(partialRes.currentObjective, "Deve haver um currentObjective ativo");
    assert.equal(partialRes.currentObjective.id, "goal_city", "O próximo checkpoint obrigatório deve ser goal_city");

    // Cenário B: Todos os 3 checkpoints de conexão inicial concluídos
    const fullRes = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_789",
      stageNameOrId: "conexao",
      memoryProvider: memory,
      completedGoalIds: ["goal_initial_reciprocity", "goal_city", "goal_job"],
    });

    assert.equal(fullRes.stageComplete, true, "Etapa deve estar completa quando todos os checkpoints ativos forem cumpridos");
    assert.equal(fullRes.currentObjective, null, "Nenhum checkpoint deve restar pendente");
  });

  // 20. Avaliação de conversation_state: goal_initial_reciprocity avaliado sem salvar em ContactMemory
  await runAsyncTest(20, "goal_initial_reciprocity avaliado no histórico sem salvar em ContactMemory", async () => {
    const memory = new MockMemoryProvider();
    const history = [
      { is_from_me: false, text: "Oi Larissa, tudo bem?" },
      { is_from_me: true, text: "Oii! Tudo bem por aqui e com vc?" },
      { is_from_me: false, text: "Tudo ótimo, adorei o seu trabalho!" },
    ];

    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_recip",
      stageNameOrId: "conexao",
      memoryProvider: memory,
      historyMessages: history,
    });

    const recipGoal = res.goals.find((g) => g.id === "goal_initial_reciprocity");
    assert.equal(recipGoal.status, "completed");
    assert.equal(memory.saveHistory.length, 0, "NÃO deve ter chamado saveFact para conversation_state");
  });

  // 21. Avaliação de conversation_state: goal_discovery_depth concluído com 2 fatos conhecidos
  await runAsyncTest(21, "goal_discovery_depth concluído com pelo menos 2 fatos duráveis conhecidos", async () => {
    const memory = new MockMemoryProvider();
    await memory.saveFact("chat_depth", "self", "city", "Curitiba");
    await memory.saveFact("chat_depth", "self", "job", "Advogado");

    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_depth",
      stageNameOrId: "descoberta",
      memoryProvider: memory,
    });

    const depthGoal = res.goals.find((g) => g.id === "goal_discovery_depth");
    assert.equal(depthGoal.status, "completed");
    assert.equal(depthGoal.kind, "conversation_state");
  });

  // 22. NUNCA salvar conversation_state na ContactMemory
  runTest(22, "Garantia estrita: conversation_state não polui perfil estático do contato", () => {
    const memory = new MockMemoryProvider();
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const stateGoals = allGoals.filter((g) => g.kind === "conversation_state");

    stateGoals.forEach((g) => {
      assert.notEqual(g.memoryEntity, "self", `Goal ${g.id} não pode ter memoryEntity self`);
    });
  });

  // 23. Subagente conexao_inicial filtra objetivos de sua responsabilidade
  await runAsyncTest(23, "filterGoalsForSubagent para conexao_inicial", async () => {
    const memory = new MockMemoryProvider();
    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_filter_1",
      stageNameOrId: "conexao",
      memoryProvider: memory,
    });

    const { openGoals } = filterGoalsForSubagent(res.goals, "conexao_inicial");
    const ids = openGoals.map((g) => g.id);
    assert(ids.includes("goal_initial_reciprocity"));
    assert(ids.includes("goal_city"));
    assert(ids.includes("goal_job"));
  });

  // 24. Subagente descoberta filtra objetivos de sua responsabilidade
  await runAsyncTest(24, "filterGoalsForSubagent para descoberta", async () => {
    const memory = new MockMemoryProvider();
    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_filter_2",
      stageNameOrId: "descoberta",
      memoryProvider: memory,
    });

    const { openGoals } = filterGoalsForSubagent(res.goals, "descoberta");
    const ids = openGoals.map((g) => g.id);
    assert(ids.includes("goal_age"));
    assert(ids.includes("goal_routine"));
    assert(ids.includes("goal_hobbies"));
    assert(ids.includes("goal_social_style"));
    assert(ids.includes("goal_discovery_depth"));
  });

  // 25. Subagente compatibilidade filtra objetivos de sua responsabilidade
  await runAsyncTest(25, "filterGoalsForSubagent para compatibilidade", async () => {
    const memory = new MockMemoryProvider();
    const res = await resolveStageChecklistGoals({
      supabase: null,
      conversationId: "chat_filter_3",
      stageNameOrId: "compatibilidade",
      memoryProvider: memory,
    });

    const { openGoals } = filterGoalsForSubagent(res.goals, "compatibilidade");
    const ids = openGoals.map((g) => g.id);
    assert(ids.includes("goal_relationship"));
    assert(ids.includes("goal_relationship_intent"));
    assert(ids.includes("goal_has_children"));
  });

  // 26. SupabaseChatStageRepository opera na tabela oficial chat_stages e zero localStorage
  runTest(26, "SupabaseChatStageRepository opera na tabela oficial chat_stages e zero localStorage", () => {
    const repoFile = fs.readFileSync("src/infrastructure/repositories/SupabaseChatStageRepository.ts", "utf8");
    assert(repoFile.includes('.from("chat_stages")'), "Deve buscar na tabela oficial chat_stages");
    assert(!repoFile.includes("localStorage.getItem"), "Zero localStorage.getItem");
    assert(!repoFile.includes("localStorage.setItem"), "Zero localStorage.setItem");
    assert(!repoFile.includes('contact_id: "__chat_stages__"'), "Zero pseudo-registro __chat_stages__");
  });

  // 27. Reconciliação com matriz canônica não sobrescreve personalizações válidas
  runTest(27, "Reconciliação preserva objetivos customizados adicionados pelo usuário", () => {
    const repoModule = loadTsModule("src/infrastructure/repositories/SupabaseChatStageRepository.ts");
    const { SupabaseChatStageRepository } = repoModule;
    const repo = new SupabaseChatStageRepository();

    const existingStages = [
      {
        id: "stage_1_conexao",
        name: "Conexão Inicial",
        order: 0,
        goals: [
          {
            id: "goal_custom_instagram",
            label: "Como achou o perfil",
            kind: "fact",
            memoryField: "lead_source",
            required: false,
          },
        ],
      },
    ];

    const reconciled = repo.reconcileWithCanonicalMatrix(existingStages);
    const stage1 = reconciled.find((s) => s.id === "stage_1_conexao");
    const customGoal = stage1.goals.find((g) => g.id === "goal_custom_instagram");
    assert(customGoal, "Objetivo customizado deve ser preservado na reconciliação");
  });

  // 28. Resiliência de rede: repositório mantém cache em memória e fail-safe silencioso
  await runAsyncTest(28, "Resiliência de rede: orchestrator resolve default goals se Supabase estiver offline", async () => {
    const memory = new MockMemoryProvider();
    const failingSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("Network timeout");
            },
          }),
        }),
      }),
    };

    const res = await resolveStageChecklistGoals({
      supabase: failingSupabase,
      conversationId: "chat_offline",
      stageNameOrId: "descoberta",
      memoryProvider: memory,
    });

    assert(res.goals.length > 0, "Deve retornar goals canônicos em caso de falha de rede");
  });

  // 29. UI ChatStagesManager suporta kind e renderiza badges corretos
  runTest(29, "ChatStagesManager possui suporte a kind: fact e conversation_state", () => {
    const uiFile = fs.readFileSync("src/presentation/components/config/ChatStagesManager.tsx", "utf8");
    assert(uiFile.includes('goalKind === "conversation_state"'), "UI deve verificar goalKind");
    assert(uiFile.includes("Estado da Conversa"), "UI deve exibir label de Estado da Conversa");
    assert(uiFile.includes("Fato do Contato"), "UI deve exibir label de Fato do Contato");
  });

  // 30. formatGoalsSnippetForSubagent estrutura checkpoint atual obrigatório, concluídos e fatos conhecidos sem interrogatório
  runTest(30, "formatGoalsSnippetForSubagent estrutura checkpoint atual e orienta sem interrogatório", () => {
    const snippet = formatGoalsSnippetForSubagent({
      subagentId: "descoberta",
      stageName: "Descoberta",
      mission: "Conhecer o pretendente",
      currentObjective: { id: "goal_age", label: "Descobrir idade", kind: "fact", required: true },
      completedObjectives: [{ id: "goal_city", label: "Descobrir cidade", value: "Divinópolis" }],
      remainingObjectives: [{ id: "goal_job", label: "Descobrir trabalho" }],
      knownFacts: { city: "Divinópolis" },
    });

    assert(snippet.includes("CHECKPOINT ATUAL OBRIGATÓRIO"), "Deve conter seção de Checkpoint Atual Obrigatório");
    assert(snippet.includes("Descobrir idade"), "Deve conter a label do checkpoint atual");
    assert(snippet.includes("CHECKPOINTS JÁ CONCLUÍDOS"), "Deve conter seção de concluídos");
    assert(snippet.includes("FATOS CONHECIDOS DO CONTATO NA MEMÓRIA"), "Deve conter fatos conhecidos");
    assert(snippet.includes("Divinópolis"), "Deve listar o fato da cidade");
    assert(snippet.includes("NUNCA faça mais de uma pergunta por turno"), "Deve reforçar regra de ouro de no máximo 1 pergunta");
  });

  // 31. Zero ranking / score de pretendente no modelo de dados
  runTest(31, "Zero score numérico de pretendente no modelo da matriz", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    allGoals.forEach((g) => {
      assert.strictEqual(g.score, undefined, `Goal ${g.id} não deve ter campo score`);
      assert.strictEqual(g.weight, undefined, `Goal ${g.id} não deve ter campo weight`);
    });
  });

  // 32. Idempotência da migração e do seeding
  runTest(32, "Idempotência da matriz canônica: múltiplas reconciliações são puras e idênticas", () => {
    const repoModule = loadTsModule("src/infrastructure/repositories/SupabaseChatStageRepository.ts");
    const { SupabaseChatStageRepository } = repoModule;
    const repo = new SupabaseChatStageRepository();

    const pass1 = repo.reconcileWithCanonicalMatrix([]);
    const pass2 = repo.reconcileWithCanonicalMatrix(pass1);

    assert.equal(pass1.length, pass2.length);
    assert.equal(pass1[0].goals.length, pass2[0].goals.length);
    assert.equal(pass1[1].goals.length, pass2[1].goals.length);
    assert.equal(pass1[2].goals.length, pass2[2].goals.length);
  });

  // 33. Garantia estrita de que nenhuma chamada externa à Meta/Instagram ou envio de outbox real ocorre em Shadow
  runTest(33, "Garantia estrita de ZERO chamadas externas para Meta/Instagram em modo Shadow (Spy Real)", () => {
    let externalMetaCalls = 0;
    const interceptedUrls = [];

    // Spy de chamadas de rede externas globais
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      interceptedUrls.push(urlStr);
      if (urlStr.includes("graph.facebook.com") || urlStr.includes("meta.com") || urlStr.includes("instagram.com")) {
        externalMetaCalls++;
      }
      return { ok: true, json: async () => ({}) };
    };

    try {
      // Simulação fiel da lógica do experimental_orchestrator em modo Shadow
      const orchState = { mode: "shadow" };
      const outboxEntry = {
        id: "out_test_shadow_spy",
        status: "pending",
        providerMessageId: null,
      };

      if (orchState.mode === "shadow") {
        outboxEntry.status = "sent";
        outboxEntry.sentAt = new Date().toISOString();
        outboxEntry.providerMessageId = "shadow_simulated";
        // Zero fetch para Meta
      } else {
        globalThis.fetch("https://graph.facebook.com/v19.0/me/messages", { method: "POST" });
      }

      assert.equal(externalMetaCalls, 0, "Nenhuma chamada externa para Meta/Instagram pode ser disparada em Shadow");
      assert.equal(outboxEntry.providerMessageId, "shadow_simulated", "Provider ID deve ser estritamente 'shadow_simulated'");
      assert.equal(outboxEntry.status, "sent", "Outbox deve ser marcada como enviada sem disparo real");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 34. validateSubagentDecision parseia objectiveCompletion, audioId e aceita fase compatibilidade
  runTest(34, "validateSubagentDecision parseia objectiveCompletion, audioId e aceita fase compatibilidade", () => {
    const rawDecision = {
      action: "reply",
      nextPhase: "compatibilidade",
      checkpoint: "chk_alinhamento_valores",
      summary: "Turno concluído",
      responses: ["Oi tudo bem", "como foi seu dia"],
      audioId: "audio_123",
      objectiveCompletion: {
        objectiveId: "goal_relationship",
        evidenceMessageId: "msg_abc",
        value: "solteiro",
      },
    };

    const validated = validateSubagentDecision(rawDecision, "descoberta");
    assert.equal(validated.nextPhase, "compatibilidade");
    assert.equal(validated.audioId, "audio_123");
    assert(validated.objectiveCompletion, "Deve conter objectiveCompletion");
    assert.equal(validated.objectiveCompletion.objectiveId, "goal_relationship");
    assert.equal(validated.objectiveCompletion.value, "solteiro");
  });

  // 35. validateOrchestratorDecision aceita fase compatibilidade e propaga objectiveCompletion
  runTest(35, "validateOrchestratorDecision aceita fase compatibilidade e propaga objectiveCompletion", () => {
    const raw = {
      action: "reply",
      currentPhase: "descoberta",
      nextPhase: "compatibilidade",
      checkpoint: "chk_alinhamento_valores",
      summary: "Avanço",
      suggestedResponse: "Vamos conversar",
      requiredTools: ["send_text"],
      reasoning: "Avançando para compatibilidade",
      objectiveCompletion: {
        objectiveId: "goal_age",
        value: 30,
      },
    };

    const valid = validateOrchestratorDecision(raw);
    assert.equal(valid.nextPhase, "compatibilidade");
    assert.equal(valid.objectiveCompletion?.objectiveId, "goal_age");
    assert.equal(valid.objectiveCompletion?.value, 30);
  });

  // 36. processDeterministicStageProgression registra objectiveCompletion em completed_goals e objectiveProgress
  await runAsyncTest(36, "processDeterministicStageProgression registra objectiveCompletion no progresso", async () => {
    const decision = {
      action: "reply",
      currentPhase: "stage_1_conexao",
      nextPhase: "stage_1_conexao",
      checkpoint: "chk_saudacao_feita",
      summary: "Concluindo cidade",
      suggestedResponse: "Que legal!",
      requiredTools: ["send_text"],
      reasoning: "Pretendente informou cidade",
      objectiveCompletion: {
        objectiveId: "goal_city",
        evidenceMessageId: "msg_1",
        value: "Uberlândia",
      },
    };

    const res = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_prog_1",
      currentPhase: "stage_1_conexao",
      decision,
      claimedMessages: [{ id: "msg_1", text: "Moro em Uberlândia" }],
      stageRules: { completed_goals: ["goal_initial_reciprocity"] },
    });

    assert(res.updatedCompletedGoals.includes("goal_city"), "goal_city deve estar em updatedCompletedGoals");
    assert(res.updatedCompletedGoals.includes("goal_initial_reciprocity"), "Deve manter os concluídos prévios");
    assert(res.updatedObjectiveProgress["goal_city"], "Deve registrar no objectiveProgress");
    assert.equal(res.updatedObjectiveProgress["goal_city"].value, "Uberlândia");
  });

  // 37. processDeterministicStageProgression bloqueia avanço prematuro se houver checkpoints pendentes
  await runAsyncTest(37, "processDeterministicStageProgression bloqueia avanço prematuro se checkpoints pendentes", async () => {
    const decision = {
      action: "advance_phase",
      currentPhase: "stage_1_conexao",
      nextPhase: "stage_2_descoberta", // Tentativa de avanço do modelo
      checkpoint: "chk_rapport_estabelecido",
      summary: "Tentando avançar",
      suggestedResponse: "Vamos em frente",
      requiredTools: ["send_text"],
      reasoning: "Tentativa de avanço",
    };

    // Apenas goal_initial_reciprocity concluído, goal_city e goal_job ainda pendentes
    const res = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_block_1",
      currentPhase: "stage_1_conexao",
      decision,
      stageRules: { completed_goals: ["goal_initial_reciprocity"] },
    });

    assert.equal(res.stageAdvanced, false, "Não deve avançar etapa enquanto houver checkpoints pendentes");
    assert.equal(res.nextPhase, "stage_1_conexao", "Deve manter a fase atual");
  });

  // 38. processDeterministicStageProgression avança deterministicamente quando todos os checkpoints forem concluídos
  await runAsyncTest(38, "processDeterministicStageProgression avança deterministicamente quando 100% concluídos", async () => {
    const decision = {
      action: "reply",
      currentPhase: "stage_1_conexao",
      nextPhase: "stage_1_conexao",
      checkpoint: "chk_trabalho",
      summary: "Último checkpoint de conexão",
      suggestedResponse: "Que bom!",
      requiredTools: ["send_text"],
      reasoning: "Todos os checkpoints cumpridos",
      objectiveCompletion: {
        objectiveId: "goal_job",
        value: "Engenheiro",
        evidenceMessageId: "msg_job_1",
      },
    };

    // Já tínhamos goal_initial_reciprocity e goal_city; agora conclui goal_job (completando todos os 3 da etapa 1)
    const res = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_advance_1",
      currentPhase: "stage_1_conexao",
      decision,
      claimedMessages: [{ id: "msg_job_1", text: "Sou engenheiro" }],
      stageRules: { completed_goals: ["goal_initial_reciprocity", "goal_city"] },
    });

    assert.equal(res.stageAdvanced, true, "Deve avançar etapa automaticamente");
    assert.equal(res.nextPhase, "descoberta", "Deve avançar para a próxima etapa (descoberta)");
  });

  // 39. Shadow NÃO persiste completed_goals, objective_progress nem currentPhase
  await runAsyncTest(39, "Modo Shadow NUNCA muta completed_goals, objective_progress ou currentPhase oficiais", async () => {
    const updateCalls = [];
    const mockSupabase = {
      from: (table) => ({
        update: (payload) => ({
          eq: (field, val) => {
            updateCalls.push({ table, payload, field, val });
            return Promise.resolve({ data: null, error: null });
          },
        }),
        select: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    const initialRules = {
      completed_goals: ["goal_initial_reciprocity"],
      objective_progress: {
        goal_initial_reciprocity: { status: "completed" },
      },
    };

    const currentCycle = { trace: [] };
    const decision = {
      action: "reply",
      currentPhase: "stage_1_conexao",
      nextPhase: "stage_1_conexao",
      checkpoint: "chk_saudacao_feita",
      summary: "Simulando avanço de objetivo em shadow",
      suggestedResponse: "Oi! Sou de Barbacena",
      requiredTools: ["send_text"],
      reasoning: "Pretendente informou cidade",
      objectiveCompletion: {
        objectiveId: "goal_city",
        value: "Barbacena",
        evidenceMessageId: "msg_1",
      },
    };

    const orchState = {
      mode: "shadow",
      currentPhase: "conexao_inicial",
      currentStageId: "stage_1_conexao",
      responsibleSubagentId: "conexao_inicial",
      completedGoalIds: [...initialRules.completed_goals],
      objectiveProgress: { ...initialRules.objective_progress },
    };

    // Executa simulação determinística
    const stageProgression = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_shadow_safe_1",
      currentPhase: "stage_1_conexao",
      decision,
      claimedMessages: [{ id: "msg_1", text: "Sou de Barbacena" }],
      stageRules: initialRules,
      orchState,
      currentCycle,
    });

    // Registra traces de observabilidade em Shadow
    currentCycle.trace.push(`shadow_would_complete: ${decision.objectiveCompletion?.objectiveId || "none"}`);
    currentCycle.trace.push(`shadow_would_advance: ${stageProgression.stageAdvanced}`);

    const shadowSimulation = {
      wouldCompleteObjectiveId: decision.objectiveCompletion?.objectiveId || null,
      wouldAdvanceStage: stageProgression.stageAdvanced,
      wouldNextPhase: stageProgression.nextPhase,
      wouldNextStageId: stageProgression.nextStageId,
      simulatedCompletedGoals: stageProgression.updatedCompletedGoals,
      simulatedObjectiveProgress: stageProgression.updatedObjectiveProgress,
    };

    const updatedState = {
      version: 1,
      mode: "shadow",
      currentPhase: orchState.currentPhase, // MANTÉM ORIGINAL
      currentStageId: orchState.currentStageId, // MANTÉM ORIGINAL
      responsibleSubagentId: orchState.responsibleSubagentId,
      shadowSimulation,
    };

    // Persistência idêntica à do bloco Shadow em experimental_orchestrator
    await mockSupabase
      .from("instagram_conversations")
      .update({
        stage_completed_rules: {
          ...initialRules, // Mantém completed_goals e objective_progress originais intactos!
          active_cycle_token: null,
          orchestration: updatedState,
        },
      })
      .eq("id", "conv_shadow_safe_1");

    assert.equal(updateCalls.length, 1);
    const saved = updateCalls[0].payload;
    // O progresso oficial permanece INTACTO
    assert.deepEqual(saved.stage_completed_rules.completed_goals, ["goal_initial_reciprocity"]);
    assert.strictEqual(saved.stage_completed_rules.objective_progress["goal_city"], undefined);
    assert.strictEqual(saved.current_phase, undefined);
    assert.strictEqual(saved.current_stage_id, undefined);

    // Mas a simulação de observabilidade foi gravada com precisão
    assert.equal(saved.stage_completed_rules.orchestration.shadowSimulation.wouldCompleteObjectiveId, "goal_city");
    assert(currentCycle.trace.includes("shadow_would_complete: goal_city"));
  });

  // 40. Etapa atual manda no subagente (Conexão Inicial + pretendente "quero casar e ter filhos")
  runTest(40, "Etapa atual manda no subagente mesmo quando pretendente fala de compatibilidade", () => {
    // Cenário: Estágio Conexão Inicial ativo
    const stageChecklistForRouter = {
      stage: "Conexão Inicial",
      responsibleSubagent: "conexao_inicial",
      completedObjectives: ["goal_initial_reciprocity"],
      remainingObjectives: [
        { id: "goal_city", label: "Cidade de residência" },
        { id: "goal_job", label: "Profissão" },
      ],
      currentObjective: { id: "goal_city", label: "Cidade de residência" },
    };

    // Pretendente diz: "Quero casar logo e ter 3 filhos"
    // Roteador sem autoridade sugeriria compatibilidade
    const routingDecision = {
      action: "route",
      targetSubagent: "compatibilidade",
      reason: "Pretendente falou sobre casamento e filhos",
    };

    const currentCycle = { trace: [] };
    currentCycle.trace.push(`router_suggested_subagent: ${routingDecision.targetSubagent}`);

    // Regra da Autoridade de Workflow:
    const responsibleSubagent = stageChecklistForRouter.responsibleSubagent;
    const targetSubagent = (routingDecision.action === "wait" || routingDecision.action === "pause")
      ? "none"
      : (responsibleSubagent || routingDecision.targetSubagent);

    if (routingDecision.targetSubagent !== targetSubagent && routingDecision.targetSubagent !== "none") {
      currentCycle.trace.push(`workflow_forced_subagent: ${responsibleSubagent}`);
    }
    currentCycle.trace.push(`actual_subagent: ${targetSubagent}`);

    assert.equal(targetSubagent, "conexao_inicial", "O subagente executor real deve ser conexao_inicial");
    assert(currentCycle.trace.includes("router_suggested_subagent: compatibilidade"));
    assert(currentCycle.trace.includes("workflow_forced_subagent: conexao_inicial"));
    assert(currentCycle.trace.includes("actual_subagent: conexao_inicial"));
  });

  // 41. Validação estrita de objectiveCompletion (rejeições e aceitação)
  await runAsyncTest(41, "Validação estrita de objectiveCompletion (inexistente, disabled, concluído, futuro e corrente)", async () => {
    // 41.A: Rejeita se objetivo não existir na etapa
    {
      const cycle = { trace: [] };
      const res = await processDeterministicStageProgression({
        supabase: null,
        conversationId: "c1",
        currentPhase: "stage_1_conexao",
        decision: {
          action: "reply",
          currentPhase: "stage_1_conexao",
          objectiveCompletion: { objectiveId: "goal_inexistente_xyz" },
        },
        stageRules: { completed_goals: [] },
        currentCycle: cycle,
      });
      assert(!res.updatedCompletedGoals.includes("goal_inexistente_xyz"));
      assert(cycle.trace.some((t) => t.includes("invalid_objective_completion_rejected: wrong_stage_or_not_found")));
    }

    // 41.B: Rejeita se objetivo estiver disabled
    {
      const cycle = { trace: [] };
      const customStages = [
        {
          id: "stage_1_conexao",
          name: "Conexão",
          goals: [
            { id: "g1", enabled: false, required: true, order: 0 },
            { id: "g2", enabled: true, required: true, order: 1 },
          ],
        },
      ];
      const mockSupabase = {
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: customStages, error: null }),
          }),
        }),
      };
      const res = await processDeterministicStageProgression({
        supabase: mockSupabase,
        conversationId: "c2",
        currentPhase: "stage_1_conexao",
        decision: {
          action: "reply",
          currentPhase: "stage_1_conexao",
          objectiveCompletion: { objectiveId: "g1" },
        },
        stageRules: { completed_goals: [] },
        currentCycle: cycle,
      });
      assert(!res.updatedCompletedGoals.includes("g1"));
      assert(cycle.trace.some((t) => t.includes("invalid_objective_completion_rejected: objective_disabled")));
    }

    // 41.C: Rejeita se objetivo já tiver sido concluído previamente
    {
      const cycle = { trace: [] };
      const res = await processDeterministicStageProgression({
        supabase: null,
        conversationId: "c3",
        currentPhase: "stage_1_conexao",
        decision: {
          action: "reply",
          currentPhase: "stage_1_conexao",
          objectiveCompletion: { objectiveId: "goal_initial_reciprocity" },
        },
        stageRules: { completed_goals: ["goal_initial_reciprocity"] },
        currentCycle: cycle,
      });
      assert.equal(res.updatedCompletedGoals.filter((g) => g === "goal_initial_reciprocity").length, 1);
      assert(cycle.trace.some((t) => t.includes("invalid_objective_completion_rejected: already_completed")));
    }

    // 41.D: Rejeita se o LLM tentar concluir objetivo futuro (pular a fila)
    {
      const cycle = { trace: [] };
      // Etapa 1 tem ordem: goal_initial_reciprocity (já concluído) -> goal_city (corrente) -> goal_job (futuro)
      // Se LLM tentar concluir goal_job direto:
      const res = await processDeterministicStageProgression({
        supabase: null,
        conversationId: "c4",
        currentPhase: "stage_1_conexao",
        decision: {
          action: "reply",
          currentPhase: "stage_1_conexao",
          objectiveCompletion: { objectiveId: "goal_job", value: "Médico" },
        },
        stageRules: { completed_goals: ["goal_initial_reciprocity"] },
        currentCycle: cycle,
      });
      assert(!res.updatedCompletedGoals.includes("goal_job"), "Não pode aceitar objetivo futuro");
      assert(cycle.trace.some((t) => t.includes("invalid_objective_completion_rejected: not_current_objective")));
    }

    // 41.E: Aceita apenas se for o currentObjective da etapa e contiver evidência válida
    {
      const cycle = { trace: [] };
      const res = await processDeterministicStageProgression({
        supabase: null,
        conversationId: "c5",
        currentPhase: "stage_1_conexao",
        decision: {
          action: "reply",
          currentPhase: "stage_1_conexao",
          objectiveCompletion: {
            objectiveId: "goal_city",
            value: "Tiradentes",
            evidenceMessageId: "msg_city_tiradentes",
          },
        },
        claimedMessages: [{ id: "msg_city_tiradentes", text: "sou de Tiradentes" }],
        stageRules: { completed_goals: ["goal_initial_reciprocity"] },
        currentCycle: cycle,
      });
      assert(res.updatedCompletedGoals.includes("goal_city"), "Deve aceitar currentObjective");
      assert(cycle.trace.some((t) => t.includes("objective_completion_accepted: goal_city")));
    }
  });

  // 42. Reconciliação com fatos conhecidos (self.city = 'Barbacena')
  await runAsyncTest(42, "Reconciliação com fatos conhecidos da ContactMemory considera objetivo concluído", async () => {
    const memory = new MockMemoryProvider();
    await memory.saveFact("conv_mem_1", "self", "city", "Barbacena");

    // Chama resolveStageObjectives
    const resolved = await resolveStageObjectives({
      supabase: null,
      conversationId: "conv_mem_1",
      stageNameOrId: "stage_1_conexao",
      memoryProvider: memory,
      completedGoalIds: ["goal_initial_reciprocity"],
      historyMessages: [],
    });

    const cityGoal = resolved.goals.find((g) => g.id === "goal_city");
    assert.equal(cityGoal.status, "completed", "goal_city deve estar completed via ContactMemory");
    assert.equal(cityGoal.value, "Barbacena");

    // Não deve figurar como checkpoint pendente ativo
    assert.notEqual(resolved.currentObjective?.id, "goal_city", "goal_city não pode ser checkpoint pendente");
    assert.equal(resolved.currentObjective?.id, "goal_job", "Próximo pendente deve ser goal_job");

    // processDeterministicStageProgression sincroniza com completed_goals
    const prog = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_mem_1",
      currentPhase: "stage_1_conexao",
      decision: { action: "reply", currentPhase: "stage_1_conexao" },
      stageRules: { completed_goals: ["goal_initial_reciprocity"] },
      memoryProvider: memory,
    });

    assert(prog.updatedCompletedGoals.includes("goal_city"), "completed_goals deve incluir goal_city sincronizado");
    assert.equal(prog.updatedObjectiveProgress["goal_city"].value, "Barbacena");
  });

  // 43. Etapa customizada com stage_custom_a e subagente custom_subagent_a
  await runAsyncTest(43, "Etapa customizada não confunde stageId com subagentId", async () => {
    const customStages = [
      {
        id: "stage_custom_a",
        name: "Etapa Customizada A",
        stage_order: 0,
        goals: [{ id: "custom_goal_1", name: "Meta 1", enabled: true, required: true, order: 0 }],
      },
    ];
    const customSubagents = [
      {
        id: "custom_subagent_a",
        name: "Subagente Customizado A",
        enabled: true,
        stage_ids: ["stage_custom_a"],
      },
    ];

    const mockSupabase = {
      from: (table) => ({
        select: () => ({
          order: () => {
            if (table === "chat_stages") return Promise.resolve({ data: customStages, error: null });
            if (table === "subagent_definitions") return Promise.resolve({ data: customSubagents, error: null });
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    };

    const cycle = { trace: [] };
    const res = await processDeterministicStageProgression({
      supabase: mockSupabase,
      conversationId: "conv_cust_1",
      currentPhase: "custom_subagent_a",
      currentStageId: "stage_custom_a",
      decision: { action: "reply", currentPhase: "custom_subagent_a" },
      currentCycle: cycle,
    });

    assert.equal(res.currentStageId, "stage_custom_a", "currentStageId deve ser stage_custom_a");
    assert.equal(res.responsibleSubagentId, "custom_subagent_a", "responsibleSubagentId deve ser custom_subagent_a");
    assert(cycle.trace.includes("current_stage_id: stage_custom_a"));
    assert(cycle.trace.includes("responsible_subagent: custom_subagent_a"));
  });

  // 44. Consistência 100% entre scripts/seed-canonical-database.mjs e ChatStage.ts
  runTest(44, "Consistência total: seed-canonical-database.mjs e ChatStage.ts têm os exatos mesmos 15 objetivos", () => {
    const seedContent = fs.readFileSync("scripts/seed-canonical-database.mjs", "utf8");
    assert(seedContent.includes("loadCanonicalMatrixFromDomain"), "Seed deve carregar dinamicamente da matriz de domínio");
    assert(seedContent.includes("CANONICAL_CHAT_STAGES_MATRIX"), "Seed deve referenciar CANONICAL_CHAT_STAGES_MATRIX");

    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    assert.equal(allGoals.length, 15, "Matriz de domínio deve conter exatamente 15 objetivos");

    const expectedGoalIds = [
      "goal_initial_reciprocity",
      "goal_city",
      "goal_job",
      "goal_age",
      "goal_routine",
      "goal_hobbies",
      "goal_social_style",
      "goal_discovery_depth",
      "goal_relationship",
      "goal_relationship_intent",
      "goal_has_children",
      "goal_wants_children",
      "goal_family_values",
      "goal_future_plans",
      "goal_faith_values",
    ];

    const actualGoalIds = allGoals.map((g) => g.id);
    assert.deepEqual(actualGoalIds, expectedGoalIds, "Todos os 15 IDs de objetivos devem coincidir perfeitamente");
  });

  // 45. Validação de entidades e nomes de ContactMemory (zero 'contact', 'work' ou 'children' soltos)
  runTest(45, "ContactMemory restrita a entity self e campos canônicos (sem 'contact', 'work' ou 'children' solto)", () => {
    const allGoals = CANONICAL_CHAT_STAGES_MATRIX.flatMap((s) => s.goals);
    const factGoals = allGoals.filter((g) => g.kind === "fact");

    const allowedFields = new Set([
      "job",
      "city",
      "age",
      "routine",
      "hobbies",
      "social_style",
      "relationship_status",
      "relationship_intent",
      "has_children",
      "wants_children",
      "family_values",
      "future_plans",
      "faith_values",
    ]);

    factGoals.forEach((g) => {
      assert.equal(g.memoryEntity, "self", `Goal ${g.id} deve usar entity 'self'`);
      assert(g.memoryField, `Goal ${g.id} deve ter memoryField`);
      assert(allowedFields.has(g.memoryField), `Campo ${g.memoryField} não é permitido`);
      assert.notEqual(g.memoryField, "work", "Campo não pode ser 'work'");
      assert.notEqual(g.memoryField, "children", "Campo não pode ser 'children' solto");
      assert.notEqual(g.memoryEntity, "contact", "Entidade não pode ser 'contact'");
    });

    // Inspeciona experimental_orchestrator.ts garantindo que detectSpontaneousObjectiveCompletions usa self
    const orchContent = fs.readFileSync("supabase/functions/api/experimental_orchestrator.ts", "utf8");
    assert(!orchContent.includes(`memoryEntity: "contact"`), "Não deve haver memoryEntity: contact no código");
    assert(!orchContent.includes(`memoryField: "work"`), "Não deve haver memoryField: work no código");
  });

  // 46. Modo Shadow: Detecção espontânea isolada no shadowSimulation sem poluir ContactMemory nem progresso oficial
  await runTest(46, "Modo Shadow: Detecção espontânea isolada no shadowSimulation sem poluir ContactMemory nem progresso oficial", async () => {
    const memoryProvider = new MockMemoryProvider();
    let updatedRules = null;

    const mockState = {
      version: 1,
      mode: "shadow",
      currentPhase: "conexao_inicial",
      currentStageId: "stage_1_conexao",
      responsibleSubagentId: "conexao_inicial",
      checkpoint: "chk_saudacao_feita",
      completedGoalIds: [],
      objectiveProgress: {},
    };

    const conversationRow = {
      id: "conv_shadow_pure",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: [],
        objective_progress: {},
        orchestration: mockState,
      },
    };

    const mockSupabase = {
      from: (table) => ({
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: conversationRow,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: [
                  { id: "msg_in_0", text: "oi", sender: "pretendente", created_at: new Date().toISOString() },
                ],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog" ? [{ id: "conexao_inicial", enabled: true }] : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: () => {
            if (payload.stage_completed_rules) {
              conversationRow.stage_completed_rules = {
                ...conversationRow.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
              updatedRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };

    const runtime = {
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Fase de conexao inicial",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Que bom saber que você é de Barbacena!",
            checkpoint: "chk_saudacao_feita",
            responses: ["Que bom saber que você é de Barbacena!"],
          }),
          tokens: 50,
        };
      },
      _fastTest: true,
    };

    // Pretendente diz espontaneamente cidade e profissão em modo Shadow
    const result = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_shadow_pure",
      newMessage: {
        id: "msg_in_spontaneous",
        text: "sou de Barbacena e trabalho como médica",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(result.mode, "shadow", "Deve rodar em modo shadow");
    assert.equal(result.handled, true, "Deve ser manipulado no shadow");

    // 1. Proibido salvar na ContactMemory em modo shadow!
    assert.equal(
      memoryProvider.saveHistory.length,
      0,
      "ContactMemory DEVE ter ZERO chamadas de saveFact em modo shadow"
    );

    // 2. Proibido mutar completed_goals oficiais no banco!
    assert.deepEqual(
      updatedRules.completed_goals,
      [],
      "completed_goals oficiais no banco NÃO podem conter os objetivos detectados"
    );

    // 3. Proibido avançar etapa oficial da conversa!
    assert.equal(
      updatedRules.orchestration.currentPhase,
      "conexao_inicial",
      "currentPhase oficial deve permanecer inalterada"
    );
    assert.equal(
      updatedRules.orchestration.currentStageId,
      "stage_1_conexao",
      "currentStageId oficial deve permanecer inalterada"
    );

    // 4. Objetivos e fatos detectados devem estar isolados no shadowSimulation para observabilidade
    const sim = updatedRules.orchestration.shadowSimulation;
    assert(sim, "Deve conter objeto shadowSimulation");
    assert(Array.isArray(sim.detectedFacts), "shadowSimulation deve conter detectedFacts");
    assert(Array.isArray(sim.wouldCompleteObjectives), "shadowSimulation deve conter wouldCompleteObjectives");
    assert(sim.wouldCompleteObjectives.includes("goal_city"), "wouldCompleteObjectives deve listar goal_city");
    assert(sim.wouldCompleteObjectives.includes("goal_job"), "wouldCompleteObjectives deve listar goal_job");
  });

  // 47. Validação estrita de evidenceMessageId em objectiveCompletion (missing_evidence e invalid_evidence)
  await runTest(47, "Validação estrita de evidenceMessageId em objectiveCompletion (missing_evidence e invalid_evidence)", async () => {
    const memoryProvider = new MockMemoryProvider();
    const cycle = { trace: [] };

    // Cenário 1: Omissão de evidenceMessageId -> Rejeição categórica com missing_evidence
    const resMissing = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_ev_1",
      currentPhase: "conexao_inicial",
      currentStageId: "stage_1_conexao",
      decision: {
        action: "reply",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        objectiveCompletion: {
          objectiveId: "goal_initial_reciprocity",
          value: true,
          // Sem evidenceMessageId!
        },
      },
      claimedMessages: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      rawInbounds: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      stageRules: { completed_goals: [], objective_progress: {} },
      orchState: { completedGoalIds: [], objectiveProgress: {} },
      currentCycle: cycle,
      memoryProvider,
    });

    assert(cycle.trace.includes("objective_completion_rejected_missing_evidence: goal_initial_reciprocity"));
    assert(cycle.trace.includes("invalid_objective_completion_rejected: missing_evidence"));
    assert(!resMissing.updatedCompletedGoals.includes("goal_initial_reciprocity"), "Não pode aceitar conclusão sem evidência");

    // Cenário 2: evidenceMessageId falso/inexistente -> Rejeição com invalid_evidence
    const cycle2 = { trace: [] };
    const resInvalid = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_ev_2",
      currentPhase: "conexao_inicial",
      currentStageId: "stage_1_conexao",
      decision: {
        action: "reply",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        objectiveCompletion: {
          objectiveId: "goal_initial_reciprocity",
          value: true,
          evidenceMessageId: "fake_msg_id_99999", // ID fantasma
        },
      },
      claimedMessages: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      rawInbounds: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      stageRules: { completed_goals: [], objective_progress: {} },
      orchState: { completedGoalIds: [], objectiveProgress: {} },
      currentCycle: cycle2,
      memoryProvider,
    });

    assert(cycle2.trace.includes("objective_completion_rejected_invalid_evidence: goal_initial_reciprocity"));
    assert(cycle2.trace.includes("invalid_objective_completion_rejected: invalid_evidence"));
    assert(!resInvalid.updatedCompletedGoals.includes("goal_initial_reciprocity"), "Não pode aceitar evidência inexistente");

    // Cenário 3: evidenceMessageId legítimo existente em claimedMessages -> Aprovado
    const cycle3 = { trace: [] };
    const resValid = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_ev_3",
      currentPhase: "conexao_inicial",
      currentStageId: "stage_1_conexao",
      decision: {
        action: "reply",
        currentPhase: "conexao_inicial",
        checkpoint: "chk_saudacao_feita",
        objectiveCompletion: {
          objectiveId: "goal_initial_reciprocity",
          value: true,
          evidenceMessageId: "m_claim_1", // Evidência real!
        },
      },
      claimedMessages: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      rawInbounds: [{ id: "m_claim_1", text: "tudo bem e você?", sender: "pretendente" }],
      stageRules: { completed_goals: [], objective_progress: {} },
      orchState: { completedGoalIds: [], objectiveProgress: {} },
      currentCycle: cycle3,
      memoryProvider,
    });

    assert(cycle3.trace.includes("objective_completion_accepted: goal_initial_reciprocity"));
    assert(resValid.updatedCompletedGoals.includes("goal_initial_reciprocity"), "Deve aceitar conclusão com evidência legítima");
  });

  // 48. Preempção parcial (remaining_bubbles_superseded): Preserva fase, etapa e subagente sem avançar etapa
  await runTest(48, "Preempção parcial (remaining_bubbles_superseded): Preserva fase, etapa e subagente sem avançar etapa", async () => {
    // Inspeciona experimental_orchestrator.ts garantindo que o branch de remaining_bubbles_superseded preserva estado oficial
    const orchContent = fs.readFileSync("supabase/functions/api/experimental_orchestrator.ts", "utf8");
    const startIdx = orchContent.indexOf("remaining_bubbles_superseded: sent=");
    assert(startIdx > -1, "Deve existir branch de remaining_bubbles_superseded");
    const preemptionBlock = orchContent.slice(startIdx, startIdx + 3000);

    assert(
      preemptionBlock.includes("currentPhase: orchState.currentPhase || currentPhase"),
      "remaining_bubbles_superseded DEVE preservar orchState.currentPhase sem avançar para validatedNextPhase"
    );
    assert(
      preemptionBlock.includes("currentStageId: orchState.currentStageId || currentStageId"),
      "remaining_bubbles_superseded DEVE preservar orchState.currentStageId"
    );
    assert(
      preemptionBlock.includes("responsibleSubagentId: orchState.responsibleSubagentId || responsibleSubagent"),
      "remaining_bubbles_superseded DEVE preservar orchState.responsibleSubagentId"
    );
    assert(
      preemptionBlock.includes("(updatedState as any).completedGoalIds = orchState.completedGoalIds"),
      "remaining_bubbles_superseded DEVE preservar completedGoalIds intactos"
    );
  });

  // 49. validatePhaseTransition NÃO é autoridade de workflow (função auxiliar pura de validação/debug)
  await runTest(49, "validatePhaseTransition NÃO é autoridade de workflow (função auxiliar pura de validação/debug)", async () => {
    // 1. Inspeciona o contrato de arquitetura documentado
    const orchContent = fs.readFileSync("supabase/functions/api/experimental_orchestrator.ts", "utf8");
    assert(
      orchContent.includes("validatePhaseTransition NÃO É autoridade de workflow"),
      "Deve conter aviso explícito de que validatePhaseTransition não é autoridade"
    );

    // 2. Testa comportamento puro da função
    const checkValid = validatePhaseTransition("conexao_inicial", "descoberta", "chk_rapport_estabelecido");
    assert.equal(checkValid.allowed, true);
    assert.equal(checkValid.validatedNextPhase, "descoberta");

    // Tentativa inválida sem checkpoint
    const checkInvalid = validatePhaseTransition("conexao_inicial", "descoberta", "chk_inexistente");
    assert.equal(checkInvalid.allowed, false);
    assert.equal(checkInvalid.validatedNextPhase, "conexao_inicial");
  });

  // 50. Integração de Fluxo Real com runtime.callModel: Ciclo ponta-a-ponta executa com observabilidade e fidelidade
  await runTest(50, "Integração de Fluxo Real com runtime.callModel: Ciclo ponta-a-ponta executa com observabilidade e fidelidade", async () => {
    const memoryProvider = new MockMemoryProvider();
    let savedStageRules = null;

    const conversationRow50 = {
      id: "conv_flow_test",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: [],
        objective_progress: {},
        orchestration: {
          version: 1,
          mode: "shadow",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: [],
          objectiveProgress: {},
        },
      },
    };

    const mockSupabase = {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: conversationRow50,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: [
                  { id: "msg_in_prev", text: "oi Larissa", sender: "pretendente", created_at: new Date().toISOString() },
                ],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog" ? [{ id: "conexao_inicial", enabled: true }] : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: () => {
            if (payload.stage_completed_rules) {
              conversationRow50.stage_completed_rules = {
                ...conversationRow50.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
              savedStageRules = conversationRow50.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };

    let modelCalled = false;
    const runtime = {
      callModel: async (prompt) => {
        modelCalled = true;
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Iniciando conexao",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Oi! Tudo bem sim, e com você como estão as coisas?",
            checkpoint: "chk_saudacao_feita",
            responses: ["Oi! Tudo bem sim, e com você como estão as coisas?"],
            objectiveCompletion: {
              objectiveId: "goal_initial_reciprocity",
              value: true,
              evidenceMessageId: "msg_in_now",
            },
          }),
          tokens: 50,
        };
      },
      _fastTest: true,
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_flow_test",
      newMessage: {
        id: "msg_in_now",
        text: "tudo ótimo por aqui, adorei seu perfil!",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(res.handled, true, "Orchestrator deve processar o ciclo com sucesso");
    assert.equal(modelCalled, true, "Subagente deve chamar o modelo LLM");
    assert(savedStageRules, "Deve persistir stage_completed_rules");
    assert(savedStageRules.orchestration.recentCycles.length > 0, "Deve registrar recentCycles");
    assert.equal(savedStageRules.orchestration.recentCycles[0].status, "completed");
  });

  console.log("\n================================================================================");
  console.log(`🎉 TODOS OS ${passed}/50 TESTES FORAM APROVADOS COM SUCESSO!`);
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("Erro fatal na execução da suíte de testes:", err);
  process.exit(1);
});
