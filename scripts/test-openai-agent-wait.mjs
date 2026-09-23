import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOpenAiBrainTurn, validateConversationBrainPlan } from '../supabase/functions/api/openai_brain.ts';

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  };
}

const VALID_SAMPLE_PLAN = {
  action: 'reply',
  objectiveDecision: 'none',
  satisfiedObjectiveId: null,
  evidenceMessageId: null,
  reasoning: 'Geração técnica para teste',
  liveStatePatch: {},
  responses: ['Olá! Tudo bem?'],
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
    draftResponse: 'Olá! Tudo bem?',
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

function validAssistantItem(plan = VALID_SAMPLE_PLAN) {
  return {
    id: 'item_assistant_out',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text: JSON.stringify(plan),
      },
    ],
  };
}

async function withAdvancedSyntheticAgent(options, run) {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let fakeNow = originalNow();

  const state = {
    sessionPolls: 0,
    turnPolls: 0,
    itemsCalls: 0,
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

    // POST /agents/sessions
    if (address.endsWith('/agents/sessions') && fetchOptions.method === 'POST') {
      const initialSession = typeof options.initialSession === 'function'
        ? options.initialSession()
        : (options.initialSession || { id: 'sess_local_test', status: 'in_progress' });
      return response(initialSession);
    }

    // GET /agents/sessions/{sessionId}/turns/{turnId}
    if (address.includes('/agents/sessions/sess_local_test/turns/')) {
      state.turnPolls++;
      if (typeof options.turnHandler === 'function') {
        return response(options.turnHandler(state.turnPolls));
      }
      return response(options.turnData || { id: 'turn_default', status: 'completed' });
    }

    // GET /agents/sessions/{sessionId}/turns (listagem)
    if (address.endsWith('/turns') || address.includes('/turns?')) {
      state.turnsListCalls++;
      if (typeof options.turnsList === 'function') {
        const generated = options.turnsList(state.turnsListCalls);
        return response({ data: generated, has_more: false });
      }
      if (options.turnsList) {
        return response({ data: options.turnsList, has_more: false });
      }
      return response({ data: [], has_more: false });
    }

    // GET /agents/sessions/{sessionId}/items
    if (address.endsWith('/agents/sessions/sess_local_test/items')) {
      state.itemsCalls++;
      if (typeof options.itemsHandler === 'function') {
        return response(options.itemsHandler(state.itemsCalls));
      }
      return response({
        data: options.items || [validAssistantItem()],
        has_more: false,
      });
    }

    // GET /agents/sessions/{sessionId}
    if (address.endsWith('/agents/sessions/sess_local_test')) {
      state.sessionPolls++;
      if (typeof options.sessionHandler === 'function') {
        return response(options.sessionHandler(state.sessionPolls));
      }
      return response(options.sessionData || { id: 'sess_local_test', status: 'in_progress' });
    }

    // GET /traces
    if (address.endsWith('/traces') || address.includes('/traces?')) {
      return response({ data: [], has_more: false });
    }

    throw new Error(`Chamada externa inesperada no teste: ${address}`);
  };

  try {
    const result = await runOpenAiBrainTurn({
      apiKey: 'sk-local-fixture',
      agentId: 'agent_local_fixture',
      conversationId: 'conv_local_fixture',
      currentStageId: 'conexao_inicial',
      inboundMessages: ['mensagem de teste'],
      recentMessages: [],
      contactMemorySummary: '',
      landmarksSummary: '',
      liveStateContext: '{}',
      allowSessionStatusFallback: options.allowSessionStatusFallback,
    });
    await run(result, state);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    Date.now = originalNow;
  }
}

// ============================================================================
// OS 12 CENÁRIOS OBRIGATÓRIOS ESPECIFICADOS PELO USUÁRIO
// ============================================================================

