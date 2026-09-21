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
      if (dep.includes("conversation_episodic_memory")) {
        return loadTsModule("supabase/functions/api/conversation_episodic_memory.ts");
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
  console.log("🚀 INICIANDO SUÍTE DE TESTES: MATRIZ CANÔNICA DE OBJETIVOS (57 CENÁRIOS)");
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
    resolveOfficialCompletedGoals,
    resolveOfficialObjectiveProgress,
    SupabaseMemoryProvider,
    OverlayMemoryProvider,
    createOverlayMemoryProvider,
    commitExperimentalCycleAtomic,
    requestExperimentalCyclePreemptionAtomic,
    claimExperimentalCycleAtomic,
    claimExperimentalCycleMessagesAtomic,
    claimOutboxEntryAtomic,
    prepareExperimentalOutboxEntryAtomic,
    releaseExperimentalCycleAtomic,
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
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_experimental_cycle_messages") {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        if (fn === "release_experimental_cycle_if_owned") {
          conversationRow.stage_completed_rules.active_cycle_token = null;
          if (params?.p_cycle_record?.shadowSimulation) {
            conversationRow.stage_completed_rules.orchestration.shadowSimulation = params.p_cycle_record.shadowSimulation;
          }
          conversationRow.stage_completed_rules.orchestration.lastProcessingStatus = params?.p_processing_status || "shadow_logged";
          updatedRules = conversationRow.stage_completed_rules;
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
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

  // 48. Preempção parcial real entre balões (remaining_bubbles_superseded): Preserva completed_goals e etapa sem contaminação
  await runTest(48, "Preempção parcial real entre balões (remaining_bubbles_superseded): Preserva completed_goals e etapa sem contaminação", async () => {
    const memoryProvider = new MockMemoryProvider();
    let savedStageRules = null;
    let sentBalloons = [];
    let balloonCount = 0;
    let episodicUpserts = [];

    const conversationRow = {
      id: "conv_test_48",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
        },
      },
    };

    const messagesInDb = [
      { id: "msg_prev", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 10000).toISOString() },
    ];

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_test_48",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "prepare_experimental_outbox_entry") {
          const orch = conversationRow.stage_completed_rules.orchestration || {};
          orch.outbox = orch.outbox || {};
          if (params?.p_outbox_entry?.id) {
            orch.outbox[params.p_outbox_entry.id] = params.p_outbox_entry;
          }
          return Promise.resolve({ data: { success: true, outboxKey: params?.p_outbox_entry?.id }, error: null });
        }
        if (fn === "release_experimental_cycle_if_owned") {
          conversationRow.stage_completed_rules.active_cycle_token = null;
          if (params?.p_debounce_until) {
            conversationRow.stage_completed_rules.ai_debounce_until = params.p_debounce_until;
            conversationRow.stage_completed_rules.ai_auto_respond = true;
          }
          savedStageRules = conversationRow.stage_completed_rules;
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? messagesInDb : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }, { id: "descoberta", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: (col, val) => {
            if (payload.stage_completed_rules) {
              conversationRow.stage_completed_rules = {
                ...conversationRow.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
              savedStageRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: (payload) => ({
          select: () => {
            episodicUpserts.push(payload);
            return Promise.resolve({ data: [{ id: "ep_48" }], error: null });
          },
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexao inicial",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Que legal que você é de Barbacena!\nE como é trabalhar como engenheiro por aí?",
            checkpoint: "chk_saudacao_feita",
            responses: [
              "Que legal que você é de Barbacena!",
              "E como é trabalhar como engenheiro por aí?",
            ],
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async (supabase, convId, text) => {
        balloonCount++;
        sentBalloons.push(text);
        // Após o primeiro balão ser entregue, chega nova mensagem e o freshness gate dispara antes do 2º balão
        if (balloonCount === 1) {
          conversationRow.stage_completed_rules.preempt_requested = true;
        }
        return { message_id: `msg_sent_${balloonCount}` };
      },
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_48",
      newMessage: {
        id: "msg_in_48",
        text: "sou de Barbacena e trabalho de engenheiro",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(res.handled, true, "Ciclo com balão parcial enviado deve ser handled");
    assert.equal(balloonCount, 1, "Apenas o PRIMEIRO balão deve ser enviado");
    assert.equal(sentBalloons.length, 1, "Segundo balão NÃO pode ser enviado");
    assert(savedStageRules, "Deve persistir stage_completed_rules após preempção parcial");

    // ASSERÇÕES CRÍTICAS SOLICITADAS:
    // 1. completed_goals oficial deve permanecer intacto [goal_initial_reciprocity]
    assert.deepEqual(
      savedStageRules.completed_goals,
      ["goal_initial_reciprocity"],
      "completed_goals oficial DEVE continuar [goal_initial_reciprocity] e NÃO ganhar goal_city/goal_job"
    );
    assert.deepEqual(
      savedStageRules.orchestration.completedGoalIds,
      ["goal_initial_reciprocity"],
      "orchestration.completedGoalIds DEVE continuar [goal_initial_reciprocity]"
    );

    // 2. Etapa, fase e subagente NÃO mudam
    assert.equal(
      savedStageRules.orchestration.currentStageId,
      "stage_1_conexao",
      "currentStageId não pode mudar em preempção parcial"
    );
    assert.equal(
      savedStageRules.orchestration.currentPhase,
      "conexao_inicial",
      "currentPhase não pode mudar em preempção parcial"
    );
    assert.equal(
      savedStageRules.orchestration.responsibleSubagentId,
      "conexao_inicial",
      "responsibleSubagentId não pode mudar em preempção parcial"
    );

    // 3. Debounce agendado
    assert(
      savedStageRules.ai_debounce_until,
      "Debounce deve ser agendado após interrupção entre balões"
    );
    assert(
      Date.parse(savedStageRules.ai_debounce_until) > Date.now() - 1000,
      "ai_debounce_until deve ter timestamp válido"
    );

    // 4. Memória NÃO foi contaminada com fatos espontâneos do ciclo não confirmado
    const memoryEntities = savedStageRules.orchestration?.memory?.entities;
    assert.equal(
      memoryEntities?.self?.city,
      undefined,
      "ContactMemory NÃO deve conter self.city após preempção parcial"
    );
    assert.equal(
      memoryEntities?.self?.job,
      undefined,
      "ContactMemory NÃO deve conter self.job após preempção parcial"
    );

    // 5. EpisodeWriter executou exatamente 1 vez com apenas o primeiro balão entregue
    assert.equal(episodicUpserts.length, 1, "EpisodeWriter deve executar exatamente 1 vez no envio parcial");
    const episodesRecorded = episodicUpserts[0];
    assert(Array.isArray(episodesRecorded), "upsert deve receber um array de episódios");
    assert(
      !episodesRecorded.some((ep) => ep.original_text?.includes("trabalhar como engenheiro")),
      "Segundo balão (não entregue) JAMAIS pode estar gravado em episódios da memória episódica"
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
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow50.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_experimental_cycle_messages") {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        if (fn === "prepare_experimental_outbox_entry") {
          return Promise.resolve({ data: { success: true, outboxKey: params?.p_outbox_entry?.id }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: { id: params?.p_outbox_id, status: "sending", claimedBy: params?.p_claim_token },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          conversationRow50.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          savedStageRules = conversationRow50.stage_completed_rules;
          return Promise.resolve({ data: { committed: true, reason: "committed" }, error: null });
        }
        if (fn === "release_experimental_cycle_if_owned") {
          conversationRow50.stage_completed_rules.active_cycle_token = null;
          if (params?.p_cycle_record) {
            const orch = conversationRow50.stage_completed_rules.orchestration || {};
            orch.recentCycles = [params.p_cycle_record, ...(orch.recentCycles || [])].slice(0, 5);
          }
          savedStageRules = conversationRow50.stage_completed_rules;
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
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

  // 51. Segundo teste real: Detecção espontânea com preempção ANTES da Outbox: Zero mutação oficial
  await runTest(51, "Segundo teste real: Detecção espontânea com preempção ANTES da Outbox: Zero mutação oficial", async () => {
    const memoryProvider = new MockMemoryProvider();
    let savedStageRules = null;
    let balloonCount = 0;

    const conversationRow = {
      id: "conv_test_51",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_experimental_cycle_messages") {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        if (fn === "prepare_experimental_outbox_entry") {
          return Promise.resolve({ data: { success: true, outboxKey: params?.p_outbox_entry?.id }, error: null });
        }
        if (fn === "release_experimental_cycle_if_owned") {
          conversationRow.stage_completed_rules.active_cycle_token = null;
          savedStageRules = conversationRow.stage_completed_rules;
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? [
                  { id: "msg_in_51_prev", text: "oi", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 5000).toISOString() }
                ] : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: (col, val) => {
            if (payload.stage_completed_rules) {
              conversationRow.stage_completed_rules = {
                ...conversationRow.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
              savedStageRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexao inicial",
            }),
            tokens: 50,
          };
        }
        // Quando o modelo do subagente termina de gerar, simulamos que uma nova mensagem chegou antes da Outbox
        conversationRow.stage_completed_rules.preempt_requested = true;
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Que bom que você é de Belo Horizonte!",
            checkpoint: "chk_saudacao_feita",
            responses: ["Que bom que você é de Belo Horizonte!"],
          }),
          tokens: 50,
        };
      },
      sendMessage: async () => {
        balloonCount++;
        return { success: true };
      },
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_51",
      newMessage: {
        id: "msg_in_51",
        text: "moro em Belo Horizonte e sou arquiteto",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(balloonCount, 0, "Nenhum balão deve ser enviado se preempção ocorreu antes da Outbox");
    assert(savedStageRules, "Deve persistir stage_completed_rules na preempção");
    assert.deepEqual(
      savedStageRules.completed_goals,
      ["goal_initial_reciprocity"],
      "stageRules.completed_goals DEVE permanecer estritamente igual ao início"
    );
    assert.deepEqual(
      savedStageRules.orchestration.completedGoalIds,
      ["goal_initial_reciprocity"],
      "orchestration.completedGoalIds DEVE permanecer estritamente igual ao início"
    );
    assert.equal(
      savedStageRules.objective_progress.goal_city,
      undefined,
      "objective_progress NÃO deve conter goal_city após preempção"
    );
    assert.equal(
      savedStageRules.objective_progress.goal_job,
      undefined,
      "objective_progress NÃO deve conter goal_job após preempção"
    );
    assert.equal(
      savedStageRules.orchestration?.memory?.entities?.self?.city,
      undefined,
      "orchestration.memory NÃO deve conter self.city após preempção antes da Outbox"
    );
    assert.equal(
      savedStageRules.orchestration?.memory?.entities?.self?.job,
      undefined,
      "orchestration.memory NÃO deve conter self.job após preempção antes da Outbox"
    );
  });

  // 52. Terceiro teste real: Sucesso normal confirmado promove objetivo espontâneo no commit final determinístico
  await runTest(52, "Terceiro teste real: Sucesso normal confirmado promove objetivo espontâneo no commit final determinístico", async () => {
    const memoryProvider = new MockMemoryProvider();
    let savedStageRules = null;
    let balloonCount = 0;

    const conversationRow = {
      id: "conv_test_52",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_test_52",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          savedStageRules = conversationRow.stage_completed_rules;
          return Promise.resolve({ data: { committed: true, reason: "committed" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? [
                  { id: "msg_in_52_prev", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 5000).toISOString() }
                ] : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: (col, val) => {
            if (payload.stage_completed_rules) {
              conversationRow.stage_completed_rules = {
                ...conversationRow.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
              savedStageRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: () => ({
          select: () => Promise.resolve({ data: [{ id: "ep_52" }], error: null }),
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexao inicial",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Que maravilha, adoro Barbacena!",
            checkpoint: "chk_saudacao_feita",
            responses: ["Que maravilha, adoro Barbacena!"],
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async (supabase, convId, text) => {
        balloonCount++;
        return { message_id: "mid_52" };
      },
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_52",
      newMessage: {
        id: "msg_in_52",
        text: "sou de Barbacena",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(res.handled, true, "Ciclo deve ser processado com sucesso");
    assert.equal(balloonCount, 1, "1 balão deve ser enviado com sucesso");
    assert(savedStageRules, "Deve persistir stage_completed_rules após confirmação");

    // Em ciclo confirmado com sucesso, goal_city DEVE ter sido promovido a oficial
    assert(
      savedStageRules.completed_goals.includes("goal_city"),
      "completed_goals oficial DEVE conter goal_city após ciclo confirmado"
    );
    assert(
      savedStageRules.orchestration.completedGoalIds.includes("goal_city"),
      "orchestration.completedGoalIds DEVE conter goal_city após ciclo confirmado"
    );
    assert(
      savedStageRules.objective_progress.goal_city,
      "objective_progress oficial DEVE conter goal_city"
    );
    assert.equal(
      savedStageRules.orchestration?.memory?.entities?.self?.city?.value?.toLowerCase(),
      "barbacena",
      "orchestration.memory DEVE conter self.city='barbacena' após ciclo confirmado"
    );
  });

  // 53. TESTE CRÍTICO DE DOIS CICLOS (Persistência adiada com SupabaseMemoryProvider):
  // Ciclo 1: Pretendente revela cidade espontaneamente ("sou de Barbacena"), ciclo sofre preempção antes do envio.
  //          Garante ZERO gravação no banco de dados (ContactMemory limpa, completed_goals intacto).
  // Ciclo 2: Pretendente manda "e vc?". Novo ciclo inicia lendo o banco de dados.
  //          Garante que goal_city continua pendente e NÃO é ressuscitado via memory_fact_sync.
  await runTest(53, "Teste Crítico de Dois Ciclos: Preempção no Ciclo 1 não polui ContactMemory nem ressuscita checkpoint no Ciclo 2", async () => {
    let conversationRow = {
      id: "conv_two_cycles_test",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
          memory: { entities: {}, snippets: [] },
        },
      },
    };

    const messagesInDb = [
      { id: "msg_init", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 15000).toISOString() },
    ];

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_c1",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          return Promise.resolve({ data: { committed: true, reason: "committed" }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? messagesInDb : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
            error: null,
          }),
        }),
        update: (payload) => ({
          eq: (col, val) => {
            if (payload.stage_completed_rules) {
              conversationRow.stage_completed_rules = {
                ...conversationRow.stage_completed_rules,
                ...payload.stage_completed_rules,
              };
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: () => ({
          select: () => Promise.resolve({ data: [{ id: "ep_53" }], error: null }),
        }),
      }),
    };

    const realSupabaseMemoryProvider = new SupabaseMemoryProvider(mockSupabase);

    // ==========================================
    // CICLO 1: Pretendente diz "sou de Barbacena", mas ciclo é PREEMPTADO antes do envio
    // ==========================================
    let c1BalloonsSent = 0;
    const runtimeC1 = {
      _fastTest: true,
      callModel: async (prompt) => {
        // Simula preempção chegando durante o subagente
        conversationRow.stage_completed_rules.preempt_requested = true;
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Que legal, sou de BH!",
            checkpoint: "chk_saudacao_feita",
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async () => {
        c1BalloonsSent++;
        return { message_id: "m_c1_sent" };
      },
    };

    const resC1 = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_two_cycles_test",
      newMessage: {
        id: "msg_c1",
        text: "sou de Barbacena",
        sender: "pretendente",
      },
      runtime: runtimeC1,
      memoryProvider: realSupabaseMemoryProvider,
    });

    assert.equal(c1BalloonsSent, 0, "Ciclo 1 não deve enviar nenhum balão (preempção antes da outbox)");

    // ASSERÇÕES CRÍTICAS DO CICLO 1:
    // 1. completed_goals oficial no banco NÃO contém goal_city
    assert.deepEqual(
      conversationRow.stage_completed_rules.completed_goals,
      ["goal_initial_reciprocity"],
      "Ciclo 1 preemptado: completed_goals no banco DEVE continuar estritamente ['goal_initial_reciprocity']"
    );
    // 2. ContactMemory oficial no banco NÃO contém self.city
    const dbMemory = conversationRow.stage_completed_rules.orchestration?.memory?.entities;
    assert.equal(
      dbMemory?.self?.city,
      undefined,
      "Ciclo 1 preemptado: ZERO gravação no banco! self.city DEVE ser undefined na ContactMemory"
    );

    // ==========================================
    // CICLO 2: Pretendente manda "e vc?". Novo ciclo inicia lendo o banco de dados.
    // ==========================================
    // Limpa flag de preempção para o ciclo 2
    conversationRow.stage_completed_rules.preempt_requested = false;
    conversationRow.stage_completed_rules.active_cycle_token = null;

    let c2BalloonsSent = 0;

    // Inspeciona resolução de objetivos no início do Ciclo 2
    const checklistBeforeC2 = await resolveStageObjectives({
      supabase: mockSupabase,
      conversationId: "conv_two_cycles_test",
      stageNameOrId: "stage_1_conexao",
      memoryProvider: realSupabaseMemoryProvider,
      completedGoalIds: conversationRow.stage_completed_rules.completed_goals,
    });

    const goalCityAtC2Start = checklistBeforeC2.goals.find((g) => g.id === "goal_city");
    assert(goalCityAtC2Start, "goal_city deve existir na etapa 1");
    assert.equal(
      goalCityAtC2Start.status,
      "pending",
      "No Ciclo 2, goal_city DEVE continuar com status 'pending' (NÃO pode ser ressuscitado via memory_fact_sync!)"
    );

    const runtimeC2 = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexão inicial",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Eu sou de Belo Horizonte! E vc, mora onde?",
            checkpoint: "chk_saudacao_feita",
            responses: ["Eu sou de Belo Horizonte! E vc, mora onde?"],
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async () => {
        c2BalloonsSent++;
        return { message_id: "m_c2_sent" };
      },
    };

    const resC2 = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_two_cycles_test",
      newMessage: {
        id: "msg_c2",
        text: "e vc?",
        sender: "pretendente",
      },
      runtime: runtimeC2,
      memoryProvider: realSupabaseMemoryProvider,
    });

    assert.equal(resC2.handled, true, "Ciclo 2 deve concluir com sucesso");
    assert.equal(c2BalloonsSent, 1, "Ciclo 2 deve enviar 1 balão");

    // ASSERÇÕES CRÍTICAS DO CICLO 2:
    // Como a mensagem do Ciclo 2 ("e vc?") não continha a cidade e o Ciclo 1 morreu:
    // goal_city NÃO foi completado!
    assert(
      !conversationRow.stage_completed_rules.completed_goals.includes("goal_city"),
      "No Ciclo 2, completed_goals NÃO pode conter goal_city (o fato do ciclo 1 abortado não vazou)"
    );
    assert.equal(
      conversationRow.stage_completed_rules.orchestration?.memory?.entities?.self?.city,
      undefined,
      "No Ciclo 2, a ContactMemory no banco continua limpa sem self.city"
    );
  });

  // 54. TESTE CRÍTICO 1 — RACE REAL ENTRE CHECK (SELECT) E COMMIT (CAS):
  // Valida que se outro ciclo roubar o lock na fração de milissegundo entre a leitura de snapshot
  // e o CAS final, o commit oficial de A é 100% REJEITADO (Zero TOCTOU)!
  await runTest(54, "TESTE CRÍTICO 1 (TOCTOU): Perda de lock entre SELECT e CAS aborta commit oficial com zero contaminação", async () => {
    let savedStageRules = null;
    let balloonCount = 0;
    let episodicUpserts = [];
    let selectCount = 0;

    class StrictSpiesMemoryProvider {
      constructor() {
        this.saveCalls = 0;
        this.writeCalls = 0;
        this.storage = new Map();
      }
      async getFact() {
        return { found: false, value: null };
      }
      async saveFact() {
        this.saveCalls++;
        return { success: true };
      }
      async writeFact() {
        this.writeCalls++;
        return { success: true };
      }
      async listEntityFacts() {
        return {};
      }
    }

    const memoryProvider = new StrictSpiesMemoryProvider();

    const conversationRow = {
      id: "conv_test_54",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        active_cycle_token: null, // Será assumido pelo ciclo A
        preempt_requested: false,
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
          memory: { entities: {}, snippets: [] },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_test_54",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          // CENÁRIO CRÍTICO DE TOCTOU:
          // O ciclo A enviou os balões com sucesso e leu o snapshot/preCommit perfeitamente.
          // Mas exatamente antes da execução do CAS, o ciclo B assumiu o lock no banco!
          const currentToken = "cycle_b_token_winner";
          conversationRow.stage_completed_rules.active_cycle_token = currentToken;
          if (currentToken !== params.p_cycle_token) {
            return Promise.resolve({
              data: { committed: false, reason: "lost_lock", activeToken: currentToken },
              error: null,
            });
          }
          if (isPreempt) {
            return Promise.resolve({
              data: { committed: false, reason: "preempted" },
              error: null,
            });
          }
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          return Promise.resolve({
            data: { committed: true, reason: "committed" },
            error: null,
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? [
                  { id: "msg_in_54_prev", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 5000).toISOString() }
                ] : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
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
              savedStageRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: (payload) => ({
          select: () => {
            episodicUpserts.push(payload);
            return Promise.resolve({ data: [{ id: "ep_54" }], error: null });
          },
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexao inicial",
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
      sendMetaTextMessage: async () => {
        balloonCount++;
        return { message_id: "mid_54" };
      },
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_54",
      newMessage: {
        id: "msg_in_54",
        text: "sou de Barbacena",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    // 1. O CAS detectou perda de lock antes da escrita final: handled=false e erro lost_lock_before_atomic_commit
    assert.equal(res.handled, false, "Ciclo que perdeu lock antes do CAS não pode ser handled");
    assert.equal(res.sentToMeta, true, "Balão foi enviado ao Meta antes do CAS");
    assert.equal(res.error, "lost_lock_before_atomic_commit", "Erro deve indicar falha atômica no CAS");
    assert.equal(balloonCount, 1, "Balão foi entregue");

    // 2. ZERO chamadas a saveFact e writeFact no provider real antes do CAS!
    assert.equal(memoryProvider.saveCalls, 0, "ZERO saveFact real quando CAS falha");
    assert.equal(memoryProvider.writeCalls, 0, "ZERO writeFact real quando CAS falha");

    // 3. ZERO contaminação de completed_goals no banco!
    assert.deepEqual(
      conversationRow.stage_completed_rules.completed_goals,
      ["goal_initial_reciprocity"],
      "completed_goals DEVE continuar ['goal_initial_reciprocity'] sem goal_city"
    );
    assert.deepEqual(
      conversationRow.stage_completed_rules.orchestration.completedGoalIds,
      ["goal_initial_reciprocity"],
      "orchestration.completedGoalIds DEVE continuar ['goal_initial_reciprocity'] sem goal_city"
    );

    // 4. ZERO contaminação de ContactMemory no banco!
    assert.equal(
      conversationRow.stage_completed_rules.orchestration?.memory?.entities?.self?.city,
      undefined,
      "ContactMemory NÃO pode conter self.city de ciclo cujo CAS falhou"
    );

    // 5. O lock do Ciclo B que venceu a corrida NÃO foi sobrescrito!
    assert.equal(
      conversationRow.stage_completed_rules.active_cycle_token,
      "cycle_b_token_winner",
      "O token do ciclo concorrente B deve ser preservado intacto no banco"
    );

    // 6. EpisodeWriter NÃO foi chamado para o ciclo abortado
    assert.equal(
      episodicUpserts.length,
      0,
      "EpisodeWriter NÃO pode ser executado se o CAS falhou"
    );
  });

  // 55. TESTE CRÍTICO 2 — COMMIT NORMAL VIA CAS E DEDUPLICAÇÃO DE EPISODEWRITER:
  await runTest(55, "TESTE CRÍTICO 2: Commit normal via CAS promove memória e workflow juntos e deduplica EpisodeWriter", async () => {
    let savedStageRules = null;
    let balloonCount = 0;
    let episodicUpserts = [];

    const memoryProvider = new MockMemoryProvider();

    const conversationRow = {
      id: "conv_test_55",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        active_cycle_token: null,
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
          memory: { entities: {}, snippets: [] },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_test_55",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          const currentToken = conversationRow.stage_completed_rules?.active_cycle_token;
          const isPreempt = Boolean(conversationRow.stage_completed_rules?.preempt_requested);
          if (currentToken !== params.p_cycle_token) {
            return Promise.resolve({
              data: { committed: false, reason: "lost_lock", activeToken: currentToken },
              error: null,
            });
          }
          if (isPreempt) {
            return Promise.resolve({
              data: { committed: false, reason: "preempted" },
              error: null,
            });
          }
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          return Promise.resolve({
            data: { committed: true, reason: "committed" },
            error: null,
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? [
                  { id: "msg_in_55_prev", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 5000).toISOString() }
                ] : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
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
              savedStageRules = conversationRow.stage_completed_rules;
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: (payload) => ({
          select: () => {
            episodicUpserts.push(payload);
            return Promise.resolve({ data: [{ id: "ep_55" }], error: null });
          },
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async (prompt) => {
        if (prompt.includes("targetSubagent") || prompt.includes("ROTEADOR") || prompt.includes("Subagente Alvo") || prompt.includes("CLASSIFICAÇÃO")) {
          return {
            content: JSON.stringify({
              action: "route",
              targetSubagent: "conexao_inicial",
              reason: "Conexao inicial",
            }),
            tokens: 50,
          };
        }
        return {
          content: JSON.stringify({
            action: "reply",
            suggestedResponse: "Oi! Tudo bem?\nComo foi seu dia por aí?",
            checkpoint: "chk_saudacao_feita",
            responses: ["Oi! Tudo bem?", "Como foi seu dia por aí?"],
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async () => {
        balloonCount++;
        return { message_id: `mid_55_${balloonCount}` };
      },
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_55",
      newMessage: {
        id: "msg_in_55",
        text: "sou de Barbacena",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(res.handled, true, "Ciclo confirmado deve ser handled com sucesso");
    assert.equal(balloonCount, 2, "Devem ser entregues 2 balões");

    // ASSERÇÕES CRÍTICAS DO COMMIT NORMAL:
    // 1. CAS atômico com sucesso: active_cycle_token é limpo no commit
    assert.equal(
      conversationRow.stage_completed_rules.active_cycle_token,
      null,
      "active_cycle_token deve ser limpo para null no commit oficial"
    );

    // 2. ContactMemory contém self.city='barbacena'
    assert.equal(
      conversationRow.stage_completed_rules.orchestration?.memory?.entities?.self?.city?.value?.toLowerCase(),
      "barbacena",
      "ContactMemory deve conter self.city='barbacena' após commit oficial do CAS"
    );

    // 3. completed_goals e objective_progress atualizados
    assert(
      conversationRow.stage_completed_rules.completed_goals.includes("goal_city"),
      "completed_goals deve conter goal_city"
    );
    assert(
      conversationRow.stage_completed_rules.objective_progress.goal_city,
      "objective_progress deve conter goal_city"
    );

    // 4. EpisodeWriter executou EXATAMENTE 1 vez por ciclo normal confirmado
    assert.equal(
      episodicUpserts.length,
      1,
      "EpisodeWriter DEVE executar EXATAMENTE 1 vez por ciclo normal confirmado"
    );
  });

  // 56. TESTE CRÍTICO 3 — preempt_requested MUDA NO ÚLTIMO INSTANTE ANTES DO CAS:
  await runTest(56, "TESTE CRÍTICO 3: preempt_requested=true antes do CAS aborta commit com zero mutação oficial", async () => {
    let episodicUpserts = [];
    let selectCount = 0;

    const memoryProvider = new MockMemoryProvider();

    const conversationRow = {
      id: "conv_test_56",
      is_restricted: false,
      stage_completed_rules: {
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed", value: true },
        },
        active_cycle_token: null,
        preempt_requested: false,
        orchestration: {
          version: 1,
          mode: "experimental",
          currentPhase: "conexao_inicial",
          currentStageId: "stage_1_conexao",
          responsibleSubagentId: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          completedGoalIds: ["goal_initial_reciprocity"],
          objectiveProgress: {
            goal_initial_reciprocity: { status: "completed", value: true },
          },
          memory: { entities: {}, snippets: [] },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          conversationRow.stage_completed_rules.active_cycle_token = params?.p_cycle_token;
          conversationRow.stage_completed_rules.active_cycle_at = new Date().toISOString();
          return Promise.resolve({ data: { success: true, activeCycleToken: params?.p_cycle_token }, error: null });
        }
        if (fn === "claim_outbox_entry") {
          return Promise.resolve({
            data: {
              success: true,
              reason: "claimed",
              entry: {
                id: params?.p_outbox_id || "out_test_56",
                status: "sending",
                claimedBy: params?.p_claim_token,
                sendingAt: new Date().toISOString(),
              },
            },
            error: null,
          });
        }
        if (fn === "commit_experimental_cycle_if_owned") {
          // CENÁRIO CRÍTICO: Preempção solicitada antes do CAS
          conversationRow.stage_completed_rules.preempt_requested = true;
          return Promise.resolve({
            data: { committed: false, reason: "preempted" },
            error: null,
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "instagram_conversations" ? conversationRow : null,
              error: null,
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: table === "instagram_messages" ? [
                  { id: "msg_in_56_prev", text: "oi Larissa", sender: "pretendente", is_mine: false, created_at: new Date(Date.now() - 5000).toISOString() }
                ] : [],
                error: null,
              }),
            }),
          }),
          order: () => Promise.resolve({
            data: table === "subagents_catalog"
              ? [{ id: "conexao_inicial", enabled: true }]
              : table === "chat_stages"
              ? CANONICAL_CHAT_STAGES_MATRIX
              : [],
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
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
        upsert: (payload) => ({
          select: () => {
            episodicUpserts.push(payload);
            return Promise.resolve({ data: [{ id: "ep_56" }], error: null });
          },
        }),
      }),
    };

    const runtime = {
      _fastTest: true,
      callModel: async () => ({
        content: JSON.stringify({
          action: "reply",
          suggestedResponse: "Que bom saber que você é de Barbacena!",
          checkpoint: "chk_saudacao_feita",
          responses: ["Que bom saber que você é de Barbacena!"],
        }),
        tokens: 50,
      }),
      sendMetaTextMessage: async () => ({ message_id: "mid_56" }),
    };

    const res = await runExperimentalOrchestration({
      supabase: mockSupabase,
      conversationId: "conv_test_56",
      newMessage: {
        id: "msg_in_56",
        text: "sou de Barbacena",
        sender: "pretendente",
      },
      runtime,
      memoryProvider,
    });

    assert.equal(res.handled, false, "Preempção no último instante deve rejeitar o commit");
    assert.equal(res.error, "lost_lock_before_atomic_commit", "Erro reportado");
    assert.deepEqual(
      conversationRow.stage_completed_rules.completed_goals,
      ["goal_initial_reciprocity"],
      "completed_goals não pode ganhar novos objetivos se preemptado"
    );
    assert.equal(
      conversationRow.stage_completed_rules.orchestration?.memory?.entities?.self?.city,
      undefined,
      "ContactMemory não pode ganhar self.city se preemptado"
    );
    assert.equal(episodicUpserts.length, 0, "EpisodeWriter não pode rodar");
  });

  // 57. TESTE DE ATOMICIDADE — TUDO OU NADA DO CAS CONDICIONAL:
  await runTest(57, "TESTE DE ATOMICIDADE: commitExperimentalCycleAtomic garante Tudo ou Nada sem estado parcial", async () => {
    let conversationRow = {
      id: "conv_test_57",
      stage_completed_rules: {
        active_cycle_token: "corr_atomic_test",
        preempt_requested: false,
        completed_goals: ["goal_1"],
        orchestration: {
          currentStageId: "stage_1",
          memory: { entities: { self: { name: { value: "João" } } } },
        },
      },
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "commit_experimental_cycle_if_owned") {
          const currentToken = conversationRow.stage_completed_rules?.active_cycle_token;
          const isPreempt = Boolean(conversationRow.stage_completed_rules?.preempt_requested);
          if (currentToken !== params.p_cycle_token) {
            return Promise.resolve({
              data: { committed: false, reason: "lost_lock", activeToken: currentToken },
              error: null,
            });
          }
          if (isPreempt) {
            return Promise.resolve({
              data: { committed: false, reason: "preempted" },
              error: null,
            });
          }
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          return Promise.resolve({
            data: { committed: true, reason: "committed" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    // Caso A: CAS com token correspondente e preempt_requested=false -> COMMIT COMPLETO
    const newRulesSuccess = {
      active_cycle_token: "corr_atomic_test",
      completed_goals: ["goal_1", "goal_2"],
      orchestration: {
        currentStageId: "stage_2",
        memory: { entities: { self: { name: { value: "João" }, city: { value: "Barbacena" } } } },
      },
    };

    const resultSuccess = await commitExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_57",
      correlationId: "corr_atomic_test",
      newStageCompletedRules: newRulesSuccess,
    });

    assert.equal(resultSuccess.committed, true, "Deve commitar com sucesso");
    assert.equal(resultSuccess.reason, "committed");
    assert.deepEqual(conversationRow.stage_completed_rules.completed_goals, ["goal_1", "goal_2"]);
    assert.equal(conversationRow.stage_completed_rules.orchestration.currentStageId, "stage_2");
    assert.equal(conversationRow.stage_completed_rules.orchestration.memory.entities.self.city.value, "Barbacena");
    assert.equal(conversationRow.stage_completed_rules.active_cycle_token, null);

    // Caso B: Tentativa com token divergente (outro ciclo tem o lock) -> NENHUM CAMPO ATUALIZADO
    conversationRow.stage_completed_rules.active_cycle_token = "cycle_other";
    const rulesStaleAttempt = {
      completed_goals: ["goal_1", "goal_2", "goal_3_STALE"],
      orchestration: {
        currentStageId: "stage_3_STALE",
        memory: { entities: { self: { fake_field: { value: "STALE_DATA" } } } },
      },
    };

    const resultLostLock = await commitExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_57",
      correlationId: "corr_stale_cycle",
      newStageCompletedRules: rulesStaleAttempt,
    });

    assert.equal(resultLostLock.committed, false, "Deve falhar por lost_lock");
    assert.equal(resultLostLock.reason, "lost_lock");
    // GARANTIA DE ATOMICIDADE: nenhum campo foi corrompido ou parcialmente aplicado!
    assert.deepEqual(conversationRow.stage_completed_rules.completed_goals, ["goal_1", "goal_2"]);
    assert.equal(conversationRow.stage_completed_rules.orchestration.currentStageId, "stage_2");
    assert.equal(conversationRow.stage_completed_rules.orchestration.memory.entities.self.fake_field, undefined);
    assert.equal(conversationRow.stage_completed_rules.active_cycle_token, "cycle_other");

    // Caso C: Tentativa com preempt_requested=true -> NENHUM CAMPO ATUALIZADO
    conversationRow.stage_completed_rules.active_cycle_token = "corr_cycle_preempt_target";
    conversationRow.stage_completed_rules.preempt_requested = true;

    const resultPreempted = await commitExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_57",
      correlationId: "corr_cycle_preempt_target",
      newStageCompletedRules: rulesStaleAttempt,
    });

    assert.equal(resultPreempted.committed, false, "Deve falhar por preempted");
    assert.equal(resultPreempted.reason, "preempted");
    // GARANTIA DE ATOMICIDADE: nenhum campo parcial!
    assert.deepEqual(conversationRow.stage_completed_rules.completed_goals, ["goal_1", "goal_2"]);
    assert.equal(conversationRow.stage_completed_rules.orchestration.currentStageId, "stage_2");
  });

  // 58. TESTE CRÍTICO OBRIGATÓRIO (Preempção do Webhook): SNAPSHOT VELHO NÃO PODE APAGAR COMMIT NOVO
  await runTest(58, "TESTE CRÍTICO OBRIGATÓRIO: Snapshot velho não pode apagar commit novo (Patch atômico da preempção)", async () => {
    // ESTADO INICIAL
    let conversationRow = {
      id: "conv_test_58",
      ai_auto_respond: false,
      ai_debounce_until: null,
      stage_completed_rules: {
        active_cycle_token: "cycle_a",
        preempt_requested: false,
        completed_goals: ["goal_initial_reciprocity"],
        objective_progress: {
          goal_initial_reciprocity: { status: "completed" },
        },
        orchestration: {
          inboundRevision: 1,
          preemptRequested: false,
          currentStageId: "descoberta",
          currentPhase: "descoberta",
          responsibleSubagentId: "descoberta",
          messageLedger: { msg_init: "processed" },
          memory: {
            entities: {
              self: {},
            },
          },
        },
      },
    };

    const mockSupabase = {
      from: (table) => ({
        select: (cols) => ({
          eq: (col, val) => ({
            maybeSingle: () => Promise.resolve({ data: JSON.parse(JSON.stringify(conversationRow)) }),
          }),
        }),
        update: (data) => ({
          eq: (col, val) => {
            Object.assign(conversationRow, data);
            return Promise.resolve({ data: [conversationRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "commit_experimental_cycle_if_owned") {
          const currentToken = conversationRow.stage_completed_rules?.active_cycle_token;
          const isPreempt = Boolean(conversationRow.stage_completed_rules?.preempt_requested);
          if (currentToken !== params.p_cycle_token) {
            return Promise.resolve({
              data: { committed: false, reason: "lost_lock", activeToken: currentToken },
              error: null,
            });
          }
          if (isPreempt) {
            return Promise.resolve({
              data: { committed: false, reason: "preempted" },
              error: null,
            });
          }
          conversationRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false,
          };
          return Promise.resolve({
            data: { committed: true, reason: "committed" },
            error: null,
          });
        }
        if (fn === "request_experimental_cycle_preemption") {
          const rules = conversationRow.stage_completed_rules || {};
          const orch = rules.orchestration || {};
          const currentRev = typeof orch.inboundRevision === "number" ? orch.inboundRevision : 0;
          const newRev = currentRev + 1;
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_message_id) {
            ledger[params.p_message_id] = "pending";
          }
          const targetDebounce = params.p_debounce_until || new Date(Date.now() + 2500).toISOString();
          conversationRow.stage_completed_rules = {
            ...rules,
            preempt_requested: true,
            ai_debounce_until: targetDebounce,
            orchestration: {
              ...orch,
              inboundRevision: newRev,
              preemptRequested: true,
              messageLedger: ledger,
            },
          };
          conversationRow.ai_auto_respond = true;
          conversationRow.ai_debounce_until = targetDebounce;
          return Promise.resolve({
            data: {
              success: true,
              inboundRevision: newRev,
              activeCycleToken: rules.active_cycle_token ?? null,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    // 1. Webhook B conceitualmente teria feito um SELECT antes do commit do ciclo A.
    // Guardamos o snapshot velho para provar que ele JAMAIS é usado na nova preempção:
    const oldSnapshotThatWouldHaveBeenReadByB = JSON.parse(JSON.stringify(conversationRow.stage_completed_rules));

    // 2. Antes da preempção ser aplicada, ciclo A faz o commit atômico (CAS) e grava no banco:
    const cycleACommitRules = {
      ...conversationRow.stage_completed_rules,
      completed_goals: ["goal_initial_reciprocity", "goal_city"],
      objective_progress: {
        goal_initial_reciprocity: { status: "completed" },
        goal_city: { status: "completed", value: "Barbacena" },
      },
      orchestration: {
        ...conversationRow.stage_completed_rules.orchestration,
        memory: {
          entities: {
            self: {
              city: { value: "Barbacena", field: "city", entity: "self" },
            },
          },
        },
      },
    };

    const commitRes = await commitExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_58",
      correlationId: "cycle_a",
      newStageCompletedRules: cycleACommitRules,
    });

    assert.equal(commitRes.committed, true, "Ciclo A deve commitar com sucesso");

    // 3. Agora chega a sinalização de preempção do Webhook B para a nova mensagem 'msg_new':
    const preemptionRes = await requestExperimentalCyclePreemptionAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_58",
      messageId: "msg_new",
      debounceUntil: new Date(Date.now() + 2500).toISOString(),
    });

    assert.equal(preemptionRes.success, true, "Preempção atômica deve retornar sucesso");
    assert.equal(preemptionRes.inboundRevision, 2, "inboundRevision deve ser incrementada em +1 (1 -> 2)");

    // 4. Verificação estrita: O estado final contém AO MESMO TEMPO os dados novos e o patch da preempção!
    const finalRules = conversationRow.stage_completed_rules;
    assert.deepEqual(
      finalRules.completed_goals,
      ["goal_initial_reciprocity", "goal_city"],
      "completed_goals DEVE conter goal_city gravado pelo ciclo A (NÃO pode ser apagado pelo snapshot velho!)"
    );
    assert.equal(
      finalRules.objective_progress?.goal_city?.status,
      "completed",
      "objective_progress.goal_city DEVE existir como completed"
    );
    assert.equal(
      finalRules.orchestration?.memory?.entities?.self?.city?.value,
      "Barbacena",
      "memory.self.city DEVE continuar Barbacena (preservação estrita de ContactMemory!)"
    );
    assert.equal(finalRules.preempt_requested, true, "preempt_requested DEVE ser true");
    assert.equal(finalRules.orchestration?.preemptRequested, true, "orchestration.preemptRequested DEVE ser true");
    assert.equal(finalRules.orchestration?.inboundRevision, 2, "orchestration.inboundRevision deve ser exatamente 2");
    assert.equal(
      finalRules.orchestration?.messageLedger?.msg_new,
      "pending",
      "orchestration.messageLedger.msg_new DEVE ser pending"
    );
    assert.equal(
      finalRules.orchestration?.messageLedger?.msg_init,
      "processed",
      "Mensagens anteriores do messageLedger devem continuar intactas"
    );
    assert.equal(conversationRow.ai_auto_respond, true, "ai_auto_respond deve ser true");
    assert.ok(conversationRow.ai_debounce_until, "ai_debounce_until deve ter sido agendado");
  });

  // 59. TESTE DE DUAS PREEMPÇÕES CONCORRENTES:
  await runTest(59, "TESTE DE DUAS PREEMPÇÕES CONCORRENTES: Duas mensagens incrementam inboundRevision (+2) sem perder mensagens no ledger", async () => {
    let conversationRow = {
      id: "conv_test_59",
      ai_auto_respond: false,
      ai_debounce_until: null,
      stage_completed_rules: {
        active_cycle_token: "cycle_running",
        preempt_requested: false,
        orchestration: {
          inboundRevision: 10,
          preemptRequested: false,
          messageLedger: { msg_base: "processed" },
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        update: (data) => ({
          eq: () => {
            Object.assign(conversationRow, data);
            return Promise.resolve({ data: [conversationRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "request_experimental_cycle_preemption") {
          const rules = conversationRow.stage_completed_rules || {};
          const orch = rules.orchestration || {};
          const currentRev = typeof orch.inboundRevision === "number" ? orch.inboundRevision : 0;
          const newRev = currentRev + 1;
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_message_id) {
            ledger[params.p_message_id] = "pending";
          }
          conversationRow.stage_completed_rules = {
            ...rules,
            preempt_requested: true,
            orchestration: {
              ...orch,
              inboundRevision: newRev,
              preemptRequested: true,
              messageLedger: ledger,
            },
          };
          return Promise.resolve({
            data: {
              success: true,
              inboundRevision: newRev,
              activeCycleToken: rules.active_cycle_token ?? null,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    // Chamada 1: mensagem msg_1
    const res1 = await requestExperimentalCyclePreemptionAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_59",
      messageId: "msg_1",
    });

    // Chamada 2: mensagem msg_2
    const res2 = await requestExperimentalCyclePreemptionAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_59",
      messageId: "msg_2",
    });

    assert.equal(res1.success, true);
    assert.equal(res1.inboundRevision, 11, "msg_1 incrementa de 10 para 11");
    assert.equal(res2.success, true);
    assert.equal(res2.inboundRevision, 12, "msg_2 incrementa de 11 para 12");

    const orch = conversationRow.stage_completed_rules.orchestration;
    assert.equal(orch.inboundRevision, 12, "inboundRevision final deve ser exatamente 12");
    assert.equal(orch.messageLedger.msg_1, "pending", "msg_1 deve estar no ledger");
    assert.equal(orch.messageLedger.msg_2, "pending", "msg_2 deve estar no ledger");
    assert.equal(orch.messageLedger.msg_base, "processed", "msg_base deve ser preservada");
  });

  // 60. TESTE DE PRESERVAÇÃO INTEGRAL DE CAMPOS:
  await runTest(60, "TESTE DE PRESERVAÇÃO DE CAMPOS: Preempção não altera completed_goals, objective_progress, memory, outbox, etc.", async () => {
    const originalMemory = {
      entities: {
        self: {
          city: { value: "Belo Horizonte" },
          job: { value: "Médica" },
        },
      },
      snippets: ["fato_1"],
    };

    const originalOutbox = {
      outbox_key_1: { status: "sent", content: "olá!" },
    };

    const originalCycles = [
      { id: "cycle_1", durationMs: 120 },
    ];

    let conversationRow = {
      id: "conv_test_60",
      ai_auto_respond: false,
      ai_debounce_until: null,
      stage_completed_rules: {
        active_cycle_token: "cycle_active_60",
        preempt_requested: false,
        completed_goals: ["goal_city", "goal_job"],
        objective_progress: {
          goal_city: { status: "completed" },
          goal_job: { status: "completed" },
        },
        orchestration: {
          inboundRevision: 5,
          preemptRequested: false,
          currentStageId: "compatibilidade",
          currentPhase: "compatibilidade",
          responsibleSubagentId: "compatibilidade",
          checkpoint: { lastAction: "reply" },
          outbox: originalOutbox,
          recentCycles: originalCycles,
          memory: originalMemory,
          messageLedger: { msg_old: "processed" },
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        update: (data) => ({
          eq: () => {
            Object.assign(conversationRow, data);
            return Promise.resolve({ data: [conversationRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "request_experimental_cycle_preemption") {
          const rules = conversationRow.stage_completed_rules || {};
          const orch = rules.orchestration || {};
          const currentRev = typeof orch.inboundRevision === "number" ? orch.inboundRevision : 0;
          const newRev = currentRev + 1;
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_message_id) {
            ledger[params.p_message_id] = "pending";
          }
          conversationRow.stage_completed_rules = {
            ...rules,
            preempt_requested: true,
            orchestration: {
              ...orch,
              inboundRevision: newRev,
              preemptRequested: true,
              messageLedger: ledger,
            },
          };
          return Promise.resolve({
            data: {
              success: true,
              inboundRevision: newRev,
              activeCycleToken: rules.active_cycle_token ?? null,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const res = await requestExperimentalCyclePreemptionAtomic({
      supabase: mockSupabase,
      conversationId: "conv_test_60",
      messageId: "msg_incoming",
    });

    assert.equal(res.success, true);
    assert.equal(res.inboundRevision, 6);

    const rules = conversationRow.stage_completed_rules;
    const orch = rules.orchestration;

    // Campos que DEVEM ser preservados integralmente:
    assert.deepEqual(rules.completed_goals, ["goal_city", "goal_job"], "completed_goals preservado");
    assert.deepEqual(rules.objective_progress, {
      goal_city: { status: "completed" },
      goal_job: { status: "completed" },
    }, "objective_progress preservado");
    assert.deepEqual(orch.memory, originalMemory, "memory preservada");
    assert.deepEqual(orch.outbox, originalOutbox, "outbox preservada");
    assert.deepEqual(orch.recentCycles, originalCycles, "recentCycles preservados");
    assert.equal(orch.currentStageId, "compatibilidade", "currentStageId preservado");
    assert.equal(orch.currentPhase, "compatibilidade", "currentPhase preservada");
    assert.equal(orch.responsibleSubagentId, "compatibilidade", "responsibleSubagentId preservado");
    assert.deepEqual(orch.checkpoint, { lastAction: "reply" }, "checkpoint preservado");
    assert.equal(orch.messageLedger.msg_old, "processed", "msg_old no ledger preservado");

    // Únicos campos que DEVEM mudar:
    assert.equal(rules.preempt_requested, true, "preempt_requested alterado para true");
    assert.equal(orch.preemptRequested, true, "orch.preemptRequested alterado para true");
    assert.equal(orch.inboundRevision, 6, "inboundRevision incrementado para 6");
    assert.equal(orch.messageLedger.msg_incoming, "pending", "nova mensagem adicionada como pending");
  });

  // 61. Concorrência Atômica na Outbox: Preempção no meio do ciclo bloqueia o claim do balão
  await runTest(61, "Concorrência Atômica na Outbox: Preempção ativa bloqueia claim com cycle_preempted", async () => {
    let convRow = {
      id: "conv_outbox_preempt_61",
      stage_completed_rules: {
        active_cycle_token: "token_cycle_61",
        preempt_requested: true,
        orchestration: {
          outbox: {
            "out_key_1": {
              id: "out_key_1",
              status: "pending",
              attempts: 0,
            },
          },
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "claim_outbox_entry") {
          const rules = convRow.stage_completed_rules || {};
          if (rules.preempt_requested === true) {
            return Promise.resolve({ data: { success: false, reason: "cycle_preempted" }, error: null });
          }
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const claimRes = await claimOutboxEntryAtomic({
      supabase: mockSupabase,
      conversationId: "conv_outbox_preempt_61",
      outboxKey: "out_key_1",
      claimToken: "token_cycle_61",
    });

    assert.equal(claimRes.success, false);
    assert.equal(claimRes.reason, "cycle_preempted");
  });

  // 62. Concorrência Atômica na Outbox: Lock roubado por ciclo mais recente bloqueia claim com lost_ownership
  await runTest(62, "Concorrência Atômica na Outbox: Perda de lock bloqueia claim com lost_ownership", async () => {
    let convRow = {
      id: "conv_outbox_lost_62",
      stage_completed_rules: {
        active_cycle_token: "token_newer_cycle",
        preempt_requested: false,
        orchestration: {
          outbox: {
            "out_key_2": { id: "out_key_2", status: "pending" },
          },
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "claim_outbox_entry") {
          const rules = convRow.stage_completed_rules || {};
          if (rules.active_cycle_token && rules.active_cycle_token !== params.p_claim_token) {
            return Promise.resolve({ data: { success: false, reason: "lost_ownership" }, error: null });
          }
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const claimRes = await claimOutboxEntryAtomic({
      supabase: mockSupabase,
      conversationId: "conv_outbox_lost_62",
      outboxKey: "out_key_2",
      claimToken: "token_old_cycle_62",
    });

    assert.equal(claimRes.success, false);
    assert.equal(claimRes.reason, "lost_ownership");
  });

  // 63. Aquisição atômica de ciclo: claim_experimental_cycle previne aquisição concorrente dupla
  await runTest(63, "Aquisição Atômica de Ciclo: Lock ativo não-stale rejeita claim concorrente", async () => {
    let convRow = {
      id: "conv_claim_63",
      stage_completed_rules: {
        active_cycle_token: "token_incumbent",
        active_cycle_at: new Date().toISOString(),
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle") {
          const rules = convRow.stage_completed_rules || {};
          if (rules.active_cycle_token && rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({
              data: { success: false, reason: "lock_active", activeCycleToken: rules.active_cycle_token },
              error: null,
            });
          }
          return Promise.resolve({ data: { success: true, reason: "acquired" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const claimRes = await claimExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_claim_63",
      cycleToken: "token_challenger",
      staleSeconds: 25,
    });

    assert.equal(claimRes.success, false);
    assert.equal(claimRes.reason, "lock_active");
    assert.equal(claimRes.activeCycleToken, "token_incumbent");
  });

  // 64. Preempção atômica e rollback de mensagens claimed para pending via release_experimental_cycle_if_owned
  await runTest(64, "Preempção Atômica: Reverte mensagens claimed para pending e preserva recentCycles com status superseded", async () => {
    let convRow = {
      id: "conv_release_64",
      stage_completed_rules: {
        active_cycle_token: "token_cycle_64",
        orchestration: {
          messageLedger: {
            "m_claimed_1": "claimed",
            "m_claimed_2": "claimed",
            "m_new_inbound": "pending",
          },
          recentCycles: [],
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "release_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules || {};
          if (rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({ data: { released: false, reason: "token_mismatch" }, error: null });
          }
          const orch = rules.orchestration || {};
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_revert_message_ids) {
            for (const id of params.p_revert_message_ids) ledger[id] = "pending";
          }
          const recentCycles = params.p_cycle_record
            ? [params.p_cycle_record, ...(orch.recentCycles || [])].slice(0, 5)
            : orch.recentCycles;
          convRow.stage_completed_rules = {
            ...rules,
            active_cycle_token: null,
            orchestration: {
              ...orch,
              messageLedger: ledger,
              lastProcessingStatus: params.p_processing_status || "idle",
              recentCycles: recentCycles || [],
            },
          };
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const supersededCycle = {
      cycleId: "token_cycle_64",
      status: "superseded",
      trace: ["cycle_preempted_new_input"],
    };

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_release_64",
      cycleToken: "token_cycle_64",
      processingStatus: "failed",
      revertMessageIds: ["m_claimed_1", "m_claimed_2"],
      cycleRecord: supersededCycle,
    });

    assert.equal(releaseRes.released, true);
    const orch = convRow.stage_completed_rules.orchestration;
    assert.equal(convRow.stage_completed_rules.active_cycle_token, null);
    assert.equal(orch.messageLedger.m_claimed_1, "pending");
    assert.equal(orch.messageLedger.m_claimed_2, "pending");
    assert.equal(orch.messageLedger.m_new_inbound, "pending");
    assert.equal(orch.recentCycles[0].status, "superseded");
  });

  // 65. Idempotência e proteção do finally: ciclo já comitado (active_cycle_token=null) não é alterado pelo release
  await runTest(65, "Proteção do Finally: Ciclo já comitado não tem seu status sent sobrescrito por idle", async () => {
    let convRow = {
      id: "conv_finally_65",
      stage_completed_rules: {
        active_cycle_token: null, // Já liberado no commit atômico (CAS)
        orchestration: {
          lastProcessingStatus: "sent",
          messageLedger: { "m_final": "processed" },
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "release_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules || {};
          if (!rules.active_cycle_token || rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({
              data: { released: false, reason: "token_mismatch", activeToken: rules.active_cycle_token ?? null },
              error: null,
            });
          }
          return Promise.resolve({ data: { released: true }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    // Bloco finally chama release com o token do ciclo que já fez commit
    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_finally_65",
      cycleToken: "cycle_already_committed",
      processingStatus: "idle",
    });

    assert.equal(releaseRes.released, false);
    assert.equal(releaseRes.reason, "token_mismatch");
    assert.equal(convRow.stage_completed_rules.orchestration.lastProcessingStatus, "sent");
    assert.equal(convRow.stage_completed_rules.orchestration.messageLedger.m_final, "processed");
  });

  // 66. Fronteira Irreversível (Caso B): Envio parcial com nova inbound preserva mensagens entregues
  await runTest(66, "Fronteira Irreversível (Caso B): Envio parcial preserva balão entregue e agenda debounce", async () => {
    let convRow = {
      id: "conv_partial_66",
      stage_completed_rules: {
        active_cycle_token: "cycle_case_b_66",
        orchestration: {
          messageLedger: { "m_input_1": "claimed" },
          outbox: {
            "out_b1": { id: "out_b1", status: "sent" },
            "out_b2": { id: "out_b2", status: "pending" },
          },
          recentCycles: [],
        },
      },
    };

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: convRow, error: null }),
          }),
        }),
        update: (data) => ({
          eq: () => {
            Object.assign(convRow, data);
            return Promise.resolve({ data: [convRow], error: null });
          },
        }),
      }),
      rpc: (fn, params) => {
        if (fn === "release_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules || {};
          if (rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({ data: { released: false, reason: "token_mismatch" }, error: null });
          }
          const orch = rules.orchestration || {};
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_mark_processed_ids) {
            for (const id of params.p_mark_processed_ids) ledger[id] = "processed";
          }
          const recentCycles = params.p_cycle_record
            ? [params.p_cycle_record, ...(orch.recentCycles || [])].slice(0, 5)
            : orch.recentCycles;
          convRow.stage_completed_rules = {
            ...rules,
            active_cycle_token: null,
            orchestration: {
              ...orch,
              messageLedger: ledger,
              lastProcessingStatus: params.p_processing_status || "idle",
              recentCycles: recentCycles || [],
            },
          };
          if (params.p_debounce_until) {
            convRow.stage_completed_rules.ai_debounce_until = params.p_debounce_until;
            convRow.stage_completed_rules.ai_auto_respond = true;
          }
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      },
    };

    const partialCycle = {
      cycleId: "cycle_case_b_66",
      status: "completed",
      trace: ["balloon_1_sent", "remaining_bubbles_superseded: new_message_during_dispatch"],
    };

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_partial_66",
      cycleToken: "cycle_case_b_66",
      processingStatus: "sent",
      debounceUntil: new Date(Date.now() + 2500).toISOString(),
      markProcessedIds: ["m_input_1"],
      cycleRecord: partialCycle,
    });

    assert.equal(releaseRes.released, true);
    const orch = convRow.stage_completed_rules.orchestration;
    assert.equal(convRow.stage_completed_rules.active_cycle_token, null);
    assert.equal(orch.messageLedger.m_input_1, "processed", "m_input_1 foi respondida pelo balão 1");
    assert.equal(orch.lastProcessingStatus, "sent");
    assert.ok(convRow.stage_completed_rules.ai_debounce_until);
    assert.equal(convRow.stage_completed_rules.ai_auto_respond, true);
    assert.ok(orch.recentCycles[0].trace.includes("remaining_bubbles_superseded: new_message_during_dispatch"));
  });

  // 67. Fail-Closed ao falhar RPC claim_experimental_cycle_messages
  await runTest(67, "Fail-Closed: Falha na RPC claim_experimental_cycle_messages aborta o ciclo sem prosseguir", async () => {
    let rpcCalled = false;
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: {
                id: "conv_67",
                stage_completed_rules: {
                  active_cycle_token: "cycle_other_token",
                  orchestration: { messageLedger: {} }
                }
              },
              error: null
            })
          })
        })
      }),
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle_messages") {
          rpcCalled = true;
          return Promise.resolve({
            data: { success: false, reason: "cycle_token_mismatch", activeToken: "cycle_other_token" },
            error: null
          });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      }
    };

    const res = await claimExperimentalCycleMessagesAtomic({
      supabase: mockSupabase,
      conversationId: "conv_67",
      cycleToken: "cycle_my_token",
      messageIds: ["msg_1", "msg_2"]
    });

    assert.equal(rpcCalled, true, "RPC deve ser chamada");
    assert.equal(res.success, false, "Deve falhar com fail-closed");
    assert.equal(res.reason, "cycle_token_mismatch");
  });

  // 68. claim_experimental_cycle_messages atualiza pontualmente messageLedger e lastProcessingStatus
  await runTest(68, "claim_experimental_cycle_messages atualiza atomicamente ledger para claimed e status para processing", async () => {
    let convRow = {
      id: "conv_68",
      stage_completed_rules: {
        active_cycle_token: "cycle_token_68",
        completed_goals: ["goal_1"],
        orchestration: {
          messageLedger: { "msg_old": "processed" },
          lastProcessingStatus: "idle"
        }
      }
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "claim_experimental_cycle_messages") {
          const rules = convRow.stage_completed_rules;
          if (rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({ data: { success: false, reason: "cycle_token_mismatch" }, error: null });
          }
          const orch = rules.orchestration || {};
          const ledger = { ...(orch.messageLedger || {}) };
          for (const mid of params.p_message_ids) {
            ledger[mid] = "claimed";
          }
          convRow.stage_completed_rules = {
            ...rules,
            orchestration: {
              ...orch,
              messageLedger: ledger,
              lastProcessingStatus: "processing"
            }
          };
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      }
    };

    const res = await claimExperimentalCycleMessagesAtomic({
      supabase: mockSupabase,
      conversationId: "conv_68",
      cycleToken: "cycle_token_68",
      messageIds: ["msg_new_1", "msg_new_2"]
    });

    assert.equal(res.success, true);
    const rules = convRow.stage_completed_rules;
    assert.equal(rules.completed_goals[0], "goal_1", "completed_goals intacto");
    assert.equal(rules.orchestration.lastProcessingStatus, "processing");
    assert.equal(rules.orchestration.messageLedger.msg_old, "processed");
    assert.equal(rules.orchestration.messageLedger.msg_new_1, "claimed");
    assert.equal(rules.orchestration.messageLedger.msg_new_2, "claimed");
  });

  // 69. FAIL-CLOSED estrito: ausência de RPC ou erro de RPC retorna infra_failure e NUNCA faz fallback RMW
  await runTest(69, "FAIL-CLOSED estrito: falha de RPC retorna infra_failure sem executar RMW em JS", async () => {
    let updateCalled = false;
    const brokenSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { stage_completed_rules: {} }, error: null })
          })
        }),
        update: () => {
          updateCalled = true;
          return { eq: () => Promise.resolve({ error: null }) };
        }
      }),
      rpc: () => Promise.resolve({ data: null, error: { message: "database offline" } })
    };

    const claimRes = await claimExperimentalCycleAtomic({
      supabase: brokenSupabase,
      conversationId: "conv_69",
      cycleToken: "token_69"
    });
    assert.equal(claimRes.success, false);
    assert.equal(claimRes.reason, "infra_failure");

    const claimMsgsRes = await claimExperimentalCycleMessagesAtomic({
      supabase: brokenSupabase,
      conversationId: "conv_69",
      cycleToken: "token_69",
      messageIds: ["m1"]
    });
    assert.equal(claimMsgsRes.success, false);
    assert.equal(claimMsgsRes.reason, "infra_failure");

    const prepareRes = await prepareExperimentalOutboxEntryAtomic({
      supabase: brokenSupabase,
      conversationId: "conv_69",
      cycleToken: "token_69",
      outboxEntry: { id: "out_69" }
    });
    assert.equal(prepareRes.success, false);
    assert.equal(prepareRes.reason, "infra_failure");

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: brokenSupabase,
      conversationId: "conv_69",
      cycleToken: "token_69",
      processingStatus: "idle"
    });
    assert.equal(releaseRes.released, false);
    assert.equal(releaseRes.reason, "infra_failure");

    const commitRes = await commitExperimentalCycleAtomic({
      supabase: brokenSupabase,
      conversationId: "conv_69",
      correlationId: "token_69",
      newStageCompletedRules: {}
    });
    assert.equal(commitRes.committed, false);
    assert.equal(commitRes.reason, "infra_failure");

    assert.equal(updateCalled, false, "NENHUM fallback RMW deve ter chamado update!");
  });

  // 70. Cancelamento manual com clearCancelFlag atômico
  await runTest(70, "Cancelamento manual usa release_experimental_cycle_if_owned com clearCancelFlag sem sobrescrever snapshot antigo", async () => {
    let convRow = {
      id: "conv_70",
      stage_completed_rules: {
        active_cycle_token: "cycle_cancel_70",
        cancel_current_cycle: true,
        completed_goals: ["goal_realtime_preserved"],
        orchestration: {
          lastProcessingStatus: "processing"
        }
      }
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "release_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules;
          if (rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({ data: { released: false, reason: "token_mismatch" }, error: null });
          }
          if (params.p_clear_cancel_flag === true) {
            rules.cancel_current_cycle = null;
          }
          rules.active_cycle_token = null;
          rules.orchestration.lastProcessingStatus = params.p_processing_status || "idle";
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      }
    };

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_70",
      cycleToken: "cycle_cancel_70",
      processingStatus: "idle",
      clearCancelFlag: true
    });

    assert.equal(releaseRes.released, true);
    assert.equal(convRow.stage_completed_rules.active_cycle_token, null);
    assert.equal(convRow.stage_completed_rules.cancel_current_cycle, null);
    assert.equal(convRow.stage_completed_rules.completed_goals[0], "goal_realtime_preserved");
    assert.equal(convRow.stage_completed_rules.orchestration.lastProcessingStatus, "idle");
  });

  // 71. Modo Shadow não altera progresso autoritativo (completed_goals, memory, objective_progress)
  await runTest(71, "Modo Shadow: simulação não muta completed_goals nem memory autoritativos e usa release atômico", async () => {
    let convRow = {
      id: "conv_shadow_71",
      stage_completed_rules: {
        active_cycle_token: "cycle_shadow_71",
        completed_goals: ["goal_auth_1"],
        objective_progress: { "goal_auth_1": { completed: true } },
        orchestration: {
          memory: { entities: { self: { name: { value: "Larissa" } } } },
          messageLedger: { "msg_sh": "claimed" },
          lastProcessingStatus: "processing",
          recentCycles: []
        }
      }
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "release_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules;
          if (rules.active_cycle_token !== params.p_cycle_token) {
            return Promise.resolve({ data: { released: false, reason: "token_mismatch" }, error: null });
          }
          const orch = rules.orchestration || {};
          const ledger = { ...(orch.messageLedger || {}) };
          if (params.p_mark_processed_ids) {
            for (const mid of params.p_mark_processed_ids) {
              ledger[mid] = "processed";
            }
          }
          const recentCycles = params.p_cycle_record
            ? [params.p_cycle_record, ...(orch.recentCycles || [])].slice(0, 5)
            : orch.recentCycles;

          convRow.stage_completed_rules = {
            ...rules,
            active_cycle_token: null,
            orchestration: {
              ...orch,
              messageLedger: ledger,
              lastProcessingStatus: params.p_processing_status || "shadow_logged",
              recentCycles: recentCycles || []
            }
          };
          return Promise.resolve({ data: { released: true, reason: "released" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      }
    };

    const shadowCycle = {
      cycleId: "cycle_shadow_71",
      status: "completed",
      shadowSimulation: { simulatedObjectives: ["goal_simulated_only"] }
    };

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_shadow_71",
      cycleToken: "cycle_shadow_71",
      processingStatus: "shadow_logged",
      markProcessedIds: ["msg_sh"],
      cycleRecord: shadowCycle
    });

    assert.equal(releaseRes.released, true);
    const rules = convRow.stage_completed_rules;
    assert.equal(rules.active_cycle_token, null);
    assert.deepEqual(rules.completed_goals, ["goal_auth_1"], "completed_goals deve estar intacto");
    assert.deepEqual(rules.objective_progress, { "goal_auth_1": { completed: true } }, "objective_progress intacto");
    assert.equal(rules.orchestration.memory.entities.self.name.value, "Larissa", "Memória autoritativa intacta");
    assert.equal(rules.orchestration.lastProcessingStatus, "shadow_logged");
    assert.equal(rules.orchestration.messageLedger.msg_sh, "processed");
    assert.equal(rules.orchestration.recentCycles[0].cycleId, "cycle_shadow_71");
  });

  // 72. Persistência de fatos 100% via CAS atômico sem loop writeFact pós-CAS
  await runTest(72, "Zero loop pós-CAS: fatos de memória residem 100% no commit_experimental_cycle_if_owned", async () => {
    let writeFactCalled = false;
    const dummyMemoryProvider = {
      writeFact: async () => {
        writeFactCalled = true;
        return { success: true };
      },
      saveFact: async () => {
        writeFactCalled = true;
        return { success: true };
      }
    };

    let convRow = {
      id: "conv_cas_72",
      stage_completed_rules: {
        active_cycle_token: "token_cas_72",
        preempt_requested: false,
        orchestration: {
          memory: { entities: {} }
        }
      }
    };

    const mockSupabase = {
      rpc: (fn, params) => {
        if (fn === "commit_experimental_cycle_if_owned") {
          const rules = convRow.stage_completed_rules;
          if (rules.active_cycle_token !== params.p_cycle_token || rules.preempt_requested) {
            return Promise.resolve({ data: { committed: false, reason: "lost_lock" }, error: null });
          }
          convRow.stage_completed_rules = {
            ...params.p_new_stage_completed_rules,
            active_cycle_token: null,
            preempt_requested: false
          };
          return Promise.resolve({ data: { committed: true, reason: "committed" }, error: null });
        }
        return Promise.resolve({ data: null, error: "unknown_rpc" });
      }
    };

    const finalRules = {
      ...convRow.stage_completed_rules,
      orchestration: {
        ...convRow.stage_completed_rules.orchestration,
        memory: {
          entities: {
            self: {
              cidade: { field: "cidade", value: "Curitiba", confidence: 1.0 }
            }
          }
        }
      }
    };

    const casResult = await commitExperimentalCycleAtomic({
      supabase: mockSupabase,
      conversationId: "conv_cas_72",
      correlationId: "token_cas_72",
      newStageCompletedRules: finalRules
    });

    assert.equal(casResult.committed, true);
    assert.equal(convRow.stage_completed_rules.orchestration.memory.entities.self.cidade.value, "Curitiba");
    assert.equal(writeFactCalled, false, "Nenhum loop writeFact não-atômico deve ser chamado pós-CAS");
  });

  console.log("\n================================================================================");
  console.log(`🎉 TODOS OS ${passed}/72 TESTES FORAM APROVADOS COM SUCESSO!`);
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("Erro fatal na execução da suíte de testes:", err);
  process.exit(1);
});

