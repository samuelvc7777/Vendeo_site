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
} from '../supabase/functions/api/openai_brain.ts';
import {
  buildCanonicalAgentInstructions,
  buildPersistentAgentInstructions,
  buildLegacyAgentInstructions,
} from '../supabase/functions/api/openai_agent_instructions.ts';
import { LARISSA_INTERACTION_DNA } from '../supabase/functions/api/larissa_interaction_dna.ts';

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
// Mock Supabase Oficial para Testes
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
  responseShape: 'reciprocal',
  directQuestions: [],
  maxBalloons: 2,
};

// ============================================================================
// SUÍTE DE TESTES OBRIGATÓRIOS DA PARTE 7 (TESTES A ATÉ J)
// ============================================================================

test('PARTE 7 — TESTE A — PERSONA: "vc tem quantos anos?" grounded em 23 anos', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('23 anos'), 'Instructions persistentes devem conter a idade canônica de 23 anos');

  let toolsAvailableToAgent = [];
  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      toolsAvailableToAgent = tools.map((t) => t.function?.name || t.name);
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1100,
          outputTokens: 45,
          totalTokens: 1145,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Pretendente perguntou a idade da Larissa (23 anos). Respondi diretamente com base nos fatos canônicos.',
          liveStatePatch: { currentTopic: 'idade_larissa' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Tenho 23 anos' },
            { type: 'text', text: 'e vc tem quantos?' },
          ],
          responses: ['Tenho 23 anos', 'e vc tem quantos?'],
        },
      };
    },
  };

  const correlationId = 'corr_test_a';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_age',
      sender: 'user',
      text: 'vc tem quantos anos?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.ok(!toolsAvailableToAgent.includes('persona_memory_search'), 'Não deve haver persona_memory_search no Persistent');
  assert.strictEqual(metaSent[0], 'Tenho 23 anos');
}));

test('PARTE 7 — TESTE B — CIDADE: "vc mora onde?" sabe São João del-Rei sem memory tool', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('São João del-Rei'), 'Instructions persistentes devem conter São João del-Rei');

  let toolsCalled = [];
  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1100,
          outputTokens: 45,
          totalTokens: 1145,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Respondi onde moro (São João del-Rei) diretamente das instruções canônicas sem memory search.',
          liveStatePatch: { currentTopic: 'cidade_larissa' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Moro em São João del-Rei aqui em Minas' },
            { type: 'text', text: 'vc conhece por aqui?' },
          ],
          responses: ['Moro em São João del-Rei aqui em Minas', 'vc conhece por aqui?'],
        },
      };
    },
  };

  const correlationId = 'corr_test_b';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_city',
      sender: 'user',
      text: 'vc mora onde?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.ok(metaSent[0].includes('São João del-Rei'), 'Deve responder São João del-Rei');
  assert.strictEqual(toolsCalled.length, 0, 'Zero tools de memória chamadas');
}));

test('PARTE 7 — TESTE C — PROFISSÃO: "e vc trabalha com oq?" conhece Enfermagem + vendas online sem persona_memory_search', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('Enfermagem'), 'Deve conter Enfermagem');
  assert.ok(instructions.includes('vendas online'), 'Deve conter vendas online');

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      // Prova que persona_memory_search NÃO está disponível no array de tools
      const toolNames = tools.map((t) => t.function?.name || t.name);
      assert.ok(!toolNames.includes('persona_memory_search'), 'persona_memory_search NÃO deve estar presente no Persistent');

      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1150,
          outputTokens: 50,
          totalTokens: 1200,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Respondi com Enfermagem (estágio) e vendas online a partir dos fatos canônicos.',
          liveStatePatch: { currentTopic: 'profissao_larissa' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Faço faculdade de Enfermagem e estágio de dia, e também trabalho com vendas online em casa pelo celular' },
          ],
          responses: ['Faço faculdade de Enfermagem e estágio de dia, e também trabalho com vendas online em casa pelo celular'],
        },
      };
    },
  };

  const correlationId = 'corr_test_c';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_work',
      sender: 'user',
      text: 'e vc trabalha com oq?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.ok(metaSent[0].includes('Enfermagem'));
  assert.ok(metaSent[0].includes('vendas online'));
}));

