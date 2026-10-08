import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { latestInboundProviderMessage } = require(
  "../services/whatsapp2-gateway/latest-provider-message.cjs",
);

async function runSyncRoute({ fromMe = false, chatId = "contact@c.us", confirmedAlias = false, conversationId = "wa2:account-5511999999999:contact@c.us" } = {}) {
  const source = fs.readFileSync(new URL("../services/whatsapp2-gateway/index.cjs", import.meta.url), "utf8");
  const start = source.indexOf("const server = http.createServer(");
  const end = source.indexOf("});server.listen(", start);
  assert.ok(start > 0 && end > start);
  let handler;
  let persisted = false;
  const events = [];
  let response;
  vm.runInNewContext(source.slice(start, end) + "});", {
    http: { createServer(fn) { handler = fn; } },
    URL, HOST: "127.0.0.1", PORT: 8788,
    applyCors() {}, isAuthorized: () => true,
    readJson: async () => ({ chatId, conversationId }),
    ensureReady: () => ({ getChatById: async () => ({ fetchMessages: async () => [
      { id: { _serialized: "latest" }, fromMe, timestamp: 20, type: "chat", from: "contact@c.us" },
    ] }) }),
    resolveCanonicalConversationId: async () => "wa2:account-5511999999999:contact@c.us",
    whatsapp2ConversationId: (id) => `wa2:account-5511999999999:${id}`,
    currentWhatsApp2AccountId: () => 'account-5511999999999',
    whatsappProviderIdFromConversationId: (id) => id.replace(/^wa2:account-\d+:/, ''),
    resolveWhatsApp2PhoneNumbers: async (ids) => ids.map(id => ({
      chatId: id, phoneNumber: id === 'contact@c.us' || (confirmedAlias && id === 'contact@lid') ? '5511988888888' : null,
    })),
    latestInboundProviderMessage,
    waitForCanonicalWhatsApp2Message: async () => { events.push("check"); return persisted; },
    enqueueWhatsApp2Inbound: async () => { events.push("enqueue"); persisted = true; return { queued: true }; },
    json: (_res, status, body) => { response = { status, body }; },
  });
  await handler({ method: "POST", url: "/chat/sync-latest-inbound", headers: {} }, {});
  return { response, events };
}

test("rota real sincroniza a mensagem ausente antes de confirmar persistência", async () => {
  const { response, events } = await runSyncRoute();
  assert.equal(response.status, 200);
  assert.equal(response.body.persisted, true);
  assert.deepEqual(events, ["check", "enqueue", "check"]);
});

test("rota real não importa mensagem quando a última é nossa", async () => {
  const { response, events } = await runSyncRoute({ fromMe: true });
  assert.equal(response.body.latestInbound, false);
  assert.deepEqual(events, []);
});

test("rota real recusa identidade pertencente a outra conta", async () => {
  const { response, events } = await runSyncRoute({ conversationId: "wa2:account-5521999999999:contact@c.us" });
  assert.equal(response.status, 409);
  assert.deepEqual(events, []);
});

test("rota real acompanha alias LID confirmado para a identidade canônica", async () => {
  const { response } = await runSyncRoute({ chatId: "contact@lid", conversationId: "wa2:account-5511999999999:contact@lid" });
  assert.equal(response.status, 200);
  assert.equal(response.body.conversationId, "wa2:account-5511999999999:contact@c.us");
});

test("rota real recusa outro contato na mesma conta", async () => {
  const { response, events } = await runSyncRoute({ conversationId: "wa2:account-5511999999999:other@c.us" });
  assert.equal(response.status, 409);
  assert.deepEqual(events, []);
});

test("rota real aceita ID antigo LID quando o chat atual usa telefone confirmado", async () => {
  const { response } = await runSyncRoute({ confirmedAlias: true, conversationId: 'wa2:account-5511999999999:contact@lid' });
  assert.equal(response.status, 200);
  assert.equal(response.body.conversationId, 'wa2:account-5511999999999:contact@c.us');
});

test("rota real rejeita LID sem ligação confirmada com o telefone atual", async () => {
  const { response, events } = await runSyncRoute({ conversationId: 'wa2:account-5511999999999:contact@lid' });
  assert.equal(response.status, 409);
  assert.deepEqual(events, []);
});

test("sincroniza apenas a mensagem inbound mais recente", () => {
  const inbound = { id: "in-2", fromMe: false, timestamp: 20, type: "chat" };
  assert.equal(
    latestInboundProviderMessage([
      { id: "in-1", fromMe: false, timestamp: 10, type: "chat" },
      inbound,
    ]),
    inbound,
  );
});

test("não reabre mensagem inbound antiga quando a última foi enviada por nós", () => {
  assert.equal(
    latestInboundProviderMessage([
      { id: "in-1", fromMe: false, timestamp: 10, type: "chat" },
      { id: "out-1", fromMe: true, timestamp: 20, type: "chat" },
    ]),
    null,
  );
});

test("ignora eventos internos ao procurar a mensagem mais recente", () => {
  const inbound = { id: "in-1", fromMe: false, timestamp: 10, type: "chat" };
  assert.equal(
    latestInboundProviderMessage([
      inbound,
      { id: "protocol-1", fromMe: false, timestamp: 30, type: "protocol" },
    ]),
    inbound,
  );
});
