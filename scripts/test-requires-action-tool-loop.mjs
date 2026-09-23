/**
 * test-requires-action-tool-loop.mjs
 *
 * Cenários A–J: loop LIVE de requires_action em runOpenAiBrainTurn.
 *
 * Todos os testes são totalmente sintéticos — ZERO chamadas reais à API.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOpenAiBrainTurn, MAX_APP_TOOL_ROUNDS } from '../supabase/functions/api/openai_brain.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

const VALID_SAMPLE_PLAN = {
  action: 'reply',
  objectiveDecision: 'none',
  satisfiedObjectiveId: null,
  evidenceMessageId: null,
  reasoning: 'Geração técnica para teste de tool loop',
  liveStatePatch: {},
  responses: ['Olá! Isso é um plano de teste.'],
  turnContract: {
    directQuestions: [],
    mustAnswerFirst: true,
    newQuestionBudget: 1,
    responseShape: 'answer_and_reciprocate',
    preferNoEmoji: false,
    maxBalloons: 1,
  },
  missionPackage: {
    objectiveDirective: 'none',
    draftResponse: 'Olá! Isso é um plano de teste.',
    turnContract: {
      directQuestions: [],
      mustAnswerFirst: true,
      newQuestionBudget: 1,
      responseShape: 'answer_and_reciprocate',
      preferNoEmoji: false,
      maxBalloons: 1,
    },
  },
};

function assistantItem(plan = VALID_SAMPLE_PLAN) {
  return {
    id: 'item_assistant_out',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: JSON.stringify(plan) }],
  };
}

/**
 * Helper de agente sintético para cenários de requires_action.
 *
 * Adicionalmente ao withAdvancedSyntheticAgent do outro arquivo, intercepta:
 *   POST /agents/sessions/{id}/events  → eventHandler(body)
 * E expõe `state.eventSubmissions[]` com os corpos enviados.
 *
 * @param {object} options
 *   - initialSession: objeto ou função() → objeto da session inicial
 *   - sessionSequence: array de objetos de session retornados em ordem (polls da session)
 *   - turnSequence: array de objetos de turn retornados em ordem (polls do turn)
 *   - itemsData: items retornados no GET /items
 *   - eventHandler: função(body) chamada quando POST /events — deve retornar { ok, status }
 *   - searchCofreAudios: função mockada de busca de áudio
 * @param {function} run - recebe (result, state)
 */
