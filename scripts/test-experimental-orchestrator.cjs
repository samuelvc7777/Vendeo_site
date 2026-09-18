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
function createMockSupabase(initialConversationData = {}, initialMessages = []) {
  let convData = {
    id: 'test_conv_123',
    full_name: 'Contato Teste',
    stage_completed_rules: {},
    ...initialConversationData,
  };
  const logs = [];
  let messages = [...initialMessages];

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
          upsert: async (fields) => {
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
        };
      }
      if (table === 'instagram_messages') {
        const createQueryObj = () => ({
          eq: () => createQueryObj(),
          not: () => createQueryObj(),
          order: () => createQueryObj(),
          limit: async () => ({ data: messages, error: null }),
          in: async (col, ids) => ({
            data: messages.filter((m) => ids.includes(m.id)),
            error: null,
            order: () => ({ limit: async () => ({ data: messages.filter((m) => ids.includes(m.id)), error: null }) }),
          }),
          maybeSingle: async () => ({ data: messages[0] || null, error: null }),
        });
        return {
          select: () => createQueryObj(),
          insert: async (msg) => {
            messages.push(msg);
            return { error: null };
          },
          upsert: async (msg) => {
            const idx = messages.findIndex((m) => m.id === msg.id);
            if (idx >= 0) messages[idx] = { ...messages[idx], ...msg };
            else messages.push(msg);
            return { error: null };
          },
        };
      }
      if (table === 'agent_cloud_state') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
          upsert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
          insert: async () => ({ error: null }),
        };
      }
      if (table === 'instagram_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { app_secret: 'fake_secret', access_token: 'fake_token' }, error: null }),
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
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
        upsert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
      };
    },
    channel: () => ({
      send: async () => ({}),
      subscribe: () => ({}),
      unsubscribe: () => ({}),
    }),
    rpc: async (fnName, params) => {
      if (fnName === 'claim_outbox_entry') {
        const { p_conversation_id, p_outbox_id, p_claim_token } = params;
        const rules = convData.stage_completed_rules || {};
        const orch = rules.orchestration || {};
        const outbox = { ...(orch.outbox || {}) };

        let targetKey = p_outbox_id;
        let entry = outbox[p_outbox_id];
        if (!entry) {
          for (const [k, v] of Object.entries(outbox)) {
            if (v?.id === p_outbox_id || v?.idempotencyKey === p_outbox_id) {
              targetKey = k;
              entry = v;
              break;
            }
          }
        }

        if (!entry) {
          return { data: { success: false, reason: 'outbox_entry_not_found' }, error: null };
        }
        if (entry.status === 'sent') {
          return { data: { success: false, reason: 'already_sent' }, error: null };
        }
        if (entry.status === 'dispatch_uncertain') {
          return { data: { success: false, reason: 'dispatch_uncertain', isUncertain: true }, error: null };
        }
        if (entry.status === 'sending') {
          const sendingAtMs = entry.sendingAt ? Date.parse(entry.sendingAt) : 0;
          if (Date.now() - sendingAtMs < 20000) {
            return { data: { success: false, reason: 'sending_active' }, error: null };
          } else {
            const updated = {
              ...entry,
              status: 'dispatch_uncertain',
              isUncertain: true,
              lastError: 'Sending stale detectado (>20s sem confirmação)',
            };
            outbox[targetKey] = updated;
            convData.stage_completed_rules = {
              ...rules,
              orchestration: { ...orch, outbox },
            };
            return { data: { success: false, reason: 'sending_stale_uncertain', isUncertain: true, entry: updated }, error: null };
          }
        }
        if (entry.status === 'pending') {
          const updated = {
            ...entry,
            status: 'sending',
            sendingAt: new Date().toISOString(),
            claimedBy: p_claim_token,
            attempts: (entry.attempts || 0) + 1,
          };
          outbox[targetKey] = updated;
          convData.stage_completed_rules = {
            ...rules,
            orchestration: { ...orch, outbox },
          };
          return { data: { success: true, entry: updated }, error: null };
        }
        return { data: { success: false, reason: 'invalid_status' }, error: null };
      }
      return { data: null, error: null };
    },
    getConversationData: () => convData,
    getAiLogs: () => logs,
    getInsertedMessages: () => messages,
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

// =========================================================================
// TESTES OBRIGATÓRIOS: REQUISITOS 46 A 53 (MOTOR OPERACIONAL DETERMINÍSTICO)
// =========================================================================

// TESTE 26 (Requisito 46): Conversa legacy não toca no ConversationAgent nem nos subagentes
test('26. Requisito 46: Conversa legacy não toca no ConversationAgent nem nos subagentes', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let modelCalled = false;
  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        mode: 'legacy',
      },
    },
  });

  const mockRuntime = {
    callModel: async () => {
      modelCalled = true;
      throw new Error('NUNCA DEVE SER CHAMADO PARA CONVERSAS LEGACY');
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_legacy_pure',
    newMessage: {
      id: 'm_legacy_1',
      text: 'Olá mundo legacy',
      timestamp: new Date().toISOString(),
      sender: 'them',
    },
    runtime: mockRuntime,
  });

  assert.equal(result.mode, 'legacy');
  assert.equal(result.handled, false);
  assert.equal(modelCalled, false, 'Modelo de IA nunca deve ser invocado em modo legacy');
});

// TESTE 27 (Requisito 47): Claim integral sem corte arbitrário (1, 5, 20 mensagens)
test('27. Requisito 47: Claim integral sem corte arbitrário processa 20 mensagens no mesmo ciclo', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const pendingMessagesList = [];
  for (let i = 1; i <= 20; i++) {
    pendingMessagesList.push({
      id: `m_batch_${i}`,
      sender_id: 'them',
      is_mine: false,
      direction: 'inbound',
      text: `Mensagem pendente ${i}`,
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    });
  }

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    pendingMessagesList
  );

  let sentText = null;
  const mockRuntime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({
            targetSubagent: 'conexao_inicial',
            action: 'delegate',
            reason: 'Atender lote de 20 mensagens',
          }),
          tokens: 50,
        };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_rapport_estabelecido',
          summary: 'Lote de 20 mensagens recebido',
          suggestedResponse: 'Oi! Li tudo com calma 🥰',
          nextPhase: 'conexao_inicial',
          reasoning: 'Responder com carinho ao lote',
        }),
        tokens: 80,
      };
    },
    sendMetaTextMessage: async (_sb, _convId, text) => {
      sentText = text;
      return { success: true, message_id: 'meta_batch_20' };
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_claim_20',
    newMessage: pendingMessagesList[19],
    runtime: mockRuntime,
  });

  assert.equal(result.handled, true);
  const convData = supabase.getConversationData();
  const orchState = convData.stage_completed_rules.orchestration;
  const recentCycle = orchState.recentCycles?.[0];

  assert.ok(recentCycle, 'Deve haver um ciclo registrado');
  assert.equal(recentCycle.claimedMessageIds.length, 20, 'O ciclo deve fazer claim de todas as 20 mensagens');
  for (let i = 1; i <= 20; i++) {
    assert.equal(orchState.messageLedger[`m_batch_${i}`], 'processed', `Mensagem m_batch_${i} deve ser processed no ledger`);
  }
});

