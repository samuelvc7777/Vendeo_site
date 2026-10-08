function identityCandidates(value) {
  const clean = String(value || "").trim().replace(/^wa2:(?:account-[^:]+:)?/i, "");
  const digits = clean.replace(/\D+/g, "");
  return Array.from(new Set([
    clean,
    digits,
    digits ? `+${digits}` : "",
    digits ? `${digits}@c.us` : "",
    digits ? `${digits}@s.whatsapp.net` : "",
  ].filter(Boolean)));
}

function canonicalIdForWhatsAppIdentity(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return `wa2:${digits}@c.us`;
}

async function lookupCanonicalIdentity(lookupIdentity, identifiers) {
  try {
    return await lookupIdentity(identifiers);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`canonical_identity_lookup_failed: ${detail}`);
  }
}

async function resolveWhatsApp2CanonicalConversationId(params) {
  const chatId = String(params?.chatId || "").trim().replace(/^wa2:(?:account-[^:]+:)?/i, "");
  if (!chatId) return "wa2:unknown";

  const directIdentity = await lookupCanonicalIdentity(
    params.lookupIdentity,
    identityCandidates(chatId),
  );
  if (directIdentity) return String(directIdentity);

  if (chatId.endsWith("@lid")) {
    let phoneNumber = null;
    try {
      phoneNumber = await params.resolvePhoneForLid(chatId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`wa2_lid_phone_resolution_failed: ${detail}`);
    }
    if (!phoneNumber) {
      throw new Error("wa2_lid_phone_unresolved");
    }

    const phoneIdentity = await lookupCanonicalIdentity(
      params.lookupIdentity,
      identityCandidates(phoneNumber),
    );
    if (phoneIdentity) return String(phoneIdentity);

    const legacyPhoneConversationId = canonicalIdForWhatsAppIdentity(phoneNumber);
    if (!legacyPhoneConversationId) throw new Error("wa2_lid_phone_unresolved");
    return legacyPhoneConversationId;
  }

  return chatId.startsWith("wa2:") ? chatId : `wa2:${chatId}`;
}

module.exports = { resolveWhatsApp2CanonicalConversationId };
