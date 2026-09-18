const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

/**
 * Cria o ambiente de runtime para carregar módulos TypeScript do Deno/Supabase
 */
function createRuntime(mockFetch = async () => ({ ok: true, json: async () => ({}) })) {
  const cache = new Map();
  function load(file) {
    let resolved = path.resolve(file);
    if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) resolved += '.ts';
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: (ref) => load(path.resolve(path.dirname(resolved), ref)),
        fetch: mockFetch,
        AbortSignal,
        console,
        TextDecoder,
        TextEncoder,
        setTimeout,
        clearTimeout,
      },
      { filename: resolved }
    );
    return module.exports;
  }
  return { load };
}

// -------------------------------------------------------------------------
// TESTE 1: VALIDAÇÃO DE ESQUEMA DA DECISÃO
// -------------------------------------------------------------------------
test('1. validateOrchestratorDecision valida estritamente a decisão estruturada do agente', () => {
  const { load } = createRuntime();
  const { validateOrchestratorDecision } = load('supabase/functions/api/experimental_orchestrator.ts');

  const validDecision = {
    action: 'reply',
    currentPhase: 'conexao_inicial',
    nextPhase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_reciproca',
    summary: 'Pretendente retribuiu o cumprimento',
    suggestedResponse: 'Tudo bem por aqui também!',
    requiredTools: [],
    reasoning: 'Rapport inicial estabelecido com sucesso',
  };

  // Sucesso: retorna o objeto parseado
  const result = validateOrchestratorDecision(validDecision);
  assert.equal(result.action, 'reply');
  assert.equal(result.currentPhase, 'conexao_inicial');
  assert.equal(result.checkpoint, 'chk_saudacao_reciproca');

  // Lança erro se ação for desconhecida
  assert.throws(
    () => validateOrchestratorDecision({ ...validDecision, action: 'invalid_action' }),
    /Ação inválida/
  );

  // Lança erro se fase for inválida
  assert.throws(
    () => validateOrchestratorDecision({ ...validDecision, currentPhase: 'fase_inexistente' }),
    /Fase atual inválida/
  );

  // Lança erro se faltar campos obrigatórios
  assert.throws(() => validateOrchestratorDecision({ action: 'reply' }), /Fase atual inválida|não é um objeto|obrigatório/);
  assert.throws(() => validateOrchestratorDecision(null), /não é um objeto/);
});

// -------------------------------------------------------------------------
// TESTE 2: VALIDAÇÃO DE TRANSIÇÃO DE FASE NO BACKEND
// -------------------------------------------------------------------------
test('2. validatePhaseTransition impede avanço indevido para "descoberta" sem checkpoint válido', () => {
  const { load } = createRuntime();
  const { validatePhaseTransition } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Manter na mesma fase é sempre permitido
  assert.equal(validatePhaseTransition('conexao_inicial', 'conexao_inicial', '').allowed, true);
  assert.equal(validatePhaseTransition('descoberta', 'descoberta', '').allowed, true);

  // Avanço com checkpoint inválido ou vazio deve ser BLOQUEADO pelo backend
  const blocked1 = validatePhaseTransition('conexao_inicial', 'descoberta', '');
  assert.equal(blocked1.allowed, false);
  assert.equal(blocked1.validatedNextPhase, 'conexao_inicial');

  const blocked2 = validatePhaseTransition('conexao_inicial', 'descoberta', 'chk_aleatorio');
  assert.equal(blocked2.allowed, false);
  assert.equal(blocked2.validatedNextPhase, 'conexao_inicial');

  // Avanço com checkpoint canônico de conexão inicial é APROVADO
  const allowed1 = validatePhaseTransition('conexao_inicial', 'descoberta', 'chk_rapport_estabelecido');
  assert.equal(allowed1.allowed, true);
  assert.equal(allowed1.validatedNextPhase, 'descoberta');

  const allowed2 = validatePhaseTransition('conexao_inicial', 'descoberta', 'chk_conexao_validada');
  assert.equal(allowed2.allowed, true);
  assert.equal(allowed2.validatedNextPhase, 'descoberta');

  const allowed3 = validatePhaseTransition('conexao_inicial', 'descoberta', 'chk_saudacao_reciproca');
  assert.equal(allowed3.allowed, true);
  assert.equal(allowed3.validatedNextPhase, 'descoberta');
});

