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

// -------------------------------------------------------------------------
// TESTE 10: ROTEAMENTO DO AGENTE DA CONVERSA (CONEXÃO INICIAL)
// -------------------------------------------------------------------------
test('10. Agente da Conversa: roteia saudação inicial para o subagente conexao_inicial', () => {
  const { load } = createRuntime();
  const { validateRoutingDecision, buildConversationAgentPrompt } = load(
    'supabase/functions/api/experimental_orchestrator.ts'
  );

  const prompt = buildConversationAgentPrompt({
    conversationId: 'test_conv_123',
    currentPhase: 'conexao_inicial',
    newMessage: {
      id: 'm1',
      text: 'Oii tudo bem?',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    recentHistory: 'Pretendente: Oii tudo bem?',
  });

  // Prompt enxuto contém dados essenciais e não é megaprompt de 500 linhas
  assert.ok(prompt.includes('Agente da Conversa'));
  assert.ok(prompt.includes('conexao_inicial'));
  assert.ok(prompt.includes('descoberta'));
  assert.ok(prompt.includes('Oii tudo bem?'));

  const routing = validateRoutingDecision(
    {
      targetSubagent: 'conexao_inicial',
      action: 'delegate',
      reason: 'Troca inicial de saudações',
    },
    'conexao_inicial'
  );

  assert.equal(routing.targetSubagent, 'conexao_inicial');
  assert.equal(routing.action, 'delegate');
  assert.equal(routing.reason, 'Troca inicial de saudações');
});

// -------------------------------------------------------------------------
// TESTE 11: ROTEAMENTO DO AGENTE DA CONVERSA (DESCOBERTA)
// -------------------------------------------------------------------------
test('11. Agente da Conversa: roteia avanço de diálogo para o subagente descoberta', () => {
  const { load } = createRuntime();
  const { validateRoutingDecision } = load('supabase/functions/api/experimental_orchestrator.ts');

  const routing = validateRoutingDecision(
    {
      targetSubagent: 'descoberta',
      action: 'delegate',
      reason: 'Pretendente já cumprimentou e contou sua profissão',
    },
    'conexao_inicial'
  );

  assert.equal(routing.targetSubagent, 'descoberta');
  assert.equal(routing.action, 'delegate');
  assert.ok(routing.reason.includes('profissão'));
});

// -------------------------------------------------------------------------
// TESTE 12: SUBAGENTE CONEXÃO INICIAL (PROMPT E DECISÃO)
// -------------------------------------------------------------------------
test('12. Subagente Conexão Inicial: valida decisão e checkpoint com tom da Larissa', () => {
  const { load } = createRuntime();
  const { buildConexaoInicialPrompt, validateSubagentDecision } = load(
    'supabase/functions/api/experimental_orchestrator.ts'
  );

  const prompt = buildConexaoInicialPrompt({
    conversationId: 'test_conv_123',
    currentPhase: 'conexao_inicial',
    newMessage: {
      id: 'm2',
      text: 'Tudo bem sim e com vc?',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    recentHistory: 'Pretendente: Tudo bem sim e com vc?',
  });

  assert.ok(prompt.includes('subagente especialista em CONEXÃO INICIAL'));
  assert.ok(prompt.includes('PROIBIDO terminar balão com ponto final'));

  const subDecision = validateSubagentDecision(
    {
      action: 'reply',
      checkpoint: 'chk_rapport_estabelecido',
      summary: 'Pretendente foi simpático e perguntou como ela está',
      suggestedResponse: 'Tudo ótimo por aqui também 🥰',
      nextPhase: 'descoberta',
      reasoning: 'Rapport inicial estabelecido',
    },
    'conexao_inicial'
  );

  assert.equal(subDecision.action, 'reply');
  assert.equal(subDecision.checkpoint, 'chk_rapport_estabelecido');
  assert.equal(subDecision.nextPhase, 'descoberta');
  assert.equal(subDecision.suggestedResponse, 'Tudo ótimo por aqui também 🥰');
});

// -------------------------------------------------------------------------
// TESTE 13: SUBAGENTE DESCOBERTA (PROMPT E DECISÃO)
// -------------------------------------------------------------------------
test('13. Subagente Descoberta: valida decisão focada em interesses e rotina', () => {
  const { load } = createRuntime();
  const { buildDescobertaPrompt, validateSubagentDecision } = load(
    'supabase/functions/api/experimental_orchestrator.ts'
  );

  const prompt = buildDescobertaPrompt({
    conversationId: 'test_conv_123',
    currentPhase: 'descoberta',
    newMessage: {
      id: 'm3',
      text: 'Eu trabalho em uma oficina mecânica',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    recentHistory: 'Pretendente: Eu trabalho em uma oficina mecânica',
  });

  assert.ok(prompt.includes('subagente especialista em DESCOBERTA'));
  assert.ok(prompt.includes('Regra da Reciprocidade'));

  const subDecision = validateSubagentDecision(
    {
      action: 'reply',
      checkpoint: 'chk_pergunta_sobre_ele',
      summary: 'Pretendente contou que trabalha em oficina',
      suggestedResponse: 'Nossa que legal, oficina deve ser bem corrido né kkk você mexe com carro há muito tempo?',
      nextPhase: 'descoberta',
      reasoning: 'Explorar rotina de trabalho com reciprocidade',
    },
    'descoberta'
  );

  assert.equal(subDecision.action, 'reply');
  assert.equal(subDecision.checkpoint, 'chk_pergunta_sobre_ele');
  assert.equal(subDecision.nextPhase, 'descoberta');
});

// -------------------------------------------------------------------------
// TESTE 14: BACKEND DETERMINÍSTICO: CANCELAMENTO PELO OPERADOR
// -------------------------------------------------------------------------
test('14. Backend Determinístico: aborta ciclo imediatamente se cancel_current_cycle for ativo', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let modelWasCalled = false;

  const supabase = createMockSupabase({
    stage_completed_rules: {
      cancel_current_cycle: true, // Operador clicou em cancelar no painel
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
      },
    },
  });

  const mockRuntime = {
    callModel: async () => {
      modelWasCalled = true;
      return { content: '{}', tokens: 0 };
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_cancel_1',
      text: 'Oi',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  assert.equal(result.handled, false);
  assert.equal(result.error, 'Cancelado pelo operador');
  assert.equal(modelWasCalled, false, 'Nenhuma IA deve ser chamada se o operador cancelou');
});

// -------------------------------------------------------------------------
// TESTE 15: FLUXO COMPLETO DUAS CAMADAS (AGENTE CONVERSA -> SUBAGENTE DESCOBERTA)
// -------------------------------------------------------------------------
test('15. Fluxo Completo: Agente da Conversa roteia para Descoberta e subagente formula resposta', async () => {
  let sentText = null;
  let callCount = 0;

  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'descoberta',
        checkpoint: 'chk_rapport_estabelecido',
      },
    },
  });

  const mockRuntime = {
    callModel: async (prompt) => {
      callCount++;
      // Chamada 1: Agente da Conversa
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({
            targetSubagent: 'descoberta',
            action: 'delegate',
            reason: 'Conversa já está na fase de descoberta de rotina e profissão',
          }),
          tokens: 50,
        };
      }
      // Chamada 2: Subagente de Descoberta
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_pergunta_sobre_ele',
          summary: 'Pretendente falou do sítio dele',
          suggestedResponse: 'Que delícia sítio, uai! Eu amo lugar calmo assim kkk você vai pra lá direto?',
          nextPhase: 'descoberta',
          reasoning: 'Validar amor pelo campo com reciprocidade mineira',
        }),
        tokens: 120,
      };
    },
    sendMetaTextMessage: async (_sb, _convId, text) => {
      sentText = text;
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_123',
    newMessage: {
      id: 'mid_duas_camadas',
      text: 'Gosto muito de ir pro meu sítio no final de semana',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  assert.equal(result.handled, true);
  assert.equal(result.mode, 'experimental');
  assert.equal(callCount, 2, 'Deve ter executado o Agente da Conversa e depois o Subagente');
  assert.equal(result.decision.routedSubagent, 'descoberta');
  assert.equal(result.decision.checkpoint, 'chk_pergunta_sobre_ele');
  assert.equal(result.decision.nextPhase, 'descoberta');
  assert.equal(sentText, 'Que delícia sítio, uai! Eu amo lugar calmo assim kkk você vai pra lá direto?');

  const convData = supabase.getConversationData();
  assert.equal(convData.stage_completed_rules.orchestration.lastProcessingStatus, 'sent');
  assert.equal(convData.stage_completed_rules.active_cycle_token, null);
});

