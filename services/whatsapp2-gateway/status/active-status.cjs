"use strict";

// Projeção segura dos Status da própria conta. Não expõe chaves de mídia,
// caminhos internos ou dados de destinatários retornados pelo WhatsApp Web.
const STATUS_DURATION_MS = 24 * 60 * 60 * 1000;

function normalizeActiveWhatsAppStatuses(myStatus, nowMs = Date.now()) {
  // WA Web may return only loaded messages in msgs, while statusMsgs
  // contains other active phone statuses. Merge both, dedupe by message ID.
  const messages = [
    ...(Array.isArray(myStatus?.msgs) ? myStatus.msgs : []),
    ...(Array.isArray(myStatus?.statusMsgs) ? myStatus.statusMsgs : []),
  ];

  const seen = new Set();
  const items = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const timestamp = Number(message.t);
    const createdMs = timestamp * 1000;
    if (!Number.isFinite(createdMs) || createdMs <= 0 ||
        createdMs > nowMs + 5 * 60 * 1000 ||
        createdMs + STATUS_DURATION_MS <= nowMs) continue;

    const id = String(
      message.id?._serialized ||
      message.id?.id ||
      message.id?.toString?.() ||
      message.rowId ||
      "",
    );
    if (!id || id === "[object Object]" || seen.has(id)) continue;
    seen.add(id);

    const nativeType = String(message.type || "").toLowerCase();
    const type = nativeType === "chat" || nativeType === "text"
      ? "text"
      : nativeType === "image" || nativeType === "video"
        ? nativeType
        : "other";
    const text = type === "text" ? String(message.body || "").slice(0, 700) : "";
    const caption = type === "image" || type === "video"
      ? String(message.caption || "").slice(0, 1024)
      : "";

    items.push({
      id,
      type,
      text,
      caption,
      createdAt: new Date(createdMs).toISOString(),
      expiresAt: new Date(createdMs + STATUS_DURATION_MS).toISOString(),
    });
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ok: true, count: items.length, items };
}

module.exports = { normalizeActiveWhatsAppStatuses };
