import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeActiveWhatsAppStatuses } = require("../services/whatsapp2-gateway/status/active-status.cjs");
const { normalizeStatusViewers } = require("../services/whatsapp2-gateway/status/status-viewers.cjs");
const gateway = fs.readFileSync("services/whatsapp2-gateway/index.cjs", "utf8");
const route = gateway.slice(gateway.indexOf('url.pathname === "/status/views"'),gateway.indexOf('url.pathname === "/status/my-status"'));

test("o ID serializado de /status/active é validado na mesma projeção em /status/views", () => {
  const id = "true_status@broadcast_ABCD1234_123456@lid";
  const now = Date.now();
  const snapshot = { msgs: [
    { id: { _serialized: id, id: "ABCD1234" }, type: "video", t: Math.floor(now / 1000) },
  ] };
  const result = normalizeActiveWhatsAppStatuses(snapshot, now);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, id);
  assert.match(route,/const ownStatusSnapshot = await active\.pupPage\.evaluate/);
  assert.match(route,/JSON\.parse\(JSON\.stringify\(data\)\)/);
  assert.match(route,/normalizeActiveWhatsAppStatuses\(ownStatusSnapshot\)\.items/);
  assert.match(route,/some\(\(item\) => item\.id === messageId\)/);
  assert.ok(route.indexOf("if (!isOwnActiveStatus)") < route.indexOf("wpp.chat.getMessageACK(id)"));
});

test("consulta de visualizações mantém restrição de origem e somente status da conta", () => {
  assert.match(route,/allowedStatusViewerOrigin/);
  assert.match(route,/Origem do visualizador de Status/);
  assert.match(route,/if \(!isOwnActiveStatus\)/);
  assert.match(route,/Status próprio ativo não encontrado/);
  assert.match(route,/normalizeStatusViewers\(receipt\)/);
});

test("recibos reais de leitura retornam contagem e horários, sem inventar números", () => {
  const ack = { participants: [
    { wid: { _serialized: "1@lid" }, readAt: 1792400000, name: "Contato A" },
    { wid: { _serialized: "2@lid" }, readAt: 1792400300, name: "Contato B" },
  ] };
  const result = normalizeStatusViewers(ack);
  assert.equal(result.available, true);
  assert.equal(result.count, 2);
  assert.equal(result.viewers[0].name, "Contato B");
  assert.equal(normalizeStatusViewers(undefined).count, null);
});
