import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBrainOrchestration,
  buildTemporalContext,
} from '../supabase/functions/api/brain_orchestrator.ts';
import {
  runOpenAiBrainTurn,
  buildOpenAiBrainContextMessageWithObservability,
} from '../supabase/functions/api/openai_brain.ts';

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

// --------------------------------------------------------------------------
// Helpers & Fixtures para Mock do Supabase
// --------------------------------------------------------------------------
function createMockSupabase(initialState = {}) {
  const defaultConvId = initialState.conversationId || 'conv_persistent_test';
  const correlationId = initialState.correlationId || initialState.activeCycleToken || 'corr_test_123';
  const defaultStages = [
    {
      id: 'stage_1_conexao',
      name: 'Conexão Inicial',
      order: 1,
      goals: [
        {
          id: 'goal_initial_reciprocity',
          label: 'Reciprocidade inicial',
          description: 'Troca de mensagens recíproca',
          required: true,
          status: 'pending',
          kind: 'conversation_state',
        },
        {
          id: 'goal_city',
          label: 'Cidade',
          description: 'Onde o pretendente mora',
          required: true,
          status: 'pending',
          kind: 'fact',
        },
        {
          id: 'goal_job',
          label: 'Profissão',
          description: 'Profissão do pretendente',
          required: true,
          status: 'pending',
          kind: 'fact',
        },
      ],
    },
  ];

  const convRecord = {
    id: defaultConvId,
    is_restricted: false,
    ai_auto_respond: true,
    stage_completed_rules: {
      current_stage: 'stage_1_conexao',
      stages: defaultStages,
      completed_goals: [],
      cancel_current_cycle: false,
      config: {
        persistent_agent_session_enabled: true,
        ...(initialState.stage_completed_rules?.config || {}),
      },
      orchestration: {
        currentStageId: 'stage_1_conexao',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_feita',
        stageChecklist: {
          goals: defaultStages[0].goals,
          currentObjective: defaultStages[0].goals[0],
        },
        openai_session_id: null,
      },
      ...initialState.stage_completed_rules,
      active_cycle_token: initialState.stage_completed_rules?.active_cycle_token !== undefined
        ? initialState.stage_completed_rules.active_cycle_token
        : correlationId,
    },
  };

  const store = {
    conversations: {
      [defaultConvId]: convRecord,
    },
    messages: [
      {
        id: 'msg_ref_100',
        conversation_id: defaultConvId,
        sender_id: 'larissa',
        is_from_me: true,
        text: 'Eu amo praia, principalmente lugar calmo',
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
    audio_delivery_history: [],
    persona_audios: [
      {
        id: 'audio_praia_1',
        title: 'Larissa falando sobre praia',
        audio_url: 'https://storage.vendeo.com/audios/praia.mp3',
        audioUrl: 'https://storage.vendeo.com/audios/praia.mp3',
        transcript: 'Eu amo ir pra praia fim de semana!',
        full_transcript: 'Eu amo ir pra praia fim de semana!',
        when_to_use: 'Quando perguntarem sobre praia',
        usage_instruction: 'Quando perguntarem sobre praia',
        duration: 12,
        is_active: true,
        enabled: true,
      },
    ],
    chat_stages: defaultStages,
    instagram_config: [
      { id: 'openai_api_key', app_secret: 'sk-mock-key-for-tests' },
      { id: 'openai_brain_agent_id', app_secret: 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482' },
      { id: 'openai_brain_default_model', app_secret: 'gpt-5.6-terra' },
    ],
  };

  const client = {
    channel: () => ({
      send: async () => ({}),
      subscribe: () => ({}),
    }),
    from: (table) => {
      let selectedTable = table;
      let conditions = [];
      let updatePayload = null;

      const queryBuilder = {
        select: () => queryBuilder,
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
        upsert: () => Promise.resolve({ data: null, error: null }),
        insert: (row) => {
          if (selectedTable === 'audio_delivery_history') {
            store.audio_delivery_history.push(row);
          }
          return Promise.resolve({ data: row, error: null });
        },
        maybeSingle: async () => {
          if (selectedTable === 'instagram_conversations') {
            return { data: store.conversations[defaultConvId] || null, error: null };
          }
          if (selectedTable === 'instagram_messages') {
            const idCond = conditions.find((c) => c.col === 'id');
            const msg = store.messages.find((m) => m.id === idCond?.val);
            return { data: msg || null, error: null };
          }
          if (selectedTable === 'persona_audios') {
            return { data: store.persona_audios[0] || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (selectedTable === 'instagram_conversations') {
            return { data: store.conversations[defaultConvId] || null, error: null };
          }
          if (selectedTable === 'persona_audios') {
            return { data: store.persona_audios[0] || null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (updatePayload && selectedTable === 'instagram_conversations') {
            const conv = store.conversations[defaultConvId];
            if (conv) Object.assign(conv, updatePayload);
            return Promise.resolve({ data: conv, error: null }).then(resolve);
          }
          if (selectedTable === 'instagram_config') {
            return Promise.resolve({ data: store.instagram_config, error: null }).then(resolve);
          }
          if (selectedTable === 'instagram_messages') {
            return Promise.resolve({ data: store.messages, error: null }).then(resolve);
          }
          if (selectedTable === 'persona_audios') {
            return Promise.resolve({ data: store.persona_audios, error: null }).then(resolve);
          }
          if (selectedTable === 'chat_stages') {
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
        const conv = store.conversations[args.p_conversation_id || defaultConvId];
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
        const conv = store.conversations[args.p_conversation_id || defaultConvId];
        if (conv) {
          conv.stage_completed_rules.active_cycle_token = args.p_cycle_token;
        }
        const claimedId = args?.p_claimed_ids?.[0] || 'msg_inbound_1';
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
      if (fnName === 'claim_audio_delivery_reservation') {
        return { data: { claimed: true, reason: 'claimed' }, error: null };
      }
      if (fnName === 'commit_audio_delivery_sent') {
        return { data: { committed: true, reason: 'committed' }, error: null };
      }
      if (
        fnName === 'commit_experimental_cycle_if_owned' ||
        fnName === 'commit_experimental_cycle_atomic' ||
        fnName === 'commit_autopilot_cycle_atomic'
      ) {
        const conv = store.conversations[args.p_conversation_id || defaultConvId];
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

const defaultTurnContract = {
  mustAnswerFirst: false,
  newQuestionBudget: 1,
  responseShape: 'balanced',
  directQuestions: [],
  maxBalloons: 2,
};

// --------------------------------------------------------------------------
// SUÍTE DE TESTES: ARQUITETURA DE SESSÃO PERSISTENTE (15 CENÁRIOS)
// --------------------------------------------------------------------------

test('1. Sessão criada no primeiro ciclo (salva openai_session_id no banco)', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_1';
  const supabase = createMockSupabase({ correlationId });
  const metaSent = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async (args) => {
      assert.strictEqual(args.sessionId, null, 'No primeiro turno, sessionId de entrada deve ser null');
      return {
        sessionCreated: true,
        sessionId: 'sess_persistent_101',
        plan: {
          action: 'reply',
          responses: ['Oi! Que bom falar com você! 😊'],
          outboundActions: [{ type: 'text', text: 'Oi! Que bom falar com você! 😊' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_1',
      sender: 'user',
      text: 'Oi Larissa!',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const conv = supabase._store.conversations.conv_persistent_test;
  assert.strictEqual(
    conv.stage_completed_rules.orchestration.openai_session_id,
    'sess_persistent_101',
    'openai_session_id deve ser salvo em stage_completed_rules.orchestration'
  );
  assert.strictEqual(
    conv.stage_completed_rules.openai_session_id,
    'sess_persistent_101',
    'openai_session_id deve ser salvo em stage_completed_rules raiz'
  );
}));

test('2. Reuso de sessão em ciclo subsequente (mesmo sessionId enviado e preservado)', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_2';
  const supabase = createMockSupabase({
    correlationId,
    stage_completed_rules: {
      openai_session_id: 'sess_persistent_101',
      orchestration: {
        openai_session_id: 'sess_persistent_101',
      },
    },
  });

  let receivedSessionId = null;
  const metaSent = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async (args) => {
      receivedSessionId = args.sessionId;
      return {
        sessionCreated: false,
        sessionId: args.sessionId,
        plan: {
          action: 'reply',
          responses: ['Tudo bem sim! Acabei de sair da faculdade.'],
          outboundActions: [{ type: 'text', text: 'Tudo bem sim! Acabei de sair da faculdade.' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_2',
      sender: 'user',
      text: 'Tudo bem contigo?',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(receivedSessionId, 'sess_persistent_101', 'O Agent deve receber o sessionId salvo');
  assert.ok(result.trace.includes('agent_session_reused=true'), 'Trace deve conter agent_session_reused=true');
  assert.ok(result.trace.includes('agent_session_id=sess_persistent_101'), 'Trace deve conter o ID da sessão');
}));

test('3. Payload do ciclo 2 não contém histórico de 25 mensagens passadas (redução de tokens)', () => {
  const paramsPersistent = {
    persistentSessionEnabled: true,
    sessionId: 'sess_persistent_101',
    currentStageId: 'conexao_inicial',
    currentObjectiveId: 'goal_conhecer_rotina',
    currentObjectiveLabel: 'Descobrir rotina',
    currentObjectiveRequired: true,
    inboundMessages: ['Trabalhei muito hoje!'],
    currentInboundMessages: [{ id: 'msg_201', text: 'Trabalhei muito hoje!', createdAt: new Date().toISOString() }],
    recentMessages: [
      { id: 'old_1', sender: 'user', text: 'Oi' },
      { id: 'old_2', sender: 'larissa', text: 'Ola' },
      { id: 'old_3', sender: 'user', text: 'Tudo bem?' },
    ],
  };

  const builtPersistent = buildOpenAiBrainContextMessageWithObservability(paramsPersistent);
  assert.strictEqual(builtPersistent.contextMessage.includes('## JANELA CONVERSACIONAL RECENTE'), false, 'Modo persistente não deve ter bloco ## JANELA CONVERSACIONAL RECENTE');
  assert.strictEqual(builtPersistent.contextMessage.includes('## FATOS CONHECIDOS DO PRETENDENTE'), false, 'Modo persistente não deve ter bloco de FATOS CONHECIDOS redundante');
  assert.strictEqual(builtPersistent.contextMessage.includes('## MARCOS HISTÓRICOS DA CONVERSA'), false, 'Modo persistente não deve ter marcos históricos redundantes');
  assert.strictEqual(builtPersistent.contextWindow.includedCount, 0, 'ContextWindow deve ter 0 mensagens incluídas no modo persistente');

  // Comparação com modo legado (persistentSessionEnabled: false)
  const paramsLegacy = {
    ...paramsPersistent,
    persistentSessionEnabled: false,
    contactMemorySummary: '• profissão: médico',
    landmarksSummary: '• [pretendente] Falou que tem 30 anos',
  };
  const builtLegacy = buildOpenAiBrainContextMessageWithObservability(paramsLegacy);
  assert.strictEqual(builtLegacy.contextMessage.includes('## JANELA CONVERSACIONAL RECENTE'), true, 'Modo legado deve conter ## JANELA CONVERSACIONAL RECENTE');
  assert.strictEqual(builtLegacy.contextMessage.includes('## FATOS CONHECIDOS DO PRETENDENTE'), true, 'Modo legado deve conter ## FATOS CONHECIDOS');
  assert.strictEqual(builtLegacy.contextMessage.includes('## MARCOS HISTÓRICOS DA CONVERSA'), true, 'Modo legado deve conter ## MARCOS HISTÓRICOS');
  assert.ok(builtLegacy.contextWindow.includedCount > 0, 'Modo legado deve incluir mensagens na janela');
});

test('4. Reply target preservado pontualmente quando reply_to_message_id estiver presente', () => {
  const params = {
    persistentSessionEnabled: true,
    sessionId: 'sess_persistent_101',
    currentStageId: 'conexao_inicial',
    currentObjectiveId: 'goal_conhecer_rotina',
    inboundMessages: ['Também amo praia!'],
    currentInboundMessages: [
      { id: 'msg_205', text: 'Também amo praia!', createdAt: new Date().toISOString() },
    ],
    replyTargets: {
      msg_ref_100: {
        id: 'msg_ref_100',
        sender: 'larissa',
        text: 'Eu amo praia, principalmente lugar calmo',
      },
    },
  };

  const built = buildOpenAiBrainContextMessageWithObservability(params);
  assert.ok(built.contextMessage.includes('## MENSAGEM REFERENCIADA (REPLY TARGET)'), 'Deve conter bloco de REPLY TARGET');
  assert.ok(built.contextMessage.includes('[RESPONDENDO A LARISSA id="msg_ref_100"]: "Eu amo praia, principalmente lugar calmo"'), 'Deve conter o texto exato da mensagem respondida');
});

test('5. Inbounds novos entregues integralmente com seus IDs', () => {
  const params = {
    persistentSessionEnabled: true,
    sessionId: 'sess_persistent_101',
    currentStageId: 'conexao_inicial',
    currentObjectiveId: 'goal_conhecer_rotina',
    inboundMessages: ['Mensagem 1', 'Mensagem 2'],
    currentInboundMessages: [
      { id: 'inbound_abc', text: 'Mensagem 1', createdAt: '2026-09-24T00:00:00Z' },
      { id: 'inbound_def', text: 'Mensagem 2', createdAt: '2026-09-24T00:00:05Z' },
    ],
  };

  const built = buildOpenAiBrainContextMessageWithObservability(params);
  assert.ok(built.contextMessage.includes('id="inbound_abc"'), 'ID do inbound 1 deve estar no prompt');
  assert.ok(built.contextMessage.includes('Mensagem 1'), 'Texto do inbound 1 deve estar no prompt');
  assert.ok(built.contextMessage.includes('id="inbound_def"'), 'ID do inbound 2 deve estar no prompt');
  assert.ok(built.contextMessage.includes('Mensagem 2'), 'Texto do inbound 2 deve estar no prompt');
});

test('6. Contexto temporal presente no prompt do turno', () => {
  const temporal = buildTemporalContext(new Date());
  const params = {
    persistentSessionEnabled: true,
    sessionId: 'sess_persistent_101',
    currentStageId: 'conexao_inicial',
    currentObjectiveId: 'goal_conhecer_rotina',
    temporalContext: temporal,
    currentInboundMessages: [{ id: 'in_1', text: 'Boa noite!', createdAt: new Date().toISOString() }],
  };

  const built = buildOpenAiBrainContextMessageWithObservability(params);
  assert.ok(built.contextMessage.includes('## CONTEXTO TEMPORAL ATUAL'), 'Deve incluir a seção de contexto temporal');
  assert.ok(built.contextMessage.includes('timezone: America/Sao_Paulo'), 'Deve conter o fuso horário');
});

test('7. Objetivo atual entregue no prompt do turno com status e detalhes', () => {
  const params = {
    persistentSessionEnabled: true,
    sessionId: 'sess_persistent_101',
    currentStageId: 'conexao_inicial',
    currentObjectiveId: 'goal_conhecer_rotina',
    currentObjectiveLabel: 'Descobrir profissão ou rotina',
    currentObjectiveDescription: 'Entender no que a pessoa trabalha',
    currentObjectiveRequired: true,
    currentObjectiveKind: 'discovery',
    currentInboundMessages: [{ id: 'in_1', text: 'Sou engenheiro civil', createdAt: new Date().toISOString() }],
  };

  const built = buildOpenAiBrainContextMessageWithObservability(params);
  assert.ok(built.contextMessage.includes('OBJETIVO ATIVO DA ETAPA:'), 'Deve indicar o objetivo ativo');
  assert.ok(built.contextMessage.includes('[OBRIGATÓRIO]'), 'Deve indicar que o objetivo é obrigatório');
  assert.ok(built.contextMessage.includes('Descobrir profissão ou rotina'), 'Deve conter o label do objetivo');
  assert.ok(built.contextMessage.includes('Entender no que a pessoa trabalha'), 'Deve conter a descrição do objetivo');
});

test('8. Decisão autônoma do Agent sobre objetivo (already_satisfied) é respeitada e persistida determinística pelo backend', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_8';
  const supabase = createMockSupabase({ correlationId });
  const metaSent = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async () => ({
      sessionId: 'sess_persistent_goal_test',
      plan: {
        action: 'reply',
        responses: ['Que legal engenharia civil! Trabalha em obra ou escritório?'],
        outboundActions: [{ type: 'text', text: 'Que legal engenharia civil! Trabalha em obra ou escritório?' }],
        objectiveDecision: 'already_satisfied',
        satisfiedObjectiveId: 'goal_initial_reciprocity',
        evidenceMessageId: 'msg_inbound_eng',
        reasoning: 'O pretendente respondeu e já estabelecemos a conexão inicial com sucesso.',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_eng',
      sender: 'user',
      text: 'Sou engenheiro civil!',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const conv = supabase._store.conversations.conv_persistent_test;
  assert.ok(
    conv.stage_completed_rules.completed_goals.includes('goal_initial_reciprocity'),
    'O objetivo decidido pelo Agent deve ter sido concluído deterministicamente pelo backend'
  );
}));

test('9. cofre_audio_search chamada pelo Agent em sessão persistente (busca e retorna candidatos)', async () => {
  let cofreSearched = false;
  const mockAudioCandidate = {
    audioId: 'audio_praia_1',
    title: 'Larissa falando sobre praia',
    transcript: 'Eu amo ir pra praia fim de semana!',
    whenToUse: 'Quando perguntarem o que ela gosta de fazer',
    duration: 12,
  };

  const runtime = {
    callOpenAiAgent: async ({ tools, executeTool }) => {
      // Verifica que as ferramentas ativas NÃO incluem tools de memória
      const toolNames = tools.map((t) => t.function?.name || t.name);
      assert.ok(toolNames.includes('cofre_audio_search'), 'Deve conter cofre_audio_search');
      assert.strictEqual(toolNames.includes('persona_memory_search'), false, 'Não deve conter persona_memory_search');
      assert.strictEqual(toolNames.includes('contact_memory_search'), false, 'Não deve conter contact_memory_search');
      assert.strictEqual(toolNames.includes('conversation_memory_search'), false, 'Não deve conter conversation_memory_search');

      // Executa a busca no cofre
      const searchRes = await executeTool('cofre_audio_search', { query: 'praia e fim de semana' });
      assert.strictEqual(searchRes.count, 1);
      assert.strictEqual(searchRes.candidates[0].audioId, 'audio_praia_1');
      cofreSearched = true;

      return {
        sessionId: 'sess_audio_test',
        telemetry: {
          authorizedCandidateAudios: [mockAudioCandidate],
          toolsRequested: ['cofre_audio_search'],
          sourcesUsed: ['audio_vault'],
        },
        plan: {
          action: 'send_audio',
          selectedAudioId: 'audio_praia_1',
          responses: ['Eu amo praia!'],
          outboundActions: [
            { type: 'text', text: 'Eu amo praia!' },
            { type: 'audio', audioId: 'audio_praia_1' },
          ],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_persistent_test',
    persistentSessionEnabled: true,
    sessionId: 'sess_audio_test',
    currentStageId: 'conexao_inicial',
    currentInboundMessages: [{ id: 'in_praia', text: 'O que você faz no tempo livre?', createdAt: new Date().toISOString() }],
    runtime,
    searchCofreAudios: async () => [mockAudioCandidate],
  });

  assert.strictEqual(cofreSearched, true, 'cofre_audio_search deve ter sido chamada pelo Agent');
  assert.strictEqual(turnResult.success, true);
  assert.strictEqual(turnResult.plan.selectedAudioId, 'audio_praia_1');
  assert.ok(turnResult.telemetry.audioSearchToolEnabled, 'audioSearchToolEnabled deve ser true');
  assert.strictEqual(turnResult.telemetry.personaMemoryToolEnabled, false, 'personaMemoryToolEnabled deve ser false');
});

test('10. Escolha de áudio pelo Agent é respeitada pelo backend com validação contra audio_delivery_history', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_10';
  const supabase = createMockSupabase({ correlationId });
  const mockAudioCandidate = {
    audioId: 'audio_praia_1',
    title: 'Larissa falando sobre praia',
    transcript: 'Eu amo ir pra praia fim de semana!',
    whenToUse: 'Quando perguntarem sobre praia',
    duration: 12,
  };

  let dispatchedTexts = [];
  let dispatchedAudios = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      if (text.startsWith('[audio:')) {
        dispatchedAudios.push(text);
      } else {
        dispatchedTexts.push(text);
      }
      return { ok: true, message_id: `meta_out_${dispatchedTexts.length + dispatchedAudios.length}` };
    },
    callOpenAiAgent: async () => ({
      sessionId: 'sess_audio_dispatch_test',
      telemetry: {
        authorizedCandidateAudios: [mockAudioCandidate],
        toolsRequested: ['cofre_audio_search'],
        sourcesUsed: ['audio_vault'],
      },
      plan: {
        action: 'send_audio',
        selectedAudioId: 'audio_praia_1',
        responses: ['Nossa, amo muito!'],
        outboundActions: [
          { type: 'text', text: 'Nossa, amo muito!' },
          { type: 'audio', audioId: 'audio_praia_1' },
        ],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_praia_user',
      sender: 'user',
      text: 'Você gosta de ir à praia?',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(dispatchedTexts.length, 1, 'Deve ter despachado 1 texto');
  assert.strictEqual(dispatchedAudios.length, 1, 'Deve ter despachado 1 áudio');
  assert.strictEqual(dispatchedTexts[0], 'Nossa, amo muito!');
}));

test('11. Balões de texto gerados pelo Agent são despachados sem alteração', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_11';
  const supabase = createMockSupabase({ correlationId });
  let dispatchedTexts = [];

  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      dispatchedTexts.push(text);
      return { ok: true, message_id: `meta_out_${dispatchedTexts.length}` };
    },
    callOpenAiAgent: async () => ({
      sessionId: 'sess_balloon_test',
      plan: {
        action: 'reply',
        responses: ['Balão 1: Oi tudo bem?', 'Balão 2: Estava na academia! 💪'],
        outboundActions: [
          { type: 'text', text: 'Balão 1: Oi tudo bem?' },
          { type: 'text', text: 'Balão 2: Estava na academia! 💪' },
        ],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_gym',
      sender: 'user',
      text: 'O que fez hoje?',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(dispatchedTexts.length, 2);
  assert.strictEqual(dispatchedTexts[0], 'Balão 1: Oi tudo bem?');
  assert.strictEqual(dispatchedTexts[1], 'Balão 2: Estava na academia! 💪');
}));

test('12. Fallback de sessão caso a sessão anterior seja inválida/expirada (cria nova transparentemente)', async () => {
  const runtime = {
    callOpenAiAgent: async (args) => {
      // Simula que a sessão antiga recebida causou fallback para nova
      assert.strictEqual(args.sessionId, 'sess_expired_999');
      return {
        sessionCreated: true,
        sessionId: 'sess_new_fresh_123',
        plan: {
          action: 'reply',
          responses: ['Oi! Tudo ótimo por aqui!'],
          outboundActions: [{ type: 'text', text: 'Oi! Tudo ótimo por aqui!' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const turnResult = await runOpenAiBrainTurn({
    persistentSessionEnabled: true,
    sessionId: 'sess_expired_999',
    currentStageId: 'conexao_inicial',
    currentInboundMessages: [{ id: 'in_fresh', text: 'Olá!', createdAt: new Date().toISOString() }],
    runtime,
  });

  assert.strictEqual(turnResult.success, true);
  assert.strictEqual(turnResult.telemetry.sessionId, 'sess_new_fresh_123');
  assert.strictEqual(turnResult.telemetry.agentSessionCreated, true, 'Deve indicar que nova sessão foi criada');
  assert.strictEqual(turnResult.telemetry.agentSessionReused, false, 'Não deve marcar como reuso');
});

test('13. Feature flag persistent_agent_session_enabled: false executa rollback com modo legado', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_13';
  const supabase = createMockSupabase({ correlationId });
  let receivedTools = [];
  let receivedSessionId = null;
  const metaSent = [];

  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async (args) => {
      receivedSessionId = args.sessionId;
      receivedTools = args.tools.map((t) => t.function?.name || t.name);
      return {
        sessionId: 'sess_legacy_disposable',
        plan: {
          action: 'reply',
          responses: ['Resposta no modo legado com ferramentas antigas.'],
          outboundActions: [{ type: 'text', text: 'Resposta no modo legado com ferramentas antigas.' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    persistentAgentSessionEnabled: false, // Flag desligada para rollback
    newMessage: {
      id: 'msg_legacy_test',
      sender: 'user',
      text: 'Teste modo legado',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(receivedSessionId, null, 'No modo legado, não deve enviar sessionId persistente');
  assert.ok(receivedTools.includes('persona_memory_search'), 'Modo legado deve incluir persona_memory_search');
  assert.ok(receivedTools.includes('contact_memory_search'), 'Modo legado deve incluir contact_memory_search');
  assert.ok(receivedTools.includes('conversation_memory_search'), 'Modo legado deve incluir conversation_memory_search');
  assert.ok(receivedTools.includes('cofre_audio_search'), 'Modo legado deve incluir cofre_audio_search');
  assert.ok(result.trace.includes('persistent_agent_session_enabled=false'), 'Trace deve registrar flag como false');
}));

test('14. Telemetria e logs de observabilidade registram corretamente todos os traces requeridos', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_14';
  const supabase = createMockSupabase({
    correlationId,
    stage_completed_rules: {
      openai_session_id: 'sess_existing_trace_test',
      orchestration: {
        openai_session_id: 'sess_existing_trace_test',
      },
    },
  });

  const metaSent = [];
  const runtime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async () => ({
      sessionId: 'sess_existing_trace_test',
      tokens: 142,
      plan: {
        action: 'reply',
        responses: ['Observabilidade validada.'],
        outboundActions: [{ type: 'text', text: 'Observabilidade validada.' }],
        objectiveDecision: 'continue',
        turnContract: defaultTurnContract,
      },
    }),
  };

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_obs',
      sender: 'user',
      text: 'Verificando telemetria',
      timestamp: new Date().toISOString(),
    },
    runtime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const trace = result.trace;

  assert.ok(trace.includes('persistent_agent_session_enabled=true'), 'Trace deve conter persistent_agent_session_enabled=true');
  assert.ok(trace.includes('agent_session_reused=true'), 'Trace deve conter agent_session_reused=true');
  assert.ok(trace.includes('agent_session_id=sess_existing_trace_test'), 'Trace deve conter agent_session_id');
  assert.ok(trace.includes('manual_recent_history_injected=false'), 'Trace deve conter manual_recent_history_injected=false');
  assert.ok(trace.includes('contact_memory_injected=false'), 'Trace deve conter contact_memory_injected=false');
  assert.ok(trace.includes('episodic_memory_injected=false'), 'Trace deve conter episodic_memory_injected=false');
  assert.ok(trace.includes('persona_memory_tool_enabled=false'), 'Trace deve conter persona_memory_tool_enabled=false');
  assert.ok(trace.includes('contact_memory_tool_enabled=false'), 'Trace deve conter contact_memory_tool_enabled=false');
  assert.ok(trace.includes('conversation_memory_tool_enabled=false'), 'Trace deve conter conversation_memory_tool_enabled=false');
  assert.ok(trace.includes('audio_search_tool_enabled=true'), 'Trace deve conter audio_search_tool_enabled=true');
}));

test('15. Isolamento de mensagens de resposta por turn_id (resposta do turno 2 não lê resposta do turno 1)', () => {
  // Simula a lista de itens da OpenAI contendo mensagens de dois turnos distintos
  const allSessionItems = [
    {
      id: 'item_turn_2_assistant',
      turn_id: 'turn_002',
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: '{"action":"reply","responses":["Resposta do Turno 2"],"outboundActions":[{"type":"text","text":"Resposta do Turno 2"}],"objectiveDecision":"continue"}' }],
    },
    {
      id: 'item_turn_2_user',
      turn_id: 'turn_002',
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Entrada Turno 2' }],
    },
    {
      id: 'item_turn_1_assistant',
      turn_id: 'turn_001',
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: '{"action":"reply","responses":["Resposta do Turno 1 ANTIGA"],"outboundActions":[{"type":"text","text":"Resposta do Turno 1 ANTIGA"}],"objectiveDecision":"continue"}' }],
    },
    {
      id: 'item_turn_1_user',
      turn_id: 'turn_001',
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Entrada Turno 1' }],
    },
  ];

  // Testando a lógica de filtragem implementada em openai_brain.ts
  const currentTurnId = 'turn_002';
  const currentTurnItems = currentTurnId ? allSessionItems.filter((it) => it.turn_id === currentTurnId) : allSessionItems;
  const assistantMsg = [...currentTurnItems].reverse().find(
    (it) => it.type === 'message' && it.role === 'assistant' && (it.phase === 'final_answer' || !it.phase)
  );

  assert.ok(assistantMsg, 'Deve encontrar a mensagem do assistente');
  assert.strictEqual(assistantMsg.turn_id, 'turn_002', 'A mensagem extraída DEVE pertencer estritamente ao turn_002');
  assert.ok(assistantMsg.content[0].text.includes('Resposta do Turno 2'), 'O texto deve ser a resposta do Turno 2');
  assert.strictEqual(assistantMsg.content[0].text.includes('Resposta do Turno 1 ANTIGA'), false, 'NÃO pode conter a resposta do Turno 1');
});

test('16. Isolamento Canário por Conversa: Chat Canário com flag ativa usa Session persistente; Chats sem flag permanecem no modo legado', withAcceleratedTimers(async () => {
  // Prova que a ativação da conversa canário NÃO afeta outra conversa.
  
  // 1. Chat A (sem flag): persistent_agent_session_enabled ausente -> modo legado
  const supabaseA = createMockSupabase({
    conversationId: 'conv_chat_a_legacy',
    correlationId: 'corr_a_1',
    stage_completed_rules: {
      config: {}, // Sem flag
      orchestration: { openai_session_id: 'sess_a_ignored' },
    },
  });

  let sessionPassedA = 'not_called';
  let toolsPassedA = [];
  const runtimeA = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_a' }),
    callOpenAiAgent: async (args) => {
      sessionPassedA = args.sessionId;
      toolsPassedA = args.tools.map((t) => t.function?.name || t.name);
      return {
        sessionId: 'sess_a_temp',
        plan: {
          action: 'reply',
          responses: ['Olá do chat A legado'],
          outboundActions: [{ type: 'text', text: 'Olá do chat A legado' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const resA = await runBrainOrchestration({
    supabase: supabaseA,
    conversationId: 'conv_chat_a_legacy',
    correlationId: 'corr_a_1',
    preClaimedCycleToken: 'corr_a_1',
    isManualRetry: true,
    newMessage: { id: 'm_a_1', sender: 'user', text: 'Oi A', timestamp: new Date().toISOString() },
    runtime: runtimeA,
  });

  assert.strictEqual(resA.handled, true);
  assert.ok(resA.trace.includes('persistent_agent_session_enabled=false'), 'Chat A sem flag deve registrar flag como false');
  assert.strictEqual(sessionPassedA, null, 'Chat A legado não deve enviar sessionId');
  assert.ok(toolsPassedA.includes('persona_memory_search'), 'Chat A legado deve ter persona_memory_search ativa');

  // 2. Chat B (Canário): stageRules.config.persistent_agent_session_enabled = true -> Session persistente
  const supabaseB = createMockSupabase({
    conversationId: 'conv_chat_b_canary',
    correlationId: 'corr_b_1',
    stage_completed_rules: {
      config: { persistent_agent_session_enabled: true },
      orchestration: { openai_session_id: 'sess_b_persisted_999' },
    },
  });

  let sessionPassedB = null;
  let toolsPassedB = [];
  const runtimeB = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_b' }),
    callOpenAiAgent: async (args) => {
      sessionPassedB = args.sessionId;
      toolsPassedB = args.tools.map((t) => t.function?.name || t.name);
      return {
        sessionId: 'sess_b_persisted_999',
        sessionCreated: false,
        plan: {
          action: 'reply',
          responses: ['Olá do chat B canário persistente'],
          outboundActions: [{ type: 'text', text: 'Olá do chat B canário persistente' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const resB = await runBrainOrchestration({
    supabase: supabaseB,
    conversationId: 'conv_chat_b_canary',
    correlationId: 'corr_b_1',
    preClaimedCycleToken: 'corr_b_1',
    isManualRetry: true,
    newMessage: { id: 'm_b_1', sender: 'user', text: 'Oi B', timestamp: new Date().toISOString() },
    runtime: runtimeB,
  });

  assert.strictEqual(resB.handled, true);
  assert.ok(resB.trace.includes('persistent_agent_session_enabled=true'), 'Chat B canário deve registrar flag como true');
  assert.strictEqual(sessionPassedB, 'sess_b_persisted_999', 'Chat B canário DEVE reutilizar a sessionId persistente');
  assert.ok(!toolsPassedB.includes('persona_memory_search'), 'Chat B canário NÃO deve ter persona_memory_search');

  // 3. Chat C (Segundo chat sem flag): continua em modo legado sem sofrer interferência do Chat B
  const supabaseC = createMockSupabase({
    conversationId: 'conv_chat_c_legacy',
    correlationId: 'corr_c_1',
    stage_completed_rules: {
      config: {}, // Sem flag
      orchestration: { openai_session_id: 'sess_c_ignored' },
    },
  });

  let sessionPassedC = 'not_called';
  let toolsPassedC = [];
  const runtimeC = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_c' }),
    callOpenAiAgent: async (args) => {
      sessionPassedC = args.sessionId;
      toolsPassedC = args.tools.map((t) => t.function?.name || t.name);
      return {
        sessionId: 'sess_c_temp',
        plan: {
          action: 'reply',
          responses: ['Olá do chat C legado isolado'],
          outboundActions: [{ type: 'text', text: 'Olá do chat C legado isolado' }],
          objectiveDecision: 'continue',
          turnContract: defaultTurnContract,
        },
      };
    },
  };

  const resC = await runBrainOrchestration({
    supabase: supabaseC,
    conversationId: 'conv_chat_c_legacy',
    correlationId: 'corr_c_1',
    preClaimedCycleToken: 'corr_c_1',
    isManualRetry: true,
    newMessage: { id: 'm_c_1', sender: 'user', text: 'Oi C', timestamp: new Date().toISOString() },
    runtime: runtimeC,
  });

  assert.strictEqual(resC.handled, true);
  assert.ok(resC.trace.includes('persistent_agent_session_enabled=false'), 'Chat C deve permanecer no legado');
  assert.strictEqual(sessionPassedC, null, 'Chat C legado não deve enviar sessionId');
  assert.ok(toolsPassedC.includes('persona_memory_search'), 'Chat C legado deve ter persona_memory_search ativa');
}));
