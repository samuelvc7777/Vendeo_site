import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("paid raffle purchase linked to Instagram auto-marks chat as bought", () => {
  const hook = fs.readFileSync(
    new URL("../src/presentation/hooks/useRaffles.ts", import.meta.url),
    "utf8",
  );

  assert.match(hook, /params\.status === "paid" && params\.buyer\.conversationId/);
  assert.match(hook, /operation: "raffle_purchase_confirmed"/);
  assert.match(hook, /conversationId: params\.buyer\.conversationId/);
});

test("reserved raffle tickets do not count as bought", () => {
  const hook = fs.readFileSync(
    new URL("../src/presentation/hooks/useRaffles.ts", import.meta.url),
    "utf8",
  );

  const paidGuardIndex = hook.indexOf('params.status === "paid" && params.buyer.conversationId');
  const syncIndex = hook.indexOf('operation: "raffle_purchase_confirmed"');
  assert.ok(paidGuardIndex >= 0);
  assert.ok(syncIndex > paidGuardIndex);
});

test("purchase confirmation endpoint is separate from finalized-only manual status control", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/operator_chat_progress.ts", import.meta.url),
    "utf8",
  );

  const autoIndex = source.indexOf('operation === "raffle_purchase_confirmed"');
  const manualIndex = source.indexOf('operation === "raffle_status"');
  assert.ok(autoIndex >= 0);
  assert.ok(manualIndex > autoIndex);

  const autoBlock = source.slice(autoIndex, manualIndex);
  assert.match(autoBlock, /raffle_status: "bought"/);
  assert.doesNotMatch(autoBlock, /is_converted !== true/);

  const manualBlock = source.slice(manualIndex);
  assert.match(manualBlock, /conversation\.is_converted !== true/);
});

test("Instagram profile selection stores the conversation id used by the automatic sync", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/sales/InstagramBuyerConnector.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /conversationId: conv\.id/);
});