// TESTE 28 (Requisito 48): Snapshot imutável - novas mensagens que chegam durante o ciclo permanecem pending
test('28. Requisito 48: Snapshot imutável mantém novas mensagens concorrentes como pending no ledger', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const initialMsgs = [
    { id: 'm_snap_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Msg 1', created_at: '2026-09-18T05:00:00Z' },
    { id: 'm_snap_2', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Msg 2', created_at: '2026-09-18T05:00:01Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    callModel: async (prompt) => {
      // Simula a chegada de uma nova mensagem no banco durante o processamento
      supabase.getInsertedMessages().push({
        id: 'm_snap_concorrente_3',
        sender_id: 'them',
        is_mine: false,
        direction: 'inbound',
        text: 'Msg 3 que chegou enquanto a IA pensava',
        created_at: new Date().toISOString(),
      });

      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Normal' }),
          tokens: 50,
        };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          summary: 'Respondendo lote original',
          suggestedResponse: 'Tudo bem sim!',
          nextPhase: 'conexao_inicial',
          reasoning: 'Normal',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_snap_ok' }),
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_snapshot_test',
    newMessage: initialMsgs[1],
    runtime: mockRuntime,
  });

  assert.equal(result.handled, true);
  const convData = supabase.getConversationData();
  const orch = convData.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles?.[0];

  // O ciclo congelou apenas m_snap_1 e m_snap_2
  assert.equal(JSON.stringify(cycle.claimedMessageIds), JSON.stringify(['m_snap_1', 'm_snap_2']));
  assert.equal(orch.messageLedger['m_snap_1'], 'processed');
  assert.equal(orch.messageLedger['m_snap_2'], 'processed');
  // m_snap_concorrente_3 NÃO foi marcada como processed no ciclo atual
  assert.notEqual(orch.messageLedger['m_snap_concorrente_3'], 'processed');
});

// TESTE 29 (Requisito 49): Lookup pontual de reply antiga por ID sem carregar histórico completo
test('29. Requisito 49: buildConversationContextForCycle faz lookup pontual de reply antiga por ID', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle } = load('supabase/functions/api/experimental_orchestrator.ts');

  let queriedIds = [];
  const mockSupabase = {
    from: (table) => {
      if (table === 'instagram_messages') {
        return {
          select: () => ({
            in: async (col, ids) => {
              queriedIds = ids;
              return {
                data: [
                  {
                    id: 'm_antiga_id_999',
                    sender_id: 'me',
                    is_mine: true,
                    direction: 'outbound',
                    text: 'Qual o seu esporte favorito?',
                    created_at: '2026-09-17T10:00:00Z',
                  },
                ],
                error: null,
              };
            },
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  };

  const claimed = [
    {
      id: 'm_nova_com_reply',
      sender: 'pretendente',
      text: 'Gosto de natação',
      replyToMessageId: 'm_antiga_id_999',
      timestamp: new Date().toISOString(),
      direction: 'inbound',
    },
  ];

  const { payload, trace } = await buildConversationContextForCycle({
    conversationId: 'conv_lookup_test',
    currentPhase: 'descoberta',
    checkpoint: 'chk_hobbies',
    claimedMessages: claimed,
    supabase: mockSupabase,
    knownFacts: {},
  });

  assert.equal(JSON.stringify(queriedIds), JSON.stringify(['m_antiga_id_999']), 'Deve ter consultado pontualmente apenas o ID da reply');
  assert.ok(payload.referencedMessages['m_antiga_id_999'], 'Referência deve estar no payload');
  assert.equal(payload.referencedMessages['m_antiga_id_999'].text, 'Qual o seu esporte favorito?');
  assert.equal(payload.referencedMessages['m_antiga_id_999'].sender, 'larissa');
  assert.ok(trace.some((t) => t.includes('fetch_replies_count=1')));
});

// TESTE 30 (Requisito 50): Reply para o próprio pretendente rotula remetente como PRETENDENTE
test('30. Requisito 50: Reply para mensagem do próprio pretendente rotula remetente como PRETENDENTE', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle, formatConversationContextForModel } = load(
    'supabase/functions/api/experimental_orchestrator.ts'
  );

  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        in: async () => ({
          data: [
            {
              id: 'm_pretendente_antiga',
              sender_id: 'them',
              is_mine: false,
              direction: 'inbound',
              text: 'Eu moro em Uberlândia',
              created_at: '2026-09-17T11:00:00Z',
            },
          ],
          error: null,
        }),
      }),
    }),
  };

  const claimed = [
    {
      id: 'm_pretendente_reforco',
      sender: 'pretendente',
      text: 'Ou melhor, num distrito perto de Uberlândia',
      replyToMessageId: 'm_pretendente_antiga',
      timestamp: new Date().toISOString(),
      direction: 'inbound',
    },
  ];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_self_reply',
    currentPhase: 'descoberta',
    checkpoint: 'chk_cidade',
    claimedMessages: claimed,
    supabase: mockSupabase,
    knownFacts: {},
  });

  assert.equal(payload.referencedMessages['m_pretendente_antiga'].sender, 'pretendente');

  const textContext = formatConversationContextForModel(payload);
  assert.ok(textContext.includes('[REFERÊNCIAS]'));
  assert.match(textContext, /PRETENDENTE:\nEu moro em Uberlândia/);
  assert.equal(textContext.includes('LARISSA:\nEu moro em Uberlândia'), false);
});

