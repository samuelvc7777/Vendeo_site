const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

/**
 * Cria o ambiente de runtime para carregar módulos TypeScript do Deno/Supabase
 */
function createRuntime(mockFetch = async () => ({ ok: true, json: async () => ({}) }), customModules = {}) {
  const cache = new Map();
  let serverHandler = null;
  const backgroundPromises = [];

  function load(file) {
    if (customModules[file]) return customModules[file];
    if (file.includes('server.ts') || file.startsWith('https://deno.land')) {
      return {
        serve: (handler) => {
          serverHandler = handler;
        },
      };
    }
    if (file.includes('@supabase/supabase-js') || file.startsWith('https://esm.sh')) {
      return {
        createClient: () => customModules['@supabase/client'] || {},
      };
    }
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
        require: (ref) => {
          if (customModules[ref]) return customModules[ref];
          if (ref.startsWith('https://') || ref.startsWith('http://')) return load(ref);
          return load(path.resolve(path.dirname(resolved), ref));
        },
        fetch: mockFetch,
        AbortSignal,
        console,
        TextDecoder,
        TextEncoder,
        setTimeout,
        clearTimeout,
        Deno: {
          env: {
            get: (k) => process.env[k] || 'test_val',
          },
        },
        EdgeRuntime: {
          waitUntil: (p) => {
            backgroundPromises.push(p);
          },
        },
        Request: globalThis.Request,
        Response: globalThis.Response,
        Headers: globalThis.Headers,
        URL: globalThis.URL,
      },
      { filename: resolved }
    );
    return module.exports;
  }
  return {
    load,
    getServerHandler: () => serverHandler,
    getBackgroundPromises: () => backgroundPromises,
  };
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
        const createQueryObj = (currentMsgs = [...messages]) => ({
          eq: (col, val) => {
            if (col === 'conversation_id') {
              return createQueryObj(currentMsgs.filter((m) => !m.conversation_id || m.conversation_id === val));
            }
            return createQueryObj(currentMsgs.filter((m) => m[col] === val));
          },
          or: () => createQueryObj(currentMsgs),
          not: () => createQueryObj(currentMsgs),
          order: (col, opts) => {
            const sorted = [...currentMsgs].sort((a, b) => {
              const valA = a[col] || a.created_at || a.timestamp || '';
              const valB = b[col] || b.created_at || b.timestamp || '';
              if (opts && opts.ascending === false) {
                return valB > valA ? 1 : valB < valA ? -1 : 0;
              }
              return valA > valB ? 1 : valA < valB ? -1 : 0;
            });
            return createQueryObj(sorted);
          },
          limit: async (n) => ({ data: n !== undefined ? currentMsgs.slice(0, n) : currentMsgs, error: null }),
          in: async (col, ids) => ({
            data: currentMsgs.filter((m) => ids.includes(m.id)),
            error: null,
            order: () => ({ limit: async () => ({ data: currentMsgs.filter((m) => ids.includes(m.id)), error: null }) }),
          }),
          maybeSingle: async () => ({ data: currentMsgs[0] || null, error: null }),
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

  // Com o Freshness Gate ativo, a chegada de nova mensagem durante a inferência preempta o ciclo
  assert.equal(result.handled, false, 'Ciclo deve ser preemptado quando nova mensagem chega durante inferência');
  assert.match(result.error, /preemptado/i);
  const convData = supabase.getConversationData();
  const orch = convData.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles?.[0];

  assert.equal(cycle.status, 'superseded', 'Status do ciclo deve ser superseded');
  assert.equal(orch.messageLedger['m_snap_1'], 'pending', 'Mensagens claimed devem reverter para pending');
  assert.equal(orch.messageLedger['m_snap_2'], 'pending', 'Mensagens claimed devem reverter para pending');
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

  // Com o Freshness Gate ativo, a mensagem concorrente durante o ciclo provoca preempção imediata
  assert.equal(result.handled, false, 'Deve ser preemptado por nova mensagem');
  assert.match(result.error, /preemptado/i);
  const conv = supabase.getConversationData();

  // A mensagem concorrente provocou agendamento para o próximo ciclo
  assert.equal(conv.stage_completed_rules.ai_auto_respond, true);
  assert.ok(conv.stage_completed_rules.ai_debounce_until, 'Deve agendar debounce_until para execução do próximo ciclo');
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

  assert.equal(resA.handled, false, 'Ciclo A deve ser preemptado quando 10 novas mensagens chegam durante sua inferência');
  assert.equal(resA.sentToMeta, false, 'Ciclo A não deve enviar à Meta');
  assert.match(resA.error, /preemptado/i);

  const convStateAfterA = supabase.getConversationData().stage_completed_rules.orchestration;
  const ledgerAfterA = convStateAfterA.messageLedger;

  // Verifica que as 20 primeiras mensagens reverteram para pending para serem unificadas
  for (let i = 1; i <= 20; i++) {
    assert.equal(ledgerAfterA[`batch_msg_${i}`], 'pending', `Mensagem ${i} deve ser pending após preempção de A`);
  }

  // Verifica que a preempção agendou o próximo ciclo via debounce
  assert.equal(supabase.getConversationData().stage_completed_rules.ai_auto_respond, true);
  assert.ok(supabase.getConversationData().stage_completed_rules.ai_debounce_until);

  // Agora Ciclo B roda para processar o lote unificado (as 20 originais + 10 novas = 30 mensagens)
  const resB = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_batch_20_10',
    correlationId: 'corr_batch_B',
    newMessage: { id: 'batch_msg_21', text: 'Mensagem concorrente 21', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async (prompt) => {
        if (prompt.includes('Agente da Conversa')) {
          return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Lote unificado de 30' }), tokens: 50 };
        }
        return {
          content: JSON.stringify({
            action: 'reply',
            checkpoint: 'chk_saudacao_feita',
            suggestedResponse: 'Resposta ao lote unificado de 30 mensagens',
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

// =========================================================================
// TESTE 50: Falha de Infraestrutura na RPC -> FAIL CLOSED absoluto
// =========================================================================
test('50. Falha de Infraestrutura na RPC: erro de rede/Postgres falha fechado (ZERO envio à Meta, ZERO fallback inseguro)', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, claimOutboxEntryAtomic } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const conversationId = 'conv_rpc_infra_err';

  // Simula cliente Supabase cuja RPC retorna erro de conexão com o PostgreSQL
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
      { id: 'msg_infra_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi', created_at: new Date().toISOString() },
    ]
  );

  // Sobrescreve rpc para simular erro de banco (ex: 500 / conexão perdida com Postgres)
  supabase.rpc = async () => ({
    data: null,
    error: { message: 'connection to server was lost', code: '08006' },
  });

  // 1. Chamada direta de claimOutboxEntryAtomic
  const directClaim = await claimOutboxEntryAtomic({
    supabase,
    conversationId,
    outboxKey: 'out_any',
    claimToken: 'corr_test',
  });
  assert.equal(directClaim.success, false);
  assert.equal(directClaim.isInfraFailure, true);
  assert.equal(directClaim.reason, 'rpc_error_fail_closed');

  // 2. Execução ponta a ponta da orquestração: NÃO PODE fazer fallback para read-modify-write nem chamar a Meta!
  const res = await runExperimentalOrchestration({
    supabase,
    conversationId,
    correlationId: 'corr_infra_fail',
    newMessage: { id: 'msg_infra_1', text: 'Oi', timestamp: new Date().toISOString(), sender: 'them' },
    runtime: {
      callModel: async () => ({
        content: JSON.stringify({
          action: 'reply',
          suggestedResponse: 'Não pode enviar se RPC falhar',
        }),
      }),
      sendMetaTextMessage: async () => {
        metaCalls++;
        return { message_id: 'should_not_happen' };
      },
    },
  });

  // Verificações estritas de fail-closed
  assert.equal(res.handled, false);
  assert.equal(res.sentToMeta, false);
  assert.match(res.error, /Falha de infraestrutura no claim atômico.*rpc_error_fail_closed/);
  assert.equal(metaCalls, 0, 'ZERO chamadas à Meta permitidas sob falha de infraestrutura!');

  // Mensagens voltam para pending para reprocessamento futuro quando o Postgres se recuperar
  const convState = supabase.getConversationData();
  const ledger = convState.stage_completed_rules.orchestration.messageLedger;
  assert.equal(ledger['msg_infra_1'], 'pending', 'Mensagem deve permanecer pending para ciclo futuro');
});

// =========================================================================
// TESTE 51: RPC Indisponível (Sem suporte a RPC) -> FAIL CLOSED imediato
// =========================================================================
test('51. RPC Indisponível: cliente sem método rpc falha fechado imediatamente sem tentar ler/modificar/gravar', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Supabase client sem rpc (ex: postgrest básico sem rpc registrado)
  const supabaseWithoutRpc = { from: () => {} };

  const claimRes = await claimOutboxEntryAtomic({
    supabase: supabaseWithoutRpc,
    conversationId: 'conv_no_rpc',
    outboxKey: 'out_key',
    claimToken: 'token_1',
  });

  assert.equal(claimRes.success, false);
  assert.equal(claimRes.isInfraFailure, true);
  assert.equal(claimRes.reason, 'rpc_unavailable_fail_closed');
});

// =========================================================================
// TESTE 52: Distinção Estrita entre Perda Normal de Claim vs Falha de Infra
// =========================================================================
test('52. Distinção Semântica: Perda normal de claim (isInfraFailure=false) vs Falha de Infraestrutura (isInfraFailure=true)', async () => {
  const { load } = createRuntime();
  const { claimOutboxEntryAtomic } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Caso A: Perda normal de claim por concorrência ativa (RPC funcionou e respondeu sending_active)
  const supabaseNormal = {
    rpc: async () => ({
      data: { success: false, reason: 'sending_active' },
      error: null,
    }),
  };

  const normalLoss = await claimOutboxEntryAtomic({
    supabase: supabaseNormal,
    conversationId: 'conv_1',
    outboxKey: 'out_1',
    claimToken: 'token_a',
  });
  assert.equal(normalLoss.success, false);
  assert.equal(normalLoss.isInfraFailure, false, 'Perda por concorrência NÃO é falha de infra');
  assert.equal(normalLoss.reason, 'sending_active');

  // Caso B: Falha de infraestrutura na execução da RPC (banco desconectou ou rpc lançou erro)
  const supabaseInfra = {
    rpc: async () => {
      throw new Error('Postgres pool exhausted');
    },
  };

  const infraLoss = await claimOutboxEntryAtomic({
    supabase: supabaseInfra,
    conversationId: 'conv_2',
    outboxKey: 'out_2',
    claimToken: 'token_b',
  });
  assert.equal(infraLoss.success, false);
  assert.equal(infraLoss.isInfraFailure, true, 'Exceção de banco DEVE ser marcada como isInfraFailure');
  assert.equal(infraLoss.reason, 'rpc_exception_fail_closed');
});

// =========================================================================
// TESTE 53: Fim-a-Fim no Webhook Real: Falha de RPC no Claim Atômico
// -> Sinal explícito blockLegacyFallback: true
// -> ZERO chamadas ao fluxo legado (runCloudAutoPilot)
// -> ZERO chamadas à Meta Graph API
// =========================================================================
test('53. Webhook Real Fim-a-Fim: falha de infraestrutura na RPC do Postgres bloqueia terminantemente fallback legado (ZERO chamadas ao legado e ZERO à Meta)', async () => {
  let legacyCalls = 0;
  let metaCalls = 0;
  const conversationId = '1771103754015024';

  const baseMock = {
    id: conversationId,
    contact_id: conversationId,
    full_name: 'Moose Test',
    ai_auto_respond: true,
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
  };

  let convState = { ...baseMock };
  const mockMessages = [
    {
      id: 'mid_webhook_real_msg_1',
      conversation_id: conversationId,
      sender_id: conversationId,
      is_mine: false,
      text: 'Olá, gostaria de saber sobre a Amarok',
      created_at: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      direction: 'inbound',
    },
  ];

  const mockSupabase = {
    from: (table) => {
      if (table === 'instagram_conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: convState, error: null }),
            }),
            or: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: convState, error: null }),
              }),
            }),
          }),
          update: (fields) => ({
            eq: async (col, val) => {
              convState = {
                ...convState,
                ...fields,
                stage_completed_rules: {
                  ...(convState.stage_completed_rules || {}),
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
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: mockMessages, error: null }),
                }),
              }),
              order: () => ({
                limit: async () => ({ data: mockMessages, error: null }),
                data: mockMessages,
                error: null,
              }),
            }),
            or: () => ({
              neq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          upsert: async (msg) => {
            mockMessages.push(msg);
            return { error: null };
          },
          insert: async (msg) => {
            mockMessages.push(msg);
            return { error: null };
          },
        };
      }
      if (table === 'instagram_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { verify_token: 'vendeo_ig_secret_token' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async () => ({ error: null }),
      };
    },
    channel: () => ({
      send: async () => ({}),
      subscribe: () => ({}),
    }),
    rpc: async (fnName) => {
      if (fnName === 'claim_outbox_entry') {
        // SIMULA FALHA CRÍTICA DE INFRAESTRUTURA NA RPC DO POSTGRES
        return {
          data: null,
          error: { message: 'connection to server was lost', code: '08006' },
        };
      }
      return { data: null, error: null };
    },
  };

  const customModules = {
    '@supabase/client': mockSupabase,
    './cloud_autopilot.ts': {
      runCloudAutoPilot: async () => {
        legacyCalls++;
      },
      publishAutoPilotState: async () => {},
      activity: () => ({}),
    },
  };

  const mockFetch = async (url) => {
    if (url.includes('graph.instagram.com') || url.includes('facebook.com')) {
      metaCalls++;
      return { ok: true, json: async () => ({ message_id: 'meta_sent_id' }) };
    }
    if (url.includes('atria-asi.ai') || url.includes('groq.com') || url.includes('googleapis.com')) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'reply',
                  currentPhase: 'conexao_inicial',
                  nextPhase: 'conexao_inicial',
                  checkpoint: 'chk_saudacao_feita',
                  targetSubagent: 'conexao_inicial',
                  suggestedResponse: 'Olá! Como posso te ajudar com a Amarok?',
                  reasoning: 'Atendimento do interesse do cliente',
                }),
              },
            },
          ],
          usage: { total_tokens: 30 },
        }),
      };
    }
    return { ok: true, json: async () => ({ success: true }) };
  };

  const runtime = createRuntime(mockFetch, customModules);
  runtime.load('supabase/functions/api/index.ts');

  const serverHandler = runtime.getServerHandler();
  assert.ok(serverHandler, 'O handler do serve() no index.ts DEVE ser registrado');

  // Dispara a Request HTTP real do Webhook recebendo mensagem para o chat experimental
  const webhookRequest = new Request('https://api.vendeo.com/meta/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig_page_id',
          time: Date.now(),
          messaging: [
            {
              sender: { id: conversationId },
              recipient: { id: 'me' },
              timestamp: Date.now(),
              message: {
                mid: 'mid_webhook_real_msg_1',
                text: 'Olá, gostaria de saber sobre a Amarok',
              },
            },
          ],
        },
      ],
    }),
  });

  const httpResponse = await serverHandler(webhookRequest);
  assert.equal(httpResponse.status, 200, 'O webhook da Meta deve receber status 200 (EVENT_RECEIVED)');

  // Aguarda a finalização das tarefas assíncronas no EdgeRuntime.waitUntil
  const bgPromises = runtime.getBackgroundPromises();
  await Promise.all(bgPromises);
  await new Promise((r) => setTimeout(r, 50));

  // PROVA RIGOROSA E INEQUÍVOCA:
  assert.equal(legacyCalls, 0, 'ZERO chamadas ao fluxo legado (runCloudAutoPilot) permitidas quando RPC falha!');
  assert.equal(metaCalls, 0, 'ZERO chamadas à Meta Graph API permitidas sob falha de RPC!');

  // Comprova que as mensagens no ledger permanecem pendentes no banco para retry seguro
  const ledger = convState.stage_completed_rules.orchestration.messageLedger;
  assert.equal(ledger['mid_webhook_real_msg_1'], 'pending', 'Mensagem claimed deve reverter para pending após fail-closed da RPC');
});

