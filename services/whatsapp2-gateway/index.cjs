const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");

const ROOT = __dirname;
const SESSION_DIR = path.join(ROOT, ".session");

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const i = value.indexOf("=");
    if (i <= 0) continue;
    const key = value.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = value.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();

const HOST = process.env.WHATSAPP2_GATEWAY_HOST || "127.0.0.1";
const PORT = Number(process.env.WHATSAPP2_GATEWAY_PORT || 8788);
const API_TOKEN = String(process.env.WHATSAPP2_GATEWAY_TOKEN || "");
const WEBHOOK_URL = String(process.env.VENDEO_WHATSAPP2_WEBHOOK_URL || "");
const WEBHOOK_TOKEN = String(process.env.VENDEO_WHATSAPP2_WEBHOOK_TOKEN || "");
const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PATH = process.env.WHATSAPP2_CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);let client = null;
let initializing = null;
let shuttingDown = false;
const sseClients = new Set();

const state = {
  status: "idle",
  qrDataUrl: null,
  qrUpdatedAt: null,
  readyAt: null,
  me: null,
  lastError: null,
  startedAt: new Date().toISOString(),
};

function snapshot() {
  return { ...state, hasQr: Boolean(state.qrDataUrl) };
}

function pushSse(res, event, data) {
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(data) + "\n\n");
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try { pushSse(res, event, data); }
    catch { sseClients.delete(res); }
  }
}

function setState(patch) {
  Object.assign(state, patch);
  broadcast("status", snapshot());
}async function emitEvent(type, payload = {}) {
  const event = { type, payload, at: new Date().toISOString() };
  broadcast("whatsapp2", event);
  if (!WEBHOOK_URL) return;
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(WEBHOOK_TOKEN ? { authorization: "Bearer " + WEBHOOK_TOKEN } : {}),
      },
      body: JSON.stringify(event),
    });
    if (!response.ok) console.warn("[whatsapp2] webhook HTTP", response.status);
  } catch (error) {
    console.warn("[whatsapp2] webhook:", error?.message || error);
  }
}

function serializeMessage(message) {
  return message ? {
    id: message.id?._serialized || null,
    from: message.from || null,
    to: message.to || null,
    body: message.body || "",
    type: message.type || null,
    timestamp: message.timestamp || null,
    fromMe: Boolean(message.fromMe),
    hasMedia: Boolean(message.hasMedia),
    hasQuotedMsg: Boolean(message.hasQuotedMsg),
    ack: message.ack ?? null,
  } : null;
}

function normalizeChatId(value) {
  const raw = String(value || "").trim();
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("Destino inválido");
  return digits + "@c.us";
}function isAuthorized(req) {
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(HOST);
  if (!API_TOKEN && loopback) return true;
  return Boolean(API_TOKEN) &&
    String(req.headers.authorization || "") === "Bearer " + API_TOKEN;
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = !origin ||
    origin === "https://vendeo-e755e.web.app" ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:");
  if (origin && allowed) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 25 * 1024 * 1024) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Payload grande demais");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}function ensureReady() {
  if (!client || state.status !== "ready") {
    throw new Error("WhatsApp 2 não está pronto: " + state.status);
  }
  return client;
}

async function destroyClient() {
  const current = client;
  client = null;
  initializing = null;
  if (!current) return;
  try { await current.destroy(); }
  catch (error) { console.warn("[whatsapp2] destroy:", error?.message || error); }
}

