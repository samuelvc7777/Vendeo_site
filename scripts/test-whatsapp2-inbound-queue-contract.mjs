import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "supabase", "migrations");

function findMigration(suffix) {
  const matches = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(suffix))
    .sort();
  assert.equal(matches.length, 1, `expected exactly one migration ending with ${suffix}`);
  return path.join(migrationsDir, matches[0]);
}

const migrationPath = findMigration("whatsapp2_inbound_queue.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

test("WhatsApp 2 inbound queue is durable and idempotent by message", () => {
  assert.match(sql, /create table if not exists public\.whatsapp2_inbound_jobs/i);
  assert.match(sql, /message_id text primary key/i);
  assert.match(sql, /status in \('pending', 'processing', 'completed', 'failed'\)/i);
  assert.match(sql, /on conflict \(message_id\) do nothing/i);
  assert.match(sql, /'duplicate', true/i);
});

test("claim is atomic, lease-based and globally bounded", () => {
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_expires_at <= clock_timestamp\(\)/i);
  assert.match(sql, /attempt_count = j\.attempt_count \+ 1/i);
  assert.match(sql, /p_global_limit integer default 1/i);
  assert.match(sql, /v_available := greatest\(0, v_global_limit - v_inflight\)/i);
  assert.match(sql, /lease_token = p_worker_token/i);
});

test("retry budget is finite and failures are persisted", () => {
  assert.match(sql, /max_attempts integer not null default 5/i);
  assert.match(sql, /attempt_count >= max_attempts/i);
  assert.match(sql, /last_error text/i);
  assert.match(sql, /failed_at timestamptz/i);
  assert.match(sql, /create or replace function public\.reschedule_whatsapp2_inbound_job/i);
  assert.match(sql, /case when v_terminal then 'failed' else 'pending' end/i);
});

test("completion requires lease ownership", () => {
  assert.match(sql, /create or replace function public\.complete_whatsapp2_inbound_job/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /lease_token = p_worker_token/i);
  assert.match(sql, /'lease_not_owned'/i);
});

test("queue primitives are service-role only", () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.whatsapp2_inbound_jobs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.whatsapp2_inbound_jobs to service_role/i);
});

const gatewayPath = path.join(
  here,
  "..",
  "services",
  "whatsapp2-gateway",
  "index.cjs",
);
const gateway = fs.readFileSync(gatewayPath, "utf8");

const accountScopedMigrationPath = findMigration(
  "whatsapp2_account_scoped_inbound_queue.sql",
);
const accountScopedSql = fs.readFileSync(accountScopedMigrationPath, "utf8");

test("workers isolam a fila de entrada por conta sem perder os limites globais", () => {
  assert.match(accountScopedSql, /gateway_account_id text not null default 'primary'/i);
  assert.match(accountScopedSql, /primary key \(gateway_account_id, message_id\)/i);
  assert.match(accountScopedSql, /on conflict \(gateway_account_id, message_id\)/i);
  assert.match(accountScopedSql, /claim_whatsapp2_inbound_jobs_for_account/i);
  assert.match(accountScopedSql, /j\.gateway_account_id = p_gateway_account_id/i);
  assert.match(accountScopedSql, /whatsapp2_inbound_global_claim/i);
  assert.match(accountScopedSql, /v_media_available := greatest\(0, 1 - v_media_inflight\)/i);
  assert.match(accountScopedSql, /complete_whatsapp2_inbound_job_for_account/i);
  assert.match(accountScopedSql, /reschedule_whatsapp2_inbound_job_for_account/i);

  const accountClaimStart = gateway.indexOf('"claim_whatsapp2_inbound_attachment_jobs_for_account"');
  assert.ok(accountClaimStart >= 0);
  assert.match(gateway.slice(accountClaimStart, accountClaimStart + 300), /p_gateway_account_id: ACCOUNT_ID/);
});

test("WhatsApp 2 listener only enqueues inbound work", () => {
  const start = gateway.indexOf('next.on("message", (message) => {');
  const end = gateway.indexOf('next.on("message_create"', start);
  const listener = gateway.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(listener, /enqueueWhatsApp2Inbound\(message\)/);
  assert.doesNotMatch(listener, /persistWhatsApp2Media|transcribeStoredAudio|resolveProfilePic/);
});