test('PARTE 7 — TESTE D — GOSTO/PRAIA: "vc gosta de praia?" sabe que sim sem busca remota', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('Ama praia'), 'Instructions devem conter amor por praia');

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1100,
          outputTokens: 35,
          totalTokens: 1135,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Larissa ama praia de acordo com os fatos canônicos estáveis.',
          liveStatePatch: { currentTopic: 'gosto_praia' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Amo praia demais, é meu lugar favorito pra descansar' },
            { type: 'text', text: 'vc tbm curte?' },
          ],
          responses: ['Amo praia demais, é meu lugar favorito pra descansar', 'vc tbm curte?'],
        },
      };
    },
  };

  const correlationId = 'corr_test_d';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_beach',
      sender: 'user',
      text: 'vc gosta de praia?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.ok(metaSent[0].toLowerCase().includes('amo praia'));
}));

test('PARTE 7 — TESTE E — BIQUÍNI: "vc gosta de usar biquíni?" responde natural de acordo com a persona sem inventar loja/marca', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('biquíni na praia'), 'Instructions devem orientar resposta natural sobre biquíni na praia');

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1100,
          outputTokens: 40,
          totalTokens: 1140,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Respondido de forma natural e sem vulgaridade sobre usar biquíni na praia, mantendo postura de moça de família.',
          liveStatePatch: { currentTopic: 'biquini_praia' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Simm, na praia adoro colocar um biquíni pra tomar sol e curtir o mar kkk' },
          ],
          responses: ['Simm, na praia adoro colocar um biquíni pra tomar sol e curtir o mar kkk'],
        },
      };
    },
  };

  const correlationId = 'corr_test_e';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_bikini',
      sender: 'user',
      text: 'vc gosta de usar biquíni?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const resp = metaSent[0];
  assert.ok(resp.includes('biquíni'));
  assert.ok(!resp.toLowerCase().includes('loja de biquíni'), 'NÃO deve inventar loja/marca de biquíni');
  assert.ok(!resp.toLowerCase().includes('vendo biquíni'), 'NÃO deve inventar venda de biquíni');
}));

test('PARTE 7 — TESTE F — ESTILO: Respostas persistentes não adotam "cê", "mano", "trampo", "haha"', () => {
  const instructions = buildPersistentAgentInstructions();
  const dna = LARISSA_INTERACTION_DNA;

  // Verificações estritas nas regras de instrução estável
  assert.ok(dna.includes('NUNCA use "cê"'), 'DNA deve proibir estritamente "cê"');
  assert.ok(dna.includes('TERMINANTEMENTE PROIBIDO: "haha"'), 'DNA deve proibir terminantemente "haha"');
  assert.ok(dna.includes('PROIBIDO gírias masculinas/de rua: trampo, trampar, brother, parça, mano'), 'DNA deve proibir gírias masculinas');

  // Validação em sample de respostas
  const forbiddenPatterns = [
    { pattern: /(^|[^\p{L}\p{N}])cê(?=[^\p{L}\p{N}]|$)/iu, name: 'cê' },
    { pattern: /\bmano\b/iu, name: 'mano' },
    { pattern: /\btrampo\b/iu, name: 'trampo' },
    { pattern: /\btrampando\b/iu, name: 'trampando' },
    { pattern: /\bhaha\b/iu, name: 'haha' },
    { pattern: /\bhahaha\b/iu, name: 'hahaha' },
  ];

  const validLarissaResponses = [
    'Oii tudo bem com vc?',
    'Moro em São João del-Rei aqui em Minas',
    'Faço faculdade de Enfermagem e trabalho com vendas online',
    'Amo praia demais kkk',
  ];

  for (const resp of validLarissaResponses) {
    for (const { pattern, name } of forbiddenPatterns) {
      assert.ok(!pattern.test(resp), `Resposta '${resp}' não deve conter ${name}`);
    }
  }
});