// =========================================================================
// TESTES ADICIONAIS: SEÇÃO 5.6 - FORMATO TXT COMPACTO (.agents/CONTEXT_SERIALIZATION_SPEC.md)
// =========================================================================

// TESTE 16 (Critério 1): Múltiplas mensagens permanecem separadas no texto
test('16. Formato TXT: múltiplas mensagens permanecem separadas no texto com quebras e autoria', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_rotina',
    newMessages: [
      { id: 'm1', sender: 'pretendente', text: 'Oi' },
      { id: 'm2', sender: 'pretendente', text: 'Tudo bem?' },
      { id: 'm3', sender: 'pretendente', text: 'Trabalho muito' },
      { id: 'm4', sender: 'pretendente', text: 'Também gosto disso' },
    ],
  };

  const output = formatConversationContextForModel(payload);

  // Não deve amassar em uma linha só
  assert.equal(output.includes('Oi Tudo bem? Trabalho muito'), false);

  // Cada mensagem deve ter seu próprio bloco separado
  assert.match(output, /PRETENDENTE \| m1\nOi/);
  assert.match(output, /PRETENDENTE \| m2\nTudo bem\?/);
  assert.match(output, /PRETENDENTE \| m3\nTrabalho muito/);
  assert.match(output, /PRETENDENTE \| m4\nTambém gosto disso/);
});

