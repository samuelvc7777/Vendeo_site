import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBrainOrchestration,
} from '../supabase/functions/api/brain_orchestrator.ts';
import {
  runOpenAiBrainTurn,
  executeOpenAiAppTool,
} from '../supabase/functions/api/openai_brain.ts';
import {
  normalizeOpenAiUsage,
  OpenAiCycleUsageAccumulator,
} from '../supabase/functions/api/openai_usage.ts';
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
} from '../supabase/functions/api/openai_agent_instructions.ts';

// --------------------------------------------------------------------------
// Helper para acelerar timers de debounce/espera
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
// Helper para criar mock do Supabase totalmente compatível com o orquestrador
// --------------------------------------------------------------------------
function createMockSupabase(initialState = {}) {
  const defaultConvId = initialState.conversationId || 'conv_fixes_test';
  const correlationId = initialState.correlationId || ('corr_fixes_' + Date.now());
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
      },
      orchestration: {
        currentStageId: 'stage_1_conexao',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_feita',
        stageChecklist: {
          goals: defaultStages[0].goals,
          currentObjective: defaultStages[0].goals[0],
        },
        openai_session_id: initialState.initialSessionId !== undefined ? initialState.initialSessionId : null,
        openai_session_kind: initialState.initialSessionId ? 'persistent' : null,
        persistent_session_version: initialState.initialSessionId ? 1 : null,
      },
      active_cycle_token: correlationId,
    },
  };

  const store = {
    conversations: {
      [defaultConvId]: convRecord,
    },
    messages: [
      {
        id: 'msg_ti_1',
        conversation_id: defaultConvId,
        sender_id: 'user_ti',
        is_from_me: false,
        text: 'Eu trabalho com TI, e vc?',
        created_at: new Date().toISOString(),
      },
    ],
    audio_delivery_history: [],
    persona_audios: [
      {
        id: 'audio_1790186508570_ctlg1',
        title: 'Áudio sobre oque faço da vida',
        audio_url: 'https://storage.vendeo.com/audios/profissao.mp3',
        audioUrl: 'https://storage.vendeo.com/audios/profissao.mp3',
        transcript: 'Oie, então, eu trabalho em casa com confecção e venda de biquínis online na minha loja! É bem corrido mas eu amo, e agora to fazendo uma rifa pra me ajudar na faculdade de Biomedicina...',
        full_transcript: 'Oie, então, eu trabalho em casa com confecção e venda de biquínis online na minha loja! É bem corrido mas eu amo, e agora to fazendo uma rifa pra me ajudar na faculdade de Biomedicina...',
        when_to_use: 'Quando o pretendente perguntar com o que a Larissa trabalha, profissão, ocupação ou o que faz da vida.',
        usage_instruction: 'Quando o pretendente perguntar com o que a Larissa trabalha, profissão, ocupação ou o que faz da vida.',
        duration: 38,
        is_active: true,
        enabled: true,
      },
    ],
    persona_memory: [
      {
        persona_id: 'larissa',
        category: 'identity',
        key: 'relationship_state',
        value: 'solteira',
        source_type: 'canonical',
        confidence: 1,
        aliases: ['estado civil'],
      },
    ],
    chat_stages: defaultStages,
    instagram_config: [
      { id: 'openai_api_key', app_secret: 'sk-mock-key' },
      { id: 'openai_brain_agent_id', app_secret: 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482' },
      { id: 'openai_brain_default_model', app_secret: 'gpt-6-sol' },
      { id: 'openai_brain_reasoning_effort', app_secret: 'medium' },
    ],
  };

  const publishedStates = [];
  const outboxEntries = [];

  const client = {
    getPublishedStates: () => publishedStates,
    getOutboxEntries: () => outboxEntries,
    getStoredSessionId: () => convRecord.stage_completed_rules?.orchestration?.openai_session_id,
    channel: () => ({
      send: async (msg) => {
        if (msg?.payload) {
          publishedStates.push(msg.payload);
        }
      },
      subscribe: () => ({}),
    }),
    from: (table) => {
      let conditions = [];
      let updatePayload = null;

      const queryBuilder = {
        select: (cols) => queryBuilder,
        eq: (col, val) => {
          conditions.push({ col, val, op: 'eq' });
          return queryBuilder;
        },
        neq: () => queryBuilder,
        in: (col, vals) => {
          conditions.push({ col, vals, op: 'in' });
          return queryBuilder;
        },
        order: () => queryBuilder,
        limit: () => queryBuilder,
        range: () => queryBuilder,
        filter: () => queryBuilder,
        update: (payload) => {
          updatePayload = payload;
          return queryBuilder;
        },
        insert: (records) => {
          const arr = Array.isArray(records) ? records : [records];
          if (table === 'chat_autopilot_states') {
            publishedStates.push(...arr);
          }
          if (table === 'agent_outbox') {
            outboxEntries.push(...arr);
          }
          return {
            select: () => Promise.resolve({ data: arr, error: null }),
            then: (resolve) => resolve({ data: arr, error: null }),
          };
        },
        upsert: (records) => {
          const arr = Array.isArray(records) ? records : [records];
          if (table === 'chat_autopilot_states') {
            publishedStates.push(...arr);
          }
          return {
            select: () => Promise.resolve({ data: arr, error: null }),
            then: (resolve) => resolve({ data: arr, error: null }),
          };
        },
        delete: () => queryBuilder,
        maybeSingle: async () => {
          if (table === 'instagram_conversations') {
            const idCond = conditions.find((c) => c.col === 'id');
            const rec = idCond ? store.conversations[idCond.val] : convRecord;
            return { data: rec || null, error: null };
          }
          if (table === 'conversation_stage_checkpoints') {
            return { data: { checkpoint_id: 'chk_saudacao_feita', satisfied_goals: [] }, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          const res = await queryBuilder.maybeSingle();
          return res;
        },
        then: (resolve, reject) => {
          if (updatePayload && table === 'instagram_conversations') {
            const idCond = conditions.find((c) => c.col === 'id');
            if (idCond && store.conversations[idCond.val]) {
              const target = store.conversations[idCond.val];
              if (updatePayload.stage_completed_rules) {
                target.stage_completed_rules = {
                  ...target.stage_completed_rules,
                  ...updatePayload.stage_completed_rules,
                  orchestration: {
                    ...target.stage_completed_rules?.orchestration,
                    ...updatePayload.stage_completed_rules?.orchestration,
                  },
                };
              }
            }
            return resolve({ data: null, error: null });
          }

          if (table === 'instagram_config') {
            const inCond = conditions.find((c) => c.op === 'in' && c.col === 'id');
            if (inCond) {
              const matched = store.instagram_config.filter((cfg) => inCond.vals.includes(cfg.id));
              return resolve({ data: matched, error: null });
            }
            return resolve({ data: store.instagram_config, error: null });
          }

          if (table === 'instagram_messages') {
            return resolve({ data: store.messages, error: null });
          }

          if (table === 'persona_audios') {
            return resolve({ data: store.persona_audios, error: null });
          }

          if (table === 'persona_memory') {
            return resolve({ data: store.persona_memory, error: null });
          }

          if (table === 'conversation_stages') {
            return resolve({ data: store.chat_stages, error: null });
          }

          return resolve({ data: [], error: null });
        },
      };

      return queryBuilder;
    },
    rpc: async (fn, args) => {
      if (
        fn === 'claim_experimental_cycle' ||
        fn === 'claim_autopilot_cycle' ||
        fn === 'claim_experimental_cycle_atomic'
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
      if (fn === 'claim_experimental_cycle_messages_atomic' || fn === 'claim_experimental_cycle_messages') {
        const conv = store.conversations[args.p_conversation_id || defaultConvId];
        if (conv) {
          conv.stage_completed_rules.active_cycle_token = args.p_cycle_token;
        }
        const claimedId = args?.p_claimed_ids?.[0] || 'msg_1';
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
      if (fn === 'prepare_experimental_outbox_entry') {
        return {
          data: {
            success: true,
            reason: 'prepared',
            outboxKey: args?.p_outbox_entry?.idempotencyKey,
          },
          error: null,
        };
      }
      if (fn === 'claim_outbox_entry_atomic' || fn === 'claim_outbox_entry') {
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
        fn === 'commit_experimental_cycle_if_owned' ||
        fn === 'commit_experimental_cycle_atomic' ||
        fn === 'commit_autopilot_cycle_atomic'
      ) {
        const conv = store.conversations[args.p_conversation_id || defaultConvId];
        if (conv && args.p_new_stage_completed_rules) {
          conv.stage_completed_rules = args.p_new_stage_completed_rules;
        }
        return { data: { success: true, committed: true, active_token: null }, error: null };
      }
      if (fn === 'release_experimental_cycle_if_owned' || fn === 'release_experimental_cycle_atomic') {
        return { data: { released: true, reason: 'released' }, error: null };
      }
      if (fn === 'claim_unprocessed_inbound_batch') {
        const unproc = store.messages.filter((m) => !m.is_from_me);
        return {
          data: {
            claimed_count: unproc.length,
            claimed_messages: unproc.map((m) => ({
              id: m.id,
              text: m.text,
              created_at: m.created_at,
              sender_id: m.sender_id,
            })),
            correlation_id: correlationId,
          },
          error: null,
        };
      }
      if (fn === 'check_cycle_authority') {
        return { data: { valid: true }, error: null };
      }
      if (fn === 'reserve_audio_delivery') {
        return { data: { success: true, reservation_id: 'res_1' }, error: null };
      }
      if (fn === 'release_audio_delivery_reservation') {
        return { data: { success: true }, error: null };
      }
      return { data: { success: true, committed: true }, error: null };
    },
  };

  return client;
}

// ============================================================================
// TESTES DO BUG 1 — TELEMETRIA NÃO CUMULATIVA DO TURN
// ============================================================================

test('BUG 1 — Telemetria do Turn: Turn isolado é a autoridade estrita de custo; Session usage acumulado não polui o ciclo', async () => {
  // Cenário Matemático Comprovado em Produção:
  // Turn 1: input=43.157, output=3.085, total=46.242
  // Turn 2: input=27.113, output=2.814, total=29.927
  // Session Total Acumulado: 76.169 (43.157+27.113=70.270 input, 3.085+2.814=5.899 output)
  // O Turn 2 DEVE registrar exatamente 29.927 tokens para o ciclo, e 76.169 apenas em session_usage_total

  const turn2Usage = {
    input_tokens: 27113,
    output_tokens: 2814,
    total_tokens: 29927,
    input_tokens_details: {
      cached_tokens: 24576,
      cache_write_tokens: 0,
    },
    output_tokens_details: {
      reasoning_tokens: 1024,
    },
  };

  const sessionCumulativeUsage = {
    input_tokens: 70270,
    output_tokens: 5899,
    total_tokens: 76169,
  };

  const mockSessionTelemetry = {
    sessionId: 'sess_turn_test_1',
    model: 'gpt-6-sol',
    sessionUsage: sessionCumulativeUsage,
    currentTurnId: 'turn_2_active',
    generationIds: ['gen_2_active'],
    turns: [
      {
        id: 'turn_1_past',
        status: 'completed',
        usage: {
          input_tokens: 43157,
          output_tokens: 3085,
          total_tokens: 46242,
        },
      },
      {
        id: 'turn_2_active',
        status: 'completed',
        usage: turn2Usage,
      },
    ],
  };

  // 1. Testa o agregador de usage da sessão
  const cycleUsage = new OpenAiCycleUsageAccumulator('cycle_test_1', 5.65);
  cycleUsage.addAgentSession(mockSessionTelemetry);
  const cycleSummary = cycleUsage.snapshot();

  // Prova matemática: o ciclo consumiu EXATAMENTE o Turn 2 (29.927), JAMAIS a soma (76.169)
  assert.ok(cycleSummary, 'Snapshot de usage deve existir');
  assert.equal(cycleSummary.totalTokens, 29927, 'Total de tokens do ciclo DEVE ser 29.927 (Turn 2), e não 76.169');
  assert.equal(cycleSummary.inputTokens, 27113, 'Input tokens DEVE ser 27.113');
  assert.equal(cycleSummary.outputTokens, 2814, 'Output tokens DEVE ser 2.814');
  assert.equal(cycleSummary.cachedInputTokens, 24576, 'Cached input tokens DEVE ser 24.576');
  assert.equal(cycleSummary.uncachedInputTokens, 27113 - 24576, 'Uncached input tokens DEVE ser 2.537');
  assert.equal(cycleSummary.reasoningTokens, 1024, 'Reasoning tokens DEVE ser 1.024');

  // 2. Testa com runOpenAiBrainTurn via mock runtime injetado
  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_turn_test',
    sessionId: 'sess_turn_test_1',
    persistentSessionEnabled: true,
    inboundMessages: ['Eu trabalho com TI, e vc?'],
    model: 'gpt-6-sol',
    reasoningEffort: 'medium',
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Pretendente perguntou sobre profissão',
          responses: ['Trabalho com biquínis online!'],
          turnContract: {
            mustAnswerFirst: true,
            newQuestionBudget: 1,
            responseShape: 'answer_and_reciprocate',
            directQuestions: ['e vc?'],
            maxBalloons: 1,
          },
        },
        turnUsage: turn2Usage,
        sessionUsage: sessionCumulativeUsage,
        turnId: 'turn_2_active',
      }),
    },
  });

  assert.equal(turnResult.telemetry.totalTokens, 29927, 'turnResult.telemetry.totalTokens DEVE ser 29.927');
  assert.equal(turnResult.telemetry.turnTotalTokens, 29927, 'turnResult.telemetry.turnTotalTokens DEVE ser 29.927');
  assert.equal(turnResult.telemetry.turnInputTokens, 27113, 'turnResult.telemetry.turnInputTokens DEVE ser 27.113');
  assert.equal(turnResult.telemetry.turnCachedInputTokens, 24576, 'turnCachedInputTokens DEVE ser 24.576');
  assert.equal(turnResult.telemetry.turnReasoningTokens, 1024, 'turnReasoningTokens DEVE ser 1.024');
  assert.equal(turnResult.telemetry.sessionUsageTotal, 76169, 'sessionUsageTotal DEVE registrar o total acumulado da Session (76.169)');
  assert.equal(turnResult.telemetry.tokenMeasurement, 'turn', 'tokenMeasurement DEVE ser "turn"');
});