// -------------------------------------------------------------------------
// HELPERS PARA MOCK COMPLETO DO SUPABASE
// -------------------------------------------------------------------------
function createMockSupabase(initialConversationData = {}) {
  let convData = {
    id: 'test_conv_123',
    full_name: 'Contato Teste',
    stage_completed_rules: {},
    ...initialConversationData,
  };
  const logs = [];
  const insertedMessages = [];

  const supabase = {
    from: (table) => {
      if (table === 'instagram_conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: convData, error: null }),
            }),
          }),
          update: (fields) => ({
            eq: async (col, val) => {
              convData = {
                ...convData,
                ...fields,
                stage_completed_rules: {
                  ...(convData.stage_completed_rules || {}),
                  ...(fields.stage_completed_rules || {}),
                },
              };
              return { error: null };
            },
          }),
        };
      }
      if (table === 'instagram_messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    { sender_id: 'them', is_mine: false, text: 'Oi' },
                    { sender_id: 'me', is_mine: true, text: 'Olá!' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          insert: async (msg) => {
            insertedMessages.push(msg);
            return { error: null };
          },
        };
      }
      if (table === 'instagram_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { app_secret: 'fake_secret' }, error: null }),
            }),
            limit: async () => ({ data: [{ access_token: 'fake_token' }], error: null }),
          }),
        };
      }
      if (table === 'ai_logs') {
        return {
          insert: async (logEntry) => {
            logs.push(logEntry);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    },
    getConversationData: () => convData,
    getAiLogs: () => logs,
    getInsertedMessages: () => insertedMessages,
  };

  return supabase;
}

// -------------------------------------------------------------------------
// TESTE 3: IDEMPOTÊNCIA
// -------------------------------------------------------------------------
test('3. Idempotência: rejeita mensagem duplicada se messageId já foi processado', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
        lastProcessedMessageId: 'mid_ja_processada',
      },
    },
  });

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_ja_processada', // Mesmo ID
      text: 'Olá de novo',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.skippedDuplicate, true);
  assert.equal(result.mode, 'experimental');
});

// -------------------------------------------------------------------------
// TESTE 4: CONCORRÊNCIA E LOCK ATÔMICO
// -------------------------------------------------------------------------
test('4. Concorrência: bloqueia processamento simultâneo com active_cycle_token', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      active_cycle_token: 'token_ciclo_em_andamento',
      active_cycle_at: new Date().toISOString(), // recente, lock ativo
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
      },
    },
  });

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    correlationId: 'outro_correlation_id',
    newMessage: {
      id: 'mid_nova_concorrente',
      text: 'Mensagem concorrente',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
  });

  assert.equal(result.handled, false);
  assert.equal(result.error, 'Lock ativo concorrente');
});

// -------------------------------------------------------------------------
// TESTE 5: MODO SHADOW (NENHUM ENVIO PELA META)
// -------------------------------------------------------------------------
test('5. Modo Shadow: registra decisão estruturada SEM enviar mensagem na Meta Graph API', async () => {
  let metaApiCalled = false;

  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'shadow',
        currentPhase: 'conexao_inicial',
        checkpoint: 'inicio',
      },
    },
  });

  const mockRuntime = {
    callModel: async () => ({
      content: JSON.stringify({
        action: 'reply',
        currentPhase: 'conexao_inicial',
        nextPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_reciproca',
        summary: 'Pretendente deu bom dia',
        suggestedResponse: 'Bom dia! Tudo bem por aí?',
        requiredTools: [],
        reasoning: 'Pretendente foi amigável, responder mantendo o rapport',
      }),
      tokens: 150,
    }),
    sendMetaTextMessage: async () => {
      metaApiCalled = true;
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_shadow_1',
      text: 'Bom dia!',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  // Validações do modo Shadow:
  assert.equal(result.handled, true);
  assert.equal(result.mode, 'shadow');
  assert.equal(metaApiCalled, false, 'Meta Graph API NUNCA deve ser chamada em modo Shadow');
  assert.ok(result.decision);
  assert.equal(result.decision.action, 'reply');

  const updatedData = supabase.getConversationData();
  const orchState = updatedData.stage_completed_rules.orchestration;
  assert.equal(orchState.lastProcessingStatus, 'shadow_logged');
  assert.equal(orchState.lastDecision.action, 'reply');
  assert.equal(orchState.checkpoint, 'chk_saudacao_reciproca');
  assert.equal(updatedData.stage_completed_rules.active_cycle_token, null, 'Lock deve ser liberado ao concluir');
});