test('1. sessionStatus = "in_progress" + turnStatus = "completed" -> Sucesso absoluto (caso de produção)', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_real_prod', status: 'in_progress' },
      },
      // Session continua in_progress em todos os polls
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      // Turn completa no primeiro poll
      turnHandler: () => ({ id: 'turn_real_prod', status: 'completed' }),
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso pois o turn concluiu com sucesso');
      assert.notEqual(result.plan, null, 'Deve retornar plano válido');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(result.telemetry.sessionStatus, 'in_progress');
      assert.equal(result.telemetry.status, 'completed');
      assert.equal(result.telemetry.completionSource, 'turn');
    }
  );
});

test('2. sessionStatus = "idle" + turnStatus = "completed" -> Sucesso', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_2', status: 'in_progress' },
      },
      sessionData: { id: 'sess_local_test', status: 'idle' },
      turnHandler: () => ({ id: 'turn_2', status: 'completed' }),
    },
    (result) => {
      assert.equal(result.success, true);
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(result.telemetry.sessionStatus, 'idle');
      assert.equal(result.telemetry.status, 'completed');
    }
  );
});

test('3. turnStatus = "in_progress" até o deadline -> local_wait_timeout com telemetria correta', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_3', status: 'in_progress' },
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      turnHandler: () => ({ id: 'turn_3', status: 'in_progress' }),
    },
    (result, state) => {
      assert.equal(result.success, false);
      assert.equal(result.plan, null);
      assert.match(result.error, /local_wait_timeout/);
      assert.equal(result.telemetry.status, 'local_wait_timeout');
      assert.equal(result.telemetry.turnStatus, 'in_progress');
      assert.equal(result.telemetry.localWaitDeadlineReached, true);
    }
  );
});

test('4. Turn conclui entre o último poll e a verificação final autoritativa -> Sucesso', async () => {
  let finalCheckHit = false;
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_4', status: 'in_progress' },
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      turnHandler: (callCount) => {
        // Durante os 45 polls do loop, retorna in_progress. Na 46ª chamada (leitura final autoritativa), retorna completed.
        if (callCount >= 46) {
          finalCheckHit = true;
          return { id: 'turn_4', status: 'completed' };
        }
        return { id: 'turn_4', status: 'in_progress' };
      },
    },
    (result) => {
      assert.equal(finalCheckHit, true, 'A leitura final autoritativa deve ter sido chamada');
      assert.equal(result.success, true, 'Deve concluir com sucesso sem timeout falso');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(result.telemetry.status, 'completed');
    }
  );
});

test('5. Turn falha (failed) com turn.error -> agent_terminal_failure', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_5', status: 'in_progress' },
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      turnHandler: () => ({
        id: 'turn_5',
        status: 'failed',
        error: { message: 'Rate limit on subagent execution', code: 'rate_limit_exceeded' },
      }),
    },
    (result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /agent_terminal_failure: status=failed/);
      assert.match(result.error, /rate_limit_exceeded/);
      assert.equal(result.telemetry.status, 'failed');
    }
  );
});

test('6. Turn cancelado (cancelled) -> Falha terminal por cancelamento', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_6', status: 'in_progress' },
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      turnHandler: () => ({ id: 'turn_6', status: 'cancelled' }),
    },
    (result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /agent_terminal_failure: status=cancelled/);
      assert.equal(result.telemetry.status, 'cancelled');
    }
  );
});

test('7. Turn usage presente -> Captura correta sem duplicar tokens com sessionUsage', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_7', status: 'in_progress' },
      },
      sessionData: {
        id: 'sess_local_test',
        status: 'in_progress',
        usage: { input_tokens: 1500, output_tokens: 300, total_tokens: 1800 },
      },
      turnHandler: () => ({
        id: 'turn_7',
        status: 'completed',
        usage: { input_tokens: 1500, output_tokens: 300, total_tokens: 1800 },
      }),
    },
    (result) => {
      assert.equal(result.success, true);
      assert.equal(result.telemetry.inputTokens, 1500, 'Não deve duplicar input tokens');
      assert.equal(result.telemetry.outputTokens, 300, 'Não deve duplicar output tokens');
      assert.equal(result.telemetry.totalTokens, 1800, 'Total tokens deve ser exatamente 1800');
    }
  );
});