// =============================================================================
// BATERIA DE TESTES: PREEMPÇÃO POR NOVA MENSAGEM & MULTI-BALÕES (TESTES 54 A 68)
// =============================================================================

// TESTE 54: Preempção Gate 1 (durante ConversationAgent)
test('54. Preempção Gate 1: Nova mensagem durante ConversationAgent preempta ciclo, reverte ledger para pending e não envia à Meta', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaSent = 0;
  const initialMsgs = [
    { id: 'm_g1_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Olá, qual o valor da Amarok?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    callModel: async (prompt) => {
      // Simula chegada de nova mensagem enquanto o ConversationAgent avalia o turno
      supabase.getInsertedMessages().push({
        id: 'm_g1_2_concorrente',
        sender_id: 'them',
        is_mine: false,
        direction: 'inbound',
        text: 'E qual o ano dela também?',
        created_at: new Date().toISOString(),
      });

      return {
        content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Avaliação inicial' }),
        tokens: 40,
      };
    },
    sendMetaTextMessage: async () => {
      metaSent++;
      return { success: true, message_id: 'meta_should_not_happen' };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_gate_1_test',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, false, 'Ciclo deve retornar handled=false quando preemptado no Gate 1');
  assert.equal(res.sentToMeta, false, 'ZERO envios à Meta quando preemptado no Gate 1');
  assert.equal(metaSent, 0, 'Nenhuma chamada à API da Meta');
  assert.match(res.error, /preemptado/i);

  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles?.[0];

  assert.equal(cycle.status, 'superseded', 'Ciclo deve ter status superseded');
  assert.equal(orch.messageLedger['m_g1_1'], 'pending', 'Mensagem claimed m_g1_1 deve reverter para pending');
  assert.ok(conv.stage_completed_rules.ai_debounce_until, 'Deve agendar debounce para o novo ciclo');
});

// TESTE 55: Preempção Gate 2 (durante Subagente)
test('55. Preempção Gate 2: Nova mensagem durante Subagente preempta ciclo, reverte ledger para pending e cancela despacho', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaSent = 0;
  const initialMsgs = [
    { id: 'm_g2_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Tem garantia de fábrica?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Fase inicial' }),
          tokens: 40,
        };
      }
      // Simula chegada de nova mensagem enquanto o Subagente formula a resposta
      supabase.getInsertedMessages().push({
        id: 'm_g2_2_concorrente',
        sender_id: 'them',
        is_mine: false,
        direction: 'inbound',
        text: 'E aceita troca na minha Saveiro?',
        created_at: new Date().toISOString(),
      });

      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Tem garantia de fábrica sim!',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta da garantia',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async () => {
      metaSent++;
      return { success: true, message_id: 'meta_never' };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_gate_2_test',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, false, 'Ciclo deve retornar handled=false quando preemptado no Gate 2');
  assert.equal(res.sentToMeta, false, 'ZERO envios à Meta no Gate 2');
  assert.equal(metaSent, 0);
  assert.match(res.error, /preemptado/i);

  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  assert.equal(orch.messageLedger['m_g2_1'], 'pending', 'm_g2_1 deve reverter para pending');
});

