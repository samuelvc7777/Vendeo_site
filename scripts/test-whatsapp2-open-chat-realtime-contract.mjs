import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const directPath = path.join(
  here,
  "..",
  "src",
  "presentation",
  "components",
  "chat",
  "InstagramDirect.tsx",
);
const direct = fs.readFileSync(directPath, "utf8");

const task6Anchor = direct.indexOf(
  "const processedEventKeys = new Set<string>();",
);
const openChatStart = direct.lastIndexOf(
  "  useEffect(() => {",
  task6Anchor,
);
const openChatEnd = direct.indexOf(
  "// Carrega conversas reais do Instagram",
  task6Anchor,
);
const openChat = direct.slice(openChatStart, openChatEnd);

test("Task 6 reuses the existing SSE connection instead of opening another one", () => {
  const occurrences = direct.match(/openWhatsApp2EventStream\(/g) || [];
  assert.equal(occurrences.length, 1);
  assert.match(
    direct,
    /whatsapp2OpenChatEventHandlerRef\.current\(event\);[\s\S]*event\.type !== "presence"/,
  );
});

test("open WhatsApp 2 chat handles live message lifecycle events", () => {
  assert.ok(openChatStart >= 0 && openChatEnd > openChatStart);
  assert.match(openChat, /event\.type === "message" \|\| event\.type === "message_create"/);
  assert.match(openChat, /event\.type === "message_ack"/);
  assert.match(openChat, /event\.type === "message_reaction"/);
  assert.match(openChat, /event\.type === "message_revoke_everyone"/);
  assert.match(openChat, /belongsToOpenChat\(message\)/);
});

test("canonical Realtime is scoped to only the active conversation", () => {
  assert.match(
    openChat,
    /table: "instagram_messages",[\s\S]*filter: `conversation_id=eq\.\$\{conversationId\}`/,
  );
  assert.match(openChat, /scheduleCanonicalRefresh\(\)/);
});

test("canonical refresh and full reconcile are both in-flight deduplicated", () => {
  assert.match(openChat, /if \(canonicalRefreshInFlight\)/);
  assert.match(openChat, /canonicalRefreshQueued = true/);
  assert.match(openChat, /if \(fullReconcileInFlight\) return fullReconcileInFlight/);
});

test("live events are deduplicated with a bounded memory set", () => {
  assert.match(openChat, /const processedEventKeys = new Set<string>\(\)/);
  assert.match(openChat, /if \(processedEventKeys\.has\(key\)\) return false/);
  assert.match(openChat, /processedEventKeys\.size > 300/);
  assert.match(openChat, /items\.slice\(-150\)/);
});

test("reconciliation is slow, health-aware and background-friendly", () => {
  assert.match(openChat, /return 300_000/);
  assert.match(openChat, /const baseMs = realtimeHealthy \? 120_000 : 30_000/);
  assert.match(
    openChat,
    /Math\.min\(baseMs \* Math\.pow\(2, Math\.min\(reconcileFailures, 3\)\), 300_000\)/,
  );
  assert.match(
    openChat,
    /Date\.now\(\) - lastFullReconcileAt < 30_000/,
  );
});

test("old three-second open-chat polling is gone", () => {
  assert.doesNotMatch(openChat, /setInterval/);
  assert.doesNotMatch(openChat, /3000/);
  assert.match(openChat, /scheduleReconcile\(\)/);
});

test("reconcile merges instead of replacing newer live messages", () => {
  assert.match(
    openChat,
    /deduplicateMessages\(\[[\s\S]*\.\.\.\(previous\[conversationId\] \|\| \[\]\),[\s\S]*\.\.\.incoming/,
  );
});

test("initial Task 6 setup enriches canonical state without duplicate full history fetch", () => {
  const setupTail = openChat.slice(openChat.lastIndexOf("// O histórico bruto"));
  assert.match(setupTail, /scheduleCanonicalRefresh\(0\)/);
  assert.match(setupTail, /scheduleReconcile\(\)/);
  assert.doesNotMatch(setupTail, /void fullReconcile\(\)/);
});