async function startClient() {
  if (initializing) return initializing;
  setState({ status: "starting", lastError: null });

  initializing = (async () => {
    const next = new Client({
      authStrategy: new LocalAuth({ clientId: "vendeo-whatsapp2", dataPath: SESSION_DIR }),
      puppeteer: {
        headless: true,
        ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      },
    });
    client = next;

    next.on("qr", async (qr) => {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 1 });
      setState({ status: "qr", qrDataUrl, qrUpdatedAt: new Date().toISOString() });
      await emitEvent("qr", { qrDataUrl, qrUpdatedAt: state.qrUpdatedAt });
      console.log("[whatsapp2] QR gerado");
    });    next.on("authenticated", async () => {
      setState({ status: "authenticated", qrDataUrl: null, lastError: null });
      await emitEvent("authenticated");
    });
    next.on("ready", async () => {
      const me = next.info ? {
        wid: next.info.wid?._serialized || null,
        pushname: next.info.pushname || null,
        platform: next.info.platform || null,
      } : null;
      setState({ status: "ready", readyAt: new Date().toISOString(), qrDataUrl: null, me });
      await emitEvent("ready", { me });
      console.log("[whatsapp2] pronto", me || "");
    });
    next.on("auth_failure", async (message) => {
      setState({ status: "auth_failure", lastError: String(message || "") });
      await emitEvent("auth_failure", { message: String(message || "") });
    });
    next.on("disconnected", async (reason) => {
      setState({ status: "disconnected", lastError: String(reason || "") });
      await emitEvent("disconnected", { reason: String(reason || "") });
    });
    next.on("message", (message) => emitEvent("message", serializeMessage(message)));
    next.on("message_create", (message) => {
      if (message.fromMe) return emitEvent("message_create", serializeMessage(message));
    });
    next.on("message_ack", (message, ack) =>
      emitEvent("message_ack", { message: serializeMessage(message), ack }));
    next.on("message_revoke_everyone", (after, before) =>
      emitEvent("message_revoke_everyone", {
        after: serializeMessage(after), before: serializeMessage(before)
      }));
    next.on("message_reaction", (reaction) => emitEvent("message_reaction", reaction));

    try { await next.initialize(); }
    catch (error) {
      initializing = null;
      setState({ status: "error", lastError: String(error?.message || error) });
      throw error;
    }
  })();
  return initializing;
}async function getMessage(messageId) {
  const message = await ensureReady().getMessageById(String(messageId || ""));
  if (!message) throw new Error("Mensagem não encontrada");
  return message;
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

  const url = new URL(req.url || "/", "http://" + (req.headers.host || HOST + ":" + PORT));
  if (url.pathname === "/health") {
    json(res, 200, { ok: true, service: "vendeo-whatsapp2-gateway", status: state.status });
    return;
  }
  if (!isAuthorized(req)) { json(res, 401, { ok: false, error: "unauthorized" }); return; }

  try {
    if (req.method === "GET" && url.pathname === "/status") {
      json(res, 200, { ok: true, ...snapshot() }); return;
    }
    if (req.method === "GET" && url.pathname === "/qr") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      const content = state.status === "ready"
        ? `<h1>WhatsApp 2 conectado</h1><p>${state.me?.pushname || "Sessão pronta"}</p>`
        : state.qrDataUrl
          ? `<h1>Conectar WhatsApp 2</h1><p>WhatsApp > Dispositivos conectados > Conectar dispositivo</p><img src="${state.qrDataUrl}" width="360" height="360" />`
          : `<h1>WhatsApp 2</h1><p>Aguardando QR... status: ${state.status}</p>`;
      res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><style>body{font-family:system-ui;background:#0b141a;color:#e9edef;display:grid;place-items:center;min-height:90vh;text-align:center}img{background:white;padding:12px;border-radius:18px}p{color:#aebac1}</style><main>${content}</main>`);
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      sseClients.add(res);
      pushSse(res, "status", snapshot());
      const timer = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20000);
      req.on("close", () => { clearInterval(timer); sseClients.delete(res); });
      return;
    }    if (req.method === "POST" && url.pathname === "/session/start") {
      void startClient().catch(console.error);
      json(res, 202, { ok: true, status: state.status }); return;
    }
    if (req.method === "POST" && url.pathname === "/session/restart") {
      await destroyClient();
      void startClient().catch(console.error);
      json(res, 202, { ok: true, status: "starting" }); return;
    }
    if (req.method === "POST" && url.pathname === "/session/logout") {
      try { await client?.logout(); } catch {}
      await destroyClient();
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      setState({ status: "idle", qrDataUrl: null, readyAt: null, me: null, lastError: null });
      json(res, 200, { ok: true }); return;
    }
    if (req.method === "POST" && url.pathname === "/messages/send") {
      const body = await readJson(req);
      const sent = await ensureReady().sendMessage(normalizeChatId(body.to), String(body.text || ""), {
        ...(body.replyToMessageId ? { quotedMessageId: String(body.replyToMessageId) } : {}),
      });
      json(res, 200, { ok: true, message: serializeMessage(sent) }); return;
    }
    if (req.method === "POST" && url.pathname === "/messages/send-media") {
      const body = await readJson(req);
      let media;
      if (body.mediaUrl) {
        media = await MessageMedia.fromUrl(String(body.mediaUrl), {
          unsafeMime: true, filename: body.filename ? String(body.filename) : undefined,
        });
      } else if (body.mediaBase64 && body.mimetype) {
        media = new MessageMedia(String(body.mimetype), String(body.mediaBase64),
          body.filename ? String(body.filename) : undefined);
      } else throw new Error("Informe mediaUrl ou mediaBase64 + mimetype");      const sent = await ensureReady().sendMessage(normalizeChatId(body.to), media, {
        ...(body.caption ? { caption: String(body.caption) } : {}),
        ...(body.asVoice ? { sendAudioAsVoice: true } : {}),
        ...(body.asSticker ? { sendMediaAsSticker: true } : {}),
        ...(body.replyToMessageId ? { quotedMessageId: String(body.replyToMessageId) } : {}),
      });
      json(res, 200, { ok: true, message: serializeMessage(sent) }); return;
    }
    if (req.method === "POST" && url.pathname === "/messages/delete") {
      const body = await readJson(req);
      const result = await (await getMessage(body.messageId)).delete(body.everyone !== false);
      json(res, 200, { ok: true, everyone: body.everyone !== false, result: result ?? true }); return;
    }
    if (req.method === "POST" && url.pathname === "/messages/react") {
      const body = await readJson(req);
      await (await getMessage(body.messageId)).react(String(body.reaction || ""));
      json(res, 200, { ok: true }); return;
    }
    if (req.method === "POST" && url.pathname === "/messages/edit") {
      const body = await readJson(req);
      const message = await getMessage(body.messageId);
      if (typeof message.edit !== "function") throw new Error("Edição não disponível nesta sessão");
      const edited = await message.edit(String(body.text || ""));
      json(res, 200, { ok: true, message: serializeMessage(edited || message) }); return;
    }
    json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    console.error("[whatsapp2] request:", error);
    json(res, 400, { ok: false, error: String(error?.message || error) });
  }
});server.listen(PORT, HOST, () => {
  console.log("[whatsapp2] gateway em http://" + HOST + ":" + PORT);
  console.log("[whatsapp2] sessão persistente em " + SESSION_DIR);
  void startClient().catch((error) => console.error("[whatsapp2] initialize:", error));
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[whatsapp2] encerrando " + signal);
  server.close();
  await destroyClient();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));