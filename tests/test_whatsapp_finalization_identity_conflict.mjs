import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gateway = fs.readFileSync("services/whatsapp2-gateway/index.cjs", "utf8");
const route = gateway.slice(
  gateway.indexOf('url.pathname === "/messages/finalization/queue"'),
  gateway.indexOf('url.pathname === "/messages/send"')
);
const migration = fs.readFileSync("supabase/migrations/20261019130000_finalization_allow_confirmed_chat_identities.sql", "utf8");

test("finalization only starts for the scoped WhatsApp account and a stored chat", () => {
  assert.match(route, /whatsappAccountIdFromConversationId\(conversationId\) !== accountId/);
  assert.match(route, /\.from\("instagram_conversations"\)/);
  assert.match(route, /\.eq\("id", conversationId\)/);
  assert.match(route, /storedConversation\.channel !== "whatsapp2"/);
  assert.match(route, /getChatById\(recipient\)/);
  assert.match(route, /if \(!chat \|\| chat\.isGroup\)/);
});

test("a verified stored LID or direct scoped phone is accepted without a conflicting alias lookup", () => {
  assert.match(route, /storedContactId === recipient \|\| conversationProviderId === recipient/);
  assert.match(route, /if \(!sameStoredRecipient\) \{/);
  assert.match(route, /const canonical = await resolveCanonicalConversationId\(recipient\)/);
  assert.match(route, /if \(canonical !== conversationId\)/);
  assert.match(route, /Destinatário diferente do contato desta conversa/);
});

test("blocked or unknown status stays restricted; manual finalization accepts archived or locked", () => {
  assert.match(route, /\["active", "archived", "locked"\]\.includes\(storedConversation\.status\)/);
  assert.match(migration, /c\.status in \('active', 'archived', 'locked'\)/);
  assert.doesNotMatch(migration, /c\.status\s*=\s*'active'/);
});

test("finalization still queues through the transactional idempotent RPC", () => {
  assert.match(route, /supabase\.rpc\("enqueue_whatsapp_finalization_batch"/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /format_available_raffle_numbers_for_finalization\(\)/);
  assert.match(migration, /then interval '3 seconds' else interval '10 seconds'/);
});
