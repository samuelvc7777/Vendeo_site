import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBrainOrchestration,
  buildTemporalContext,
} from '../supabase/functions/api/brain_orchestrator.ts';
import {
  runOpenAiBrainTurn,
  buildOpenAiBrainContextMessageWithObservability,
  buildPersistentTurnContext,
  COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  PERSONA_MEMORY_TOOL_DEFINITION,
  CONTACT_MEMORY_TOOL_DEFINITION,
  CONVERSATION_MEMORY_TOOL_DEFINITION,
} from '../supabase/functions/api/openai_brain.ts';
import {
  buildCanonicalAgentInstructions,
  buildPersistentAgentInstructions,
  buildLegacyAgentInstructions,
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

// --------------------------------------------------------------------------
// Mock Supabase Oficial para Testes de Orquestração
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
          id: 'goal_profissao',
          label: 'Descobrir profissão',
          description: 'Saber no que a pessoa trabalha ou rotina',
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
        openai_session_id: initialState.sessionId || null,
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
        id: 'audio_1790186840264_d5rqh',
        title: 'Larissa falando sobre sua faculdade e rotina',
        audio_url: 'https://storage.vendeo.com/audios/profissao.mp3',
        audioUrl: 'https://storage.vendeo.com/audios/profissao.mp3',
        transcript: 'Oie, então, eu faço faculdade de Enfermagem com estágio no hospital de dia e aula à noite, e também trabalho em casa com vendas online pelo celular...',
        full_transcript: 'Oie, então, eu faço faculdade de Enfermagem com estágio no hospital de dia e aula à noite, e também trabalho em casa com vendas online pelo celular...',
        when_to_use: 'Quando perguntarem com o que trabalho ou minha profissão',
        usage_instruction: 'Quando perguntarem com o que trabalho ou minha profissão',
        duration: 15,
        is_active: true,
        enabled: true,
      },
    ],
    chat_stages: defaultStages,
    instagram_config: [
      { id: 'openai_api_key', app_secret: 'sk-mock-key-for-tests' },
      { id: 'openai_brain_agent_id', app_secret: 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482' },
      { id: 'openai_brain_default_model', app_secret: 'gpt-6-sol' },
      { id: 'openai_brain_reasoning_effort', app_secret: 'medium' },
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
            Object.assign(store.conversations[defaultConvId], updatePayload);
          }
          if (selectedTable === 'instagram_config') {
            return Promise.resolve({ data: store.instagram_config, error: null }).then(resolve);
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
  mustAnswerFirst: true,
  newQuestionBudget: 1,
  responseShape: 'natural',
  directQuestions: [],
  maxBalloons: 2,
};

// ============================================================================
// SUÍTE DE TESTES: REDUÇÃO DE TOKENS E PERSISTENT BRAIN
// ============================================================================

test('PARTE 10.1 — Cenário Caro Atual: "Boa noite" em modo persistente executa 1 Agent Turn com 1 única geração de modelo e 0 memory tool calls', withAcceleratedTimers(async () => {
  const correlationId = 'corr_boa_noite_1';
  const supabase = createMockSupabase({
    correlationId,
    conversationId: 'conv_persistent_test',
    sessionId: 'sess_persisted_boa_noite',
  });

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools, executeTool, context }) => {
      // Prova que as tools disponíveis para o Agent NÃO contêm ferramentas de memória
      const toolNames = tools.map((t) => t.function?.name || t.name);
      assert.strictEqual(toolNames.includes('persona_memory_search'), false, 'persona_memory_search não deve existir nas tools');
      assert.strictEqual(toolNames.includes('contact_memory_search'), false, 'contact_memory_search não deve existir nas tools');
      assert.strictEqual(toolNames.includes('conversation_memory_search'), false, 'conversation_memory_search não deve existir nas tools');
      assert.strictEqual(toolNames.includes('cofre_audio_search'), true, 'cofre_audio_search deve existir nas tools');

      // O Agent responde diretamente a "Boa noite", avançando com gancho e pergunta de profissão
      return {
        sessionId: 'sess_persisted_boa_noite',
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Pretendente deu boa noite. Respondi com simpatia e perguntei sobre trabalho.',
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'boa noitee tudo bem' },
            { type: 'text', text: 'vc trabalha com oq?' },
          ],
          responses: ['boa noitee tudo bem', 'vc trabalha com oq?'],
        },
        turnUsage: {
          input_tokens: 3200,
          cached_tokens: 2800,
          output_tokens: 120,
          reasoning_tokens: 80,
          total_tokens: 3320,
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
      text: 'Boa noite',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(metaSent.length, 2);
  assert.strictEqual(metaSent[1], 'vc trabalha com oq?');

  const trace = result.trace || [];
  // 1. persistent_agent_session_enabled=true
  assert.ok(trace.includes('persistent_agent_session_enabled=true'), 'Deve estar em persistent mode');

  // 2. Histórico manual e memórias NÃO injetados
  assert.ok(trace.includes('manual_recent_history_injected=false'), 'manual_recent_history_injected deve ser false');
  assert.ok(trace.includes('contact_memory_injected=false'), 'contact_memory_injected deve ser false');
  assert.ok(trace.includes('episodic_memory_injected=false'), 'episodic_memory_injected deve ser false');

  // 3. Memory tools desabilitadas
  assert.ok(trace.includes('persona_memory_tool_enabled=false'), 'persona_memory_tool_enabled deve ser false');
  assert.ok(trace.includes('contact_memory_tool_enabled=false'), 'contact_memory_tool_enabled deve ser false');
  assert.ok(trace.includes('conversation_memory_tool_enabled=false'), 'conversation_memory_tool_enabled deve ser false');
  assert.ok(trace.includes('audio_search_tool_enabled=true'), 'audio_search_tool_enabled deve ser true');

  // 4. Model generation count = 1 e agent_tool_call_count = 0
  assert.ok(trace.includes('model_generation_count=1'), 'Deve haver exatamente 1 geração de modelo');
  assert.ok(trace.includes('agent_tool_call_count=0'), 'Deve haver 0 chamadas de tool');
  assert.ok(trace.includes('tool_names_used=none'), 'Nenhuma tool deve ter sido chamada');

  // 5. Nenhuma chamada de MCP registrada
  assert.strictEqual(trace.some((t) => t.includes('openai_agent_mcp_used')), false, 'Nenhum MCP deve ter sido usado');
}));