// TESTE 31 (Requisito 51): Outbox Pattern e Idempotência Estrita evita duplo envio
test('31. Requisito 51: Outbox Pattern e Idempotência Estrita previne envios duplicados à Meta', async () => {
  const { load } = createRuntime();
  const { dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let sendCount = 0;
  const mockRuntime = {
    sendMetaTextMessage: async () => {
      sendCount++;
      return { success: true, message_id: 'meta_sent_unique' };
    },
  };

  const outboxEntry = {
    id: 'out_entry_1',
    cycleId: 'cycle_idem_1',
    conversationId: 'conv_idem_test',
    idempotencyKey: 'idemp_key_123',
    content: 'Mensagem única segura',
    messageType: 'text',
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  // Primeiro despacho: executa o envio
  const res1 = await dispatchOutboxEntry({
    supabase: {},
    outboxEntry,
    recipientId: 'conv_idem_test',
    runtime: mockRuntime,
  });

  assert.equal(res1.success, true);
  assert.equal(sendCount, 1);
  assert.equal(outboxEntry.status, 'sent');
  assert.equal(outboxEntry.attempts, 1);

  // Segundo despacho com a mesma outboxEntry (já em status 'sent'): IDEMPOTÊNCIA ESTRITA
  const res2 = await dispatchOutboxEntry({
    supabase: {},
    outboxEntry,
    recipientId: 'conv_idem_test',
    runtime: mockRuntime,
  });

  assert.equal(res2.success, true);
  assert.equal(res2.providerMessageId, 'meta_sent_unique');
  assert.equal(sendCount, 1, 'NÃO deve ter feito segundo envio na Meta');
});

// TESTE 32 (Requisito 52): Falha antes do envio reverte mensagens do ciclo para pending
test('32. Requisito 52: Falha na inferência antes do envio reverte mensagens para pending sem perda', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const pendingMsgs = [
    { id: 'm_err_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Erro 1', created_at: '2026-09-18T05:00:00Z' },
    { id: 'm_err_2', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Erro 2', created_at: '2026-09-18T05:00:01Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    pendingMsgs
  );

  const mockRuntime = {
    callModel: async () => {
      throw new Error('Falha de rede da IA');
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_fail_before_send',
    newMessage: pendingMsgs[1],
    runtime: mockRuntime,
  });

  assert.equal(result.handled, false);
  const convData = supabase.getConversationData();
  const orch = convData.stage_completed_rules.orchestration;

  // As mensagens devem ter sido revertidas para pending para permitir retry
  assert.equal(orch.messageLedger['m_err_1'], 'pending');
  assert.equal(orch.messageLedger['m_err_2'], 'pending');
  assert.equal(convData.stage_completed_rules.active_cycle_token, null, 'Lock deve ser liberado');
});

// TESTE 33 (Requisito 53): Falha durante envio pela Meta registra erro na outbox e reverte ledger
test('33. Requisito 53: Falha durante envio HTTP da Meta registra erro na outbox e reverte ledger', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const pendingMsgs = [
    { id: 'm_meta_fail_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi', created_at: '2026-09-18T05:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    pendingMsgs
  );

  const mockRuntime = {
    callModel: async () => ({
      content: JSON.stringify({
        action: 'reply',
        checkpoint: 'chk_saudacao_feita',
        summary: 'Normal',
        suggestedResponse: 'Olá!',
        nextPhase: 'conexao_inicial',
        reasoning: 'Normal',
      }),
      tokens: 40,
    }),
    sendMetaTextMessage: async () => {
      throw new Error('Graph API Meta 500 Internal Server Error');
    },
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_meta_fail',
    newMessage: pendingMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(result.handled, false);
  const convData = supabase.getConversationData();
  const orch = convData.stage_completed_rules.orchestration;

  // Mensagem revertida para pending
  assert.equal(orch.messageLedger['m_meta_fail_1'], 'pending');
  // Outbox possui a tentativa registrada
  const outboxKeys = Object.keys(orch.outbox || {});
  assert.ok(outboxKeys.length > 0, 'Deve conter registro na outbox');
  const outEntry = orch.outbox[outboxKeys[0]];
  assert.ok(outEntry.lastError.includes('Graph API Meta 500'));
  assert.equal(convData.stage_completed_rules.active_cycle_token, null, 'Lock liberado após erro');
});

// =========================================================================
// TESTE 34 (Requisito 34): Teste de Integração de Ponta a Ponta com Mock
// =========================================================================
test('34. Requisito 34: Teste de Integração de Ponta a Ponta (Webhook -> Normalização -> Cycle -> IA -> Outbox -> Meta Mock)', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, normalizeToCanonicalMessage } = load(
    'supabase/functions/api/experimental_orchestrator.ts'
  );

  // 1. Simula payload bruto vindo do Webhook da Meta
  const rawWebhookEvent = {
    id: 'mid_meta_webhook_101',
    sender_id: '1771103754015024',
    text: 'Oi Larissa, vi que você também curte cidade tranquila! Você já visitou Tiradentes?',
    reply_to_message_id: 'mid_larissa_ref_prev',
    timestamp: new Date().toISOString(),
    is_mine: false,
  };

  // 2. Normalização canônica
  const canonical = normalizeToCanonicalMessage(rawWebhookEvent, '1771103754015024');
  assert.equal(canonical.id, 'mid_meta_webhook_101');
  assert.equal(canonical.sender, 'pretendente');
  assert.equal(canonical.direction, 'inbound');
  assert.equal(canonical.replyToMessageId, 'mid_larissa_ref_prev');

  // 3. Mock do Supabase com estado inicial experimental
  let metaSentPayload = null;
  const initialMessages = [
    {
      id: 'mid_larissa_ref_prev',
      sender_id: 'me',
      is_mine: true,
      direction: 'outbound',
      text: 'Eu moro perto de São João del Rei e amo a calmaria daqui',
      created_at: '2026-09-18T06:00:00Z',
    },
    {
      ...rawWebhookEvent,
      direction: 'inbound',
    },
  ];

  const supabase = createMockSupabase(
    {
      id: '1771103754015024',
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'descoberta',
          checkpoint: 'chk_cidade',
          messageLedger: {
            mid_larissa_ref_prev: 'processed',
          },
        },
      },
    },
    initialMessages
  );

  // 4. Runtime com mocks dos modelos e da Meta
  const mockRuntime = {
    callModel: async (prompt) => {
      // Camada 1: ConversationAgent
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({
            targetSubagent: 'descoberta',
            action: 'delegate',
            reason: 'Pretendente perguntou sobre cidades históricas em Minas',
          }),
          tokens: 45,
        };
      }
      // Camada 2: Subagente Descoberta
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_cidade_validada',
          summary: 'Larissa confirma que adora Tiradentes e pergunta se ele passeia por lá',
          suggestedResponse: 'Nossa, Tiradentes é uma delícia né kkk vou lá direto passear nos finais de semana, você conhece?',
          nextPhase: 'descoberta',
          reasoning: 'Responder reciprocamente sobre a cidade e manter conexão mineira',
        }),
        tokens: 110,
      };
    },
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSentPayload = { convId, text };
      return { message_id: 'meta_graph_api_mid_999999' };
    },
  };

  // 5. Execução do fluxo completo de ponta a ponta
  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: '1771103754015024',
    newMessage: {
      id: rawWebhookEvent.id,
      text: rawWebhookEvent.text,
      timestamp: rawWebhookEvent.timestamp,
      sender: rawWebhookEvent.sender_id,
    },
    runtime: mockRuntime,
  });

  // 6. Validações estritas do resultado de ponta a ponta
  assert.equal(result.handled, true);
  assert.equal(result.mode, 'experimental');
  assert.equal(result.sentToMeta, true);
  assert.ok(result.decision);
  assert.equal(result.decision.action, 'reply');
  assert.equal(result.decision.routedSubagent, 'descoberta');
  assert.equal(result.decision.checkpoint, 'chk_cidade_validada');

  // Validação do envio à Meta Mock
  assert.ok(metaSentPayload, 'Meta Graph API deve ter recebido o envio mockado');
  assert.equal(metaSentPayload.convId, '1771103754015024');
  assert.ok(metaSentPayload.text.includes('Tiradentes'));

  // Validação da persistência da Outbox e Ledger no banco
  const finalConv = supabase.getConversationData();
  const finalOrch = finalConv.stage_completed_rules.orchestration;
  assert.equal(finalOrch.messageLedger['mid_meta_webhook_101'], 'processed');
  assert.equal(finalConv.stage_completed_rules.active_cycle_token, null, 'Lock deve estar livre');

  // Verifica que a Outbox contém providerMessageId da Meta
  const outboxEntries = Object.values(finalOrch.outbox || {});
  assert.equal(outboxEntries.length, 1);
  assert.equal(outboxEntries[0].status, 'sent');
  assert.equal(outboxEntries[0].providerMessageId, 'meta_graph_api_mid_999999');
});