test('8. Turn usage nulo -> Fallback para sessionUsage funciona perfeitamente', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_8', status: 'in_progress' },
      },
      sessionData: {
        id: 'sess_local_test',
        status: 'in_progress',
        usage: { input_tokens: 2100, output_tokens: 420, total_tokens: 2520 },
      },
      turnHandler: () => ({
        id: 'turn_8',
        status: 'completed',
        usage: null, // Turn sem usage explícito
      }),
    },
    (result) => {
      assert.equal(result.success, true);
      assert.equal(result.telemetry.inputTokens, 2100, 'Deve usar fallback do sessionUsage');
      assert.equal(result.telemetry.outputTokens, 420, 'Deve usar fallback do sessionUsage');
      assert.equal(result.telemetry.totalTokens, 2520, 'Total tokens preenchido pelo fallback');
    }
  );
});

test('9. Items disponíveis após completed -> Plano devidamente processado', async () => {
  const customPlan = {
    ...VALID_SAMPLE_PLAN,
    responses: ['Balão de resposta 1', 'Balão de resposta 2'],
  };
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_9', status: 'completed' },
      },
      turnHandler: () => ({ id: 'turn_9', status: 'completed' }),
      items: [validAssistantItem(customPlan)],
    },
    (result) => {
      assert.equal(result.success, true);
      assert.deepEqual(result.plan.responses, ['Balão de resposta 1', 'Balão de resposta 2']);
      assert.equal(result.telemetry.finalPlanParsed, true);
    }
  );
});

test('10. Items com atraso de consistência -> Bounded retry reconcilia com sucesso sem abrir novo ciclo', async () => {
  let attemptCount = 0;
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        current_turn: { id: 'turn_10', status: 'completed' },
      },
      turnHandler: () => ({ id: 'turn_10', status: 'completed' }),
      itemsHandler: (callCount) => {
        attemptCount = callCount;
        if (callCount === 1) {
          // Primeira tentativa retorna vazio (consistência eventual da OpenAI)
          return { data: [] };
        }
        // Segunda tentativa retorna os itens consolidados
        return { data: [validAssistantItem()] };
      },
    },
    (result) => {
      assert.equal(attemptCount, 2, 'Deve ter tentado uma 2ª vez para buscar os itens');
      assert.equal(result.success, true);
      assert.notEqual(result.plan, null);
    }
  );
});

test('11. Identificação do Turn -> Não seleciona turn antigo da mesma sessão', async () => {
  const now = Date.now();
  await withAdvancedSyntheticAgent(
    {
      // initialSession sem current_turn direto, força busca via /turns
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
      },
      turnsList: [
        {
          id: 'turn_old_stale',
          session_id: 'sess_local_test',
          created_at: (now - 60_000) / 1000, // 60 segundos antes de começar
          status: 'completed',
        },
        {
          id: 'turn_fresh_match',
          session_id: 'sess_local_test',
          created_at: now / 1000, // Criado agora
          status: 'completed',
        },
      ],
      turnHandler: (callCount) => ({ id: 'turn_fresh_match', status: 'completed' }),
    },
    (result) => {
      assert.equal(result.success, true);
      assert.equal(result.telemetry.turnId, 'turn_fresh_match', 'Deve selecionar o turn recente, não o antigo');
    }
  );
});

test('12. Subagent turn -> Não confunde subagent turn com o root turn desta execução', async () => {
  const now = Date.now();
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
      },
      turnsList: [
        {
          id: 'turn_subagent_child',
          session_id: 'sess_local_test',
          subagent_id: 'subagent_persona_analyzer',
          parent_turn_id: 'turn_root_main',
          created_at: now / 1000,
          status: 'completed',
        },
        {
          id: 'turn_root_main',
          session_id: 'sess_local_test',
          created_at: now / 1000,
          status: 'completed',
        },
      ],
      turnHandler: () => ({ id: 'turn_root_main', status: 'completed' }),
    },
    (result) => {
      assert.equal(result.success, true);
      assert.equal(result.telemetry.turnId, 'turn_root_main', 'Deve filtrar e selecionar o root turn sem subagent_id');
    }
  );
});