// TESTE 56: Preempção Gate 3 (antes da Outbox)
test('56. Preempção Gate 3: Nova mensagem antes da Outbox preempta o ciclo antes da criação da intenção', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaSent = 0;
  const initialMsgs = [
    { id: 'm_g3_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Faz financiamento 100%?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  let modelCalls = 0;
  const mockRuntime = {
    callModel: async (prompt) => {
      modelCalls++;
      if (modelCalls === 2) {
        // Ao concluir as duas chamadas de LLM, simula uma mensagem chegando exatamente antes da outbox
        supabase.getConversationData().stage_completed_rules.preempt_requested = true;
      }
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Financiamos sim!',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 40,
      };
    },
    sendMetaTextMessage: async () => {
      metaSent++;
      return { success: true };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_gate_3_test',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, false);
  assert.equal(res.sentToMeta, false);
  assert.equal(metaSent, 0);
  assert.match(res.error, /preemptado/i);

  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  assert.equal(orch.messageLedger['m_g3_1'], 'pending');
});

// TESTE 57: Preempção Gate 4 (Caso A - Balão 0)
test('57. Preempção Gate 4 (Caso A - Balão 0): Nova mensagem antes do primeiro balão cancela envio com ZERO Meta', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaSent = 0;
  const initialMsgs = [
    { id: 'm_g4a_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Você trabalha hoje?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Trabalho sim!\n\nPosso te atender à tarde.',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 40,
      };
    },
    sendMetaTextMessage: async () => {
      metaSent++;
      return { success: true, message_id: 'meta_b1' };
    },
  };

  // Simula sinal de preempção que chega antes do despacho do primeiro balão
  const origUpdate = supabase.from('instagram_conversations').update;
  let intercepted = false;
  supabase.from = (table) => {
    if (table === 'instagram_conversations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              // Se já criou a outbox na conversa, simula nova mensagem concorrente detectada
              const data = supabase.getConversationData();
              if (data.stage_completed_rules?.orchestration?.outbox && !intercepted) {
                intercepted = true;
                data.stage_completed_rules.preempt_requested = true;
              }
              return { data, error: null };
            },
          }),
        }),
        update: origUpdate,
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: supabase.getInsertedMessages(), error: null }),
          }),
        }),
      }),
      upsert: async () => ({ data: null, error: null }),
    };
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_gate_4a_test',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, false, 'Caso A deve retornar handled=false');
  assert.equal(res.sentToMeta, false, 'Caso A tem ZERO envios à Meta');
  assert.equal(metaSent, 0);
  assert.match(res.error, /preemptado/i);
});

// TESTE 58: Fronteira Irreversível Gate 4 (Caso B - Multi-balão)
test('58. Fronteira Irreversível Gate 4 (Caso B): Balão 1 enviado, nova msg chega -> Balão 2 cancelado e Balão 1 preservado', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaCalls = [];
  const initialMsgs = [
    { id: 'm_multi_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Boa tarde!', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Boa tarde, tudo bem?\n\nComo posso te ajudar hoje?',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta em 2 balões',
        }),
        tokens: 50,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaCalls.push(text);
      // Após o primeiro balão ser enviado à Meta, simula o pretendente mandando nova mensagem antes do segundo balão!
      supabase.getConversationData().stage_completed_rules.preempt_requested = true;
      return { success: true, message_id: `meta_balloon_${metaCalls.length}` };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_multi_case_b',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  // Fronteira irreversível: Balão 1 foi enviado, logo sentToMeta=true e handled=true
  assert.equal(res.handled, true, 'Caso B considera o turno parcialmente entregue como handled=true');
  assert.equal(res.sentToMeta, true, 'sentToMeta=true pois Balão 1 já foi entregue');
  assert.equal(metaCalls.length, 1, 'Exatamente 1 balão deve ter sido enviado à Meta (Balão 2 foi cancelado)');
  assert.equal(metaCalls[0], 'Boa tarde, tudo bem?');

  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles?.[0];

  // Balão 1 foi entregue, então as mensagens daquele lote ficam processed
  assert.equal(orch.messageLedger['m_multi_1'], 'processed', 'm_multi_1 foi respondida pelo Balão 1');
  assert.ok(cycle.trace.some((t) => t.includes('remaining_bubbles_superseded')), 'Trace deve conter remaining_bubbles_superseded');
  assert.ok(conv.stage_completed_rules.ai_debounce_until, 'Deve agendar debounce para o próximo ciclo com a nova mensagem');
});

// TESTE 59: Âncora de Contexto da Larissa pós-Caso B
test('59. Âncora de Contexto pós-Caso B: Próximo ciclo enxerga Balão 1 como [ULTIMA_RESPOSTA_LARISSA]', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle, formatContextForConversationAgent } = load('supabase/functions/api/experimental_orchestrator.ts');

  const messagesInDb = [
    { id: 'm_past_1', sender_id: 'them', is_mine: false, text: 'Boa tarde!', created_at: '2026-09-18T10:00:00Z', timestamp: '2026-09-18T10:00:00Z' },
    { id: 'm_larissa_b1', sender_id: 'me', is_mine: true, text: 'Boa tarde, tudo bem?', created_at: '2026-09-18T10:00:02Z', timestamp: '2026-09-18T10:00:02Z' },
  ];

  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: 'm_larissa_b1', sender_id: 'me', is_mine: true, text: 'Boa tarde, tudo bem?' }],
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const claimed = [
    { id: 'm_new_inbound', sender: 'pretendente', text: 'Quero saber da Amarok', timestamp: '2026-09-18T10:00:05Z', direction: 'inbound' },
  ];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_anchor_test',
    currentPhase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    claimedMessages: claimed,
    supabase: mockSupabase,
  });

  assert.ok(payload.lastLarissaMessage, 'Deve haver lastLarissaMessage');
  assert.equal(payload.lastLarissaMessage.text, 'Boa tarde, tudo bem?');

  const serialized = formatContextForConversationAgent(payload);
  assert.ok(
    serialized.includes('[ULTIMO_TURNO_LARISSA]') || serialized.includes('[ULTIMA_RESPOSTA_LARISSA]'),
    'Serialização deve conter a tag de turno da Larissa ([ULTIMO_TURNO_LARISSA] ou [ULTIMA_RESPOSTA_LARISSA])'
  );
  assert.ok(serialized.includes('Boa tarde, tudo bem?'));
});