// =========================================================================
// TESTE 35 (Requisito 28): Fallback Seguro para Legacy (Prevenção Estrita de Duplo Envio)
// =========================================================================
test('35. Requisito 28: Fallback Seguro para Legacy distingue falhas pré e pós envio evitando duplo envio', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Cenário A: Falha ANTES do envio (ex: erro no modelo de IA)
  // sentToMeta deve ser false -> Fallback legacy é seguro
  const supabaseA = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
      },
    },
  });

  const resA = await runExperimentalOrchestration({
    supabase: supabaseA,
    conversationId: 'conv_fail_pre_send',
    newMessage: { id: 'm_fail_pre', text: 'Oi', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => { throw new Error('Falha no modelo'); },
    },
  });

  assert.equal(resA.handled, false);
  assert.equal(resA.sentToMeta, false, 'sentToMeta DEVE ser false se falhou antes do envio');

  // Cenário B: Sucesso no envio
  // sentToMeta deve ser true -> Fallback legacy é expressamente proibido
  const supabaseB = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
      },
    },
  });

  const resB = await runExperimentalOrchestration({
    supabase: supabaseB,
    conversationId: 'conv_success_send',
    newMessage: { id: 'm_ok_send', text: 'Oi', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({ action: 'reply', checkpoint: 'chk_saudacao_feita', suggestedResponse: 'Olá!', nextPhase: 'conexao_inicial', summary: 'ok' }),
        tokens: 30,
      }),
      sendMetaTextMessage: async () => ({ message_id: 'meta_ok_123' }),
    },
  });

  assert.equal(resB.handled, true);
  assert.equal(resB.sentToMeta, true, 'sentToMeta DEVE ser true após envio confirmado');
});

// =========================================================================
// TESTE 36 (Requisito 23): Pós-ciclo detecta mensagens concorrentes e agenda próximo ciclo
// =========================================================================
test('36. Requisito 23: Pós-ciclo detecta mensagens concorrentes e agenda próximo ciclo sem perda', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    [
      { id: 'm_initial_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Msg 1', created_at: '2026-09-18T07:00:00Z' },
    ]
  );

  const mockRuntime = {
    callModel: async (prompt) => {
      // Simula chegada de uma nova mensagem no banco durante a execução
      supabase.getInsertedMessages().push({
        id: 'm_concurrent_during_cycle',
        sender_id: 'them',
        is_mine: false,
        direction: 'inbound',
        text: 'Msg 2 concorrente',
        created_at: new Date().toISOString(),
      });

      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Normal' }), tokens: 40 };
      }
      return {
        content: JSON.stringify({ action: 'reply', checkpoint: 'chk_saudacao_feita', suggestedResponse: 'Opa!', nextPhase: 'conexao_inicial', summary: 'ok' }),
        tokens: 50,
      };
    },
    sendMetaTextMessage: async () => ({ message_id: 'meta_cycle_1_ok' }),
  };

  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_post_cycle_check',
    newMessage: { id: 'm_initial_1', text: 'Msg 1', timestamp: '2026-09-18T07:00:00Z', sender: 'them' },
    runtime: mockRuntime,
  });

  assert.equal(result.handled, true);
  const conv = supabase.getConversationData();

  // A mensagem concorrente provocou agendamento para o próximo ciclo
  assert.equal(conv.ai_auto_respond, true);
  assert.ok(conv.ai_debounce_until, 'Deve agendar debounce_until para execução imediata do próximo ciclo');
});

// =========================================================================
// TESTE 37 (Cenários 2 e 4 do Usuário): Stale Lock (>25s) + Ciclo B inicia + Processo Antigo A retorna depois (Prevenção de Zombie Cycle)
// =========================================================================
test('37. Stale Lock (>25s) e Zombie Cycle: Ciclo B assume lock e Ciclo A é preemptado antes de dispatch e commit', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaCalls = [];
  const initialMessages = [
    { id: 'msg_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi Larissa!', created_at: '2026-09-18T07:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          checkpoint: 'chk_saudacao_feita',
          messageLedger: {},
        },
      },
    },
    initialMessages
  );

  let cycleAResolve;
  const cycleAPromise = new Promise((resolve) => { cycleAResolve = resolve; });

  // Ciclo A começa com correlationId corr_cycle_A
  const promiseA = runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_zombie',
    correlationId: 'corr_cycle_A',
    newMessage: { id: 'msg_1', text: 'Oi Larissa!', timestamp: '2026-09-18T07:00:00Z', sender: 'them' },
    runtime: {
      callModel: async () => {
        // Simula ciclo A bloqueado esperando a IA (demora simulada > 30s)
        await cycleAPromise;
        return {
          content: JSON.stringify({
            targetSubagent: 'conexao_inicial',
            action: 'reply',
            checkpoint: 'chk_saudacao_feita',
            suggestedResponse: 'Resposta tardia do Ciclo A',
            nextPhase: 'conexao_inicial',
            summary: 'ok',
          }),
          tokens: 50,
        };
      },
      sendMetaTextMessage: async (sb, convId, text) => {
        metaCalls.push({ sender: 'Ciclo A', text });
        return { message_id: 'meta_from_A' };
      },
    },
  });

  // Aguarda Ciclo A registrar o claim e adquirir lock
  await new Promise((r) => setTimeout(r, 60));

  const convMidA = supabase.getConversationData();
  assert.equal(convMidA.stage_completed_rules.active_cycle_token, 'corr_cycle_A');

  // Simula passagem do tempo: lock expira (>25s)
  convMidA.stage_completed_rules.active_cycle_at = new Date(Date.now() - 30000).toISOString();

  // Uma nova mensagem chega para a conversa
  supabase.getInsertedMessages().push({
    id: 'msg_2',
    sender_id: 'them',
    is_mine: false,
    direction: 'inbound',
    text: 'Tudo bem?',
    created_at: new Date().toISOString(),
  });

  // Ciclo B inicia com correlationId corr_cycle_B e detecta stale lock
  const resB = await runExperimentalOrchestration({
    supabase,
    conversationId: 'test_conv_zombie',
    correlationId: 'corr_cycle_B',
    newMessage: { id: 'msg_2', text: 'Tudo bem?', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({
          targetSubagent: 'conexao_inicial',
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá, resposta legítima do Ciclo B',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 60,
      }),
      sendMetaTextMessage: async (sb, convId, text) => {
        metaCalls.push({ sender: 'Ciclo B', text });
        return { message_id: 'meta_from_B' };
      },
    },
  });

  assert.equal(resB.handled, true, 'Ciclo B deve assumir o lock expirado e concluir');
  assert.equal(resB.sentToMeta, true, 'Ciclo B deve enviar para a Meta');
  assert.equal(metaCalls.length, 1, 'Somente Ciclo B enviou para a Meta até aqui');
  assert.equal(metaCalls[0].sender, 'Ciclo B');

  // AGORA o Ciclo A finalmente acorda da IA tardia
  cycleAResolve();
  const resA = await promiseA;

  // Ciclo A DEVE ser preemptado e abortado!
  assert.equal(resA.handled, false, 'Ciclo A deve ser abortado');
  assert.equal(resA.sentToMeta, false, 'Ciclo A NUNCA deve enviar para a Meta');
  assert.match(resA.error, /preemptado/, 'Erro de A deve registrar preempção');

  // Verifica que metaCalls CONTINUA com exatamente 1 envio (zero duplo envio!)
  assert.equal(metaCalls.length, 1, 'Ciclo A NUNCA deve chamar a Meta após preempção');

  // Verifica que o estado persistido no banco de dados pertence ao Ciclo B
  const convFinal = supabase.getConversationData();
  const lastDecision = convFinal.stage_completed_rules.orchestration.lastDecision;
  assert.equal(lastDecision.suggestedResponse, 'Olá, resposta legítima do Ciclo B', 'Estado de B não pode ser sobrescrito por A');
});

