function providerMessageId(value, accountId) {
  const id = String(value || "");
  if (!id.startsWith("wa2msg:")) return id;
  const match = /^wa2msg:(account-\d{8,15}):(.+)$/.exec(id);
  if (!match || match[1] !== accountId) throw new Error("whatsapp2_message_account_mismatch");
  return match[2];
}

function accountMessageId(value, accountId, scoped) {
  if (!value) return value;
  const id = providerMessageId(value, accountId);
  if (!scoped) return id;
  if (!/^account-\d{8,15}$/.test(accountId || "")) throw new Error("whatsapp2_account_identity_unavailable");
  return `wa2msg:${accountId}:${id}`;
}

module.exports = { accountMessageId, providerMessageId };
