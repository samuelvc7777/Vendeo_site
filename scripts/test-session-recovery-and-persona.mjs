import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBrainOrchestration,
} from '../supabase/functions/api/brain_orchestrator.ts';
import {
  runOpenAiBrainTurn,
  fetchSessionRecoveryBootstrap,
} from '../supabase/functions/api/openai_brain.ts';
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
} from '../supabase/functions/api/openai_agent_instructions.ts';

// --------------------------------------------------------------------------
// Timer Acceleration Helper
// --------------------------------------------------------------------------
function withAcceleratedTimers(fn) {
  return async (...args) => {
    const realSetTimeout = globalThis.setTimeout;
    const origDateNow = Date.now;
    let virtualTime = origDateNow();

    Date.now = () => {
      virtualTime += 1000;
      return virtualTime;
    };
    globalThis.setTimeout = (callback) => setImmediate(callback);

    try {
      return await fn(...args);
    } finally {
      Date.now = origDateNow;
      globalThis.setTimeout = realSetTimeout;
    }
  };
}

const defaultTurnContract = {
  mustAnswerFirst: false,
  newQuestionBudget: 1,
  responseShape: 'balanced',
  directQuestions: [],
  maxBalloons: 2,
};

// --------------------------------------------------------------------------
// Schema canônico real da tabela instagram_messages no PostgreSQL/Supabase
// Usado para garantir que o mock rejeite qualquer coluna inexistente (como is_from_me ou message)
// --------------------------------------------------------------------------
export const VALID_INSTAGRAM_MESSAGES_COLUMNS = new Set([
  'id',
  'conversation_id',
  'sender_id',
  'text',
  'timestamp',
  'is_mine',
  'status',
  'created_at',
  'contact_id',
  'media_url',
  'media_type',
  'direction',
  'is_echo',
  'transcription',
  'type',
  'is_edited',
  'edited_at',
  'audio_transcript',
  'audio_transcribed_at',
  'audio_transcription_error',
  'reply_to_message_id',
  'deliver_at',
  'seen_at',
  '*',
]);

