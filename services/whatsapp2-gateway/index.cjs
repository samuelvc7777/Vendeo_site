const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { createClient } = require("@supabase/supabase-js");
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
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const WORKER_ID = `wa2-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PATH = process.env.WHATSAPP2_CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
let client = null;
let initializing = null;
let waJsReadyPromise = null;
let shuttingDown = false;
let deliveryWorkerTimer = null;
let deliveryWorkerRunning = false;
const sseClients = new Set();
const profilePicCache = new Map();
const profilePicPending = new Map();
const PROFILE_PIC_TTL_MS = 30 * 60 * 1000;

const state = {
  status: "idle",
  qrDataUrl: null,
  qrUpdatedAt: null,
  pairingCode: null,
  pairingPhone: null,
  pairingUpdatedAt: null,
  pairingExpiresAt: null,
  readyAt: null,
  me: null,
  lastError: null,
  startedAt: new Date().toISOString(),
};

function snapshot() {
  return {
    ...state,
    hasQr: false,
    hasPairingCode: Boolean(state.pairingCode),
  };
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

async function persistProfilePic(chatId, url) {
  if (!supabase || !chatId || !url) return;
  try {
    await supabase
      .from("instagram_conversations")
      .update({
        avatar: url,
        avatar_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", whatsapp2ConversationId(chatId))
      .eq("channel", "whatsapp2");
  } catch (error) {
    console.warn("[whatsapp2] não foi possível persistir avatar:", error?.message || error);
  }
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
      if (url) void persistProfilePic(chatId, url);
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

function whatsapp2ConversationId(chatId) {
  return "wa2:" + String(chatId || "").trim();
}

function mimeExtension(mimeType, fallback = "bin") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  return fallback;
}

function mediaKindForMessage(message) {
  const type = String(message?.type || "").toLowerCase();
  if (type === "ptt" || type === "audio") return "audio";
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "sticker") return "sticker";
  return null;
}

function mediaPreview(kind) {
  if (kind === "audio") return "🎙️ Mensagem de voz";
  if (kind === "image") return "📷 Foto";
  if (kind === "video") return "🎥 Vídeo";
  if (kind === "sticker") return "Figurinha";
  return "Mensagem";
}

async function downloadMessageMediaPayload(messageId) {
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
  return {
    buffer: Buffer.from(base64, "base64"),
    contentType,
  };
}

async function persistWhatsApp2Media(messageId, kind) {
  if (!supabase || !messageId || !kind) return null;
  const { buffer, contentType } = await downloadMessageMediaPayload(messageId);
  const safeId = String(messageId).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const ext = mimeExtension(contentType, kind === "audio" ? "ogg" : "bin");
  const objectPath = `whatsapp2/${kind}/${safeId}.${ext}`;
  const { error } = await supabase.storage.from("vendeo_vault").upload(objectPath, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("vendeo_vault").getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

async function resolveQuotedMessageId(message) {
  if (!message?.hasQuotedMsg) return null;
  try {
    const quoted = await message.getQuotedMessage();
    return quoted?.id?._serialized || quoted?.id?.$1 || null;
  } catch {
    return null;
  }
}

async function transcribeStoredAudio(messageId, mediaUrl) {
  if (!mediaUrl || !SUPABASE_URL) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/api/ai/transcribe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SUPABASE_SERVICE_ROLE_KEY ? {
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        } : {}),
      },
      body: JSON.stringify({ messageId, mediaUrl }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && typeof data?.text === "string" ? data.text.trim() || null : null;
  } catch (error) {
    console.warn("[whatsapp2] transcrição inbound falhou:", error?.message || error);
    return null;
  }
}

async function syncWhatsApp2Message(message) {
  if (!supabase || !message) return;
  const messageId = message.id?._serialized || message.id?.$1 || null;
  if (!messageId) return;

  const chatId = String(message.fromMe ? message.to : message.from || "").trim();
  if (!chatId || chatId === "status@broadcast" || chatId.endsWith("@g.us")) return;

  let chatName = chatId;
  try {
    const chat = await message.getChat();
    chatName = String(chat?.name || chatId);
  } catch {}
  const avatarUrl = await resolveProfilePic(chatId).catch(() => null);
  const timestamp = new Date(Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const replyToMessageId = await resolveQuotedMessageId(message);
  const kind = mediaKindForMessage(message);
  let mediaUrl = null;
  let transcript = null;
  let text = String(message.body || "").trim();
  let preview = text || "Mensagem";

  if (kind) {
    try {
      mediaUrl = await persistWhatsApp2Media(messageId, kind);
    } catch (error) {
      console.warn("[whatsapp2] persistência de mídia falhou:", messageId, error?.message || error);
    }
    preview = mediaPreview(kind);
    if (mediaUrl) {
      if (kind === "audio") text = `[audio:${mediaUrl}]`;
      else if (kind === "image") text = `[image:${mediaUrl}]${text ? " " + text : ""}`;
      else if (kind === "video") text = `[video:${mediaUrl}]${text ? " " + text : ""}`;
      else if (kind === "sticker") text = `[sticker:${mediaUrl}]`;
    } else if (!text) {
      text = preview;
    }
    if (kind === "audio" && mediaUrl) {
      transcript = await transcribeStoredAudio(messageId, mediaUrl);
    }
  }

  const conversationId = whatsapp2ConversationId(chatId);
  if (!message.fromMe) {
    const { data, error } = await supabase.rpc("ingest_whatsapp2_inbound_atomic", {
      p_conversation_id: conversationId,
      p_raw_contact_id: chatId,
      p_message_id: messageId,
      p_sender_id: String(message.from || chatId),
      p_contact_name: chatName,
      p_text: text || preview,
      p_timestamp: timestamp,
      p_preview_text: preview,
      p_avatar_url: avatarUrl,
      p_media_url: mediaUrl,
      p_media_type: kind,
      p_reply_to_message_id: replyToMessageId,
      p_audio_transcript: transcript,
      p_audio_transcription_error: kind === "audio" && mediaUrl && !transcript ? "transcription_unavailable" : null,
      p_actionable: kind !== "sticker",
    });
    if (error || data?.success !== true) {
      throw error || new Error(data?.reason || "whatsapp2_inbound_sync_failed");
    }
  } else {
    const { data, error } = await supabase.rpc("record_whatsapp2_outbound_atomic", {
      p_conversation_id: conversationId,
      p_raw_contact_id: chatId,
      p_message_id: messageId,
      p_contact_name: chatName,
      p_text: text || preview,
      p_timestamp: timestamp,
      p_preview_text: preview,
      p_avatar_url: avatarUrl,
      p_media_url: mediaUrl,
      p_media_type: kind,
      p_reply_to_message_id: replyToMessageId,
      p_status: Number(message.ack || 0) >= 3 ? "seen" : Number(message.ack || 0) >= 2 ? "delivered" : "sent",
    });
    if (error || data?.success !== true) {
      throw error || new Error(data?.reason || "whatsapp2_outbound_sync_failed");
    }
  }
}

async function syncWhatsApp2Ack(message, ack) {
  if (!supabase || !message) return;
  const messageId = message.id?._serialized || message.id?.$1 || null;
  if (!messageId) return;
  const numericAck = Number(ack ?? message.ack ?? 0);
  const status = numericAck >= 3 ? "seen" : numericAck >= 2 ? "delivered" : "sent";
  const seenAt = numericAck >= 3 ? new Date().toISOString() : null;

  await supabase
    .from("instagram_messages")
    .update({
      status,
      ...(seenAt ? { seen_at: seenAt } : {}),
    })
    .eq("id", messageId)
    .eq("channel", "whatsapp2");

  const chatId = String(message.to || "").trim();
  if (chatId) {
    await supabase
      .from("instagram_conversations")
      .update({
        last_status: status,
        ...(seenAt ? { seen_at: seenAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", whatsapp2ConversationId(chatId))
      .eq("channel", "whatsapp2");
  }
}

async function syncWhatsApp2Reaction(reaction) {
  if (!supabase || !reaction) return;
  const targetMessageId =
    reaction.msgId?._serialized ||
    reaction.msgId?.$1 ||
    reaction.msgId?.toString?.() ||
    null;
  if (!targetMessageId) return;
  const emoji = String(reaction.reaction || "").trim();
  const senderId =
    reaction.senderId?._serialized ||
    reaction.senderId?.$1 ||
    String(reaction.senderId || "");
  const reactedAt = reaction.timestamp
    ? new Date(Number(reaction.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const { error } = await supabase.rpc("apply_instagram_message_reaction_atomic", {
    p_message_id: targetMessageId,
    p_sender_id: senderId || "whatsapp2",
    p_emoji: emoji || null,
    p_action: emoji ? "react" : "unreact",
    p_reacted_at: reactedAt,
  });
  if (error) console.warn("[whatsapp2] reação não persistida:", error.message);
}

async function syncWhatsApp2Revoke(after, before) {
  if (!supabase) return;
  const target =
    before?.id?._serialized ||
    before?.id?.$1 ||
    after?.protocolMessageKey?._serialized ||
    after?.protocolMessageKey?.$1 ||
    null;
  if (!target) return;
  try {
    await supabase
      .from("instagram_messages")
      .update({
        text: "Mensagem apagada",
        media_url: null,
        media_type: null,
        audio_transcript: null,
      })
      .eq("id", target)
      .eq("channel", "whatsapp2");
  } catch {}
}

async function syncChatSnapshots() {
  if (!supabase || state.status !== "ready") return;
  const active = ensureReady();
  let chats = [];
  try {
    chats = await active.getChats();
  } catch (error) {
    console.warn("[whatsapp2] snapshot de chats falhou:", error?.message || error);
    return;
  }

  const now = new Date().toISOString();
  const oneWeekAgoSeconds = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  const recentChats = chats
    .filter((chat) => {
      if (!chat || chat.isGroup) return false;
      const timestamp = Number(chat.lastMessage?.timestamp || chat.timestamp || 0);
      return timestamp >= oneWeekAgoSeconds;
    })
    .sort(
      (a, b) =>
        Number(b.lastMessage?.timestamp || b.timestamp || 0) -
        Number(a.lastMessage?.timestamp || a.timestamp || 0),
    )
    .slice(0, 500);

  const rows = [];
  for (const chat of recentChats) {
    const chatId = chat.id?._serialized || chat.id?.$1 || null;
    if (!chatId) continue;
    const avatar = getCachedProfilePic(chatId);
    const last = serializeMessage(chat.lastMessage);
    const rawLastTimestamp = Number(last?.timestamp || chat.timestamp || 0);
    const lastAt = new Date(rawLastTimestamp * 1000).toISOString();
    rows.push({
      id: whatsapp2ConversationId(chatId),
      username: chatId,
      full_name: String(chat.name || chatId),
      ...(avatar ? { avatar, avatar_url: avatar } : {}),
      contact_id: chatId,
      channel: "whatsapp2",
      last_message: formatWhatsApp2PreviewForGateway(last),
      last_message_preview: formatWhatsApp2PreviewForGateway(last),
      last_message_at: lastAt,
      last_direction: last?.fromMe ? "out" : "in",
      last_status: last?.fromMe ? (Number(last.ack || 0) >= 3 ? "seen" : Number(last.ack || 0) >= 2 ? "delivered" : "sent") : null,
      unread: Number(chat.unreadCount || 0) > 0,
      unread_count: Number(chat.unreadCount || 0),
      updated_at: now,
      status: "active",
    });
  }

  if (!rows.length) return;
  const { error } = await supabase.from("instagram_conversations").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });
  if (error) console.warn("[whatsapp2] snapshot Supabase falhou:", error.message);
}

function formatWhatsApp2PreviewForGateway(message) {
  if (!message) return "";
  const body = String(message.body || "").trim();
  if (body) return body;
  const type = String(message.type || "").toLowerCase();
  if (type === "ptt" || type === "audio") return "🎙️ Mensagem de voz";
  if (type === "image") return "📷 Foto";
  if (type === "video") return "🎥 Vídeo";
  if (type === "sticker") return "Figurinha";
  return type ? `[${type}]` : "";
}

async function sendTextInternal({ to, text, replyToMessageId }) {
  const sent = await ensureReady().sendMessage(normalizeChatId(to), String(text || ""), {
    ...(replyToMessageId ? { quotedMessageId: String(replyToMessageId) } : {}),
  });
  return serializeMessage(sent);
}

async function sendMediaInternal({
  to,
  mediaUrl,
  mediaBase64,
  mimetype,
  filename,
  caption,
  asVoice,
  asSticker,
  replyToMessageId,
}) {
  let media;
  if (mediaUrl) {
    media = await MessageMedia.fromUrl(String(mediaUrl), {
      unsafeMime: true,
      filename: filename ? String(filename) : undefined,
    });
  } else if (mediaBase64 && mimetype) {
    media = new MessageMedia(
      String(mimetype),
      String(mediaBase64),
      filename ? String(filename) : undefined,
    );
  } else {
    throw new Error("Informe mediaUrl ou mediaBase64 + mimetype");
  }

  const active = ensureReady();
  await ensureWaJsReady();

  const chatId = normalizeChatId(to);
  const cleanMime = String(media.mimetype || "application/octet-stream").split(";")[0].trim();
  const type = asVoice
    ? "audio"
    : asSticker
    ? "sticker"
    : cleanMime.startsWith("image/")
    ? "image"
    : cleanMime.startsWith("video/")
    ? "video"
    : cleanMime.startsWith("audio/")
    ? "audio"
    : "document";
  const dataUrl = `data:${cleanMime};base64,${media.data}`;
  const resolvedFilename = filename
    ? String(filename)
    : asVoice
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
      filename: resolvedFilename,
      caption: caption ? String(caption) : "",
      asVoice: Boolean(asVoice),
      quotedMsg: replyToMessageId ? String(replyToMessageId) : "",
    },
  );

  const messageId = typeof result?.id === "string"
    ? result.id
    : result?.id?.toString?.() || result?.messageId || null;

  return {
    id: messageId,
    fromMe: true,
    to: chatId,
    body: caption ? String(caption) : "",
    type: asVoice ? "ptt" : type,
    timestamp: Math.floor(Date.now() / 1000),
    hasMedia: true,
    hasQuotedMsg: Boolean(replyToMessageId),
    ack: result?.ack ?? null,
  };
}

async function processDeliveryQueue() {
  if (!supabase || deliveryWorkerRunning || state.status !== "ready") return;
  deliveryWorkerRunning = true;
  try {
    const { data: jobs, error } = await supabase.rpc("claim_whatsapp2_delivery_batch", {
      p_worker_id: WORKER_ID,
      p_limit: 5,
      p_stale_after_seconds: 90,
    });
    if (error) throw error;

    for (const job of jobs || []) {
      try {
        let sent;
        if (job.kind === "text") {
          sent = await sendTextInternal({
            to: job.recipient_id,
            text: job.text_content || "",
            replyToMessageId: job.reply_to_message_id,
          });
        } else {
          sent = await sendMediaInternal({
            to: job.recipient_id,
            mediaUrl: job.media_url,
            caption: job.kind === "image" ? (job.text_content || "") : "",
            asVoice: job.kind === "audio" && job.voice_note === true,
            asSticker: job.kind === "sticker",
            replyToMessageId: job.reply_to_message_id,
          });
        }

        const providerMessageId = sent?.id || null;
        await supabase.rpc("complete_whatsapp2_delivery", {
          p_id: job.id,
          p_worker_id: WORKER_ID,
          p_success: true,
          p_provider_message_id: providerMessageId,
          p_error: null,
          p_uncertain: false,
        });
      } catch (error) {
        const uncertain = /timeout|timed out|connection|socket/i.test(String(error?.message || error));
        await supabase.rpc("complete_whatsapp2_delivery", {
          p_id: job.id,
          p_worker_id: WORKER_ID,
          p_success: false,
          p_provider_message_id: null,
          p_error: String(error?.message || error),
          p_uncertain: uncertain,
        }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn("[whatsapp2] worker de entrega:", error?.message || error);
  } finally {
    deliveryWorkerRunning = false;
  }
}

function startDeliveryWorker() {
  if (!supabase || deliveryWorkerTimer) return;
  void processDeliveryQueue();
  deliveryWorkerTimer = setInterval(() => void processDeliveryQueue(), 750);
}

function stopDeliveryWorker() {
  if (!deliveryWorkerTimer) return;
  clearInterval(deliveryWorkerTimer);
  deliveryWorkerTimer = null;
}

async function destroyClient() {
  stopDeliveryWorker();
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

    next.on("qr", async () => {
      const updatedAt = new Date().toISOString();
      setState({
        status: "awaiting_pairing",
        qrDataUrl: null,
        qrUpdatedAt: updatedAt,
        pairingCode: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
      });
      await emitEvent("awaiting_pairing", { updatedAt });
      console.log("[whatsapp2] aguardando pareamento por número");
    });
    next.on("code", async (code) => {
      const updatedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 180_000).toISOString();
      setState({
        status: "pairing_code",
        qrDataUrl: null,
        pairingCode: String(code || ""),
        pairingUpdatedAt: updatedAt,
        pairingExpiresAt: expiresAt,
        lastError: null,
      });
      await emitEvent("pairing_code", {
        code: String(code || ""),
        phoneNumber: state.pairingPhone,
        updatedAt,
        expiresAt,
      });
      console.log("[whatsapp2] código de pareamento gerado");
    });
    next.on("authenticated", async () => {
      setState({
        status: "authenticated",
        qrDataUrl: null,
        pairingCode: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
        lastError: null,
      });
      await emitEvent("authenticated");
    });
    next.on("ready", async () => {
      const me = next.info ? {
        wid: next.info.wid?._serialized || null,
        pushname: next.info.pushname || null,
        platform: next.info.platform || null,
      } : null;
      setState({
        status: "ready",
        readyAt: new Date().toISOString(),
        qrDataUrl: null,
        pairingCode: null,
        pairingPhone: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
        me,
      });
      await emitEvent("ready", { me });
      console.log("[whatsapp2] pronto", me || "");
      void ensureWaJsReady()
        .then(() => console.log("[whatsapp2] WA-JS pronto para mídia"))
        .catch((error) => console.warn("[whatsapp2] WA-JS não carregou:", error?.message || error));
      startDeliveryWorker();
      void syncChatSnapshots();
      if (supabase) {
        console.log("[whatsapp2] ponte Supabase ativa", { workerId: WORKER_ID });
      } else {
        console.warn("[whatsapp2] ponte Supabase desativada: credenciais locais ausentes");
      }
    });
    next.on("auth_failure", async (message) => {
      stopDeliveryWorker();
      setState({ status: "auth_failure", lastError: String(message || "") });
      await emitEvent("auth_failure", { message: String(message || "") });
    });
    next.on("disconnected", async (reason) => {
      stopDeliveryWorker();
      setState({ status: "disconnected", lastError: String(reason || "") });
      await emitEvent("disconnected", { reason: String(reason || "") });
    });
    next.on("message", (message) => {
      void emitEvent("message", serializeMessage(message));
      void syncWhatsApp2Message(message).catch((error) =>
        console.warn("[whatsapp2] inbound sync:", error?.message || error));
    });
    next.on("message_create", (message) => {
      if (!message.fromMe) return;
      void emitEvent("message_create", serializeMessage(message));
      void syncWhatsApp2Message(message).catch((error) =>
        console.warn("[whatsapp2] outbound sync:", error?.message || error));
    });
    next.on("message_ack", (message, ack) => {
      void emitEvent("message_ack", { message: serializeMessage(message), ack });
      void syncWhatsApp2Ack(message, ack).catch((error) =>
        console.warn("[whatsapp2] ack sync:", error?.message || error));
    });
    next.on("message_revoke_everyone", (after, before) => {
      void emitEvent("message_revoke_everyone", {
        after: serializeMessage(after), before: serializeMessage(before)
      });
      void syncWhatsApp2Revoke(after, before).catch((error) =>
        console.warn("[whatsapp2] revoke sync:", error?.message || error));
    });
    next.on("message_reaction", (reaction) => {
      void emitEvent("message_reaction", reaction);
      void syncWhatsApp2Reaction(reaction).catch((error) =>
        console.warn("[whatsapp2] reaction sync:", error?.message || error));
    });

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
    if (req.method === "POST" && url.pathname === "/disconnect") {
      if (!client || state.status !== "ready") {
        json(res, 200, { ok: true, disconnected: true, status: state.status });
        return;
      }

      stopDeliveryWorker();
      const current = client;
      client = null;
      initializing = null;
      waJsReadyPromise = null;
      setState({
        status: "disconnecting",
        readyAt: null,
        me: null,
        pairingCode: null,
        pairingPhone: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
        lastError: null,
      });

      try {
        await current.logout();
      } catch (error) {
        console.warn("[whatsapp2] logout:", error?.message || error);
        try { await current.destroy(); } catch {}
      }

      setState({
        status: "disconnected",
        qrDataUrl: null,
        qrUpdatedAt: null,
        readyAt: null,
        me: null,
        pairingCode: null,
        pairingPhone: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
        lastError: null,
      });

      void startClient().catch((error) => {
        console.error("[whatsapp2] restart after disconnect:", error);
      });

      json(res, 200, { ok: true, disconnected: true, status: "disconnected" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/pairing-code") {
      if (state.status === "ready") {
        json(res, 409, {
          ok: false,
          error: "WhatsApp 2 já está conectado.",
          status: state.status,
          me: state.me,
        });
        return;
      }
      const body = await readJson(req, 32 * 1024);
      const phoneNumber = String(body.phoneNumber || "").replace(/\D/g, "");
      if (phoneNumber.length < 8 || phoneNumber.length > 15) {
        throw new Error("Informe o número com código do país e DDD, somente números.");
      }
      if (!client?.pupPage) {
        throw new Error("WhatsApp Web ainda está iniciando. Tente novamente em alguns segundos.");
      }

      setState({
        status: "requesting_pairing_code",
        pairingPhone: phoneNumber,
        pairingCode: null,
        pairingUpdatedAt: null,
        pairingExpiresAt: null,
        lastError: null,
      });
      const code = await client.requestPairingCode(phoneNumber, true, 180_000);
      const updatedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 180_000).toISOString();
      setState({
        status: "pairing_code",
        pairingPhone: phoneNumber,
        pairingCode: String(code || ""),
        pairingUpdatedAt: updatedAt,
        pairingExpiresAt: expiresAt,
        lastError: null,
      });
      json(res, 200, {
        ok: true,
        status: "pairing_code",
        code: String(code || ""),
        phoneNumber,
        updatedAt,
        expiresAt,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/qr") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      const formattedCode = state.pairingCode
        ? String(state.pairingCode).replace(/(.{4})(?=.)/g, "$1-")
        : "";
      const content = state.status === "ready"
        ? `<h1>WhatsApp 2 conectado</h1><p>${state.me?.pushname || "Sessão pronta"}</p>`
        : formattedCode
          ? `<h1>Código de conexão</h1><div class="code">${formattedCode}</div><p>No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.</p>`
          : `<h1>WhatsApp 2</h1><p>Conecte pelo Vendeo informando o número do WhatsApp para gerar o código de 8 caracteres.</p><small>Status: ${state.status}</small>`;
      res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><style>body{font-family:system-ui;background:#0b141a;color:#e9edef;display:grid;place-items:center;min-height:90vh;text-align:center;padding:24px}main{max-width:560px}.code{font-size:42px;font-weight:800;letter-spacing:6px;margin:22px 0}p,small{color:#aebac1;line-height:1.5}</style><main>${content}</main>`);
      return;
    }
    if (req.method === "GET" && url.pathname === "/chats") {
      const active = ensureReady();
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 120), 500));
      const includeGroups = url.searchParams.get("includeGroups") === "true";
      const chats = await active.getChats();
      const oneWeekAgoSeconds = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      const rows = chats
        .filter((chat) => {
          if (!includeGroups && chat.isGroup) return false;
          const timestamp = Number(chat.lastMessage?.timestamp || chat.timestamp || 0);
          return timestamp >= oneWeekAgoSeconds;
        })
        .sort((a, b) => Number(b.lastMessage?.timestamp || b.timestamp || 0) - Number(a.lastMessage?.timestamp || a.timestamp || 0))
        .slice(0, limit)
        .map((chat) => {
          const id = chat.id?._serialized || null;
          return {
            id,
            name: chat.name || chat.id?.user || "Contato",
            avatarUrl: id ? getCachedProfilePic(id) : null,
            isGroup: Boolean(chat.isGroup),
            unreadCount: Number(chat.unreadCount || 0),
            timestamp: Number(chat.lastMessage?.timestamp || chat.timestamp || 0),
            archived: Boolean(chat.archived),
            pinned: Boolean(chat.pinned),
            lastMessage: serializeMessage(chat.lastMessage),
          };
        });
      warmProfilePics(rows.map((chat) => chat.id).filter(Boolean));
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
      const sent = await sendTextInternal({
        to: body.to,
        text: body.text,
        replyToMessageId: body.replyToMessageId,
      });
      json(res, 200, { ok: true, message: sent }); return;
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
      const messageId = String(body.messageId || "");
      const message = await getMessage(messageId);
      const chatId = String(message.fromMe ? message.to : message.from || "");
      if (!chatId) throw new Error("Chat da mensagem não encontrado");
      await ensureWaJsReady();
      const revoke = body.everyone !== false;
      const result = await ensureReady().pupPage.evaluate(
        async ({ chatId, messageId, revoke }) => {
          return await globalThis.WPP.chat.deleteMessage(chatId, messageId, true, revoke);
        },
        { chatId, messageId, revoke },
      );
      json(res, 200, { ok: true, everyone: revoke, result: result ?? true }); return;
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