import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Para execução isolada: PGLITE_MODULE_PATH aponta para uma instalação
// temporária de @electric-sql/pglite. Nenhum banco remoto é alterado.
if (!process.env.PGLITE_MODULE_PATH) throw new Error('Defina PGLITE_MODULE_PATH para @electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();

await db.exec(`
  CREATE ROLE service_role;
  CREATE TABLE public.instagram_conversations (
    id text PRIMARY KEY,
    stage_completed_rules jsonb DEFAULT '{}'::jsonb,
    ai_auto_respond boolean DEFAULT true,
    ai_debounce_until timestamptz,
    last_message_at timestamptz,
    last_direction text
  );
  CREATE TABLE public.instagram_messages (
    id text PRIMARY KEY,
    conversation_id text,
    is_mine boolean,
    created_at timestamptz
  );
`);

const migration = await fs.readFile(new URL('../supabase/migrations/20260923062000_recover_stale_autopilot_cycles.sql', import.meta.url), 'utf8');
await db.exec(await fs.readFile(new URL('../supabase/migrations/20260920193200_create_prepare_experimental_outbox_entry.sql', import.meta.url), 'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/migrations/20260920193100_update_claim_outbox_entry_with_ownership.sql', import.meta.url), 'utf8'));
await db.exec(migration);

async function insertConversation(id, rules, debounce = null) {
  await db.query(
    'INSERT INTO public.instagram_conversations(id, stage_completed_rules, ai_auto_respond, ai_debounce_until, last_message_at, last_direction) VALUES ($1,$2,true,$3,now(),$4)',
    [id, JSON.stringify(rules), debounce, 'in'],
  );
}
async function state(id) {
  const result = await db.query('SELECT stage_completed_rules,ai_debounce_until FROM public.instagram_conversations WHERE id=$1', [id]);
  return result.rows[0];
}
async function claim(id, token, stale = 25) {
  const result = await db.query('SELECT public.claim_experimental_cycle($1,$2,$3) AS result', [id, token, stale]);
  return result.rows[0].result;
}
async function release(id, token, revert = null, outbox = null) {
  const result = await db.query(
    'SELECT public.release_experimental_cycle_if_owned($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
    [id, token, 'failed', null, revert, null, 'technical_failure', null, outbox ? JSON.stringify(outbox) : null, false],
  );
  return result.rows[0].result;
}

const oldAt = new Date(Date.now() - 6 * 60_000).toISOString();
const freshAt = new Date(Date.now() - 30_000).toISOString();

await insertConversation('fresh_lock', { active_cycle_token: 'A', active_cycle_at: freshAt });
assert.equal((await claim('fresh_lock', 'B', 25)).reason, 'active_lock');
assert.equal((await state('fresh_lock')).stage_completed_rules.active_cycle_token, 'A');

await insertConversation('stale_safe', {
  active_cycle_token: 'A', active_cycle_at: oldAt,
  orchestration: { lastProcessingStatus: 'processing', messageLedger: { m1: 'claimed', m2: 'claimed' }, activeClaimedMessageIds: ['m1', 'm2'], outbox: {}, recentCycles: [] },
});
let result = await claim('stale_safe', 'B');
assert.equal(result.success, true);
assert.equal(result.staleRecovered, true);
assert.equal(result.releasedMessageCount, 2);
let rules = (await state('stale_safe')).stage_completed_rules;
assert.equal(rules.active_cycle_token, 'B');
assert.equal(rules.orchestration.messageLedger.m1, 'pending');
assert.equal(rules.orchestration.messageLedger.m2, 'pending');
assert.equal(rules.orchestration.recentCycles[0].cycleId, 'A');
assert.equal((await release('stale_safe', 'A', ['m1', 'm2'])).reason, 'token_mismatch');
assert.equal((await state('stale_safe')).stage_completed_rules.active_cycle_token, 'B');
result = await db.query('SELECT public.prepare_experimental_outbox_entry($1,$2,$3) AS result', [
  'stale_safe', 'A', JSON.stringify({ id: 'late_A', cycleId: 'A', idempotencyKey: 'late_A', status: 'pending' }),
]);
assert.equal(result.rows[0].result.success, false);
assert.equal((await state('stale_safe')).stage_completed_rules.orchestration.outbox.late_A, undefined);