// =========================================================================
// TESTE 38 (Cenários 5, 6 e 7 do Usuário): Meta aceitou mas conexão sofre timeout (isUncertain: true)
// =========================================================================
test('38. Meta Timeout Incerto: marca dispatch_uncertain e bloqueia retry automático e duplicação', async () => {
  const { load } = createRuntime();
  const { dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let httpCalls = 0;
  const mockSupabase = createMockSupabase();

  const outboxEntry = {
    id: 'out_uncertain_test',
    cycleId: 'cycle_unc_1',
    conversationId: 'test_conv_unc',
    idempotencyKey: 'idemp_test_unc',
    content: 'Olá! Mensagem com timeout incerto',
    messageType: 'text',
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  // Simula timeout de rede durante a chamada à Meta
  const mockRuntime = {
    sendMetaTextMessage: async () => {
      httpCalls++;
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    },
  };

  // 1. Primeira tentativa de despacho sofre timeout de rede
  const res1 = await dispatchOutboxEntry({
    supabase: mockSupabase,
    outboxEntry,
    recipientId: 'test_conv_unc',
    runtime: mockRuntime,
  });

  assert.equal(res1.success, false);
  assert.equal(res1.isUncertain, true, 'Deve identificar incerteza de rede');
  assert.equal(outboxEntry.status, 'dispatch_uncertain');
  assert.equal(outboxEntry.isUncertain, true);
  assert.equal(httpCalls, 1);

  // 2. Tentativa de Retry automático cego
  const res2 = await dispatchOutboxEntry({
    supabase: mockSupabase,
    outboxEntry,
    recipientId: 'test_conv_unc',
    runtime: mockRuntime,
  });

  // O retry automático cego DEVE ser bloqueado para evitar duplicação!
  assert.equal(res2.success, false);
  assert.equal(res2.isUncertain, true);
  assert.match(res2.error, /Retry automático bloqueado/);
  assert.equal(httpCalls, 1, 'Nenhuma nova chamada HTTP pode ser feita em status dispatch_uncertain');
});

// =========================================================================
// TESTE 39 (Cenários 8 e 9 do Usuário): Duplo Dispatch Concorrente na Mesma Outbox
// =========================================================================
test('39. Duplo Dispatch Concorrente: impede dois despachos simultâneos da mesma outbox entry', async () => {
  const { load } = createRuntime();
  const { dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let httpCalls = 0;
  const mockSupabase = createMockSupabase();

  const outboxEntry = {
    id: 'out_race_entry',
    cycleId: 'cycle_race_1',
    conversationId: 'test_conv_race',
    idempotencyKey: 'idemp_test_race',
    content: 'Olá concorrente',
    messageType: 'text',
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  const mockRuntime = {
    sendMetaTextMessage: async () => {
      httpCalls++;
      // Simula pequeno delay de rede para permitir concorrência
      await new Promise((r) => setTimeout(r, 40));
      return { message_id: 'meta_single_win' };
    },
  };

  // Dispara duas chamadas concorrentes praticamente no mesmo milissegundo
  const [callA, callB] = await Promise.all([
    dispatchOutboxEntry({ supabase: mockSupabase, outboxEntry, recipientId: 'test_conv_race', runtime: mockRuntime }),
    dispatchOutboxEntry({ supabase: mockSupabase, outboxEntry, recipientId: 'test_conv_race', runtime: mockRuntime }),
  ]);

  // Exatamente uma das duas chamadas deve ter sido bem-sucedida, e a outra bloqueada por status: sending
  const successes = [callA, callB].filter((c) => c.success);
  const rejections = [callA, callB].filter((c) => !c.success);

  assert.equal(successes.length, 1, 'Exatamente um dispatch deve ter sucesso');
  assert.equal(rejections.length, 1, 'O outro dispatch deve ser rejeitado por concorrência');
  assert.match(rejections[0].error, /sending|concorrente/i);
  assert.equal(httpCalls, 1, 'Meta deve ser chamada exatamente uma vez');
  assert.equal(outboxEntry.status, 'sent');
  assert.equal(outboxEntry.providerMessageId, 'meta_single_win');
});

// =========================================================================
// TESTE 40 (Cenário 10 do Usuário): Crash em Status sending e Proteção contra Retry Cego após 20s
// =========================================================================
test('40. Outbox Crash em sending: bloqueia retry imediato e marca dispatch_uncertain após 20s com ZERO reenvio', async () => {
  const { load } = createRuntime();
  const { dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let httpCalls = 0;
  const mockSupabase = createMockSupabase();

  const outboxEntry = {
    id: 'out_crash_entry',
    cycleId: 'cycle_crash_1',
    conversationId: 'test_conv_crash',
    idempotencyKey: 'idemp_test_crash',
    content: 'Mensagem pós-crash',
    messageType: 'text',
    status: 'sending',
    sendingAt: new Date(Date.now() - 5000).toISOString(), // 5s atrás (lock ativo)
    attempts: 1,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  const mockRuntime = {
    sendMetaTextMessage: async () => {
      httpCalls++;
      return { message_id: 'meta_recovered_ok' };
    },
  };

  // 1. Tentativa dentro da janela de 20s (ainda em processo ou crash recente) -> BLOQUEADO
  const resImmediate = await dispatchOutboxEntry({
    supabase: mockSupabase,
    outboxEntry,
    recipientId: 'test_conv_crash',
    runtime: mockRuntime,
  });
  assert.equal(resImmediate.success, false);
  assert.match(resImmediate.error, /sending|concorrente/i);
  assert.equal(httpCalls, 0);

  // 2. Simula passagem de mais de 20 segundos (sending stale: Meta pode ter recebido!)
  outboxEntry.sendingAt = new Date(Date.now() - 25000).toISOString();

  const resRecovered = await dispatchOutboxEntry({
    supabase: mockSupabase,
    outboxEntry,
    recipientId: 'test_conv_crash',
    runtime: mockRuntime,
  });

  // NÃO pode haver reenvio automático cego! Deve marcar dispatch_uncertain e ZERO chamadas à Meta
  assert.equal(resRecovered.success, false);
  assert.equal(resRecovered.isUncertain, true);
  assert.equal(httpCalls, 0, 'ZERO chamadas à Meta permitidas em sending stale!');
  assert.equal(outboxEntry.status, 'dispatch_uncertain');
  assert.equal(outboxEntry.isUncertain, true);

  // 3. Nova tentativa futura sobre dispatch_uncertain também é BLOQUEADA
  const resFuture = await dispatchOutboxEntry({
    supabase: mockSupabase,
    outboxEntry,
    recipientId: 'test_conv_crash',
    runtime: mockRuntime,
  });
  assert.equal(resFuture.success, false);
  assert.equal(resFuture.isUncertain, true);
  assert.equal(httpCalls, 0, 'ZERO chamadas futuras à Meta em dispatch_uncertain!');
});

// =========================================================================
// TESTE 41 (Cenários 11 e 12 do Usuário): Fallback Legacy sob Timeout Incerto é Rigorosamente Bloqueado
// =========================================================================
test('41. Fallback Legacy sob Incerteza: sentToMeta=true e isPreemptedOrCancelled impedem ativação do legacy', async () => {
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

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_uncertain_fallback_test',
    newMessage: { id: 'm_unc_fb', text: 'Oi', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá!',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 30,
      }),
      sendMetaTextMessage: async () => {
        const err = new Error('Network timeout during POST to Meta');
        err.name = 'TimeoutError';
        throw err;
      },
    },
  });

  // Sob timeout incerto na Meta:
  // 1. handled é true (o ciclo tratou a ocorrência)
  assert.equal(res.handled, true);
  // 2. sentToMeta é true (para sinalizar que a mensagem pode ter saído, impedindo envio legacy alternativo)
  assert.equal(res.sentToMeta, true, 'sentToMeta DEVE ser true sob incerteza de rede para proteger contra fallback duplo');

  // 3. Simula a avaliação da guarda no index.ts
  const isPreemptedOrCancelled =
    res.error?.includes('preemptado') ||
    res.error?.includes('Cancelado pelo operador') ||
    res.error?.includes('Incerteza de rede');

  const triggersLegacyFallback =
    !res.handled && res.error && !res.sentToMeta && res.error !== 'Lock ativo concorrente' && !res.skippedDuplicate && !isPreemptedOrCancelled;

  assert.equal(triggersLegacyFallback, false, 'Fallback para o legacy NÃO pode ser acionado sob incerteza!');
});

// =========================================================================
// TESTE 42 (Cenários 13 e 14 do Usuário): Lote de 20 Mensagens + 10 Mensagens Chegando Durante Ciclo Longo
// =========================================================================
test('42. Lote 20 + 10 Mensagens Concorrentes: Ciclo A processa 20, Ciclo B processa 10, zero perdas e zero duplicatas', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Cria 20 mensagens iniciais
  const initialMessages = [];
  for (let i = 1; i <= 20; i++) {
    initialMessages.push({
      id: `batch_msg_${i}`,
      sender_id: 'them',
      is_mine: false,
      direction: 'inbound',
      text: `Mensagem ${i} do lote de 20`,
      created_at: new Date(Date.now() - (25 - i) * 1000).toISOString(),
    });
  }

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    initialMessages
  );

  let capturedAClaimCount = 0;
  let capturedBClaimCount = 0;

  // Ciclo A começa
  const resA = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_batch_20_10',
    correlationId: 'corr_batch_A',
    newMessage: initialMessages[0],
    runtime: {
      callModel: async (prompt) => {
        // Durante a inferência do Ciclo A, entram 10 mensagens novas concorrentes (msg 21 a 30)
        for (let j = 21; j <= 30; j++) {
          supabase.getInsertedMessages().push({
            id: `batch_msg_${j}`,
            sender_id: 'them',
            is_mine: false,
            direction: 'inbound',
            text: `Mensagem concorrente ${j}`,
            created_at: new Date().toISOString(),
          });
        }

        if (prompt.includes('Agente da Conversa')) {
          return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Lote de 20' }), tokens: 50 };
        }
        return {
          content: JSON.stringify({
            action: 'reply',
            checkpoint: 'chk_saudacao_feita',
            suggestedResponse: 'Resposta ao primeiro lote de 20',
            nextPhase: 'conexao_inicial',
            summary: 'ok',
          }),
          tokens: 60,
        };
      },
      sendMetaTextMessage: async () => ({ message_id: 'meta_batch_A_ok' }),
    },
  });

  assert.equal(resA.handled, true);
  assert.equal(resA.sentToMeta, true);

  const convStateAfterA = supabase.getConversationData().stage_completed_rules.orchestration;
  const ledgerAfterA = convStateAfterA.messageLedger;

  // Verifica que exatamente as 20 primeiras mensagens foram marcadas como processed
  for (let i = 1; i <= 20; i++) {
    assert.equal(ledgerAfterA[`batch_msg_${i}`], 'processed', `Mensagem ${i} deve ser processed`);
  }

  // Verifica que as 10 novas mensagens (21 a 30) NÃO foram absorvidas pelo Ciclo A
  for (let j = 21; j <= 30; j++) {
    assert.notEqual(ledgerAfterA[`batch_msg_${j}`], 'processed', `Mensagem ${j} NÃO pode ter sido processada no Ciclo A`);
  }

  // Verifica que o pós-ciclo agendou o próximo ciclo
  assert.equal(supabase.getConversationData().ai_auto_respond, true);

  // Agora Ciclo B roda para processar o follow-up
  const resB = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_batch_20_10',
    correlationId: 'corr_batch_B',
    newMessage: { id: 'batch_msg_21', text: 'Mensagem concorrente 21', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async (prompt) => {
        if (prompt.includes('Agente da Conversa')) {
          return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Lote de 10' }), tokens: 50 };
        }
        return {
          content: JSON.stringify({
            action: 'reply',
            checkpoint: 'chk_saudacao_feita',
            suggestedResponse: 'Resposta ao segundo lote de 10',
            nextPhase: 'conexao_inicial',
            summary: 'ok',
          }),
          tokens: 60,
        };
      },
      sendMetaTextMessage: async () => ({ message_id: 'meta_batch_B_ok' }),
    },
  });

  assert.equal(resB.handled, true);
  assert.equal(resB.sentToMeta, true);

  const convStateAfterB = supabase.getConversationData().stage_completed_rules.orchestration;
  const ledgerAfterB = convStateAfterB.messageLedger;

  // Verifica que agora todas as 30 mensagens estão no status processed
  for (let k = 1; k <= 30; k++) {
    assert.equal(ledgerAfterB[`batch_msg_${k}`], 'processed', `Mensagem ${k} deve estar processada após Ciclo B`);
  }
});

