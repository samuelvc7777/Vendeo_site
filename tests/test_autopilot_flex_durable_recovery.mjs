import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261019105000_requeue_flex_capacity_from_immediate_activation.sql",
  "utf8",
);
const api = fs.readFileSync("supabase/functions/api/index.ts", "utf8");

test("Flex 429 conserves attempt limit and doesn't silently switch to Standard", () => {
  assert.match(migration, /v_flex_attempt >= 9/);
  assert.match(migration, /'flexRetryScheduled', false/);
  assert.match(migration, /v_retry_at := greatest\(/);
  assert.doesNotMatch(migration, /service_tier\s*:?=\s*['"]standard/i);
});

test("Flex release atomically enqueues the unanswered message when no job exists", () => {
  assert.match(migration, /v_release := public\.release_experimental_cycle_if_owned\(/);
  assert.match(migration, /if coalesce\(\(v_release->>'possibleSend'\)::boolean, false\) then return v_release/);
  assert.match(migration, /m\.id = any\(coalesce\(p_revert_message_ids, array\[\]::text\[\]\)\)/);
  assert.match(migration, /v_orch->'messageLedger'->>m\.id = 'pending'/);
  assert.match(migration, /insert into public\.autopilot_inbound_jobs/);
  assert.match(migration, /on conflict \(conversation_id\) do nothing/);
  assert.match(migration, /values \(p_conversation_id, v_retry_message_id, v_retry_at\)/);
});

test("Flex retry lowers only the failed message watermark with duplicate guards", () => {
  assert.match(migration, /v_message_revision := \(v_orch->'messageInboundRevisions'->>v_retry_message_id\)::int/);
  assert.match(migration, /v_watermark_revision >= v_message_revision/);
  assert.match(migration, /greatest\(v_message_revision - 1, 0\)/);
  assert.match(migration, /newer\.conversation_id = p_conversation_id/);
  assert.match(migration, /q\.status in \('pending', 'claimed', 'sending', 'uncertain', 'dispatch_uncertain'\)/);
});

test("Restart still reactivates runtime and preserves the guarded queue flow", () => {
  const i = api.indexOf('path === "/autopilot/restart-chat"');
  const route = api.slice(i, i + 7000);
  assert.ok(i >= 0);
  assert.match(route, /"restart_autopilot_runtime_atomic"/);
  assert.match(route, /"activate_autopilot_runtime_after_restart_atomic"/);
  assert.match(route, /"enqueue_autopilot_inbound_job"/);
});
