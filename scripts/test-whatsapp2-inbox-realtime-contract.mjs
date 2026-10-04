import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(
  here,
  "..",
  "src",
  "presentation",
  "hooks",
  "useChatRealtime.ts",
);
const directPath = path.join(
  here,
  "..",
  "src",
  "presentation",
  "components",
  "chat",
  "InstagramDirect.tsx",
);

const hook = fs.readFileSync(hookPath, "utf8");
const direct = fs.readFileSync(directPath, "utf8");

test("Realtime preserves whatsapp2 as a first-class channel", () => {
  assert.match(
    hook,
    /channel\?: "instagram" \| "whatsapp" \| "whatsapp2"/,
  );
  assert.match(hook, /onWhatsApp2ConversationUpdate/);
  assert.match(hook, /onWhatsApp2ConversationInsert/);
  assert.match(hook, /row\.channel === "whatsapp2"/);
});

test("whatsapp2 message inserts do not leak into Instagram chat handling", () => {
  assert.match(
    hook,
    /row\.channel === "whatsapp2" \|\| String\(row\.conversation_id\)\.startsWith\("wa2:"\)/,
  );
  assert.match(
    hook,
    /String\(payload\.conversationId\)\.startsWith\("wa2:"\)/,
  );
});

test("WhatsApp 2 inbox consumes canonical Realtime conversation changes", () => {
  assert.match(
    direct,
    /const handleRealtimeWhatsApp2Conversation = useCallback/,
  );
  assert.match(
    direct,
    /setWhatsApp2Conversations\(\(previous\) =>/,
  );
  assert.match(
    direct,
    /onWhatsApp2ConversationUpdate: handleRealtimeWhatsApp2Conversation/,
  );
  assert.match(
    direct,
    /onWhatsApp2ConversationInsert: handleRealtimeWhatsApp2Conversation/,
  );
});

test("WhatsApp 2 inbox fallback polling is slow and health-aware", () => {
  const start = direct.indexOf('if (activeChannel !== "whatsapp2") return;');
  const end = direct.indexOf(
    'if (activeChat?.type !== "whatsapp2")',
    start,
  );
  const block = direct.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /isRealtimeConnectedRef\.current \? 120_000 : 30_000/);
  assert.match(block, /30_000/);
  assert.doesNotMatch(block, /5000/);
  assert.doesNotMatch(block, /setInterval/);
});

test("canonical-only WhatsApp 2 conversations survive initial reconciliation", () => {
  assert.match(
    direct,
    /\.\.\.canonicalRows\.map\(\(row: any\) => String\(row\.id\)\)/,
  );
  assert.match(
    direct,
    /\.\.\.gatewayRows\.map\(\(row\) => row\.id\)/,
  );
  assert.match(
    direct,
    /Boolean\(canonical\) && canonicalMessageAt >= gatewayMessageAt/,
  );
});

test("a slow reconcile cannot overwrite a newer Realtime inbox row", () => {
  assert.match(
    direct,
    /setWhatsApp2Conversations\(\(currentRows\) =>/,
  );
  assert.match(
    direct,
    /if \(currentAt > reconciledAt\) \{[\s\S]*reconciledById\.set\(current\.id, current\)/,
  );
});

test("WhatsApp 2 inbox keeps the seven-day visibility rule", () => {
  assert.match(
    direct,
    /const oneWeekAgoMs = Date\.now\(\) - \(7 \* 24 \* 60 \* 60 \* 1000\)/,
  );
  assert.match(
    direct,
    /incomingAtMs > 0 && incomingAtMs < oneWeekAgoMs/,
  );
});
