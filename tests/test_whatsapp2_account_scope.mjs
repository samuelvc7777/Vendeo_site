import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  normalizeWhatsAppAccountId,
  whatsappAccountIdFromWid,
  whatsapp2ConversationIdForAccount,
  whatsappAccountIdFromConversationId,
  whatsappProviderIdFromConversationId,
  whatsappConversationBelongsToAccount,
  isLatestWhatsAppAccountLoad,
  resolveWhatsAppContactDisplayName,
} = require("../src/domain/entities/whatsapp2-account-scope.cjs");

test("deriva uma chave estável do número da própria conta WhatsApp", () => {
  assert.equal(whatsappAccountIdFromWid("5511999998888@c.us"), "account-5511999998888");
  assert.equal(whatsappAccountIdFromWid("+55 (11) 99999-8888@s.whatsapp.net"), "account-5511999998888");
  assert.equal(whatsappAccountIdFromWid("status@broadcast"), null);
});

test("separa o mesmo contato pelo número conectado e mantém o JID do contato", () => {
  const chatId = "551188887777@c.us";
  const first = whatsapp2ConversationIdForAccount(chatId, "account-5511999998888");
  const second = whatsapp2ConversationIdForAccount(chatId, "account-5511888877666");

  assert.equal(first, "wa2:account-5511999998888:551188887777@c.us");
  assert.notEqual(first, second);
  assert.equal(whatsappAccountIdFromConversationId(first), "account-5511999998888");
  assert.equal(whatsappProviderIdFromConversationId(first), chatId);
  assert.equal(whatsappProviderIdFromConversationId("wa2:551188887777@c.us"), chatId);
});

test("rejeita uma conta sem número válido para não gravar conversa sem escopo", () => {
  assert.equal(normalizeWhatsAppAccountId("primary"), null);
  assert.throws(
    () => whatsapp2ConversationIdForAccount("551188887777@c.us", "primary"),
    /whatsapp2_account_identity_unavailable/,
  );
});

test("só aceita conversas e eventos do número conectado", () => {
  const accountId = "account-5511999998888";
  assert.equal(
    whatsappConversationBelongsToAccount("wa2:account-5511999998888:551188887777@c.us", accountId),
    true,
  );
  assert.equal(
    whatsappConversationBelongsToAccount("wa2:account-5511888877666:551188887777@c.us", accountId),
    false,
  );
  assert.equal(whatsappConversationBelongsToAccount("wa2:551188887777@c.us", accountId), false);
  assert.equal(whatsappConversationBelongsToAccount("wa2:account-5511999998888:5511@g.us", null), false);
});

test("descarta resultado atrasado da conta anterior depois da troca", () => {
  assert.equal(isLatestWhatsAppAccountLoad(12, 13), false);
  assert.equal(isLatestWhatsAppAccountLoad(13, 13), true);
});

test("prioriza nome salvo no celular e usa o nome do perfil apenas como reserva", () => {
  assert.equal(resolveWhatsAppContactDisplayName({
    savedContactName: "Cliente salvo no celular",
    profileName: "Nome do perfil",
    fallbackName: "551188887777@c.us",
    providerId: "551188887777@c.us",
  }), "Cliente salvo no celular");
  assert.equal(resolveWhatsAppContactDisplayName({
    profileName: "Nome do perfil",
    fallbackName: "551188887777@c.us",
    providerId: "551188887777@c.us",
  }), "Nome do perfil");
  assert.equal(resolveWhatsAppContactDisplayName({
    savedContactName: "551188887777@c.us",
    profileName: "Nome do perfil",
    fallbackName: "551188887777@c.us",
    providerId: "551188887777@c.us",
  }), "Nome do perfil");
  assert.equal(resolveWhatsAppContactDisplayName({
    fallbackName: "123456789012@lid",
    providerId: "123456789012@lid",
  }), "Contato");
});
