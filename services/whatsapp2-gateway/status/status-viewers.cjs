"use strict";

// O WhatsApp pode não fornecer recibos de leitura de Status (ex.: privacidade
// desativada). Nesses casos, não transformar indisponibilidade em "0 views".
function normalizeStatusViewers(ack) {
  if (!ack || !Array.isArray(ack.participants)) {
    return { ok: true, available: false, count: null, viewers: [] };
  }
  const byId = new Map();
  for (const item of ack.participants) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.wid?._serialized || item.wid?.toString?.() || item.id || "").trim();
    if (!id || id === "[object Object]") continue;
    const rawAt = Number(item.readAt || item.playedAt || 0);
    if (!Number.isFinite(rawAt) || rawAt <= 0) continue;
    const timestamp = rawAt < 1e12 ? rawAt * 1000 : rawAt;
    const viewedAt = new Date(timestamp);
    if (Number.isNaN(viewedAt.getTime())) continue;
    const current = byId.get(id);
    if (!current || viewedAt.toISOString() > current.viewedAt) {
      const name = String(item.name || "").trim().slice(0, 100);
      byId.set(id, { id, name: name || id.replace(/@.*$/, ""), viewedAt: viewedAt.toISOString() });
    }
  }
  const viewers = Array.from(byId.values()).sort((a, b) => b.viewedAt.localeCompare(a.viewedAt));
  return { ok: true, available: true, count: viewers.length, viewers };
}

module.exports = { normalizeStatusViewers };
