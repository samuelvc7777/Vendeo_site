const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { limitChatSnapshot } = require("./chat-snapshot-policy.cjs");
const { latestInboundProviderMessage } = require("./latest-provider-message.cjs");
const {
  whatsappAccountIdFromWid,
  whatsapp2ConversationIdForAccount,
  whatsappProviderIdFromConversationId,
} = require("../../src/domain/entities/whatsapp2-account-scope.cjs");
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

const {
  extractPdfDocument,
  isPdfAttachment,
} = require("./pdf-document.cjs");
const { saveWhatsApp2AddressBookContact } = require("./contact-address-book.cjs");
const { resolveWhatsApp2CanonicalConversationId: resolveWhatsApp2CanonicalIdentity } = require("./canonical-identity.cjs");
const {
  extractOfficeDocument,
  detectDocumentKind,
} = require("./office-document.cjs");
const {
  MAX_MEDIA_BYTES,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  normalizeMimeType,
  assertMediaSizeWithinLimit,
  sanitizeAttachmentFilename,
  resolveTrustedMimeType,
  downloadHttpMediaBounded,
} = require("./media-security.cjs");
const {
  publishTextStatus,
  publishImageStatus,
  publishVideoStatus,
  getStatusPrivacy,
  setStatusPrivacy,
  getStatusContacts,
  WhatsAppStatusError,
} = require("./status/status-service.cjs");

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

function normalizeEvergreenRecipientKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutPrefix = whatsappProviderIdFromConversationId(raw);
  const base = withoutPrefix.replace(/@.*$/, "");
  const digits = base.replace(/\D+/g, "");
  return digits || base.toLowerCase();
}

async function loadEvergreenStatusRecipients(storyKey) {
  if (!supabase) throw new Error("Supabase indisponível para histórico Evergreen");
  const key = String(storyKey || "").trim();
  if (!key) throw new Error("storyKey obrigatório");

  const { data, error } = await supabase
    .from("whatsapp_status_story_recipients")
    .select("contact_key, contact_id, contact_number, status_post_id, sent_at")
    .eq("story_key", key)
    .order("sent_at", { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({
    contactKey: row.contact_key,
    contactId: row.contact_id || null,
    contactNumber: row.contact_number || null,
    statusPostId: row.status_post_id || null,
    sentAt: row.sent_at,
  }));
}

async function recordEvergreenStatusRecipients({ storyKey, statusPostId, recipients }) {
  if (!supabase) throw new Error("Supabase indisponível para histórico Evergreen");
  const key = String(storyKey || "").trim();
  if (!key) throw new Error("storyKey obrigatório");
  const rows = [];

  for (const recipient of Array.isArray(recipients) ? recipients : []) {
    const contactId = String(recipient?.id || recipient?.contactId || "").trim() || null;
    const contactNumber = String(recipient?.number || recipient?.contactNumber || "").trim() || null;
    const contactKey = normalizeEvergreenRecipientKey(contactNumber || contactId);
    if (!contactKey) continue;
    rows.push({
      story_key: key,
      contact_key: contactKey,
      contact_id: contactId,
      contact_number: contactNumber,
      status_post_id: String(statusPostId || "").trim() || null,
      sent_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabase
    .from("whatsapp_status_story_recipients")
    .upsert(rows, { onConflict: "story_key,contact_key", ignoreDuplicates: true });
  if (error) throw error;
  return { inserted: rows.length };
}

const WORKER_ID = `wa2-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PATH = process.env.WHATSAPP2_CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
let client = null;
let initializing = null;
let waJsReadyPromise = null;
let waJsGatewayBundleSource = null;
let shuttingDown = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectInProgress = false;
let deliveryWorkerTimer = null;
let deliveryWorkerRunning = false;
let inboundWorkerTimer = null;
let inboundWorkerRunning = false;
let inboundJobsInFlight = 0;
let transcriptionWorkerTimer = null;
let transcriptionWorkerRunning = false;
const sseClients = new Set();
const profilePicCache = new Map();
const profilePicPending = new Map();
let chatSnapshotCache = null;
let chatSnapshotCacheAt = 0;
let chatSnapshotPending = null;
let chatSnapshotGeneration = 0;
const presenceSubscriptions = new Map();
const presenceSubscriptionPending = new Map();
const presenceSubscriptionVersions = new Map();
const presenceLookupPending = new Map();
const presenceSnapshotCache = new Map();
const contactPhoneCache = new Map();
const savedContactNamesByPhoneCache = new Map();
let presenceBridgePage = null;
let presenceBridgeExposed = false;
let presenceOperationQueue = Promise.resolve();
const MAX_ACTIVE_PRESENCE_SUBSCRIPTIONS = 32;
const MAX_PRESENCE_SNAPSHOT_CACHE = 64;
const MAX_PROFILE_PIC_CACHE = 600;
const MAX_PROFILE_PIC_WARM_BATCH = 80;
const PROFILE_PIC_WARM_CONCURRENCY = 2;
const CHAT_SNAPSHOT_CACHE_TTL_MS = 15_000;
const MAX_CHAT_SNAPSHOT_ROWS = 1_000;
const PRESENCE_EPHEMERAL_TTL_MS = 5_000;
const PRESENCE_LAST_SEEN_TTL_MS = 60_000;
const PROFILE_PIC_TTL_MS = 30 * 60 * 1000;
const CONTACT_PHONE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CONTACT_PHONE_CACHE = 2_000;
const SAVED_CONTACT_NAMES_CACHE_TTL_MS = 60_000;
const WHATSAPP2_RECONNECT_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

const WHATSAPP2_INBOUND_CONCURRENCY = 3;
const WHATSAPP2_MEDIA_CONCURRENCY = 1;
const WHATSAPP2_TRANSCRIPTION_CONCURRENCY = 2;
const WHATSAPP2_DELIVERY_BATCH_LIMIT = 1;
const WHATSAPP2_DELIVERY_MAX_ATTEMPTS = 3;
const WHATSAPP2_SEND_CONCURRENCY = 1;
const WHATSAPP2_SEND_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.WHATSAPP2_SEND_TIMEOUT_MS || "45000", 10) || 45_000,
);
const WHATSAPP2_WEBHOOK_CONCURRENCY = 4;

function createConcurrencyGate(limit) {
  let active = 0;
  const waiters = [];

  return async function runWithSlot(work) {
    if (active >= limit) {
      await new Promise((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }

    try {
      return await work();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active = Math.max(0, active - 1);
    }
  };
}

async function withOperationTimeout(promise, timeoutMs, errorCode) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const runWithHeavyMediaSlot = createConcurrencyGate(
  WHATSAPP2_MEDIA_CONCURRENCY,
);
const runWithSendSlot = createConcurrencyGate(
  WHATSAPP2_SEND_CONCURRENCY,
);
const runWithWebhookSlot = createConcurrencyGate(
  WHATSAPP2_WEBHOOK_CONCURRENCY,
);

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
    const response = await runWithWebhookSlot(() =>
      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(WEBHOOK_TOKEN ? { authorization: "Bearer " + WEBHOOK_TOKEN } : {}),
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!response.ok) console.warn("[whatsapp2] webhook HTTP", response.status);
  } catch (error) {
    console.warn("[whatsapp2] webhook:", error?.message || error);
  }
}

function serializeMessage(message) {
  if (!message || isInternalWhatsApp2Message(message)) return null;
  return {
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
    attachment: buildWhatsApp2Attachment(message),
    messageMetadata: buildWhatsApp2MessageMetadata(message),
  };
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
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://100.") ||
    origin.startsWith("http://192.168.") ||
    origin.startsWith("http://10.");
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

function setProfilePicCacheEntry(chatId, url) {
  if (!chatId) return;
  if (profilePicCache.has(chatId)) profilePicCache.delete(chatId);
  profilePicCache.set(chatId, { url: url || null, updatedAt: Date.now() });
  while (profilePicCache.size > MAX_PROFILE_PIC_CACHE) {
    const oldestKey = profilePicCache.keys().next().value;
    if (!oldestKey) break;
    profilePicCache.delete(oldestKey);
  }
}

function invalidateChatSnapshot() {
  chatSnapshotGeneration += 1;
  chatSnapshotCache = null;
  chatSnapshotCacheAt = 0;
  chatSnapshotPending = null;
}

async function getWhatsApp2BlockedChatIds(active = ensureReady()) {
  if (!active?.pupPage) throw new Error("Página do WhatsApp Web indisponível");

  const ids = await active.pupPage.evaluate(() => {
    const collections = window.require("WAWebCollections");
    const blocklist = collections?.Blocklist;
    if (!blocklist?.getModelsArray) {
      throw new Error("Blocklist indisponível nesta versão do WhatsApp Web");
    }
    return blocklist
      .getModelsArray()
      .map((entry) => entry?.id?._serialized || entry?.id?.toString?.() || null)
      .filter(Boolean);
  });

  return new Set(ids.map((id) => String(id)));
}

async function resolveVisibleLastMessage(chat) {
  const last = chat?.lastMessage || null;
  if (!last || !isInternalWhatsApp2Message(last)) return last;

  try {
    const recent = await chat.fetchMessages({ limit: 12 });
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const candidate = recent[index];
      if (candidate && !isInternalWhatsApp2Message(candidate)) return candidate;
    }
  } catch (error) {
    console.warn("[whatsapp2] falha ao resolver última mensagem visível:", error?.message || error);
  }

  return null;
}

async function getRecentChatSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    Array.isArray(chatSnapshotCache) &&
    now - chatSnapshotCacheAt <= CHAT_SNAPSHOT_CACHE_TTL_MS
  ) {
    return chatSnapshotCache;
  }
  if (chatSnapshotPending) return chatSnapshotPending;

  const generation = chatSnapshotGeneration;
  const pending = (async () => {
    const active = ensureReady();
    const [chats, blockedChatIds] = await Promise.all([
      active.getChats(),
      getWhatsApp2BlockedChatIds(active),
    ]);
    const oneWeekAgoSeconds =
      Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    const rows = (await Promise.all(
      chats.map(async (chat) => {
        const id = chat?.id?._serialized || chat?.id?.$1 || null;
        if (!id) return null;

        const visibleLastMessage = await resolveVisibleLastMessage(chat);
        if (chat.lastMessage && isInternalWhatsApp2Message(chat.lastMessage) && !visibleLastMessage && !chat.archived && !chat.isLocked) {
          return null;
        }

        const timestamp = Number(
          visibleLastMessage?.timestamp || chat.timestamp || 0,
        );
        if (timestamp < oneWeekAgoSeconds && !chat.archived && !chat.isLocked) return null;
        return {
          id,
          name: String(chat.name || chat.id?.user || id),
          isGroup: Boolean(chat.isGroup),
          unreadCount: Number(chat.unreadCount || 0),
          timestamp,
          archived: Boolean(chat.archived),
          isLocked: Boolean(chat.isLocked),
          isBlocked: !chat.isGroup && blockedChatIds.has(id),
          pinned: Boolean(chat.pinned),
          lastMessage: serializeMessage(visibleLastMessage),
        };
      }),
    ))
      .filter(Boolean)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const limitedRows = limitChatSnapshot(rows, MAX_CHAT_SNAPSHOT_ROWS);

    if (generation === chatSnapshotGeneration) {
      chatSnapshotCache = limitedRows;
      chatSnapshotCacheAt = Date.now();
    }
    return limitedRows;
  })();

  chatSnapshotPending = pending;
  try {
    return await pending;
  } finally {
    if (chatSnapshotPending === pending) {
      chatSnapshotPending = null;
    }
  }
}

const chatControlSyncPending = new Map();

function syncChatControlState(payload) {
  if (!supabase || !payload?.chatId) return Promise.resolve();
  const previous = chatControlSyncPending.get(payload.chatId) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const id = await resolveCanonicalConversationId(payload.chatId);
    const status = payload.isLocked ? "locked" : payload.archived ? "archived" : "active";
    let query = supabase.from("instagram_conversations").update({ status }).eq("id", id);
    // Desarquivar/destrancar não deve apagar uma restrição independente.
    if (status === "active") query = query.in("status", ["archived", "locked"]);
    const { error } = await query;
    if (error) throw new Error(error.message);
  });
  chatControlSyncPending.set(payload.chatId, pending);
  void pending.finally(() => {
    if (chatControlSyncPending.get(payload.chatId) === pending) chatControlSyncPending.delete(payload.chatId);
  }).catch(() => {});
  return pending;
}

async function ensureChatControlBridge(active = ensureReady()) {
  const page = active.pupPage;
  if (!page) throw new Error("Página do WhatsApp Web indisponível");
  const callbackName = "__vendeoWa2ChatControlEvent";
  if (!await page.evaluate((name) => typeof globalThis[name] === "function", callbackName)) {
    await page.exposeFunction(callbackName, (payload) => {
      if (client !== active || !payload?.chatId) return;
      invalidateChatSnapshot();
      void emitEvent("chat_state_changed", payload);
      void syncChatControlState(payload).catch((error) =>
        console.warn("[whatsapp2] sincronização de controle falhou:", error?.message || error));
    });
  }
  await page.evaluate(() => {
    const chats = window.require("WAWebCollections")?.Chat;
    if (!chats?.on) throw new Error("Eventos de conversa indisponíveis no WhatsApp Web");
    if (globalThis.__vendeoWa2ChatControlStore === chats) return;
    const previous = globalThis.__vendeoWa2ChatControlStore;
    const previousListener = globalThis.__vendeoWa2ChatControlListener;
    if (previous && previousListener) {
      previous.off("change:archive change:isLocked", previousListener);
    }
    const listener = (chat) => {
      const chatId = chat?.id?._serialized || chat?.id?.toString?.();
      if (!chatId) return;
      void globalThis.__vendeoWa2ChatControlEvent({
        chatId,
        archived: Boolean(chat.archive),
        isLocked: Boolean(chat.isLocked),
      }).catch(() => {});
    };
    chats.on("change:archive change:isLocked", listener);
    globalThis.__vendeoWa2ChatControlStore = chats;
    globalThis.__vendeoWa2ChatControlListener = listener;
  });
}

async function setWhatsApp2ChatLockState(chatId, locked) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) throw new Error("chatId obrigatório");

  const active = ensureReady();
  if (!active?.pupPage) throw new Error("Página do WhatsApp Web indisponível");

  const result = await active.pupPage.evaluate(
    async (id, nextLocked) => {
      const collections = window.require("WAWebCollections");
      const action = window.require("WAWebChatLockAction");
      if (
        !collections?.Chat?.find ||
        typeof action?.setChatAsLocked !== "function" ||
        typeof action?.setChatAsUnlocked !== "function"
      ) {
        throw new Error("Chat Lock indisponível nesta versão do WhatsApp Web");
      }

      const chat = await collections.Chat.find(id);
      if (!chat) throw new Error("Conversa não encontrada");

      const currentLocked = Boolean(chat.isLocked);
      if (currentLocked === nextLocked) {
        return { isLocked: currentLocked, changed: false };
      }

      if (nextLocked) {
        await action.setChatAsLocked(chat.id);
      } else {
        await action.setChatAsUnlocked(chat.id);
      }

      const deadline = Date.now() + 3_000;
      let updated = await collections.Chat.find(id);
      while (Boolean(updated?.isLocked) !== nextLocked && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        updated = await collections.Chat.find(id);
      }

      const confirmedLocked = Boolean(updated?.isLocked);
      if (confirmedLocked !== nextLocked) {
        throw new Error(
          nextLocked
            ? "O WhatsApp não confirmou a conversa como trancada"
            : "O WhatsApp não confirmou a conversa como destrancada",
        );
      }

      return {
        isLocked: confirmedLocked,
        changed: true,
      };
    },
    normalizedChatId,
    Boolean(locked),
  );

  invalidateChatSnapshot();
  void emitEvent("chat_lock_changed", {
    chatId: normalizedChatId,
    isLocked: Boolean(result?.isLocked),
  });

  return {
    chatId: normalizedChatId,
    isLocked: Boolean(result?.isLocked),
    changed: Boolean(result?.changed),
  };
}

async function getWhatsApp2ChatControlState(chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) throw new Error("chatId obrigatório");

  const active = ensureReady();
  const chat = await active.getChatById(normalizedChatId);
  if (!chat) throw new Error("Conversa não encontrada");

  const blockedChatIds = chat.isGroup
    ? new Set()
    : await getWhatsApp2BlockedChatIds(active);

  return {
    chatId: normalizedChatId,
    archived: Boolean(chat.archived),
    isLocked: Boolean(chat.isLocked),
    isBlocked: !chat.isGroup && blockedChatIds.has(normalizedChatId),
  };
}

function normalizeResolvedPhoneNumber(value) {
  const digits = String(value || "")
    .replace(/@.*$/, "")
    .replace(/\D+/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function getCachedContactPhone(chatId) {
  const accountId = currentWhatsApp2AccountId() || "account-unknown";
  const key = `${accountId}:${String(chatId || "").trim()}`;
  if (!key) return null;
  const cached = contactPhoneCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > CONTACT_PHONE_CACHE_TTL_MS) {
    contactPhoneCache.delete(key);
    return null;
  }
  contactPhoneCache.delete(key);
  contactPhoneCache.set(key, cached);
  return cached.phoneNumber || null;
}

function cacheContactPhone(chatId, phoneNumber) {
  const accountId = currentWhatsApp2AccountId() || "account-unknown";
  const key = `${accountId}:${String(chatId || "").trim()}`;
  const normalized = normalizeResolvedPhoneNumber(phoneNumber);
  if (!key || !normalized) return;
  if (contactPhoneCache.has(key)) contactPhoneCache.delete(key);
  contactPhoneCache.set(key, {
    phoneNumber: normalized,
    updatedAt: Date.now(),
  });
  while (contactPhoneCache.size > MAX_CONTACT_PHONE_CACHE) {
    const oldestKey = contactPhoneCache.keys().next().value;
    if (!oldestKey) break;
    contactPhoneCache.delete(oldestKey);
  }
}

async function getSavedContactNamesByPhone(active, phoneNumbers) {
  const now = Date.now();
  const accountId = currentWhatsApp2AccountId() || "account-unknown";
  const requested = Array.from(
    new Set(
      (Array.isArray(phoneNumbers) ? phoneNumbers : [])
        .map(normalizeResolvedPhoneNumber)
        .filter(Boolean),
    ),
  );
  const names = new Map();
  const missing = [];

  for (const phone of requested) {
    const cacheKey = `${accountId}:${phone}`;
    const cached = savedContactNamesByPhoneCache.get(cacheKey);
    if (
      cached &&
      now - cached.updatedAt <= SAVED_CONTACT_NAMES_CACHE_TTL_MS
    ) {
      if (cached.savedName) names.set(phone, cached.savedName);
      continue;
    }
    missing.push(phone);
  }

  if (missing.length > 0) {
    await ensureWaJsReady();
    let batch = {};
    try {
      batch = await active.pupPage.evaluate(async (phones) => {
        const wanted = new Set(phones);
        const output = {};
        const wpp = globalThis.WPP;
        const collections = window.require
          ? window.require("WAWebCollections")
          : null;
        const store = wpp?.whatsapp?.ContactStore || collections?.Contact;
        const models =
          store && typeof store.getModelsArray === "function"
            ? store.getModelsArray()
            : [];

        for (const contact of models) {
          if (!contact || !contact.id || contact.isGroup || contact.isMe) continue;
          const phone = String(
            contact.id?.user ||
            contact.number ||
            contact.id?._serialized ||
            contact.id?.$1 ||
            "",
          )
            .replace(/@.*$/, "")
            .replace(/\D+/g, "");
          if (!wanted.has(phone)) continue;

          const savedName = String(
            contact.name ||
            contact.shortName ||
            contact.formattedTitle ||
            contact.pushname ||
            contact.notifyName ||
            "",
          ).trim();
          if (savedName) output[phone] = savedName;
        }
        return output;
      }, missing);
    } catch (error) {
      console.warn(
        "[whatsapp2] nomes salvos dos contatos não puderam ser resolvidos:",
        error?.message || error,
      );
      batch = {};
    }

    const unresolved = missing.filter((phone) => !batch?.[phone]);
    for (let offset = 0; offset < unresolved.length; offset += 10) {
      const chunk = unresolved.slice(offset, offset + 10);
      const contactRows = await Promise.all(
        chunk.map(async (phone) => {
          try {
            const contact = await active.getContactById(`${phone}@c.us`);
            const savedName = String(
              contact?.name ||
              contact?.shortName ||
              contact?.pushname ||
              "",
            ).trim();
            return [phone, savedName || null];
          } catch {
            return [phone, null];
          }
        }),
      );
      for (const [phone, savedName] of contactRows) {
        if (savedName) batch[phone] = savedName;
      }
    }

    for (const phone of missing) {
      const savedName = String(batch?.[phone] || "").trim() || null;
      savedContactNamesByPhoneCache.set(`${accountId}:${phone}`, {
        savedName,
        updatedAt: now,
      });
      if (savedName) names.set(phone, savedName);
    }
  }

  return names;
}

async function getSavedContactNameForChat(chatId) {
  try {
    const identities = await resolveWhatsApp2PhoneNumbers([chatId]);
    return String(identities.find((identity) => identity.chatId === chatId)?.savedName || "").trim() || null;
  } catch {
    return null;
  }
}

async function resolveWhatsApp2PhoneNumbers(chatIds) {
  const requested = Array.from(
    new Set(
      (Array.isArray(chatIds) ? chatIds : [])
        .map((value) => whatsappProviderIdFromConversationId(value))
        .filter(Boolean),
    ),
  ).slice(0, 500);

  const resolved = new Map();
  const lidsToResolve = [];

  for (const chatId of requested) {
    if (chatId.endsWith("@g.us") || chatId === "status@broadcast") {
      resolved.set(chatId, null);
      continue;
    }

    const directNumber = !chatId.endsWith("@lid")
      ? normalizeResolvedPhoneNumber(chatId)
      : null;
    if (directNumber) {
      resolved.set(chatId, directNumber);
      cacheContactPhone(chatId, directNumber);
      continue;
    }

    const cached = getCachedContactPhone(chatId);
    if (cached) {
      resolved.set(chatId, cached);
      continue;
    }

    if (chatId.endsWith("@lid")) lidsToResolve.push(chatId);
    else resolved.set(chatId, null);
  }

  if (lidsToResolve.length > 0) {
    const active = ensureReady();
    await ensureWaJsReady();

    let batch = {};
    try {
      batch = await active.pupPage.evaluate(async (ids) => {
        const output = {};
        for (const id of ids) {
          try {
            const mapping = await globalThis.WPP?.contact?.getPnLidEntry?.(id);
            output[id] = String(mapping?.phoneNumber?._serialized || "");
          } catch {
            output[id] = "";
          }
        }
        return output;
      }, lidsToResolve);
    } catch {
      batch = {};
    }

    for (const chatId of lidsToResolve) {
      const phoneNumber = normalizeResolvedPhoneNumber(batch?.[chatId]);
      resolved.set(chatId, phoneNumber);
      if (phoneNumber) cacheContactPhone(chatId, phoneNumber);
    }
  }

  let savedNamesByPhone = new Map();
  try {
    savedNamesByPhone = await getSavedContactNamesByPhone(
      ensureReady(),
      Array.from(resolved.values()).filter(Boolean),
    );
  } catch {}

  return requested.map((chatId) => {
    const phoneNumber = resolved.get(chatId) || null;
    return {
      chatId,
      phoneNumber,
      savedName: phoneNumber ? savedNamesByPhone.get(phoneNumber) || null : null,
      available: Boolean(phoneNumber),
    };
  });
}

async function getWhatsApp2ExternalChatLink(chatId) {
  const normalizedChatId = whatsappProviderIdFromConversationId(chatId);
  if (!normalizedChatId) throw new Error("chatId obrigatório");

  const active = ensureReady();
  const chat = await active.getChatById(normalizedChatId);
  if (!chat) {
    return {
      chatId: normalizedChatId,
      available: false,
      reason: "chat_not_found",
    };
  }
  if (chat.isGroup) {
    return {
      chatId: normalizedChatId,
      available: false,
      reason: "group_not_supported",
    };
  }

  const [resolved] = await resolveWhatsApp2PhoneNumbers([normalizedChatId]);
  const phoneNumber = resolved?.phoneNumber || null;

  if (!phoneNumber) {
    return {
      chatId: normalizedChatId,
      available: false,
      reason: normalizedChatId.endsWith("@lid")
        ? "lid_phone_unavailable"
        : "phone_unavailable",
    };
  }

  return {
    chatId: normalizedChatId,
    available: true,
    phoneNumber,
    url: `https://wa.me/${phoneNumber}`,
  };
}

async function setWhatsApp2ChatBlockState(chatId, blocked) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) throw new Error("chatId obrigatório");

  const active = ensureReady();
  const chat = await active.getChatById(normalizedChatId);
  if (!chat) throw new Error("Conversa não encontrada");
  if (chat.isGroup) throw new Error("Bloqueio individual não se aplica a grupos");

  const contact = await chat.getContact();
  if (!contact) throw new Error("Contato não encontrado");

  const nextBlocked = Boolean(blocked);
  const currentBlockedIds = await getWhatsApp2BlockedChatIds(active);
  const currentBlocked = currentBlockedIds.has(normalizedChatId);
  if (currentBlocked === nextBlocked) {
    return {
      chatId: normalizedChatId,
      isBlocked: currentBlocked,
      changed: false,
    };
  }

  const result = nextBlocked
    ? await contact.block()
    : await contact.unblock();

  if (result === false) {
    throw new Error(
      nextBlocked
        ? "Não foi possível bloquear o contato"
        : "Não foi possível desbloquear o contato",
    );
  }

  const deadline = Date.now() + 3_000;
  let confirmedBlocked = currentBlocked;
  while (Date.now() < deadline) {
    const blockedIds = await getWhatsApp2BlockedChatIds(active);
    confirmedBlocked = blockedIds.has(normalizedChatId);
    if (confirmedBlocked === nextBlocked) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (confirmedBlocked !== nextBlocked) {
    throw new Error(
      nextBlocked
        ? "O WhatsApp não confirmou o bloqueio do contato"
        : "O WhatsApp não confirmou o desbloqueio do contato",
    );
  }

  invalidateChatSnapshot();
  void emitEvent("chat_block_changed", {
    chatId: normalizedChatId,
    isBlocked: confirmedBlocked,
  });

  return {
    chatId: normalizedChatId,
    isBlocked: confirmedBlocked,
    changed: true,
  };
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
      setProfilePicCacheEntry(chatId, url || null);
      if (url) void persistProfilePic(chatId, url);
      return url || null;
    } catch (error) {
      console.warn("[whatsapp2] foto de perfil indisponível para", chatId, error?.message || error);
      setProfilePicCacheEntry(chatId, null);
      return null;
    } finally {
      profilePicPending.delete(chatId);
    }
  })();

  profilePicPending.set(chatId, pending);
  return pending;
}

