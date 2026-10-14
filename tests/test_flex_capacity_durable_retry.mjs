import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const brain = readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),"utf8");
const queue = readFileSync(new URL("../supabase/functions/api/autopilot_inbound_queue.ts", import.meta.url),"utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261014170000_flex_capacity_durable_retry.sql", import.meta.url),"utf8");
const sdk = readFileSync(new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url),"utf8");

test("Flex 429 stays Flex, no Standard provider fallback", () => {
  assert.match(sdk,/service_tier:\s*serviceTier/);
  assert.doesNotMatch(sdk,/flex_capacity_unavailable_retry_standard|shouldRetryFlexCapacityOnStandard/);
  assert.match(brain,/release_flex_capacity_cycle_if_owned/);
  assert.match(brain,/Flex processing is temporarily unavailable/i);
});

test("retry uses durable schedule, no outgoing action duplication", () => {
  assert.match(migration,/release_experimental_cycle_if_owned\(/);
  assert.match(migration,/possibleSend/);
  assert.match(migration,/token_mismatch/);
  assert.match(migration,/flexCapacityRetryUntil/);
  assert.match(migration,/flexCapacityRetryCount/);
  assert.match(migration,/v_flex_attempt >= 9/);
  assert.match(brain,/!possibleSend\s*&& retryAllowed/);
  assert.match(brain,/flex_capacity_retry_scheduled:/);
  assert.match(queue,/flexCapacityRetryUntil/);
  assert.match(queue,/errorCode\.startsWith\("flex_capacity_retry_scheduled:"\)/);
  assert.match(queue,/rescheduleJob\(/);
});

test("successful committed turn clears cooldown and retry count", () => {
  assert.match(migration,/commit_experimental_cycle_if_owned/);
  assert.match(migration,/- ''flexCapacityRetryCount'' - ''flexCapacityRetryUntil''/);
});