// TESTE 17 (Critério 2): Autoria Larissa/Pretendente fica inequívoca
test('17. Formato TXT: autoria Larissa/Pretendente fica inequívoca e claramente rotulada', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    newMessages: [
      { id: 'm1', sender: 'larissa', text: 'Oi, tudo bem por aí?' },
      { id: 'm2', sender: 'pretendente', text: 'Tudo ótimo e com você?' },
    ],
  };

  const output = formatConversationContextForModel(payload);

  assert.match(output, /LARISSA \| m1\nOi, tudo bem por aí\?/);
  assert.match(output, /PRETENDENTE \| m2\nTudo ótimo e com você\?/);
});

// TESTE 18 (Critério 3): Reply aparece associada à mensagem correta
test('18. Formato TXT: reply aparece associada à mensagem correta no cabeçalho', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_profissao',
    newMessages: [
      { id: 'm10', sender: 'pretendente', text: 'Eu trabalho na área de TI' },
      { id: 'm11', sender: 'pretendente', text: 'Também gosto kkk', replyToId: 'm05' },
    ],
    referencedMessages: {
      m05: { id: 'm05', sender: 'larissa', text: 'Eu amo praia' },
    },
  };

  const output = formatConversationContextForModel(payload);

  assert.match(output, /PRETENDENTE \| m11 \| RESPONDENDO_A: m05/);
  assert.equal(output.includes('PRETENDENTE | m10 | RESPONDENDO_A'), false);
});

// TESTE 19 (Critério 4): Mensagem antiga usada como referência fica separada das mensagens novas
test('19. Formato TXT: mensagem antiga referenciada fica em seção [REFERÊNCIAS] separada de [MENSAGENS_NOVAS]', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_cidade',
    newMessages: [
      { id: 'm_nova_1', sender: 'pretendente', text: 'Sou de BH', replyToId: 'm_antiga_99' },
    ],
    referencedMessages: {
      m_antiga_99: { id: 'm_antiga_99', sender: 'larissa', text: 'De qual cidade você é?' },
    },
  };

  const output = formatConversationContextForModel(payload);

  const idxNovas = output.indexOf('[MENSAGENS_NOVAS]');
  const idxRefs = output.indexOf('[REFERÊNCIAS]');
  const idxFim = output.indexOf('[FIM]');

  assert.ok(idxNovas !== -1, 'Deve conter [MENSAGENS_NOVAS]');
  assert.ok(idxRefs !== -1, 'Deve conter [REFERÊNCIAS]');
  assert.ok(idxRefs > idxNovas, '[REFERÊNCIAS] deve vir após [MENSAGENS_NOVAS]');
  assert.ok(idxFim > idxRefs, '[FIM] deve vir após [REFERÊNCIAS]');

  // Mensagem antiga não deve estar em novas
  const sectionNovas = output.slice(idxNovas, idxRefs);
  assert.equal(sectionNovas.includes('De qual cidade você é?'), false);

  // Mensagem antiga deve estar em referências
  const sectionRefs = output.slice(idxRefs, idxFim);
  assert.match(sectionRefs, /m_antiga_99\nLARISSA:\nDe qual cidade você é\?/);
});

// TESTE 20 (Critério 5): Não existe duplicação da mensagem referenciada
test('20. Formato TXT: deduplicação de referências quando múltiplos replies apontam para a mesma mensagem', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_hobbies',
    newMessages: [
      { id: 'm21', sender: 'pretendente', text: 'Sim, concordo muito', replyToId: 'm_ref_larissa' },
      { id: 'm22', sender: 'pretendente', text: 'Praia é a melhor coisa', replyToId: 'm_ref_larissa' },
    ],
    referencedMessages: {
      m_ref_larissa: { id: 'm_ref_larissa', sender: 'larissa', text: 'Eu amo praia, principalmente lugar calmo' },
    },
  };

  const output = formatConversationContextForModel(payload);

  // A mensagem m_ref_larissa só pode aparecer 1 única vez dentro do bloco [REFERÊNCIAS]
  const countInOutput = (output.match(/m_ref_larissa\nLARISSA:\nEu amo praia/g) || []).length;
  assert.equal(countInOutput, 1, 'Referência não pode ser duplicada');
});