// ============================================================================
// NOVO TESTE OBRIGATÓRIO (ITEM 1): FAIL-CLOSED EM RUNTIME REAL
// ============================================================================

test('13. Runtime real simulado + nenhum turnId identificável -> FAIL-CLOSED (não usa sessionStatus como success)', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'completed', // Mesmo com session completed!
      },
      sessionData: { id: 'sess_local_test', status: 'completed' },
      turnsList: [], // Sem turn identificável durante toda a janela e reconciliação final
    },
    (result, state) => {
      assert.equal(result.success, false, 'Deve falhar fail-closed');
      assert.match(result.error, /agent_turn_identification_timeout/, 'Deve lançar erro explícito de turn não identificado após deadline');
      assert.equal(result.telemetry.status, 'agent_turn_identification_timeout');
      assert.equal(result.telemetry.turnStatus, 'unidentified');
      assert.equal(result.plan, null, 'Não deve emitir plano baseado no status da session');
      assert.ok(state.turnsListCalls > 1, 'Deve ter tentado listar turns ao longo de toda a janela');
    }
  );
});

test('14. Caso Real Obrigatório: Turn não visível nos primeiros segundos, aparece depois e completa -> SUCCESS', async () => {
  const startTime = Date.now();
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
        // Sem current_turn / turn_id
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      // t=0s, 3s, 5s -> []
      // t=9s (chamada 3 ou 4) -> turn aparece
      turnsList: (callCount) => {
        if (callCount < 3) return [];
        return [
          {
            id: 'turn_root_current',
            session_id: 'sess_local_test',
            status: 'in_progress',
            created_at: startTime / 1000,
          },
        ];
      },
      turnHandler: (callCount) => {
        if (callCount === 1) return { id: 'turn_root_current', status: 'in_progress' };
        return { id: 'turn_root_current', status: 'completed' };
      },
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso após o turn propagar e concluir');
      assert.notEqual(result.plan, null, 'Deve retornar plano válido');
      assert.equal(result.telemetry.turnId, 'turn_root_current');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(result.telemetry.status, 'completed');
      assert.equal(result.telemetry.completionSource, 'turn');
      assert.ok(state.turnsListCalls >= 3, 'Deve ter continuado tentando listar turns até aparecer');
    }
  );
});

test('15. Caso de Produção Mais Importante: Turn só aparece DEPOIS das antigas 3 tentativas iniciais -> aguarda e conclui sem retry', async () => {
  const startTime = Date.now();
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      // Retorna vazio nas primeiras 4 chamadas (supera o limite antigo de 3 tentativas rápidas)
      turnsList: (callCount) => {
        if (callCount <= 4) return [];
        return [
          {
            id: 'turn_prod_delayed',
            session_id: 'sess_local_test',
            status: 'in_progress',
            created_at: startTime / 1000,
          },
        ];
      },
      turnHandler: (callCount) => {
        if (callCount === 1) return { id: 'turn_prod_delayed', status: 'in_progress' };
        return { id: 'turn_prod_delayed', status: 'completed' };
      },
    },
    (result, state) => {
      assert.equal(result.success, true);
      assert.notEqual(result.plan, null);
      assert.equal(result.telemetry.turnId, 'turn_prod_delayed');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.ok(state.turnsListCalls >= 5, 'Deve ter realizado 5 ou mais tentativas de listagem de turns');
    }
  );
});

test('16. Caso Deadline sem Turn: Durante toda a janela nenhum turn aparece -> FAIL-CLOSED (agent_turn_identification_timeout)', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'completed', // Mesmo com session completed!
      },
      sessionData: { id: 'sess_local_test', status: 'completed' },
      turnsList: () => [], // Sem turn em nenhuma chamada
    },
    (result, state) => {
      assert.equal(result.success, false, 'Deve falhar fail-closed');
      assert.match(result.error, /agent_turn_identification_timeout/);
      assert.equal(result.telemetry.status, 'agent_turn_identification_timeout');
      assert.equal(result.telemetry.turnStatus, 'unidentified');
      assert.equal(result.plan, null, 'NÃO deve sintetizar resposta baseada na Session');
      assert.ok(state.turnsListCalls >= 40, 'Deve ter tentado até o deadline de espera da janela');
    }
  );
});