test('BUG 1 — Ausência de Turn Usage marca token_measurement=unavailable sem inventar tokens nem somar histórico', async () => {
  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_turn_unavail',
    sessionId: 'sess_turn_unavail_1',
    persistentSessionEnabled: true,
    inboundMessages: ['Oi'],
    model: 'gpt-6-sol',
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Turn sem usage reportado',
          responses: ['Oi!'],
          turnContract: {
            mustAnswerFirst: false,
            newQuestionBudget: 0,
            responseShape: 'friendly',
            directQuestions: [],
            maxBalloons: 1,
          },
        },
        turnId: 'turn_unavail_1',
        tokenMeasurement: 'unavailable',
      }),
    },
  });

  assert.equal(turnResult.telemetry.tokenMeasurement, 'unavailable', 'tokenMeasurement DEVE ser "unavailable"');
  assert.equal(turnResult.telemetry.totalTokens, 0, 'Total tokens DEVE ser 0 quando indisponível');
  assert.equal(turnResult.telemetry.turnTotalTokens, null, 'turnTotalTokens DEVE ser null');
});

// ============================================================================
// TESTES DO BUG 2 — SINCRONIZAÇÃO IDEMPOTENTE DE CONFIGURAÇÃO (SOL vs LUNA)
// ============================================================================