function warmProfilePics(chatIds) {
  const queue = chatIds
    .filter((id) => id && !getCachedProfilePic(id) && !profilePicPending.has(id))
    .slice(0, MAX_PROFILE_PIC_WARM_BATCH);
  const workers = Array.from(
    { length: Math.min(PROFILE_PIC_WARM_CONCURRENCY, queue.length) },
    async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      await resolveProfilePic(id);
    }
  });
  void Promise.allSettled(workers);
}

function getGatewayWaJsBundleSource() {
  if (waJsGatewayBundleSource) return waJsGatewayBundleSource;

  const source = fs.readFileSync(WA_JS_BUNDLE, "utf8");
  const massPresencePattern =
    /const e=o\.ChatStore\.map\(e=>e\.presence\.subscribe\(\)\);await Promise\.all\(e\),o\.PresenceStore\.on/;
  const matches = source.match(new RegExp(massPresencePattern.source, "g")) || [];

  if (matches.length !== 1) {
    throw new Error(
      `WA-JS presence guard incompatível: esperado 1 auto-subscribe global, encontrado ${matches.length}`,
    );
  }

  waJsGatewayBundleSource = source.replace(
    massPresencePattern,
    "const e=[];await Promise.all(e),o.PresenceStore.on",
  );
  return waJsGatewayBundleSource;
}

