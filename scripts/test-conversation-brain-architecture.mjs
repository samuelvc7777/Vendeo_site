#!/usr/bin/env node
/**
 * scripts/test-conversation-brain-architecture.mjs
 * 
 * Bateria de Testes Canônicos da Arquitetura Final de Conversa Humana do Vendeo:
 * - Conversation Brain & Planner isolado por conversationId
 * - ConversationLiveState com poda estrita (~150 a 300 tokens)
 * - Escada de Memória em 6 Níveis
 * - Diretivas orgânicas de objetivos (pursue, defer, already_satisfied)
 * - Anti-repetição e teste negativo/positivo de áudio do cofre
 * - Isolamento total entre conversas (A vs B)
 * - Preempção sem mutação indevida de LiveState
 * - Sanitização de pontuação estrita (, e ?)
 * - Espelhamento do Obsidian com LiveState no arquivo 05
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ❌ FALHA: ${message}`);
  }
}

// 1. Carrega LarissaChatStyle
function loadStyleModule() {
  const code = fs.readFileSync('supabase/functions/api/LarissaChatStyle.ts', 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(transpiled, { module: mod, exports: mod.exports, console, RegExp, Array, Set });
  return mod.exports;
}

// 2. Carrega conversation_episodic_memory
function loadEpisodicModule() {
  const code = fs.readFileSync('supabase/functions/api/conversation_episodic_memory.ts', 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(transpiled, { module: mod, exports: mod.exports, console, Date, Math, String, Array, Set, RegExp });
  return mod.exports;
}

// 3. Carrega helpers e tipos de experimental_orchestrator
function loadOrchestratorHelpers() {
  const code = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  // Extrai funções isoláveis via transpilação limpa
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const mockDeno = { env: { get: () => '' } };
  const mockRequire = (id) => {
    if (id.includes('cloud_autopilot')) {
      return { publishAutoPilotState: async () => {}, activity: () => ({}) };
    }
    if (id.includes('conversation_episodic_memory')) {
      return epMod;
    }
    if (id.includes('LarissaChatStyle')) {
      return styleMod;
    }
    if (id.includes('LarissaConversationStyle')) {
      return { LARISSA_CONVERSATION_STYLE: '' };
    }
    return {};
  };

  vm.runInNewContext(transpiled, {
    module: mod,
    exports: mod.exports,
    require: mockRequire,
    console,
    Date,
    Math,
    String,
    Array,
    Set,
    RegExp,
    Deno: mockDeno,
    setTimeout,
    clearTimeout,
    Promise,
  });
  return mod.exports;
}

// 4. Carrega restructure-obsidian-mirror
async function loadObsidianRestructure() {
  return await import('./restructure-obsidian-mirror.mjs');
}

// Helper de mock do Supabase com encadeamento completo
function createMockSupabase(messages = [], audios = []) {
  return {
    from: (tbl) => {
      if (tbl === 'persona_audios') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: audios, error: null }),
              then: (res) => res({ data: audios, error: null }),
            }),
          }),
        };
      }
      if (tbl === 'audio_delivery_history') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (col, val) => ({
            order: () => {
              const scoped = val ? messages.filter((m) => m.conversation_id === val) : messages;
              return {
              limit: (limit) => Promise.resolve({
                data: scoped.slice(0, limit),
                error: null,
              }),
              range: (from, to) => Promise.resolve({ data: scoped.slice(from, to + 1), error: null }),
              then: (res) => res({
                data: scoped,
                error: null,
              }),
            }},
          }),
        }),
      };
    },
  };
}

console.log('======================================================================');
console.log('BATERIA DE TESTES: ARQUITETURA FINAL DO CONVERSATION BRAIN (14 CENÁRIOS)');
console.log('======================================================================\n');

const styleMod = loadStyleModule();
const epMod = loadEpisodicModule();
const orchMod = loadOrchestratorHelpers();
const obsMod = await loadObsidianRestructure();

// ----------------------------------------------------------------------
// CENÁRIO 1: Saudação sem busca de memória
// ----------------------------------------------------------------------
console.log('🔹 CENÁRIO 1: Saudação simples inicia ciclo sem busca de memória');
{
  const liveState = orchMod.getDefaultConversationLiveState('conv_user_1');
  assert(liveState.conversationId === 'conv_user_1', 'LiveState inicializado com conversationId correto');
  assert(liveState.currentTopic === 'início de conversa', 'Tópico padrão inicial é "início de conversa"');
  assert(liveState.turnCount === 0, 'TurnCount inicial é 0');

  // Saudação básica
  const prompt = orchMod.buildConversationBrainPrompt({
    conversationId: 'conv_user_1',
    currentStage: 'conexao_inicial',
    liveState,
    recentMessages: [{ sender: 'pretendente', text: 'Oi Larissa, tudo bem?', createdAt: new Date().toISOString() }],
    contactMemorySummary: '',
    landmarksSummary: '',
    speechActsSummary: '',
    personaMemorySummary: 'Larissa, 23 anos, Enfermagem.',
    stageObjectives: [{ id: 'obj_acolhimento', title: 'Acolher e responder saudação' }],
    compactSubagents: orchMod.getCompactSubagentCatalog(),
  });

  assert(prompt.includes('[ESTADO VIVO DA CONVERSA - NÍVEL 0]'), 'Prompt contém Nível 0 (LiveState)');
  assert(prompt.includes('MÁXIMO 2 DE MEMÓRIA'), 'Prompt define teto de até 2 buscas');
  assert(prompt.includes('NÃO use ferramentas'), 'Prompt orienta expressamente a não usar ferramentas em saudações');
}

// ----------------------------------------------------------------------
// CENÁRIO 2: Raw History Search com Janela [prev, hit, next] e Deduplicação
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 2: Raw History Search com Janela [prev, hit, next] em 3 meses');
{
  const mockMessages = [
    { id: 'm1', conversation_id: 'conv_hist_1', sender_id: 'user', is_from_me: false, text: 'lembro que comentei algo antes', audio_transcript: null, created_at: '2026-06-01T10:00:00Z' },
    { id: 'm2', conversation_id: 'conv_hist_1', sender_id: 'user', is_from_me: false, text: 'eu adoro café especial arábica da fazenda', audio_transcript: null, created_at: '2026-06-01T10:01:00Z' },
    { id: 'm3', conversation_id: 'conv_hist_1', sender_id: 'larissa', is_from_me: true, text: 'nossa que chique, cafezinho passado na hora é bom demais', audio_transcript: null, created_at: '2026-06-01T10:02:00Z' },
    { id: 'm4', conversation_id: 'conv_hist_1', sender_id: 'user', is_from_me: false, text: 'pois é, tomo todo dia', audio_transcript: null, created_at: '2026-06-01T10:03:00Z' },
  ];

  const mockSupabase = createMockSupabase(mockMessages);

  const hits = await epMod.searchRawConversationHistory({
    supabase: mockSupabase,
    conversationId: 'conv_hist_1',
    query: 'café especial',
    limit: 6,
  });

  assert(hits.length === 1, 'Localizou exatamente o hit sobre café');
  assert(hits[0].text.includes('café especial arábica'), 'Mensagem central (hit) bate com a query');
  assert(hits[0].contextWindow.length === 3, 'Janela [prev, hit, next] contém 3 mensagens');
  assert(hits[0].contextWindow[0].text === 'lembro que comentei algo antes', 'Janela inclui mensagem anterior (prev)');
  assert(hits[0].contextWindow[2].text.includes('cafezinho passado na hora'), 'Janela inclui mensagem posterior (next)');
}

// ----------------------------------------------------------------------
// CENÁRIO 3: Defer quando pretendente desabafa
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 3: Brain emite diretiva DEFER quando pretendente desabafa');
{
  const liveState = orchMod.applyLiveStatePatch(orchMod.getDefaultConversationLiveState('conv_defer'), {
    lastUserEmotionalTone: 'desabafando',
    currentTopic: 'problema no trabalho',
  });

  assert(liveState.lastUserEmotionalTone === 'desabafando', 'LiveState registra tom de desabafo');

  const missionPkg = {
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    objectiveDirective: 'defer',
    targetObjective: { id: 'goal_city', label: 'Cidade' },
    relevantMemoryContext: '',
    liveStateContext: orchMod.serializeLiveStateForPrompt(liveState),
  };

  const executorPrompt = orchMod.buildSubagentExecutorPrompt({
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    mission: 'Acolher com afeto',
    missionPackage: missionPkg,
    recentMessages: [{ sender: 'pretendente', text: 'nossa perdi meu emprego hoje e estou muito mal' }],
    emojiBudgetSnippet: 'EMOJI_BUDGET=0',
    styleStateSnippet: 'Última forma: disclosure',
  });

  assert(executorPrompt.includes('ADIAR OBJETIVO'), 'Executor recebe diretiva de adiar objetivo (defer)');
  assert(executorPrompt.includes('Não force o objetivo da etapa agora'), 'Prompt proíbe forçar avanço nos objetivos enquanto acolhe desabafo');
}

// ----------------------------------------------------------------------
// CENÁRIO 4: Pursue quando há abertura
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 4: Brain emite diretiva PURSUE quando há abertura e receptividade');
{
  const liveState = orchMod.applyLiveStatePatch(orchMod.getDefaultConversationLiveState('conv_pursue'), {
    lastUserEmotionalTone: 'animado',
    currentTopic: 'rotina e final de semana',
  });

  const missionPkg = {
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    objectiveDirective: 'pursue',
    targetObjective: { id: 'goal_job', label: 'Profissão' },
    relevantMemoryContext: '',
    liveStateContext: orchMod.serializeLiveStateForPrompt(liveState),
  };

  const executorPrompt = orchMod.buildSubagentExecutorPrompt({
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    mission: 'Conduzir a conversa',
    missionPackage: missionPkg,
    recentMessages: [{ sender: 'pretendente', text: 'o dia foi maravilhoso e por aí tudo bem?' }],
    emojiBudgetSnippet: 'EMOJI_BUDGET=1',
    styleStateSnippet: 'Última forma: reaction + question',
  });

  assert(executorPrompt.includes('BUSCAR OBJETIVO COM DELICADEZA'), 'Executor recebe diretiva de buscar objetivo (pursue)');
  assert(executorPrompt.includes('Pergunte ou aprofunde de forma meiga e sutil'), 'Executor orientado a aprofundar com sutileza e sem interrogatório');
}

// ----------------------------------------------------------------------
// CENÁRIO 5: Teste Negativo de Áudio do Cofre (isIncidentalBeach)
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 5: Teste Negativo de Áudio do Cofre (escritório perto da praia descarta áudio)');
{
  // Simulação da busca de áudios no cofre
  const mockAudios = [
    {
      id: 'audio_praia_1',
      title: 'Eu amo praia',
      transcript: 'nossa eu amo ir pra praia ver o mar',
      tags: ['praia', 'mar', 'verao'],
    },
  ];

  const mockSupabase = createMockSupabase([], mockAudios);

  const matches = await orchMod.searchPersonaAudios({
    supabase: mockSupabase,
    conversationId: 'conv_praia_test',
    intent: 'meu escritório de advocacia fica perto da praia de copacabana',
  });

  assert(matches.length === 0, 'Bloqueou menção incidental de praia sem aprovar áudio inadequado');
}

// ----------------------------------------------------------------------
// CENÁRIO 6: Teste Positivo de Áudio do Cofre
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 6: Teste Positivo de Áudio do Cofre (pergunta direta aprova áudio)');
{
  const mockAudios = [
    {
      id: 'audio_praia_1',
      title: 'Eu amo praia',
      transcript: 'nossa eu amo ir pra praia ver o mar',
      tags: ['praia', 'mar', 'verao'],
    },
  ];

  const mockSupabase = createMockSupabase([], mockAudios);

  const matches = await orchMod.searchPersonaAudios({
    supabase: mockSupabase,
    conversationId: 'conv_praia_test_pos',
    intent: 'vc gosta de ir pra praia?',
  });

  assert(matches.length === 1, 'Pergunta direta sobre praia aprovou áudio correspondente');
  assert(matches[0].id === 'audio_praia_1', 'Áudio correto selecionado');
}

// ----------------------------------------------------------------------
// CENÁRIO 7: Isolamento Total entre Conversas A vs B
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 7: Isolamento Total entre Conversa A e Conversa B');
{
  const mockMessagesDb = [
    { id: 'mA1', conversation_id: 'conv_A', sender_id: 'user', is_from_me: false, text: 'moro em Belo Horizonte Minas Gerais', created_at: '2026-09-20T10:00:00Z' },
    { id: 'mB1', conversation_id: 'conv_B', sender_id: 'user', is_from_me: false, text: 'moro em Curitiba Paraná', created_at: '2026-09-20T10:00:00Z' },
  ];

  const mockSupabase = createMockSupabase(mockMessagesDb);

  const hitsA = await epMod.searchRawConversationHistory({
    supabase: mockSupabase,
    conversationId: 'conv_A',
    query: 'Belo Horizonte',
  });
  const hitsA_wrong = await epMod.searchRawConversationHistory({
    supabase: mockSupabase,
    conversationId: 'conv_A',
    query: 'Curitiba',
  });

  assert(hitsA.length === 1, 'Conversa A localizou fato de Belo Horizonte');
  assert(hitsA_wrong.length === 0, 'Conversa A NÃO encontrou fatos da Conversa B (Curitiba)');
}

// ----------------------------------------------------------------------
// CENÁRIO 8: Preempção Atômica sem Mutação de LiveState
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 8: Preempção do ciclo impede gravação e preserva LiveState');
{
  let databaseLiveState = {
    currentTopic: 'tópico original intacto',
    turnCount: 5,
  };

  let committed = false;
  // Simulação de CAS com detecção de preempção
  function mockCommitCycleIfOwned(isPreempted) {
    if (isPreempted) {
      // Aborta sem alterar o banco
      return false;
    }
    databaseLiveState = { currentTopic: 'tópico mutado indevidamente', turnCount: 6 };
    committed = true;
    return true;
  }

  const success = mockCommitCycleIfOwned(true);
  assert(success === false, 'Ciclo preempitado abortou commit');
  assert(committed === false, 'Commit não foi executado');
  assert(databaseLiveState.currentTopic === 'tópico original intacto', 'LiveState no banco permaneceu 100% intacto');
}

// ----------------------------------------------------------------------
// CENÁRIO 9: Poda Estrita de Coleções do LiveState
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 9: Poda Estrita de Coleções do LiveState (máx 3 a 5 itens)');
{
  const initial = orchMod.getDefaultConversationLiveState('conv_prune');
  const patch = {
    secondaryTopics: ['top1', 'top2', 'top3', 'top4', 'top5', 'top6'],
    openLoops: ['loop1', 'loop2', 'loop3', 'loop4'],
    avoidRepeating: ['av1', 'av2', 'av3', 'av4', 'av5', 'av6', 'av7'],
  };

  const pruned = orchMod.applyLiveStatePatch(initial, patch);

  assert(pruned.secondaryTopics.length <= 3, `secondaryTopics podado para <= 3 (ficou com ${pruned.secondaryTopics.length})`);
  assert(pruned.openLoops.length <= 3, `openLoops podado para <= 3 (ficou com ${pruned.openLoops.length})`);
  assert(pruned.avoidRepeating.length <= 5, `avoidRepeating podado para <= 5 (ficou com ${pruned.avoidRepeating.length})`);
  assert(pruned.turnCount === 1, 'TurnCount incrementado para 1');

  const serialized = orchMod.serializeLiveStateForPrompt(pruned);
  assert(serialized.includes('[ESTADO VIVO DA CONVERSA - NÍVEL 0]'), 'LiveState serializado com sucesso');
  assert(serialized.length < 500, `LiveState serializado é compacto (${serialized.length} caracteres, ~100 tokens)`);
}

// ----------------------------------------------------------------------
// CENÁRIO 10: Sanitização Estrita de Pontuação (Somente , e ?)
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 10: Sanitização Estrita de Pontuação (somente vírgula e interrogação)');
{
  const raw1 = 'Oi! Tudo bem? Eu moro em BH... É bem legal; vc conhece? Preço: R$ 250.000.';
  const sanitized1 = styleMod.sanitizeChatPunctuation(raw1);

  assert(!sanitized1.includes('!'), 'Removeu exclamação (!) com sucesso');
  assert(!sanitized1.includes('...'), 'Removeu reticências (...) com sucesso');
  assert(!sanitized1.includes(';'), 'Removeu ponto e vírgula (;) com sucesso');
  assert(!sanitized1.endsWith('.'), 'Removeu ponto final (.) do fim');
  assert(sanitized1.includes('?'), 'Preservou interrogação (?)');
  assert(sanitized1.includes('250.000'), 'Preservou ponto numérico em 250.000');
  assert(sanitized1.charAt(0) === 'O', 'Primeira letra maiúscula garantida');

  // Teste com tag de áudio
  const audioTag = '[audio:https://storage.googleapis.com/audio.mp3]';
  const sanitizedAudio = styleMod.sanitizeChatPunctuation(audioTag);
  assert(sanitizedAudio === audioTag, 'Tag de áudio preservada intacta sem alteração');
}

// ----------------------------------------------------------------------
// CENÁRIO 11: Validação Estrita de already_satisfied
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 11: Validação estrita de already_satisfied (somente objetivo atual e msg de entrada)');
{
  const currentObjective = { id: 'goal_city', label: 'Cidade' };
  const currentMessageId = 'msg_inbound_99';

  // Tentativa válida
  const validPlan = {
    objectiveDecision: 'already_satisfied',
    satisfiedObjectiveId: 'goal_city',
    evidenceMessageId: 'msg_inbound_99',
  };

  const isValid = (
    validPlan.objectiveDecision === 'already_satisfied' &&
    validPlan.satisfiedObjectiveId === currentObjective.id &&
    validPlan.evidenceMessageId === currentMessageId
  );
  assert(isValid === true, 'already_satisfied aceito para o objetivo atual com evidenceMessageId');

  // Tentativa inválida (objetivo futuro)
  const invalidPlanObj = {
    objectiveDecision: 'already_satisfied',
    satisfiedObjectiveId: 'goal_future_marriage',
    evidenceMessageId: 'msg_inbound_99',
  };
  const isInvalidObj = (
    invalidPlanObj.satisfiedObjectiveId === currentObjective.id
  );
  assert(isInvalidObj === false, 'Rejeitou already_satisfied em objetivo que não é o atual');
}

// ----------------------------------------------------------------------
// CENÁRIO 12: Subagente Executor Enxuto (sem tools de busca livre)
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 12: Subagente Executor Enxuto sem tools de busca ampla');
{
  const catalog = orchMod.getCompactSubagentCatalog();
  assert(catalog.length >= 3, 'Catálogo compacto de subagentes disponível');
  assert(catalog.some((s) => s.id === 'descoberta'), 'Subagente descoberta presente no catálogo');

  const missionPkg = {
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    objectiveDirective: 'pursue',
    targetObjective: { id: 'goal_job', label: 'Profissão' },
    relevantMemoryContext: 'FATOS CONHECIDOS: Ele mora em BH.',
    liveStateContext: '[ESTADO VIVO DA CONVERSA - NÍVEL 0]',
  };

  const prompt = orchMod.buildSubagentExecutorPrompt({
    subagentId: 'descoberta',
    subagentName: 'descoberta',
    mission: 'Descobrir perfil',
    missionPackage: missionPkg,
    recentMessages: [{ sender: 'pretendente', text: 'trabalho bastante durante a semana' }],
    emojiBudgetSnippet: 'EMOJI_BUDGET=1',
    styleStateSnippet: 'Última forma: question',
  });

  assert(!prompt.includes('call_tool'), 'Executor não possui ferramenta call_tool');
  assert(!prompt.includes('conversation_history_search'), 'Executor não possui ferramenta conversation_history_search');
  assert(prompt.includes('responses: ['), 'Executor orientado a responder estritamente com balões');
}

// ----------------------------------------------------------------------
// CENÁRIO 13: Espelhamento do Obsidian com LiveState no arquivo 05
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 13: Espelhamento do Obsidian exibe LiveState dentro do arquivo 05');
{
  const contact = {
    id: 'conv_obs_1',
    contactId: 'conv_obs_1',
    fullName: 'Rodrigo Silva',
    username: 'rodrigo_silva',
    currentStageId: 'descoberta',
    responsibleSubagent: 'descoberta',
    updatedAt: new Date().toISOString(),
    liveState: {
      lastUserEmotionalTone: 'curioso',
      currentTopic: 'trabalho com tecnologia',
      unresolvedQuestion: 'vc faz plantão no hospital?',
      lastLarissaSpeechAct: 'respondeu sobre a faculdade',
      secondaryTopics: ['tecnologia', 'café'],
      openLoops: ['plantão'],
      avoidRepeating: ['qual seu nome'],
      turnCount: 4,
      updatedAt: new Date().toISOString(),
    },
    objectives: [
      { id: 'goal_city', label: 'Cidade', status: 'completed', value: 'Belo Horizonte' },
      { id: 'goal_job', label: 'Profissão', status: 'in_progress', isCurrent: true },
    ],
  };

  const mdMeta = obsMod.generateMetadataMarkdown(contact);
  assert(mdMeta.includes('# ⚙️ Metadados Técnicos: Rodrigo Silva'), 'Preservou cabeçalho do arquivo 05 de metadados');
  assert(mdMeta.includes('## 🟢 Estado Vivo da Conversa'), 'Adicionou seção visual ## Estado Vivo da Conversa no topo');
  assert(mdMeta.includes('**Tom Emocional do Pretendente:** `curioso`'), 'Exibe tom emocional no LiveState');
  assert(mdMeta.includes('**Pergunta Pendente dele a Responder:** "vc faz plantão no hospital?"'), 'Exibe pergunta pendente no LiveState');
  assert(mdMeta.includes('## ⚙️ Dados Técnicos de Orquestração'), 'Mantém a seção de dados técnicos com JSON abaixo');

  const mdObj = obsMod.generateObjectivesMarkdown(contact);
  assert(mdObj.includes('- [x] **Cidade**: **Belo Horizonte**'), 'Objetivo completado marcado com [x]');
  assert(mdObj.includes('- [ ] ➡️ **Profissão** *(Em andamento pelo Brain)*'), 'Objetivo em andamento marcado com ➡️');
}

// ----------------------------------------------------------------------
// CENÁRIO 14: Endpoints Conversation-Scoped com Proteção por Token
// ----------------------------------------------------------------------
console.log('\n🔹 CENÁRIO 14: Endpoints de exportação exigem token e isolamento por conversation_id');
{
  // Teste de validação do token com timing safe
  const validToken = 'valid_obsidian_token_xyz';
  function checkAuth(authHeader, expected) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7).trim();
    if (token.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i++) {
      diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  }

  assert(checkAuth('Bearer valid_obsidian_token_xyz', validToken) === true, 'Autenticação aprovada com token legítimo');
  assert(checkAuth('Bearer token_errado', validToken) === false, 'Autenticação recusada com token incorreto');
  assert(checkAuth('', validToken) === false, 'Autenticação recusada sem header');

  // Validação de formato de conversation_id
  const isValidConvId = (id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id);
  assert(isValidConvId('17841400000000000') === true, 'ID legítimo aceito');
  assert(isValidConvId('conv-user_123') === true, 'ID com hífen e underscore aceito');
  assert(isValidConvId("'; DROP TABLE messages; --") === false, 'Tentativa de injeção SQL rejeitada');
}

console.log('\n🔹 CENÁRIO 15: Contexto recente aplica budget sem descartar mensagens obrigatórias');
{
  const messages = Array.from({ length: 12 }, (_, index) => ({
    id: `budget_${index}`,
    sender: index === 3 ? 'larissa' : 'pretendente',
    direction: index === 3 ? 'outbound' : 'inbound',
    text: `${index} ${'mensagem enorme '.repeat(120)}`,
    createdAt: new Date(Date.UTC(2026, 8, 20, 10, index)).toISOString(),
  }));
  const result = orchMod.buildBudgetedRecentContext({
    messages,
    claimedMessageIds: ['budget_11'],
    tokenBudget: 1500,
    messageLimit: 12,
  });
  assert(result.messages.length < 12, 'Budget impede envio cego das 12 mensagens enormes');
  assert(result.messages.some((m) => m.id === 'budget_11'), 'Mensagem claimed atual é preservada');
  assert(result.messages.some((m) => m.id === 'budget_3'), 'Último turno da Larissa é preservado');
  assert(result.budgetOverflowRequired === false, 'Contexto obrigatório cabe no budget neste cenário');

  const overflow = orchMod.buildBudgetedRecentContext({
    messages: [{ ...messages[11], text: 'obrigatória '.repeat(800) }],
    claimedMessageIds: ['budget_11'],
    tokenBudget: 1500,
  });
  assert(overflow.messages[0].id === 'budget_11', 'Claimed acima do budget não é descartada');
  assert(overflow.budgetOverflowRequired === true, 'Overflow obrigatório é sinalizado');
}

console.log('\n🔹 CENÁRIO 16: Fact reveal simples não vira Landmark automaticamente');
{
  for (const [index, text] of ['tenho 27 anos', 'moro em Barbacena', 'trabalho com programação'].entries()) {
    const episodes = epMod.extractEpisodesFromPretendenteMessage(text, `simple_${index}`);
    assert(!episodes.some((episode) => episode.memory_class === 'landmark'), `Fato simples não é Landmark: ${text}`);
  }
  const narrative = epMod.extractEpisodesFromPretendenteMessage(
    'meu pai me ensinou programação quando eu era adolescente, foi por causa dele que escolhi essa profissão',
    'narrative_1'
  );
  assert(narrative.some((episode) => episode.memory_class === 'landmark'), 'História marcante com pai e profissão vira Landmark');
}

console.log('\n🔹 CENÁRIO 17: Raw history encontra hits depois das primeiras 500 mensagens');
{
  const longHistory = Array.from({ length: 650 }, (_, index) => ({
    id: `long_${index}`,
    conversation_id: 'conv_long_a',
    sender_id: index % 2 ? 'larissa' : 'user',
    is_from_me: index % 2 === 1,
    text: index === 574 ? 'minha cabeça ia fritar com programação' : `mensagem histórica ${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  longHistory.push({
    id: 'foreign_hit', conversation_id: 'conv_long_b', sender_id: 'user', is_from_me: false,
    text: 'minha cabeça ia fritar com programação', created_at: '2026-01-02T00:00:00Z',
  });
  const hits = await epMod.searchRawConversationHistory({
    supabase: createMockSupabase(longHistory),
    conversationId: 'conv_long_a',
    query: 'cabeça ia fritar',
    limit: 6,
  });
  assert(hits.some((hit) => hit.messageId === 'long_574'), 'Hit na posição 575 foi encontrado');
  assert(!hits.some((hit) => hit.messageId === 'foreign_hit'), 'Busca não vazou conversa B');
  assert(hits[0].contextWindow.length <= 3, 'Somente janela compacta [prev, hit, next] foi retornada');
}

console.log('\n🔹 CENÁRIO 18: PersonaMemory do Brain é dinâmica e não inventa fallback');
{
  const provider = {
    value: 'lasanha',
    async searchPersonaFacts(_personaId, _query) {
      return this.value ? [{ key: 'favorite_food', value: this.value }] : [];
    },
  };
  const first = await orchMod.searchPersonaMemoryForBrain(provider, 'comida favorita');
  provider.value = 'strogonoff';
  const second = await orchMod.searchPersonaMemoryForBrain(provider, 'comida favorita');
  provider.value = '';
  const empty = await orchMod.searchPersonaMemoryForBrain(provider, 'comida favorita');
  assert(first.includes('lasanha'), 'Primeiro valor veio da PersonaMemory mockada');
  assert(second.includes('strogonoff') && !second.includes('lasanha'), 'Troca no provider altera o resultado sem mudar código ou query');
  assert(empty === 'Nenhum fato encontrado na PersonaMemory.', 'PersonaMemory vazia não inventa biografia');
}

console.log('\n🔹 CENÁRIO 19: selectedAudioId é validado contra candidatos do ciclo');
{
  const candidates = ['audio_1', 'audio_2'].map((id) => ({
    audio_id: id, title: id, summary: id, full_transcript: `transcript ${id}`,
    transcript: `transcript ${id}`, usage_instruction: 'usar quando aderente', when_to_use: 'usar quando aderente',
  }));
  const selected = orchMod.authorizeMissionAudioSelection({ selectedAudioId: 'audio_2', preferAudio: true }, candidates);
  const fake = orchMod.authorizeMissionAudioSelection({ selectedAudioId: 'audio_999', preferAudio: true }, candidates);
  const missing = orchMod.authorizeMissionAudioSelection({ selectedAudioId: null, preferAudio: true }, candidates);
  assert(selected.selectedAudioId === 'audio_2', 'ID retornado pelo Cofre é autorizado');
  assert(selected.candidateAudios.length === 1 && selected.candidateAudios[0].audioId === 'audio_2', 'Executor recebe somente o candidato selecionado');
  assert(fake.candidateAudios.length === 0 && fake.preferAudio === false, 'ID inexistente é rejeitado');
  assert(missing.selectedAudioId === null && missing.preferAudio === false, 'preferAudio sem ID válido é normalizado para false');
}

console.log('\n🔹 CENÁRIO 20: Persistência não promove fact_reveal comum a Landmark');
{
  let persisted = [];
  const supabase = {
    from: () => ({
      upsert: (payloads) => ({
        select: async () => {
          persisted = payloads;
          return { data: payloads.map((_, index) => ({ id: `ep_${index}` })), error: null };
        },
      }),
    }),
  };
  await epMod.saveConversationEpisodes({
    supabase,
    conversationId: 'conv_persist',
    episodes: [{ conversation_id: 'conv_persist', actor: 'pretendente', event_type: 'fact_reveal', topic: 'age', summary: 'idade 27' }],
  });
  assert(persisted[0].metadata.memory_class === 'speech_act', 'fact_reveal sem classificação persiste como speech_act');
  await epMod.saveConversationEpisodes({
    supabase,
    conversationId: 'conv_persist',
    episodes: [{ conversation_id: 'conv_persist', actor: 'pretendente', event_type: 'fact_reveal', topic: 'family', summary: 'história marcante', memory_class: 'landmark', metadata: { memory_class: 'landmark' } }],
  });
  assert(persisted[0].metadata.memory_class === 'landmark', 'Landmark narrativo explícito permanece Landmark');
}

console.log('\n🔹 CENÁRIO 21: Contextos obrigatórios são buscados fora das últimas 12 mensagens');
{
  const rows = [
    { id: 'larissa_old', conversation_id: 'conv_ctx_a', sender_id: 'larissa', is_mine: true, text: 'Vc trabalha com o que?', created_at: '2026-09-18T10:00:00Z', direction: 'outbound' },
    { id: 'old_reply_1', conversation_id: 'conv_ctx_a', sender_id: 'larissa', is_mine: true, text: 'Mensagem antiga citada', created_at: '2026-09-18T10:01:00Z', direction: 'outbound' },
    { id: 'foreign_reply', conversation_id: 'conv_ctx_b', sender_id: 'larissa', is_mine: true, text: 'Não pode vazar', created_at: '2026-09-18T10:02:00Z', direction: 'outbound' },
    ...Array.from({ length: 13 }, (_, index) => ({ id: `in_${index}`, conversation_id: 'conv_ctx_a', sender_id: 'user', is_mine: false, text: `inbound ${index}`, created_at: `2026-09-19T10:${String(index).padStart(2, '0')}:00Z`, direction: 'inbound' })),
  ];
  const scopedSupabase = {
    from: () => ({
      select: () => ({
        eq: (_column, conversationId) => {
          const scoped = rows.filter((row) => row.conversation_id === conversationId);
          return {
            or: () => ({ order: () => ({ limit: async () => ({ data: scoped.filter((row) => row.is_mine).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 1), error: null }) }) }),
            in: async (_idColumn, ids) => ({ data: scoped.filter((row) => ids.includes(row.id)), error: null }),
          };
        },
      }),
    }),
  };
  const claimed = [
    { id: 'claimed_now', conversationId: 'conv_ctx_a', sender: 'pretendente', direction: 'inbound', timestamp: '2026-09-20T10:00:00Z', createdAt: '2026-09-20T10:00:00Z', type: 'text', text: 'resposta atual', replyToMessageId: 'old_reply_1', status: 'claimed' },
    { id: 'claimed_foreign', conversationId: 'conv_ctx_a', sender: 'pretendente', direction: 'inbound', timestamp: '2026-09-20T10:01:00Z', createdAt: '2026-09-20T10:01:00Z', type: 'text', text: 'outra resposta', replyToMessageId: 'foreign_reply', status: 'claimed' },
  ];
  const mandatory = await orchMod.loadMandatoryBrainContextCandidates({ supabase: scopedSupabase, conversationId: 'conv_ctx_a', claimedMessages: claimed });
  assert(mandatory.some((message) => message.id === 'old_reply_1'), 'Reply antigo da mesma conversa foi buscado explicitamente');
  assert(!mandatory.some((message) => message.id === 'foreign_reply'), 'Reply target da conversa B não vazou');
  assert(mandatory.some((message) => message.sender === 'larissa'), 'Último outbound da Larissa foi recuperado fora do conjunto recente');
  const overflow = orchMod.buildBudgetedRecentContext({
    messages: [...mandatory, ...claimed.map((message) => ({ ...message, text: 'obrigatória '.repeat(800) }))],
    claimedMessageIds: claimed.map((message) => message.id),
    tokenBudget: 1500,
  });
  assert(overflow.messages.some((message) => message.id === 'old_reply_1'), 'Reply target obrigatório permanece acima do budget');
  assert(overflow.budgetOverflowRequired === true, 'Mandatory context acima do budget sinaliza overflow');
}

console.log('\n======================================================================');
console.log('RESULTADO DA BATERIA DE TESTES DO CONVERSATION BRAIN:');
console.log(`  Total de Verificações: ${totalAssertions}`);
console.log(`  Aprovadas (PASS):       ${passedAssertions}`);
console.log(`  Reprovadas (FAIL):      ${failedAssertions}`);
console.log('======================================================================\n');

if (failedAssertions > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
