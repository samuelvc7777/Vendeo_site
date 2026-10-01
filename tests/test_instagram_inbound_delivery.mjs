import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const edgeSource = readFileSync(
  join(projectRoot, "supabase/functions/api/index.ts"),
  "utf8"
);
const realtimeSource = readFileSync(
  join(projectRoot, "src/presentation/hooks/useChatRealtime.ts"),
  "utf8"
);

const webhookStart = edgeSource.indexOf("// 1. INSTAGRAM / META WEBHOOK");
const webhookEnd = edgeSource.indexOf("// INSTAGRAM: UPLOAD", webhookStart);
assert.ok(webhookStart >= 0 && webhookEnd > webhookStart);
const webhookSource = edgeSource.slice(webhookStart, webhookEnd);

test("webhook entrega mensagens inbound por broadcast além de postgres_changes", () => {
  assert.match(webhookSource, /const messageBroadcast = \(async \(\) => \{/);
  assert.match(webhookSource, /event: "instagram_message"/);
  assert.match(webhookSource, /senderId: isEcho \? "me" : senderId/);
  assert.match(webhookSource, /isMine: isEcho/);
  assert.match(webhookSource, /status: isEcho \? "sent" : "delivered"/);
  assert.match(webhookSource, /waitUntil\(messageBroadcast\)/);
});

test("client mantém broadcast e postgres INSERT com deduplicação por message id", () => {
  assert.match(
    realtimeSource,
    /"broadcast",[\s\S]*?\{ event: "instagram_message" \}/
  );
  assert.match(
    realtimeSource,
    /"postgres_changes",[\s\S]*?event: "INSERT",[\s\S]*?table: "instagram_messages"/
  );
  assert.match(
    realtimeSource,
    /processedMessageIdsRef\.current\.has\(payload\.id\)/
  );
  assert.match(
    realtimeSource,
    /processedMessageIdsRef\.current\.has\(String\(row\.id\)\)/
  );
});
