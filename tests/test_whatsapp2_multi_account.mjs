import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { AccountRegistry, acquireManagerLock, createAccountManager } = require("../services/whatsapp2-gateway/account-manager.cjs");
const { accountMessageId, providerMessageId } = require("../services/whatsapp2-gateway/message-scope.cjs");
const temporary = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vendeo-wa-accounts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test("cadastro preserva conta e rejeita troca de número, duplicidade e limite", t => {
  const directory = temporary(t);
  const registry = new AccountRegistry(directory, 2);
  registry.bind("legacy", "account-5511999998888");
  const second = registry.create("Vendas");
  assert.throws(() => registry.bind(second.id, "account-5511999998888"), /outra conexão/);
  registry.bind(second.id, "account-5521999998888");
  assert.throws(() => registry.bind(second.id, "account-5531999998888"), /outro número/);
  assert.throws(() => registry.create("Terceira"), /Limite/);
  assert.throws(() => registry.get("../legacy"), /não encontrada/);
  const restored = new AccountRegistry(directory, 2);
  assert.equal(restored.get(second.id).accountId, "account-5521999998888");
});

test("apenas um gerenciador pode assumir o mesmo cadastro", t => {
  const directory = temporary(t);
  const unlock = acquireManagerLock(directory);
  assert.throws(() => acquireManagerLock(directory), /Outro gerenciador/);
  unlock();
  acquireManagerLock(directory)();
});

test("falha ao persistir não confirma vínculo nem criação em memória", t => {
  const registry = new AccountRegistry(temporary(t), 3);
  registry.save = () => { throw new Error("disco indisponível"); };
  assert.throws(() => registry.bind("legacy", "account-5511999998888"), /disco indisponível/);
  assert.equal(registry.get("legacy").accountId, null);
  assert.throws(() => registry.create("Vendas"), /disco indisponível/);
  assert.equal(registry.rows.length, 1);
});

test("mensagem repetida em contas diferentes tem IDs independentes e rejeita acesso cruzado", () => {
  const a = "account-5511999998888", b = "account-5521999998888";
  const nativeId = "false_551188887777@c.us_ABC123";
  const first = accountMessageId(nativeId, a, true);
  const second = accountMessageId(nativeId, b, true);
  assert.notEqual(first, second);
  assert.equal(accountMessageId(first, a, true), first);
  assert.equal(providerMessageId(first, a), nativeId);
  assert.throws(() => providerMessageId(first, b), /account_mismatch/);
  assert.throws(() => accountMessageId(first, b, true), /account_mismatch/);
  assert.equal(accountMessageId(nativeId, a, false), nativeId, "histórico legado conserva IDs");
});

