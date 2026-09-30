import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  RAFFLE_COMMERCIAL_STATUS_OPTIONS,
  normalizeRaffleCommercialStatus,
  raffleCommercialStatusLabel,
} from "../src/domain/entities/RaffleStatus.ts";

test("normalizes raffle commercial statuses and keeps not offered as null", () => {
  assert.equal(normalizeRaffleCommercialStatus("offered"), "offered");
  assert.equal(normalizeRaffleCommercialStatus("bought"), "bought");
  assert.equal(normalizeRaffleCommercialStatus("not_bought"), "not_bought");
  assert.equal(normalizeRaffleCommercialStatus(null), null);
  assert.equal(normalizeRaffleCommercialStatus("anything_else"), null);
});

test("exposes all manual raffle controls without creating a global filter state", () => {
  assert.deepEqual(
    RAFFLE_COMMERCIAL_STATUS_OPTIONS.map((option) => option.value),
    [null, "offered", "bought", "not_bought"],
  );
  assert.equal(raffleCommercialStatusLabel(null), "Não oferecido");
  assert.equal(raffleCommercialStatusLabel("offered"), "Oferecido");
  assert.equal(raffleCommercialStatusLabel("bought"), "Comprou");
  assert.equal(raffleCommercialStatusLabel("not_bought"), "Não comprou");
});

test("operator backend only allows raffle status changes on finalized chats", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/operator_chat_progress.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /operation === "raffle_status"/);
  assert.match(source, /conversation\.is_converted !== true/);
  assert.match(source, /offered/);
  assert.match(source, /bought/);
  assert.match(source, /not_bought/);
});

test("migration stores raffle status independently from objectives", () => {
  const migrations = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url));
  const migration = migrations.find((name) => name.endsWith("_raffle_commercial_status.sql"));
  assert.ok(migration);
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8");
  assert.match(sql, /add column if not exists raffle_status text/i);
  assert.match(sql, /raffle_status in \('offered', 'bought', 'not_bought'\)/i);
  assert.doesNotMatch(sql, /stage_completed_rules\s*=/i);
});
