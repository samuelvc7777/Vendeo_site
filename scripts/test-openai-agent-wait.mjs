import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOpenAiBrainTurn, validateConversationBrainPlan } from '../supabase/functions/api/openai_brain.ts';

function response(value) {
  return { ok: true, json: async () => value };
}

async function withSyntheticAgent(status, run) {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let fakeNow = originalNow();
  let polls = 0;
  globalThis.setTimeout = (callback, delay) => {
    fakeNow += delay;
    queueMicrotask(callback);
    return 1;
  };
  Date.now = () => fakeNow;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.endsWith('/agents/sessions') && options.method === 'POST') {
      return response({ id: 'sess_local_test', status: status === 'failed' ? 'failed' : 'in_progress' });
    }
    if (address.endsWith('/agents/sessions/sess_local_test')) {
      polls++;
      return response({ id: 'sess_local_test', status });
    }
    if (address.endsWith('/turns') || address.endsWith('/traces')) {
      return response({ data: [], has_more: false });
    }
    throw new Error(`Chamada externa inesperada: ${address}`);
  };
  try {
    const result = await runOpenAiBrainTurn({
      apiKey: 'sk-local-fixture',
      agentId: 'agent_local_fixture',
      conversationId: 'conv_local_fixture',
      currentStageId: 'conexao_inicial',
      inboundMessages: ['mensagem técnica'],
      recentMessages: [],
      contactMemorySummary: '',
      landmarksSummary: '',
      liveStateContext: '{}',
    });
    await run(result, polls);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    Date.now = originalNow;
  }
}

test('in_progress após 45 polls vira timeout local, sem plano de resposta', async () => {
  await withSyntheticAgent('in_progress', (result, polls) => {
    assert.equal(result.success, false);
    assert.equal(result.plan, null);
    assert.match(result.error, /local_wait_timeout/);
    assert.equal(result.telemetry.status, 'local_wait_timeout');
    assert.equal(polls, 46); // 45 polls + coleta técnica final da sessão.
  });
});

test('failed é falha terminal do Agent, distinta do timeout local', async () => {
  await withSyntheticAgent('failed', (result) => {
    assert.equal(result.success, false);
    assert.match(result.error, /agent_terminal_failure: status=failed/);
    assert.equal(result.telemetry.status, 'failed');
  });
});

test('requires_action não é confundido com resposta concluída', async () => {
  await withSyntheticAgent('requires_action', (result) => {
    assert.equal(result.success, false);
    assert.match(result.error, /agent_requires_action_unhandled/);
    assert.equal(result.plan, null);
  });
});

test('o limite do plano rejeita objeto no campo textual sem recuperar silenciosamente', () => {
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