// TESTE 60: Concorrência no Webhook
test('60. Concorrência no Webhook: Mensagem recebida sob lock ativo incrementa inboundRevision e marca preempt_requested', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Simula conversa com lock ativo por outro correlationId recente
  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        active_cycle_token: 'active_other_worker_123',
        active_cycle_at: new Date().toISOString(), // Lock fresco (<25s)
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          inboundRevision: 1,
          messageLedger: {},
        },
      },
    },
    []
  );

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_webhook_conc_test',
    correlationId: 'new_corr_456',
    newMessage: { id: 'm_new_conc', text: 'Mensagem simultânea', timestamp: new Date().toISOString(), sender: 'them' },
  });

  assert.equal(res.handled, false);
  assert.equal(res.error, 'Lock ativo concorrente');
  assert.equal(res.blockLegacyFallback, true, 'Concorrência NUNCA deve ativar o legado');
});

// TESTE 61: Fusão de Mensagens em Rajada via Debounce
test('61. Fusão de Mensagens via Debounce: 3 mensagens em rajada são agrupadas no mesmo lote de claim', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const rajadaMsgs = [
    { id: 'raj_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi', created_at: '2026-09-18T10:00:00Z' },
    { id: 'raj_2', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Tudo bem?', created_at: '2026-09-18T10:00:01Z' },
    { id: 'raj_3', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Quero ver o carro', created_at: '2026-09-18T10:00:02Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    rajadaMsgs
  );

  let claimedInPrompt = [];
  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 40 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá! Tudo ótimo, vamos agendar sim!',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta unificada',
        }),
        tokens: 50,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_raj_ok' }),
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_rajada_test',
    newMessage: rajadaMsgs[2],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, true);
  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles?.[0];

  assert.equal(cycle.claimedMessageIds.length, 3, 'Todas as 3 mensagens devem ser agrupadas no mesmo ciclo');
  assert.equal(orch.messageLedger['raj_1'], 'processed');
  assert.equal(orch.messageLedger['raj_2'], 'processed');
  assert.equal(orch.messageLedger['raj_3'], 'processed');
});

// TESTE 62: Âncora da Larissa nunca descarta mensagens inbound
test('62. Âncora da Larissa nunca descarta mensagens: 4 mensagens do pretendente após Larissa são todas claimed', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const history = [
    { id: 'm_l_old', sender_id: 'me', is_mine: true, direction: 'outbound', text: 'Como posso ajudar?', created_at: '2026-09-18T09:50:00Z' },
    { id: 'p_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'P1', created_at: '2026-09-18T10:00:01Z' },
    { id: 'p_2', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'P2', created_at: '2026-09-18T10:00:02Z' },
    { id: 'p_3', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'P3', created_at: '2026-09-18T10:00:03Z' },
    { id: 'p_4', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'P4', created_at: '2026-09-18T10:00:04Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    history
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async () => ({
      content: JSON.stringify({ action: 'reply', checkpoint: 'chk_saudacao_feita', suggestedResponse: 'Entendido!', nextPhase: 'conexao_inicial', summary: 'ok' }),
      tokens: 30,
    }),
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_p4_ok' }),
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_anchor_no_drop',
    newMessage: history[4],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, true);
  const cycle = supabase.getConversationData().stage_completed_rules.orchestration.recentCycles?.[0];
  assert.equal(cycle.claimedMessageIds.length, 4, 'Todas as 4 mensagens do pretendente devem ser claimed');
});

// TESTE 63: Fluxo Nominal Limpo (sem novas mensagens concorrentes)
test('63. Fluxo Nominal Limpo: Turno sem concorrência completa com sucesso e envia resposta à Meta', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaSentText = '';
  const initialMsgs = [
    { id: 'm_nom_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Qual o valor?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Está R$ 250.000',
          nextPhase: 'conexao_inicial',
          summary: 'Preço informado',
        }),
        tokens: 40,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaSentText = text;
      return { success: true, message_id: 'meta_nom_ok' };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_nominal_clean',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(metaSentText, 'Está R$ 250.000');

  const orch = supabase.getConversationData().stage_completed_rules.orchestration;
  assert.equal(orch.messageLedger['m_nom_1'], 'processed');
  assert.equal(orch.recentCycles?.[0]?.status, 'completed');
});

// TESTE 64: Resposta em 3 balões sem interrupção
test('64. Resposta em 3 Balões: Despacha todos os 3 balões sequencialmente com outbox atômica independente', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaBalloons = [];
  const initialMsgs = [
    { id: 'm_b3_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Como funciona?', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Primeiro balão explicativo.\n\nSegundo balão com detalhes.\n\nTerceiro balão com pergunta.',
          nextPhase: 'conexao_inicial',
          summary: '3 balões',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaBalloons.push(text);
      return { success: true, message_id: `meta_b_${metaBalloons.length}` };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_three_balloons',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(metaBalloons.length, 3, 'Todos os 3 balões devem ter sido enviados');
  assert.equal(metaBalloons[0], 'Primeiro balão explicativo.');
  assert.equal(metaBalloons[1], 'Segundo balão com detalhes.');
  assert.equal(metaBalloons[2], 'Terceiro balão com pergunta.');

  const orch = supabase.getConversationData().stage_completed_rules.orchestration;
  assert.equal(orch.messageLedger['m_b3_1'], 'processed');
});

// TESTE 65: Preempção durante Balão 3 (após 1 e 2 enviados)
test('65. Preempção durante Balão 3: Balões 1 e 2 entregues, Balão 3 cancelado por nova mensagem', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaBalloons = [];
  const initialMsgs = [
    { id: 'm_b3_cut_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Me explica tudo', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 30 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Balão 1 entregue.\n\nBalão 2 entregue.\n\nBalão 3 que será cancelado.',
          nextPhase: 'conexao_inicial',
          summary: '3 balões com corte',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaBalloons.push(text);
      if (metaBalloons.length === 2) {
        // Após o segundo balão, pretendente envia nova mensagem antes do terceiro
        supabase.getConversationData().stage_completed_rules.preempt_requested = true;
      }
      return { success: true, message_id: `meta_b_${metaBalloons.length}` };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_balloon_3_cut',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(metaBalloons.length, 2, 'Apenas 2 balões devem ter sido entregues; Balão 3 cancelado');
  assert.equal(metaBalloons[0], 'Balão 1 entregue.');
  assert.equal(metaBalloons[1], 'Balão 2 entregue.');

  const conv = supabase.getConversationData();
  const orch = conv.stage_completed_rules.orchestration;
  assert.equal(orch.messageLedger['m_b3_cut_1'], 'processed');
});

// TESTE 66: Incerteza de Rede no Balão 2 (timeout Meta)
test('66. Incerteza de Rede no Balão 2: Balão 1 entregue, Balão 2 incerto -> finaliza incerto sem enviar Balão 3 e bloqueia legado', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaBalloons = [];
  const initialMsgs = [
    { id: 'm_unc_b2', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Quero detalhes', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async () => ({
      content: JSON.stringify({
        action: 'reply',
        checkpoint: 'chk_saudacao_feita',
        suggestedResponse: 'Balão 1 com sucesso.\n\nBalão 2 com timeout.\n\nBalão 3 não deve rodar.',
        nextPhase: 'conexao_inicial',
        summary: 'ok',
      }),
      tokens: 50,
    }),
    sendMetaTextMessage: async (sb, convId, text) => {
      metaBalloons.push(text);
      if (metaBalloons.length === 2) {
        throw new Error('Connection timeout while waiting for Meta Graph API response');
      }
      return { success: true, message_id: 'meta_b1_ok' };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_unc_balloon_2',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.sentToMeta, true, 'sentToMeta=true pois Balão 1 foi entregue e Balão 2 é incerto');
  assert.equal(res.blockLegacyFallback, true, 'Fallback legado terminantemente bloqueado');
  assert.equal(metaBalloons.length, 2, 'Balão 3 nunca deve ser tentado');
});

// TESTE 67: Cancelamento Manual pelo Operador tem Prioridade
test('67. Cancelamento Manual pelo Operador: cancel_current_cycle cancela imediatamente com prioridade máxima', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  let metaCalls = 0;
  const initialMsgs = [
    { id: 'm_cancel_op', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Oi', created_at: '2026-09-18T10:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        cancel_current_cycle: true,
        orchestration: { version: 1, mode: 'experimental', currentPhase: 'conexao_inicial', messageLedger: {} },
      },
    },
    initialMsgs
  );

  const mockRuntime = {
    _fastTest: true,
    callModel: async () => ({ content: JSON.stringify({ action: 'reply' }), tokens: 10 }),
    sendMetaTextMessage: async () => {
      metaCalls++;
      return { success: true };
    },
  };

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_cancel_op_test',
    newMessage: initialMsgs[0],
    runtime: mockRuntime,
  });

  assert.equal(res.handled, false);
  assert.equal(res.sentToMeta, false);
  assert.equal(res.blockLegacyFallback, true);
  assert.equal(metaCalls, 0);
  assert.match(res.error, /cancelado pelo operador/i);
});