test('BUG 2 — Mismatch Sol/Luna: Detecta divergência entre config da Session e Vendeo, sincroniza sem recriar a Session', async () => {
  // Session na OpenAI guardou Luna/XHigh
  // Vendeo foi configurado para Sol/Medium
  // O backend DEVE sincronizar a sessão existente mantendo o mesmo sessionId

  const sessionIdOriginal = 'sess_persisted_luna_123';

  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_sync_test',
    sessionId: sessionIdOriginal,
    persistentSessionEnabled: true,
    inboundMessages: ['Opa!'],
    model: 'gpt-6-sol',
    reasoningEffort: 'medium',
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Turno de teste de sincronização',
          responses: ['Oi!'],
          turnContract: {
            mustAnswerFirst: false,
            newQuestionBudget: 0,
            responseShape: 'friendly',
            directQuestions: [],
            maxBalloons: 1,
          },
        },
        existingSessionConfig: {
          model: 'gpt-6-luna',
          reasoning: { effort: 'xhigh' },
        },
      }),
    },
  });

  assert.equal(turnResult.telemetry.agentSessionConfigChecked, true, 'agentSessionConfigChecked DEVE ser true');
  assert.equal(turnResult.telemetry.agentSessionModelRequested, 'gpt-6-sol', 'Model requested DEVE ser gpt-6-sol');
  assert.equal(turnResult.telemetry.agentSessionReasoningRequested, 'medium', 'Reasoning requested DEVE ser medium');
  assert.equal(turnResult.telemetry.agentSessionConfigUpdated, true, 'agentSessionConfigUpdated DEVE ser true');
  assert.equal(turnResult.telemetry.agentSessionModelActual, 'gpt-6-sol', 'Model actual DEVE ser gpt-6-sol após sincronização');
  assert.equal(turnResult.telemetry.sessionId, sessionIdOriginal, 'sessionId original DEVE ser preservado');
});

