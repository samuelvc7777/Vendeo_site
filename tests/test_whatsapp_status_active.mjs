import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { normalizeActiveWhatsAppStatuses } = require("../services/whatsapp2-gateway/status/active-status.cjs");

test("retorna apenas Status reais dentro das 24 horas, ordenados", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const timestamp = Math.floor(now / 1000);
  const result = normalizeActiveWhatsAppStatuses({
    msgs: [
      { id: { _serialized: "new" }, type: "image", t: timestamp - 5, caption: "Novo" },
      { id: { _serialized: "old" }, type: "chat", t: timestamp - 86401, body: "Antigo" },
      { id: { _serialized: "middle" }, type: "chat", t: timestamp - 100, body: "Oi" },
      { id: { _serialized: "new" }, type: "image", t: timestamp - 5, caption: "Duplicado" },
    ],
  }, now);
  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(({ id }) => id), ["new", "middle"]);
  assert.equal(result.items[1].text, "Oi");
  assert.equal(result.items[0].caption, "Novo");
});

test("une msgs e statusMsgs quando WhatsApp Web carrega apenas parte dos Status", () => {
  const now = Date.UTC(2026, 9, 19, 16);
  const t = Math.floor(now / 1000);
  const old = { id: { _serialized: "status-video" }, t: t - 600, type: "video" };
  const image = { id: { _serialized: "status-image" }, t: t - 100, type: "image" };
  const result = normalizeActiveWhatsAppStatuses({
    msgs: [old],
    statusMsgs: [old, image],
    totalCount: 2,
  }, now);
  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(({ id }) => id), ["status-image", "status-video"]);
});

test("não retorna metadados confidenciais nem mensagens inválidas", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const result = normalizeActiveWhatsAppStatuses({
    msgs: [
      { id: { _serialized: "a" }, type: "video", t: Math.floor(now / 1000), mediaKey: "SECRET", directPath: "SECRET_PATH", caption: "Vídeo" },
      { id: {}, type: "image", t: Math.floor(now / 1000), directPath: "BAD" },
    ],
  }, now);
  assert.equal(result.count, 1);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["caption","createdAt","expiresAt","id","text","type"]);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("tolera ausência de mensagens e usa statusMsgs como alternativa", () => {
  assert.equal(normalizeActiveWhatsAppStatuses(null).count, 0);
  const now = Date.UTC(2026, 9, 15, 12);
  assert.equal(normalizeActiveWhatsAppStatuses({
    statusMsgs: [{ id: { _serialized: "b" }, type: "chat", t: now / 1000, body: "Tudo bem" }],
  }, now).count, 1);
});