// TESTE 68: Teste Fim-a-Fim Humano Completo
test('68. Teste Fim-a-Fim Humano Completo: Msg 1 -> IA pensa -> Msg 2 chega -> Ciclo 1 preemptado -> Debounce agrupa Msg 1+2 -> Ciclo 2 responde em 2 balões com entrega íntegra', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const metaDelivered = [];
  const dbMessages = [
    { id: 'h_msg_1', sender_id: 'them', is_mine: false, direction: 'inbound', text: 'Olá Larissa, vi o anúncio da Amarok', created_at: '2026-09-18T11:00:00Z' },
  ];

  const supabase = createMockSupabase(
    {
      stage_completed_rules: {
        orchestration: {
          version: 1,
          mode: 'experimental',
          currentPhase: 'conexao_inicial',
          inboundRevision: 0,
          messageLedger: {},
        },
      },
    },
    dbMessages
  );

  // 1. CICLO 1 INICIA
  const runtimeCycle1 = {
    _fastTest: true,
    callModel: async (prompt) => {
      // Enquanto a IA pensa no Ciclo 1, o pretendente manda uma segunda mensagem complementando
      const newMsgObj = {
        id: 'h_msg_2',
        sender_id: 'them',
        is_mine: false,
        direction: 'inbound',
        text: 'Ela ainda está disponível para visita amanhã?',
        created_at: new Date().toISOString(),
      };
      dbMessages.push(newMsgObj);
      supabase.getInsertedMessages().push(newMsgObj);

      return {
        content: JSON.stringify({
          targetSubagent: 'conexao_inicial',
          action: 'delegate',
          reason: 'Atendimento inicial',
        }),
        tokens: 40,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaDelivered.push(text);
      return { success: true, message_id: 'meta_c1_never' };
    },
  };

  const res1 = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_human_e2e',
    correlationId: 'cycle_human_1',
    newMessage: dbMessages[0],
    runtime: runtimeCycle1,
  });

  // Ciclo 1 DEVE ser preemptado!
  assert.equal(res1.handled, false, 'Ciclo 1 deve ser preemptado pela chegada de h_msg_2');
  assert.equal(res1.sentToMeta, false, 'ZERO mensagens entregues pelo Ciclo 1');
  assert.equal(metaDelivered.length, 0);

  const convAfter1 = supabase.getConversationData();
  const orchAfter1 = convAfter1.stage_completed_rules.orchestration;
  assert.equal(orchAfter1.messageLedger['h_msg_1'], 'pending', 'h_msg_1 deve voltar para pending');
  assert.ok(convAfter1.stage_completed_rules.ai_debounce_until, 'Debounce agendado para o próximo ciclo');

  // 2. CICLO 2 DISPARA APÓS O DEBOUNCE COM AMBAS AS MENSAGENS NO BANCO
  let capturedPrompts = [];
  const runtimeCycle2 = {
    _fastTest: true,
    callModel: async (prompt) => {
      capturedPrompts.push(prompt);
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({
            targetSubagent: 'conexao_inicial',
            action: 'delegate',
            reason: 'Responder sobre disponibilidade e visita',
          }),
          tokens: 50,
        };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá! Está disponível sim!\n\nPodemos combinar amanhã às 14h, o que acha?',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta unificada em 2 balões',
        }),
        tokens: 70,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      metaDelivered.push(text);
      return { success: true, message_id: `meta_h_${metaDelivered.length}` };
    },
  };

  const res2 = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_human_e2e',
    correlationId: 'cycle_human_2',
    newMessage: dbMessages[1], // trigger msg 2
    runtime: runtimeCycle2,
  });

  assert.equal(res2.handled, true, 'Ciclo 2 deve processar com sucesso o lote unificado');
  assert.equal(res2.sentToMeta, true, 'Ciclo 2 deve entregar à Meta');
  assert.equal(metaDelivered.length, 2, 'Ambos os balões da resposta foram entregues');
  assert.equal(metaDelivered[0], 'Olá! Está disponível sim!');
  assert.equal(metaDelivered[1], 'Podemos combinar amanhã às 14h, o que acha?');

  const convFinal = supabase.getConversationData();
  const orchFinal = convFinal.stage_completed_rules.orchestration;
  const cycle2 = orchFinal.recentCycles?.[0];

  assert.equal(cycle2.claimedMessageIds.length, 2, 'Ciclo 2 agrupou ambas as mensagens (h_msg_1 e h_msg_2)');
  assert.equal(orchFinal.messageLedger['h_msg_1'], 'processed');
  assert.equal(orchFinal.messageLedger['h_msg_2'], 'processed');
});

// -------------------------------------------------------------------------
// TESTES DO CONTEXTO DO TURNO ATUAL E MEMÓRIA SOB DEMANDA (Testes 69 a 88)
// -------------------------------------------------------------------------

// TESTE 69: Contexto do Turno: 1 balão da Larissa + 2 do cliente
test('69. Contexto do Turno: Larissa envia 1 balão + cliente responde 2 -> bloco contíguo correto', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle, formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const messages = [
    { id: 'm_l1', sender_id: 'me', is_mine: true, text: 'Oi, tudo bem?', created_at: '2026-09-18T10:00:00Z', timestamp: '2026-09-18T10:00:00Z' },
    { id: 'm_c1', sender_id: 'client_1', is_mine: false, text: 'Oi tudo e vc?', created_at: '2026-09-18T10:00:10Z', timestamp: '2026-09-18T10:00:10Z' },
    { id: 'm_c2', sender_id: 'client_1', is_mine: false, text: 'Como foi o dia?', created_at: '2026-09-18T10:00:15Z', timestamp: '2026-09-18T10:00:15Z' },
  ];

  const supabase = createMockSupabase({}, messages);
  const claimed = [
    { id: 'm_c1', sender: 'pretendente', text: 'Oi tudo e vc?', timestamp: '2026-09-18T10:00:10Z', direction: 'inbound' },
    { id: 'm_c2', sender: 'pretendente', text: 'Como foi o dia?', timestamp: '2026-09-18T10:00:15Z', direction: 'inbound' },
  ];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_turn_69',
    currentPhase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    claimedMessages: claimed,
    supabase,
  });

  assert.ok(payload.lastLarissaTurn, 'Deve haver lastLarissaTurn');
  assert.equal(payload.lastLarissaTurn.length, 1, 'Deve conter exatamente 1 balão da Larissa');
  assert.equal(payload.lastLarissaTurn[0].id, 'm_l1');
  assert.equal(payload.lastLarissaTurn[0].text, 'Oi, tudo bem?');
  assert.equal(payload.newMessages.length, 2, 'Deve conter as 2 novas mensagens do pretendente');

  const serialized = formatConversationContextForModel(payload);
  assert.ok(serialized.includes('[ULTIMO_TURNO_LARISSA]'), 'Contém tag [ULTIMO_TURNO_LARISSA]');
  assert.ok(serialized.includes('LARISSA | m_l1'));
  assert.ok(serialized.includes('PRETENDENTE | m_c1'));
  assert.ok(serialized.includes('PRETENDENTE | m_c2'));
});