await insertConversation('claim_then_abort', { active_cycle_token: 'A', active_cycle_at: new Date().toISOString(), orchestration: { messageLedger: {}, outbox: {} } });
result = await db.query('SELECT public.claim_experimental_cycle_messages($1,$2,$3) AS result', ['claim_then_abort', 'A', ['abort1', 'abort2']]);
assert.equal(result.rows[0].result.success, true);
assert.deepEqual((await state('claim_then_abort')).stage_completed_rules.orchestration.activeClaimedMessageIds, ['abort1', 'abort2']);
assert.equal((await release('claim_then_abort', 'A')).released, true);
rules = (await state('claim_then_abort')).stage_completed_rules;
assert.equal(rules.active_cycle_at, null);
assert.equal(rules.orchestration.messageLedger.abort1, 'pending');
assert.equal(rules.orchestration.messageLedger.abort2, 'pending');

await insertConversation('stale_uncertain', {
  active_cycle_token: 'A', active_cycle_at: oldAt,
  orchestration: {
    messageLedger: { m1: 'claimed', m2: 'claimed' }, activeClaimedMessageIds: ['m1', 'm2'],
    outbox: { idemp_A: { cycleId: 'A', status: 'sending', sendingAt: oldAt, idempotencyKey: 'idemp_A' } },
  },
});
result = await claim('stale_uncertain', 'B');
assert.equal(result.uncertainMessageCount, 1);
rules = (await state('stale_uncertain')).stage_completed_rules;
assert.equal(rules.orchestration.outbox.idemp_A.status, 'dispatch_uncertain');
assert.equal(rules.orchestration.messageLedger.m1, 'processed');
assert.equal(rules.orchestration.messageLedger.m2, 'processed');
result = await db.query('SELECT public.claim_outbox_entry($1,$2,$3) AS result', ['stale_uncertain', 'idemp_A', 'A']);
assert.equal(result.rows[0].result.success, false);
assert.equal(result.rows[0].result.reason, 'cycle_token_mismatch');

await insertConversation('release_sent', {
  active_cycle_token: 'A', active_cycle_at: new Date().toISOString(),
  orchestration: { technicalRetryCount: 2, messageLedger: { sent1: 'claimed' }, activeClaimedMessageIds: ['sent1'], outbox: {
    sentbox: { cycleId: 'A', status: 'sending', idempotencyKey: 'sentbox' },
  } },
});
result = await db.query(
  'SELECT public.release_experimental_cycle_if_owned($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
  ['release_sent', 'A', 'sent', null, null, ['sent1'], null, null, JSON.stringify({ sentbox: { cycleId: 'A', status: 'sent', providerMessageId: 'meta_123', idempotencyKey: 'sentbox' } }), false],
);
assert.equal(result.rows[0].result.released, true);
rules = (await state('release_sent')).stage_completed_rules;
assert.equal(rules.active_cycle_at, null);
assert.equal(rules.orchestration.outbox.sentbox.status, 'sent');
assert.equal(rules.orchestration.messageLedger.sent1, 'processed');
assert.equal(rules.orchestration.technicalRetryCount, 0);

await insertConversation('release_safe', {
  active_cycle_token: 'A', active_cycle_at: new Date().toISOString(),
  orchestration: { messageLedger: { m1: 'claimed' }, activeClaimedMessageIds: ['m1'], outbox: {} },
});
assert.equal((await release('release_safe', 'A')).released, true);
rules = (await state('release_safe')).stage_completed_rules;
assert.equal(rules.active_cycle_token, null);
assert.equal(rules.active_cycle_at, null);
assert.equal(rules.orchestration.messageLedger.m1, 'pending');

await insertConversation('release_uncertain', {
  active_cycle_token: 'A', active_cycle_at: new Date().toISOString(),
  orchestration: {
    messageLedger: { m1: 'claimed' }, activeClaimedMessageIds: ['m1'],
    outbox: { idemp_A: { cycleId: 'A', status: 'sending', idempotencyKey: 'idemp_A' } },
  },
});
assert.equal((await release('release_uncertain', 'A', ['m1'], {
  idemp_A: { cycleId: 'A', status: 'pending', idempotencyKey: 'idemp_A' },
})).released, true);
rules = (await state('release_uncertain')).stage_completed_rules;
assert.equal(rules.orchestration.outbox.idemp_A.status, 'dispatch_uncertain');
assert.equal(rules.orchestration.messageLedger.m1, 'processed');