// -------------------------------------------------------------------------
// TESTE 6: MODO EXPERIMENTAL (ENVIO ATIVO NO CHAT MARCADO)
// -------------------------------------------------------------------------
test('6. Modo Experimental: executa novo agente e envia mensagem via runtime/Meta', async () => {
  let sentText = null;

  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
        checkpoint: 'inicio',
      },
    },
  });

  const mockRuntime = {
    callModel: async () => ({
      content: JSON.stringify({
        action: 'reply',
        currentPhase: 'conexao_inicial',
        nextPhase: 'conexao_inicial',
        checkpoint: 'chk_rapport_estabelecido',
        summary: 'Conversa inicial fluindo',
        suggestedResponse: 'Tudo ótimo também! O que você faz de bom?',
        requiredTools: [],
        reasoning: 'Gerar interesse e engajamento',
      }),
      tokens: 220,
    }),
    sendMetaTextMessage: async (_sb, _convId, text) => {
      sentText = text;
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_exp_1',
      text: 'Tudo bem?',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  assert.equal(result.handled, true);
  assert.equal(result.mode, 'experimental');
  assert.equal(sentText, 'Tudo ótimo também! O que você faz de bom?');

  const updatedData = supabase.getConversationData();
  const orchState = updatedData.stage_completed_rules.orchestration;
  assert.equal(orchState.lastProcessingStatus, 'sent');
  assert.equal(orchState.lastProcessedMessageId, 'mid_exp_1');
  assert.equal(updatedData.stage_completed_rules.active_cycle_token, null, 'Lock deve ser liberado');
});

// -------------------------------------------------------------------------
// TESTE 7: TRATAMENTO DE ERRO E LIBERAÇÃO DE LOCK
// -------------------------------------------------------------------------
test('7. Modo Experimental com falha: registra erro seguro e libera o lock atômico', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
      },
    },
  });

  const mockRuntime = {
    callModel: async () => {
      throw new Error('Timeout na inferência da LLM');
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_fail_1',
      text: 'Mensagem com falha',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  assert.equal(result.handled, false);
  assert.ok(result.error.includes('Timeout'));

  const updatedData = supabase.getConversationData();
  const orchState = updatedData.stage_completed_rules.orchestration;
  assert.equal(orchState.lastProcessingStatus, 'failed');
  assert.ok(orchState.lastError.includes('Timeout'));
  assert.equal(updatedData.stage_completed_rules.active_cycle_token, null, 'Lock DEVE ser liberado no erro');
});

// -------------------------------------------------------------------------
// TESTE 8: RESET DE EMERGÊNCIA PARA LEGADO
// -------------------------------------------------------------------------
test('8. Reset de Emergência: limpa o estado de orquestração e reverte para legado', () => {
  const currentRules = {
    active_cycle_token: 'token_perdido',
    orchestration: {
      version: 1,
      mode: 'experimental',
      currentPhase: 'descoberta',
      checkpoint: 'chk_rapport_estabelecido',
      lastError: 'Erro anterior',
    },
  };

  const resetOrchestration = {
    version: 1,
    mode: 'legacy',
    currentPhase: 'conexao_inicial',
    checkpoint: 'inicio',
    lastProcessedMessageId: null,
    lastProcessedAt: null,
    lastProcessingStatus: 'idle',
    lastCorrelationId: null,
    lastDecision: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };

  const updatedRules = {
    ...currentRules,
    active_cycle_token: null,
    orchestration: resetOrchestration,
  };

  assert.equal(updatedRules.orchestration.mode, 'legacy');
  assert.equal(updatedRules.orchestration.currentPhase, 'conexao_inicial');
  assert.equal(updatedRules.active_cycle_token, null);
  assert.equal(updatedRules.orchestration.lastError, null);
});

// -------------------------------------------------------------------------
// TESTE 9: ISOLAMENTO TOTAL DO MODO LEGADO
// -------------------------------------------------------------------------
test('9. Isolamento total: conversas no modo Legado não sofrem interferência do novo orquestrador', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Conversa que não tem bloco de orquestração ou tem mode: 'legacy'
  const supabase = createMockSupabase({
    stage_completed_rules: {},
  });

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_legacy',
    newMessage: {
      id: 'mid_legacy_1',
      text: 'Olá legado',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
  });

  // O orquestrador detecta mode: 'legacy' e devolve imediatamente sem fazer nada
  assert.equal(result.mode, 'legacy');
  assert.equal(result.handled, false);
});