test('BUG 2 — Sessão já sincronizada não dispara update desnecessário', async () => {
  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_sync_noop_test',
    sessionId: 'sess_already_sol_456',
    persistentSessionEnabled: true,
    inboundMessages: ['Tudo bem?'],
    model: 'gpt-6-sol',
    reasoningEffort: 'medium',
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Turno já sincronizado',
          responses: ['Tudo bem e vc?'],
          turnContract: {
            mustAnswerFirst: false,
            newQuestionBudget: 1,
            responseShape: 'reciprocal',
            directQuestions: [],
            maxBalloons: 1,
          },
        },
        existingSessionConfig: {
          model: 'gpt-6-sol',
          reasoning: { effort: 'medium' },
        },
      }),
    },
  });

  assert.equal(turnResult.telemetry.agentSessionConfigChecked, true, 'agentSessionConfigChecked DEVE ser true');
  assert.equal(turnResult.telemetry.agentSessionConfigUpdated, false, 'agentSessionConfigUpdated DEVE ser false');
  assert.equal(turnResult.telemetry.agentSessionModelActual, 'gpt-6-sol');
});

// ============================================================================
// TESTES DO BUG 3 — PRINCÍPIO DO COFRE E DEDUPLICAÇÃO DE FERRAMENTAS
// ============================================================================