await insertConversation('cron_null', { orchestration: { messageLedger: { m1: 'pending' } } });
await db.query('INSERT INTO public.instagram_messages(id,conversation_id,is_mine,created_at) VALUES ($1,$2,false,now())', ['m1', 'cron_null']);
let due = await db.query('SELECT id FROM public.list_autopilot_due_conversations(now(), 20)');
assert.ok(due.rows.some((row) => row.id === 'cron_null'));
await db.query("UPDATE public.instagram_conversations SET stage_completed_rules=jsonb_set(stage_completed_rules,'{orchestration,messageLedger,m1}','\"processed\"'::jsonb) WHERE id='cron_null'");
due = await db.query('SELECT id FROM public.list_autopilot_due_conversations(now(), 20)');
assert.ok(!due.rows.some((row) => row.id === 'cron_null'));

await insertConversation('retry_cap', {
  active_cycle_token: 'A', active_cycle_at: oldAt,
  orchestration: { technicalRetryCount: 2, messageLedger: { rm1: 'claimed' }, activeClaimedMessageIds: ['rm1'], outbox: {} },
});
await db.query('INSERT INTO public.instagram_messages(id,conversation_id,is_mine,created_at) VALUES ($1,$2,false,now())', ['rm1', 'retry_cap']);
result = await claim('retry_cap', 'B');
assert.equal(result.reason, 'retry_exhausted');
rules = (await state('retry_cap')).stage_completed_rules;
assert.equal(rules.active_cycle_token, null);
assert.equal(rules.active_cycle_at, null);
assert.equal(rules.orchestration.messageLedger.rm1, 'pending');
due = await db.query('SELECT id FROM public.list_autopilot_due_conversations(now(), 20)');
assert.ok(!due.rows.some((row) => row.id === 'retry_cap'));
await db.query("UPDATE public.instagram_conversations SET stage_completed_rules=jsonb_set(stage_completed_rules,'{orchestration,technicalRetryExhaustedAt}',to_jsonb((now()-interval '1 minute')::text)) WHERE id='retry_cap'");
await db.query('INSERT INTO public.instagram_messages(id,conversation_id,is_mine,created_at) VALUES ($1,$2,false,now())', ['rm2', 'retry_cap']);
due = await db.query('SELECT id FROM public.list_autopilot_due_conversations(now(), 20)');
assert.ok(due.rows.some((row) => row.id === 'retry_cap'));
assert.equal((await claim('retry_cap', 'B')).success, true);
assert.equal((await state('retry_cap')).stage_completed_rules.orchestration.technicalRetryCount, 0);

await insertConversation('release_retry_cap', {
  active_cycle_token: 'A', active_cycle_at: new Date().toISOString(),
  orchestration: { technicalRetryCount: 2, messageLedger: { retry1: 'claimed' }, activeClaimedMessageIds: ['retry1'], outbox: {} },
});
result = await db.query(
  'SELECT public.release_experimental_cycle_if_owned($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
  ['release_retry_cap', 'A', 'failed', new Date(Date.now() + 60_000).toISOString(), ['retry1'], null, 'local_wait_timeout', null, null, false],
);
assert.equal(result.rows[0].result.retryExhausted, true);
const capped = await state('release_retry_cap');
assert.equal(capped.stage_completed_rules.active_cycle_token, null);
assert.equal(capped.stage_completed_rules.orchestration.messageLedger.retry1, 'pending');
assert.equal(capped.ai_debounce_until, null);

await insertConversation('concurrent', { orchestration: { messageLedger: {} } });
const twoClaims = await Promise.all([claim('concurrent', 'A'), claim('concurrent', 'B')]);
assert.equal(twoClaims.filter((item) => item.success).length, 1);

console.log('OK: SQL PostgreSQL local — lock/TTL, stale seguro, outbox incerta, CAS tardio, cleanup, cron NULL, retry limitado e concorrência.');
await db.close();