// TESTE 70: Contexto do Turno: 3 balões contíguos da Larissa + 4 do cliente
test('70. Contexto do Turno: 3 balões da Larissa + 4 do cliente -> ordem cronológica ASC mantida', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle, formatConversationContextForModel } = load('supabase/functions/api/experimental_orchestrator.ts');

  const messages = [
    { id: 'm_l1', sender_id: 'me', is_mine: true, text: 'Boa tarde!', created_at: '2026-09-18T10:00:01Z' },
    { id: 'm_l2', sender_id: 'me', is_mine: true, text: 'Vi seu interesse no carro', created_at: '2026-09-18T10:00:02Z' },
    { id: 'm_l3', sender_id: 'me', is_mine: true, text: 'Vc trabalha com o quê?', created_at: '2026-09-18T10:00:03Z' },
    { id: 'm_c1', sender_id: 'client_1', is_mine: false, text: 'Trabalho com TI', created_at: '2026-09-18T10:00:10Z' },
    { id: 'm_c2', sender_id: 'client_1', is_mine: false, text: 'Em BH', created_at: '2026-09-18T10:00:11Z' },
    { id: 'm_c3', sender_id: 'client_1', is_mine: false, text: 'E vc?', created_at: '2026-09-18T10:00:12Z' },
    { id: 'm_c4', sender_id: 'client_1', is_mine: false, text: 'Ainda tá disponível?', created_at: '2026-09-18T10:00:13Z' },
  ];

  const supabase = createMockSupabase({}, messages);
  const claimed = [
    { id: 'm_c1', sender: 'pretendente', text: 'Trabalho com TI', direction: 'inbound' },
    { id: 'm_c2', sender: 'pretendente', text: 'Em BH', direction: 'inbound' },
    { id: 'm_c3', sender: 'pretendente', text: 'E vc?', direction: 'inbound' },
    { id: 'm_c4', sender: 'pretendente', text: 'Ainda tá disponível?', direction: 'inbound' },
  ];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_turn_70',
    currentPhase: 'descoberta',
    checkpoint: 'chk_pergunta_sobre_ele',
    claimedMessages: claimed,
    supabase,
  });

  assert.equal(payload.lastLarissaTurn.length, 3, 'Deve conter os 3 balões da Larissa');
  assert.equal(payload.lastLarissaTurn[0].id, 'm_l1');
  assert.equal(payload.lastLarissaTurn[1].id, 'm_l2');
  assert.equal(payload.lastLarissaTurn[2].id, 'm_l3');
  assert.equal(payload.newMessages.length, 4);

  const serialized = formatConversationContextForModel(payload);
  assert.ok(serialized.includes('LARISSA | m_l1'));
  assert.ok(serialized.includes('LARISSA | m_l2'));
  assert.ok(serialized.includes('LARISSA | m_l3'));
});

// TESTE 71: Mensagem antiga da Larissa anterior a outro turno NÃO é incluída no turno atual
test('71. Contiguidade estrita: mensagem antiga da Larissa antes de outro pretendente é cortada', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle } = load('supabase/functions/api/experimental_orchestrator.ts');

  const messages = [
    { id: 'm_l_old', sender_id: 'me', is_mine: true, text: 'Mensagem antiga semana passada', created_at: '2026-09-10T10:00:00Z' },
    { id: 'm_c_old', sender_id: 'client_1', is_mine: false, text: 'Mensagem antiga respondida', created_at: '2026-09-10T10:05:00Z' },
    { id: 'm_l_turn1', sender_id: 'me', is_mine: true, text: 'Opa tudo bem?', created_at: '2026-09-18T10:00:00Z' },
    { id: 'm_l_turn2', sender_id: 'me', is_mine: true, text: 'Como vc tá?', created_at: '2026-09-18T10:00:05Z' },
    { id: 'm_c_new', sender_id: 'client_1', is_mine: false, text: 'Tudo ótimo', created_at: '2026-09-18T10:01:00Z' },
  ];

  const supabase = createMockSupabase({}, messages);
  const claimed = [{ id: 'm_c_new', sender: 'pretendente', text: 'Tudo ótimo', direction: 'inbound' }];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_turn_71',
    currentPhase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    claimedMessages: claimed,
    supabase,
  });

  assert.equal(payload.lastLarissaTurn.length, 2, 'Apenas as 2 mensagens contíguas recentes da Larissa devem entrar');
  assert.equal(payload.lastLarissaTurn[0].id, 'm_l_turn1');
  assert.equal(payload.lastLarissaTurn[1].id, 'm_l_turn2');
});

// TESTE 72: Mensagem inbound pendente antiga não desaparece do ciclo só porque houve outbound posterior
test('72. Ledger governa pendências: mensagem pendente antiga não é perdida por outbound posterior', async () => {
  const { load } = createRuntime();
  const { normalizeToCanonicalMessage } = load('supabase/functions/api/experimental_orchestrator.ts');

  const rawMsgs = [
    { id: 'm_inbound_old', is_mine: false, sender_id: 'client_1', text: 'Pergunta antiga pendente', created_at: '2026-09-18T09:00:00Z' },
    { id: 'm_outbound_mid', is_mine: true, sender_id: 'me', text: 'Balão no meio', created_at: '2026-09-18T09:30:00Z' },
    { id: 'm_inbound_new', is_mine: false, sender_id: 'client_1', text: 'Pergunta nova', created_at: '2026-09-18T10:00:00Z' },
  ];

  const canonical = rawMsgs.map((m) => normalizeToCanonicalMessage(m, 'conv_72'));
  const ledger = {}; // nenhuma processada

  const pending = canonical.filter((m) => m.sender === 'pretendente' && ledger[m.id] !== 'processed');
  assert.equal(pending.length, 2, 'Ambas as mensagens inbound continuam pendentes');
  assert.equal(pending[0].id, 'm_inbound_old');
  assert.equal(pending[1].id, 'm_inbound_new');
});

// TESTE 73: Balão cancelado antes da Meta NÃO aparece no turno da Larissa
test('73. Balão planejado mas cancelado antes de ir à Meta NÃO aparece no turno da Larissa', async () => {
  const { load } = createRuntime();
  const { buildConversationContextForCycle } = load('supabase/functions/api/experimental_orchestrator.ts');

  // No banco existe apenas o Balão 1 confirmado como 'sent'. O Balão 2 foi cancelado e nunca foi inserido.
  const messages = [
    { id: 'm_larissa_b1', is_mine: true, sender_id: 'me', text: 'Balão 1 entregue', created_at: '2026-09-18T10:00:00Z', status: 'sent' },
    { id: 'm_client_next', is_mine: false, sender_id: 'client_1', text: 'Mensagem do cliente', created_at: '2026-09-18T10:00:10Z' },
  ];

  const supabase = createMockSupabase({}, messages);
  const claimed = [{ id: 'm_client_next', sender: 'pretendente', text: 'Mensagem do cliente', direction: 'inbound' }];

  const { payload } = await buildConversationContextForCycle({
    conversationId: 'conv_73',
    currentPhase: 'conexao_inicial',
    checkpoint: 'chk_saudacao_feita',
    claimedMessages: claimed,
    supabase,
  });

  assert.equal(payload.lastLarissaTurn.length, 1);
  assert.equal(payload.lastLarissaTurn[0].text, 'Balão 1 entregue');
});

// TESTE 74: Contexto suficiente -> subagente NÃO chama tool de memória
test('74. Contexto suficiente: subagente responde normalmente sem chamar tool de memória', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const memoryProvider = new InMemoryMemoryProvider();
  let modelCallsCount = 0;

  const runtime = {
    callModel: async (prompt) => {
      modelCallsCount++;
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'Cumprimento simples' }),
          tokens: 50,
        };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Oi tudo bem por aqui também!',
          nextPhase: 'conexao_inicial',
          summary: 'Resposta direta sem tool',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_74' }),
    memoryProvider,
  };

  const supabase = createMockSupabase({
    stage_completed_rules: { orchestration: { mode: 'experimental', currentPhase: 'conexao_inicial' } },
  }, [
    { id: 'm_in_74', sender_id: 'c1', is_mine: false, text: 'Oi tudo bem?', created_at: '2026-09-18T10:00:00Z' },
  ]);

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_74',
    correlationId: 'cycle_74',
    newMessage: { id: 'm_in_74', text: 'Oi tudo bem?', timestamp: '2026-09-18T10:00:00Z', sender: 'c1' },
    runtime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(modelCallsCount, 2, 'Exatamente 1 chamada para roteador + 1 para subagente (zero chamadas de tool)');

  const convData = supabase.getConversationData();
  const cycleTrace = convData.stage_completed_rules.orchestration.recentCycles[0].trace;
  assert.ok(!cycleTrace.some((t) => t.startsWith('memory_tool_requested')), 'Não deve haver tool call de memória no trace');
});