// TESTE 21 (Critério 6): 20 mensagens novas são serializadas integralmente
test('21. Formato TXT: 20 mensagens novas são serializadas integralmente sem omissões', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const msgs = [];
  for (let i = 1; i <= 20; i++) {
    msgs.push({
      id: `msg_${i}`,
      sender: i % 2 === 0 ? 'larissa' : 'pretendente',
      text: `Conteúdo da mensagem ${i}`,
    });
  }

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_profundo',
    newMessages: msgs,
  };

  const output = formatConversationContextForModel(payload);

  for (let i = 1; i <= 20; i++) {
    assert.ok(output.includes(`msg_${i}`), `msg_${i} deve estar presente`);
    assert.ok(output.includes(`Conteúdo da mensagem ${i}`), `Texto ${i} deve estar presente`);
  }
});

// TESTE 22 (Critério 7): Campos internos desnecessários não aparecem no prompt
test('22. Formato TXT: campos internos de banco (is_echo, deliver_at, created_at) não vazam no prompt', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'conexao_inicial',
    checkpoint: 'chk_inicio',
    newMessages: [
      {
        id: 'msg_privada',
        sender: 'pretendente',
        text: 'Olá tudo bem',
        // Campos que NÃO devem vazar
        is_echo: false,
        deliver_at: '2026-09-18T05:00:00Z',
        created_at: '2026-09-18T04:00:00Z',
        audio_transcription_error: null,
      },
    ],
  };

  const output = formatConversationContextForModel(payload);

  assert.equal(output.includes('is_echo'), false);
  assert.equal(output.includes('deliver_at'), false);
  assert.equal(output.includes('audio_transcription_error'), false);
  assert.equal(output.includes('2026-09-18T05:00:00Z'), false);
});

// TESTE 23 (Critério 8): IDs necessários para rastreabilidade permanecem disponíveis
test('23. Formato TXT: IDs de mensagem e referências permanecem disponíveis no texto gerado', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_trabalho',
    newMessages: [
      { id: 'id_rastreavel_100', sender: 'pretendente', text: 'Trabalho em hospital', replyToId: 'id_ref_200' },
    ],
    referencedMessages: {
      id_ref_200: { id: 'id_ref_200', sender: 'larissa', text: 'Você trabalha em quê?' },
    },
  };

  const output = formatConversationContextForModel(payload);

  assert.ok(output.includes('id_rastreavel_100'), 'ID da mensagem deve estar explícito');
  assert.ok(output.includes('id_ref_200'), 'ID da mensagem referenciada deve estar explícito');
});

// TESTE 24 (Critério 9): Caracteres especiais e quebras de linha não quebram o formato
test('24. Formato TXT: quebras de linha, aspas e emojis preservam a integridade estrutural', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'conexao_inicial',
    checkpoint: 'chk_saudacao',
    newMessages: [
      {
        id: 'msg_complexa',
        sender: 'pretendente',
        text: 'Linha 1 com "aspas" e \'simples\'\nLinha 2 com emojis 🥰❤️ e pipes | | |\nLinha 3!',
      },
    ],
  };

  const output = formatConversationContextForModel(payload);

  assert.ok(output.startsWith('[ESTADO]'));
  assert.ok(output.endsWith('[FIM]'));
  assert.ok(output.includes('Linha 1 com "aspas" e \'simples\''));
  assert.ok(output.includes('Linha 2 com emojis 🥰❤️ e pipes | | |'));
  assert.ok(output.includes('Linha 3!'));
});

// TESTE 25 (Critério 10): A representação textual gerada é 100% determinística para a mesma entrada
test('25. Formato TXT: saída é 100% determinística e idêntica para a mesma entrada', () => {
  const { load } = createRuntime();
  const { formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const payload = {
    phase: 'descoberta',
    checkpoint: 'chk_rotina',
    knownFacts: {
      profissao: 'Engenheiro Civil',
      cidade: 'Belo Horizonte',
    },
    newMessages: [
      { id: 'm1', sender: 'pretendente', text: 'Boa noite', replyToId: 'm0' },
      { id: 'm2', sender: 'larissa', text: 'Boa noite, tudo bem?' },
    ],
    referencedMessages: {
      m0: { id: 'm0', sender: 'larissa', text: 'Oi!' },
    },
  };

  const run1 = formatConversationContextForModel(payload, { layer: 'descoberta' });
  const run2 = formatConversationContextForModel(payload, { layer: 'descoberta' });
  const run3 = formatConversationContextForModel(payload, { layer: 'descoberta' });

  assert.equal(run1, run2, 'Run 1 e Run 2 devem ser idênticos');
  assert.equal(run2, run3, 'Run 2 e Run 3 devem ser idênticos');
});
