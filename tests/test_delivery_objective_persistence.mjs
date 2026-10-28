import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db = new PGlite();
const migration = name => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const runId = '00000000-0000-0000-0000-000000000001';
const objective = {id: 'photo', kind: 'action', actionType: 'send_image', completionPolicy: 'delivery_confirmed'};
const state = (extra = {}) => ({cycleToken: 'cycle', expectedCurrentStageId: 'stage', currentStageId: 'stage', completedGoalIds: [], objectiveProgress: {}, ...extra});
async function scalar(sql, params = []) { return (await db.query(sql, params)).rows[0].result; }
async function progress() { return scalar('select stage_completed_rules as result from instagram_conversations where id = $1', ['conv']); }
async function seed({status = 'sent', provider = 'provider', type = 'image', payload = {}, goals = [objective], stage = 'stage'} = {}) {
  await db.exec('truncate delivery_objective_receipts, brain_turn_events, brain_decision_actions, brain_decisions, instagram_conversations, chat_stages, conversation_schedule_runs, persona_images, persona_audios, conversation_schedules, autopilot_chat_states cascade');
  await db.query(`insert into conversation_schedules(id, category, schedule_order, is_active) values ('schedule', 'custom', 0, true)`);
  await db.query(`insert into chat_stages(id, goals, stage_order, schedule_id, is_required) values ('stage', $1, 0, 'schedule', true), ('next', '[]', 1, 'schedule', true)`, [JSON.stringify(goals)]);
  await db.query(`insert into instagram_conversations(id, current_stage_id, stage_completed_rules) values ('conv', $1, $2)`, [stage, JSON.stringify({active_cycle_token: 'cycle', completed_goals: [], objective_progress: {}, orchestration: {}})]);
  await db.query(`insert into conversation_schedule_runs(id, conversation_id, schedule_id, current_stage_id, status) values ($1, 'conv', 'schedule', $2, 'active')`, [runId, stage]);
  await db.exec(`insert into persona_images values ('image', 'photo', true); insert into persona_audios values ('audio', 'photo', true)`);
  await db.query(`insert into brain_decisions(id, conversation_id, payload) values ('decision', 'conv', $1)`, [JSON.stringify({semanticState: state()})]);
  await db.query(`insert into brain_decision_actions(id, decision_id, conversation_id, action_type, status, provider_message_id, payload) values ('action', 'decision', 'conv', $1, $2, $3, $4)`,
    [type, status, provider, JSON.stringify({objectiveId: 'photo', imageId: 'image', audioId: 'audio', scheduleRunId: runId, ...payload})]);
}
const complete = () => scalar("select complete_delivery_objective_atomic('conv', 'action') as result");
const patch = (ids, prog = {}) => scalar(`select patch_chat_progress_atomic('conv', $1::jsonb) as result`, [JSON.stringify({currentStageId: 'stage', completedGoalIds: ids, objectiveProgress: prog})]);
async function semantic(snapshot) {
  return scalar(`select persist_brain_decision_with_outbox('{}', '{"id":"turn"}', $1, '[]', '[]') as result`,
    [JSON.stringify({id: 'semantic', conversation_id: 'conv', payload: {semanticState: snapshot}})]);
}
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table instagram_conversations(id text primary key, contact_id text, current_stage_id text, stage_completed_rules jsonb, is_converted boolean default false, ai_auto_respond boolean default true, ai_debounce_until timestamptz, updated_at timestamptz);
    create table chat_stages(id text primary key, goals jsonb, stage_order int, schedule_id text, is_required boolean);
    create table conversation_schedules(id text primary key, category text, schedule_order int, is_active boolean);
    create table conversation_schedule_runs(id uuid primary key, conversation_id text, schedule_id text, status text, current_stage_id text, updated_at timestamptz);
    create table persona_images(id text primary key, objective_id text, enabled boolean);
    create table persona_audios(id text primary key, objective_id text, enabled boolean);
    create table brain_decisions(id text primary key, conversation_id text, payload jsonb, semantic_state_committed_at timestamptz, delivery_status text);
    create table brain_decision_actions(id text primary key, decision_id text, conversation_id text, action_type text, payload jsonb, status text, provider_message_id text);
    create table brain_turn_events(conversation_id text, session_id text, turn_id text, decision_id text, event_type text, status text, human_message text, metadata jsonb);
    create table autopilot_chat_states(conversation_id text primary key, is_enabled boolean, status text, state jsonb, state_revision int, state_updated_at timestamptz, updated_at timestamptz);
    -- Somente a infraestrutura da outbox é substituída: progresso e guardas usam SQL real.
    create function persist_brain_decision(jsonb,jsonb,jsonb,jsonb) returns void language plpgsql as $$begin
      insert into brain_decisions(id, conversation_id, payload) values ($3->>'id', $3->>'conversation_id', $3->'payload') on conflict (id) do nothing;
    end;$$;
    create function persist_durable_outbox_batch(text,text,jsonb) returns jsonb language sql as $$select '{"success":true}'::jsonb$$;
  `);
  const schedules = migration('20261006022055_conversation_schedules.sql');
  for (const name of ['patch_chat_progress_atomic', 'commit_experimental_cycle_if_owned']) {
    const start = schedules.indexOf(`create or replace function public.${name}(`);
    await db.exec(schedules.slice(start, schedules.indexOf('\n$$;', start) + 4));
  }
  const legacy = migration('20261006052220_remove_stage_vault_legacy.sql');
  await db.exec(legacy.slice(0, legacy.indexOf('\nupdate public.instagram_conversations')));
  await db.exec(migration('20260927005646_brain_decision_delivery_independence.sql'));
  await db.exec(migration('20261028131229_enforce_delivery_objective_authority.sql'));
});
after(() => db.close());

for (const status of ['pending', 'waiting_delay', 'sending', 'failed_confirmed', 'failed_retryable', 'cancelled', 'dispatch_uncertain']) {
  test(`persistência: ${status} mantém foto pendente`, async () => {
    await seed({status}); assert.equal((await complete()).success, false);
    assert.deepEqual((await progress()).completed_goals, []);
  });
}
test('seleção, outbox e afirmação textual não são confirmação persistida', async () => {
  await seed(); await db.exec("delete from brain_decision_actions");
  assert.equal((await complete()).success, false);
  await seed({type: 'text'}); assert.equal((await complete()).success, false);
  await seed({provider: null}); assert.equal((await complete()).success, false);
  assert.deepEqual((await progress()).completed_goals, []);
});
test('confirmação real conclui, preserva outros fatos e é idempotente mesmo após reabertura manual', async () => {
  await seed(); await patch(['city'], {city: {status: 'completed', value: 'Lavras'}});
  assert.equal((await complete()).reason, 'delivery_confirmed');
  const before = await progress(); assert.deepEqual(before.completed_goals, ['city', 'photo']);
  assert.equal(before.objective_progress.photo.source, 'delivery_confirmed');
  assert.equal((await complete()).reason, 'already_processed'); assert.deepEqual(await progress(), before);
  await patch(['city'], {city: before.objective_progress.city});
  assert.equal((await complete()).reason, 'already_processed');
  assert.deepEqual((await progress()).completed_goals, ['city']);
});
test('áudio confirmado usa o mesmo contrato', async () => {
  await seed({type: 'audio', goals: [{...objective, actionType: 'send_audio'}]});
  assert.equal((await complete()).success, true);
  assert.equal((await progress()).objective_progress.photo.deliveryActionId, 'action');
});
for (const scenario of ['other_conversation', 'wrong_asset', 'missing_asset', 'disabled_asset', 'other_stage', 'other_run', 'unsupported_action']) {
  test(`confirmação rejeita ${scenario}`, async () => {
    await seed();
    if (scenario === 'other_conversation') await db.exec("update brain_decision_actions set conversation_id = 'other'");
    if (scenario === 'wrong_asset') await db.exec("update persona_images set objective_id = 'other'");
    if (scenario === 'missing_asset') await db.exec('delete from persona_images');
    if (scenario === 'disabled_asset') await db.exec('update persona_images set enabled = false');
    if (scenario === 'other_stage') await db.exec("update instagram_conversations set current_stage_id = 'next'");
    if (scenario === 'other_run') await db.exec("update conversation_schedule_runs set status = 'completed'");
    if (scenario === 'unsupported_action') await db.query("update chat_stages set goals = $1 where id = 'stage'", [JSON.stringify([{...objective, actionType: 'other'}])]);
    assert.equal((await complete()).success, false); assert.deepEqual((await progress()).completed_goals, []);
  });
}
test('commit semântico direto não forja conclusão nem origem de entrega', async () => {
  await seed();
  await assert.rejects(() => semantic(state({completedGoalIds: ['photo'], objectiveProgress: {photo: {status: 'completed', source: 'delivery_confirmed', deliveryActionId: 'action'}}})), /delivery_confirmation_required/);
  assert.deepEqual((await progress()).completed_goals, []);
});
test('commit semântico direto não avança com entrega obrigatória pendente', async () => {
  await seed(); await assert.rejects(() => semantic(state({currentStageId: 'next'})), /delivery_stage_transition_blocked/);
});
test('snapshot semântico anterior à confirmação preserva conclusão concorrente', async () => {
  await seed(); const stale = state(); await complete(); const confirmed = (await progress()).objective_progress.photo;
  assert.equal((await semantic(stale)).success, true);
  assert.deepEqual((await progress()).objective_progress.photo, confirmed);
  assert.deepEqual((await progress()).completed_goals, ['photo']);
});
test('commit final de ciclo rejeita falsa conclusão e preserva entrega concorrente', async () => {
  await seed(); const final = {completed_goals: ['photo'], objective_progress: {}, orchestration: {currentStageId: 'stage'}};
  const commit = rules => scalar("select commit_experimental_cycle_if_owned('conv', 'cycle', $1) as result", [JSON.stringify(rules)]);
  await assert.rejects(() => commit(final), /delivery_confirmation_required/);
  await complete(); const confirmed = (await progress()).objective_progress.photo;
  assert.equal((await commit({...final, completed_goals: []})).committed, true);
  assert.deepEqual((await progress()).objective_progress.photo, confirmed);
});
test('operador conclui e reabre foto/áudio sem envio; IA não altera essa origem', async () => {
  for (const actionType of ['send_image', 'send_audio']) {
    await seed({goals: [{...objective, actionType}], status: 'pending'});
    assert.equal((await patch(['photo'], {photo: {status: 'completed', source: 'operator'}})).success, true);
    assert.equal((await semantic(state())).success, true);
    assert.equal((await progress()).objective_progress.photo.source, 'operator');
    assert.equal((await patch([], {photo: {status: 'pending'}})).success, true);
    assert.deepEqual((await progress()).completed_goals, []);
  }
});
test('duas confirmações serializadas não perdem progresso; mesmo evento concorrente não duplica', async () => {
  const second = {...objective, id: 'photo2'};
  await seed({goals: [objective, second]});
  await db.exec("insert into persona_images values ('image2', 'photo2', true)");
  await db.query("insert into brain_decision_actions select 'action2', decision_id, conversation_id, action_type, $1::jsonb, status, 'provider2' from brain_decision_actions where id = 'action'", [JSON.stringify({objectiveId: 'photo2', imageId: 'image2', scheduleRunId: runId})]);
  const results = await Promise.all([complete(), complete(), scalar("select complete_delivery_objective_atomic('conv', 'action2') as result")]);
  assert.ok(results.every(result => result.success));
  assert.deepEqual((await progress()).completed_goals.sort(), ['photo', 'photo2']);
  assert.equal(await scalar('select count(*)::int as result from delivery_objective_receipts'), 2);
});

test('recibo e progresso revertem juntos quando a gravação falha', async () => {
  await seed();
  await db.exec(`create function reject_test_progress() returns trigger language plpgsql as $$begin raise exception 'test_write_failure'; end;$$;
    create trigger reject_test_progress before update on instagram_conversations for each row execute function reject_test_progress()`);
  try {
    await assert.rejects(complete, /test_write_failure/);
    assert.equal(await scalar('select count(*)::int as result from delivery_objective_receipts'), 0);
    assert.deepEqual((await progress()).completed_goals, []);
  } finally {
    await db.exec('drop trigger reject_test_progress on instagram_conversations; drop function reject_test_progress()');
  }
  assert.equal((await complete()).success, true);
});
test('confirmação sem etapa de origem persistida permanece pendente', async () => {
  await seed(); await db.exec("update brain_decisions set payload = '{}'::jsonb");
  assert.equal((await complete()).reason, 'delivery_stage_changed');
  assert.deepEqual((await progress()).completed_goals, []);
});
test('guardas automáticas e recibos são privados; checklist continua com a RPC original', async () => {
  assert.equal(await scalar("select has_function_privilege('anon', 'complete_delivery_objective_atomic(text,text)', 'execute') as result"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated', 'guard_brain_delivery_progress(jsonb,jsonb,text)', 'execute') as result"), false);
  assert.equal(await scalar("select has_table_privilege('authenticated', 'delivery_objective_receipts', 'insert') as result"), false);
  assert.equal(await scalar("select relrowsecurity as result from pg_class where oid = 'delivery_objective_receipts'::regclass"), true);
  assert.equal(await scalar("select has_function_privilege('service_role', 'complete_delivery_objective_atomic(text,text)', 'execute') as result"), true);
  await seed({status: 'pending'}); assert.equal((await patch(['photo'])).success, true);
});