test('17. Caso Turn Aparece no Último Instante: Turn ausente durante polling, aparece completed na reconciliação final -> SUCCESS', async () => {
  const startTime = Date.now();
  await withAdvancedSyntheticAgent(
    {
      initialSession: {
        id: 'sess_local_test',
        status: 'in_progress',
      },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      // Retorna vazio durante as 45 iterações do laço regular de polling
      // Na reconciliação final (após esgotar os polls regulares), o Turn aparece completed
      turnsList: (callCount) => {
        if (callCount < 46) return [];
        return [
          {
            id: 'turn_last_second_savior',
            session_id: 'sess_local_test',
            status: 'completed',
            created_at: startTime / 1000,
          },
        ];
      },
      turnHandler: () => ({ id: 'turn_last_second_savior', status: 'completed' }),
    },
    (result, state) => {
      assert.equal(result.success, true, 'Deve ter sucesso pela reconciliação final');
      assert.notEqual(result.plan, null, 'Deve retornar plano válido');
      assert.equal(result.telemetry.turnId, 'turn_last_second_savior');
      assert.equal(result.telemetry.turnStatus, 'completed');
      assert.equal(result.telemetry.completionSource, 'turn');
    }
  );
});

// ============================================================================
// TESTES DE REGRESSÃO EXISTENTES (PRESERVADOS E REFORÇADOS)
// ============================================================================

test('Regressão: in_progress após 45 polls em sessão sem turns vira timeout local com fallback legado', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: { id: 'sess_local_test', status: 'in_progress' },
      sessionData: { id: 'sess_local_test', status: 'in_progress' },
      turnsList: [],
      allowSessionStatusFallback: true, // Habilitado apenas para simulação legada
    },
    (result, state) => {
      assert.equal(result.success, false);
      assert.equal(result.plan, null);
      assert.match(result.error, /local_wait_timeout/);
      assert.equal(result.telemetry.status, 'local_wait_timeout');
    }
  );
});

test('Regressão: failed na sessão é falha terminal do Agent no modo simulado legado', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: { id: 'sess_local_test', status: 'failed' },
      sessionData: { id: 'sess_local_test', status: 'failed' },
      turnsList: [],
      allowSessionStatusFallback: true,
    },
    (result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /agent_terminal_failure: status=failed/);
      assert.equal(result.telemetry.status, 'failed');
    }
  );
});

test('Regressão: requires_action não é confundido com resposta concluída no modo simulado legado', async () => {
  await withAdvancedSyntheticAgent(
    {
      initialSession: { id: 'sess_local_test', status: 'requires_action' },
      sessionData: { id: 'sess_local_test', status: 'requires_action' },
      turnsList: [],
      allowSessionStatusFallback: true,
    },
    (result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /agent_requires_action_unhandled/);
      assert.equal(result.plan, null);
    }
  );
});

test('Regressão: o limite do plano rejeita objeto no campo textual sem recuperar silenciosamente', () => {
  const base = {
    action: 'reply',
    objectiveDecision: 'none',
    responses: ['resposta técnica'],
    missionPackage: {
      relevantMemoryContext: 'contexto textual',
      turnContract: { mustAnswerFirst: false, newQuestionBudget: 0, responseShape: 'answer_only', directQuestions: [], maxBalloons: 1 },
    },
  };
  assert.equal(validateConversationBrainPlan(structuredClone(base)).valid, true);
  const invalid = validateConversationBrainPlan({ ...base, missionPackage: { ...base.missionPackage, relevantMemoryContext: { text: 'inválido' } } });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /invalid_array_contract: field=missionPackage.relevantMemoryContext actual_type=object expected_type=string/);
});
