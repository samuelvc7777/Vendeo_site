const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const WA_JS_BUNDLE = require.resolve("@wppconnect/wa-js");

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
const CHROME_PATH = process.env.WHATSAPP2_CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
let client = null;
let initializing = null;
let waJsReadyPromise = null;
let shuttingDown = false;
const sseClients = new Set();
const profilePicCache = new Map();
const profilePicPending = new Map();
const PROFILE_PIC_TTL_MS = 30 * 60 * 1000;

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
    id: message.id?._serialized || message.id?.$1 || null,
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
  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
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

function getCachedProfilePic(chatId) {
  const cached = profilePicCache.get(chatId);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > PROFILE_PIC_TTL_MS) {
    profilePicCache.delete(chatId);
    return null;
  }
  return cached.url || null;
}

async function resolveProfilePic(chatId) {
  const cached = profilePicCache.get(chatId);
  if (cached && Date.now() - cached.updatedAt <= PROFILE_PIC_TTL_MS) {
    return cached.url || null;
  }
  if (profilePicPending.has(chatId)) return profilePicPending.get(chatId);

  const pending = (async () => {
    try {
      const active = ensureReady();
      const url = await active.getProfilePicUrl(chatId);
      profilePicCache.set(chatId, { url: url || null, updatedAt: Date.now() });
      return url || null;
    } catch (error) {
      console.warn("[whatsapp2] foto de perfil indisponível para", chatId, error?.message || error);
      profilePicCache.set(chatId, { url: null, updatedAt: Date.now() });
      return null;
    } finally {
      profilePicPending.delete(chatId);
    }
  })();

  profilePicPending.set(chatId, pending);
  return pending;
}

function warmProfilePics(chatIds) {
  const queue = chatIds.filter((id) => id && !getCachedProfilePic(id) && !profilePicPending.has(id));
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      await resolveProfilePic(id);
    }
  });
  void Promise.allSettled(workers);
}

async function ensureWaJsReady() {
  if (waJsReadyPromise) return waJsReadyPromise;
  const active = client;
  if (!active?.pupPage) throw new Error("Página do WhatsApp Web indisponível");

  waJsReadyPromise = (async () => {
    const page = active.pupPage;
    const alreadyReady = await page.evaluate(() => Boolean(globalThis.WPP && globalThis.WPP.isReady));
    if (!alreadyReady) {
      await page.addScriptTag({ path: WA_JS_BUNDLE });
      await page.waitForFunction(() => Boolean(globalThis.WPP && globalThis.WPP.isReady), { timeout: 30000 });
    }
    return true;
  })().catch((error) => {
    waJsReadyPromise = null;
    throw error;
  });

  return waJsReadyPromise;
}

async function destroyClient() {
  const current = client;
  client = null;
  initializing = null;
  waJsReadyPromise = null;
  if (!current) return;
  try { await current.destroy(); }
  catch (error) { console.warn("[whatsapp2] destroy:", error?.message || error); }
}