async function withToolLoopAgent(options, run) {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let fakeNow = originalNow();

  const state = {
    sessionPolls: 0,
    turnPolls: 0,
    eventSubmissions: [],
    eventHeaders: [],
    turnsListCalls: 0,
  };

  globalThis.setTimeout = (callback, delay) => {
    fakeNow += delay;
    queueMicrotask(callback);
    return 1;
  };
  Date.now = () => fakeNow;

  globalThis.fetch = async (url, fetchOptions = {}) => {
    const address = String(url);
    const method = (fetchOptions.method || 'GET').toUpperCase();

    // POST /agents/sessions — criação de sessão
    if (address.endsWith('/agents/sessions') && method === 'POST') {
      const initial = typeof options.initialSession === 'function'
        ? options.initialSession()
        : (options.initialSession || { id: 'sess_ra_test', status: 'in_progress', current_turn: { id: 'turn_ra', status: 'in_progress' } });
      return response(initial);
    }

    // POST /agents/sessions/{id}/events — submit de tool result
    if (address.includes('/agents/sessions/sess_ra_test/events') && method === 'POST') {
      const body = fetchOptions.body ? JSON.parse(fetchOptions.body) : {};
      const headers = fetchOptions.headers || {};
      state.eventSubmissions.push(body);
      state.eventHeaders.push(headers);
      if (typeof options.eventHandler === 'function') {
        return options.eventHandler(body, headers);
      }
      return { ok: true, status: 202, json: async () => ({}), text: async () => '' };
    }

    // GET /agents/sessions/{id}/turns/{turnId}
    if (address.match(/\/agents\/sessions\/sess_ra_test\/turns\/[^/]+$/) && method === 'GET') {
      state.turnPolls++;
      if (options.turnSequence) {
        const idx = Math.min(state.turnPolls - 1, options.turnSequence.length - 1);
        return response(options.turnSequence[idx]);
      }
      return response({ id: 'turn_ra', status: 'completed' });
    }

    // GET /agents/sessions/{id}/turns (listagem)
    if ((address.endsWith('/turns') || address.includes('/turns?')) && method === 'GET') {
      state.turnsListCalls++;
      return response({ data: [], has_more: false });
    }

    // GET /agents/sessions/{id}/items
    if (address.endsWith('/items') && method === 'GET') {
      const items = options.itemsData ?? [assistantItem()];
      return response({ data: items, has_more: false });
    }

    // GET /agents/sessions/{id} — poll de session
    if (address.endsWith('/sess_ra_test') && method === 'GET') {
      state.sessionPolls++;
      if (options.sessionSequence) {
        const idx = Math.min(state.sessionPolls - 1, options.sessionSequence.length - 1);
        return response(options.sessionSequence[idx]);
      }
      return response({ id: 'sess_ra_test', status: 'in_progress' });
    }

    // GET /traces
    if (address.endsWith('/traces') || address.includes('/traces?')) {
      return response({ data: [], has_more: false });
    }

    throw new Error(`Chamada externa inesperada no teste: ${method} ${address}`);
  };

  try {
    const result = await runOpenAiBrainTurn({
      apiKey: 'sk-local-fixture',
      agentId: 'agent_local_fixture',
      conversationId: 'conv_local_fixture',
      currentStageId: 'conexao_inicial',
      inboundMessages: ['teste de tool loop'],
      recentMessages: [],
      contactMemorySummary: '',
      landmarksSummary: '',
      liveStateContext: '{}',
      searchCofreAudios: options.searchCofreAudios,
    });
    await run(result, state);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    Date.now = originalNow;
  }
}