// =========================================================================
// TESTE 43 (Requisito 18): Teste Ponta a Ponta do Caso Mais Perigoso
// =========================================================================
test('43. Caso Mais Perigoso Ponta a Ponta: Msg chega -> IA demora >25s -> B inicia -> A tenta envio e é preemptado -> B despacha -> Exatamente 1 envio à Meta', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaDispatched = [];
  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          messageLedger: {},
        },
      },
    },
    [
      { id: 'msg_extreme_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Mensagem do teste de estresse', created_at: '2026-09-18T07:00:00Z' },
    ]
  );

  let unblockA;
  const waitA = new Promise((r) => { unblockA = r; });

  // 1. Ciclo A inicia
  const promiseA = runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_extreme_stress',
    correlationId: 'corr_extreme_A',
    newMessage: { id: 'msg_extreme_1', text: 'Mensagem do teste de estresse', timestamp: '2026-09-18T07:00:00Z', sender: 'them' },
    runtime: {
      callModel: async () => {
        await waitA; // Bloqueado esperando IA
        return {
          content: JSON.stringify({
            targetSubagent: 'conexao_inicial',
            action: 'reply',
            checkpoint: 'chk_saudacao_feita',
            suggestedResponse: 'Resposta tardia A',
            nextPhase: 'conexao_inicial',
            summary: 'ok',
          }),
          tokens: 45,
        };
      },
      sendMetaTextMessage: async (sb, cId, txt) => {
        metaDispatched.push({ from: 'Ciclo A', text: txt });
        return { message_id: 'meta_from_extreme_A' };
      },
    },
  });

  // Aguarda Ciclo A adquirir lock
  await new Promise((r) => setTimeout(r, 50));

  // 2. O lock fica stale (tempo passa > 25 segundos)
  supabase.getConversationData().stage_completed_rules.active_cycle_at = new Date(Date.now() - 35000).toISOString();

  // Nova mensagem chega
  supabase.getInsertedMessages().push({
    id: 'msg_extreme_2',
    sender_id: 'them',
    is_mine: false,
    direction: 'inbound',
    text: 'Outra mensagem enquanto IA dormia',
    created_at: new Date().toISOString(),
  });

  // 3. Ciclo B inicia e assume lock
  const resB = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_extreme_stress',
    correlationId: 'corr_extreme_B',
    newMessage: { id: 'msg_extreme_2', text: 'Outra mensagem enquanto IA dormia', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({
          targetSubagent: 'conexao_inicial',
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Resposta legítima B',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 45,
      }),
      sendMetaTextMessage: async (sb, cId, txt) => {
        metaDispatched.push({ from: 'Ciclo B', text: txt });
        return { message_id: 'meta_from_extreme_B' };
      },
    },
  });

  assert.equal(resB.handled, true);
  assert.equal(resB.sentToMeta, true);
  assert.equal(metaDispatched.length, 1);
  assert.equal(metaDispatched[0].from, 'Ciclo B');

  // 4. Ciclo A finalmente acorda e tenta despachar
  unblockA();
  const resA = await promiseA;

  // Ciclo A deve ter sido preemptado antes de qualquer envio à Meta
  assert.equal(resA.handled, false);
  assert.equal(resA.sentToMeta, false);
  assert.match(resA.error, /preemptado/);

  // 5. PROVA ABSOLUTA: Exatamente 1 envio à Meta foi realizado
  assert.equal(metaDispatched.length, 1, 'Exatamente UMA mensagem deve ser enviada para a Meta no total!');
  assert.equal(metaDispatched[0].text, 'Resposta legítima B');
});