// --------------------------------------------------------------------------
// Helper para criar mock do Supabase com mensagens históricas
// --------------------------------------------------------------------------
function createMockSupabaseWithHistory(options = {}) {
  const convId = options.conversationId || 'conv_rec_test';
  const correlationId = options.correlationId || 'corr_rec_123';
  const defaultStages = [
    {
      id: 'stage_1_conexao',
      name: 'Conexão Inicial',
      order: 1,
      goals: [
        {
          id: 'goal_initial_reciprocity',
          label: 'Reciprocidade inicial',
          required: true,
          status: 'pending',
          kind: 'conversation_state',
        },
      ],
    },
  ];

  const defaultLedger = (options.messages || []).reduce((acc, m) => {
    acc[m.id] = 'processed';
    return acc;
  }, {});

  const convRecord = {
    id: convId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      current_stage: 'stage_1_conexao',
      stages: defaultStages,
      completed_goals: [],
      cancel_current_cycle: false,
      config: {
        persistent_agent_session_enabled: true,
      },
      openai_session_id: options.initialSessionId !== undefined ? options.initialSessionId : null,
      openai_session_kind: options.initialSessionId ? 'persistent' : null,
      persistent_session_version: options.initialSessionId ? 1 : null,
      orchestration: {
        currentStageId: 'stage_1_conexao',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_feita',
        stageChecklist: {
          goals: defaultStages[0].goals,
          currentObjective: defaultStages[0].goals[0],
        },
        openai_session_id: options.initialSessionId !== undefined ? options.initialSessionId : null,
        openai_session_kind: options.initialSessionId ? 'persistent' : null,
        persistent_session_version: options.initialSessionId ? 1 : null,
        messageLedger: defaultLedger,
        lastProcessedMessageId: options.messages?.length ? options.messages[options.messages.length - 1].id : null,
      },
      active_cycle_token: correlationId,
    },
  };

  const store = {
    conversations: {
      [convId]: convRecord,
    },
    messages: [...(options.messages || [])],
    audio_delivery_history: [],
    persona_audios: [],
    persona_memory: [
      {
        id: 'persona_larissa_test',
        persona_id: 'larissa',
        category: 'perfil',
        key: 'nome',
        value: 'Larissa',
        source_type: 'canonical',
        confidence: 1,
        aliases: [],
        valid_from: null,
        valid_until: null,
      },
    ],
    chat_stages: defaultStages,
    instagram_config: [
      { id: 'openai_api_key', app_secret: 'sk-mock-key' },
      { id: 'openai_brain_agent_id', app_secret: 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482' },
      { id: 'openai_brain_default_model', app_secret: 'gpt-5.6-terra' },
    ],
  };

  const client = {
    channel: () => ({ send: async () => ({}), subscribe: () => ({}) }),
    from: (table) => {
      let conditions = [];
      let updatePayload = null;
      let schemaError = null;

      const queryBuilder = {
        select: (cols) => {
          if (table === 'instagram_messages' && typeof cols === 'string' && cols !== '*') {
            const requestedCols = cols.split(',').map((c) => c.trim()).filter(Boolean);
            for (const col of requestedCols) {
              if (!VALID_INSTAGRAM_MESSAGES_COLUMNS.has(col)) {
                schemaError = {
                  message: `column instagram_messages.${col} does not exist`,
                  code: '42703',
                  details: `Column ${col} is not part of canonical instagram_messages schema`,
                };
                break;
              }
            }
          }
          return queryBuilder;
        },
        eq: (col, val) => {
          conditions.push({ col, val, op: 'eq' });
          return queryBuilder;
        },
        neq: () => queryBuilder,
        in: () => queryBuilder,
        or: () => queryBuilder,
        order: () => queryBuilder,
        limit: () => queryBuilder,
        update: (payload) => {
          updatePayload = payload;
          return queryBuilder;
        },
        upsert: () => {
          const resObj = { data: null, error: null };
          return {
            data: null,
            error: null,
            select: () => Promise.resolve(resObj),
            then: (resolve) => Promise.resolve(resObj).then(resolve),
          };
        },
        insert: (payload) => {
          if (table === 'instagram_messages' && payload) {
            const items = Array.isArray(payload) ? payload : [payload];
            store.messages.push(...items);
          }
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: async () => {
          if (schemaError) {
            return { data: null, error: schemaError };
          }
          if (table === 'instagram_conversations') {
            return { data: store.conversations[convId] || null, error: null };
          }
          if (table === 'instagram_messages') {
            const idCond = conditions.find((c) => c.col === 'id');
            const msg = store.messages.find((m) => m.id === idCond?.val);
            return { data: msg || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (schemaError) {
            return { data: null, error: schemaError };
          }
          if (table === 'instagram_conversations') {
            return { data: store.conversations[convId] || null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (schemaError) {
            return Promise.resolve({ data: null, error: schemaError }).then(resolve);
          }
          if (updatePayload && table === 'instagram_conversations') {
            const conv = store.conversations[convId];
            if (conv) Object.assign(conv, updatePayload);
            return Promise.resolve({ data: conv, error: null }).then(resolve);
          }
          if (table === 'instagram_config') {
            return Promise.resolve({ data: store.instagram_config, error: null }).then(resolve);
          }
          if (table === 'persona_memory') {
            return Promise.resolve({ data: store.persona_memory, error: null }).then(resolve);
          }
          if (table === 'instagram_messages') {
            let res = [...store.messages];
            const convCond = conditions.find((c) => c.col === 'conversation_id');
            if (convCond) {
              res = res.filter((m) => m.conversation_id === convCond.val);
            }
            return Promise.resolve({ data: res, error: null }).then(resolve);
          }
          if (table === 'chat_stages') {
            return Promise.resolve({ data: store.chat_stages, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return queryBuilder;
    },
    rpc: async (fnName, args) => {
      if (
        fnName === 'claim_experimental_cycle' ||
        fnName === 'claim_autopilot_cycle' ||
        fnName === 'claim_experimental_cycle_atomic'
      ) {
        const conv = store.conversations[args.p_conversation_id || convId];
        if (conv) {
          conv.stage_completed_rules.active_cycle_token = args.p_cycle_token;
        }
        return {
          data: {
            success: true,
            reason: 'claimed',
            activeCycleToken: args.p_cycle_token,
            staleRecovered: false,
          },
          error: null,
        };
      }
      if (fnName === 'claim_experimental_cycle_messages_atomic' || fnName === 'claim_experimental_cycle_messages') {
        const conv = store.conversations[args.p_conversation_id || convId];
        if (conv) {
          conv.stage_completed_rules.active_cycle_token = args.p_cycle_token;
        }
        const claimedId = args?.p_claimed_ids?.[0] || 'msg_now';
        return {
          data: {
            success: true,
            claimed_count: 1,
            claimed_ids: [claimedId],
            inbound_revision: 1,
          },
          error: null,
        };
      }
      if (fnName === 'prepare_experimental_outbox_entry') {
        return {
          data: {
            success: true,
            reason: 'prepared',
            outboxKey: args?.p_outbox_entry?.idempotencyKey,
          },
          error: null,
        };
      }
      if (fnName === 'claim_outbox_entry_atomic' || fnName === 'claim_outbox_entry') {
        return {
          data: {
            success: true,
            reason: 'claimed',
            entry: { status: 'claimed_to_send' },
          },
          error: null,
        };
      }
      if (
        fnName === 'commit_experimental_cycle_if_owned' ||
        fnName === 'commit_experimental_cycle_atomic' ||
        fnName === 'commit_autopilot_cycle_atomic'
      ) {
        const conv = store.conversations[args.p_conversation_id || convId];
        if (conv && args.p_new_stage_completed_rules) {
          conv.stage_completed_rules = args.p_new_stage_completed_rules;
        }
        return { data: { success: true, committed: true, active_token: null }, error: null };
      }
      if (fnName === 'release_experimental_cycle_if_owned' || fnName === 'release_experimental_cycle_atomic') {
        return { data: { released: true, reason: 'released' }, error: null };
      }
      return { data: { success: true, committed: true }, error: null };
    },
    _store: store,
  };

  return client;
}

// --------------------------------------------------------------------------
// TESTES DE RECOVERY
// --------------------------------------------------------------------------

test('Teste A - Session válida: reutiliza Session, zero bootstrap e zero histórico manual', async () => {
  const runtime = {
    callOpenAiAgent: async (args) => {
      assert.strictEqual(args.sessionId, 'sess_valid_123', 'Deve passar o sessionId existente');
      return {
        sessionId: 'sess_valid_123',
        sessionCreated: false,
        plan: {
          action: 'reply',
          responses: ['Tudo ótimo por aqui!'],
          outboundActions: [{ type: 'text', text: 'Tudo ótimo por aqui!' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const result = await runOpenAiBrainTurn({
    conversationId: 'conv_valid_test',
    persistentSessionEnabled: true,
    sessionId: 'sess_valid_123',
    currentStageId: 'conexao_inicial',
    currentInboundMessages: [{ id: 'in_1', text: 'Tudo bem?', createdAt: new Date().toISOString() }],
    inboundMessages: ['Tudo bem?'],
    recentMessages: [],
    runtime,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.telemetry.agentSessionReused, true, 'Deve indicar reuso');
  assert.strictEqual(result.telemetry.agentSessionCreated, false, 'Não deve criar sessão');
  assert.strictEqual(result.telemetry.agentSessionRecoveryTriggered, false, 'Recovery não deve ser disparado');
  assert.strictEqual(result.telemetry.agentSessionBootstrapInjected, false, 'Bootstrap não deve ser injetado');
  assert.strictEqual(result.telemetry.agentSessionBootstrapMessageCount, 0, 'Contagem de bootstrap deve ser 0');
  assert.strictEqual(result.telemetry.manualRecentHistoryInjected, false, 'Histórico manual deve ser false');
});

test('Teste B - Session inválida: detecta falha, busca últimas mensagens de instagram_messages, cria nova Session, injeta bootstrap e persiste', withAcceleratedTimers(async () => {
  const historyMessages = [
    { id: 'msg_h1', conversation_id: 'conv_inv_test', sender_id: 'user', is_mine: false, text: 'Oi Larissa!', created_at: '2026-09-24T00:00:00Z' },
    { id: 'msg_h2', conversation_id: 'conv_inv_test', sender_id: 'larissa', is_mine: true, text: 'Oii! Como vc tá?', created_at: '2026-09-24T00:01:00Z' },
    { id: 'msg_h3', conversation_id: 'conv_inv_test', sender_id: 'user', is_mine: false, text: 'Tô bem, trabalhando bastante', created_at: '2026-09-24T00:02:00Z' },
  ];

  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_inv_test',
    correlationId: 'corr_inv_123',
    initialSessionId: 'sess_invalid_old_999',
    messages: historyMessages,
  });

  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_1' }),
    callOpenAiAgent: async () => {
      return {
        sessionId: 'sess_recovered_fresh_888',
        sessionCreated: true, // Simula que a sessão antiga falhou e uma nova foi criada
        plan: {
          action: 'reply',
          responses: ['Descansa um pouco então!'],
          outboundActions: [{ type: 'text', text: 'Descansa um pouco então!' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const cycleResult = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_inv_test',
    correlationId: 'corr_inv_123',
    preClaimedCycleToken: 'corr_inv_123',
    isManualRetry: true,
    newMessage: {
      id: 'msg_now',
      sender: 'user',
      text: 'Finalmente em casa',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(cycleResult.handled, true);
  const conv = supabase._store.conversations.conv_inv_test;
  assert.strictEqual(
    conv.stage_completed_rules.orchestration.openai_session_id,
    'sess_recovered_fresh_888',
    'A nova Session gerada pelo recovery deve ser persistida substituindo a antiga'
  );

  // Validação dos traces registrados pelo orquestrador
  const trace = cycleResult.trace || [];
  console.log('TRACE IN TEST B:', trace.filter(t => t.includes('agent_session')));
  assert.ok(trace.includes('agent_session_recovery_triggered=true'), 'Trace deve conter agent_session_recovery_triggered=true');
  assert.ok(trace.includes('agent_session_bootstrap_injected=true'), 'Trace deve conter agent_session_bootstrap_injected=true');
  assert.ok(trace.includes('agent_session_bootstrap_message_count=3'), 'Trace deve conter agent_session_bootstrap_message_count=3');

  // Validação direta da função fetchSessionRecoveryBootstrap
  const bootstrap = await fetchSessionRecoveryBootstrap(supabase, 'conv_inv_test', ['msg_now']);
  assert.strictEqual(bootstrap.messageCount, 3, 'Deve recuperar as 3 mensagens do histórico');
  assert.ok(bootstrap.text.includes('## RECUPERAÇÃO EXCEPCIONAL DE CONTEXTO'), 'Deve conter cabeçalho de recuperação');
  assert.ok(bootstrap.text.includes('[Pretendente | id=msg_h1]'), 'Deve identificar pretendente com id');
  assert.ok(bootstrap.text.includes('[Larissa | id=msg_h2]'), 'Deve identificar Larissa com id');
}));

test('Teste C - Turno posterior ao recovery: usa a nova Session persistida e NÃO injeta bootstrap novamente', withAcceleratedTimers(async () => {
  const historyMessages = [
    { id: 'msg_h1', conversation_id: 'conv_post_test', sender_id: 'user', is_mine: false, text: 'Oi Larissa!', created_at: '2026-09-24T00:00:00Z' },
    { id: 'msg_h2', conversation_id: 'conv_post_test', sender_id: 'larissa', is_mine: true, text: 'Oii!', created_at: '2026-09-24T00:01:00Z' },
  ];

  // Simula que a conversa já tem a nova sessão persistida após o recovery
  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_post_test',
    correlationId: 'corr_post_123',
    initialSessionId: 'sess_recovered_fresh_888',
    messages: historyMessages,
  });

  let sessionPassedToAgent = null;
  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_2' }),
    callOpenAiAgent: async (args) => {
      sessionPassedToAgent = args.sessionId;
      return {
        sessionId: 'sess_recovered_fresh_888',
        sessionCreated: false, // Reuso com sucesso da nova sessão
        plan: {
          action: 'reply',
          responses: ['Boa noite!'],
          outboundActions: [{ type: 'text', text: 'Boa noite!' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const cycleResult = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_post_test',
    correlationId: 'corr_post_123',
    preClaimedCycleToken: 'corr_post_123',
    isManualRetry: true,
    newMessage: {
      id: 'msg_turn2',
      sender: 'user',
      text: 'Boa noite!',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(cycleResult.handled, true);
  assert.strictEqual(sessionPassedToAgent, 'sess_recovered_fresh_888', 'Deve reutilizar a nova Session');
  const conv = supabase._store.conversations.conv_post_test;
  assert.strictEqual(conv.stage_completed_rules.orchestration.openai_session_id, 'sess_recovered_fresh_888');

  // Verifica que o trace do ciclo registrou reuso e zero bootstrap
  const trace = cycleResult.trace || [];
  assert.ok(trace.includes('agent_session_reused=true'), 'Trace deve conter agent_session_reused=true');
  assert.ok(trace.includes('agent_session_recovery_triggered=false'), 'Trace deve conter agent_session_recovery_triggered=false');
  assert.ok(trace.includes('agent_session_bootstrap_injected=false'), 'Trace deve conter agent_session_bootstrap_injected=false');
}));

test('Teste D - Conversa antiga sem openai_session_id, mas com histórico: primeira criação recebe bootstrap e persiste; turnos seguintes voltam a zero-history', withAcceleratedTimers(async () => {
  const existingHistory = [
    { id: 'm1', conversation_id: 'conv_legacy_test', sender_id: 'user', is_mine: false, text: 'Oi moça', created_at: '2026-09-23T20:00:00Z' },
    { id: 'm2', conversation_id: 'conv_legacy_test', sender_id: 'larissa', is_mine: true, text: 'Oii tudo bem?', created_at: '2026-09-23T20:01:00Z' },
    { id: 'm3', conversation_id: 'conv_legacy_test', sender_id: 'user', is_mine: false, text: 'Tudo ótimo, sou de Betim', created_at: '2026-09-23T20:02:00Z' },
  ];

  // Conversa sem openai_session_id (null)
  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_legacy_test',
    correlationId: 'corr_leg_1',
    initialSessionId: null,
    messages: existingHistory,
  });

  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_leg_1' }),
    callOpenAiAgent: async () => ({
      sessionId: 'sess_first_created_for_legacy',
      sessionCreated: true,
      plan: {
        action: 'reply',
        responses: ['Que bom! Conheço Betim'],
        outboundActions: [{ type: 'text', text: 'Que bom! Conheço Betim' }],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  // Turno 1: Primeira criação
  const turn1Result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_legacy_test',
    correlationId: 'corr_leg_1',
    preClaimedCycleToken: 'corr_leg_1',
    isManualRetry: true,
    newMessage: {
      id: 'm4',
      sender: 'user',
      text: 'E vc mora onde?',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(turn1Result.handled, true);
  const conv = supabase._store.conversations.conv_legacy_test;
  assert.strictEqual(
    conv.stage_completed_rules.orchestration.openai_session_id,
    'sess_first_created_for_legacy',
    'Primeira Session deve ser salva no banco'
  );
  assert.ok(turn1Result.trace.includes('agent_session_bootstrap_injected=true'), 'Deve injetar bootstrap no primeiro ciclo');
  assert.ok(turn1Result.trace.includes('agent_session_bootstrap_message_count=3'), 'Deve conter 3 mensagens no bootstrap');

  // Turno 2: Turno posterior na mesma conversa
  let sessionPassedTurn2 = null;
  const runtimeTurn2 = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_leg_2' }),
    callOpenAiAgent: async (args) => {
      sessionPassedTurn2 = args.sessionId;
      return {
        sessionId: 'sess_first_created_for_legacy',
        sessionCreated: false,
        plan: {
          action: 'reply',
          responses: ['Sou de São João del-Rei'],
          outboundActions: [{ type: 'text', text: 'Sou de São João del-Rei' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  supabase._store.conversations.conv_legacy_test.stage_completed_rules.active_cycle_token = 'corr_leg_2';
  const turn2Result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_legacy_test',
    correlationId: 'corr_leg_2',
    preClaimedCycleToken: 'corr_leg_2',
    isManualRetry: true,
    newMessage: {
      id: 'm5',
      sender: 'user',
      text: 'Legal!',
      timestamp: new Date().toISOString(),
    },
    runtime: runtimeTurn2,
  });

  assert.strictEqual(turn2Result.handled, true);
  assert.strictEqual(sessionPassedTurn2, 'sess_first_created_for_legacy', 'Turno 2 deve reutilizar a sessão');
  assert.ok(turn2Result.trace.includes('agent_session_reused=true'), 'Turno 2 deve registrar reuso');
  assert.ok(turn2Result.trace.includes('agent_session_bootstrap_injected=false'), 'Turno 2 NÃO deve injetar bootstrap');
}));

test('Teste E - Conversa realmente nova sem histórico: cria Session apenas com turno atual', withAcceleratedTimers(async () => {
  // Conversa nova, sem mensagens prévias em instagram_messages
  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_brand_new',
    correlationId: 'corr_new_1',
    initialSessionId: null,
    messages: [], // ZERO mensagens anteriores
  });

  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_new_1' }),
    callOpenAiAgent: async () => ({
      sessionId: 'sess_brand_new_100',
      sessionCreated: true,
      plan: {
        action: 'reply',
        responses: ['Oii! Tudo bem?'],
        outboundActions: [{ type: 'text', text: 'Oii! Tudo bem?' }],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_brand_new',
    correlationId: 'corr_new_1',
    preClaimedCycleToken: 'corr_new_1',
    isManualRetry: true,
    newMessage: {
      id: 'first_msg_ever',
      sender: 'user',
      text: 'Oi',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true);
  assert.ok(result.trace.includes('agent_session_created=true'), 'Deve criar sessão');
  assert.ok(result.trace.includes('agent_session_recovery_triggered=false'), 'Não foi recovery');
  assert.ok(result.trace.includes('agent_session_bootstrap_injected=false'), 'NÃO deve injetar bootstrap em conversa nova');
  assert.ok(result.trace.includes('agent_session_bootstrap_message_count=0'), 'Message count deve ser 0');
}));

// --------------------------------------------------------------------------
// TESTE DA PERSONA
// --------------------------------------------------------------------------

test('Validação automática da Persona nas instructions canônicas do Agent', () => {
  const instructions = buildCanonicalAgentInstructions();

  assert.ok(
    instructions.includes('=== FATOS CANÔNICOS DA LARISSA ==='),
    'Deve conter o bloco canônico de fatos'
  );

  // 1. Larissa
  assert.ok(
    instructions.includes('Larissa'),
    'Deve conter o nome Larissa'
  );

  // 2. 23 anos
  assert.ok(
    instructions.includes('23 anos'),
    'Deve conter a idade canônica de 23 anos'
  );

  // 3. São João del-Rei
  assert.ok(
    instructions.includes('São João del-Rei'),
    'Deve conter a cidade de São João del-Rei'
  );

  // 4. Enfermagem
  assert.ok(
    instructions.toLowerCase().includes('enfermagem'),
    'Deve conter o curso de Enfermagem'
  );

  // 5. Estágio / hospital
  assert.ok(
    instructions.toLowerCase().includes('estágio') && instructions.toLowerCase().includes('hospital'),
    'Deve conter estágio hospitalar'
  );

  // 6. Vendas online
  assert.ok(
    instructions.toLowerCase().includes('vendas online'),
    'Deve conter trabalho em casa com vendas online'
  );

  // 7. Praia
  assert.ok(
    instructions.toLowerCase().includes('praia'),
    'Deve conter preferência por praia'
  );

  // 8. Terror / suspense
  assert.ok(
    instructions.toLowerCase().includes('terror') && instructions.toLowerCase().includes('suspense'),
    'Deve conter preferência por filmes de terror e suspense psicológico'
  );

  // 9. Doces / chocolate
  assert.ok(
    instructions.toLowerCase().includes('doces') || instructions.toLowerCase().includes('chocolate'),
    'Deve conter gosto por doces e chocolate'
  );

  // 10. Referência musical canônica (sertanejo)
  assert.ok(
    instructions.toLowerCase().includes('sertanejo'),
    'Deve conter referência canônica a sertanejo'
  );

  // Verificação de remoção de instructions proibidas
  assert.strictEqual(
    instructions.includes('Estas instructions definem comportamento, não biografia'),
    false,
    'Não deve conter a instrução antiga que proibia biografia nas instructions'
  );
});

// --------------------------------------------------------------------------
// TESTES DO SCHEMA REAL DE INSTAGRAM_MESSAGES E RESILIÊNCIA DE BOOTSTRAP
// --------------------------------------------------------------------------

test('Teste F - Strict Schema Guard: mock rejeita colunas inexistentes (is_from_me, message) com erro 42703', async () => {
  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_schema_guard',
    messages: [
      { id: 'm1', conversation_id: 'conv_schema_guard', sender_id: 'user', is_mine: false, text: 'Oi', created_at: '2026-09-24T00:00:00Z' },
    ],
  });

  // 1. Tentar consultar colunas inexistentes diretamente no mock
  const { data: badData, error: badError } = await supabase
    .from('instagram_messages')
    .select('id, sender_id, is_from_me, text, message, created_at, timestamp')
    .eq('conversation_id', 'conv_schema_guard');

  assert.strictEqual(badData, null, 'Query com colunas inválidas deve retornar data = null');
  assert.ok(badError, 'Query com colunas inválidas deve retornar erro');
  assert.strictEqual(badError.code, '42703', 'Código de erro deve ser 42703 (coluna inexistente)');
  assert.ok(
    badError.message.includes('is_from_me') || badError.message.includes('message'),
    'Mensagem de erro deve identificar a coluna inexistente'
  );

  // 2. Provar que a query canônica atual passa sem erro
  const { data: goodData, error: goodError } = await supabase
    .from('instagram_messages')
    .select('id, sender_id, is_mine, text, created_at, timestamp')
    .eq('conversation_id', 'conv_schema_guard');

  assert.strictEqual(goodError, null, 'Query canônica não deve retornar erro');
  assert.ok(Array.isArray(goodData), 'Query canônica deve retornar array');
  assert.strictEqual(goodData.length, 1, 'Deve retornar 1 mensagem');
});

test('Teste G - fetchSessionRecoveryBootstrap usa estritamente colunas canônicas e retorna queryFailed=false', async () => {
  const supabase = createMockSupabaseWithHistory({
    conversationId: 'conv_bootstrap_real',
    messages: [
      { id: 'm1', conversation_id: 'conv_bootstrap_real', sender_id: 'user', is_mine: false, text: 'Você gosta de praia?', created_at: '2026-09-24T00:00:00Z' },
      { id: 'm2', conversation_id: 'conv_bootstrap_real', sender_id: 'larissa', is_mine: true, text: 'Amo praia demais!', created_at: '2026-09-24T00:01:00Z' },
    ],
  });

  const bootstrap = await fetchSessionRecoveryBootstrap(supabase, 'conv_bootstrap_real', []);
  assert.strictEqual(bootstrap.queryFailed, false, 'queryFailed deve ser false');
  assert.strictEqual(bootstrap.errorMessage, null, 'errorMessage deve ser null');
  assert.strictEqual(bootstrap.messageCount, 2, 'Deve recuperar 2 mensagens');
  assert.ok(bootstrap.text.includes('[Pretendente | id=m1]'), 'Deve identificar pretendente');
  assert.ok(bootstrap.text.includes('Você gosta de praia?'), 'Deve conter texto do pretendente');
  assert.ok(bootstrap.text.includes('[Larissa | id=m2]'), 'Deve identificar Larissa via is_mine');
  assert.ok(bootstrap.text.includes('Amo praia demais!'), 'Deve conter texto da Larissa');
});

test('Teste H - Resiliência e telemetria: falha na query de bootstrap não quebra o ciclo e é registrada no trace', withAcceleratedTimers(async () => {
  // Criar mock onde a tabela instagram_messages falha simulando erro de banco
  const defaultStages = [
    {
      id: 'stage_1_conexao',
      name: 'Conexão Inicial',
      order: 1,
      goals: [{ id: 'goal_initial_reciprocity', label: 'Reciprocidade', required: true, status: 'pending', kind: 'conversation_state' }],
    },
  ];

  const convRecord = {
    id: 'conv_err_test',
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      current_stage: 'stage_1_conexao',
      stages: defaultStages,
      completed_goals: [],
      cancel_current_cycle: false,
      config: { persistent_agent_session_enabled: true },
      orchestration: {
        currentStageId: 'stage_1_conexao',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_feita',
        stageChecklist: { goals: defaultStages[0].goals, currentObjective: defaultStages[0].goals[0] },
        openai_session_id: 'sess_failing_reuse_1',
        messageLedger: {},
        lastProcessedMessageId: null,
      },
      active_cycle_token: 'corr_err_1',
    },
  };

  const failingSupabase = {
    channel: () => ({ send: async () => ({}), subscribe: () => ({}) }),
    from: (table) => {
      let updatePayload = null;
      const qb = {
        select: () => qb,
        eq: () => qb,
        neq: () => qb,
        in: () => qb,
        or: () => qb,
        order: () => qb,
        limit: () => qb,
        update: (payload) => { updatePayload = payload; return qb; },
        upsert: () => ({ data: null, error: null, select: () => Promise.resolve({ data: null, error: null }), then: (r) => Promise.resolve({ data: null, error: null }).then(r) }),
        insert: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: async () => {
          if (table === 'instagram_conversations') return { data: convRecord, error: null };
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'instagram_conversations') return { data: convRecord, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'instagram_messages') {
            // Simula erro de banco na consulta de mensagens
            return Promise.resolve({
              data: null,
              error: { message: 'relation "instagram_messages" connection timeout', code: '08006' },
            }).then(resolve);
          }
          if (updatePayload && table === 'instagram_conversations') {
            Object.assign(convRecord, updatePayload);
            return Promise.resolve({ data: convRecord, error: null }).then(resolve);
          }
          if (table === 'instagram_conversations') return Promise.resolve({ data: convRecord, error: null }).then(resolve);
          if (table === 'instagram_config') return Promise.resolve({ data: [], error: null }).then(resolve);
          if (table === 'chat_stages') return Promise.resolve({ data: defaultStages, error: null }).then(resolve);
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return qb;
    },
    rpc: async (fnName, args) => {
      if (fnName === 'claim_experimental_cycle_atomic' || fnName === 'claim_experimental_cycle') {
        convRecord.stage_completed_rules.active_cycle_token = args.p_cycle_token;
        return { data: { success: true, reason: 'claimed', activeCycleToken: args.p_cycle_token }, error: null };
      }
      if (fnName === 'claim_experimental_cycle_messages_atomic' || fnName === 'claim_experimental_cycle_messages') {
        return { data: { success: true, claimed_count: 1, claimed_ids: ['msg_err_in'], inbound_revision: 1 }, error: null };
      }
      if (fnName === 'prepare_experimental_outbox_entry') {
        return { data: { success: true, reason: 'prepared', outboxKey: args?.p_outbox_entry?.idempotencyKey }, error: null };
      }
      if (fnName === 'claim_outbox_entry_atomic' || fnName === 'claim_outbox_entry') {
        return { data: { success: true, reason: 'claimed', entry: { status: 'claimed_to_send' } }, error: null };
      }
      if (fnName === 'commit_experimental_cycle_if_owned' || fnName === 'commit_experimental_cycle_atomic') {
        if (args.p_new_stage_completed_rules) convRecord.stage_completed_rules = args.p_new_stage_completed_rules;
        return { data: { success: true, committed: true, active_token: null }, error: null };
      }
      return { data: { success: true, committed: true }, error: null };
    },
  };

  const runtime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_err_1' }),
    callOpenAiAgent: async () => ({
      sessionId: 'sess_new_after_db_error',
      sessionCreated: true,
      plan: {
        action: 'reply',
        responses: ['Oi! Tudo bem?'],
        outboundActions: [{ type: 'text', text: 'Oi! Tudo bem?' }],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase: failingSupabase,
    conversationId: 'conv_err_test',
    correlationId: 'corr_err_1',
    preClaimedCycleToken: 'corr_err_1',
    isManualRetry: true,
    newMessage: { id: 'msg_err_in', sender: 'user', text: 'Oi', timestamp: new Date().toISOString() },
    runtime,
  });

  assert.strictEqual(result.handled, true, 'O ciclo não deve quebrar mesmo com erro no bootstrap');
  const trace = result.trace || [];
  assert.ok(
    trace.includes('agent_session_bootstrap_query_failed=true'),
    'Trace DEVE registrar agent_session_bootstrap_query_failed=true'
  );
  assert.ok(
    trace.some((t) => t.startsWith('agent_session_bootstrap_error=')),
    'Trace DEVE registrar o detalhe do erro do bootstrap'
  );
}));