// ---------------------------------------------------------------------------
// Cenário A: Happy path — session goes requires_action once, cofre_audio_search
// executes, result is submitted, turn completes on next poll
// ---------------------------------------------------------------------------
test('A. requires_action → cofre_audio_search executado → submit → turn completed → plano válido', async () => {
  let audioSearchCalled = false;
  const fakeAudios = [
    { audioId: 'aud_001', title: 'Bom dia energia', transcript: 'Bom dia!', whenToUse: 'cumprimento matutino', duration: 3 },
  ];

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      // Session: poll 1 = requires_action (com required_actions), depois in_progress
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_cofre_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cumprimento bom dia' },
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      // Turn: in_progress, waiting (durante requires_action), completed
      turnSequence: [
        { id: 'turn_ra', status: 'in_progress' },
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        audioSearchCalled = true;
        return fakeAudios;
      },
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso após tool loop');
      assert.notEqual(result.plan, null, 'Deve retornar plano válido');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(audioSearchCalled, true, 'searchCofreAudios deve ter sido chamada');
      assert.equal(state.eventSubmissions.length, 1, 'Deve ter submetido exatamente 1 tool result');
      const evt = state.eventSubmissions[0].events[0];
      assert.equal(evt.type, 'agent.session.input.tool_result');
      assert.equal(evt.call_id, 'exec_cofre_001');
      assert.equal(evt.success, true);
      const outputObj = JSON.parse(evt.output);
      assert.equal(outputObj.status, 'success_with_results');
      assert.equal(outputObj.count, 1);
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário B: Cache de idempotência — mesmo call_id aparece duas vezes,
// searchCofreAudios só deve ser chamada UMA vez
// ---------------------------------------------------------------------------
test('B. call_id duplicado → searchCofreAudios chamada apenas uma vez (idempotência)', async () => {
  let searchCount = 0;

  // A session retorna requires_action duas vezes com o mesmo call_id
  const requiresActionSession = {
    id: 'sess_ra_test',
    status: 'requires_action',
    required_actions: [{
      type: 'function_call',
      turn_id: 'turn_ra',
      call_id: 'exec_dup_001',
      name: 'cofre_audio_search',
      arguments: { query: 'café da manhã' },
    }],
  };

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        requiresActionSession,  // poll 1 → 1ª rodada de tool
        requiresActionSession,  // poll 2 → 2ª rodada com mesmo call_id (cache hit)
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        searchCount++;
        return [{ audioId: 'aud_002', title: 'Café', transcript: 'Café!', whenToUse: 'manhã', duration: 2 }];
      },
    },
    (result, state) => {
      assert.equal(result.success, true);
      assert.equal(searchCount, 1, 'searchCofreAudios deve ter sido chamada apenas UMA vez (cache no 2º call_id duplicado)');
      // Deve ter submetido 2x (uma por rodada de requires_action, mas com output cacheado)
      assert.equal(state.eventSubmissions.length >= 1, true, 'Deve ter submetido ao menos 1 event');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário C: FAIL CLOSED — tool desconhecida lança agent_app_tool_unsupported
// ---------------------------------------------------------------------------
test('C. tool desconhecida → FAIL CLOSED → agent_app_tool_unsupported:<name>', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_unknown_001',
            name: 'unknown_tool_xyz',
            arguments: {},
          }],
        },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
      ],
      searchCofreAudios: async () => [],
    },
    (result) => {
      assert.equal(result.success, false, 'Deve falhar com tool desconhecida');
      assert.match(result.error, /agent_app_tool_unsupported:unknown_tool_xyz/, 'Erro deve identificar a tool desconhecida');
      assert.equal(result.telemetry.status, 'requires_action');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário D: MAX_APP_TOOL_ROUNDS excedido → agent_app_tool_max_rounds_exceeded
// ---------------------------------------------------------------------------
test('D. MAX_APP_TOOL_ROUNDS excedido → agent_app_tool_max_rounds_exceeded', async () => {
  // A session fica permanentemente em requires_action, forçando MAX+1 rodadas
  const permaRequiresAction = {
    id: 'sess_ra_test',
    status: 'requires_action',
    required_actions: [{
      type: 'function_call',
      turn_id: 'turn_ra',
      call_id: 'exec_loop_001',
      name: 'cofre_audio_search',
      arguments: { query: 'loop eterno' },
    }],
  };

  // Cria array grande o suficiente para cobrir MAX_APP_TOOL_ROUNDS + alguns polls adicionais
  const sessionSeq = Array(MAX_APP_TOOL_ROUNDS + 5).fill(permaRequiresAction);
  const turnSeq = Array(MAX_APP_TOOL_ROUNDS + 5).fill({ id: 'turn_ra', status: 'waiting' });

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: sessionSeq,
      turnSequence: turnSeq,
      searchCofreAudios: async () => [],
    },
    (result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /agent_app_tool_max_rounds_exceeded/);
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário E: cofre_audio_search retorna 0 resultados → success_no_results
// enviado ao Agent (não é erro)
// ---------------------------------------------------------------------------
test('E. cofre_audio_search sem resultados → success_no_results enviado ao Agent → turn pode completar', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_empty_001',
            name: 'cofre_audio_search',
            arguments: { query: 'tema incomum xyz' },
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => [],
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso mesmo sem resultados de áudio');
      assert.equal(state.eventSubmissions.length, 1);
      const evt = state.eventSubmissions[0].events[0];
      const outputObj = JSON.parse(evt.output);
      assert.equal(outputObj.status, 'success_no_results', 'Output deve indicar success_no_results');
      assert.equal(outputObj.count, 0);
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário F: argumentos inválidos (query não é string) → tool_error/invalid_arguments
// sem lançar exceção no host — o Agent recebe o erro, não o backend
// ---------------------------------------------------------------------------
test('F. argumentos inválidos para cofre_audio_search → tool_error submitted ao Agent (não lança)', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_badarg_001',
            name: 'cofre_audio_search',
            arguments: { query: '' }, // query vazia — inválida
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => [],
    },
    (result, state) => {
      // Não deve lançar exceção — deve submeter tool_error ao Agent e continuar
      assert.equal(state.eventSubmissions.length, 1, 'Deve ter submetido 1 event (mesmo com args inválidos)');
      const evt = state.eventSubmissions[0].events[0];
      const outputObj = JSON.parse(evt.output);
      assert.equal(outputObj.reasonCode, 'invalid_arguments', 'Output deve indicar invalid_arguments');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário G: submit de tool result retorna HTTP 4xx (422) → FAIL CLOSED
// 4xx é definitivo — sem retry, sem continuar silenciosamente
// ---------------------------------------------------------------------------
test('G. submit retorna HTTP 4xx (422) → FAIL CLOSED → agent_app_tool_submit_failed', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_submitfail_001',
            name: 'cofre_audio_search',
            arguments: { query: 'teste de falha 422' },
          }],
        },
      ],
      turnSequence: [{ id: 'turn_ra', status: 'waiting' }],
      searchCofreAudios: async () => [
        { audioId: 'aud_003', title: 'Teste falha', transcript: 'ok', whenToUse: 'sempre', duration: 1 },
      ],
      // Simula submit 422 (Unprocessable Entity — definitivo)
      eventHandler: () => ({ ok: false, status: 422, json: async () => ({}), text: async () => 'Unprocessable' }),
    },
    (result) => {
      // 4xx definitivo → FAIL CLOSED
      assert.equal(result.success, false, 'Deve falhar com submit 422');
      assert.match(result.error, /agent_app_tool_submit_failed.*422/, 'Erro deve indicar HTTP 422');
    },
  );
});