test('PARTE 10.2 — Cenário de Pergunta sobre Profissão ("e vc trabalha com oq?"): cofre_audio_search é chamado, tool loop permitido, áudio selecionado', withAcceleratedTimers(async () => {
  const correlationId = 'corr_pergunta_profissao_1';
  const supabase = createMockSupabase({
    correlationId,
    conversationId: 'conv_persistent_test',
    sessionId: 'sess_persisted_audio_search',
  });

  const mockAudioCandidate = {
    audioId: 'audio_1790186840264_d5rqh',
    title: 'Larissa falando sobre sua faculdade e rotina',
    transcript: 'Oie, então, eu faço faculdade de Enfermagem com estágio no hospital de dia e aula à noite, e também trabalho em casa com vendas online pelo celular...',
    whenToUse: 'Quando perguntarem com o que trabalho ou minha profissão',
    duration: 15,
  };

  let toolCalls = [];
  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    sendMetaAudioMessage: async (_sb, convId, audioUrl) => {
      return { ok: true, message_id: `audio_out_${audioUrl}` };
    },
    callOpenAiAgent: async ({ tools, executeTool }) => {
      // 1ª passagem do modelo: decide buscar áudio no cofre
      toolCalls.push('cofre_audio_search');
      const toolOutput = await executeTool('cofre_audio_search', {
        query: 'trabalho profissão o que faz',
      });

      assert.ok(Array.isArray(toolOutput.candidates) && toolOutput.candidates.length > 0, 'Cofre deve retornar áudios candidatos');

      // 2ª passagem do modelo: gera plano final com o áudio selecionado e texto de apoio sem duplicar
      return {
        sessionId: 'sess_persisted_audio_search',
        telemetry: {
          authorizedCandidateAudios: [mockAudioCandidate],
          toolsRequested: ['cofre_audio_search'],
          sourcesUsed: ['audio_vault'],
        },
        plan: {
          action: 'send_audio',
          selectedAudioId: 'audio_1790186840264_d5rqh',
          objectiveDecision: 'defer',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Pretendente perguntou sobre meu trabalho. Selecionei áudio autêntico do cofre.',
          turnContract: {
            mustAnswerFirst: true,
            newQuestionBudget: 0,
            responseShape: 'natural',
            directQuestions: ['e vc trabalha com oq?'],
            maxBalloons: 2,
          },
          outboundActions: [
            { type: 'audio', audioId: 'audio_1790186840264_d5rqh' },
            { type: 'text', text: 'e vc, tá gostando de lá?' },
          ],
          responses: ['e vc, tá gostando de lá?'],
        },
        turnUsage: {
          input_tokens: 3800,
          cached_tokens: 2800,
          output_tokens: 150,
          reasoning_tokens: 90,
          total_tokens: 3950,
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
      text: 'e vc trabalha com oq?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const trace = result.trace || [];
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0], 'cofre_audio_search');

  // Model generation count = 2 (modelo -> tool -> modelo)
  assert.ok(trace.includes('model_generation_count=2'), 'Deve registrar 2 gerações de modelo devido à chamada de áudio');
  assert.ok(trace.includes('agent_tool_call_count=1'), 'Deve registrar 1 tool call');
  assert.ok(trace.includes('tool_names_used=cofre_audio_search'), 'Deve registrar cofre_audio_search como tool usada');
  assert.ok(trace.includes('openai_agent_mcp_used=cofre_audio_search'), 'Trace deve conter mcp used cofre_audio_search');
}));

test('PARTE 10.3 — Cenário Continuidade ("kkk"): Session lembra turno anterior, não repete pergunta e não chama memory search', withAcceleratedTimers(async () => {
  const correlationId = 'corr_continuidade_1';
  const supabase = createMockSupabase({
    correlationId,
    conversationId: 'conv_persistent_test',
    sessionId: 'sess_persisted_continuidade',
  });

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools, executeTool, context }) => {
      // Garante que o contexto não injetou histórico manual gigante
      assert.strictEqual(context.includes('## JANELA CONVERSACIONAL RECENTE'), false);

      // O Agent lembra naturalmente da Session e não repete a pergunta
      return {
        sessionId: 'sess_persisted_continuidade',
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Usuário só riu com kkk. Mantive o assunto vivo com leveza.',
          turnContract: {
            mustAnswerFirst: false,
            newQuestionBudget: 0,
            responseShape: 'natural',
            directQuestions: [],
            maxBalloons: 1,
          },
          outboundActions: [
            { type: 'text', text: 'é sério kkk' },
          ],
          responses: ['é sério kkk'],
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
      id: 'msg_inbound_3',
      sender: 'user',
      text: 'kkk',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(metaSent[0], 'é sério kkk');

  const trace = result.trace || [];
  assert.ok(trace.includes('model_generation_count=1'), 'Apenas 1 geração de modelo');
  assert.ok(trace.includes('agent_tool_call_count=0'), '0 chamadas de tool');
  assert.strictEqual(trace.some((t) => t.includes('conversation_memory_search')), false, 'Nenhuma busca de memória');
}));

test('PARTE 10.4 — Cenário Session Longa: Vários turnos, sessão reutilizada, sem manual history e sem bootstrap de recovery', withAcceleratedTimers(async () => {
  const correlationId = 'corr_longa_1';
  const supabase = createMockSupabase({
    correlationId,
    conversationId: 'conv_persistent_test',
    stage_completed_rules: {
      openai_session_id: 'sess_existing_long_thread',
      orchestration: {
        openai_session_id: 'sess_existing_long_thread',
      },
    },
  });

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_out_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ sessionId, context }) => {
      assert.strictEqual(sessionId, 'sess_existing_long_thread', 'Deve reutilizar a mesma sessão');
      assert.strictEqual(context.includes('## JANELA CONVERSACIONAL RECENTE'), false);

      return {
        sessionId: 'sess_existing_long_thread',
        plan: {
          action: 'reply',
          objectiveDecision: 'defer',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Continuando conversa longa na mesma sessão persistente.',
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'nossa imagino!' },
            { type: 'text', text: 'e deu tudo certo no final?' },
          ],
          responses: ['nossa imagino!', 'e deu tudo certo no final?'],
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
      id: 'msg_inbound_long_4',
      sender: 'user',
      text: 'foi bem cansativo o dia hoje',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const trace = result.trace || [];
  assert.ok(trace.includes('agent_session_reused=true'), 'Sessão deve ser reutilizada');
  assert.ok(trace.includes('agent_session_recovery_triggered=false'), 'Recovery não deve ser disparado');
  assert.ok(trace.includes('agent_session_bootstrap_injected=false'), 'Bootstrap não deve ser injetado em turno normal');
  assert.ok(trace.includes('manual_recent_history_injected=false'), 'Histórico manual não deve ser injetado');
}));