async function startClient() {
  if (initializing) return initializing;
  setState({ status: "starting", lastError: null });

  initializing = (async () => {
    const next = new Client({
      bypassCSP: true,
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
      void ensureWaJsReady()
        .then(() => console.log("[whatsapp2] WA-JS pronto para mídia"))
        .catch((error) => console.warn("[whatsapp2] WA-JS não carregou:", error?.message || error));
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
    if (req.method === "GET" && url.pathname === "/chats") {
      const active = ensureReady();
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 120), 300));
      const includeGroups = url.searchParams.get("includeGroups") === "true";
      const chats = await active.getChats();
      const rows = chats
        .filter((chat) => includeGroups || !chat.isGroup)
        .sort((a, b) => Number(b.timestamp || b.lastMessage?.timestamp || 0) - Number(a.timestamp || a.lastMessage?.timestamp || 0))
        .slice(0, limit)
        .map((chat) => {
          const id = chat.id?._serialized || null;
          return {
            id,
            name: chat.name || chat.id?.user || "Contato",
            avatarUrl: id ? getCachedProfilePic(id) : null,
            isGroup: Boolean(chat.isGroup),
            unreadCount: Number(chat.unreadCount || 0),
            timestamp: Number(chat.timestamp || chat.lastMessage?.timestamp || 0),
            archived: Boolean(chat.archived),
            pinned: Boolean(chat.pinned),
            lastMessage: serializeMessage(chat.lastMessage),
          };
        });
      warmProfilePics(rows.slice(0, 80).map((chat) => chat.id).filter(Boolean));
      json(res, 200, { ok: true, chats: rows }); return;
    }
    if (req.method === "GET" && url.pathname === "/chat/profile") {
      const chatId = String(url.searchParams.get("chatId") || "");
      if (!chatId) throw new Error("chatId obrigatório");
      const avatarUrl = await resolveProfilePic(chatId);
      json(res, 200, { ok: true, chatId, avatarUrl }); return;
    }
    if (req.method === "GET" && url.pathname === "/chat/messages") {
      const active = ensureReady();
      const chatId = String(url.searchParams.get("chatId") || "");
      if (!chatId) throw new Error("chatId obrigatório");
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 80), 250));
      const chat = await active.getChatById(chatId);
      if (!chat) throw new Error("Conversa não encontrada");
      const messages = await chat.fetchMessages({ limit });
      const rows = messages
        .map(serializeMessage)
        .filter(Boolean)
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      json(res, 200, { ok: true, chat: { id: chatId, name: chat.name || chatId }, messages: rows }); return;
    }
    if (req.method === "GET" && url.pathname === "/message/media") {
      const messageId = String(url.searchParams.get("messageId") || "");
      if (!messageId) throw new Error("messageId obrigatório");

      const active = ensureReady();
      await ensureWaJsReady();

      let payload = null;
      try {
        payload = await active.pupPage.evaluate(async (id) => {
          const blob = await globalThis.WPP.chat.downloadMedia(id);
          if (!blob) return null;
          const dataUrl = await globalThis.WPP.util.blobToBase64(blob);
          return {
            dataUrl,
            type: blob.type || "application/octet-stream",
            size: blob.size || 0,
          };
        }, messageId);
      } catch (error) {
        console.warn("[whatsapp2] WA-JS downloadMedia falhou, tentando fallback:", error?.message || error);
      }

      if (!payload?.dataUrl) {
        const message = await getMessage(messageId);
        if (!message.hasMedia) throw new Error("Mensagem não possui mídia");
        const media = await message.downloadMedia();
        if (!media?.data) throw new Error("Mídia indisponível");
        payload = {
          dataUrl: `data:${media.mimetype || "application/octet-stream"};base64,${media.data}`,
          type: media.mimetype || "application/octet-stream",
          size: 0,
        };
      }

      const dataUrl = String(payload.dataUrl || "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) throw new Error("Mídia retornou formato inválido");
      const header = dataUrl.slice(0, comma);
      const base64 = dataUrl.slice(comma + 1);
      const mimeMatch = header.match(/^data:([^;,]+)/i);
      const contentType = mimeMatch?.[1] || payload.type || "application/octet-stream";
      const buffer = Buffer.from(base64, "base64");

      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "private, max-age=300");
      res.setHeader("content-length", String(buffer.length));
      res.setHeader("x-whatsapp2-media-provider", "wa-js");
      res.end(buffer);
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
          unsafeMime: true,
          filename: body.filename ? String(body.filename) : undefined,
        });
      } else if (body.mediaBase64 && body.mimetype) {
        media = new MessageMedia(
          String(body.mimetype),
          String(body.mediaBase64),
          body.filename ? String(body.filename) : undefined,
        );
      } else {
        throw new Error("Informe mediaUrl ou mediaBase64 + mimetype");
      }

      const active = ensureReady();
      await ensureWaJsReady();

      const chatId = normalizeChatId(body.to);
      const cleanMime = String(media.mimetype || "application/octet-stream").split(";")[0].trim();
      const type = body.asVoice
        ? "audio"
        : body.asSticker
        ? "sticker"
        : cleanMime.startsWith("image/")
        ? "image"
        : cleanMime.startsWith("video/")
        ? "video"
        : cleanMime.startsWith("audio/")
        ? "audio"
        : "document";
      const dataUrl = `data:${cleanMime};base64,${media.data}`;
      const filename = body.filename
        ? String(body.filename)
        : body.asVoice
        ? "voice.ogg"
        : media.filename || "file";

      const result = await active.pupPage.evaluate(
        async ({ chatId, dataUrl, type, cleanMime, filename, caption, asVoice, quotedMsg }) => {
          let targetId = chatId;
          if (String(chatId).endsWith("@lid")) {
            try {
              const mapping = await globalThis.WPP.contact.getPnLidEntry(chatId);
              targetId = mapping?.phoneNumber?._serialized || chatId;
            } catch {
              targetId = chatId;
            }
          }

          const options = {
            type,
            mimetype: cleanMime,
            filename,
            ...(caption ? { caption } : {}),
            ...(asVoice ? { isPtt: true, waveform: true } : {}),
            ...(quotedMsg ? { quotedMsg } : {}),
          };
          const sent = await globalThis.WPP.chat.sendFileMessage(targetId, dataUrl, options);
          return sent ? JSON.parse(JSON.stringify(sent)) : null;
        },
        {
          chatId,
          dataUrl,
          type,
          cleanMime,
          filename,
          caption: body.caption ? String(body.caption) : "",
          asVoice: Boolean(body.asVoice),
          quotedMsg: body.replyToMessageId ? String(body.replyToMessageId) : "",
        },
      );

      const messageId = typeof result?.id === "string"
        ? result.id
        : result?.id?.toString?.() || result?.messageId || null;

      json(res, 200, {
        ok: true,
        message: {
          id: messageId,
          fromMe: true,
          to: chatId,
          body: body.caption ? String(body.caption) : "",
          type: body.asVoice ? "ptt" : type,
          timestamp: Math.floor(Date.now() / 1000),
          hasMedia: true,
          hasQuotedMsg: Boolean(body.replyToMessageId),
          ack: result?.ack ?? null,
        },
        provider: "wa-js",
      });
      return;
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