test('BUG 3 — Princípio do Cofre: Cenário real onde pretendente pergunta profissão ("Eu trabalho com TI, e vc?") e Agent seleciona áudio', async () => {
  // O pretendente pergunta: "Eu trabalho com TI, e vc?"
  // cofre_audio_search retorna áudio sobre a profissão da Larissa (áudio longo, falando da loja de biquíni e rifa)
  // O Agent seleciona o áudio e complementa em texto apenas sobre o TI, sem repetir o áudio

  const mockAudioCandidate = {
    audioId: 'audio_1790186508570_ctlg1',
    title: 'Áudio sobre oque faço da vida',
    transcript: 'Oie, então, eu trabalho em casa com confecção e venda de biquínis online na minha loja! É bem corrido mas eu amo, e agora to fazendo uma rifa pra me ajudar na faculdade de Biomedicina...',
    whenToUse: 'Quando o pretendente perguntar com o que a Larissa trabalha, profissão, ocupação ou o que faz da vida.',
    duration: 38,
  };

  const seenToolCallIds = new Set();
  const telemetry = {
    toolsRequested: [],
    toolExecutionsCount: 0,
    sourcesUsed: [],
  };

  // 1. Executa a app tool cofre_audio_search
  const appToolRes = await executeOpenAiAppTool({
    toolName: 'cofre_audio_search',
    toolArgs: { query: 'oque faço da vida trabalho profissao' },
    callId: 'call_audio_search_999',
    telemetry,
    seenToolCallIds,
    searchCofreAudios: async () => [mockAudioCandidate],
  });

  assert.equal(appToolRes.success, true, 'cofre_audio_search DEVE ter sucesso');
  assert.equal(appToolRes.output.count, 1, 'Candidato DEVE ser retornado');
  assert.equal(telemetry.toolsRequested.length, 1, 'Deve registrar exatamente 1 chamada de ferramenta');
  assert.equal(telemetry.toolsRequested[0], 'cofre_audio_search');
  assert.equal(seenToolCallIds.has('call_audio_search_999'), true, 'seenToolCallIds DEVE registrar o call_id');

  // 2. Executa uma segunda tentativa com o mesmo callId (deduplicação estrita)
  await executeOpenAiAppTool({
    toolName: 'cofre_audio_search',
    toolArgs: { query: 'oque faço da vida trabalho profissao' },
    callId: 'call_audio_search_999',
    telemetry,
    seenToolCallIds,
    searchCofreAudios: async () => [mockAudioCandidate],
  });

  // NÃO pode duplicar na telemetria!
  assert.equal(telemetry.toolsRequested.length, 1, 'Reexecução com mesmo callId NÃO DEVE duplicar em toolsRequested');
  assert.equal(telemetry.toolExecutionsCount, 1, 'toolExecutionsCount DEVE permanecer 1');

  // 3. Testa o Agent formulando a resposta com áudio + complemento de texto no modo mock
  const turnResult = await runOpenAiBrainTurn({
    conversationId: 'conv_audio_ti_test',
    sessionId: 'sess_audio_ti_1',
    persistentSessionEnabled: true,
    inboundMessages: ['Eu trabalho com TI, e vc?'],
    model: 'gpt-6-sol',
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Pretendente perguntou sobre profissão e falou que trabalha com TI. O áudio do Cofre responde perfeitamente o que a Larissa faz da vida. Seleciono o áudio e reajo ao gancho de TI em texto sem repetir o áudio.',
          outboundActions: [
            { type: 'audio', audioId: 'audio_1790186508570_ctlg1' },
            { type: 'text', text: 'ahh TI, que chic haha! Deve quebrar a cabeça o dia todo né kkk' },
          ],
          responses: ['ahh TI, que chic haha! Deve quebrar a cabeça o dia todo né kkk'],
          turnContract: {
            mustAnswerFirst: true,
            newQuestionBudget: 1,
            responseShape: 'answer_and_reciprocate',
            directQuestions: ['e vc?'],
            maxBalloons: 1,
          },
        },
      }),
    },
  });

  assert.ok(turnResult.plan, 'Plano deve existir');
  assert.equal(turnResult.plan.outboundActions?.length, 2, 'DEVE conter áudio e texto nas outboundActions');
  assert.equal(turnResult.plan.outboundActions[0].type, 'audio');
  assert.equal(turnResult.plan.outboundActions[0].audioId, 'audio_1790186508570_ctlg1');
  assert.equal(turnResult.plan.outboundActions[1].type, 'text');
  // Prova que o texto complementar não repetiu a loja/biquíni/faculdade do áudio
  assert.equal(turnResult.plan.outboundActions[1].text.includes('biquíni'), false, 'Texto complementar NÃO DEVE repetir o áudio');
  assert.equal(turnResult.plan.outboundActions[1].text.includes('TI'), true, 'Texto complementar DEVE reagir ao gancho de TI');
});

