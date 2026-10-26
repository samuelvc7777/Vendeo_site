const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { fork } = require("node:child_process");
const { randomUUID, randomBytes } = require("node:crypto");
const { whatsappAccountIdFromWid } = require("../../src/domain/entities/whatsapp2-account-scope.cjs");

function failure(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

// A única fonte de roteamento é este cadastro local. Nenhuma URL vem do navegador.
class AccountRegistry {
  constructor(directory, limit = 4) {
    this.directory = directory;
    this.limit = limit;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "connections.json");
    const saved = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : null;
    this.rows = saved?.connections || [{ id: "legacy", name: "WhatsApp principal", accountId: null, enabled: true }];
    if (!Array.isArray(this.rows) || !this.rows.some(row => row.id === "legacy") ||
        this.rows.some(row => !/^(legacy|[a-f0-9-]{36})$/.test(row.id) ||
          (row.accountId && !/^account-\d{8,15}$/.test(row.accountId))) ||
        new Set(this.rows.map(row => row.id)).size !== this.rows.length ||
        new Set(this.rows.filter(row => row.accountId).map(row => row.accountId)).size !== this.rows.filter(row => row.accountId).length) {
      throw new Error("Cadastro de conexões inválido; restaure o backup antes de iniciar.");
    }
  }
  save() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, connections: this.rows }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  get(id) {
    const row = this.rows.find(item => item.id === id);
    if (!row) throw failure("Conexão não encontrada.", 404);
    return row;
  }
  create(name) {
    if (this.rows.length >= this.limit) throw failure(`Limite de ${this.limit} conexões atingido.`);
    const value = String(name || "").trim().slice(0, 60);
    if (!value) throw failure("Informe um nome para o WhatsApp.", 400);
    const row = { id: randomUUID(), name: value, accountId: null, enabled: true };
    this.rows.push(row);
    try { this.save(); }
    catch (error) { this.rows.pop(); throw error; }
    return row;
  }
  update(id, patch) {
    const row = this.get(id);
    const previous = { ...row };
    Object.assign(row, patch);
    try { this.save(); }
    catch (error) { Object.assign(row, previous); throw error; }
    return row;
  }
  bind(id, accountId) {
    const row = this.get(id);
    if (!/^account-\d{8,15}$/.test(accountId || "")) throw failure("Identidade do WhatsApp indisponível.");
    if (row.accountId && row.accountId !== accountId) throw failure("Esta conexão pertence a outro número. Adicione uma nova conexão.");
    if (this.rows.some(item => item.id !== id && item.accountId === accountId)) throw failure("Este número já pertence a outra conexão.");
    if (row.accountId !== accountId) {
      this.update(id, { accountId });
    }
    return row;
  }
}

function acquireManagerLock(directory) {
  const file = path.join(directory, "manager.lock");
  try { fs.writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw failure("Lock do gerenciador inválido.");
    try { process.kill(pid, 0); throw failure("Outro gerenciador já está usando este cadastro."); }
    catch (check) { if (check.code !== "ESRCH") throw check; }
    fs.unlinkSync(file);
    fs.writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
  }
  return () => {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === String(process.pid)) fs.unlinkSync(file);
  };
}