async function ensureWaJsReady() {
  if (waJsReadyPromise) return waJsReadyPromise;
  const active = client;
  if (!active?.pupPage) throw new Error("Página do WhatsApp Web indisponível");

  waJsReadyPromise = (async () => {
    const page = active.pupPage;
    const alreadyReady = await page.evaluate(() => Boolean(globalThis.WPP && globalThis.WPP.isReady));
    if (!alreadyReady) {
      await page.addScriptTag({ content: getGatewayWaJsBundleSource() });
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
  return whatsapp2ConversationIdForAccount(chatId, currentWhatsApp2AccountId());
}

function currentWhatsApp2AccountId() {
  return whatsappAccountIdFromWid(state.me?.wid);
}

async function resolveCanonicalConversationId(chatId) {
  const defaultId = whatsapp2ConversationId(chatId);
  if (!supabase || !chatId) return defaultId;
  const accountId = currentWhatsApp2AccountId();
  if (!accountId) return defaultId;
  const resolvedId = await resolveWhatsApp2CanonicalIdentity({
    chatId,
    resolvePhoneForLid: async (lid) => {
      const resolvedPhones = await resolveWhatsApp2PhoneNumbers([lid]);
      return resolvedPhones.find((row) => row.chatId === lid)?.phoneNumber || null;
    },
    lookupIdentity: async (externalIdentityIds) => {
      const { data, error } = await supabase
        .from("conversation_channel_identities")
        .select("conversation_id")
        .in("channel", ["whatsapp2", "whatsapp"])
        .in("external_identity_id", externalIdentityIds)
        .eq("status", "active")
        .like("conversation_id", `wa2:${accountId}:%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.conversation_id || null;
    },
  });
  return resolvedId
    ? whatsapp2ConversationIdForAccount(
        whatsappProviderIdFromConversationId(resolvedId),
        accountId,
      )
    : defaultId;
}

function mimeExtension(mimeType, fallback = "bin") {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "txt";
  if (mime === "text/csv" || mime.includes("csv")) return "csv";
  if (mime === "application/zip" || mime.includes("zip")) return "zip";
  if (mime.includes("wordprocessingml.document")) return "docx";
  if (mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (mime.includes("presentationml.presentation")) return "pptx";
  return fallback;
}

const WHATSAPP2_INTERNAL_MESSAGE_TYPES = new Set([
  "notification_template",
  "e2e_notification",
  "protocol",
  "ciphertext",
  "debug",
  "notification",
  "group_notification",
  "broadcast_notification",
]);

function isInternalWhatsApp2Message(message) {
  return WHATSAPP2_INTERNAL_MESSAGE_TYPES.has(
    String(message?.type || "").toLowerCase(),
  );
}

function mediaKindForMessage(message) {
  const type = String(message?.type || "").toLowerCase();
  if (type === "ptt" || type === "audio") return "audio";
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "sticker") return "sticker";
  if (type === "document") return "document";
  if (message?.hasMedia) return "unsupported";
  return null;
}

function finiteMediaNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildWhatsApp2Attachment(message, mediaUrl = null) {
  const kind = mediaKindForMessage(message);
  if (!kind) return null;

  const raw = message?._data || {};
  const providerType = String(message?.type || raw?.type || "").trim() || null;
  const mimeType = String(
    message?.mimetype || raw?.mimetype || raw?.mediaData?.mimetype || "",
  ).trim() || null;
  const body = String(message?.body || "").trim();
  const rawFileName = String(
    message?.filename ||
    raw?.filename ||
    (providerType === "document" && body ? body : ""),
  ).trim();
  const fileName = rawFileName
    ? sanitizeAttachmentFilename(rawFileName, "document")
    : null;

  const rawCaption = String(
    message?.caption || raw?.caption || (providerType !== "document" ? body : ""),
  ).trim();
  const caption =
    rawCaption && rawCaption !== fileName
      ? rawCaption
      : null;

  return {
    kind,
    providerType,
    mimeType,
    fileName,
    fileSize: finiteMediaNumber(
      message?.filesize ?? message?.size ?? raw?.size ?? raw?.fileSize ?? raw?.mediaData?.fileSize,
    ),
    mediaUrl: mediaUrl || null,
    caption,
    duration: finiteMediaNumber(message?.duration ?? raw?.duration),
    width: finiteMediaNumber(message?.width ?? raw?.width),
    height: finiteMediaNumber(message?.height ?? raw?.height),
    pageCount: finiteMediaNumber(message?.pageCount ?? raw?.pageCount),
    isGif: Boolean(message?.isGif ?? raw?.isGif),
    isAnimated: Boolean(message?.isAnimated ?? raw?.isAnimated),
    isViewOnce: Boolean(message?.isViewOnce ?? raw?.isViewOnce),
    isForwarded: Boolean(message?.isForwarded ?? raw?.isForwarded),
    forwardingScore: finiteMediaNumber(message?.forwardingScore ?? raw?.forwardingScore),
    downloadable: Boolean(message?.hasMedia),
    previewable: ["audio", "image", "video", "sticker"].includes(kind),
  };
}

function limitedNativeText(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function unescapeVCardValue(value) {
  return String(value ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseWhatsAppVCard(rawCard) {
  const unfolded = String(rawCard || "").replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const result = { name: null, phones: [], emails: [], organization: null };
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).split(";")[0].toUpperCase();
    const value = unescapeVCardValue(line.slice(separator + 1));
    if (!value) continue;
    if (key === "FN" && !result.name) result.name = limitedNativeText(value, 160);
    else if (key === "N" && !result.name) {
      result.name = limitedNativeText(value.split(";").filter(Boolean).reverse().join(" "), 160);
    } else if (key === "TEL" && result.phones.length < 6) result.phones.push(limitedNativeText(value, 80));
    else if (key === "EMAIL" && result.emails.length < 6) result.emails.push(limitedNativeText(value, 160));
    else if (key === "ORG" && !result.organization) result.organization = limitedNativeText(value, 160);
  }
  result.phones = result.phones.filter(Boolean);
  result.emails = result.emails.filter(Boolean);
  return result;
}

function buildWhatsApp2MessageMetadata(message) {
  if (!message) return null;
  const type = String(message.type || "").toLowerCase();
  const raw = message._data || {};
  const metadata = {
    providerType: type || null,
    nativeKind: null,
    isForwarded: Boolean(message.isForwarded ?? raw.isForwarded),
    forwardingScore: finiteMediaNumber(message.forwardingScore ?? raw.forwardingScore),
  };

  const links = Array.isArray(message.links)
    ? message.links.slice(0, 8).map((item) => ({
        url: limitedNativeText(item?.link || item?.url, 600),
        suspicious: Boolean(item?.isSuspicious),
      })).filter((item) => item.url)
    : [];
  if (links.length) metadata.links = links;

  const previewTitle = limitedNativeText(raw.title || raw.linkPreview?.title, 220);
  const previewDescription = limitedNativeText(raw.description || raw.linkPreview?.description, 500);
  const previewUrl = limitedNativeText(raw.canonicalUrl || raw.linkPreview?.canonicalUrl || raw.matchedText, 700);
  if (previewTitle || previewDescription || previewUrl) {
    metadata.linkPreview = {
      title: previewTitle,
      description: previewDescription,
      url: previewUrl,
    };
    if (!metadata.nativeKind && type === "chat") metadata.nativeKind = "link";
  }

  if (type === "vcard" || type === "multi_vcard") {
    metadata.nativeKind = "contact";
    const cards = Array.isArray(message.vCards)
      ? message.vCards
      : Array.isArray(raw.vcardList)
      ? raw.vcardList.map((item) => item?.vcard || item).filter(Boolean)
      : [];
    metadata.contacts = cards.slice(0, 20).map(parseWhatsAppVCard);
  } else if (type === "location") {
    metadata.nativeKind = "location";
    const location = message.location || {};
    metadata.location = {
      latitude: Number.isFinite(Number(location.latitude ?? raw.lat)) ? Number(location.latitude ?? raw.lat) : null,
      longitude: Number.isFinite(Number(location.longitude ?? raw.lng)) ? Number(location.longitude ?? raw.lng) : null,
      name: limitedNativeText(location.name || raw.loc?.split?.("\n")?.[0], 220),
      address: limitedNativeText(location.address || raw.loc?.split?.("\n")?.[1], 320),
      url: limitedNativeText(location.url || raw.clientUrl, 700),
      isLive: Boolean(raw.isLive || raw.isLiveLocation),
      shareDuration: finiteMediaNumber(raw.shareDuration || raw.liveLocationDuration),
    };
  } else if (type === "poll_creation") {
    metadata.nativeKind = "poll";
    metadata.poll = {
      question: limitedNativeText(message.pollName || raw.pollName || message.body, 500),
      options: (Array.isArray(message.pollOptions) ? message.pollOptions : raw.pollOptions || [])
        .slice(0, 20)
        .map((option, index) => ({
          id: Number.isFinite(Number(option?.localId)) ? Number(option.localId) : index,
          name: limitedNativeText(option?.name ?? option, 220),
        }))
        .filter((option) => option.name),
      allowMultipleAnswers: Boolean(message.allowMultipleAnswers ?? raw.allowMultipleAnswers),
      invalidated: Boolean(message.pollInvalidated ?? raw.pollInvalidated),
    };
  } else if (type === "album") {
    metadata.nativeKind = "album";
    metadata.album = {
      expectedItems: finiteMediaNumber(raw.expectedImageCount || raw.albumExpectedCount || raw.expectedCount),
    };
  } else if (type === "call_log") {
    metadata.nativeKind = "call";
    metadata.call = { summary: limitedNativeText(message.body || raw.body || raw.callLog?.type, 220) };
  } else if (type === "groups_v4_invite") {
    metadata.nativeKind = "group_invite";
    metadata.groupInvite = {
      groupName: limitedNativeText(message.inviteV4?.groupName || raw.inviteGrpName, 220),
      expiresAt: finiteMediaNumber(message.inviteV4?.inviteCodeExp || raw.inviteCodeExp),
    };
  } else if (["interactive", "native_flow", "list", "list_response", "buttons_response", "template_button_reply"].includes(type)) {
    metadata.nativeKind = "interactive";
    metadata.interactive = {
      selectedButtonId: limitedNativeText(message.selectedButtonId, 220),
      selectedRowId: limitedNativeText(message.selectedRowId, 220),
    };
  } else if (["order", "product", "payment"].includes(type)) {
    metadata.nativeKind = type;
  } else if (type === "revoked") {
    metadata.nativeKind = "revoked";
  } else if (
    type &&
    type !== "chat" &&
    !["audio", "ptt", "image", "video", "sticker", "document"].includes(type) &&
    !WHATSAPP2_INTERNAL_MESSAGE_TYPES.has(type)
  ) {
    metadata.nativeKind = "unsupported";
  }

  const meaningful = metadata.nativeKind || metadata.isForwarded || metadata.forwardingScore || metadata.links?.length;
  return meaningful ? metadata : null;
}

function nativeMessagePreview(metadata) {
  if (!metadata) return null;
  if (metadata.nativeKind === "contact") {
    const contacts = metadata.contacts || [];
    if (contacts.length === 1) return `👤 Contato: ${contacts[0]?.name || "Contato"}`;
    if (contacts.length > 1) return `👥 ${contacts.length} contatos`;
    return "👤 Contato";
  }
  if (metadata.nativeKind === "location") {
    return `📍 ${metadata.location?.name || metadata.location?.address || "Localização"}`;
  }
  if (metadata.nativeKind === "poll") return `📊 Enquete: ${metadata.poll?.question || "Enquete"}`;
  if (metadata.nativeKind === "album") return "🖼️ Álbum";
  if (metadata.nativeKind === "call") return "📞 Chamada";
  if (metadata.nativeKind === "group_invite") return `👥 Convite: ${metadata.groupInvite?.groupName || "grupo"}`;
  if (metadata.nativeKind === "interactive") return "Mensagem interativa";
  if (metadata.nativeKind === "order") return "Pedido";
  if (metadata.nativeKind === "product") return "Produto";
  if (metadata.nativeKind === "payment") return "Pagamento";
  if (metadata.nativeKind === "revoked") return "Mensagem apagada";
  if (metadata.nativeKind === "unsupported") {
    return `Mensagem do WhatsApp (${metadata.providerType || "tipo desconhecido"})`;
  }
  return null;
}

function mediaPreview(kind, attachment = null) {
  if (kind === "audio") return "🎙️ Mensagem de voz";
  if (kind === "image") return "📷 Foto";
  if (kind === "video") return "🎥 Vídeo";
  if (kind === "sticker") return "Figurinha";
  if (kind === "document") return attachment?.fileName || "Documento";
  if (kind === "unsupported") return attachment?.fileName || "Arquivo";
  return "Mensagem";
}

async function enrichDocumentAttachment(attachment, persisted) {
  if (!persisted?.buffer) return attachment;
  const next = {
    ...(attachment || {}),
    mimeType: persisted.contentType || attachment?.mimeType || null,
    fileSize: Number(persisted.size || persisted.buffer.length || 0) || attachment?.fileSize || null,
  };

  if (isPdfAttachment(next, persisted.contentType, persisted.buffer)) {
    const extracted = await runWithHeavyMediaSlot(() =>
      extractPdfDocument(persisted.buffer),
    );
    return {
      ...next,
      documentKind: "pdf",
      pageCount: extracted.pageCount ?? next.pageCount ?? null,
      documentMetadata: extracted.documentMetadata || null,
      textExtraction: extracted.textExtraction || null,
      documentStructure: extracted.pageCount
        ? { pageCount: extracted.pageCount }
        : null,
    };
  }

  const documentKind = detectDocumentKind(next, persisted.contentType);
  if (!documentKind) return next;

  const extracted = await runWithHeavyMediaSlot(() =>
    extractOfficeDocument(
      persisted.buffer,
      { ...next, documentKind },
      persisted.contentType,
    ),
  );

  return {
    ...next,
    documentKind,
    textExtraction: extracted?.textExtraction || null,
    documentStructure: extracted?.documentStructure || null,
  };
}

async function downloadMessageMediaPayload(messageId) {
  const active = ensureReady();
  await ensureWaJsReady();

  let payload = null;
  let providerFileName = null;
  let declaredProviderSize = null;

  try {
    const providerMessage = await getMessage(messageId);
    const providerAttachment = buildWhatsApp2Attachment(providerMessage);
    providerFileName = providerAttachment?.fileName || null;
    declaredProviderSize = providerAttachment?.fileSize || null;
    assertMediaSizeWithinLimit({
      declaredBytes: declaredProviderSize,
      maxBytes: MAX_MEDIA_BYTES,
    });
  } catch (error) {
    if (error?.code === "WHATSAPP2_MEDIA_TOO_LARGE") throw error;
  }

  try {
    payload = await active.pupPage.evaluate(
      async ({ id, maxBytes, timeoutMs }) => {
        const withTimeout = async (promise, code) => {
          let timer;
          try {
            return await Promise.race([
              promise,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(code)), timeoutMs);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        const blob = await withTimeout(
          globalThis.WPP.chat.downloadMedia(id),
          "whatsapp2_media_download_timeout",
        );
        if (!blob) return null;
        if (Number(blob.size || 0) > maxBytes) {
          return {
            errorCode: "whatsapp2_media_too_large",
            size: Number(blob.size || 0),
            type: blob.type || "application/octet-stream",
          };
        }

        const dataUrl = await withTimeout(
          globalThis.WPP.util.blobToBase64(blob),
          "whatsapp2_media_base64_timeout",
        );
        return {
          dataUrl,
          type: blob.type || "application/octet-stream",
          size: blob.size || 0,
        };
      },
      {
        id: messageId,
        maxBytes: MAX_MEDIA_BYTES,
        timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      },
    );
  } catch (error) {
    const message = String(error?.message || error);
    if (/whatsapp2_media_(?:download|base64)_timeout/i.test(message)) {
      throw error;
    }
    console.warn("[whatsapp2] WA-JS downloadMedia falhou, tentando fallback:", message);
  }

  if (payload?.errorCode === "whatsapp2_media_too_large") {
    assertMediaSizeWithinLimit({
      declaredBytes: payload.size,
      maxBytes: MAX_MEDIA_BYTES,
    });
  }

  if (!payload?.dataUrl) {
    const message = await getMessage(messageId);
    if (!message.hasMedia) throw new Error("Mensagem não possui mídia");
    const fallbackAttachment = buildWhatsApp2Attachment(message);
    providerFileName = providerFileName || fallbackAttachment?.fileName || null;
    declaredProviderSize = declaredProviderSize || fallbackAttachment?.fileSize || null;
    assertMediaSizeWithinLimit({
      declaredBytes: declaredProviderSize,
      maxBytes: MAX_MEDIA_BYTES,
    });

    let timeout;
    const media = await Promise.race([
      message.downloadMedia(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("whatsapp2_media_download_timeout")),
          MEDIA_DOWNLOAD_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    if (!media?.data) throw new Error("Mídia indisponível");
    assertMediaSizeWithinLimit({
      base64: media.data,
      maxBytes: MAX_MEDIA_BYTES,
    });
    payload = {
      dataUrl: `data:${media.mimetype || "application/octet-stream"};base64,${media.data}`,
      type: media.mimetype || "application/octet-stream",
      size: declaredProviderSize || 0,
    };
  }

  const dataUrl = String(payload.dataUrl || "");
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Mídia retornou formato inválido");
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mimeMatch = header.match(/^data:([^;,]+)/i);
  const reportedContentType = normalizeMimeType(
    mimeMatch?.[1] || payload.type || "application/octet-stream",
  );

  assertMediaSizeWithinLimit({
    declaredBytes: payload.size || declaredProviderSize,
    base64,
    maxBytes: MAX_MEDIA_BYTES,
  });

  const buffer = Buffer.from(base64, "base64");
  assertMediaSizeWithinLimit({
    actualBytes: buffer.length,
    maxBytes: MAX_MEDIA_BYTES,
  });

  const contentType = resolveTrustedMimeType(
    reportedContentType,
    buffer,
    providerFileName,
  );

  return {
    buffer,
    contentType,
    reportedContentType,
    size: buffer.length,
    fileName: providerFileName,
  };
}

async function persistWhatsApp2MediaUnlocked(messageId, kind, options = {}) {
  if (!supabase || !messageId || !kind) return null;
  const {
    buffer,
    contentType,
    reportedContentType,
    size,
    fileName,
  } = await downloadMessageMediaPayload(messageId);
  const safeId = String(messageId).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const ext = mimeExtension(contentType, kind === "audio" ? "ogg" : "bin");
  const objectPath = `whatsapp2/${kind}/${safeId}.${ext}`;
  const { error } = await supabase.storage.from("vendeo_vault").upload(objectPath, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("vendeo_vault").getPublicUrl(objectPath);
  const mediaUrl = data?.publicUrl || null;
  const metadata = {
    mediaUrl,
    contentType,
    reportedContentType,
    size: Number(size || buffer.length || 0),
    fileName: fileName || null,
  };
  if (options?.includePayload) {
    return { ...metadata, buffer };
  }
  if (options?.includeMetadata) return metadata;
  return mediaUrl;
}

async function persistWhatsApp2Media(messageId, kind, options = {}) {
  return runWithHeavyMediaSlot(() =>
    persistWhatsApp2MediaUnlocked(messageId, kind, options),
  );
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

async function transcribeStoredAudioJob(messageId, mediaUrl) {
  if (!mediaUrl || !SUPABASE_URL) {
    throw new Error("whatsapp2_transcription_missing_media");
  }

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
    // The downstream path already has 15s download + 30s Groq limits.
    signal: AbortSignal.timeout(50_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data?.error || data?.message || "transcription_failed").slice(0, 500);
    throw new Error(`whatsapp2_transcription_http_${response.status}:${detail}`);
  }

  const transcript = typeof data?.text === "string" ? data.text.trim() : "";
  if (!transcript) {
    throw new Error("whatsapp2_transcription_empty");
  }
  return transcript;
}

async function enqueueWhatsApp2Inbound(message) {
  if (!supabase || !message || message.fromMe) return;
  if (isInternalWhatsApp2Message(message)) return;

  const messageId = message.id?._serialized || message.id?.$1 || null;
  if (!messageId) return;

  const chatId = String(message.from || "").trim();
  if (!chatId || chatId === "status@broadcast" || chatId.endsWith("@g.us")) return;

  const kind = mediaKindForMessage(message);
  const attachment = buildWhatsApp2Attachment(message);
  const messageMetadata = buildWhatsApp2MessageMetadata(message);
  const providerType = String(message.type || "").trim() || null;
  const timestamp = new Date(
    Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000,
  ).toISOString();
  const rawText = String(message.body || "").trim();
  const nativePreview = nativeMessagePreview(messageMetadata);
  const text =
    ["vcard", "multi_vcard", "location", "poll_creation", "album", "call_log"].includes(
      String(message.type || "").toLowerCase(),
    )
      ? nativePreview || rawText
      : rawText;
  const preview = kind
    ? mediaPreview(kind, attachment)
    : nativePreview || text || "Mensagem";
  const accountId = currentWhatsApp2AccountId();
  if (!accountId) throw new Error("whatsapp2_account_identity_unavailable");
  const contactName = String(
    await getSavedContactNameForChat(chatId) ||
    message?._data?.notifyName ||
    message?._data?.sender?.pushname ||
    chatId,
  ).trim() || chatId;

  const canonicalConversationId = await resolveCanonicalConversationId(chatId);

  const { data, error } = await supabase.rpc("enqueue_whatsapp2_inbound_attachment_job_for_account", {
    p_gateway_account_id: accountId,
    p_message_id: messageId,
    p_conversation_id: canonicalConversationId,
    p_raw_contact_id: chatId,
    p_sender_id: String(message.from || chatId),
    p_contact_name: contactName,
    p_message_text: text,
    p_preview_text: preview,
    p_timestamp: timestamp,
    p_media_type: kind,
    p_reply_to_message_id: null,
    p_actionable: kind !== "sticker",
    p_due_at: new Date().toISOString(),
    p_provider_type: providerType,
    p_attachment_metadata: attachment || {},
    p_message_metadata: messageMetadata || {},
  });

  if (error || data?.success !== true) {
    throw error || new Error(data?.reason || "whatsapp2_inbound_enqueue_failed");
  }

  if (state.status === "ready") void processInboundQueue();
  return data;
}

async function waitForCanonicalWhatsApp2Message(conversationId, messageId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  do {
    const { data, error } = await supabase
      .from("instagram_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return true;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);

  return false;
}

async function syncWhatsApp2Message(message) {
  if (!supabase || !message || isInternalWhatsApp2Message(message)) return;
  if (!message.fromMe) return enqueueWhatsApp2Inbound(message);
  const messageId = message.id?._serialized || message.id?.$1 || null;
  if (!messageId) return;

  const chatId = String(message.fromMe ? message.to : message.from || "").trim();
  if (!chatId || chatId === "status@broadcast" || chatId.endsWith("@g.us")) return;

  let chatName = chatId;
  try {
    const chat = await message.getChat();
    chatName = String(chat?.name || chatId);
  } catch {}
  chatName = (await getSavedContactNameForChat(chatId)) || chatName;
  const avatarUrl = await resolveProfilePic(chatId).catch(() => null);
  const timestamp = new Date(Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const replyToMessageId = await resolveQuotedMessageId(message);
  const kind = mediaKindForMessage(message);
  const providerType = String(message.type || "").trim() || null;
  const messageMetadata = buildWhatsApp2MessageMetadata(message);
  let attachment = buildWhatsApp2Attachment(message);
  let mediaUrl = null;
  const rawText = String(message.body || "").trim();
  const nativePreview = nativeMessagePreview(messageMetadata);
  let text =
    ["vcard", "multi_vcard", "location", "poll_creation", "album", "call_log"].includes(
      String(message.type || "").toLowerCase(),
    )
      ? nativePreview || rawText
      : rawText;
  let preview = nativePreview || text || "Mensagem";

  if (kind) {
    try {
      mediaUrl = await persistWhatsApp2Media(messageId, kind);
    } catch (error) {
      console.warn("[whatsapp2] persistência de mídia falhou:", messageId, error?.message || error);
    }
    if (mediaUrl) {
      attachment = {
        ...(attachment || {}),
        kind,
        providerType,
        mediaUrl,
        downloadable: true,
        previewable: ["audio", "image", "video", "sticker"].includes(kind),
      };
    }
    preview = mediaPreview(kind, attachment);
    if (mediaUrl) {
      if (kind === "audio") text = `[audio:${mediaUrl}]`;
      else if (kind === "image") text = `[image:${mediaUrl}]${text ? " " + text : ""}`;
      else if (kind === "video") text = `[video:${mediaUrl}]${text ? " " + text : ""}`;
      else if (kind === "sticker") text = `[sticker:${mediaUrl}]`;
      else if (!text) text = attachment?.fileName || preview;
    } else if (!text) {
      text = preview;
    }
  }

  const conversationId = whatsapp2ConversationId(chatId);
  const { data, error } = await supabase.rpc("record_whatsapp2_outbound_attachment_atomic", {
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
    p_provider_type: providerType,
    p_attachment_metadata: attachment || {},
    p_message_metadata: messageMetadata || {},
  });
  if (error || data?.success !== true) {
    throw error || new Error(data?.reason || "whatsapp2_outbound_sync_failed");
  }
}

async function syncWhatsApp2Ack(message, ack) {
  if (!supabase || !message) return;
  const messageId = message.id?._serialized || message.id?.$1 || null;
  if (!messageId) return;
  const chatId = String(message.to || "").trim();
  if (!chatId) return;
  const conversationId = whatsapp2ConversationId(chatId);
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
    .eq("conversation_id", conversationId)
    .eq("channel", "whatsapp2");

  await supabase
    .from("instagram_conversations")
    .update({
      last_status: status,
      ...(seenAt ? { seen_at: seenAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("channel", "whatsapp2");
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

function serializeWhatsApp2PollVote(vote) {
  if (!vote) return null;
  const parentMessageId =
    vote.parentMessage?.id?._serialized ||
    vote.parentMsgKey?._serialized ||
    vote.parentMsgKey?.toString?.() ||
    null;
  return {
    parentMessageId,
    voter: String(vote.voter || ""),
    selectedOptions: Array.isArray(vote.selectedOptions)
      ? vote.selectedOptions.slice(0, 20).map((option) => ({
          id: finiteMediaNumber(option?.localId ?? option?.id),
          name: limitedNativeText(option?.name, 220),
        })).filter((option) => option.name || option.id !== null)
      : [],
    interactedAt: vote.interractedAtTs
      ? new Date(Number(vote.interractedAtTs)).toISOString()
      : new Date().toISOString(),
  };
}

async function syncWhatsApp2PollVote(vote) {
  if (!supabase || !vote) return;
  const payload = serializeWhatsApp2PollVote(vote);
  if (!payload?.parentMessageId || !payload.voter) return;
  const { error } = await supabase.rpc("apply_whatsapp2_poll_vote_atomic", {
    p_message_id: payload.parentMessageId,
    p_voter: payload.voter,
    p_selected_options: payload.selectedOptions,
    p_interacted_at: payload.interactedAt,
  });
  if (error) console.warn("[whatsapp2] voto de enquete não persistido:", error.message);
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
  const chatId = String(
    before?.fromMe ? before?.to : before?.from || after?.from || after?.to || "",
  ).trim();
  if (!chatId) return;
  try {
    await supabase
      .from("instagram_messages")
      .update({
        text: "Mensagem apagada",
        media_url: null,
        media_type: null,
        provider_type: "revoked",
        attachment_metadata: {},
        message_metadata: { nativeKind: "revoked", providerType: "revoked" },
        audio_transcript: null,
      })
      .eq("id", target)
      .eq("conversation_id", whatsapp2ConversationId(chatId))
      .eq("channel", "whatsapp2");
  } catch {}
}

async function syncChatSnapshots() {
  if (!supabase || state.status !== "ready") return;

  let snapshot = [];
  try {
    snapshot = await getRecentChatSnapshot();
  } catch (error) {
    console.warn("[whatsapp2] snapshot de chats falhou:", error?.message || error);
    return;
  }

  const recentChats = limitChatSnapshot(snapshot.filter((chat) => chat && !chat.isGroup), 500);
  if (!recentChats.length) return;

  let identityByChatId = new Map();
  try {
    const identities = await resolveWhatsApp2PhoneNumbers(
      recentChats.map((chat) => chat.id),
    );
    identityByChatId = new Map(
      identities.map((identity) => [String(identity.chatId), identity]),
    );
  } catch (error) {
    console.warn(
      "[whatsapp2] identidade dos contatos não pôde ser resolvida no snapshot:",
      error?.message || error,
    );
  }

  const conversationIds = recentChats.map((chat) =>
    whatsapp2ConversationId(chat.id),
  );
  const canonicalRows = [];

  for (let offset = 0; offset < conversationIds.length; offset += 100) {
    const ids = conversationIds.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("instagram_conversations")
      .select(
        "id, username, full_name, avatar, avatar_url, contact_id, channel, last_message, last_message_preview, last_message_at, last_direction, last_status, unread, unread_count, status",
      )
      .in("id", ids);

    if (error) {
      console.warn("[whatsapp2] leitura delta do snapshot falhou:", error.message);
      return;
    }
    canonicalRows.push(...(data || []));
  }

  const canonicalById = new Map(
    canonicalRows.map((row) => [String(row.id), row]),
  );
  const now = new Date().toISOString();
  const changedRows = [];

  for (const chat of recentChats) {
    const chatId = String(chat.id || "");
    if (!chatId) continue;

    const id = whatsapp2ConversationId(chatId);
    const existing = canonicalById.get(id) || null;
    const canonicalAvatar = existing?.avatar_url || existing?.avatar || null;
    if (!getCachedProfilePic(chatId) && canonicalAvatar) {
      setProfilePicCacheEntry(chatId, canonicalAvatar);
    }
    const avatar = getCachedProfilePic(chatId) || canonicalAvatar;
    const last = chat.lastMessage || null;
    const gatewayTimestamp = Number(last?.timestamp || chat.timestamp || 0);
    const gatewayAt = gatewayTimestamp > 0
      ? new Date(gatewayTimestamp * 1000).toISOString()
      : null;
    const existingTimestamp = existing?.last_message_at
      ? new Date(existing.last_message_at).getTime()
      : 0;
    const gatewayTimestampMs = gatewayTimestamp > 0
      ? gatewayTimestamp * 1000
      : 0;
    const gatewayIsNewer = Boolean(last) && gatewayTimestampMs > existingTimestamp;
    const sameMessageTime =
      Boolean(last) &&
      gatewayTimestampMs > 0 &&
      Math.abs(gatewayTimestampMs - existingTimestamp) < 1000;
    const gatewayStatus = last?.fromMe
      ? (
          Number(last.ack || 0) >= 3
            ? "seen"
            : Number(last.ack || 0) >= 2
            ? "delivered"
            : "sent"
        )
      : null;
    const preview = formatWhatsApp2PreviewForGateway(last);
    const unreadCount = Number(chat.unreadCount || 0);
    const snapshotAtLeastCurrent = gatewayIsNewer || sameMessageTime || !existing;
    const nextUnreadCount = snapshotAtLeastCurrent
      ? unreadCount
      : Number(existing?.unread_count || 0);
    const nextUnread = snapshotAtLeastCurrent
      ? unreadCount > 0
      : Boolean(existing?.unread);
    const identity = identityByChatId.get(chatId) || null;
    const fullName = String(
      identity?.savedName ||
      chat.name ||
      existing?.full_name ||
      chatId,
    ).trim() || chatId;
    const nextLastMessage = gatewayIsNewer || !existing
      ? preview
      : existing.last_message;
    const nextLastMessagePreview = gatewayIsNewer || !existing
      ? preview
      : existing.last_message_preview;
    const nextLastAt = gatewayIsNewer || !existing
      ? gatewayAt
      : existing.last_message_at;
    const nextLastDirection = gatewayIsNewer || !existing
      ? (last?.fromMe ? "out" : "in")
      : existing.last_direction;
    const nextLastStatus =
      gatewayIsNewer || sameMessageTime || !existing
        ? gatewayStatus
        : existing.last_status;

    const nextStatus = chat.isLocked
      ? "locked"
      : chat.archived
      ? "archived"
      : (existing?.status === "archived" || existing?.status === "locked"
          ? "active"
          : (existing?.status || "active"));

    const row = {
      id,
      username: existing?.username || chatId,
      full_name: fullName,
      avatar: avatar || existing?.avatar || existing?.avatar_url || null,
      avatar_url: avatar || existing?.avatar_url || existing?.avatar || null,
      contact_id: chatId,
      channel: "whatsapp2",
      last_message: nextLastMessage || "",
      last_message_preview: nextLastMessagePreview || "",
      last_message_at: nextLastAt,
      last_direction: nextLastDirection || null,
      last_status: nextLastStatus || null,
      unread: nextUnread,
      unread_count: nextUnreadCount,
      status: nextStatus,
      updated_at: now,
    };

    const changed =
      !existing ||
      String(existing.status || "") !== String(row.status || "") ||
      String(existing.username || "") !== String(row.username || "") ||
      String(existing.full_name || "") !== String(row.full_name || "") ||
      String(existing.avatar || existing.avatar_url || "") !==
        String(row.avatar || row.avatar_url || "") ||
      String(existing.contact_id || "") !== String(row.contact_id || "") ||
      String(existing.channel || "") !== "whatsapp2" ||
      String(existing.last_message || "") !== String(row.last_message || "") ||
      String(existing.last_message_preview || "") !==
        String(row.last_message_preview || "") ||
      String(existing.last_message_at || "") !== String(row.last_message_at || "") ||
      String(existing.last_direction || "") !== String(row.last_direction || "") ||
      String(existing.last_status || "") !== String(row.last_status || "") ||
      Boolean(existing.unread) !== Boolean(row.unread) ||
      Number(existing.unread_count || 0) !== Number(row.unread_count || 0);

    if (changed) changedRows.push(row);
  }

  if (!changedRows.length) return;

  const { error } = await supabase
    .from("instagram_conversations")
    .upsert(changedRows, {
      onConflict: "id",
      ignoreDuplicates: false,
    });
  if (error) {
    console.warn("[whatsapp2] snapshot delta Supabase falhou:", error.message);
  }
}

function formatWhatsApp2PreviewForGateway(message) {
  if (!message) return "";
  const body = String(message.body || "").trim();
  const type = String(message.type || "").toLowerCase();
  const nativePreview = nativeMessagePreview(buildWhatsApp2MessageMetadata(message));
  if (nativePreview) return nativePreview;
  if (type === "document") {
    const attachment = buildWhatsApp2Attachment(message);
    return attachment?.fileName || body || "Documento";
  }
  if (body) return body;
  if (type === "ptt" || type === "audio") return "🎙️ Mensagem de voz";
  if (type === "image") return "📷 Foto";
  if (type === "video") return "🎥 Vídeo";
  if (type === "sticker") return "Figurinha";
  if (message.hasMedia) return buildWhatsApp2Attachment(message)?.fileName || "Arquivo";
  return type ? `[${type}]` : "";
}

async function sendTextInternal({ to, text, replyToMessageId }) {
  return runWithSendSlot(async () => {
    const sent = await withOperationTimeout(
      ensureReady().sendMessage(
        normalizeChatId(to),
        String(text || ""),
        {
          ...(replyToMessageId ? { quotedMessageId: String(replyToMessageId) } : {}),
        },
      ),
      WHATSAPP2_SEND_TIMEOUT_MS,
      "whatsapp2_send_timeout",
    );
    return serializeMessage(sent);
  });
}

async function sendMediaInternalUnlocked({
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
  let sourceBytes = 0;
  const requestedFilename = filename
    ? sanitizeAttachmentFilename(String(filename), "file")
    : null;

  if (mediaUrl) {
    let inferredFilename = requestedFilename;
    if (!inferredFilename) {
      try {
        const parsedUrl = new URL(String(mediaUrl));
        const fromPath = decodeURIComponent(parsedUrl.pathname.split("/").pop() || "");
        inferredFilename = fromPath
          ? sanitizeAttachmentFilename(fromPath, "file")
          : "file";
      } catch {
        inferredFilename = "file";
      }
    }

    let downloaded;
    try {
      downloaded = await downloadHttpMediaBounded(String(mediaUrl), {
        maxBytes: MAX_MEDIA_BYTES,
        fileName: inferredFilename,
      });
    } catch (error) {
      const downloadError = error instanceof Error ? error : new Error(String(error));
      downloadError.deliveryPhase = "before_send";
      throw downloadError;
    }
    sourceBytes = downloaded.size;
    media = new MessageMedia(
      downloaded.contentType,
      downloaded.buffer.toString("base64"),
      inferredFilename,
    );
  } else if (mediaBase64 && mimetype) {
    assertMediaSizeWithinLimit({
      base64: mediaBase64,
      maxBytes: MAX_MEDIA_BYTES,
    });
    const sourceBuffer = Buffer.from(String(mediaBase64), "base64");
    assertMediaSizeWithinLimit({
      actualBytes: sourceBuffer.length,
      maxBytes: MAX_MEDIA_BYTES,
    });
    sourceBytes = sourceBuffer.length;
    const trustedMime = resolveTrustedMimeType(
      mimetype,
      sourceBuffer,
      requestedFilename,
    );
    media = new MessageMedia(
      trustedMime,
      sourceBuffer.toString("base64"),
      requestedFilename || undefined,
    );
  } else {
    throw new Error("Informe mediaUrl ou mediaBase64 + mimetype");
  }

  const active = ensureReady();
  await ensureWaJsReady();

  const chatId = normalizeChatId(to);
  const cleanMime = normalizeMimeType(media.mimetype || "application/octet-stream");
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
  assertMediaSizeWithinLimit({
    base64: media.data,
    maxBytes: MAX_MEDIA_BYTES,
  });
  const dataUrl = `data:${cleanMime};base64,${media.data}`;
  const resolvedFilename = requestedFilename
    || (asVoice
      ? "voice.ogg"
      : sanitizeAttachmentFilename(media.filename || "file", "file"));

  const result = await withOperationTimeout(
    active.pupPage.evaluate(
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
    ),
    WHATSAPP2_SEND_TIMEOUT_MS,
    "whatsapp2_send_timeout",
  );

  const messageId = typeof result?.id === "string"
    ? result.id
    : result?.id?.toString?.() || result?.messageId || null;

  const providerType = asVoice ? "ptt" : type;
  const kind = type === "document" ? "document" : type;
  return {
    id: messageId,
    fromMe: true,
    to: chatId,
    body: caption ? String(caption) : "",
    type: providerType,
    timestamp: Math.floor(Date.now() / 1000),
    hasMedia: true,
    hasQuotedMsg: Boolean(replyToMessageId),
    ack: result?.ack ?? null,
    attachment: {
      kind,
      providerType,
      mimeType: cleanMime || null,
      fileName: resolvedFilename || null,
      fileSize: sourceBytes || null,
      mediaUrl: null,
      caption: caption ? String(caption) : null,
      duration: null,
      width: null,
      height: null,
      pageCount: null,
      isGif: false,
      isAnimated: false,
      isViewOnce: false,
      isForwarded: false,
      forwardingScore: 0,
      downloadable: true,
      previewable: ["audio", "image", "video", "sticker"].includes(kind),
    },
  };
}

async function sendMediaInternal(args) {
  return runWithSendSlot(() =>
    runWithHeavyMediaSlot(() => sendMediaInternalUnlocked(args)),
  );
}

async function processWhatsApp2InboundJob(job, workerToken, accountId) {
  const messageId = String(job?.message_id || "").trim();
  const chatId = String(job?.raw_contact_id || "").trim();
  if (!messageId || !chatId) throw new Error("whatsapp2_inbound_job_invalid");

  let providerMessage = null;
  try {
    providerMessage = await getMessage(messageId);
  } catch {}

  let kind = String(job?.media_type || "").trim() || null;
  if (!kind && providerMessage) kind = mediaKindForMessage(providerMessage);

  const queuedAttachment =
    job?.attachment_metadata && typeof job.attachment_metadata === "object"
      ? job.attachment_metadata
      : null;
  const providerAttachment = providerMessage
    ? buildWhatsApp2Attachment(providerMessage)
    : null;
  let attachment = queuedAttachment || providerAttachment;
  const queuedMessageMetadata =
    job?.message_metadata && typeof job.message_metadata === "object"
      ? job.message_metadata
      : null;
  const providerMessageMetadata = providerMessage
    ? buildWhatsApp2MessageMetadata(providerMessage)
    : null;
  const messageMetadata = queuedMessageMetadata || providerMessageMetadata;
  const providerType =
    String(job?.provider_type || providerMessage?.type || attachment?.providerType || messageMetadata?.providerType || "").trim() ||
    null;

  let text = String(job?.message_text || providerMessage?.body || "").trim();
  let preview = String(job?.preview_text || "").trim() ||
    (kind ? mediaPreview(kind, attachment) : nativeMessagePreview(messageMetadata) || text || "Mensagem");
  let chatName = String(
    await getSavedContactNameForChat(chatId) || job?.contact_name || chatId,
  ).trim() || chatId;
  let replyToMessageId = job?.reply_to_message_id || null;

  if (providerMessage) {
    if (chatName === chatId) {
      try {
        const chat = await providerMessage.getChat();
        chatName = String(chat?.name || chatName);
      } catch {}
    }
    if (!replyToMessageId) {
      replyToMessageId = await resolveQuotedMessageId(providerMessage);
    }
  }

  const avatarUrl = await resolveProfilePic(chatId).catch(() => null);
  let mediaUrl = null;

  if (kind) {
    const persisted = kind === "document"
      ? await persistWhatsApp2Media(messageId, kind, { includePayload: true })
      : await persistWhatsApp2Media(messageId, kind, { includeMetadata: true });
    mediaUrl = typeof persisted === "string" ? persisted : persisted?.mediaUrl || null;
    if (!mediaUrl) throw new Error("whatsapp2_media_persistence_returned_empty");

    attachment = {
      ...(attachment || buildWhatsApp2Attachment(providerMessage || {
        type: providerType,
        hasMedia: true,
        body: text,
      }) || {}),
      kind,
      providerType,
      mimeType: persisted && typeof persisted === "object"
        ? persisted.contentType || attachment?.mimeType || null
        : attachment?.mimeType || null,
      fileSize: persisted && typeof persisted === "object"
        ? Number(persisted.size || 0) || attachment?.fileSize || null
        : attachment?.fileSize || null,
      fileName: attachment?.fileName
        ? sanitizeAttachmentFilename(attachment.fileName, kind === "document" ? "document" : "file")
        : null,
      mediaUrl,
      downloadable: true,
      previewable: ["audio", "image", "video", "sticker"].includes(kind),
    };

    if (kind === "document" && persisted && typeof persisted === "object") {
      attachment = await enrichDocumentAttachment(attachment, persisted);
    }

    preview = mediaPreview(kind, attachment);
    if (kind === "audio") text = `[audio:${mediaUrl}]`;
    else if (kind === "image") text = `[image:${mediaUrl}]${text ? " " + text : ""}`;
    else if (kind === "video") text = `[video:${mediaUrl}]${text ? " " + text : ""}`;
    else if (kind === "sticker") text = `[sticker:${mediaUrl}]`;
    else if (kind === "document") text = attachment?.caption || attachment?.fileName || preview;
    else if (!text) text = attachment?.fileName || preview;
  }

  const conversationId = String(job.conversation_id || await resolveCanonicalConversationId(chatId));

  if (kind === "audio") {
    const { data: staged, error: stageError } = await supabase.rpc(
      "stage_whatsapp2_audio_inbound_attachment_atomic",
      {
        p_conversation_id: conversationId,
        p_raw_contact_id: chatId,
        p_message_id: messageId,
        p_sender_id: String(job.sender_id || chatId),
        p_contact_name: chatName,
        p_text: text || preview,
        p_timestamp: new Date(job.message_timestamp || Date.now()).toISOString(),
        p_preview_text: preview,
        p_avatar_url: avatarUrl,
        p_media_url: mediaUrl,
        p_reply_to_message_id: replyToMessageId,
        p_actionable: job.actionable !== false,
        p_provider_type: providerType,
        p_attachment_metadata: attachment || {},
        p_message_metadata: messageMetadata || {},
      },
    );

    if (stageError || staged?.success !== true || staged?.transcription_queued !== true) {
      throw stageError || new Error(staged?.reason || "whatsapp2_audio_stage_failed");
    }

    const { data: completed, error: completeError } = await supabase.rpc(
      "complete_whatsapp2_inbound_job_for_account",
      {
        p_gateway_account_id: accountId,
        p_message_id: messageId,
        p_worker_token: workerToken,
      },
    );
    if (completeError || completed?.success !== true) {
      throw completeError || new Error(completed?.reason || "whatsapp2_inbound_complete_failed");
    }

    if (state.status === "ready") void processTranscriptionQueue();
    return;
  }

  const { data, error } = await supabase.rpc("ingest_whatsapp2_inbound_attachment_atomic", {
    p_conversation_id: conversationId,
    p_raw_contact_id: chatId,
    p_message_id: messageId,
    p_sender_id: String(job.sender_id || chatId),
    p_contact_name: chatName,
    p_text: text || preview,
    p_timestamp: new Date(job.message_timestamp || Date.now()).toISOString(),
    p_preview_text: preview,
    p_avatar_url: avatarUrl,
    p_media_url: mediaUrl,
    p_media_type: kind,
    p_reply_to_message_id: replyToMessageId,
    p_audio_transcript: null,
    p_audio_transcription_error: null,
    p_actionable: job.actionable !== false && kind !== "sticker",
    p_provider_type: providerType,
    p_attachment_metadata: attachment || {},
    p_message_metadata: messageMetadata || {},
  });

  if (error || data?.success !== true) {
    throw error || new Error(data?.reason || "whatsapp2_inbound_sync_failed");
  }

  const { data: completed, error: completeError } = await supabase.rpc(
    "complete_whatsapp2_inbound_job_for_account",
    {
      p_gateway_account_id: accountId,
      p_message_id: messageId,
      p_worker_token: workerToken,
    },
  );
  if (completeError || completed?.success !== true) {
    throw completeError || new Error(completed?.reason || "whatsapp2_inbound_complete_failed");
  }
}

async function processInboundQueue() {
  if (!supabase || inboundWorkerRunning || state.status !== "ready") return;
  const accountId = currentWhatsApp2AccountId();
  if (!accountId) return;

  const availableSlots = Math.max(
    0,
    WHATSAPP2_INBOUND_CONCURRENCY - inboundJobsInFlight,
  );
  if (availableSlots <= 0) return;

  inboundWorkerRunning = true;
  const workerToken = `${WORKER_ID}:inbound:${Date.now().toString(36)}`;
  let claimedCount = 0;

  try {
    const { data: jobs, error } = await supabase.rpc("claim_whatsapp2_inbound_attachment_jobs_for_account", {
      p_gateway_account_id: accountId,
      p_worker_token: workerToken,
      p_limit: availableSlots,
      p_lease_seconds: 300,
      p_global_limit: WHATSAPP2_INBOUND_CONCURRENCY,
    });
    if (error) throw error;
    claimedCount = Array.isArray(jobs) ? jobs.length : 0;

    for (const job of jobs || []) {
      inboundJobsInFlight += 1;
      void (async () => {
        try {
          await processWhatsApp2InboundJob(job, workerToken, accountId);
        } catch (error) {
          const attempts = Math.max(1, Number(job?.attempt_count || 1));
          const backoffSeconds = Math.min(300, 5 * Math.pow(2, Math.min(attempts - 1, 5)));
          const { data: retry, error: retryError } = await supabase.rpc(
            "reschedule_whatsapp2_inbound_job_for_account",
            {
              p_gateway_account_id: accountId,
              p_message_id: job.message_id,
              p_worker_token: workerToken,
              p_due_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
              p_last_error: String(error?.message || error),
            },
          );

          if (retryError || retry?.success !== true) {
            console.warn(
              "[whatsapp2] inbound retry não persistido:",
              job.message_id,
              retryError?.message || retry?.reason || "unknown",
            );
          } else if (retry?.failed === true) {
            console.warn(
              "[whatsapp2] inbound esgotou tentativas:",
              job.message_id,
              String(error?.message || error),
            );
          }
        } finally {
          inboundJobsInFlight = Math.max(0, inboundJobsInFlight - 1);
          if (state.status === "ready") {
            setImmediate(() => void processInboundQueue());
          }
        }
      })();
    }
  } catch (error) {
    console.warn("[whatsapp2] worker inbound:", error?.message || error);
  } finally {
    inboundWorkerRunning = false;
    if (
      claimedCount > 0 &&
      inboundJobsInFlight < WHATSAPP2_INBOUND_CONCURRENCY &&
      state.status === "ready"
    ) {
      setImmediate(() => void processInboundQueue());
    }
  }
}

function startInboundWorker() {
  if (!supabase || inboundWorkerTimer) return;
  void processInboundQueue();
  // Enqueue dispara processamento imediato; este timer é apenas reconciliação/recovery.
  inboundWorkerTimer = setInterval(() => void processInboundQueue(), 2000);
}

function stopInboundWorker() {
  if (!inboundWorkerTimer) return;
  clearInterval(inboundWorkerTimer);
  inboundWorkerTimer = null;
}

async function processWhatsApp2TranscriptionJob(job, workerToken) {
  const messageId = String(job?.message_id || "").trim();
  const mediaUrl = String(job?.media_url || "").trim();
  if (!messageId || !mediaUrl) throw new Error("whatsapp2_transcription_job_invalid");

  const transcript = await transcribeStoredAudioJob(messageId, mediaUrl);

  const { data, error } = await supabase.rpc("complete_whatsapp2_transcription_job", {
    p_message_id: messageId,
    p_worker_token: workerToken,
    p_transcript: transcript,
  });

  if (error || data?.success !== true) {
    throw error || new Error(data?.reason || "whatsapp2_transcription_complete_failed");
  }
}

async function processTranscriptionQueue() {
  if (!supabase || transcriptionWorkerRunning || state.status !== "ready") return;
  transcriptionWorkerRunning = true;
  const workerToken = `${WORKER_ID}:transcription:${Date.now().toString(36)}`;
  let claimedCount = 0;

  try {
    const { data: jobs, error } = await supabase.rpc(
      "claim_whatsapp2_transcription_jobs",
      {
        p_worker_token: workerToken,
        p_limit: WHATSAPP2_TRANSCRIPTION_CONCURRENCY,
        p_lease_seconds: 120,
        p_global_limit: WHATSAPP2_TRANSCRIPTION_CONCURRENCY,
      },
    );
    if (error) throw error;

    claimedCount = Array.isArray(jobs) ? jobs.length : 0;

    await Promise.all((jobs || []).map(async (job) => {
      try {
        await processWhatsApp2TranscriptionJob(job, workerToken);
      } catch (error) {
        const attempts = Math.max(1, Number(job?.attempt_count || 1));
        const backoffSeconds = Math.min(
          300,
          10 * Math.pow(2, Math.min(attempts - 1, 5)),
        );

        const { data: retry, error: retryError } = await supabase.rpc(
          "reschedule_whatsapp2_transcription_job",
          {
            p_message_id: job.message_id,
            p_worker_token: workerToken,
            p_due_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
            p_last_error: String(error?.message || error),
          },
        );

        if (retryError || retry?.success !== true) {
          console.warn(
            "[whatsapp2] transcription retry não persistido:",
            job.message_id,
            retryError?.message || retry?.reason || "unknown",
          );
        } else if (retry?.failed === true) {
          console.warn(
            "[whatsapp2] transcrição esgotou tentativas:",
            job.message_id,
            String(error?.message || error),
          );
        }
      }
    }));
  } catch (error) {
    console.warn("[whatsapp2] worker de transcrição:", error?.message || error);
  } finally {
    transcriptionWorkerRunning = false;
    if (claimedCount > 0 && state.status === "ready") {
      setImmediate(() => void processTranscriptionQueue());
    }
  }
}

function startTranscriptionWorker() {
  if (!supabase || transcriptionWorkerTimer) return;
  void processTranscriptionQueue();
  // Enqueue acorda o worker; o timer serve somente de recovery/reconciliação.
  transcriptionWorkerTimer = setInterval(() => void processTranscriptionQueue(), 2000);
}

function stopTranscriptionWorker() {
  if (!transcriptionWorkerTimer) return;
  clearInterval(transcriptionWorkerTimer);
  transcriptionWorkerTimer = null;
}

async function finalizeDeliveryJob({
  job,
  success,
  providerMessageId = null,
  errorMessage = null,
  uncertain = false,
}) {
  const completionPayload = {
    p_id: job.id,
    p_worker_id: WORKER_ID,
    p_success: Boolean(success),
    p_provider_message_id: providerMessageId,
    p_error: errorMessage,
    p_uncertain: Boolean(uncertain),
  };

  const { data, error } = await supabase.rpc(
    "complete_whatsapp2_delivery",
    completionPayload,
  );

  if (!error && data?.success === true) {
    return data;
  }

  const status = success ? "sent" : uncertain ? "uncertain" : "failed";
  const nowIso = new Date().toISOString();
  const patch = {
    status,
    last_error: success ? null : String(errorMessage || error?.message || "delivery_failed"),
    updated_at: nowIso,
    ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
    ...((success || !uncertain) ? { completed_at: nowIso } : {}),
  };

  const { data: fallbackRow, error: fallbackError } = await supabase
    .from("whatsapp2_delivery_queue")
    .update(patch)
    .eq("id", job.id)
    .eq("claimed_by", WORKER_ID)
    .in("status", ["sending", "uncertain"])
    .select("id")
    .maybeSingle();

  if (fallbackError || !fallbackRow?.id) {
    throw new Error(
      `whatsapp2_delivery_finalize_failed:${error?.message || data?.reason || "rpc_failed"}:${fallbackError?.message || "row_not_updated"}`,
    );
  }

  console.warn(
    "[whatsapp2] finalize de entrega usou fallback direto:",
    job.id,
    error?.message || data?.reason || "rpc_not_confirmed",
  );
  return { success: true, status, fallback: true };
}

async function processDeliveryQueue() {
  if (!supabase || deliveryWorkerRunning || state.status !== "ready") return;
  const accountId = currentWhatsApp2AccountId();
  if (!accountId) return;
  deliveryWorkerRunning = true;
  let claimedCount = 0;
  try {
    const { data: jobs, error } = await supabase.rpc("claim_whatsapp2_delivery_batch", {
      p_worker_id: WORKER_ID,
      p_limit: WHATSAPP2_DELIVERY_BATCH_LIMIT,
      p_stale_after_seconds: 90,
      p_gateway_account_id: accountId,
    });
    if (error) throw error;
    claimedCount = Array.isArray(jobs) ? jobs.length : 0;

    for (const job of jobs || []) {
      let confirmedProviderMessageId = null;
      try {
        if (Number(job.attempts || 0) > WHATSAPP2_DELIVERY_MAX_ATTEMPTS) {
          await finalizeDeliveryJob({
            job,
            success: false,
            errorMessage: `whatsapp2_delivery_retry_limit:${job.attempts}`,
            uncertain: true,
          });
          continue;
        }

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

        const providerMessageId = typeof sent?.id === "string" ? sent.id.trim() : null;
        if (!providerMessageId) throw new Error("whatsapp2_send_without_provider_id");
        confirmedProviderMessageId = providerMessageId;
        await finalizeDeliveryJob({
          job,
          success: true,
          providerMessageId,
        });
        if (job.save_recipient_contact === true) {
          try {
            await saveRecipientContactForDeliveryJob(job);
          } catch (contactSaveError) {
            console.error(
              "[whatsapp2] falha não bloqueante ao salvar contato após entrega confirmada:",
              job.id,
              contactSaveError?.message || contactSaveError,
            );
          }
        }
      } catch (error) {
        const errorMessage = String(error?.message || error);
        const safeBeforeSend = /^whatsapp2_media_url_/.test(errorMessage) || error?.deliveryPhase === "before_send";
        const uncertain = !safeBeforeSend;
        try {
          await finalizeDeliveryJob({
            job,
            success: Boolean(confirmedProviderMessageId),
            providerMessageId: confirmedProviderMessageId,
            errorMessage: confirmedProviderMessageId ? null : errorMessage,
            uncertain: confirmedProviderMessageId ? false : uncertain,
          });
        } catch (finalizeError) {
          console.warn(
            "[whatsapp2] falha ao finalizar entrega:",
            job.id,
            finalizeError?.message || finalizeError,
          );
        }
      }
    }
  } catch (error) {
    console.warn("[whatsapp2] worker de entrega:", error?.message || error);
  } finally {
    deliveryWorkerRunning = false;
    if (claimedCount > 0 && state.status === "ready") {
      setImmediate(() => void processDeliveryQueue());
    }
  }
}

async function saveRecipientContactForDeliveryJob(job) {
  if (!supabase || !job?.id || !job.recipient_id) return;

  let status = "saved";
  let errorMessage = null;
  try {
    await saveWhatsApp2AddressBookContact({
      client,
      phoneNumber: job.recipient_id,
      contactName: job.recipient_contact_name,
    });
  } catch (error) {
    status = "failed";
    errorMessage = String(error?.message || error).slice(0, 600);
  }

  const { error } = await supabase
    .from("whatsapp2_delivery_queue")
    .update({
      recipient_contact_save_status: status,
      recipient_contact_save_error: errorMessage,
      recipient_contact_saved_at: status === "saved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (error) {
    console.error("[whatsapp2] não foi possível persistir o resultado ao salvar contato:", job.id, error.message || error);
  }
  if (status === "failed") {
    console.warn("[whatsapp2] falha ao salvar contato após entrega confirmada:", job.id, errorMessage);
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

function cancelScheduledReconnect({ resetAttempt = false } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (resetAttempt) reconnectAttempt = 0;
}

function scheduleClientReconnect(reason = "disconnected") {
  if (shuttingDown || reconnectTimer || reconnectInProgress) return;
  if (
    state.status === "auth_failure" ||
    state.status === "awaiting_pairing" ||
    state.status === "pairing_code"
  ) {
    return;
  }

  const backoffIndex = Math.min(
    reconnectAttempt,
    WHATSAPP2_RECONNECT_BACKOFF_MS.length - 1,
  );
  const delayMs = WHATSAPP2_RECONNECT_BACKOFF_MS[backoffIndex];
  reconnectAttempt = Math.min(
    reconnectAttempt + 1,
    WHATSAPP2_RECONNECT_BACKOFF_MS.length - 1,
  );

  console.warn("[whatsapp2] reconexão agendada", {
    reason: String(reason || "disconnected"),
    delayMs,
    attempt: backoffIndex + 1,
  });

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (shuttingDown) return;

    reconnectInProgress = true;
    try {
      setState({ status: "reconnecting" });
      await destroyClient({ cancelReconnect: false });
      if (shuttingDown) return;
      await startClient();
    } catch (error) {
      console.warn("[whatsapp2] reconexão falhou:", error?.message || error);
    } finally {
      reconnectInProgress = false;
      if (
        !shuttingDown &&
        state.status !== "ready" &&
        state.status !== "auth_failure" &&
        state.status !== "awaiting_pairing" &&
        state.status !== "pairing_code"
      ) {
        scheduleClientReconnect("retry");
      }
    }
  }, delayMs);
}

async function destroyClient({ cancelReconnect = true } = {}) {
  if (cancelReconnect) cancelScheduledReconnect();
  invalidateChatSnapshot();
  stopTranscriptionWorker();
  stopInboundWorker();
  stopDeliveryWorker();
  await clearPresenceSubscriptions({ unsubscribe: true });
  presenceBridgePage = null;
  presenceBridgeExposed = false;
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
      cancelScheduledReconnect({ resetAttempt: true });
      const me = next.info ? {
        wid: next.info.wid?._serialized || null,
        pushname: next.info.pushname || null,
        platform: next.info.platform || null,
      } : null;
      invalidateChatSnapshot();
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
      void ensureChatControlBridge(next).catch((error) =>
        console.warn("[whatsapp2] eventos de controle indisponíveis:", error?.message || error));
      console.log("[whatsapp2] pronto", me || "");
      void ensureWaJsReady()
        .then(() => console.log("[whatsapp2] WA-JS pronto para mídia"))
        .catch((error) => console.warn("[whatsapp2] WA-JS não carregou:", error?.message || error));
      startInboundWorker();
      startTranscriptionWorker();
      startDeliveryWorker();
      void syncChatSnapshots();
      if (supabase) {
        console.log("[whatsapp2] ponte Supabase ativa", { workerId: WORKER_ID });
      } else {
        console.warn("[whatsapp2] ponte Supabase desativada: credenciais locais ausentes");
      }
    });
    next.on("auth_failure", async (message) => {
      cancelScheduledReconnect();
      stopTranscriptionWorker();
      stopInboundWorker();
      stopDeliveryWorker();
      await clearPresenceSubscriptions({ unsubscribe: false });
      presenceBridgePage = null;
      presenceBridgeExposed = false;
      setState({ status: "auth_failure", lastError: String(message || "") });
      await emitEvent("auth_failure", { message: String(message || "") });
    });
    next.on("disconnected", async (reason) => {
      stopTranscriptionWorker();
      stopInboundWorker();
      stopDeliveryWorker();
      await clearPresenceSubscriptions({ unsubscribe: false });
      presenceBridgePage = null;
      presenceBridgeExposed = false;
      setState({ status: "disconnected", lastError: String(reason || "") });
      await emitEvent("disconnected", { reason: String(reason || "") });
      if (client === next && !shuttingDown) {
        scheduleClientReconnect(reason || "disconnected");
      }
    });
    next.on("message", (message) => {
      if (isInternalWhatsApp2Message(message)) return;
      invalidateChatSnapshot();
      void emitEvent("message", serializeMessage(message));
      void enqueueWhatsApp2Inbound(message).catch((error) =>
        console.warn("[whatsapp2] inbound enqueue:", error?.message || error));
    });
    next.on("message_create", (message) => {
      if (!message.fromMe || isInternalWhatsApp2Message(message)) return;
      invalidateChatSnapshot();
      void emitEvent("message_create", serializeMessage(message));
      void syncWhatsApp2Message(message).catch((error) =>
        console.warn("[whatsapp2] outbound sync:", error?.message || error));
    });
    next.on("message_ack", (message, ack) => {
      if (isInternalWhatsApp2Message(message)) return;
      invalidateChatSnapshot();
      void emitEvent("message_ack", { message: serializeMessage(message), ack });
      void syncWhatsApp2Ack(message, ack).catch((error) =>
        console.warn("[whatsapp2] ack sync:", error?.message || error));
    });
    next.on("message_revoke_everyone", (after, before) => {
      invalidateChatSnapshot();
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
    next.on("vote_update", (vote) => {
      const payload = serializeWhatsApp2PollVote(vote);
      void emitEvent("vote_update", payload);
      void syncWhatsApp2PollVote(vote).catch((error) =>
        console.warn("[whatsapp2] poll vote sync:", error?.message || error));
    });

    try { await next.initialize(); }
    catch (error) {
      initializing = null;
      setState({ status: "error", lastError: String(error?.message || error) });
      if (client === next && !shuttingDown) {
        scheduleClientReconnect("initialize_error");
      }
      throw error;
    }
  })();
  return initializing;
}async function getMessage(messageId) {
  const message = await ensureReady().getMessageById(String(messageId || ""));
  if (!message) throw new Error("Mensagem não encontrada");
  return message;
}

function presenceTimestampToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function runPresenceOperationExclusive(operation) {
  const run = presenceOperationQueue
    .catch(() => undefined)
    .then(operation);
  presenceOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function presencePayloadSignature(payload) {
  return JSON.stringify([
    Boolean(payload?.available),
    Boolean(payload?.isOnline),
    payload?.lastSeenAt || null,
    payload?.state || null,
    Boolean(payload?.isTyping),
    Boolean(payload?.isRecording),
    payload?.reason || null,
  ]);
}

function prunePresenceSnapshotCache(now = Date.now()) {
  for (const [key, entry] of presenceSnapshotCache) {
    const ephemeralExpired = !entry || entry.expiresAt <= now;
    const lastSeenExpired = !entry?.lastSeenExpiresAt || entry.lastSeenExpiresAt <= now;
    if (ephemeralExpired && lastSeenExpired) presenceSnapshotCache.delete(key);
  }

  while (presenceSnapshotCache.size > MAX_PRESENCE_SNAPSHOT_CACHE) {
    const oldestKey = presenceSnapshotCache.keys().next().value;
    if (oldestKey === undefined) break;
    presenceSnapshotCache.delete(oldestKey);
  }
}

function getCachedPresenceSnapshot(chatId) {
  const key = String(chatId || "").trim();
  if (!key) return null;

  const now = Date.now();
  const entry = presenceSnapshotCache.get(key);
  if (!entry || entry.expiresAt <= now) {
    prunePresenceSnapshotCache(now);
    return null;
  }

  presenceSnapshotCache.delete(key);
  presenceSnapshotCache.set(key, entry);
  return entry.payload;
}

function getCachedPresenceLastSeen(chatId) {
  const key = String(chatId || "").trim();
  if (!key) return null;

  const now = Date.now();
  const entry = presenceSnapshotCache.get(key);
  if (!entry?.lastSeenAt || !entry.lastSeenExpiresAt || entry.lastSeenExpiresAt <= now) {
    return null;
  }
  return entry.lastSeenAt;
}

function cachePresenceSnapshot(chatId, payload) {
  const key = String(chatId || "").trim();
  if (!key || !payload) return { changed: true, payload };

  const now = Date.now();
  const current = presenceSnapshotCache.get(key);
  const previous = current?.expiresAt > now ? current.payload : null;
  const changed = !previous ||
    presencePayloadSignature(previous) !== presencePayloadSignature(payload);

  const privacyDenied = Boolean(payload.reason);
  const hasFreshLastSeen = !privacyDenied && Boolean(payload.lastSeenAt);
  const lastSeenAt = privacyDenied
    ? null
    : hasFreshLastSeen
      ? payload.lastSeenAt
      : (current?.lastSeenExpiresAt > now ? current.lastSeenAt : null);
  const lastSeenExpiresAt = privacyDenied
    ? 0
    : hasFreshLastSeen
      ? now + PRESENCE_LAST_SEEN_TTL_MS
      : (current?.lastSeenExpiresAt > now ? current.lastSeenExpiresAt : 0);

  presenceSnapshotCache.delete(key);
  presenceSnapshotCache.set(key, {
    payload,
    expiresAt: now + PRESENCE_EPHEMERAL_TTL_MS,
    lastSeenAt,
    lastSeenExpiresAt,
  });
  prunePresenceSnapshotCache(now);

  return { changed, payload };
}

async function getContactPresence(chatId) {
  const requestedId = String(chatId || "").trim();
  if (!requestedId) throw new Error("chatId obrigatório");

  const cached = getCachedPresenceSnapshot(requestedId);
  if (cached) {
    return {
      ok: true,
      available: Boolean(cached.available),
      isOnline: Boolean(cached.isOnline),
      lastSeenAt: cached.lastSeenAt || null,
      reason: cached.reason || null,
      cached: true,
    };
  }

  const pending = presenceLookupPending.get(requestedId);
  if (pending) return pending;

  const lookupPromise = (async () => {
    const active = ensureReady();
    await ensureWaJsReady();

    const presence = await runPresenceOperationExclusive(() =>
      active.pupPage.evaluate(async (id) => {
      const wpp = globalThis.WPP;
      if (!wpp?.chat?.getLastSeen || !wpp?.contact?.subscribePresence) {
        return { available: false, reason: "presence_api_unavailable" };
      }

      const watchers = globalThis.__vendeoWa2PresenceWatchers;
      const candidateIds = [id];
      if (wpp.contact.getPnLidEntry && (id.endsWith("@lid") || id.endsWith("@c.us"))) {
        try {
          const mapping = await wpp.contact.getPnLidEntry(id);
          const alternateId = id.endsWith("@lid")
            ? mapping?.phoneNumber?._serialized
            : mapping?.lid?._serialized;
          if (alternateId && !candidateIds.includes(alternateId)) candidateIds.push(alternateId);
        } catch {}
      }

      for (const candidateId of candidateIds) {
        let temporarySubscription = false;
        try {
          const chat = wpp.chat.get(candidateId);
          if (!chat) continue;

          if (!(watchers instanceof Map && watchers.has(candidateId))) {
            await wpp.contact.subscribePresence(candidateId);
            temporarySubscription = true;
          }

          const lastSeen = await wpp.chat.getLastSeen(candidateId);
          const refreshedChat = wpp.chat.get(candidateId);
          const model = refreshedChat?.presence;
          const chatstate = model?.chatstate;

          if (chatstate?.deny === true) {
            return { available: false, reason: "privacy_or_unavailable" };
          }

          const lastSeenValue =
            typeof lastSeen === "number" && Number.isFinite(lastSeen) && lastSeen > 0
              ? lastSeen
              : null;
          const isOnline = Boolean(model?.isOnline);

          if (isOnline || lastSeenValue) {
            return {
              available: true,
              isOnline,
              lastSeen: lastSeenValue,
            };
          }
        } catch {
        } finally {
          if (temporarySubscription && wpp.contact.unsubscribePresence) {
            try { await wpp.contact.unsubscribePresence(candidateId); } catch {}
          }
        }
      }

      return { available: false, reason: "privacy_or_unavailable" };
      }, requestedId),
    );

    const payload = presence?.available
      ? {
          available: true,
          isOnline: Boolean(presence.isOnline),
          lastSeenAt: presenceTimestampToIso(presence.lastSeen),
          reason: null,
        }
      : {
          available: false,
          isOnline: false,
          lastSeenAt: null,
          reason: presence?.reason || "privacy_or_unavailable",
        };

    cachePresenceSnapshot(requestedId, payload);

    return {
      ok: true,
      ...payload,
      cached: false,
    };
  })();

  presenceLookupPending.set(requestedId, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    if (presenceLookupPending.get(requestedId) === lookupPromise) {
      presenceLookupPending.delete(requestedId);
    }
  }
}

function normalizePresenceSubscriptionId(value) {
  const id = String(value || "active-chat").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) {
    throw new Error("subscriptionId inválido");
  }
  return id;
}

function toPresenceEventPayload(scope, raw) {
  const rawState = typeof raw?.state === "string" ? raw.state : "";
  const normalizedState = rawState.toLowerCase();
  const isTyping = normalizedState === "composing" || normalizedState === "typing";
  const isRecording = normalizedState === "recording";
  const lastSeenAt = presenceTimestampToIso(raw?.lastSeen);
  const denied = raw?.deny === true;

  return {
    subscriptionId: scope.subscriptionId,
    chatId: scope.chatId,
    sourceChatId: String(raw?.chatId || ""),
    available: !denied && (Boolean(raw?.isOnline) || Boolean(lastSeenAt) || isTyping || isRecording),
    isOnline: !denied && Boolean(raw?.isOnline),
    lastSeenAt: denied ? null : lastSeenAt,
    state: denied ? null : (rawState || null),
    isTyping: !denied && isTyping,
    isRecording: !denied && isRecording,
    reason: denied ? "privacy_or_unavailable" : null,
    updatedAt: new Date().toISOString(),
  };
}

function handleContactPresenceEvent(raw) {
  const sourceChatId = String(raw?.chatId || "");
  if (!sourceChatId) return;

  for (const scope of presenceSubscriptions.values()) {
    if (!scope.candidateIds.includes(sourceChatId)) continue;

    let payload = toPresenceEventPayload(scope, raw);
    if (!payload.lastSeenAt && !payload.isOnline && !payload.reason) {
      const rememberedLastSeenAt = getCachedPresenceLastSeen(scope.chatId);
      if (rememberedLastSeenAt) {
        payload = {
          ...payload,
          available: true,
          lastSeenAt: rememberedLastSeenAt,
        };
      }
    }

    const cached = cachePresenceSnapshot(scope.chatId, payload);
    if (!cached.changed) continue;

    broadcast("whatsapp2", {
      type: "presence",
      payload,
      at: payload.updatedAt,
    });
  }
}

async function ensurePresenceBridge() {
  const active = ensureReady();
  await ensureWaJsReady();
  const page = active.pupPage;
  if (!page) throw new Error("Página do WhatsApp Web indisponível");

  if (presenceBridgePage !== page) {
    presenceBridgePage = page;
    presenceBridgeExposed = false;
  }

  if (!presenceBridgeExposed) {
    try {
      await page.exposeFunction("__vendeoWa2PresenceEvent", (payload) => {
        handleContactPresenceEvent(payload);
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.toLowerCase().includes("already exists")) throw error;
    }
    presenceBridgeExposed = true;
  }

  return page;
}

async function detachPresenceIds(candidateIds, { unsubscribe = true } = {}) {
  const page = client?.pupPage;
  if (!page || !Array.isArray(candidateIds) || !candidateIds.length) return;

  try {
    await runPresenceOperationExclusive(() =>
      page.evaluate(async ({ candidateIds, unsubscribe }) => {
      const watchers = globalThis.__vendeoWa2PresenceWatchers;
      const wpp = globalThis.WPP;
      if (!(watchers instanceof Map)) return;

      for (const candidateId of candidateIds) {
        const watcher = watchers.get(candidateId);
        if (!watcher) continue;

        watcher.refs = Math.max(0, Number(watcher.refs || 1) - 1);
        if (watcher.refs > 0) continue;

        for (const binding of watcher.bindings || []) {
          try {
            if (typeof binding.target?.off === "function") {
              binding.target.off(binding.event, binding.listener);
            } else if (typeof binding.target?.removeListener === "function") {
              binding.target.removeListener(binding.event, binding.listener);
            }
          } catch {}
        }

        watchers.delete(candidateId);
        if (unsubscribe && wpp?.contact?.unsubscribePresence) {
          try { await wpp.contact.unsubscribePresence(candidateId); } catch {}
        }
      }

      if (
        watchers.size === 0 &&
        globalThis.__vendeoWa2PublicPresenceListener &&
        typeof wpp?.off === "function"
      ) {
        try {
          wpp.off("chat.presence_change", globalThis.__vendeoWa2PublicPresenceListener);
        } catch {}
        globalThis.__vendeoWa2PublicPresenceListener = null;
      }
      }, { candidateIds, unsubscribe }),
    );
  } catch (error) {
    console.warn("[whatsapp2] presence cleanup:", error?.message || error);
  }
}

function nextPresenceSubscriptionVersion(subscriptionId) {
  const next = Number(presenceSubscriptionVersions.get(subscriptionId) || 0) + 1;
  presenceSubscriptionVersions.set(subscriptionId, next);
  return next;
}

async function removePresenceSubscription(subscriptionId, options = {}) {
  const id = normalizePresenceSubscriptionId(subscriptionId);
  const scope = presenceSubscriptions.get(id);
  if (!scope) return { ok: true, unsubscribed: false, subscriptionId: id };

  presenceSubscriptions.delete(id);
  await detachPresenceIds(scope.candidateIds, options);
  return { ok: true, unsubscribed: true, subscriptionId: id, chatId: scope.chatId };
}

async function unsubscribePresenceSubscription(subscriptionId, options = {}) {
  const id = normalizePresenceSubscriptionId(subscriptionId);
  const expectedChatId = String(options.expectedChatId || "").trim();
  const scope = presenceSubscriptions.get(id);
  const pending = presenceSubscriptionPending.get(id);

  if (expectedChatId) {
    if (scope && scope.chatId !== expectedChatId) {
      return {
        ok: true,
        unsubscribed: false,
        stale: true,
        subscriptionId: id,
        chatId: scope.chatId,
      };
    }

    if (!scope && pending?.chatId && pending.chatId !== expectedChatId) {
      return {
        ok: true,
        unsubscribed: false,
        stale: true,
        subscriptionId: id,
        chatId: pending.chatId,
      };
    }
  }

  const newerPendingChat = Boolean(
    expectedChatId &&
    pending?.chatId &&
    pending.chatId !== expectedChatId
  );

  if (!newerPendingChat) {
    nextPresenceSubscriptionVersion(id);
    presenceSubscriptionPending.delete(id);
  }

  if (!scope) {
    return { ok: true, unsubscribed: false, subscriptionId: id };
  }

  return removePresenceSubscription(id, options);
}

async function clearPresenceSubscriptions(options = {}) {
  const ids = new Set([
    ...presenceSubscriptions.keys(),
    ...presenceSubscriptionPending.keys(),
  ]);
  for (const id of ids) nextPresenceSubscriptionVersion(id);

  presenceSubscriptionPending.clear();
  presenceLookupPending.clear();
  presenceSnapshotCache.clear();

  const scopes = Array.from(presenceSubscriptions.values());
  presenceSubscriptions.clear();

  for (const scope of scopes) {
    await detachPresenceIds(scope.candidateIds, options);
  }
}

async function performPresenceSubscription(subscriptionId, chatId, version) {
  const id = normalizePresenceSubscriptionId(subscriptionId);
  const requestedId = String(chatId || "").trim();
  if (!requestedId) throw new Error("chatId obrigatório");
  if (requestedId.endsWith("@g.us") || requestedId === "status@broadcast") {
    throw new Error("Presença individual exige contato, não grupo/status");
  }

  const existing = presenceSubscriptions.get(id);
  if (existing?.chatId === requestedId) {
    return {
      ok: true,
      subscribed: true,
      reused: true,
      subscriptionId: id,
      chatId: requestedId,
      candidateIds: existing.candidateIds,
    };
  }

  if (existing) {
    await removePresenceSubscription(id);
  } else if (presenceSubscriptions.size >= MAX_ACTIVE_PRESENCE_SUBSCRIPTIONS) {
    throw new Error("Limite de subscriptions de presença atingido");
  }

  const page = await ensurePresenceBridge();
  const result = await runPresenceOperationExclusive(() =>
    page.evaluate(async ({ chatId }) => {
    const wpp = globalThis.WPP;
    if (!wpp?.contact?.subscribePresence || !wpp?.chat?.get) {
      return { candidateIds: [], snapshots: [], reason: "presence_api_unavailable" };
    }

    const candidateIds = [chatId];
    if (wpp.contact.getPnLidEntry && (chatId.endsWith("@lid") || chatId.endsWith("@c.us"))) {
      try {
        const mapping = await wpp.contact.getPnLidEntry(chatId);
        const alternateId = chatId.endsWith("@lid")
          ? mapping?.phoneNumber?._serialized
          : mapping?.lid?._serialized;
        if (alternateId && !candidateIds.includes(alternateId)) candidateIds.push(alternateId);
      } catch {}
    }

    const watchers = globalThis.__vendeoWa2PresenceWatchers instanceof Map
      ? globalThis.__vendeoWa2PresenceWatchers
      : new Map();
    globalThis.__vendeoWa2PresenceWatchers = watchers;

    if (!globalThis.__vendeoWa2PublicPresenceListener && typeof wpp.on === "function") {
      const publicListener = (event) => {
        try {
          const candidateId =
            event?.id?._serialized ||
            event?.id?.toString?.() ||
            String(event?.id || "");
          if (!candidateId || !watchers.has(candidateId)) return;

          const model = wpp.chat.get(candidateId)?.presence;
          void globalThis.__vendeoWa2PresenceEvent({
            chatId: candidateId,
            isOnline: event?.isOnline ?? Boolean(model?.isOnline),
            state: typeof event?.state === "string"
              ? event.state
              : (typeof model?.chatstate?.type === "string" ? model.chatstate.type : null),
            lastSeen: Number(model?.chatstate?.t) > 0 ? Number(model.chatstate.t) : null,
            deny: model?.chatstate?.deny === true || event?.isContact === false,
          });
        } catch {}
      };
      wpp.on("chat.presence_change", publicListener);
      globalThis.__vendeoWa2PublicPresenceListener = publicListener;
    }

    const snapshots = [];
    const attachedIds = [];

    const snapshotFor = (candidateId, model) => ({
      chatId: candidateId,
      isOnline: Boolean(model?.isOnline),
      state: typeof model?.chatstate?.type === "string" ? model.chatstate.type : null,
      lastSeen: Number(model?.chatstate?.t) > 0 ? Number(model.chatstate.t) : null,
      deny: model?.chatstate?.deny === true,
    });

    for (const candidateId of candidateIds) {
      const current = watchers.get(candidateId);
      if (current) {
        current.refs = Number(current.refs || 1) + 1;
        attachedIds.push(candidateId);
        snapshots.push(snapshotFor(candidateId, current.model));
        continue;
      }

      try {
        const chat = wpp.chat.get(candidateId);
        if (!chat) continue;

        await wpp.contact.subscribePresence(candidateId);
        const refreshedChat = wpp.chat.get(candidateId);
        const model = refreshedChat?.presence;
        if (!model) continue;

        const bindings = [];
        const emit = () => {
          try {
            void globalThis.__vendeoWa2PresenceEvent(snapshotFor(candidateId, model));
          } catch {}
        };
        const bind = (target, event) => {
          if (!target || typeof target.on !== "function") return;
          target.on(event, emit);
          bindings.push({ target, event, listener: emit });
        };

        bind(model, "change:isOnline");
        bind(model, "change:chatstate");
        bind(model.chatstate, "change:type");
        bind(model.chatstate, "change:t");
        bind(model.chatstate, "change:deny");

        watchers.set(candidateId, {
          refs: 1,
          model,
          bindings,
        });
        attachedIds.push(candidateId);
        snapshots.push(snapshotFor(candidateId, model));
      } catch {}
    }

    return {
      candidateIds: attachedIds,
      snapshots,
      reason: attachedIds.length ? null : "privacy_or_unavailable",
    };
    }, { chatId: requestedId }),
  );

  if (presenceSubscriptionVersions.get(id) !== version) {
    await detachPresenceIds(result?.candidateIds || []);
    return {
      ok: true,
      subscribed: false,
      stale: true,
      subscriptionId: id,
      chatId: requestedId,
    };
  }

  if (!result?.candidateIds?.length) {
    return {
      ok: true,
      subscribed: false,
      available: false,
      subscriptionId: id,
      chatId: requestedId,
      reason: result?.reason || "privacy_or_unavailable",
    };
  }

  const scope = {
    subscriptionId: id,
    chatId: requestedId,
    candidateIds: result.candidateIds,
  };
  presenceSubscriptions.set(id, scope);

  for (const raw of result.snapshots || []) {
    handleContactPresenceEvent(raw);
  }

  return {
    ok: true,
    subscribed: true,
    reused: false,
    subscriptionId: id,
    chatId: requestedId,
    candidateIds: result.candidateIds,
  };
}

async function refreshPresenceSubscription(subscriptionId, chatId) {
  const id = normalizePresenceSubscriptionId(subscriptionId);
  const requestedId = String(chatId || "").trim();
  if (!requestedId) throw new Error("chatId obrigatório");

  const scope = presenceSubscriptions.get(id);
  if (!scope || scope.chatId !== requestedId) return null;

  const page = await ensurePresenceBridge();
  const watchersIntact = await runPresenceOperationExclusive(() =>
    page.evaluate(async (candidateIds) => {
      const wpp = globalThis.WPP;
      const watchers = globalThis.__vendeoWa2PresenceWatchers;
      if (!wpp?.contact?.subscribePresence || !(watchers instanceof Map)) return false;
      if (!candidateIds.every((candidateId) => watchers.has(candidateId))) return false;

      try {
        await wpp.contact.subscribePresence(candidateIds);
        return true;
      } catch {
        return false;
      }
    }, scope.candidateIds),
  );

  if (!watchersIntact) {
    presenceSubscriptions.delete(id);
    await detachPresenceIds(scope.candidateIds, { unsubscribe: true });
    return null;
  }

  return {
    ok: true,
    subscribed: true,
    reused: true,
    refreshed: true,
    subscriptionId: id,
    chatId: requestedId,
    candidateIds: scope.candidateIds,
  };
}

async function subscribePresenceSubscription(subscriptionId, chatId, { refresh = false } = {}) {
  const id = normalizePresenceSubscriptionId(subscriptionId);
  const requestedId = String(chatId || "").trim();
  if (!requestedId) throw new Error("chatId obrigatório");

  const pending = presenceSubscriptionPending.get(id);
  if (pending?.chatId === requestedId) {
    return pending.promise;
  }

  const promise = (async () => {
    if (refresh) {
      const refreshed = await refreshPresenceSubscription(id, requestedId);
      if (refreshed) return refreshed;
    }

    const uniqueSubscriptions = new Set([
      ...presenceSubscriptions.keys(),
      ...presenceSubscriptionPending.keys(),
      id,
    ]);
    if (uniqueSubscriptions.size > MAX_ACTIVE_PRESENCE_SUBSCRIPTIONS) {
      throw new Error("Limite de subscriptions de presença atingido");
    }

    const version = nextPresenceSubscriptionVersion(id);
    return performPresenceSubscription(id, requestedId, version);
  })();

  presenceSubscriptionPending.set(id, {
    chatId: requestedId,
    promise,
  });

  try {
    return await promise;
  } finally {
    const current = presenceSubscriptionPending.get(id);
    if (current?.promise === promise) {
      presenceSubscriptionPending.delete(id);
    }
  }
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
      await clearPresenceSubscriptions({ unsubscribe: true });
      presenceBridgePage = null;
      presenceBridgeExposed = false;
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
      ensureReady();
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit") || 120), 500),
      );
      const includeGroups = url.searchParams.get("includeGroups") === "true";
      const snapshot = await getRecentChatSnapshot();
      const chatRows = limitChatSnapshot(snapshot.filter((chat) => includeGroups || !chat.isGroup), limit);
      let savedNamesByChatId = new Map();
      try {
        const identities = await resolveWhatsApp2PhoneNumbers(chatRows.map((chat) => chat.id));
        savedNamesByChatId = new Map(
          identities.map((identity) => [String(identity.chatId), identity.savedName || null]),
        );
      } catch (error) {
        console.warn("[whatsapp2] nomes de contatos não foram hidratados na lista:", error?.message || error);
      }
      const rows = chatRows.map((chat) => ({
          ...chat,
          savedContactName: savedNamesByChatId.get(String(chat.id)) || null,
          avatarUrl: chat.id ? getCachedProfilePic(chat.id) : null,
        }));
      warmProfilePics(rows.map((chat) => chat.id).filter(Boolean));
      json(res, 200, {
        ok: true,
        chats: rows,
        snapshotAgeMs: Math.max(0, Date.now() - chatSnapshotCacheAt),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/chat/state") {
      const chatId = String(url.searchParams.get("chatId") || "");
      json(res, 200, {
        ok: true,
        ...(await getWhatsApp2ChatControlState(chatId)),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/chat/external-link") {
      const chatId = String(url.searchParams.get("chatId") || "");
      json(res, 200, {
        ok: true,
        ...(await getWhatsApp2ExternalChatLink(chatId)),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/chat/resolve-phones") {
      const body = await readJson(req, 128 * 1024);
      const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : [];
      json(res, 200, {
        ok: true,
        contacts: await resolveWhatsApp2PhoneNumbers(chatIds),
      });
      return;
    }
    if (
      req.method === "POST" &&
      (url.pathname === "/chat/lock" || url.pathname === "/chat/unlock")
    ) {
      const body = await readJson(req, 64 * 1024);
      const result = await setWhatsApp2ChatLockState(
        body.chatId,
        url.pathname === "/chat/lock",
      );
      json(res, 200, { ok: true, ...result });
      return;
    }
    if (
      req.method === "POST" &&
      (url.pathname === "/chat/block" || url.pathname === "/chat/unblock")
    ) {
      const body = await readJson(req, 64 * 1024);
      const result = await setWhatsApp2ChatBlockState(
        body.chatId,
        url.pathname === "/chat/block",
      );
      json(res, 200, { ok: true, ...result });
      return;
    }
    if (req.method === "GET" && url.pathname === "/chat/profile") {
      const chatId = String(url.searchParams.get("chatId") || "");
      if (!chatId) throw new Error("chatId obrigatório");
      const avatarUrl = await resolveProfilePic(chatId);
      json(res, 200, { ok: true, chatId, avatarUrl }); return;
    }
    if (req.method === "GET" && url.pathname === "/chat/presence") {
      const chatId = String(url.searchParams.get("chatId") || "");
      json(res, 200, await getContactPresence(chatId)); return;
    }
    if (req.method === "POST" && url.pathname === "/chat/presence/subscribe") {
      const body = await readJson(req, 64 * 1024);
      json(
        res,
        200,
        await subscribePresenceSubscription(
          body.subscriptionId,
          body.chatId,
          { refresh: body.refresh === true },
        ),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/chat/presence/unsubscribe") {
      const body = await readJson(req, 64 * 1024);
      json(
        res,
        200,
        await unsubscribePresenceSubscription(body.subscriptionId, {
          expectedChatId: body.chatId,
        }),
      );
      return;
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
        .filter((message) => !isInternalWhatsApp2Message(message))
        .map(serializeMessage)
        .filter(Boolean)
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      json(res, 200, { ok: true, chat: { id: chatId, name: chat.name || chatId }, messages: rows }); return;
    }
    if (req.method === "POST" && url.pathname === "/chat/sync-latest-inbound") {
      const active = ensureReady();
      const body = await readJson(req, 64 * 1024);
      const chatId = String(body?.chatId || "").trim();
      const expectedConversationId = String(body?.conversationId || "").trim();
      if (!chatId) throw new Error("chatId obrigatório");
      if (chatId === "status@broadcast" || chatId.endsWith("@g.us")) {
        throw new Error("A sincronização imediata só está disponível em conversas individuais.");
      }

      const chat = await active.getChatById(chatId);
      if (!chat) throw new Error("Conversa não encontrada");
      const conversationId = await resolveCanonicalConversationId(chatId);
      let matchesExpectedConversation = !expectedConversationId
        || expectedConversationId === conversationId
        || expectedConversationId === whatsapp2ConversationId(chatId);
      const accountId = currentWhatsApp2AccountId();
      if (!matchesExpectedConversation && accountId && expectedConversationId.startsWith(`wa2:${accountId}:`)) {
        // A lista pode manter um LID antigo enquanto o provider já usa PN.
        // Só aceita essa diferença quando o próprio WhatsApp confirma o mesmo telefone.
        const expectedChatId = whatsappProviderIdFromConversationId(expectedConversationId);
        const identities = await resolveWhatsApp2PhoneNumbers([chatId, expectedChatId]);
        const currentPhone = identities.find((identity) => identity.chatId === chatId)?.phoneNumber;
        const expectedPhone = identities.find((identity) => identity.chatId === expectedChatId)?.phoneNumber;
        matchesExpectedConversation = Boolean(currentPhone && expectedPhone && currentPhone === expectedPhone);
      }
      if (!matchesExpectedConversation) {
        json(res, 409, {
          ok: false,
          error: "A identidade desta conversa mudou. Atualize a lista do WhatsApp e abra o chat novamente.",
        });
        return;
      }

      const providerMessages = await chat.fetchMessages({ limit: 20 });
      const latestInbound = latestInboundProviderMessage(providerMessages);
      if (!latestInbound) {
        json(res, 200, { ok: true, conversationId, latestInbound: false, persisted: false, reason: "latest_not_inbound" });
        return;
      }

      const messageId = latestInbound.id?._serialized || latestInbound.id?.$1 || null;
      if (!messageId) throw new Error("A mensagem mais recente não tem um identificador válido.");
      const alreadyPersisted = await waitForCanonicalWhatsApp2Message(conversationId, messageId, 0);
      if (alreadyPersisted) {
        json(res, 200, { ok: true, conversationId, latestInbound: true, persisted: true, alreadyPersisted: true });
        return;
      }

      const queueResult = await enqueueWhatsApp2Inbound(latestInbound);
      const persisted = await waitForCanonicalWhatsApp2Message(conversationId, messageId);
      json(res, 200, {
        ok: true,
        conversationId,
        latestInbound: true,
        persisted,
        queued: queueResult?.queued === true,
        reason: persisted ? null : "inbound_sync_pending",
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/message/media") {
      const messageId = String(url.searchParams.get("messageId") || "");
      if (!messageId) throw new Error("messageId obrigatório");

      const { buffer, contentType } = await runWithHeavyMediaSlot(() =>
        downloadMessageMediaPayload(messageId),
      );

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
    if (req.method === "POST" && url.pathname === "/status/text") {
      ensureReady();
      const body = await readJson(req, 64 * 1024);
      const sent = await runWithSendSlot(async () => {
        await ensureWaJsReady();
        return await publishTextStatus({
          client: ensureReady(),
          body,
        });
      });
      json(res, 200, sent); return;
    }
    if (
      req.method === "POST" &&
      (url.pathname === "/status/image" || url.pathname === "/status/media")
    ) {
      ensureReady();
      const body = await readJson(req, 25 * 1024 * 1024);
      const sent = await runWithSendSlot(async () => {
        await ensureWaJsReady();
        return await publishImageStatus({
          client: ensureReady(),
          body,
        });
      });
      json(res, 200, sent); return;
    }
    if (req.method === "POST" && url.pathname === "/status/video") {
      ensureReady();
      const body = await readJson(req, 64 * 1024 * 1024);
      const sent = await runWithSendSlot(async () => {
        await ensureWaJsReady();
        return await publishVideoStatus({
          client: ensureReady(),
          body,
        });
      });
      json(res, 200, sent); return;
    }
    if (req.method === "GET" && url.pathname === "/status/evergreen-recipients") {
      const storyKey = String(url.searchParams.get("storyKey") || "").trim();
      if (!storyKey) {
        json(res, 400, { ok: false, error: "storyKey obrigatório" }); return;
      }
      const recipients = await loadEvergreenStatusRecipients(storyKey);
      json(res, 200, { ok: true, storyKey, recipients, count: recipients.length }); return;
    }
    if (req.method === "POST" && url.pathname === "/status/evergreen-recipients") {
      const body = await readJson(req, 256 * 1024);
      const storyKey = String(body?.storyKey || "").trim();
      if (!storyKey) {
        json(res, 400, { ok: false, error: "storyKey obrigatório" }); return;
      }
      const result = await recordEvergreenStatusRecipients({
        storyKey,
        statusPostId: body?.statusPostId || null,
        recipients: Array.isArray(body?.recipients) ? body.recipients.slice(0, 1000) : [],
      });
      const recipients = await loadEvergreenStatusRecipients(storyKey);
      json(res, 200, {
        ok: true,
        storyKey,
        inserted: result.inserted,
        recipients,
        count: recipients.length,
      }); return;
    }
    if (req.method === "GET" && url.pathname === "/status/privacy") {
      ensureReady();
      await ensureWaJsReady();
      const result = await getStatusPrivacy({
        client: ensureReady(),
      });
      json(res, 200, result); return;
    }
    if (req.method === "POST" && url.pathname === "/status/privacy") {
      ensureReady();
      const body = await readJson(req, 64 * 1024);
      await ensureWaJsReady();
      const result = await setStatusPrivacy({
        client: ensureReady(),
        body,
      });
      json(res, 200, result); return;
    }
    if (req.method === "GET" && url.pathname === "/status/contacts") {
      ensureReady();
      await ensureWaJsReady();
      const search = url.searchParams.get("search") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 300), 1000);
      const result = await getStatusContacts({
        client: ensureReady(),
        search,
        limit,
      });
      json(res, 200, result); return;
    }
    if (req.method === "GET" && url.pathname === "/status/my-status") {
      const active = ensureReady();
      await ensureWaJsReady();
      const page = active.pupPage;
      if (!page) {
        json(res, 503, { ok: false, error: "Página indisponível" }); return;
      }
      const myStatus = await page.evaluate(async () => {
        const wpp = globalThis.WPP;
        if (!wpp || !wpp.isReady || !wpp.status) return null;
        try {
          const res = typeof wpp.status.getMyStatus === "function" ? await wpp.status.getMyStatus() : null;
          return res ? JSON.parse(JSON.stringify(res)) : null;
        } catch (e) {
          return { error: String(e?.message || e) };
        }
      });
      json(res, 200, { ok: true, myStatus }); return;
    }
    if (req.method === "GET" && url.pathname === "/status/debug-failure") {
      const active = ensureReady();
      await ensureWaJsReady();
      const page = active.pupPage;
      const data = await page.evaluate(async () => {
        const wpp = globalThis.WPP;
        const collections = window.require ? window.require("WAWebCollections") : null;
        const msgStore = wpp?.whatsapp?.MsgStore || collections?.Msg;
        const chatStore = wpp?.whatsapp?.ChatStore || collections?.Chat;
        const statusChat = chatStore?.get("status@broadcast");
        
        let msgs = [];
        if (msgStore && typeof msgStore.getModelsArray === "function") {
          msgs = msgStore.getModelsArray()
            .filter((m) => m.to === "status@broadcast" || m.id?.remote === "status@broadcast")
            .slice(-10)
            .map((m) => ({
              id: m.id?._serialized,
              body: m.body,
              ack: m.ack,
              isSendFailure: m.isSendFailure,
              t: m.t,
              sendFailureReason: m.sendFailureReason || m.error || m.failedReason || null,
              pendingAck: m.pendingAck,
              type: m.type,
              broadcastParticipants: m.broadcastParticipants || m.participants || null,
            }));
        }

        let participants = [];
        if (statusChat && statusChat.groupMetadata) {
          participants = statusChat.groupMetadata.participants?.map((p) => p.id?._serialized || String(p.id)) || [];
        }

        let sendTextStatusSource = "";
        let sendRawStatusSource = "";
        let updateParticipantsSource = "";
        try {
          sendTextStatusSource = wpp?.status?.sendTextStatus?.toString() || "";
          sendRawStatusSource = wpp?.status?.sendRawStatus?.toString() || "";
          updateParticipantsSource = wpp?.status?.updateParticipants?.toString() || "";
        } catch (e) {
          sendTextStatusSource = String(e);
        }

        let pendingDetails = [];
        try {
          const collections = window.require ? window.require("WAWebCollections") : null;
          const chatStore = wpp?.whatsapp?.ChatStore || collections?.Chat;
          const statusChat = chatStore?.get("status@broadcast");
          if (statusChat && statusChat.msgs) {
            pendingDetails = statusChat.msgs.map(m => ({
              id: m.id?._serialized,
              body: m.body?.slice?.(0, 30),
              ack: m.ack,
              isSendFailure: m.isSendFailure,
              t: m.t,
              sendMsgResult: m.sendMsgResult,
              pendingAck: m.pendingAck,
              type: m.type,
              error: m.error || m.sendFailureReason || null,
            }));
          }
        } catch (e) {
          pendingDetails = [{ error: String(e) }];
        }


        const userIds = {
          getMaybeMeUser: wpp?.whatsapp?.UserPrefs?.getMaybeMeUser?.()?.toString?.() || null,
          getMaybeMeLidUser: wpp?.whatsapp?.UserPrefs?.getMaybeMeLidUser?.()?.toString?.() || null,
          connWid: wpp?.whatsapp?.Conn?.wid?.toString?.() || null,
          connMeLid: wpp?.whatsapp?.Conn?.meLid?.toString?.() || null,
        };

        let statusModules = [];
        try {
          if (typeof window.require === "function" && window.require.modules) {
            statusModules = Object.keys(window.require.modules).filter(k => k.toLowerCase().includes("status")).slice(0, 30);
          }
        } catch {}

        return {
          statusChatFound: Boolean(statusChat),
          participantsCount: participants.length,
          userIds,
          statusModules,
          pendingDetails,
          sendTextStatusSource: sendTextStatusSource.slice(0, 500),
          sendRawStatusSource: sendRawStatusSource.slice(0, 1000),
          updateParticipantsSource: updateParticipantsSource.slice(0, 1000),
        };





      });
      json(res, 200, { ok: true, data }); return;
    }
    if (req.method === "GET" && url.pathname === "/status/screenshot") {
      const active = ensureReady();
      const page = active.pupPage;

      // 1. Tenta fechar modais com Escape ou clique no X
      try {
        await page.keyboard.press("Escape");
        await new Promise((r) => setTimeout(r, 500));
        await page.evaluate(() => {
          const closeBtn = document.querySelector('div[role="button"][aria-label="Fechar"], button[aria-label="Fechar"], span[data-icon="x"]');
          if (closeBtn) (closeBtn.closest('button, div[role="button"]') || closeBtn).click();
        });
        await new Promise((r) => setTimeout(r, 500));
      } catch {}

      // 2. Tenta clicar no ícone de Status na barra lateral
      const statusClicked = await page.evaluate(() => {
        const statusIcon = document.querySelector('span[data-icon="status-outline"], span[data-icon="status-refreshed"], button[aria-label="Status"], div[aria-label="Status"]');
        if (statusIcon) {
          const btn = statusIcon.closest('button, div[role="button"]') || statusIcon;
          btn.click();
          return true;
        }
        return false;
      });

      // 3. Tenta clicar em "Meu status" para abrir os detalhes
      const clickStatusRes = await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div[role="button"], span, p, h1, h2, h3'));
        const el = divs.find(d => d.innerText && d.innerText.includes("Meu status"));
        if (el) {
          const clickable = el.closest('div[role="button"]') || el;
          clickable.click();
          return { found: true, text: el.innerText };
        }
        return { found: false };
      });

      await new Promise((r) => setTimeout(r, 1200));

      // Extrai os textos visíveis na tela
      const pageTexts = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('h1, h2, h3, span, p, div[role="button"]'));
        return elements
          .map(e => e.innerText?.trim())
          .filter(t => t && t.length > 2 && t.length < 100)
          .slice(0, 40);
      });

      const screenPath = path.join(ROOT, "wa_screenshot.png");
      await page.screenshot({ path: screenPath });
      json(res, 200, { ok: true, statusClicked, clickStatusRes, pageTexts, screenPath }); return;
    }



    if (req.method === "POST" && url.pathname === "/status/test-send") {

      const body = await readJson(req, 64 * 1024);
      const active = ensureReady();
      await ensureWaJsReady();
      const page = active.pupPage;
      const result = await page.evaluate(async (payload) => {
        const wpp = globalThis.WPP;
        const targetNumber = payload.targetNumber || "553196101780@c.us";
        const text = payload.text || "Teste status via test-send";

        const privacyInfo = {};
        try {
          privacyInfo.wppPrivacy = await wpp.privacy.get();
        } catch (e) {
          privacyInfo.wppPrivacyError = String(e?.message || e);
        }

        try {
          privacyInfo.statusPrivacySettingConfig = await wpp.whatsapp?.getStatusPrivacySettingConfig?.();
        } catch (e) {
          privacyInfo.statusPrivacySettingConfigError = String(e?.message || e);
        }

        try {
          privacyInfo.statusList = await wpp.whatsapp?.getStatusList?.();
        } catch (e) {
          privacyInfo.statusListError = String(e?.message || e);
        }

        return {
          ok: true,
          privacyInfo,
        };
      }, body);

      json(res, 200, { ok: true, result }); return;
    }

    if (req.method === "POST" && url.pathname === "/status/eval") {
      const body = await readJson(req, 128 * 1024);
      const active = ensureReady();
      await ensureWaJsReady();
      const page = active.pupPage;
      try {
        const evalRes = await page.evaluate(new Function("return (async () => {" + body.code + "})()"));
        json(res, 200, { ok: true, evalRes });
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) });
      }
      return;
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
      const sent = await sendMediaInternal({
        to: body.to,
        mediaUrl: body.mediaUrl,
        mediaBase64: body.mediaBase64,
        mimetype: body.mimetype,
        filename: body.filename,
        caption: body.caption,
        asVoice: Boolean(body.asVoice),
        asSticker: Boolean(body.asSticker),
        replyToMessageId: body.replyToMessageId,
      });
      json(res, 200, { ok: true, message: sent, provider: "wa-js" });
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
    const errorMessage = String(error?.message || error);
    const statusCode =
      typeof error?.statusCode === "number"
        ? error.statusCode
        : error?.code === "WHATSAPP2_MEDIA_TOO_LARGE" ||
      /(?:media_too_large|Payload grande demais)/i.test(errorMessage)
        ? 413
        : /(?:media_(?:download|base64|url)_timeout|WHATSAPP2_STATUS_TIMEOUT)/i.test(errorMessage)
        ? 504
        : 400;
    json(res, statusCode, {
      ok: false,
      error: errorMessage,
      code: error?.code || null,
    });
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