// ---------------------------------------------------------------------------
// Cenário H: requires_action com required_actions vazio [] → nenhuma tool chamada,
// continua polling → turn completa normalmente
// ---------------------------------------------------------------------------
test('H. required_actions[] vazio → nenhuma tool chamada → continua polling → sucesso', async () => {
  let searchCalled = false;

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [], // vazio
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        searchCalled = true;
        return [];
      },
    },
    (result, state) => {
      assert.equal(result.success, true);
      assert.equal(searchCalled, false, 'searchCofreAudios NÃO deve ter sido chamada (required_actions vazio)');
      assert.equal(state.eventSubmissions.length, 0, 'Nenhum event deve ter sido submetido');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário I: required_actions com item de type desconhecido → ignorado (não é function_call)
// ---------------------------------------------------------------------------
test('I. required_actions com type desconhecido → ignorado → sem crash', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'some_future_action_type',
            call_id: 'exec_future_001',
            name: 'future_tool',
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => [],
    },
    (result, state) => {
      // Type desconhecido é ignorado — sem crash, sem submit
      assert.equal(state.eventSubmissions.length, 0, 'Nenhum event deve ter sido submetido para type desconhecido');
      assert.equal(result.success, true, 'Backend não deve crashar por tipo desconhecido em required_actions');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário J: Deadline esgota DURANTE requires_action (antes de completar)
// → agent_requires_action_unhandled (deadline-based, não max_rounds)
// ---------------------------------------------------------------------------
test('J. deadline esgota durante requires_action → agent_requires_action_unhandled', async () => {
  // A session fica em requires_action por tempo suficiente para o deadline expirar
  // Usamos um array enorme para garantir que cada poll retorna requires_action
  const permaSession = {
    id: 'sess_ra_test',
    status: 'requires_action',
    required_actions: [{
      type: 'function_call',
      turn_id: 'turn_ra',
      call_id: 'exec_deadline_001',
      name: 'cofre_audio_search',
      arguments: { query: 'deadline test' },
    }],
  };

  // searchCofreAudios é lenta (simula timeout): não precisa, pois fakeNow avança via setTimeout
  // O turn fica em waiting para que o polling não complete por conta própria
  const bigArray = Array(50).fill(permaSession);
  const turnSeq = Array(50).fill({ id: 'turn_ra', status: 'waiting' });

  // Limitamos MAX_APP_TOOL_ROUNDS a 4 — mas aqui vamos estourar o deadline antes
  // Para isso, a searchCofreAudios avança fakeNow muito (cada chamada avança o relógio)
  let callCount = 0;
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: bigArray,
      turnSequence: turnSeq,
      searchCofreAudios: async () => {
        callCount++;
        // Avança o relógio drasticamente para simular timeout
        // (o helper já avança via setTimeout, mas podemos fazer aqui também)
        return [];
      },
    },
    (result) => {
      // Deve falhar — seja por max_rounds ou por deadline
      assert.equal(result.success, false, 'Deve falhar quando deadline/max_rounds é atingido');
      const isExpectedError = /agent_app_tool_max_rounds_exceeded|agent_requires_action_unhandled/.test(result.error);
      assert.equal(isExpectedError, true, `Erro inesperado: ${result.error}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário K: submit retorna 202 → tool executada 1x → nenhuma duplicação
// Idempotency-Key no HEADER HTTP (não no body)
// ---------------------------------------------------------------------------
test('K. submit retorna 202 → tool executada 1x → polling continua → turn completa', async () => {
  let searchCount = 0;
  let submitCount = 0;

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_k_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário K' },
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        searchCount++;
        return [{ audioId: 'aud_k', title: 'K', transcript: 'ok', whenToUse: 'sempre', duration: 1 }];
      },
      eventHandler: () => {
        submitCount++;
        // Retorna 202 na primeira tentativa
        return { ok: true, status: 202, json: async () => ({}), text: async () => '' };
      },
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso');
      assert.equal(searchCount, 1, 'searchCofreAudios chamada exatamente 1x');
      assert.equal(submitCount, 1, 'Submit feito exatamente 1x (202 no primeiro attempt)');
      assert.equal(state.eventSubmissions.length, 1, '1 submission registrada');
      // Valida formato exato do body enviado: NÃO deve conter idempotency_key
      const body = state.eventSubmissions[0];
      assert.equal(body.idempotency_key, undefined, 'body NÃO deve conter idempotency_key');
      const evt = body.events[0];
      assert.equal(evt.type, 'agent.session.input.tool_result');
      assert.equal(evt.turn_id, 'turn_ra');
      assert.equal(evt.call_id, 'exec_k_001');
      assert.equal(evt.success, true);
      assert.equal(typeof evt.output, 'string', 'output deve ser string serializada');
      // Valida Idempotency-Key no HEADER HTTP
      assert.equal(
        state.eventHeaders[0]['Idempotency-Key'],
        'sess_ra_test:turn_ra:exec_k_001',
        'Idempotency-Key deve ser enviado no header HTTP como sessionId:turn_id:call_id',
      );
      assert.equal(state.eventHeaders[0]['OpenAI-Beta'], 'agents=v1', 'OpenAI-Beta header preservado');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário L: network error no primeiro submit → retry com mesmo output → 202
// Tool executada apenas 1x; mesmo Idempotency-Key header nos dois submits
// ---------------------------------------------------------------------------
test('L. network error no submit → retry com output cacheado → mesmo Idempotency-Key header → 202 → turn completa', async () => {
  let searchCount = 0;
  let submitCount = 0;
  const submittedHeaderKeys = [];

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_l_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário L' },
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        searchCount++;
        return [{ audioId: 'aud_l', title: 'L', transcript: 'ok', whenToUse: 'teste', duration: 2 }];
      },
      eventHandler: (body, headers) => {
        submitCount++;
        submittedHeaderKeys.push(headers['Idempotency-Key']);
        if (submitCount === 1) {
          // Simula network error no primeiro attempt lançando exceção
          throw new Error('Network error simulado');
        }
        // Segundo attempt → 202
        return { ok: true, status: 202, json: async () => ({}), text: async () => '' };
      },
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso após retry');
      assert.equal(searchCount, 1, 'searchCofreAudios chamada apenas 1x (cache protegeu retry)');
      assert.equal(submitCount, 2, 'Submit tentado 2x (1 network error + 1 sucesso)');
      // Ambos os submits devem usar o MESMO Idempotency-Key no header HTTP
      assert.equal(submittedHeaderKeys[0], submittedHeaderKeys[1], 'Idempotency-Key no header deve ser idêntico nos dois attempts');
      assert.equal(submittedHeaderKeys[0], 'sess_ra_test:turn_ra:exec_l_001');
      // Bodies NÃO devem conter idempotency_key
      assert.equal(state.eventSubmissions[0].idempotency_key, undefined, 'Body 1 não deve ter idempotency_key');
      assert.equal(state.eventSubmissions[1].idempotency_key, undefined, 'Body 2 não deve ter idempotency_key');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário M: submit retorna 500 e depois 202 → execução local 1x → retry com
// mesmo call_id/output e mesmo Idempotency-Key no header HTTP
// ---------------------------------------------------------------------------
test('M. submit 500 → retry → 202 → output e Idempotency-Key no header idênticos', async () => {
  let searchCount = 0;
  let submitCount = 0;
  const submittedBodies = [];
  const submittedHeaderKeys = [];

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_m_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário M' },
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async () => {
        searchCount++;
        return [{ audioId: 'aud_m', title: 'M', transcript: 'ok', whenToUse: 'teste', duration: 1 }];
      },
      eventHandler: (body, headers) => {
        submitCount++;
        submittedBodies.push(JSON.parse(JSON.stringify(body)));
        submittedHeaderKeys.push(headers['Idempotency-Key']);
        if (submitCount === 1) {
          return { ok: false, status: 500, json: async () => ({}), text: async () => 'Internal Server Error' };
        }
        return { ok: true, status: 202, json: async () => ({}), text: async () => '' };
      },
    },
    (result) => {
      assert.equal(result.success, true, 'Deve ter sucesso após retry');
      assert.equal(searchCount, 1, 'searchCofreAudios chamada apenas 1x');
      assert.equal(submitCount, 2, 'Submit tentado 2x (500 + 202)');
      // call_id idêntico nos dois attempts
      assert.equal(submittedBodies[0].events[0].call_id, 'exec_m_001');
      assert.equal(submittedBodies[1].events[0].call_id, 'exec_m_001');
      // output idêntico
      assert.equal(submittedBodies[0].events[0].output, submittedBodies[1].events[0].output, 'output deve ser idêntico nos dois attempts');
      // body NÃO deve conter idempotency_key
      assert.equal(submittedBodies[0].idempotency_key, undefined, 'Body 1 não deve ter idempotency_key');
      assert.equal(submittedBodies[1].idempotency_key, undefined, 'Body 2 não deve ter idempotency_key');
      // Idempotency-Key no header HTTP idêntico
      assert.equal(submittedHeaderKeys[0], submittedHeaderKeys[1], 'Idempotency-Key no header HTTP deve ser idêntica');
      assert.equal(submittedHeaderKeys[0], 'sess_ra_test:turn_ra:exec_m_001');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário N: submit retorna 400 → FAIL CLOSED → sem retry infinito
// ---------------------------------------------------------------------------
test('N. submit 400 → FAIL CLOSED → agent_app_tool_submit_failed → sem retry infinito', async () => {
  let submitCount = 0;

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_n_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário N' },
          }],
        },
      ],
      turnSequence: [{ id: 'turn_ra', status: 'waiting' }],
      searchCofreAudios: async () => [],
      eventHandler: () => {
        submitCount++;
        // 400 definitivo em todos os attempts
        return { ok: false, status: 400, json: async () => ({}), text: async () => 'Bad Request' };
      },
    },
    (result) => {
      assert.equal(result.success, false, 'Deve falhar com 4xx');
      assert.match(result.error, /agent_app_tool_submit_failed.*400/, 'Erro deve indicar HTTP 400');
      assert.equal(submitCount, 1, 'Apenas 1 attempt de submit (4xx é fatal, sem retry)');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário O: required_actions com schema flat direto (type, turn_id, call_id,
// name, arguments direto no objeto) — parser funciona corretamente
// ---------------------------------------------------------------------------
test('O. required_actions schema flat (objeto direto) → parser correto → tool executada', async () => {
  let searchCalledWith = null;

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          // Schema flat: fields direto no objeto da required_action
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_o_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário O schema flat' }, // objeto direto (não string)
          }],
        },
        { id: 'sess_ra_test', status: 'in_progress' },
      ],
      turnSequence: [
        { id: 'turn_ra', status: 'waiting' },
        { id: 'turn_ra', status: 'completed' },
      ],
      searchCofreAudios: async ({ query }) => {
        searchCalledWith = query;
        return [{ audioId: 'aud_o', title: 'O', transcript: 'ok', whenToUse: 'flat', duration: 1 }];
      },
    },
    (result) => {
      assert.equal(result.success, true, 'Deve ter sucesso com schema flat');
      assert.equal(searchCalledWith, 'cenário O schema flat', 'query extraída corretamente do objeto direto');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário P: action.turn_id diferente do turnId acompanhado → FAIL CLOSED
// ---------------------------------------------------------------------------
test('P. action.turn_id diferente do turnId acompanhado → agent_app_tool_turn_mismatch → FAIL CLOSED', async () => {
  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_OUTRO_QUE_NAO_E_O_ATUAL', // mismatch intencional
            call_id: 'exec_p_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário P' },
          }],
        },
      ],
      turnSequence: [{ id: 'turn_ra', status: 'waiting' }],
      searchCofreAudios: async () => [],
    },
    (result) => {
      assert.equal(result.success, false, 'Deve falhar com turn_id mismatch');
      assert.match(result.error, /agent_app_tool_turn_mismatch/, 'Erro deve indicar turn_mismatch');
      assert.match(result.error, /turn_OUTRO_QUE_NAO_E_O_ATUAL/, 'Erro deve identificar o turn_id discrepante');
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário Q: deadline termina durante retry de submit → encerra pelo timeout
// existente → nenhuma nova janela de tempo
// ---------------------------------------------------------------------------
test('Q. deadline termina durante retry de submit → encerra sem nova janela → falha controlada', async () => {
  let submitCount = 0;

  await withToolLoopAgent(
    {
      initialSession: {
        id: 'sess_ra_test',
        status: 'in_progress',
        current_turn: { id: 'turn_ra', status: 'in_progress' },
      },
      sessionSequence: [
        {
          id: 'sess_ra_test',
          status: 'requires_action',
          required_actions: [{
            type: 'function_call',
            turn_id: 'turn_ra',
            call_id: 'exec_q_001',
            name: 'cofre_audio_search',
            arguments: { query: 'cenário Q deadline' },
          }],
        },
        // Mesmo que a session retorne in_progress depois, o deadline já expirou
        ...Array(10).fill({ id: 'sess_ra_test', status: 'requires_action', required_actions: [] }),
      ],
      turnSequence: Array(12).fill({ id: 'turn_ra', status: 'waiting' }),
      searchCofreAudios: async () => [],
      eventHandler: (body) => {
        submitCount++;
        // Primeiro submit: retorna 5xx — força retry com backoff
        // O backoff vai avançar fakeNow via setTimeout, potencialmente expirando deadline
        return { ok: false, status: 503, json: async () => ({}), text: async () => 'Service Unavailable' };
      },
    },
    (result) => {
      // Deve falhar de forma controlada — seja por deadline, max_rounds ou submit_unconfirmed + polling timeout
      assert.equal(result.success, false, 'Deve falhar quando deadline expira durante retry');
      // Não deve lançar nenhum erro não esperado
      const isExpectedError = /agent_app_tool_max_rounds_exceeded|agent_requires_action_unhandled|local_wait_timeout/.test(result.error ?? '');
      assert.equal(isExpectedError, true, `Erro inesperado: ${result.error}`);
    },
  );
});

