import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync("src/presentation/components/chat/WhatsAppFinalizationActions.tsx", "utf8");
const viewer = fs.readFileSync("src/presentation/components/chat/WhatsAppMyStatusViewer.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261019123000_finalization_live_raffle_numbers.sql", "utf8");
const formatMigration = fs.readFileSync("supabase/migrations/20261019124000_correct_finalization_raffle_number_format.sql", "utf8");

test("Cofre permite item de 10 números livres que não são a lista de exemplo", () => {
  assert.match(ui, /kind: "raffle_numbers"/);
  assert.match(ui, /10 números livres/);
  assert.match(ui, /const addRaffleNumbers = async/);
  assert.match(ui, /items\.some\(\(item\) => item\.kind === "raffle_numbers"\)/);
  assert.match(ui, /item\.kind === "raffle_numbers"/);
  assert.match(ui, /Os números reais serão selecionados entre os disponíveis no envio/);
});

test("números são consultados da rifa ativa no ato de agendar, sem usar valores fixos", () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(c\.stage_completed_rules->'raffles'/);
  assert.match(migration, /r\.item->>'status'='active'/);
  assert.match(migration, /r\.item->>'endDate'/);
  assert.match(migration, /ticket->>'status' in \('reserved','paid'\)/);
  assert.match(migration, /order by random\(\) limit 10/);
  assert.match(migration, /v_count <> 10/);
  assert.match(migration, /when v_item\.kind='raffle_numbers' then public\.format_available_raffle_numbers_for_finalization\(\)/);
  assert.match(migration, /when v_item\.kind = 'raffle_numbers' then 'text'/);
  assert.match(migration, /having count\(\*\) filter \(where kind='raffle_numbers'\)=0/);
  assert.match(formatMigration, /greatest\(2,length\(\(v_total-1\)::text\)\)/);
});

test("visualizador de status recupera novas publicações sem recarregar página", () => {
  assert.match(viewer, /window\.setInterval\(\(\) => \{/);
  assert.match(viewer, /document\.visibilityState === "visible"/);
  assert.match(viewer, /void refresh\(true\)/);
  assert.match(viewer, /20_000/);
  assert.match(viewer, /same \? previous : next/);
  assert.match(viewer, /if \(!quiet\) setViewsRevision/);
});