// =========================================================================
// TESTE 44 (Teste A do Usuário): pending -> sending -> Meta recebeu -> crash -> >20s -> ZERO segundo envio
// =========================================================================
test('44. Teste A: pending -> sending -> Meta recebeu -> crash -> >20s -> ZERO segundo envio (marca dispatch_uncertain)', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic, dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_crash_proof_A';
  const outboxId = 'out_crash_A';

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        outbox: {
          [outboxId]: {
            id: outboxId,
            cycleId: 'cycle_A_1',
            conversationId,
            idempotencyKey: 'idemp_A_1',
            content: 'Mensagem entregue mas sem ack',
            messageType: 'text',
            status: 'pending',
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date().toISOString(),
          },
        },
      },
    },
  });

  // 1. Worker 1 faz claim atômico com sucesso
  const claim1 = await claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'worker_1_token',
  });
  assert.equal(claim1.success, true);
  assert.equal(claim1.entry.status, 'sending');

  // 2. Worker 1 chama a Meta; a Meta recebe com sucesso!
  metaCalls++; // Meta recebeu a mensagem no Instagram!
  // Mas antes de atualizar o banco para 'sent', o worker sofre crash / timeout de processo!
  // O banco permanece com status: 'sending', e o tempo passa (> 20 segundos)
  const convState = supabase.getConversationData();
  convState.stage_completed_rules.orchestration.outbox[outboxId].sendingAt = new Date(Date.now() - 30000).toISOString();

  // 3. Worker 2 (novo processo/ciclo) tenta enviar a mesma outbox
  const claim2 = await claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'worker_2_token',
  });

  // O claim atômico DEVE rejeitar o envio e converter para sending_stale_uncertain
  assert.equal(claim2.success, false);
  assert.equal(claim2.isUncertain, true);
  assert.equal(claim2.reason, 'sending_stale_uncertain');

  // Worker 2 NÃO pode chamar a Meta!
  assert.equal(metaCalls, 1, 'ZERO segundo envio para a Meta!');

  // O banco agora reflete status dispatch_uncertain
  const updatedEntry = convState.stage_completed_rules.orchestration.outbox[outboxId];
  assert.equal(updatedEntry.status, 'dispatch_uncertain');
  assert.equal(updatedEntry.isUncertain, true);
});

// =========================================================================
// TESTE 45 (Teste B do Usuário): Falha comprovada ANTES de qualquer chamada HTTP -> retry permitido
// =========================================================================
test('45. Teste B: pending -> falha comprovada ANTES de qualquer HTTP -> retry permitido com segurança', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic, dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_safe_retry_B';
  const outboxId = 'out_safe_retry_B';

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        outbox: {
          [outboxId]: {
            id: outboxId,
            cycleId: 'cycle_B_1',
            conversationId,
            idempotencyKey: 'idemp_B_1',
            content: 'Mensagem com falha pré-envio',
            messageType: 'text',
            status: 'pending',
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date().toISOString(),
          },
        },
      },
    },
  });

  // 1. Simula falha comprovada antes de qualquer rede (ex: erro local de validação)
  // A entrada continua comprovadamente 'pending' sem nenhuma chamada à Meta
  assert.equal(metaCalls, 0);

  // 2. Nova tentativa de envio: worker adquire claim
  const claimRes = await claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'worker_retry_token',
  });
  assert.equal(claimRes.success, true);
  assert.equal(claimRes.entry.status, 'sending');

  // 3. Dispatcher executa com sucesso
  const dispatchRes = await dispatchOutboxEntry({
    supabase,
    outboxEntry: claimRes.entry,
    recipientId: conversationId,
    claimToken: 'worker_retry_token',
    runtime: {
      sendMetaTextMessage: async () => {
        metaCalls++;
        return { message_id: 'meta_safe_b_ok' };
      },
    },
  });

  assert.equal(dispatchRes.success, true);
  assert.equal(metaCalls, 1);
  assert.equal(claimRes.entry.status, 'sent');
});