test('PARTE 11 — Meta de Redução: Comparação matemática de Chars e Tokens (Antes vs Depois)', () => {
  const legacyInstructions = buildLegacyAgentInstructions();
  const persistentInstructions = buildPersistentAgentInstructions();

  const dummyParams = {
    conversationId: 'conv_bench_123',
    currentStageId: 'stage_1_conexao',
    currentObjectiveId: 'goal_job',
    currentObjectiveLabel: 'Descobrir profissão',
    currentObjectiveDescription: 'Entender no que ele trabalha',
    currentInboundMessages: [
      { id: 'msg_bench_1', text: 'Boa noite', createdAt: new Date().toISOString() },
    ],
    temporalContext: '## CONTEXTO TEMPORAL ATUAL\ntimezone: America/Sao_Paulo\nlocal_time: 21:00\ndaypart: noite',
  };

  const legacyContextObj = buildOpenAiBrainContextMessageWithObservability({
    ...dummyParams,
    persistentSessionEnabled: false,
    inboundMessages: ['Boa noite'],
  });

  const persistentContextObj = buildOpenAiBrainContextMessageWithObservability({
    ...dummyParams,
    persistentSessionEnabled: true,
  });

  const legacyInstChars = legacyInstructions.length;
  const persistentInstChars = persistentInstructions.length;
  const legacyInstTokens = Math.ceil(legacyInstChars / 4);
  const persistentInstTokens = Math.ceil(persistentInstChars / 4);

  const legacyCtxChars = legacyContextObj.contextMessage.length;
  const persistentCtxChars = persistentContextObj.contextMessage.length;
  const legacyCtxTokens = Math.ceil(legacyCtxChars / 4);
  const persistentCtxTokens = Math.ceil(persistentCtxChars / 4);

  const legacyToolsChars = JSON.stringify([
    PERSONA_MEMORY_TOOL_DEFINITION,
    CONTACT_MEMORY_TOOL_DEFINITION,
    CONVERSATION_MEMORY_TOOL_DEFINITION,
    COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  ]).length;

  const persistentToolsChars = JSON.stringify([
    COFRE_AUDIO_SEARCH_TOOL_DEFINITION,
  ]).length;

  const legacyToolsTokens = Math.ceil(legacyToolsChars / 4);
  const persistentToolsTokens = Math.ceil(persistentToolsChars / 4);

  const turnContextReduction = ((legacyCtxChars - persistentCtxChars) / legacyCtxChars) * 100;
  const instructionsReduction = ((legacyInstChars - persistentInstChars) / legacyInstChars) * 100;
  const toolsReduction = ((legacyToolsChars - persistentToolsChars) / legacyToolsChars) * 100;

  console.log('\n======================================================');
  console.log('RELATÓRIO COMPARATIVO DE REDUÇÃO DE TOKENS & PAYLOAD:');
  console.log('======================================================');
  console.log(`1. AGENT INSTRUCTIONS:`);
  console.log(`   - Antes (Legacy):      ${legacyInstChars.toLocaleString()} chars (~${legacyInstTokens.toLocaleString()} tokens)`);
  console.log(`   - Depois (Persistent):  ${persistentInstChars.toLocaleString()} chars (~${persistentInstTokens.toLocaleString()} tokens)`);
  console.log(`   - Redução:              ${instructionsReduction.toFixed(1)}%`);
  console.log(`\n2. TURN CONTEXT (PAYLOAD INCREMENTAL DO TURNO "Boa noite"):`);
  console.log(`   - Antes (Legacy):      ${legacyCtxChars.toLocaleString()} chars (~${legacyCtxTokens.toLocaleString()} tokens)`);
  console.log(`   - Depois (Persistent):  ${persistentCtxChars.toLocaleString()} chars (~${persistentCtxTokens.toLocaleString()} tokens)`);
  console.log(`   - Redução:              ${turnContextReduction.toFixed(1)}%`);
  console.log(`\n3. TOOL SCHEMAS ENVIADOS:`);
  console.log(`   - Antes (Legacy 4 tools):     ${legacyToolsChars.toLocaleString()} chars (~${legacyToolsTokens.toLocaleString()} tokens)`);
  console.log(`   - Depois (Persistent 1 tool):  ${persistentToolsChars.toLocaleString()} chars (~${persistentToolsTokens.toLocaleString()} tokens)`);
  console.log(`   - Redução:                    ${toolsReduction.toFixed(1)}%`);
  console.log(`\n4. PASSAGENS DO MODELO (GENERATIONS NO TURNO SIMPLES):`);
  console.log(`   - Antes (com DISCOVERY GATE provocando tool): 2 gerações (chat -> tool -> chat)`);
  console.log(`   - Depois (modo persistente sem memory tool):   1 geração (chat direto)`);
  console.log(`   - Redução no Turno Simples:                    50% nas gerações do modelo!`);
  console.log('======================================================\n');

  assert.ok(turnContextReduction > 75, `Redução do Turn Context deve ser maior que 75% (foi ${turnContextReduction.toFixed(1)}%)`);
  assert.ok(instructionsReduction > 20, `Redução das instruções deve ser maior que 20% (foi ${instructionsReduction.toFixed(1)}%)`);
  assert.ok(toolsReduction > 70, `Redução de schemas de tools deve ser maior que 70% (foi ${toolsReduction.toFixed(1)}%)`);
});

test('PARTE 13 — Compatibilidade Legacy: Se persistent_agent_session_enabled for false, mantém modo legado intacto', () => {
  const legacyInstructions = buildCanonicalAgentInstructions({ persistentMode: false });
  assert.ok(legacyInstructions.includes('persona_memory_search'), 'Modo legado deve conter persona_memory_search');
  assert.ok(legacyInstructions.includes('DISCOVERY-QUESTION MEMORY GATE'), 'Modo legado deve conter DISCOVERY GATE');

  const legacyCtx = buildOpenAiBrainContextMessageWithObservability({
    conversationId: 'conv_legacy_check',
    currentStageId: 'stage_1_conexao',
    currentObjectiveId: 'goal_job',
    inboundMessages: ['olá'],
    persistentSessionEnabled: false,
    contactMemorySummary: 'Mora em SP',
  });

  assert.ok(legacyCtx.contextMessage.includes('## FATOS CONHECIDOS DO PRETENDENTE'), 'Modo legado deve incluir FATOS CONHECIDOS');
  assert.ok(legacyCtx.contextMessage.includes('## INSTRUÇÃO OPERACIONAL DO TURNO'), 'Modo legado deve incluir instrução operacional legada');
});
