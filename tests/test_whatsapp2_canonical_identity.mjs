import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveWhatsApp2CanonicalConversationId } = require("../services/whatsapp2-gateway/canonical-identity.cjs");

test("mensagem WhatsApp com LID retoma a conversa canônica ligada ao telefone", async () => {
  const resolved = await resolveWhatsApp2CanonicalConversationId({
    chatId: "opaque-contact@lid",
    resolvePhoneForLid: async () => "+5511987654321",
    lookupIdentity: async (identifiers) => identifiers.includes("+5511987654321")
      ? "tinder:match_123"
      : null,
  });

  assert.equal(resolved, "tinder:match_123");
});

test("falha transitória no cadastro de identidades não cria conversa wa2 paralela", async () => {
  await assert.rejects(
    () => resolveWhatsApp2CanonicalConversationId({
      chatId: "opaque-contact@lid",
      resolvePhoneForLid: async () => "+5511987654321",
      lookupIdentity: async () => { throw new Error("database unavailable"); },
    }),
    /canonical_identity_lookup_failed.*database unavailable/,
  );
});

test("LID sem telefone confirmado não é convertido em uma nova identidade canônica", async () => {
  await assert.rejects(
    () => resolveWhatsApp2CanonicalConversationId({
      chatId: "opaque-contact@lid",
      resolvePhoneForLid: async () => null,
      lookupIdentity: async () => null,
    }),
    /wa2_lid_phone_unresolved/,
  );
});
