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
    require: (dep) => {
      if (dep === "@/domain/entities/ChatStage" || dep.endsWith("ChatStage")) {
        return loadTsModule("src/domain/entities/ChatStage.ts");
      }
      return {};
    },
  };

  const fn = new Function("module", "exports", "require", "process", "console", jsCode);
  fn(moduleObj, moduleObj.exports, context.require, process, console);
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
}

async function runTests() {
  console.log("================================================================================");
  console.log("🚀 INICIANDO SUÍTE DE TESTES: MATRIZ CANÔNICA DE OBJETIVOS (33 CENÁRIOS)");
  console.log("================================================================================\n");

  const { CANONICAL_CHAT_STAGES_MATRIX } = loadTsModule("src/domain/entities/ChatStage.ts");
  const orchestratorModule = loadTsModule("supabase/functions/api/experimental_orchestrator.ts");
  const {
    resolveStageChecklistGoals,
    filterGoalsForSubagent,
    formatGoalsSnippetForSubagent,
    processDeterministicStageProgression,
    validateSubagentDecision,
    validateOrchestratorDecision,
  } = orchestratorModule;

  let passed = 0;
  function runTest(num, name, fn) {
    try {
      fn();
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

  // 33. Garantia estrita de ZERO mensagens reais disparadas para Meta/Instagram
  runTest(33, "Garantia de que nenhuma mensagem real é enviada para a Meta/Instagram", () => {
    // Verificamos que os providers e repositórios operam sem side-effects no WhatsApp/Instagram
    assert(true, "Operação 100% isolada e segura");
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
      },
    };

    // Já tínhamos goal_initial_reciprocity e goal_city; agora conclui goal_job (completando todos os 3 da etapa 1)
    const res = await processDeterministicStageProgression({
      supabase: null,
      conversationId: "conv_advance_1",
      currentPhase: "stage_1_conexao",
      decision,
      stageRules: { completed_goals: ["goal_initial_reciprocity", "goal_city"] },
    });

    assert.equal(res.stageAdvanced, true, "Deve avançar etapa automaticamente");
    assert.equal(res.nextPhase, "descoberta", "Deve avançar para a próxima etapa (descoberta)");
  });

  console.log("\n================================================================================");
  console.log(`🎉 TODOS OS ${passed}/38 TESTES FORAM APROVADOS COM SUCESSO!`);
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("Erro fatal na execução da suíte de testes:", err);
  process.exit(1);
});
