import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const edgeSource = readFileSync(join(projectRoot, "supabase/functions/api/index.ts"), "utf8");
const clientSource = readFileSync(
  join(projectRoot, "src/presentation/components/chat/InstagramDirect.tsx"),
  "utf8"
);

const postStart = edgeSource.indexOf("// POST: Envio de mensagem com resolução de IGSID");
const postEnd = edgeSource.indexOf("// 6. TINDER", postStart);
assert.ok(postStart >= 0 && postEnd > postStart);
const instagramPostRoute = edgeSource.slice(postStart, postEnd);

test("reply_to nativo é usado tanto no envio imediato quanto no envio agendado", () => {
  assert.match(
    instagramPostRoute,
    /const buildMetaSendPayload = \(\) => \{[\s\S]*?payload\.reply_to = \{ mid: replyToMessageId \};[\s\S]*?payload\.messaging_type = "RESPONSE"/
  );

  const payloadUses = instagramPostRoute.match(/JSON\.stringify\(buildMetaSendPayload\(\)\)/g) || [];
  assert.equal(payloadUses.length, 2);
});

test("fila agendada preserva a referência da mensagem respondida no banco, realtime e resposta", () => {
  const queueStart = instagramPostRoute.indexOf("if (delaySeconds > 0)");
  const queueEnd = instagramPostRoute.indexOf("// 4. Envia para a Meta Graph API", queueStart);
  assert.ok(queueStart >= 0 && queueEnd > queueStart);
  const queueSource = instagramPostRoute.slice(queueStart, queueEnd);

  const dbReferences = queueSource.match(/reply_to_message_id: replyToMessageId/g) || [];
  assert.ok(dbReferences.length >= 3);
  assert.match(queueSource, /event: "instagram_message"[\s\S]*?replyToMessageId/);
  assert.match(queueSource, /queued: true[\s\S]*?replyToMessageId/);
});

test("falha em quote reply não é degradada silenciosamente para mensagem normal", () => {
  assert.doesNotMatch(instagramPostRoute, /Tentando reenvio direto/);
  assert.doesNotMatch(instagramPostRoute, /delete metaSendPayload\.reply_to/);
});

test("retry no app mantém o reply original", () => {
  const retryStart = clientSource.indexOf("const handleRetryMessage = async");
  const retryEnd = clientSource.indexOf("const handleOpenInInstagram", retryStart);
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  const retrySource = clientSource.slice(retryStart, retryEnd);

  assert.match(retrySource, /replyTo: activeChat\.type === "instagram" \? failedMsg\.replyTo : undefined/);
  assert.match(
    retrySource,
    /replyToMessageId: activeChat\.type === "instagram" \? failedMsg\.replyToMessageId : undefined/
  );
});

test("persistência de reply fica canônica no backend e não depende de update direto do browser", () => {
  const sendStart = clientSource.indexOf("const sendMessageWithText = async");
  const sendEnd = clientSource.indexOf("// Envio de mensagem pelo formulário tradicional", sendStart);
  assert.ok(sendStart >= 0 && sendEnd > sendStart);
  const sendSource = clientSource.slice(sendStart, sendEnd);

  assert.doesNotMatch(sendSource, /\.update\(\{\s*reply_to_message_id/);
  assert.match(sendSource, /replyToMessageId: currentReply\?\.id/);
});