test('BUG 3 — Instruções do Agent contêm o Princípio do Cofre e proibições expressas de rejeição por tamanho ou divulgação', () => {
  const instructions = buildCanonicalAgentInstructions('agent_larissa_main');
  assert.match(VENDEO_AGENT_INSTRUCTIONS_VERSION, /^\d+\.\d+\.\d+$/, 'Versão das instructions DEVE seguir semver');

  // Verifica as diretrizes inseridas
  assert.equal(instructions.includes('PRINCÍPIO FUNDAMENTAL DO COFRE'), true);
  assert.equal(instructions.includes('FATORES QUE NÃO SÃO MOTIVO PARA REJEIÇÃO'), true);
  assert.equal(instructions.includes('O áudio ser longo ou durar mais de 30-40 segundos'), true);
  assert.equal(instructions.includes('menção à rifa para custear a faculdade'), true);
  assert.equal(instructions.includes('REGRA DE OURO DO COMPLEMENTO EM TEXTO'), true);
  assert.equal(instructions.includes('NUNCA REPETIR EM TEXTO O CONTEÚDO QUE JÁ ESTÁ SENDO DITO NO ÁUDIO'), true);
});

// ============================================================================
// TESTE INTEGRADO END-TO-END DO ORQUESTRADOR
// ============================================================================

