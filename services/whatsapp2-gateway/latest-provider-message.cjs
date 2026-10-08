const INTERNAL_TYPES = new Set([
  "notification_template",
  "e2e_notification",
  "protocol",
  "ciphertext",
  "debug",
  "notification",
  "group_notification",
  "broadcast_notification",
]);

function latestProviderMessage(messages) {
  let latest = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || INTERNAL_TYPES.has(String(message.type || "").toLowerCase())) continue;
    const timestamp = Number(message.timestamp || 0);
    if (latest === null || timestamp >= latestTimestamp) {
      latest = message;
      latestTimestamp = timestamp;
    }
  }

  return latest;
}

function latestInboundProviderMessage(messages) {
  const latest = latestProviderMessage(messages);
  return latest && latest.fromMe !== true ? latest : null;
}

module.exports = { latestProviderMessage, latestInboundProviderMessage };