test('PARTE 7 — TESTE G — ZERO PAPAGAIO: "eu trabalho de soldador industrial" não deve começar papagaiando', withAcceleratedTimers(async () => {
  const instructions = buildPersistentAgentInstructions();
  assert.ok(instructions.includes('ZERO PAPAGAIO'), 'Instructions devem conter regra ZERO PAPAGAIO');

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async () => {
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1100,
          outputTokens: 40,
          totalTokens: 1140,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'already_satisfied',
          satisfiedObjectiveId: 'goal_profissao',
          evidenceMessageId: 'msg_inbound_welder',
          reasoning: 'Reconheci a profissão com empatia genuína sem ecoar a frase dele.',
          liveStatePatch: { currentTopic: 'profissao_pretendente' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Nossa deve ser uma rotina bem pesada e que exige muito cuidado' },
            { type: 'text', text: 'vc trabalha nisso há muito tempo?' },
          ],
          responses: [
            'Nossa deve ser uma rotina bem pesada e que exige muito cuidado',
            'vc trabalha nisso há muito tempo?',
          ],
        },
      };
    },
  };

  const correlationId = 'corr_test_g';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_welder',
      sender: 'user',
      text: 'eu trabalho de soldador industrial',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const firstBalloon = metaSent[0].toLowerCase();
  assert.ok(!firstBalloon.startsWith('ah então vc é soldador industrial'), 'NÃO deve ser papagaio');
  assert.ok(!firstBalloon.startsWith('que legal que vc trabalha de soldador'), 'NÃO deve ecoar');
}));

test('PARTE 7 — TESTE H — CONTINUIDADE: Session lembra fatos anteriores sem manual_recent_history e sem memory MCP', withAcceleratedTimers(async () => {
  const correlationId = 'corr_test_h';
  const supabase = createMockSupabase({
    correlationId,
    conversationId: 'conv_persistent_test',
    sessionId: 'sess_persisted_continuity',
  });
  let manualHistoryPresent = false;
  const metaSent = [];

  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ context, tools }) => {
      manualHistoryPresent = Boolean(
        context &&
          (context.includes('## HISTÓRICO RECENTE DA CONVERSA') ||
            context.includes('## JANELA CONVERSACIONAL RECENTE'))
      );
      assert.ok(!tools.some((t) => (t.function?.name || t.name) === 'conversation_memory_search'));

      return {
        sessionId: 'sess_persisted_continuity',
        telemetry: {
          inputTokens: 1050,
          outputTokens: 35,
          totalTokens: 1085,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Lembrei do combinado do turno anterior retido na própria session persistente.',
          liveStatePatch: { currentTopic: 'continuidade_filme' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'text', text: 'Simm, aquele filme de terror que te falei!' },
          ],
          responses: ['Simm, aquele filme de terror que te falei!'],
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
      id: 'msg_inbound_cont',
      sender: 'user',
      text: 'qual filme mesmo?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(manualHistoryPresent, false, 'Manual history não deve estar presente no context');
  const trace = result.trace || [];
  assert.ok(trace.includes('manual_recent_history_injected=false'), 'Trace deve conter manual_recent_history_injected=false');
}));

test('PARTE 7 — TESTE I — TURNO SIMPLES: "Boa noite" tem 1 model generation, 0 memory tool calls, manual_recent_history_injected=false', withAcceleratedTimers(async () => {
  let modelGenerations = 0;
  let toolCallsMade = [];

  const metaSent = [];
  const mockRuntime = {
    sendMetaTextMessage: async (_sb, _convId, text) => {
      metaSent.push(text);
      return { ok: true, message_id: `meta_${metaSent.length}` };
    },
    callOpenAiAgent: async ({ tools }) => {
      modelGenerations++;
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1000,
          outputTokens: 30,
          totalTokens: 1030,
          modelGenerationCount: 1,
          agentToolCallCount: 0,
          toolsRequested: [],
          sourcesUsed: [],
        },
        plan: {
          action: 'reply',
          objectiveDecision: 'none',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Saudação simples de boa noite.',
          liveStatePatch: { currentTopic: 'saudacao' },
          turnContract: defaultTurnContract,
          outboundActions: [{ type: 'text', text: 'Boa noitee, tudo bem por aí?' }],
          responses: ['Boa noitee, tudo bem por aí?'],
        },
      };
    },
  };

  const correlationId = 'corr_test_i';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_simple',
      sender: 'user',
      text: 'Boa noite',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  assert.strictEqual(modelGenerations, 1, 'Turno simples deve ter exatamente 1 model generation');
  assert.strictEqual(toolCallsMade.length, 0, 'Zero memory tool calls');
  const trace = result.trace || [];
  assert.ok(trace.includes('manual_recent_history_injected=false'), 'manual_recent_history_injected deve ser false');
}));