test('END-TO-END — Ciclo completo no orquestrador: Turn usage, modelo executado/configurado e traces corretos', withAcceleratedTimers(async () => {
  const correlationId = 'cycle_e2e_fixes_1';
  const supabase = createMockSupabase({
    conversationId: 'conv_e2e_fixes',
    initialSessionId: 'sess_e2e_persisted_777',
    correlationId,
  });
  const orchestratorResult = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_e2e_fixes',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_1',
      sender: 'user',
      text: 'Oi Larissa!',
      timestamp: new Date().toISOString(),
    },
    runtime: {
      callOpenAiAgent: async () => ({
        plan: {
          action: 'reply',
          objectiveDecision: 'pursue',
          reasoning: 'Ciclo completo end-to-end com sessão persistente',
          responses: ['Com certeza!'],
          turnContract: {
            mustAnswerFirst: false,
            newQuestionBudget: 1,
            responseShape: 'reciprocal',
            directQuestions: [],
            maxBalloons: 1,
          },
        },
        turnUsage: {
          input_tokens: 27113,
          output_tokens: 2814,
          total_tokens: 29927,
          input_tokens_details: { cached_tokens: 24576 },
        },
        sessionUsage: {
          total_tokens: 76169,
        },
        turnId: 'turn_e2e_1',
      }),
      sendMetaTextMessage: async () => ({ message_id: 'meta_mock_123' }),
    },
    inboundCount: 1,
  });

  assert.equal(orchestratorResult.handled, true, 'Ciclo DEVE ser tratado com sucesso');
  const trace = orchestratorResult.trace || [];

  // Traces obrigatórios presentes
  assert.equal(trace.includes('persistent_agent_session_active=true'), true);
  assert.equal(trace.includes('agent_session_reused=true'), true);
  assert.equal(trace.some(t => t.startsWith('agent_session_config_checked=true')), true);
  assert.equal(trace.some(t => t.startsWith('turn_total_tokens=29927')), true);
  assert.equal(trace.some(t => t.startsWith('session_usage_total=76169')), true);

  // Prova que publicou o evento brain_decision com os metadados ricos de modelo
  const published = supabase.getPublishedStates();
  const allEvents = published.flatMap(p => p.cycleEvents || []);
  const decisionEvents = allEvents.filter(e => e.event === 'brain_decision');
  assert.equal(decisionEvents.length > 0, true, 'Deve ter publicado brain_decision');
  const meta = decisionEvents[0].metadata;
  assert.ok(meta.model, 'Deve ter model no metadata');
  assert.ok(meta.configuredModel, 'Deve ter configuredModel no metadata');
  assert.ok(meta.executedModel, 'Deve ter executedModel no metadata');
}));
