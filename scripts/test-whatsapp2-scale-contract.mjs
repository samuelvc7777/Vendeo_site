import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gateway = fs.readFileSync(path.join(here, "..", "services", "whatsapp2-gateway", "index.cjs"), "utf8");
const retention = fs.readFileSync(path.join(here, "..", "supabase", "migrations", "20261002214022_whatsapp2_scale_retention.sql"), "utf8");
const retentionHardening = fs.readFileSync(path.join(here, "..", "supabase", "migrations", "20261002214849_harden_whatsapp2_retention.sql"), "utf8");

test("chat snapshots are cached, deduplicated and bounded", () => {
  assert.match(gateway, /CHAT_SNAPSHOT_CACHE_TTL_MS = 15_000/);
  assert.match(gateway, /MAX_CHAT_SNAPSHOT_ROWS = 1_000/);
  assert.match(gateway, /if \(chatSnapshotPending\) return chatSnapshotPending/);
  assert.match(gateway, /invalidateChatSnapshot\(\)/);
});

test("profile picture growth and warming are bounded", () => {
  assert.match(gateway, /MAX_PROFILE_PIC_CACHE = 600/);
  assert.match(gateway, /MAX_PROFILE_PIC_WARM_BATCH = 80/);
  assert.match(gateway, /PROFILE_PIC_WARM_CONCURRENCY = 2/);
  assert.match(gateway, /while \(profilePicCache\.size > MAX_PROFILE_PIC_CACHE\)/);
});

test("snapshot sync is delta based and chunked", () => {
  assert.match(gateway, /offset \+= 100/);
  assert.match(gateway, /const changedRows = \[\]/);
  assert.match(gateway, /if \(changed\) changedRows\.push\(row\)/);
  assert.match(gateway, /\.upsert\(changedRows/);
});

test("webhooks and sends are globally bounded", () => {
  assert.match(gateway, /WHATSAPP2_WEBHOOK_CONCURRENCY = 4/);
  assert.match(gateway, /AbortSignal\.timeout\(10_000\)/);
  assert.match(gateway, /WHATSAPP2_SEND_CONCURRENCY = 1/);
  assert.match(gateway, /runWithSendSlot/);
});

test("terminal durable queues have bounded retention", () => {
  assert.match(retention, /interval '14 days'/);
  assert.match(retention, /interval '30 days'/);
  assert.match(retention, /cleanup_whatsapp2_terminal_jobs/);
  assert.match(retention, /whatsapp2-terminal-retention-cleanup/);
  assert.doesNotMatch(retention, /status = 'pending'/);
  assert.doesNotMatch(retention, /status = 'processing'/);
  assert.doesNotMatch(retention, /status = 'sending'/);
});

test("retention hardening preserves uncertain deliveries and rejects invalid intervals", () => {
  assert.match(retentionHardening, /status = 'failed'/);
  assert.doesNotMatch(retentionHardening, /status in \('failed', 'uncertain'\)/);
  assert.match(retentionHardening, /p_completed_retention must be positive/);
  assert.match(retentionHardening, /p_failed_retention must be positive/);
});