function createAccountManager({ directory, entry, legacyStatus, readJson, json, spawnWorker = fork, limit = 4, legacyUpstream, legacyToken = "" }) {
  const external = legacyUpstream ? new URL(legacyUpstream) : null;
  if (external && (external.protocol !== "http:" || external.hostname !== "127.0.0.1" || !external.port || external.username || external.password || external.pathname !== "/" || external.search || external.hash)) {
    throw new Error("O gateway existente deve ser um endereço HTTP local em 127.0.0.1, com porta explícita.");
  }
  const registry = new AccountRegistry(directory, limit);
  const unlock = acquireManagerLock(directory);
  const workers = new Map();
  let closing = false;
  let externalState = { status: "offline" };

  async function refreshLegacy() {
    if (!external) return;
    try {
      const response = await fetch(new URL("/status", external), {
        headers: legacyToken ? { authorization: `Bearer ${legacyToken}` } : {},
        signal: AbortSignal.timeout(3000), redirect: "error",
      });
      const status = await response.json();
      if (!response.ok || status.ok === false) throw failure("Gateway existente indisponível.", 503);
      if (status.status === "ready") registry.bind("legacy", whatsappAccountIdFromWid(status.me?.wid));
      externalState = { status: status.status || "offline", lastError: status.lastError || null };
    } catch (error) {
      externalState = { status: "offline", lastError: "Não foi possível confirmar a identidade do gateway existente." };
      throw error;
    }
  }

  function start(row) {
    if (closing || row.id === "legacy" || !row.enabled || workers.has(row.id)) return;
    const token = randomBytes(32).toString("hex");
    const worker = { child: null, port: null, status: "starting", token, attempts: 0, timer: null };
    workers.set(row.id, worker);
    function launch() {
      if (closing || !row.enabled) return;
      worker.port = null;
      worker.status = "starting";
      const child = spawnWorker(entry, [], {
        cwd: path.dirname(entry), windowsHide: true, execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: { ...process.env,
          WHATSAPP2_CHILD: "1", WHATSAPP2_CONNECTION_ID: row.id,
          WHATSAPP2_GATEWAY_HOST: "127.0.0.1", WHATSAPP2_GATEWAY_PORT: "0",
          WHATSAPP2_GATEWAY_TOKEN: token,
          WHATSAPP2_SESSION_DIR: path.join(directory, "sessions", row.id),
          WHATSAPP2_AUTH_CLIENT_ID: `vendeo-${row.id}`,
          WHATSAPP2_EXPECTED_ACCOUNT: row.accountId || "",
        },
      });
      worker.child = child;
      child.on("message", async message => {
        if (worker.child !== child) return;
        if (message?.type === "listening") worker.port = message.port;
        if (message?.type === "identity") {
          try {
            await refreshLegacy();
            registry.bind(row.id, message.accountId);
            child.send({ type: "identity-result", ok: true });
          } catch (error) {
            child.send({ type: "identity-result", ok: false, error: error.message });
          }
        }
        if (message?.type === "state") {
          // Códigos de pareamento e dados de perfil não são persistidos no cadastro.
          worker.status = message.status;
          worker.lastError = message.lastError || null;
          if (message.status === "ready") worker.attempts = 0;
        }
      });
      const exited = () => {
        if (worker.child !== child) return;
        worker.child = null;
        worker.port = null;
        worker.status = "offline";
        if (!closing && row.enabled) {
          worker.timer = setTimeout(launch, Math.min(60_000, 2000 * 2 ** Math.min(worker.attempts++, 5)));
        }
      };
      child.once("exit", exited);
      child.once("error", exited);
    }
    launch();
  }

  function list() {
    return registry.rows.map(row => {
      const status = row.id === "legacy" ? (external ? externalState : legacyStatus()) : workers.get(row.id);
      return { ...row, status: row.enabled ? status?.status || "offline" : "disabled",
        lastError: status?.lastError || null };
    });
  }

  async function handle(req, res, url) {
    if (url.pathname === "/accounts") {
      if (external) {
        try { await refreshLegacy(); }
        catch { /* A indisponibilidade da conta principal não oculta as outras contas. */ }
      }
      if (req.method === "GET") { json(res, 200, { ok: true, accounts: list(), limit }); return true; }
      if (req.method === "POST") {
        const body = await readJson(req, 4096);
        const row = registry.create(body.name);
        start(row);
        json(res, 201, { ok: true, account: list().find(item => item.id === row.id) });
        return true;
      }
      throw failure("Método não permitido.", 405);
    }
    // Rotas sem prefixo conservam o destino legado para consumidores existentes.
    const match = /^\/connections\/([^/]+)(\/.*)$/.exec(url.pathname) ||
      (external ? [url.pathname, "legacy", url.pathname] : null);
    if (!match) return false;
    const row = registry.get(match[1]);
    if (match[2] === "/configuration" && req.method === "POST") {
      const body = await readJson(req, 4096);
      const patch = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 60);
        if (!name) throw failure("Nome inválido.", 400);
        patch.name = name;
      }
      // Pausa de processo não desvincula o WhatsApp e mantém a sessão persistida.
      const wasEnabled = row.enabled;
      let worker;
      if (typeof body.enabled === "boolean" && row.id !== "legacy") {
        worker = workers.get(row.id);
        if (worker?.stopping) throw failure("Aguarde a alteração da conexão em andamento.");
        patch.enabled = body.enabled;
      }
      registry.update(row.id, patch);
      if (typeof patch.enabled === "boolean" && wasEnabled !== patch.enabled) {
        if (!patch.enabled && worker) {
          clearTimeout(worker.timer);
          worker.stopping = true;
          await stopWorker(worker);
          workers.delete(row.id);
        } else if (patch.enabled) start(row);
      }
      json(res, 200, { ok: true, accounts: list() });
      return true;
    }
    if (!row.enabled) throw failure("Esta conexão está pausada.", 503);
    const targetPath = match[2] + url.search;
    if (row.id === "legacy" && !external) {
      req.url = targetPath;
      return false;
    }
    if (row.id === "legacy") await refreshLegacy();
    const worker = row.id === "legacy"
      ? { port: Number(external.port), token: legacyToken }
      : workers.get(row.id);
    if (!worker?.port) throw failure("WhatsApp iniciando ou indisponível. Aguarde a conexão.", 503);
    await new Promise(resolve => {
      const headers = { ...req.headers, host: `127.0.0.1:${worker.port}`, authorization: `Bearer ${worker.token}` };
      if (!worker.token) delete headers.authorization;
      delete headers["proxy-authorization"];
      const upstream = http.request({ hostname: "127.0.0.1", port: worker.port, path: targetPath, method: req.method, headers }, response => {
        const responseHeaders = { ...response.headers };
        // CORS do ponto de entrada já foi validado pelo gateway principal.
        delete responseHeaders["access-control-allow-origin"];
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.pipe(res);
        response.on("end", resolve);
        response.on("error", () => { res.destroy(); resolve(); });
      });
      upstream.on("error", () => {
        if (!res.headersSent) json(res, 503, { ok: false, error: "Gateway desta conta indisponível." });
        else res.destroy();
        resolve();
      });
      res.on("close", () => { upstream.destroy(); resolve(); });
      // SSE e download são transmitidos sem buffer nem reexecução automática.
      req.pipe(upstream);
    });
    return true;
  }

  function stopWorker(worker) {
    return new Promise(resolve => {
      clearTimeout(worker.timer);
      const child = worker.child;
      if (!child) { resolve(); return; }
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      if (child.connected) child.send({ type: "shutdown" });
      else child.kill();
    });
  }

  async function close() {
    closing = true;
    await Promise.all([...workers.values()].map(stopWorker));
    unlock();
  }
  registry.rows.forEach(start);
  return { handle, close, registry, list, bindLegacy: accountId => registry.bind("legacy", accountId) };
}

module.exports = { AccountRegistry, acquireManagerLock, createAccountManager };