test("roteador mantém processos, corpos e destinos separados e pausa somente a conta escolhida", async t => {
  const directory = temporary(t);
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readJson = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || "{}"); };
  const manager = createAccountManager({ directory,
    entry: fileURLToPath(new URL("./fixtures/whatsapp-account-worker.cjs", import.meta.url)),
    legacyStatus: () => ({ status: "ready" }), readJson, json, limit: 3, managerToken: "test-management-token",
  });
  const server = http.createServer(async (req, res) => {
    try {
      const handled = await manager.handle(req, res, new URL(req.url, "http://local"));
      if (!handled) json(res, 200, { ok: true, legacy: true, path: req.url });
    } catch (error) { json(res, error.statusCode || 500, { ok: false, error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await manager.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body) => {
    const management = route === "/accounts" || route.endsWith("/configuration");
    const headers = { "content-type": "application/json", ...(management ? { authorization: "Bearer test-management-token" } : {}) };
    const response = await fetch(base + route, body === undefined ? {} : { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const a = (await request("/accounts", { name: "A" })).data.account;
  const b = (await request("/accounts", { name: "B" })).data.account;
  async function waitFor(id) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const response = await request(`/connections/${id}/status`);
      if (response.status === 200) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail("processo de teste não iniciou");
  }
  await Promise.all([waitFor(a.id), waitFor(b.id)]);
  const [first, second] = await Promise.all([
    request(`/connections/${a.id}/messages/send`, { text: "A" }),
    request(`/connections/${b.id}/messages/send`, { text: "B" }),
  ]);
  assert.equal(first.data.connectionId, a.id);
  assert.equal(second.data.connectionId, b.id);
  assert.equal(first.data.body, '{"text":"A"}');
  assert.equal(second.data.body, '{"text":"B"}');
  assert.equal(first.data.authorized, true);
  assert.equal(first.data.path, "/messages/send");
  assert.equal((await request("/connections/legacy/status")).data.legacy, true);
  assert.equal((await request("/connections/nonexistent/messages/send", {})).status, 404);
  await request(`/connections/${a.id}/configuration`, { enabled: false });
  assert.equal((await request(`/connections/${a.id}/messages/send`, {})).status, 503);
  assert.equal((await request(`/connections/${b.id}/status`)).status, 200);
  assert.equal(new AccountRegistry(directory).get(a.id).enabled, false);
  await request(`/connections/${a.id}/configuration`, { enabled: true });
  await waitFor(a.id);
  assert.equal((await request(`/connections/${a.id}/status`)).data.connectionId, a.id);
});

test("criar e alterar contas exige a chave de gerenciamento", async t => {
  const directory = temporary(t);
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readJson = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || "{}"); };
  const manager = createAccountManager({ directory, entry: "unused", legacyStatus: () => ({ status: "idle" }),
    readJson, json, managerToken: "secret-management-key",
  });
  const server = http.createServer(async (req, res) => {
    try { if (!await manager.handle(req, res, new URL(req.url, "http://local"))) json(res, 404, { ok: false }); }
    catch (error) { json(res, error.statusCode || 500, { ok: false, error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await manager.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = await fetch(base + "/accounts");
  assert.equal(get.status, 200, "a leitura das contas continua disponível para o seletor");
  const createWithoutKey = await fetch(base + "/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Intrusa" }) });
  assert.equal(createWithoutKey.status, 401);
  const configureWithoutKey = await fetch(`${base}/connections/legacy/configuration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Intrusa" }) });
  assert.equal(configureWithoutKey.status, 401);
  const profilePath = base + "/connections/legacy/chat/contact-profile";
  assert.equal((await fetch(profilePath)).status, 401);
  assert.equal((await fetch(profilePath, { method: "POST" })).status, 401);
  assert.equal((await fetch(profilePath, { headers: { authorization: "Bearer secret-management-key" } })).status, 404,
    "a chave válida permite que o gerenciador encaminhe a rota ao gateway");
  const configureWithKey = await fetch(`${base}/connections/legacy/configuration`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret-management-key" }, body: JSON.stringify({ name: "Conta principal" }) });
  assert.equal(configureWithKey.status, 200);
  assert.equal(new AccountRegistry(directory).get("legacy").name, "Conta principal");
  manager.registry.bind("legacy", "account-5511999990000");
  const sessionPath = base + "/connections/legacy/chat/profile-session";
  const sessionOptions = {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "5511999990000" }),
  };
  assert.equal((await fetch(sessionPath, sessionOptions)).status, 401);
  sessionOptions.headers.authorization = "Bearer secret-management-key";
  const session = await fetch(sessionPath, sessionOptions);
  assert.equal(session.status, 200);
  const { accessToken } = await session.json();
  const device = { authorization: "Bearer " + accessToken };
  assert.equal((await fetch(profilePath, { headers: device })).status, 404);
  assert.equal((await fetch(sessionPath, {
    ...sessionOptions, headers: { ...sessionOptions.headers, ...device },
  })).status, 401);
  const other = manager.registry.create("Outra conta");
  manager.registry.bind(other.id, "account-5511999990001");
  assert.equal((await fetch(`${base}/connections/${other.id}/chat/contact-profile`, { headers: device })).status, 401);
});

test("gerenciador adota gateway existente sem assumir sessão e bloqueia troca de identidade", async t => {
  let wid = "5511999998888@c.us";
  let forwarded = 0;
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const existing = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer interno") return json(res, 401, { ok: false });
    if (req.url === "/status") return json(res, 200, { ok: true, status: "ready", me: { wid } });
    forwarded++;
    json(res, 200, { ok: true, path: req.url });
  });
  await new Promise(resolve => existing.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => existing.close(resolve)));
  const manager = createAccountManager({ directory: temporary(t), entry: "unused", legacyStatus: () => ({ status: "idle" }),
    legacyUpstream: `http://127.0.0.1:${existing.address().port}`, legacyToken: "interno", json,
    readJson: async () => ({}), spawnWorker: () => assert.fail("Não deve criar processo para a conta existente"),
  });
  const server = http.createServer(async (req, res) => {
    try { if (!await manager.handle(req, res, new URL(req.url, "http://local"))) json(res, 404, { ok: false }); }
    catch (error) { json(res, error.statusCode || 503, { ok: false, error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await manager.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const accounts = await (await fetch(base + "/accounts")).json();
  assert.equal(accounts.accounts[0].status, "ready");
  assert.equal(accounts.accounts[0].accountId, "account-5511999998888");
  assert.equal((await (await fetch(base + "/connections/legacy/chats?limit=1")).json()).path, "/chats?limit=1");
  assert.equal((await (await fetch(base + "/chats")).json()).path, "/chats");
  assert.equal((await fetch(base + "/connections/nonexistent/chats")).status, 404);
  assert.equal(forwarded, 2);
  wid = "5521999998888@c.us";
  assert.equal((await fetch(base + "/connections/legacy/chats")).status, 409);
  assert.equal(forwarded, 2, "identidade divergente não pode alcançar a sessão");
});

test("desenvolvimento usa gateway explícito sem consultar túnel de produção", async () => {
  const ts = require("typescript");
  const source = fs.readFileSync(new URL("../src/presentation/components/chat/whatsapp2-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const requests = [];
  const localRequire = id => id.includes("whatsapp2-account-scope") ? require("../src/domain/entities/whatsapp2-account-scope.cjs") : require(id);
  const fakeFetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ gatewayUrl: "https://tunel-antigo.example" }) };
  };
  new Function("require", "module", "exports", "fetch", "process", "window", compiled)(localRequire, module, module.exports, fakeFetch, {
    env: { NODE_ENV: "development", NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL: "http://127.0.0.1:8789" },
  }, {});
  assert.equal(await module.exports.resolveWhatsApp2GatewayUrl(), "http://127.0.0.1:8789");
  assert.deepEqual(requests, []);
});

test("cliente captura a conexão em envios concorrentes e URLs de mídia", async () => {
  const ts = require("typescript");
  const source = fs.readFileSync(new URL("../src/presentation/components/chat/whatsapp2-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url, body: init?.body });
    await new Promise(resolve => setTimeout(resolve, url.includes("conta-a") ? 10 : 0));
    return { ok: true, json: async () => url.endsWith("/status/video/submit")
      ? { ok: true, jobId: "video", status: "sent", result: { ok: true, type: "video" } }
      : { ok: true } };
  };
  const module = { exports: {} };
  const localRequire = id => id.includes("whatsapp2-account-scope") ? require("../src/domain/entities/whatsapp2-account-scope.cjs") : require(id);
  new Function("require", "module", "exports", "fetch", "process", compiled)(localRequire, module, module.exports, fakeFetch, { env: { NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL: "https://example.test" } });
  const a = module.exports.createWhatsApp2Client("conta-a");
  const b = module.exports.createWhatsApp2Client("conta-b");
  await Promise.all([a.sendWhatsApp2Text({ to: "123@c.us", text: "A" }), b.sendWhatsApp2Text({ to: "123@c.us", text: "B" })]);
  assert.equal(requests[0].url, "https://example.test/connections/conta-a/messages/send");
  assert.equal(requests[1].url, "https://example.test/connections/conta-b/messages/send");
  assert.match(a.getWhatsApp2MediaUrl("same-id"), /connections\/conta-a\/message\/media/);
  assert.match(b.getWhatsApp2MediaUrl("same-id"), /connections\/conta-b\/message\/media/);
  await Promise.all([
    a.publishWhatsAppStatusText({ text: "Status A" }),
    b.publishWhatsAppStatusImage({ mediaUrl: "https://example.test/image.jpg" }),
    b.publishWhatsAppStatusVideo({ mediaUrl: "https://example.test/video.mp4", idempotencyKey: "video-b" }),
  ]);
  assert.equal(requests[2].url, "https://example.test/connections/conta-a/status/text");
  assert.equal(requests[3].url, "https://example.test/connections/conta-b/status/image");
  assert.equal(requests[4].url, "https://example.test/connections/conta-b/status/video/submit");
});