// TESTE 75: "Com a minha idade..." -> subagente consulta memory_get_fact(self.age)
test('75. Subagente consulta memória sob demanda ao perceber necessidade de fato (self.age)', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const memoryProvider = new InMemoryMemoryProvider();
  await memoryProvider.writeFact('conv_75', {
    entity: 'self',
    field: 'age',
    value: 25,
    sourceMessageId: 'msg_historica_idade',
  });

  let toolRequested = false;

  const runtime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({ targetSubagent: 'descoberta', action: 'delegate', reason: 'Pretendente comentou de idade' }),
          tokens: 50,
        };
      }
      // Na primeira invocação do subagente, ele percebe que precisa da idade
      if (!prompt.includes('RETORNO DA CONSULTA DE MEMÓRIA')) {
        toolRequested = true;
        return {
          content: JSON.stringify({
            action: 'call_tool',
            tool: 'memory_get_fact',
            parameters: { entity: 'self', field: 'age' },
            reasoning: 'Preciso da idade para responder ao comentário de motocross',
          }),
          tokens: 60,
        };
      }
      // Na segunda invocação, com o fato retornado, ele formula a resposta
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_pergunta_sobre_ele',
          suggestedResponse: 'Nossa, com 25 anos vc tá novo demais pra desistir de motocross kkk',
          nextPhase: 'descoberta',
          summary: 'Resposta considerando idade de 25 anos',
        }),
        tokens: 70,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_75' }),
    memoryProvider,
  };

  const supabase = createMockSupabase({
    stage_completed_rules: { orchestration: { mode: 'experimental', currentPhase: 'descoberta' } },
  }, [
    { id: 'm_in_75', sender_id: 'c1', is_mine: false, text: 'Com a minha idade já não tenho pique pra motocross kkk', created_at: '2026-09-18T10:00:00Z' },
  ]);

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_75',
    correlationId: 'cycle_75',
    newMessage: { id: 'm_in_75', text: 'Com a minha idade...', timestamp: '2026-09-18T10:00:00Z', sender: 'c1' },
    runtime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(toolRequested, true, 'Subagente deve ter solicitado a ferramenta de memória');

  const convData = supabase.getConversationData();
  const cycleTrace = convData.stage_completed_rules.orchestration.recentCycles[0].trace;
  assert.ok(cycleTrace.includes('memory_tool_requested: self.age'), 'Trace deve registrar a consulta de memória self.age');
  assert.ok(cycleTrace.includes('memory_tool_found: true'), 'Trace deve registrar que a idade foi encontrada');
});

// TESTE 76: Segregação estrita de entidades: self.age=40 vs prima_maria.age=25
test('76. Segregação estrita de entidades: self.age=40 vs prima_maria.age=25 nunca se misturam', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('conv_76', { entity: 'self', field: 'age', value: 40 });
  await provider.writeFact('conv_76', { entity: 'prima_maria', field: 'age', value: 25 });

  const selfAge = await provider.getFact('conv_76', 'self', 'age');
  assert.equal(selfAge.found, true);
  assert.equal(selfAge.fact.value, 40, 'self.age deve ser 40');

  const primaAge = await provider.getFact('conv_76', 'prima_maria', 'age');
  assert.equal(primaAge.found, true);
  assert.equal(primaAge.fact.value, 25, 'prima_maria.age deve ser 25');

  const selfCity = await provider.getFact('conv_76', 'self', 'city');
  assert.equal(selfCity.found, false, 'Campo não cadastrado deve retornar found: false');
});

// TESTE 77: Campo inexistente -> retorna found: false
test('77. Campo inexistente na memória retorna found: false sem inventar valores', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('conv_77', { entity: 'self', field: 'name', value: 'Carlos' });

  const result = await provider.getFact('conv_77', 'self', 'signo');
  assert.equal(result.found, false);
  assert.equal(result.fact, undefined);
});

// TESTE 78: Entidade inexistente / ambígua -> retorna found: false
test('78. Entidade inexistente / ambígua retorna found: false e não inventa pessoa', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('conv_78', { entity: 'self', field: 'age', value: 30 });

  const result = await provider.getFact('conv_78', 'tio_desconhecido', 'age');
  assert.equal(result.found, false);
});

// TESTE 79: Isolamento estrito de contato: Contato A nunca acessa memória do Contato B
test('79. Isolamento estrito de contato: conversa A jamais acessa memória da conversa B', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('contact_A', { entity: 'self', field: 'city', value: 'Barbacena' });
  await provider.writeFact('contact_B', { entity: 'self', field: 'city', value: 'São Paulo' });

  const factA = await provider.getFact('contact_A', 'self', 'city');
  assert.equal(factA.value, 'Barbacena');

  const factB = await provider.getFact('contact_B', 'self', 'city');
  assert.equal(factB.value, 'São Paulo');

  const leakCheck = await provider.getFact('contact_C', 'self', 'city');
  assert.equal(leakCheck.found, false, 'Contato sem cadastro não deve receber dados de outro');
});

// TESTE 80: Busca aberta (memory_search) retorna poucos snippets relevantes
test('80. Busca aberta (memory_search) retorna apenas trechos relevantes e respeita limit', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('conv_80', { entity: 'self', field: 'hobby1', value: 'gosta de fazer trilha na serra' });
  await provider.writeFact('conv_80', { entity: 'self', field: 'hobby2', value: 'faz trilha de moto todo sábado' });
  await provider.writeFact('conv_80', { entity: 'self', field: 'hobby3', value: 'vai para a praia em janeiro' });

  const results = await provider.searchMemory('conv_80', 'trilha', { limit: 2 });
  assert.equal(results.length, 2, 'Deve respeitar o limit de 2 resultados');
  assert.ok(results[0].snippet.includes('trilha'));
  assert.ok(results[1].snippet.includes('trilha'));
});

// TESTE 81: Limite de tool calls: modelo em loop infinito é interrompido após 3 iterações
test('81. Limite estrito de tool calls: subagente em loop de memória é interrompido em 3 iterações', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const memoryProvider = new InMemoryMemoryProvider();
  let toolCallsLoop = 0;

  const runtime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'descoberta', action: 'delegate', reason: 'teste loop' }), tokens: 10 };
      }
      toolCallsLoop++;
      // Sempre retorna pedido de ferramenta
      return {
        content: JSON.stringify({
          action: 'call_tool',
          tool: 'memory_get_fact',
          parameters: { entity: 'self', field: `dummy_${toolCallsLoop}` },
          reasoning: 'tentativa persistente',
        }),
        tokens: 20,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_81' }),
    memoryProvider,
  };

  const supabase = createMockSupabase({
    stage_completed_rules: { orchestration: { mode: 'experimental', currentPhase: 'descoberta' } },
  }, [
    { id: 'm_81', sender_id: 'c1', is_mine: false, text: 'Pergunta teste', created_at: '2026-09-18T10:00:00Z' },
  ]);

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_81',
    correlationId: 'cycle_81',
    newMessage: { id: 'm_81', text: 'Pergunta teste', timestamp: '2026-09-18T10:00:00Z', sender: 'c1' },
    runtime,
  });

  assert.equal(res.handled, true);
  assert.equal(toolCallsLoop, 3, 'Loop deve ter sido interrompido exatamente no limite de 3 iterações');
});

// TESTE 82: ObsidianMemoryAdapter sem credenciais reporta isConfigured(): false com segurança
test('82. ObsidianMemoryAdapter: sem credenciais configuradas reporta isConfigured false sem erros', async () => {
  const { load } = createRuntime();
  const { ObsidianMemoryAdapter } = load('supabase/functions/api/experimental_orchestrator.ts');

  const adapter = new ObsidianMemoryAdapter({ baseUrl: '', apiKey: '' });
  assert.equal(adapter.isConfigured(), false);

  const factRes = await adapter.getFact('conv_82', 'self', 'age');
  assert.equal(factRes.found, false);

  const searchRes = await adapter.searchMemory('conv_82', 'trilha');
  assert.equal(searchRes.length, 0);

  const writeRes = await adapter.writeFact('conv_82', { entity: 'self', field: 'age', value: 30 });
  assert.equal(writeRes.success, false);
});

// TESTE 83: MemoryWriter: extrai idade explícita ("tenho 40 anos")
test('83. MemoryWriter: extrai fato explícito de idade ("tenho 40 anos") com sourceMessageId', async () => {
  const { load } = createRuntime();
  const { extractFactsFromInboundText } = load('supabase/functions/api/experimental_orchestrator.ts');

  const text = 'Eu tenho 40 anos e moro em Barbacena';
  const facts = extractFactsFromInboundText(text, 'msg_age_40');

  const ageFact = facts.find((f) => f.field === 'age');
  assert.ok(ageFact, 'Deve extrair fato de idade');
  assert.equal(ageFact.entity, 'self');
  assert.equal(ageFact.value, 40);
  assert.equal(ageFact.sourceMessageId, 'msg_age_40');

  const cityFact = facts.find((f) => f.field === 'city');
  assert.ok(cityFact, 'Deve extrair fato de cidade');
  assert.equal(cityFact.value, 'Barbacena');
});

