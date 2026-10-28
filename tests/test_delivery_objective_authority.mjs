import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateAndApplyBrainStageDecision, completeDeliveryObjectiveFromConfirmedAction } from '../supabase/functions/api/brain_orchestrator.ts';
import {handleOperatorChatProgress} from '../supabase/functions/api/operator_chat_progress.ts';
import * as evidenceApi from '../supabase/functions/api/objective_evidence.ts';
import {authorizeBrainStickerActions} from '../supabase/functions/api/brain_stickers.ts';
const source = fs.readFileSync(new URL('../supabase/functions/api/brain_orchestrator.ts', import.meta.url), 'utf8');
const goal = (actionType = 'send_image') => ({ id: 'delivery', kind: 'action', actionType, completionPolicy: 'delivery_confirmed', enabled: true });
function dbFor(objective) {
  const stages = [{id: 'stage', goals: [objective]}, {id: 'next', goals: []}];
  return { from(table) {
    const query = {select() {return this;}, eq() {return this;}, order: async () => ({data: stages}),
      maybeSingle: async () => ({data: {id: 'valid'}}), then(resolve) {return Promise.resolve({data: stages}).then(resolve);} };
    return query;
  }};
}
for (const actionType of ['send_image', 'send_audio']) {
  for (const type of ['message', 'conversation_history', 'manual_fact']) {
    test(`objectiveCompletion não conclui ${actionType} com ${type}`, async () => {
      const currentCycle = {trace: []};
      const result = await validateAndApplyBrainStageDecision({supabase: dbFor(goal(actionType)), conversationId: 'conv',
        currentStageId: 'stage', currentPhase: 'stage', manualFactProviderSessionId: 'conversation:valid', currentCycle,
        decision: {nextPhase: 'next', objectiveCompletion: {objectiveId: 'delivery', evidence: {type, id: type === 'conversation_history' ? 'current' : 'valid'}}}});
      assert.deepEqual(result.updatedCompletedGoals, []);
      assert.equal(result.updatedObjectiveProgress.delivery, undefined);
      assert.equal(result.stageAdvanced, false);
      assert.ok(currentCycle.trace.some(line => line.includes('delivery_confirmation_required')));
    });
    test(`already_satisfied não conclui ${actionType} com ${type}`, async () => {
      const start = source.indexOf('    if (brainPlan.objectiveDecision === "already_satisfied") {');
      const end = source.indexOf('\n    currentCycle.trace.push(`brain_objective_mode:', start);
      assert.ok(start > 0 && end > start);
      const code = ts.transpileModule(`(async () => { let workingCompletedGoalIds = []; let brainObjectiveCompletion = null;
        ${source.slice(start, end)}; return {workingCompletedGoalIds, brainObjectiveCompletion}; })()`,
        {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
      const currentCycle = {trace: []};
      const result = await vm.runInNewContext(code, {...evidenceApi, supabase: dbFor(goal(actionType)), conversationId: 'conv',
        currentCycle, scheduleRuntime: {scheduleId: 'schedule'}, console: {warn() {}}, resolveCanonicalDecisionSessionId: () => 'conversation:valid',
        brainPlan: {objectiveDecision: 'already_satisfied', satisfiedObjectiveId: 'delivery', objectiveEvidence: {type, id: type === 'conversation_history' ? 'current' : 'valid'}}});
      assert.equal(result.workingCompletedGoalIds.length, 0);
      assert.equal(result.brainObjectiveCompletion, null);
      assert.ok(currentCycle.trace.some(line => line.includes('delivery_confirmation_required')));
    });
  }
}
for (const kind of ['fact', 'conversation_state']) {
  for (const type of ['message', 'conversation_history', 'manual_fact']) {
    test(`${kind} continua concluindo com evidência ${type}`, async () => {
      const result = await validateAndApplyBrainStageDecision({supabase: dbFor({id: 'delivery', kind}),
        conversationId: 'conv', currentStageId: 'stage', currentPhase: 'stage', manualFactProviderSessionId: 'conversation:valid',
        decision: {nextPhase: 'next', objectiveCompletion: {objectiveId: 'delivery', value: 'confirmado',
          evidence: {type, id: type === 'conversation_history' ? 'current' : 'valid'}}}});
      assert.deepEqual(result.updatedCompletedGoals, ['delivery']);
      assert.equal(result.updatedObjectiveProgress.delivery.value, 'confirmado');
      assert.equal(result.stageAdvanced, true);
    });
  }
}
for (const actionType of ['send_image', 'send_audio']) {
  test(`endpoint do operador salva conclusão e reabertura de ${actionType} sem mídia`, async () => {
    const saved = [];
    const supabase = {from(table) {
      const query = {select() {return this;}, eq() {return this;},
        maybeSingle: async () => ({data: {stage_completed_rules: {}}}),
        then(resolve) {return Promise.resolve({data: [{id: 'stage', goals: [goal(actionType)]}]}).then(resolve);}};
      return query;
    }, async rpc(name, args) {assert.equal(name, 'patch_chat_progress_atomic'); saved.push(args.p_progress_patch); return {data: {success: true}};}};
    for (const completed of [true, false]) {
      const response = await handleOperatorChatProgress(new Request('https://local.test/operator/chat-progress', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({conversationId: 'conv', progressPatch: {currentStageId: 'stage', completedGoalIds: completed ? ['delivery'] : [],
          objectiveProgress: {delivery: {status: completed ? 'completed' : 'pending'}}}})}), supabase, true, {});
      assert.equal(response.status, 200);
      assert.deepEqual(saved.at(-1).completedGoalIds, completed ? ['delivery'] : []);
    }
  });
}
test('autoridade TypeScript rejeita estados não confirmados antes da RPC e não confia no payload do chamador', async () => {
  let calls = 0;
  const supabase = {async rpc(name, args) {calls++; assert.equal(name, 'complete_delivery_objective_atomic');
    assert.deepEqual(args, {p_conversation_id: 'conv', p_action_id: 'action'}); return {data: {success: true}};}};
  const action = {id: 'action', conversation_id: 'conv', status: 'sent', provider_message_id: 'provider', payload: {objectiveId: 'forjado'}};
  for (const status of ['pending', 'waiting_delay', 'sending', 'dispatch_uncertain', 'failed_confirmed']) {
    assert.equal(await completeDeliveryObjectiveFromConfirmedAction({supabase, conversationId: 'conv', action: {...action, status}}), false);
  }
  for (const override of [{conversation_id: 'other'}, {provider_message_id: null}, {id: ''}]) {
    assert.equal(await completeDeliveryObjectiveFromConfirmedAction({supabase, conversationId: 'conv', action: {...action, ...override}}), false);
  }
  assert.equal(calls, 0);
  assert.equal(await completeDeliveryObjectiveFromConfirmedAction({supabase, conversationId: 'conv', action}), true);
  assert.equal(calls, 1);
});
test('atualização auxiliar de progresso não contorna a confirmação da entrega', async () => {
  const result = await validateAndApplyBrainStageDecision({supabase: dbFor(goal()), conversationId: 'conv', currentStageId: 'stage', currentPhase: 'stage',
    objectiveProgress: {delivery: {status: 'completed', source: 'delivery_confirmed'}}, decision: {nextPhase: 'next'}});
  assert.equal(result.updatedObjectiveProgress.delivery, undefined);
  assert.equal(result.stageAdvanced, false);
});
test('objectiveCompletion emitido junto de outboundActions passa pela mesma guarda real', async () => {
  const tree = ts.createSourceFile('brain.ts', source, ts.ScriptTarget.Latest, true);
  let branch;
  function walk(node) {
    if (ts.isIfStatement(node) && node.expression.getText(tree).includes('isOpenAiAgentBrain && (hasAgentOutboundActions')) branch = node.thenStatement;
    ts.forEachChild(node, walk);
  }
  walk(tree); assert.ok(branch);
  const brainPlan = {outboundActions: [{type: 'text', text: 'Já enviei a foto'}], stageTransition: {stageId: 'next'},
    objectiveCompletion: {objectiveId: 'delivery', evidence: {type: 'message', id: 'valid'}}};
  const code = ts.transpileModule(`(() => {let finalSubDecision; ${branch.getText(tree)}; return finalSubDecision;})()`,
    {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const decision = vm.runInNewContext(code, {hasAgentOutboundActions: true, hasAgentResponses: false, brainPlan,
    brainObjectiveCompletion: null, brainAudioCandidates: [], currentPhase: 'stage', currentCycle: {trace: []}, configuredAgentModel: 'test',
    authorizeBrainStickerActions, stickerCandidates: [], stickerChannel: 'whatsapp2'});
  const result = await validateAndApplyBrainStageDecision({supabase: dbFor(goal()), conversationId: 'conv', currentStageId: 'stage', currentPhase: 'stage', decision});
  assert.deepEqual(result.updatedCompletedGoals, []);
  assert.equal(result.stageAdvanced, false);
});
