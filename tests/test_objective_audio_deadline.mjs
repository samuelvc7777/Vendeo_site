import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const sourceRoot = process.env.RAFFLE_TEST_SOURCE_ROOT || fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(sourceRoot, 'supabase/functions/api');
const { loadObjectiveAudioDeadline, validateObjectiveAudioDeadline } = await import(pathToFileURL(path.join(apiRoot, 'objective_audio_deadline.ts')).href);
const validators = await import(pathToFileURL(path.join(apiRoot, 'openai_brain.ts')).href);

const deadline = { objectiveId: 'raffle', maxTurns: 4, currentTurn: 4, allowTemporalMismatch: true };
const candidates = [{ objectiveId: 'raffle', candidates: [{ audioId: 'raffle-audio' }] }];

test('no quarto turno e após o limite, texto sem áudio não chega à entrega', () => {
  for (const currentTurn of [4, 7]) {
    assert.match(validateObjectiveAudioDeadline({ deadline: { ...deadline, currentTurn }, candidates,
      plan: { action: 'reply', outboundActions: [{ type: 'text', text: 'vamos conversar' }] } }), /deadline_required/);
    assert.equal(validateObjectiveAudioDeadline({ deadline: { ...deadline, currentTurn }, candidates,
      plan: { action: 'reply', outboundActions: [{ type: 'audio', audioId: 'raffle-audio' }] } }), null);
  }
});

test('antes do prazo pode conversar; outro áudio não cumpre o objetivo', () => {
  assert.equal(validateObjectiveAudioDeadline({ deadline: { ...deadline, currentTurn: 3 }, candidates, plan: { action: 'reply' } }), null);
  assert.match(validateObjectiveAudioDeadline({ deadline, candidates,
    plan: { action: 'reply', outboundActions: [{ type: 'audio', audioId: 'unrelated' }] } }), /deadline_required/);
  assert.equal(validateObjectiveAudioDeadline({ candidates, plan: { action: 'reply' } }), null);
});

test('falta de áudio elegível exige operador e preserva resolução manual', () => {
  assert.match(validateObjectiveAudioDeadline({ deadline, candidates: [], plan: { action: 'reply' } }), /no_eligible_audio/);
  assert.equal(validateObjectiveAudioDeadline({ deadline, candidates: [], plan: { action: 'manual_resolution', manualResolution: { reasonCategory: 'other' } } }), null);
});

test('áudio aprovado não volta para confirmação no terceiro nem no quarto turno', () => {
  for (const currentTurn of [3, 4, 7]) {
    const approval = { ...deadline, currentTurn };
    const question = { action: 'manual_resolution', manualResolution: { reasonCategory: 'audio_content', question: 'O boleto vence hoje e faltam dez bilhetes? Há uma gravação sem falar do estágio agora?' } };
    assert.match(validateObjectiveAudioDeadline({ deadline: approval, candidates, plan: question }), /confirmation_forbidden/);
    assert.match(validateObjectiveAudioDeadline({ deadline: approval, candidates, plan: { action: 'manual_resolution', manualResolution: { question: 'Confirma o áudio?' } } }), /manual_reason_required/);
    assert.equal(validateObjectiveAudioDeadline({ deadline: approval, candidates, plan: { action: 'reply', outboundActions: [{ type: 'audio', audioId: 'raffle-audio' }] } }), null);
  }
});

test('contador usa decisões duráveis, deduplica versões e delimita a entrada mais recente', async () => {
  const calls = [];
  const responses = [{ data: [{ created_at: '2026-10-08T12:52:38Z' }] },
    { data: [{ turn_id: 'one' }, { turn_id: 'one' }, { turn_id: 'two' }, { turn_id: 'three' }] }];
  const supabase = { from(table) {
    const response = responses.shift();
    const query = { then: (resolve) => Promise.resolve(response).then(resolve) };
    for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'gt']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    assert.equal(table, 'brain_decisions');
    return query;
  } };
  const actual = await loadObjectiveAudioDeadline({ supabase, conversationId: 'test', stageId: 'rifa',
    objective: { id: 'raffle', actionType: 'send_audio', actionConfig: { maxStageTurns: 4, allowAudioTemporalMismatch: true } } });
  assert.deepEqual(actual, deadline);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'decision_type' && call[2] === 'respond'));
  assert.ok(calls.some(call => call[0] === 'gt' && call[2] === '2026-10-08T12:52:38Z'));
});

test('estado do SDK comunica exceção específica e prazo sem depender do histórico do modelo', () => {
  const source = fs.readFileSync(path.join(apiRoot, 'openai_sdk_brain.ts'), 'utf8');
  const start = source.indexOf('function buildOperationalTurnState(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const state = context.buildOperationalTurnState({ currentStageId: 'rifa', objectiveAudioDeadline: deadline });
  assert.match(state, /OBJETIVO_AUDIO_TURNO_NA_ETAPA=4/);
  assert.match(state, /OBJETIVO_AUDIO_LIMITE_TURNOS=4/);
  assert.match(state, /EXCECAO_TEMPORAL_AUDIO_DO_OBJETIVO/);
  assert.doesNotMatch(context.buildOperationalTurnState({ currentStageId: 'conexao' }), /EXCECAO_TEMPORAL_AUDIO_DO_OBJETIVO/);
});

test('validador real do SDK bloqueia adiamento no prazo e aceita áudio autorizado', () => {
  const source = fs.readFileSync(path.join(apiRoot, 'openai_sdk_brain.ts'), 'utf8');
  const start = source.indexOf('function validateAndNormalizeSdkPlan(');
  const end = source.indexOf('\nasync function ', start + 1);
  const context = vm.createContext({ ...validators, validateObjectiveAudioDeadline });
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const params = { currentStageId: 'rifa', objectiveAudioDeadline: deadline, prefetchedAudioCandidateGroups: candidates };
  const telemetry = { sourcesUsed: [], authorizedCandidateAudiosByObjective: candidates, authorizedCandidateAudios: [{ audioId: 'raffle-audio' }] };
  const plan = { action: 'reply', responses: ['vamos conversar'], outboundActions: [{ type: 'text', text: 'vamos conversar', delay_before_send: 5 }],
    turnContract: { directQuestions: [], mustAnswerFirst: false, newQuestionBudget: 0, responseShape: 'free_conversation', maxBalloons: 1 } };
  const blocked = context.validateAndNormalizeSdkPlan(params, structuredClone(plan), telemetry);
  assert.equal(blocked.plan, null);
  assert.match(blocked.error, /deadline_required/);
  const accepted = context.validateAndNormalizeSdkPlan(params, { ...plan, outboundActions: [{ type: 'audio', audioId: 'raffle-audio', delay_before_send: 5 }] }, telemetry);
  assert.equal(accepted.error, null);
  assert.ok(accepted.plan);
});