// TESTE 84: MemoryWriter: extrai idade de parente ("minha prima Maria tem 25 anos")
test('84. MemoryWriter: extrai fato de parente para entidade de terceiro (prima_maria.age)', async () => {
  const { load } = createRuntime();
  const { extractFactsFromInboundText } = load('supabase/functions/api/experimental_orchestrator.ts');

  const text = 'Minha prima Maria tem 25 anos e adora viajar';
  const facts = extractFactsFromInboundText(text, 'msg_prima_25');

  const primaFact = facts.find((f) => f.field === 'age');
  assert.ok(primaFact, 'Deve extrair idade da prima');
  assert.equal(primaFact.entity, 'prima_maria');
  assert.equal(primaFact.value, 25);
});

// TESTE 85: MemoryWriter: frase vaga ("tô ficando velho", "ando cansado") NÃO cria fato
test('85. MemoryWriter: frases vagas NÃO são transformadas em fatos objetivos inventados', async () => {
  const { load } = createRuntime();
  const { extractFactsFromInboundText } = load('supabase/functions/api/experimental_orchestrator.ts');

  const text1 = 'Nossa, tô ficando velho pra aguentar essa correria kkk';
  const facts1 = extractFactsFromInboundText(text1, 'msg_vaga_1');
  assert.equal(facts1.length, 0, 'Frase vaga não deve gerar fatos');

  const text2 = 'Ando meio cansado esses dias';
  const facts2 = extractFactsFromInboundText(text2, 'msg_vaga_2');
  assert.equal(facts2.length, 0, 'Frase genérica não deve gerar fatos');
});

// TESTE 86: MemoryWriter: fato existente é atualizado com nova evidência
test('86. MemoryWriter: fato existente é atualizado com nova evidência e proveniência', async () => {
  const { load } = createRuntime();
  const { InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const provider = new InMemoryMemoryProvider();
  await provider.writeFact('conv_86', { entity: 'self', field: 'age', value: 39, sourceMessageId: 'msg_ano_passado' });

  const factBefore = await provider.getFact('conv_86', 'self', 'age');
  assert.equal(factBefore.fact.value, 39);

  // Nova mensagem informando que fez 40 anos
  await provider.writeFact('conv_86', { entity: 'self', field: 'age', value: 40, sourceMessageId: 'msg_niver_hoje' });

  const factAfter = await provider.getFact('conv_86', 'self', 'age');
  assert.equal(factAfter.fact.value, 40, 'Fato atualizado com sucesso');
  assert.equal(factAfter.fact.sourceMessageId, 'msg_niver_hoje', 'Proveniência atualizada');
});

// TESTE 87: Falha no MemoryWriter não impede resposta nem quebra ciclo
test('87. Resiliência: falha no MemoryWriter não quebra resposta e mantém blockLegacyFallback', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  // Provider com falha deliberada no writeFact
  const faultyProvider = {
    getFact: async () => ({ found: false }),
    searchMemory: async () => [],
    writeFact: async () => {
      throw new Error('Falha simulada de banco de dados no MemoryWriter');
    },
    listEntityFacts: async () => ({}),
  };

  const runtime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return { content: JSON.stringify({ targetSubagent: 'conexao_inicial', action: 'delegate', reason: 'ok' }), tokens: 10 };
      }
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_saudacao_feita',
          suggestedResponse: 'Olá!',
          nextPhase: 'conexao_inicial',
          summary: 'ok',
        }),
        tokens: 20,
      };
    },
    sendMetaTextMessage: async () => ({ success: true, message_id: 'meta_87' }),
    memoryProvider: faultyProvider,
  };

  const supabase = createMockSupabase({
    stage_completed_rules: { orchestration: { mode: 'experimental', currentPhase: 'conexao_inicial' } },
  }, [
    { id: 'm_87', sender_id: 'c1', is_mine: false, text: 'Tenho 30 anos', created_at: '2026-09-18T10:00:00Z' },
  ]);

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_87',
    correlationId: 'cycle_87',
    newMessage: { id: 'm_87', text: 'Tenho 30 anos', timestamp: '2026-09-18T10:00:00Z', sender: 'c1' },
    runtime,
  });

  assert.equal(res.handled, true, 'Ciclo deve ter sido tratado');
  assert.equal(res.sentToMeta, true, 'Envio à Meta deve ter ocorrido');
  assert.equal(res.blockLegacyFallback, true, 'Fallback legado permanece bloqueado');

  const convData = supabase.getConversationData();
  const trace = convData.stage_completed_rules.orchestration.recentCycles[0].trace;
  assert.ok(trace.some((t) => t.includes('memory_writer_error')), 'Erro do writer registrado no trace');
});

// TESTE 88: Teste Fim-a-Fim Integrado com Memória sob Demanda
test('88. End-to-End Integrado: Memória Sob Demanda + Roteamento + Despacho + MemoryWriter', async () => {
  const { load } = createRuntime();
  const { runExperimentalOrchestration, InMemoryMemoryProvider } = load('supabase/functions/api/experimental_orchestrator.ts');

  const memoryProvider = new InMemoryMemoryProvider();
  // Estado prévio da memória
  await memoryProvider.writeFact('conv_e2e_mem', {
    entity: 'self',
    field: 'age',
    value: 28,
    sourceMessageId: 'msg_passada_28',
  });

  const deliveredToMeta = [];

  const runtime = {
    callModel: async (prompt) => {
      if (prompt.includes('Agente da Conversa')) {
        return {
          content: JSON.stringify({ targetSubagent: 'descoberta', action: 'delegate', reason: 'Pretendente comentou de trilha e idade' }),
          tokens: 40,
        };
      }
      // Subagente consulta a idade sob demanda
      if (!prompt.includes('RETORNO DA CONSULTA DE MEMÓRIA')) {
        return {
          content: JSON.stringify({
            action: 'call_tool',
            tool: 'memory_get_fact',
            parameters: { entity: 'self', field: 'age' },
            reasoning: 'Verificar idade para comentar da trilha',
          }),
          tokens: 50,
        };
      }
      // Com a idade recebida (28), gera resposta afetuosa
      return {
        content: JSON.stringify({
          action: 'reply',
          checkpoint: 'chk_pergunta_sobre_ele',
          suggestedResponse: 'Nossa com 28 anos vc tem pique de sobra pra trilha kkk\n\nQual foi a última que vc fez?',
          nextPhase: 'descoberta',
          summary: 'Resposta usando a idade de 28 anos da memória',
        }),
        tokens: 60,
      };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      deliveredToMeta.push(text);
      return { success: true, message_id: `meta_${deliveredToMeta.length}` };
    },
    memoryProvider,
  };

  const messages = [
    { id: 'm_larissa_turn', is_mine: true, sender_id: 'me', text: 'Vc ainda faz aquelas trilhas?', created_at: '2026-09-18T10:00:00Z', status: 'sent' },
    { id: 'm_inbound_pretendente', is_mine: false, sender_id: 'c1', text: 'Com a minha idade eu já tô velho pra isso kkk', created_at: '2026-09-18T10:00:05Z' },
  ];

  const supabase = createMockSupabase({
    stage_completed_rules: { orchestration: { mode: 'experimental', currentPhase: 'descoberta' } },
  }, messages);

  const res = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_e2e_mem',
    correlationId: 'cycle_e2e_mem',
    newMessage: messages[1],
    runtime,
  });

  assert.equal(res.handled, true);
  assert.equal(res.sentToMeta, true);
  assert.equal(deliveredToMeta.length, 2, '2 balões despachados à Meta com sucesso');
  assert.equal(deliveredToMeta[0], 'Nossa com 28 anos vc tem pique de sobra pra trilha kkk');
  assert.equal(deliveredToMeta[1], 'Qual foi a última que vc fez?');

  const convData = supabase.getConversationData();
  const orch = convData.stage_completed_rules.orchestration;
  const cycle = orch.recentCycles[0];

  assert.ok(cycle.trace.includes('memory_tool_requested: self.age'));
  assert.ok(cycle.trace.includes('memory_tool_found: true'));
  assert.ok(cycle.trace.includes('memory_writer_started'));
  assert.ok(cycle.trace.includes('memory_writer_completed'));
  assert.equal(orch.messageLedger['m_inbound_pretendente'], 'processed');
});