test("inbound admission has no heavy media work", () => {
  const start = gateway.indexOf("async function enqueueWhatsApp2Inbound");
  const end = gateway.indexOf("async function syncWhatsApp2Message", start);
  const admission = gateway.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(admission, /enqueue_whatsapp2_inbound_(?:attachment_)?job/);
  assert.doesNotMatch(admission, /persistWhatsApp2Media/);
  assert.doesNotMatch(admission, /transcribeStoredAudio/);
  assert.doesNotMatch(admission, /resolveProfilePic/);
  assert.doesNotMatch(admission, /resolveQuotedMessageId/);
  assert.doesNotMatch(admission, /getChat\(/);
});

test("heavy media processing runs inside the bounded worker", () => {
  const jobStart = gateway.indexOf("async function processWhatsApp2InboundJob");
  const queueStart = gateway.indexOf("async function processInboundQueue", jobStart);
  const deliveryStart = gateway.indexOf("async function processDeliveryQueue", queueStart);
  const jobWorker = gateway.slice(jobStart, queueStart);
  const queueWorker = gateway.slice(queueStart, deliveryStart);

  assert.ok(jobStart >= 0 && queueStart > jobStart && deliveryStart > queueStart);
  assert.match(jobWorker, /persistWhatsApp2Media\(messageId,\s*kind(?:,|\))/);
  assert.match(jobWorker, /ingest_whatsapp2_inbound_(?:attachment_)?atomic/);
  const ingestIndex = jobWorker.search(/ingest_whatsapp2_inbound_(?:attachment_)?atomic/);
  assert.ok(
    jobWorker.indexOf("persistWhatsApp2Media") < ingestIndex,
  );
  assert.match(queueWorker, /claim_whatsapp2_inbound_(?:attachment_)?jobs/);
  assert.match(
    queueWorker,
    /availableSlots[\s\S]*WHATSAPP2_INBOUND_CONCURRENCY\s*-\s*inboundJobsInFlight/,
  );
  assert.match(queueWorker, /p_limit:\s*availableSlots/);
  assert.match(queueWorker, /p_global_limit:\s*WHATSAPP2_INBOUND_CONCURRENCY/);
  assert.match(queueWorker, /reschedule_whatsapp2_inbound_job/);
});

test("inbound worker lifecycle follows WhatsApp connection state", () => {
  assert.match(gateway, /startInboundWorker\(\);[\s\S]*startDeliveryWorker\(\);/);
  assert.match(gateway, /auth_failure[\s\S]*stopInboundWorker\(\);/);
  assert.match(gateway, /disconnected[\s\S]*stopInboundWorker\(\);/);
  assert.match(gateway, /async function destroyClient\([^)]*\) \{[\s\S]*stopInboundWorker\(\);/);
});

test("Task 3 removes transcription from the media inbound worker", () => {
  const start = gateway.indexOf("async function processWhatsApp2InboundJob");
  const end = gateway.indexOf("async function processInboundQueue", start);
  const worker = gateway.slice(start, end);
  assert.match(worker, /stage_whatsapp2_audio_inbound_(?:attachment_)?atomic/);
  assert.match(worker, /processTranscriptionQueue\(\)/);
  assert.doesNotMatch(worker, /transcribeStoredAudioJob\(/);
  assert.doesNotMatch(worker, /transcribeStoredAudio\(messageId, mediaUrl\)/);
});

const transcriptionMigrationPath = findMigration(
  "whatsapp2_transcription_queue.sql",
);
const transcriptionSql = fs.readFileSync(transcriptionMigrationPath, "utf8");

test("WhatsApp 2 transcription queue is durable and idempotent by message", () => {
  assert.match(
    transcriptionSql,
    /create table if not exists public\.whatsapp2_transcription_jobs/i,
  );
  assert.match(transcriptionSql, /message_id text primary key/i);
  assert.match(transcriptionSql, /brain_released_at timestamptz/i);
  assert.match(transcriptionSql, /max_attempts integer not null default 5/i);
  assert.match(transcriptionSql, /for update skip locked/i);
  assert.match(transcriptionSql, /pg_advisory_xact_lock/i);
});

test("audio staging persists message but blocks Brain until transcript exists", () => {
  const start = transcriptionSql.indexOf(
    "create or replace function public.stage_whatsapp2_audio_inbound_atomic",
  );
  const end = transcriptionSql.indexOf(
    "create or replace function public.claim_whatsapp2_transcription_jobs",
    start,
  );
  const stage = transcriptionSql.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(stage, /ingest_whatsapp2_inbound_atomic/);
  assert.match(stage, /'transcription_pending'/);
  assert.match(stage, /false\s*\n\s*\)/);
  assert.match(stage, /array\[p_message_id\], '"processed"'::jsonb/);
  assert.match(stage, /enqueue_whatsapp2_transcription_job/);
});

test("Brain release is atomic and happens only after transcript persistence", () => {
  const start = transcriptionSql.indexOf(
    "create or replace function public.complete_whatsapp2_transcription_job",
  );
  const end = transcriptionSql.indexOf(
    "create or replace function public.reschedule_whatsapp2_transcription_job",
    start,
  );
  const complete = transcriptionSql.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(complete, /audio_transcript = btrim\(p_transcript\)/);
  assert.match(complete, /audio_transcription_error = null/);
  assert.match(complete, /if v_job\.release_brain and v_job\.brain_released_at is null then/i);
  assert.match(complete, /array\[p_message_id\], '"pending"'::jsonb/);
  assert.match(complete, /enqueue_autopilot_inbound_job/);
  assert.ok(
    complete.indexOf("audio_transcript = btrim(p_transcript)") <
      complete.indexOf("enqueue_autopilot_inbound_job"),
  );
  assert.match(complete, /status = 'completed'/);
});

test("transcription retry is finite and persists errors without releasing Brain", () => {
  const start = transcriptionSql.indexOf(
    "create or replace function public.reschedule_whatsapp2_transcription_job",
  );
  const retry = transcriptionSql.slice(start);
  assert.ok(start >= 0);
  assert.match(retry, /attempt_count >= v_max_attempts/);
  assert.match(retry, /case when v_terminal then 'failed' else 'pending' end/);
  assert.match(retry, /audio_transcription_error = v_error/);
  assert.doesNotMatch(retry, /enqueue_autopilot_inbound_job/);
});

test("transcription worker is bounded, timed out and lease-backed", () => {
  const strictStart = gateway.indexOf("async function transcribeStoredAudioJob");
  const admissionStart = gateway.indexOf("async function enqueueWhatsApp2Inbound", strictStart);
  const strict = gateway.slice(strictStart, admissionStart);
  assert.match(strict, /AbortSignal\.timeout\(50_000\)/);

  const workerStart = gateway.indexOf("async function processTranscriptionQueue");
  const deliveryStart = gateway.indexOf("async function processDeliveryQueue", workerStart);
  const worker = gateway.slice(workerStart, deliveryStart);
  assert.ok(workerStart >= 0 && deliveryStart > workerStart);
  assert.match(worker, /claim_whatsapp2_transcription_jobs/);
  assert.match(worker, /p_limit: WHATSAPP2_TRANSCRIPTION_CONCURRENCY/);
  assert.match(worker, /p_global_limit: WHATSAPP2_TRANSCRIPTION_CONCURRENCY/);
  assert.match(worker, /p_lease_seconds: 120/);
  assert.match(worker, /reschedule_whatsapp2_transcription_job/);
});

test("transcription worker lifecycle follows WhatsApp connection state", () => {
  assert.match(
    gateway,
    /startInboundWorker\(\);[\s\S]*startTranscriptionWorker\(\);[\s\S]*startDeliveryWorker\(\);/,
  );
  assert.match(gateway, /auth_failure[\s\S]*stopTranscriptionWorker\(\);/);
  assert.match(gateway, /disconnected[\s\S]*stopTranscriptionWorker\(\);/);
  assert.match(
    gateway,
    /async function destroyClient\([^)]*\) \{[\s\S]*stopTranscriptionWorker\(\);/,
  );
});

test("pending audio cannot leak into another Brain cycle", () => {
  const stageStart = transcriptionSql.indexOf(
    "create or replace function public.stage_whatsapp2_audio_inbound_atomic",
  );
  const claimStart = transcriptionSql.indexOf(
    "create or replace function public.claim_whatsapp2_transcription_jobs",
    stageStart,
  );
  const stage = transcriptionSql.slice(stageStart, claimStart);
  const completeStart = transcriptionSql.indexOf(
    "create or replace function public.complete_whatsapp2_transcription_job",
  );
  const retryStart = transcriptionSql.indexOf(
    "create or replace function public.reschedule_whatsapp2_transcription_job",
    completeStart,
  );
  const complete = transcriptionSql.slice(completeStart, retryStart);

  assert.ok(stage.indexOf('"processed"') < stage.indexOf("enqueue_whatsapp2_transcription_job"));
  assert.ok(
    complete.indexOf("audio_transcript = btrim(p_transcript)") <
      complete.indexOf('"pending"'),
  );
  assert.ok(
    complete.indexOf('"pending"') < complete.indexOf("enqueue_autopilot_inbound_job"),
  );
});

const backpressureMigrationPath = findMigration(
  "whatsapp2_backpressure_limits.sql",
);
const backpressureSql = fs.readFileSync(backpressureMigrationPath, "utf8");

test("Task 4 uses measured bounded concurrency constants", () => {
  assert.match(gateway, /const WHATSAPP2_INBOUND_CONCURRENCY = 3;/);
  assert.match(gateway, /const WHATSAPP2_MEDIA_CONCURRENCY = 1;/);
  assert.match(gateway, /const WHATSAPP2_TRANSCRIPTION_CONCURRENCY = 2;/);
  assert.match(gateway, /const WHATSAPP2_DELIVERY_BATCH_LIMIT = 1;/);
  assert.match(gateway, /await Promise\.all\(\(jobs \|\| \[\]\)\.map\(async \(job\) => \{/);
});

test("inbound claim limits one active job per conversation and one heavy media globally", () => {
  const start = backpressureSql.indexOf(
    "create or replace function public.claim_whatsapp2_inbound_jobs",
  );
  const end = backpressureSql.indexOf(
    "create or replace function public.claim_whatsapp2_transcription_jobs",
    start,
  );
  const inbound = backpressureSql.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(inbound, /p_limit integer default 3/);
  assert.match(inbound, /p_global_limit integer default 3/);
  assert.match(inbound, /v_media_available := greatest\(0, 1 - v_media_inflight\)/);
  assert.match(inbound, /select distinct on \(j\.conversation_id\)/i);
  assert.match(inbound, /active\.conversation_id = j\.conversation_id/);
  assert.match(inbound, /for update of j skip locked/i);
});

test("transcription claim is globally two-wide but serial per conversation", () => {
  const start = backpressureSql.indexOf(
    "create or replace function public.claim_whatsapp2_transcription_jobs",
  );
  const transcription = backpressureSql.slice(start);
  assert.ok(start >= 0);
  assert.match(transcription, /p_limit integer default 2/);
  assert.match(transcription, /p_global_limit integer default 2/);
  assert.match(transcription, /select distinct on \(j\.conversation_id\)/i);
  assert.match(transcription, /active\.conversation_id = j\.conversation_id/);
  assert.match(transcription, /for update of j skip locked/i);
});

test("all heavy media paths share the same gateway slot", () => {
  assert.match(
    gateway,
    /const runWithHeavyMediaSlot = createConcurrencyGate\([\s\S]*WHATSAPP2_MEDIA_CONCURRENCY/,
  );
  assert.match(
    gateway,
    /async function persistWhatsApp2Media\([\s\S]*runWithHeavyMediaSlot/,
  );
  assert.match(
    gateway,
    /async function sendMediaInternal\(args\) \{[\s\S]*runWithHeavyMediaSlot/,
  );

  const directMediaStart = gateway.indexOf(
    'if (req.method === "GET" && url.pathname === "/message/media")',
  );
  const eventsStart = gateway.indexOf(
    'if (req.method === "GET" && url.pathname === "/events")',
    directMediaStart,
  );
  const directMedia = gateway.slice(directMediaStart, eventsStart);
  assert.match(directMedia, /runWithHeavyMediaSlot/);
  assert.match(directMedia, /downloadMessageMediaPayload/);

  const directSendStart = gateway.indexOf(
    'if (req.method === "POST" && url.pathname === "/messages/send-media")',
  );
  const deleteStart = gateway.indexOf(
    'if (req.method === "POST" && url.pathname === "/messages/delete")',
    directSendStart,
  );
  const directSend = gateway.slice(directSendStart, deleteStart);
  assert.match(directSend, /sendMediaInternal/);
  assert.doesNotMatch(directSend, /globalThis\.WPP\.chat\.sendFileMessage/);
});

test("delivery claims only one send globally and drains immediately", () => {
  const start = backpressureSql.indexOf(
    "create or replace function public.claim_whatsapp2_delivery_batch",
  );
  const delivery = backpressureSql.slice(start);
  assert.ok(start >= 0);
  assert.match(delivery, /p_limit integer default 1/i);
  assert.match(delivery, /whatsapp2_delivery_global_claim/i);
  assert.match(delivery, /limit 1/i);

  const workerStart = gateway.indexOf("async function processDeliveryQueue");
  const workerEnd = gateway.indexOf("function startDeliveryWorker", workerStart);
  const worker = gateway.slice(workerStart, workerEnd);
  assert.match(worker, /p_limit: WHATSAPP2_DELIVERY_BATCH_LIMIT/);
  assert.match(worker, /setImmediate\(\(\) => void processDeliveryQueue\(\)\)/);
});

test("local concurrency gate never exceeds its configured slot count", async () => {
  const gateStart = gateway.indexOf("function createConcurrencyGate");
  const gateEnd = gateway.indexOf("const runWithHeavyMediaSlot", gateStart);
  const gateSource = gateway.slice(gateStart, gateEnd);
  assert.ok(gateStart >= 0 && gateEnd > gateStart);

  const createGate = new Function(
    `${gateSource}\nreturn createConcurrencyGate;`,
  )();
  const runOneAtATime = createGate(1);
  let active = 0;
  let maxActive = 0;

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runOneAtATime(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2 + (index % 2)));
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 1);
});