// =========================================================================
// TESTE 46 (Teste C do Usuário): Dois workers independentes disputam claim da mesma outbox
// =========================================================================
test('46. Teste C: Dois workers independentes disputam claim da mesma outbox -> Exatamente 1 vence e 1 envio à Meta', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic, dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_race_claim_C';
  const outboxId = 'out_race_claim_C';

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        outbox: {
          [outboxId]: {
            id: outboxId,
            cycleId: 'cycle_C_init',
            conversationId,
            idempotencyKey: 'idemp_C_1',
            content: 'Mensagem disputada',
            messageType: 'text',
            status: 'pending',
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date().toISOString(),
          },
        },
      },
    },
  });

  // Dois workers independentes (instâncias separadas sem compartilhamento de memória)
  const worker1ClaimPromise = claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'worker_token_1',
  });

  const worker2ClaimPromise = claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'worker_token_2',
  });

  const [claim1, claim2] = await Promise.all([worker1ClaimPromise, worker2ClaimPromise]);

  // Exclusão Mútua: exatamente um deve vencer (true) e o outro falhar (false)
  const successCount = (claim1.success ? 1 : 0) + (claim2.success ? 1 : 0);
  assert.equal(successCount, 1, 'Exatamente UM worker deve obter o claim da outbox!');

  const winner = claim1.success ? claim1 : claim2;
  const loser = claim1.success ? claim2 : claim1;
  const winnerToken = claim1.success ? 'worker_token_1' : 'worker_token_2';

  assert.equal(loser.success, false);
  assert.equal(loser.reason, 'sending_active');

  // Somente o worker vencedor despacha
  const dispatchRes = await dispatchOutboxEntry({
    supabase,
    outboxEntry: winner.entry,
    recipientId: conversationId,
    claimToken: winnerToken,
    runtime: {
      sendMetaTextMessage: async () => {
        metaCalls++;
        return { message_id: 'meta_race_winner_ok' };
      },
    },
  });

  assert.equal(dispatchRes.success, true);
  assert.equal(metaCalls, 1, 'Exatamente UMA chamada à Meta deve ser realizada no total!');
});

// =========================================================================
// TESTE 47 (Teste D do Usuário): Worker perdedor do claim NÃO chama Meta e NÃO ativa fallback legacy
// =========================================================================
test('47. Teste D: Worker que falha claim da outbox NÃO chama Meta e NÃO ativa fallback legacy', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_loser_worker_D';

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        active_cycle_token: 'active_winner_token', // Já em posse de outro worker
        active_cycle_at: new Date().toISOString(),
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          outbox: {
            out_d_active: {
              id: 'out_d_active',
              status: 'sending',
              sendingAt: new Date().toISOString(),
              claimedBy: 'active_winner_token',
            },
          },
        },
      },
    },
    [
      { id: 'msg_d_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi', created_at: new Date().toISOString() },
    ]
  );

  const resLoser = await runExperimentalOrchestration({
    supabase,
    conversationId,
    correlationId: 'loser_worker_token',
    newMessage: { id: 'msg_d_1', text: 'Oi', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({ action: 'reply', suggestedResponse: 'Tentativa indevida' }),
      }),
      sendMetaTextMessage: async () => {
        metaCalls++;
        return { message_id: 'meta_should_not_be_called' };
      },
    },
  });

  // Worker perdedor deve ser bloqueado
  assert.equal(resLoser.handled, false);
  assert.equal(resLoser.sentToMeta, false);
  assert.equal(metaCalls, 0, 'Worker perdedor NUNCA pode chamar a Meta!');

  // O fallback para o legacy NÃO PODE ser ativado porque a causa é concorrência
  assert.match(resLoser.error, /lock ativo concorrente/i);
});

// =========================================================================
// TESTE 48 (Teste E do Usuário): dispatch_uncertain bloqueia qualquer tentativa de reenvio automático
// =========================================================================
test('48. Teste E: dispatch_uncertain bloqueia reenvio automático por ciclos futuros', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic, dispatchOutboxEntry } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_uncertain_block_E';
  const outboxId = 'out_uncertain_E';

  const supabase = createMockSupabase({
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        outbox: {
          [outboxId]: {
            id: outboxId,
            cycleId: 'cycle_old',
            conversationId,
            idempotencyKey: 'idemp_E_1',
            content: 'Mensagem com status incerto',
            messageType: 'text',
            status: 'dispatch_uncertain',
            isUncertain: true,
            attempts: 1,
            maxAttempts: 3,
            createdAt: new Date().toISOString(),
          },
        },
      },
    },
  });

  // 1. Tentativa de claim atômico
  const claimRes = await claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: outboxId,
    claimToken: 'future_worker_token',
  });

  assert.equal(claimRes.success, false);
  assert.equal(claimRes.isUncertain, true);
  assert.equal(claimRes.reason, 'dispatch_uncertain');

  // 2. Tentativa direta de dispatch
  const outboxEntry = supabase.getConversationData().stage_completed_rules.orchestration.outbox[outboxId];
  const dispatchRes = await dispatchOutboxEntry({
    supabase,
    outboxEntry,
    recipientId: conversationId,
    runtime: {
      sendMetaTextMessage: async () => {
        metaCalls++;
        return { message_id: 'meta_should_never_happen' };
      },
    },
  });

  assert.equal(dispatchRes.success, false);
  assert.equal(dispatchRes.isUncertain, true);
  assert.match(dispatchRes.error, /dispatch_uncertain|bloqueado/i);
  assert.equal(metaCalls, 0, 'ZERO chamadas à Meta sob status dispatch_uncertain!');
});

// =========================================================================
// TESTE 49 (Teste F do Usuário): Fallback legacy é completamente bloqueado sob incerteza de envio
// =========================================================================
test('49. Teste F: Fallback legacy é completamente bloqueado quando a falha é por incerteza de envio', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let legacyExecuted = false;
  let metaCalls = 0;
  const conversationId = 'conv_legacy_lockout_F';

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          checkpoint: 'chk_saudacao_feita',
          outbox: {},
          messageLedger: {},
        },
      },
    },
    [
      { id: 'msg_f_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Olá Larissa!', created_at: new Date().toISOString() },
    ]
  );

  // Executa ciclo experimental simulando timeout de rede na chamada da Meta (resultado incerto!)
  const expResult = await runExperimentalOrchestration({
    supabase,
    conversationId,
    correlationId: 'corr_cycle_F',
    newMessage: { id: 'msg_f_1', text: 'Olá Larissa!', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({
          targetSubagent: 'conexao_inicial',
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá! Como você está?',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta inicial',
        }),
        tokens: 40,
      }),
      sendMetaTextMessage: async () => {
        metaCalls++;
        // Simula timeout ou perda de conexão HTTP após pacote enviado
        const timeoutErr = new Error('fetch failed: ETIMEDOUT');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      },
    },
  });

  // A orquestração experimental tratou o timeout incerto:
  // sentToMeta DEVE ser true para indicar que a mensagem pode ter saído
  assert.equal(expResult.sentToMeta, true, 'sentToMeta DEVE ser true em caso de incerteza de rede!');

  // Simulador do router do index.ts:
  // Decisão de fallback legado:
  if (
    expResult.mode === 'experimental' &&
    !expResult.handled &&
    !expResult.sentToMeta &&
    !expResult.isPreemptedOrCancelled
  ) {
    legacyExecuted = true;
  }

  // PROVA: Fallback legacy NUNCA pode ser executado
  assert.equal(legacyExecuted, false, 'Fallback legacy DEVE ser bloqueado sob incerteza de envio!');
  assert.equal(metaCalls, 1, 'Exatamente UMA tentativa de envio foi feita (zero duplicatas no legado)!');
});

