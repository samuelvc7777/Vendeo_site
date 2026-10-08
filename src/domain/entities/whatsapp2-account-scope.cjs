const ACCOUNT_ID_PREFIX = "account-";

function normalizeWhatsAppAccountId(value) {
  const raw = String(value || "").trim();
  if (/^account-\d{8,15}$/.test(raw)) return raw;
  const digits = raw.replace(/@.*$/, "").replace(/\D+/g, "");
  return /^\d{8,15}$/.test(digits) ? `${ACCOUNT_ID_PREFIX}${digits}` : null;
}

function whatsappAccountIdFromWid(wid) {
  return normalizeWhatsAppAccountId(wid);
}

function whatsapp2ConversationIdForAccount(chatId, accountId) {
  const resolvedAccountId = normalizeWhatsAppAccountId(accountId);
  const providerId = whatsappProviderIdFromConversationId(chatId);
  if (!resolvedAccountId) throw new Error("whatsapp2_account_identity_unavailable");
  if (!providerId) throw new Error("whatsapp2_chat_identity_unavailable");
  return `wa2:${resolvedAccountId}:${providerId}`;
}

function whatsappAccountIdFromConversationId(conversationId) {
  const match = /^wa2:(account-\d{8,15}):/.exec(String(conversationId || "").trim());
  return match?.[1] || null;
}

function whatsappConversationBelongsToAccount(conversationId, accountId) {
  const normalizedAccountId = normalizeWhatsAppAccountId(accountId);
  return Boolean(
    normalizedAccountId &&
    whatsappAccountIdFromConversationId(conversationId) === normalizedAccountId,
  );
}

function isLatestWhatsAppAccountLoad(requestId, latestRequestId) {
  return requestId === latestRequestId;
}

function whatsappProviderIdFromConversationId(conversationId) {
  return String(conversationId || "")
    .trim()
    .replace(/^wa2:(?:account-\d{8,15}:)?/i, "");
}

function resolveWhatsAppContactDisplayName({
  savedContactName,
  profileName,
  fallbackName,
  providerId,
} = {}) {
  const identity = whatsappProviderIdFromConversationId(providerId).trim();
  const identityDigits = identity.replace(/@.*$/, "").replace(/\D+/g, "");
  const hasNonPhoneAddress = /@(lid|g\.us|broadcast)$/i.test(identity);
  const isIdentity = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return true;
    if (normalized.toLowerCase() === identity.toLowerCase()) return true;
    const digits = normalized.replace(/\D+/g, "");
    return Boolean(identityDigits) && /^\d[\d\s()+.-]*$/.test(normalized) && digits === identityDigits;
  };

  for (const candidate of [savedContactName, profileName, fallbackName]) {
    const name = String(candidate || "").trim();
    if (name && !isIdentity(name)) return name;
  }

  if (!hasNonPhoneAddress && identityDigits.length >= 8 && identityDigits.length <= 15) return identityDigits;
  return "Contato";
}

module.exports = {
  normalizeWhatsAppAccountId,
  whatsappAccountIdFromWid,
  whatsapp2ConversationIdForAccount,
  whatsappAccountIdFromConversationId,
  whatsappProviderIdFromConversationId,
  whatsappConversationBelongsToAccount,
  isLatestWhatsAppAccountLoad,
  resolveWhatsAppContactDisplayName,
};
