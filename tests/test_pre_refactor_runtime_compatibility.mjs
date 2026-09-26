import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_CYCLE_TTL_SECONDS,
  checkCycleAuthority,
  getStaleCycleThresholdIso,
  isCycleStaleAt,
} from "../supabase/functions/api/autopilot_cycle_safety.ts";
import { persistDurableOutboxBatchAtomic } from "../supabase/functions/api/brain_orchestrator.ts";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexSource = readFileSync(join(projectRoot, "supabase/functions/api/index.ts"), "utf8");
const brainSource = readFileSync(join(projectRoot, "supabase/functions/api/brain_orchestrator.ts"), "utf8");
const oldPauseMigration = readFileSync(
  join(projectRoot, "supabase/migrations/20260923170000_atomic_chat_progress_and_runtime_guard.sql"),
  "utf8",
);
const compatibilityMigrationName = readdirSync(join(projectRoot, "supabase/migrations"))
  .find((name) => name.endsWith("_restore_pre_refactor_pause_rpc_compatibility.sql"));
assert.ok(compatibilityMigrationName, "a migration de compatibilidade deve existir");
const compatibilityMigration = readFileSync(
  join(projectRoot, "supabase/migrations", compatibilityMigrationName),
  "utf8",
);

test("TTL de stale usa a fonte única de 300s", () => {
  assert.equal(ACTIVE_CYCLE_TTL_SECONDS, 300);
  assert.equal(
    getStaleCycleThresholdIso(Date.parse("2026-09-26T12:05:00.000Z")),
    "2026-09-26T12:00:00.000Z",
  );
  assert.match(indexSource, /getStaleCycleThresholdIso\(\)/);
  assert.doesNotMatch(indexSource, /180_000/);
  assert.match(indexSource, /\.lte\("stage_completed_rules->>active_cycle_at", staleThresholdIso\)/);
});

test("ciclo com menos de 300s não é stale", () => {
  const t0 = Date.parse("2026-09-26T12:00:00.000Z");
  assert.equal(isCycleStaleAt(new Date(t0).toISOString(), t0 + 180_000), false);
  assert.equal(isCycleStaleAt(new Date(t0).toISOString(), t0 + 299_999), false);
});

test("ciclo com 300s ou mais pode ser considerado stale", () => {
  const t0 = Date.parse("2026-09-26T12:00:00.000Z");
  assert.equal(isCycleStaleAt(new Date(t0).toISOString(), t0 + 300_000), true);
  assert.equal(isCycleStaleAt(new Date(t0).toISOString(), t0 + 301_000), true);
});

test("resultado do Agent mantém authority antes do TTL e superseded continua fail-closed", () => {
  const firstAuthorityGate = brainSource.indexOf("if (!(await checkCycleAuthority(supabase, conversationId, correlationId)))");
  const outboxPersistence = brainSource.indexOf("const persistBatchRes = await persistDurableOutboxBatchAtomic");
  assert.ok(firstAuthorityGate >= 0, "o gate de authority deve existir depois do Agent");
  assert.ok(outboxPersistence > firstAuthorityGate, "a outbox vem depois da validação de ownership");
  assert.match(brainSource, /late_agent_result_discarded/);
  assert.match(brainSource, /blockLegacyFallback: true/);
});

test("nenhuma outbox é criada por ciclo sem ownership", () => {
  const authorityGate = brainSource.indexOf("if (!(await checkCycleAuthority(supabase, conversationId, correlationId)))");
  const outboxCall = brainSource.indexOf("const persistBatchRes = await persistDurableOutboxBatchAtomic");
  const discardedReturn = brainSource.indexOf('error: "late_agent_result_discarded"');
  assert.ok(authorityGate >= 0);
  assert.ok(outboxCall > authorityGate);
  assert.ok(discardedReturn > authorityGate && discardedReturn < outboxCall);
});

test("ciclo com ownership persiste durable outbox antes do dispatcher", () => {
  assert.match(brainSource, /persistDurableOutboxBatchAtomic/);
  assert.match(brainSource, /persist_durable_outbox_batch/);
  const persistence = brainSource.indexOf("const persistBatchRes = await persistDurableOutboxBatchAtomic");
  const dispatcher = brainSource.indexOf("const dispatchResult = await runDurableOutboxDispatcher");
  assert.ok(persistence >= 0 && dispatcher > persistence);
});

