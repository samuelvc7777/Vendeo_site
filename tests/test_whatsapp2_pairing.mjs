import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { classifyPairingError, isPairingStorageReady } = require("../services/whatsapp2-gateway/pairing-errors.cjs");
const source = fs.readFileSync(new URL("../services/whatsapp2-gateway/index.cjs", import.meta.url), "utf8");
const routes = source.slice(source.indexOf('    if (req.method === "POST" && url.pathname === "/pairing-qr")'), source.indexOf('    if (req.method === "GET" && url.pathname === "/qr")'));

function harness(path, { ready = false, storage = true, providerError } = {}) {
  const calls = { provider: 0, cancel: 0, destroy: 0, start: 0 };
  const context = vm.createContext({
    req: { method: "POST" }, res: {}, url: { pathname: path },
    state: { status: ready ? "ready" : "awaiting_pairing", qrDataUrl: null },
    pairingRequestInFlight: false, pairingRetryAfter: 0,
    readJson: async () => ({ phoneNumber: "5511999998888" }),
    client: { pupPage: {}, requestPairingCode: async () => { calls.provider++; if (providerError) throw providerError; return "ABCD1234"; }, cancelPairingCode: async () => { calls.cancel++; } },
    isPairingStorageReady: async () => storage, classifyPairingError,
    destroyClient: async () => { calls.destroy++; }, cancelScheduledReconnect: () => {},
    startClient: async () => { calls.start++; },
    json: (_res, status, body) => { context.result = { status, body }; },
    setState: patch => Object.assign(context.state, patch),
  });
  return { context, calls, run: () => vm.runInContext(`(async () => { ${routes} })()`, context) };
}

test("rota não chama o provedor quando armazenamento está indisponível e não inventa rate limit", async () => {
  const h = harness("/pairing-code", { storage: false });
  await assert.rejects(h.run(), error => error.statusCode === 503);
  assert.equal(h.calls.provider, 0);
  assert.equal(h.calls.cancel, 0);
  assert.ok(h.context.pairingRetryAfter <= Date.now());
  assert.match(h.context.state.lastError, /armazenamento/);
  assert.doesNotMatch(h.context.state.lastError, /recusou|56367/);
});

test("falha 56367 do provedor não impõe bloqueio de tentativas", async () => {
  const h = harness("/pairing-code", { providerError: new Error("Invariant Violation: Minified invariant #56367; getStorage") });
  await assert.rejects(h.run(), error => error.statusCode === 503);
  assert.equal(h.calls.provider, 1);
  assert.equal(h.calls.cancel, 1);
  assert.ok(h.context.pairingRetryAfter <= Date.now());
});

test("limite explícito do provedor conserva espera e geração confirmada devolve código", async () => {
  const limited = harness("/pairing-code", { providerError: new Error("IQErrorRateOverlimit") });
  await assert.rejects(limited.run(), error => error.statusCode === 429);
  assert.ok(limited.context.pairingRetryAfter > Date.now() + 14 * 60_000);
  const success = harness("/pairing-code");
  await success.run();
  assert.equal(success.context.result.body.code, "ABCD1234");
});

test("QR não reinicia uma conta conectada; conta não pareada pode iniciar QR", async () => {
  const active = harness("/pairing-qr", { ready: true });
  await active.run();
  assert.equal(active.context.result.status, 409);
  assert.equal(active.calls.destroy, 0);
  const second = harness("/pairing-qr");
  await second.run();
  assert.equal(second.context.result.status, 202);
  assert.equal(second.calls.destroy, 1);
  assert.equal(second.calls.start, 1);
});

test("sonda de armazenamento trata o invariant real como indisponibilidade", async () => {
  const page = { evaluate: fn => vm.runInNewContext(`(${fn})()`, { window: { require: name => name === "WAWebSocketModel" ? { Socket: { state: "UNPAIRED" } } : { getStorage: () => { throw new Error("Minified invariant #56367"); } } } }) };
  assert.equal(await isPairingStorageReady(page), false);
  assert.equal(classifyPairingError(new Error("t: t")).statusCode, 503, "erro opaco não comprova rate limit");
});

test("reconexão de logout aguarda recuperação e não derruba QR ou autenticação já disponível", async () => {
  const reconnectSource = source.slice(source.indexOf("function scheduleClientReconnect("), source.indexOf("async function destroyClient("));
  for (const recovered of ["awaiting_pairing", "pairing_code", "authenticated", "ready"]) {
    let timer; let delay; let destroyed = 0;
    const context = vm.createContext({
      shuttingDown: false, reconnectTimer: null, reconnectInProgress: false, reconnectAttempt: 0,
      WHATSAPP2_RECONNECT_BACKOFF_MS: [2000, 5000], state: { status: "disconnected" },
      console: { warn: () => {} }, setTimeout: (callback, ms) => { timer = callback; delay = ms; return 1; },
      destroyClient: async () => { destroyed++; }, startClient: async () => {}, setState: () => {},
    });
    vm.runInContext(`${reconnectSource}; scheduleClientReconnect("LOGOUT")`, context);
    assert.equal(delay, 30_000);
    context.state.status = recovered;
    await timer();
    assert.equal(destroyed, 0, `não deve destruir sessão em ${recovered}`);
  }
});