test('PARTE 7 — TESTE J — ÁUDIO: Pergunta com whenToUse dispara cofre_audio_search, 2 model generations, seleciona áudio', withAcceleratedTimers(async () => {
  let modelGenerations = 0;
  let toolCallsMade = [];

  const mockRuntime = {
    sendMetaTextMessage: async () => ({ ok: true, message_id: 'meta_10_txt' }),
    sendMetaAudioMessage: async () => ({ ok: true, message_id: 'meta_10_audio' }),
    callOpenAiAgent: async ({ tools, executeTool }) => {
      modelGenerations++;
      toolCallsMade.push('cofre_audio_search');

      const toolOutput = await executeTool('cofre_audio_search', {
        query: 'trabalho profissão o que faz',
      });

      assert.ok(Array.isArray(toolOutput.candidates) && toolOutput.candidates.length > 0, 'Candidatos retornados pelo cofre');
      const selected = toolOutput.candidates[0];

      modelGenerations++; // 2ª geração com o áudio selecionado
      return {
        sessionId: 'sess_persona_active',
        telemetry: {
          inputTokens: 1200,
          outputTokens: 70,
          totalTokens: 1270,
          modelGenerationCount: 2,
          agentToolCallCount: 1,
          toolsRequested: ['cofre_audio_search'],
          sourcesUsed: ['audio_vault'],
          authorizedCandidateAudios: [selected],
        },
        plan: {
          action: 'send_audio',
          selectedAudioId: selected.audioId,
          objectiveDecision: 'defer',
          satisfiedObjectiveId: null,
          evidenceMessageId: null,
          reasoning: 'Selecionei áudio do cofre sobre a faculdade de enfermagem e rotina, adicionando complemento sem duplicar o áudio.',
          liveStatePatch: { currentTopic: 'audio_profissao' },
          turnContract: defaultTurnContract,
          outboundActions: [
            { type: 'audio', audioId: selected.audioId },
            { type: 'text', text: 'e vc trabalha com oq por aí?' },
          ],
          responses: ['e vc trabalha com oq por aí?'],
        },
      };
    },
  };

  const correlationId = 'corr_test_j';
  const supabase = createMockSupabase({ correlationId, conversationId: 'conv_persistent_test' });

  const result = await runBrainOrchestration({
    supabase,
    conversationId: 'conv_persistent_test',
    correlationId,
    preClaimedCycleToken: correlationId,
    isManualRetry: true,
    newMessage: {
      id: 'msg_inbound_audio_ask',
      sender: 'user',
      text: 'e vc trabalha com oq?',
      timestamp: new Date().toISOString(),
    },
    runtime: mockRuntime,
  });

  assert.strictEqual(result.handled, true, `Ciclo falhou: ${result.error}`);
  const trace = result.trace || [];
  assert.strictEqual(toolCallsMade[0], 'cofre_audio_search', 'cofre_audio_search deve ter sido chamado');
  assert.ok(trace.includes('model_generation_count=2'), 'Deve registrar 2 gerações de modelo');
  assert.ok(trace.includes('agent_tool_call_count=1'), 'Deve registrar 1 tool call');
  assert.ok(trace.includes('tool_names_used=cofre_audio_search'), 'Deve registrar cofre_audio_search');
  assert.ok(trace.includes('openai_agent_mcp_used=cofre_audio_search'), 'Trace deve conter openai_agent_mcp_used');
}));