test("Agent antes do TTL mantém authority e o lote válido chega à durable outbox", async () => {
  const calls = [];
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { stage_completed_rules: { active_cycle_token: "cycle-valid" } }, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name) {
      calls.push(name);
      if (name === "prepare_experimental_outbox_entry") return { data: { success: true }, error: null };
      return { data: { success: true, reason: "persisted", count: 1, keys: ["entry-1"] }, error: null };
    },
  };

  assert.equal(await checkCycleAuthority(supabase, "conversation-1", "cycle-valid"), true);
  const result = await persistDurableOutboxBatchAtomic({
    supabase,
    conversationId: "conversation-1",
    cycleToken: "cycle-valid",
    outboxEntries: [{ id: "entry-1", idempotencyKey: "entry-1", cycleId: "cycle-valid", status: "pending" }],
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, ["prepare_experimental_outbox_entry", "persist_durable_outbox_batch"]);
});

test("ciclo sem ownership não cria durable outbox", async () => {
  const calls = [];
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { stage_completed_rules: { active_cycle_token: "cycle-other" } }, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name) {
      calls.push(name);
      return { data: { success: false, reason: "cycle_token_mismatch" }, error: null };
    },
  };

  assert.equal(await checkCycleAuthority(supabase, "conversation-1", "cycle-late"), false);
  const result = await persistDurableOutboxBatchAtomic({
    supabase,
    conversationId: "conversation-1",
    cycleToken: "cycle-late",
    outboxEntries: [{ id: "entry-late", idempotencyKey: "entry-late", cycleId: "cycle-late", status: "pending" }],
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, "cycle_token_mismatch");
  assert.deepEqual(calls, ["prepare_experimental_outbox_entry"]);
});

test("migration cria a assinatura de 3 argumentos e preserva a antiga de 2", () => {
  assert.match(
    compatibilityMigration,
    /CREATE OR REPLACE FUNCTION public\.patch_autopilot_pause_atomic\(\s*p_conversation_id text,\s*p_paused boolean,\s*p_reason text/s,
  );
  assert.match(compatibilityMigration, /FOR UPDATE/);
  assert.match(compatibilityMigration, /ai_auto_respond = false/);
  assert.match(compatibilityMigration, /ai_debounce_until = NULL/);
  assert.match(compatibilityMigration, /cancel_current_cycle/);
  assert.match(compatibilityMigration, /paused_manual/);
  assert.match(compatibilityMigration, /pause_reason/);
  assert.match(compatibilityMigration, /v_rules := v_rules - 'cancel_current_cycle' - 'pause_reason'/);
  assert.match(oldPauseMigration, /patch_autopilot_pause_atomic\(\s*p_conversation_id text,\s*p_paused boolean/s);
  assert.doesNotMatch(compatibilityMigration, /DROP FUNCTION\s+public\.patch_autopilot_pause_atomic/i);
});

test("nova RPC só concede EXECUTE a service_role", () => {
  assert.match(
    compatibilityMigration,
    /REVOKE ALL ON FUNCTION public\.patch_autopilot_pause_atomic\(text, boolean, text\) FROM PUBLIC;/,
  );
  assert.match(
    compatibilityMigration,
    /REVOKE ALL ON FUNCTION public\.patch_autopilot_pause_atomic\(text, boolean, text\) FROM anon, authenticated;/,
  );
  assert.match(
    compatibilityMigration,
    /GRANT EXECUTE ON FUNCTION public\.patch_autopilot_pause_atomic\(text, boolean, text\) TO service_role;/,
  );
  assert.doesNotMatch(compatibilityMigration, /^GRANT EXECUTE[^;]+\bTO\s+(anon|authenticated|PUBLIC)\b/im);
});

test("endpoint backend continua sendo a autoridade de sincronização da pausa", () => {
  assert.match(indexSource, /path === "\/autopilot\/pause"/);
  assert.match(indexSource, /supabase\.rpc\(\s*"patch_autopilot_pause_atomic"/);
  assert.match(indexSource, /Atualizando somente coluna física ai_auto_respond/);
});
