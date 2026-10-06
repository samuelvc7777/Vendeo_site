/**
 * WhatsApp 2 Status Service
 *
 * Módulo isolado para orquestrar publicação de Status (Stories) no WhatsApp Web.
 * Não reutiliza endpoints de conversas regulares para evitar confusão de domínio
 * e não polui a caixa de entrada (status@broadcast).
 */

const crypto = require("node:crypto");
const {
  MAX_MEDIA_BYTES,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  normalizeMimeType,
  assertMediaSizeWithinLimit,
  sanitizeAttachmentFilename,
  sniffMimeType,
  resolveTrustedMimeType,
  downloadHttpMediaBounded,
} = require("../media-security.cjs");

const MAX_STATUS_TEXT_LENGTH = 700;
const STATUS_TIMEOUT_MS = 55_000;
const STATUS_MEDIA_TIMEOUT_MS = 45_000;
const MAX_STATUS_CAPTION_LENGTH = 1024;
const IDEMPOTENCY_TTL_MS = 120_000; // 2 minutos
const AUTO_DEDUP_WINDOW_MS = 5_000; // 5 segundos para cliques duplos sem chave explícita

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const {
  transcodeVideoForStatus,
  MAX_STATUS_VIDEO_SECONDS,
} = require("./video-transcoder.cjs");

const STATUS_VIDEO_TIMEOUT_MS = 90_000;
const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/m4v",
]);

const VALID_PRIVACY_TYPES = new Set(["contact", "deny-list", "allow-list"]);

/**
 * Valida o payload de privacidade de status do WhatsApp.
 * Tipos suportados:
 * - "contact" (ou "contacts"): todos os contatos salvos
 * - "deny-list" (ou "blacklist"): meus contatos, exceto a lista
 * - "allow-list" (ou "whitelist"): compartilhar somente com a lista
 */
function validatePrivacyPayload(privacy) {
  if (!privacy) return null;
  if (typeof privacy !== "object") {
    throw new WhatsAppStatusError("WHATSAPP2_INVALID_PRIVACY", "Formato de privacidade inválido.", 400);
  }
  const rawType = String(privacy.type || "").trim().toLowerCase();
  const normalizedType =
    rawType === "contacts" ? "contact" :
    rawType === "blacklist" ? "deny-list" :
    rawType === "whitelist" ? "allow-list" :
    rawType;

  if (!VALID_PRIVACY_TYPES.has(normalizedType)) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_INVALID_PRIVACY_TYPE",
      "Tipo de privacidade inválido. Tipos aceitos: 'contact', 'deny-list', 'allow-list'.",
      400
    );
  }

  const list = Array.isArray(privacy.list)
    ? privacy.list.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if ((normalizedType === "deny-list" || normalizedType === "allow-list") && list.length === 0) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_EMPTY_PRIVACY_LIST",
      `A lista de contatos não pode estar vazia para o tipo '${normalizedType}'.`,
      400
    );
  }

  return {
    type: normalizedType,
    list,
  };
}

// Cache de privacidade em memória para consistência
let memoryPrivacyState = {
  type: "contact",
  list: [],
  count: 0,
};

/**
 * Aplica a configuração de privacidade no WhatsApp Web via WPP.privacy e WPP.status.updateParticipants.
 */
async function applyStatusPrivacy(page, { type, list }) {
  if (!page) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
      "Página do WhatsApp Web não disponível para aplicar a privacidade do Status.",
      503,
    );
  }

  let result;
  try {
    result = await page.evaluate(async ({ type, list }) => {
      const wpp = globalThis.WPP;
      if (!wpp || !wpp.isReady) {
        return { ok: false, error: "WPP_NOT_READY" };
      }

      let prefs;
      let widFactory;
      try {
        prefs = window.require?.("WAWebUserPrefsStatus");
        widFactory = window.require?.("WAWebWidFactory");
      } catch (err) {
        return {
          ok: false,
          error: "STATUS_NATIVE_MODULE_UNAVAILABLE",
          detail: String(err?.message || err),
        };
      }

      if (
        !prefs
        || typeof prefs.setStatusPrivacyConfig !== "function"
        || typeof prefs.getStatusPrivacySettingConfig !== "function"
        || !widFactory
        || typeof widFactory.createWid !== "function"
      ) {
        return { ok: false, error: "STATUS_NATIVE_PRIVACY_UNAVAILABLE" };
      }

      const serializeId = (value) => {
        if (!value) return "";
        if (typeof value === "string") return value;
        return value?._serialized
          || value?.id?._serialized
          || value?.id
          || value?.toString?.()
          || String(value);
      };

      const normalizeType = (value) => {
        const raw = String(value || "contact").toLowerCase();
        if (raw === "contacts") return "contact";
        if (raw === "blacklist") return "deny-list";
        if (raw === "whitelist") return "allow-list";
        return raw;
      };

      const resolveNativeStatusIds = async (values) => {
        const resolved = [];
        for (const value of (values || [])) {
          let idStr = serializeId(value).trim();
          if (!idStr) continue;

          // O WhatsApp atual persiste a privacidade de Status preferencialmente em LID.
          // Converte números @c.us para o LID correspondente quando a conta já usa LID.
          if (idStr.endsWith("@c.us") && wpp.contact && typeof wpp.contact.getPnLidEntry === "function") {
            try {
              const mapping = await wpp.contact.getPnLidEntry(idStr);
              const lid = mapping?.lid?._serialized || mapping?.lid?.toString?.();
              if (lid) idStr = lid;
            } catch {}
          }

          resolved.push(idStr);
        }
        return Array.from(new Set(resolved)).sort();
      };

      const resolvePhoneIds = async (values) => {
        const resolved = [];
        for (const value of (values || [])) {
          let idStr = serializeId(value).trim();
          if (!idStr) continue;

          if (idStr.endsWith("@lid") && wpp.contact && typeof wpp.contact.getPnLidEntry === "function") {
            try {
              const mapping = await wpp.contact.getPnLidEntry(idStr);
              const pn = mapping?.phoneNumber?._serialized || mapping?.phoneNumber?.user;
              if (pn) idStr = pn.includes("@") ? pn : `${pn}@c.us`;
            } catch {}
          }

          resolved.push(idStr);
        }
        return Array.from(new Set(resolved)).sort();
      };

      const expectedType = normalizeType(type);
      const expectedNativeList = expectedType === "contact"
        ? []
        : await resolveNativeStatusIds(list);

      if (
        (expectedType === "allow-list" || expectedType === "deny-list")
        && expectedNativeList.length === 0
      ) {
        return { ok: false, error: "STATUS_EMPTY_PRIVACY_LIST" };
      }

      let widList;
      try {
        widList = expectedNativeList.map((id) => widFactory.createWid(id));
      } catch (err) {
        return {
          ok: false,
          error: "STATUS_INVALID_PARTICIPANT_ID",
          detail: String(err?.message || err),
        };
      }

      try {
        await prefs.setStatusPrivacyConfig({
          setting: expectedType,
          list: widList,
        });
      } catch (err) {
        return {
          ok: false,
          error: "STATUS_PRIVACY_APPLY_FAILED",
          detail: String(err?.message || err),
        };
      }

      if (!wpp.status || typeof wpp.status.updateParticipants !== "function") {
        return { ok: false, error: "STATUS_PARTICIPANTS_UNAVAILABLE" };
      }

      try {
        if (expectedType === "contact") {
          await wpp.status.updateParticipants(null);
        } else if (expectedType === "allow-list") {
          await wpp.status.updateParticipants(expectedNativeList);
        } else {
          const allRaw = typeof prefs.getStatusContacts === "function"
            ? await prefs.getStatusContacts()
            : [];
          const allNative = await resolveNativeStatusIds(allRaw);
          const denySet = new Set(expectedNativeList);
          const allowed = allNative.filter((id) => !denySet.has(id));
          await wpp.status.updateParticipants(allowed);
        }
      } catch (err) {
        return {
          ok: false,
          error: "STATUS_PARTICIPANTS_APPLY_FAILED",
          detail: String(err?.message || err),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      let observed;
      try {
        observed = await prefs.getStatusPrivacySettingConfig();
      } catch (err) {
        return {
          ok: false,
          error: "STATUS_PRIVACY_READBACK_FAILED",
          detail: String(err?.message || err),
        };
      }

      const observedType = normalizeType(
        observed?.setting || observed?.type || observed?.value || "contact",
      );
      const observedRaw = observedType === "allow-list"
        ? observed?.allowList
        : observedType === "deny-list"
        ? observed?.denyList
        : [];
      const observedNativeList = await resolveNativeStatusIds(
        Array.isArray(observedRaw)
          ? observedRaw
          : Array.isArray(observed?.list)
          ? observed.list
          : [],
      );

      const sameType = observedType === expectedType;
      const sameList = expectedType === "contact"
        || (
          observedNativeList.length === expectedNativeList.length
          && observedNativeList.every((id, index) => id === expectedNativeList[index])
        );

      const publicList = await resolvePhoneIds(observedNativeList);
      const expectedPublicList = await resolvePhoneIds(expectedNativeList);

      return {
        ok: sameType && sameList,
        type: observedType,
        list: publicList,
        nativeList: observedNativeList,
        count: publicList.length,
        expectedType,
        expectedList: expectedPublicList,
        expectedNativeList,
        configuredVia: "WAWebUserPrefsStatus.setStatusPrivacyConfig",
        readVia: "WAWebUserPrefsStatus.getStatusPrivacySettingConfig",
        error: sameType && sameList ? null : "STATUS_PRIVACY_NOT_CONFIRMED",
      };
    }, { type, list });
  } catch (err) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_PRIVACY_FAILED",
      `Falha ao aplicar privacidade do Status no WhatsApp: ${String(err?.message || err)}`,
      502,
    );
  }

  if (!result?.ok) {
    console.warn("[whatsapp2] privacidade de Status não confirmada:", result);
    const detail = result?.detail || result?.error || "erro desconhecido";
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_PRIVACY_NOT_CONFIRMED",
      `O WhatsApp não confirmou o público selecionado para o Status (${detail}). A publicação foi bloqueada por segurança.`,
      409,
    );
  }

  memoryPrivacyState = {
    type: result.type,
    list: Array.isArray(result.list) ? result.list : [],
    count: Array.isArray(result.list) ? result.list.length : 0,
  };

  return result;
}

/**
 * Consulta a configuração atual de privacidade de status da conta.
 */
async function getStatusPrivacy({ client }) {
  if (!client) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_NOT_READY",
      "Cliente do WhatsApp não está conectado.",
      503,
    );
  }
  const page = client.pupPage;
  if (!page) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
      "Página do WhatsApp Web não disponível.",
      503,
    );
  }

  try {
    const pageResult = await page.evaluate(async () => {
      const wpp = globalThis.WPP;
      if (!wpp || !wpp.isReady) return null;

      let prefs;
      try {
        prefs = window.require?.("WAWebUserPrefsStatus");
      } catch {
        return null;
      }
      if (!prefs || typeof prefs.getStatusPrivacySettingConfig !== "function") {
        return null;
      }

      const serializeId = (value) => {
        if (!value) return "";
        if (typeof value === "string") return value;
        return value?._serialized
          || value?.id?._serialized
          || value?.id
          || value?.toString?.()
          || String(value);
      };

      const normalizeType = (value) => {
        const raw = String(value || "contact").toLowerCase();
        if (raw === "contacts") return "contact";
        if (raw === "blacklist") return "deny-list";
        if (raw === "whitelist") return "allow-list";
        return raw;
      };

      const resolvePhoneIds = async (values) => {
        const resolved = [];
        for (const value of (values || [])) {
          let idStr = serializeId(value).trim();
          if (!idStr) continue;

          if (idStr.endsWith("@lid") && wpp.contact && typeof wpp.contact.getPnLidEntry === "function") {
            try {
              const mapping = await wpp.contact.getPnLidEntry(idStr);
              const pn = mapping?.phoneNumber?._serialized || mapping?.phoneNumber?.user;
              if (pn) idStr = pn.includes("@") ? pn : `${pn}@c.us`;
            } catch {}
          }

          resolved.push(idStr);
        }
        return Array.from(new Set(resolved)).sort();
      };

      const statusPrivacy = await prefs.getStatusPrivacySettingConfig();
      const type = normalizeType(
        statusPrivacy?.setting || statusPrivacy?.type || statusPrivacy?.value || "contact",
      );
      const rawList = type === "allow-list"
        ? statusPrivacy?.allowList
        : type === "deny-list"
        ? statusPrivacy?.denyList
        : [];
      const nativeList = Array.isArray(rawList)
        ? rawList.map(serializeId).filter(Boolean).sort()
        : [];
      const list = await resolvePhoneIds(nativeList);

      return {
        ok: true,
        verified: true,
        source: "WAWebUserPrefsStatus.getStatusPrivacySettingConfig",
        type,
        list,
        nativeList,
        count: list.length,
      };
    });

    if (pageResult?.ok) {
      memoryPrivacyState = {
        type: pageResult.type,
        list: pageResult.list,
        count: pageResult.count,
      };
      return pageResult;
    }
  } catch (err) {
    console.warn("[whatsapp2] getStatusPrivacy leitura real falhou:", err?.message || err);
  }

  return {
    ok: true,
    verified: false,
    source: "memory",
    type: memoryPrivacyState.type || "contact",
    list: Array.isArray(memoryPrivacyState.list) ? memoryPrivacyState.list : [],
    count: Array.isArray(memoryPrivacyState.list) ? memoryPrivacyState.list.length : 0,
  };
}

/**
 * Define e persiste a configuração de privacidade de status da conta.
 * Só retorna sucesso quando o WhatsApp confirma a configuração aplicada.
 */
async function setStatusPrivacy({ client, body }) {
  if (!client) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_NOT_READY",
      "Cliente do WhatsApp não está conectado.",
      503,
    );
  }
  const page = client.pupPage;
  if (!page) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
      "Página do WhatsApp Web não disponível.",
      503,
    );
  }

  const validated = validatePrivacyPayload(body);
  if (!validated) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_INVALID_PRIVACY",
      "Payload de privacidade obrigatório.",
      400,
    );
  }

  return await applyStatusPrivacy(page, validated);
}

/**
 * Retorna contatos para seleção na interface de audiência de Status.
 * Agrega contatos da agenda e conversas recentes ativas para máxima cobertura.
 */
async function getStatusContacts({ client, search = "", limit = 300 }) {
  if (!client) throw new WhatsAppStatusError("WHATSAPP2_STATUS_NOT_READY", "Cliente do WhatsApp não está conectado.", 503);
  const page = client.pupPage;
  if (!page) throw new WhatsAppStatusError("WHATSAPP2_STATUS_PAGE_UNAVAILABLE", "Página do WhatsApp Web não disponível.", 503);

  const cleanSearch = String(search || "").toLowerCase().trim();
  const contactsMap = new Map();

  // 1. Tenta buscar contatos via whatsapp-web.js client.getContacts()
  try {
    if (typeof client.getContacts === "function") {
      const rawContacts = await client.getContacts();
      if (Array.isArray(rawContacts)) {
        for (const c of rawContacts) {
          if (!c || !c.id) continue;
          const id = c.id._serialized || c.id.$1 || String(c.id);
          if (c.isMe || c.isGroup || id.includes("@g.us") || id.includes("@newsletter") || c.isBlocked) continue;

          const name = String(c.name || c.pushname || c.shortName || id.replace(/@.*$/, "")).trim();
          const number = String(c.number || c.id.user || id.replace(/@.*$/, "")).trim();
          const isMyContact = Boolean(c.isMyContact);

          contactsMap.set(id, {
            id,
            name: name || number,
            number,
            avatarUrl: null,
            isMyContact,
          });
        }
      }
    }
  } catch (err) {
    console.warn("[whatsapp2] client.getContacts avisou:", err?.message || err);
  }

  // 2. Tenta complementar com chats recentes via client.getChats()
  try {
    if (typeof client.getChats === "function") {
      const rawChats = await client.getChats();
      if (Array.isArray(rawChats)) {
        for (const chat of rawChats) {
          if (!chat || !chat.id) continue;
          const id = chat.id._serialized || chat.id.$1 || String(chat.id);
          if (chat.isGroup || id.includes("@g.us") || id.includes("@newsletter")) continue;

          const name = String(chat.name || chat.id.user || id.replace(/@.*$/, "")).trim();
          const number = String(chat.id.user || id.replace(/@.*$/, "")).trim();

          const existing = contactsMap.get(id);
          if (existing) {
            if (!existing.name || existing.name === existing.number) {
              existing.name = name || number;
            }
          } else {
            contactsMap.set(id, {
              id,
              name: name || number,
              number,
              avatarUrl: null,
              isMyContact: false,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[whatsapp2] client.getChats avisou:", err?.message || err);
  }

  // 3. Complementa com page.evaluate
  try {
    const pageRows = await page.evaluate(async ({ search, limit }) => {
      const wpp = globalThis.WPP;
      if (!wpp || !wpp.isReady) return [];

      const collections = window.require ? window.require("WAWebCollections") : null;
      const store = wpp.whatsapp?.ContactStore || collections?.Contact;
      let models = [];
      if (store && typeof store.getModelsArray === "function") {
        models = store.getModelsArray();
      } else if (wpp.contact && typeof wpp.contact.list === "function") {
        try {
          models = await wpp.contact.list();
        } catch {
          models = [];
        }
      }

      const myWid = wpp.whatsapp?.UserPrefs?.getMaybeMeUser?.()?.toString?.() || "";
      const rows = [];
      for (const c of models) {
        if (!c || !c.id) continue;
        const id = c.id?._serialized || c.id?.$1 || String(c.id);
        if (c.isMe || id === myWid) continue;
        if (c.isGroup || id.includes("@g.us") || id.includes("@newsletter")) continue;
        if (c.isContactBlocked) continue;

        const name = String(c.name || c.pushname || c.formattedTitle || c.notifyName || id.replace(/@.*$/, "")).trim();
        const number = String(c.id?.user || id.replace(/@.*$/, "")).trim();
        const avatarUrl = c.profilePicThumbObj?.imgFull || c.profilePicThumbObj?.img || null;
        const isMyContact = Boolean(c.isMyContact);

        rows.push({
          id,
          name: name || number,
          number,
          avatarUrl,
          isMyContact,
        });
      }
      return rows;
    }, { search, limit });

    if (Array.isArray(pageRows)) {
      for (const r of pageRows) {
        const existing = contactsMap.get(r.id);
        if (existing) {
          if (r.avatarUrl) existing.avatarUrl = r.avatarUrl;
          if (r.isMyContact) existing.isMyContact = true;
          if (r.name && (!existing.name || existing.name === existing.number)) {
            existing.name = r.name;
          }
        } else {
          contactsMap.set(r.id, r);
        }
      }
    }
  } catch (err) {
    console.warn("[whatsapp2] page.evaluate getStatusContacts avisou:", err?.message || err);
  }

  // 4. Resolve LIDs para @c.us garantindo que o WhatsApp reconheça os números em status@broadcast
  const lidsToResolve = Array.from(contactsMap.keys()).filter((k) => k.endsWith("@lid"));
  if (lidsToResolve.length > 0) {
    try {
      const resolvedMappings = await page.evaluate(async (lids) => {
        const wpp = globalThis.WPP;
        if (!wpp || !wpp.contact || typeof wpp.contact.getPnLidEntry !== "function") return {};
        const map = {};
        for (const lid of lids) {
          try {
            const entry = await wpp.contact.getPnLidEntry(lid);
            const pn = entry?.phoneNumber?._serialized || entry?.phoneNumber?.user;
            if (pn) {
              map[lid] = pn.includes("@") ? pn : `${pn}@c.us`;
            }
          } catch {}
        }
        return map;
      }, lidsToResolve.slice(0, 150));

      for (const [lid, phoneJid] of Object.entries(resolvedMappings)) {
        if (!phoneJid) continue;
        const oldEntry = contactsMap.get(lid);
        if (oldEntry) {
          contactsMap.delete(lid);
          const rawNum = phoneJid.replace(/@.*$/, "");
          contactsMap.set(phoneJid, {
            ...oldEntry,
            id: phoneJid,
            number: oldEntry.number && !oldEntry.number.includes("@lid") ? oldEntry.number : rawNum,
          });
        }
      }
    } catch (err) {
      console.warn("[whatsapp2] Erro na resolução de LIDs em getStatusContacts:", err?.message || err);
    }
  }

  let list = Array.from(contactsMap.values());

  if (cleanSearch) {
    list = list.filter((c) => {
      const matchName = c.name && c.name.toLowerCase().includes(cleanSearch);
      const matchNum = c.number && c.number.includes(cleanSearch);
      return matchName || matchNum;
    });
  }

  list.sort((a, b) => {
    if (a.isMyContact && !b.isMyContact) return -1;
    if (!a.isMyContact && b.isMyContact) return 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const sliced = list.slice(0, limit);

  return {
    ok: true,
    contacts: sliced,
    total: sliced.length,
  };
}

/**
 * Cache de idempotência em memória.
 * Chave: idempotencyKey ou hash do payload
 * Valor: { state: "in_flight" | "completed", result?: object, createdAt: number }
 */
const idempotencyCache = new Map();

function cleanStaleIdempotencyEntries() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

/**
 * Cria uma classe de erro tipada para o domínio de Status
 */
class WhatsAppStatusError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "WhatsAppStatusError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Valida o payload de publicação de status de texto.
 */
function validateTextStatusPayload(body) {
  if (!body || typeof body !== "object") {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_PAYLOAD",
      "Payload inválido para publicação de status.",
      400,
    );
  }

  const rawText = typeof body.text === "string" ? body.text : "";
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_EMPTY_TEXT",
      "O texto do status não pode ser vazio.",
      400,
    );
  }

  if (trimmed.length > MAX_STATUS_TEXT_LENGTH) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_TEXT_TOO_LONG",
      `O texto do status excede o limite máximo de ${MAX_STATUS_TEXT_LENGTH} caracteres (atual: ${trimmed.length}).`,
      400,
    );
  }

  let backgroundColor = undefined;
  if (body.backgroundColor !== undefined && body.backgroundColor !== null) {
    if (typeof body.backgroundColor === "number") {
      backgroundColor = body.backgroundColor;
    } else if (typeof body.backgroundColor === "string") {
      const hexClean = body.backgroundColor.trim().replace(/^#/, "");
      if (!/^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(hexClean)) {
        throw new WhatsAppStatusError(
          "WHATSAPP2_STATUS_INVALID_COLOR",
          "Cor de fundo inválida. Utilize formato hexadecimal (ex: #00A884 ou #128C7E).",
          400,
        );
      }
      backgroundColor = `#${hexClean}`;
    } else {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_INVALID_COLOR",
        "Formato de cor de fundo inválido.",
        400,
      );
    }
  }

  let font = 0;
  if (body.font !== undefined && body.font !== null) {
    const parsedFont = Number(body.font);
    if (!Number.isInteger(parsedFont) || parsedFont < 0 || parsedFont > 5) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_INVALID_FONT",
        "Fonte inválida. O valor deve ser um número inteiro de 0 a 5.",
        400,
      );
    }
    font = parsedFont;
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim().slice(0, 128)
    : null;

  const privacy = body.privacy ? validatePrivacyPayload(body.privacy) : null;

  return {
    text: trimmed,
    backgroundColor,
    font,
    idempotencyKey,
    privacy,
  };
}

/**
 * Gera chave de idempotência segura para deduplicação automática
 */
function resolveEffectiveIdempotencyKey(validated) {
  if (validated.idempotencyKey) {
    return `custom:${validated.idempotencyKey}`;
  }
  const hash = crypto
    .createHash("sha256")
    .update(`${validated.text}|${validated.backgroundColor || ""}|${validated.font}`)
    .digest("hex");
  return `auto:${hash}`;
}

/**
 * Publica um status de texto através do Puppeteer e @wppconnect/wa-js injetado.
 */
async function publishTextStatus({ client, body, timeoutMs = STATUS_TIMEOUT_MS }) {
  cleanStaleIdempotencyEntries();

  const validated = validateTextStatusPayload(body);
  const cacheKey = resolveEffectiveIdempotencyKey(validated);
  const existing = idempotencyCache.get(cacheKey);

  if (existing) {
    if (existing.state === "in_flight") {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_IN_FLIGHT",
        "Esta publicação de status já está em processamento.",
        409,
      );
    }
    if (existing.state === "completed" && existing.result) {
      const isAutoKey = cacheKey.startsWith("auto:");
      const maxAge = isAutoKey ? AUTO_DEDUP_WINDOW_MS : IDEMPOTENCY_TTL_MS;
      if (Date.now() - existing.createdAt < maxAge) {
        return {
          ...existing.result,
          cached: true,
        };
      }
    }
  }

  // Registra em andamento para evitar cliques duplos simultâneos
  idempotencyCache.set(cacheKey, {
    state: "in_flight",
    createdAt: Date.now(),
  });

  try {
    if (!client) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "Cliente do WhatsApp não está conectado.",
        503,
      );
    }

    const page = client.pupPage;
    if (!page) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
        "Página do WhatsApp Web não disponível no momento.",
        503,
      );
    }

    if (validated.privacy) {
      await applyStatusPrivacy(page, validated.privacy);
    }

    const sendPromise = page.evaluate(
      async ({ text, backgroundColor, font }) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const wpp = globalThis.WPP;
        if (!wpp || !wpp.isReady) {
          throw new Error("WPP_NOT_READY");
        }
        if (!wpp.status || typeof wpp.status.getMyStatus !== "function") {
          throw new Error("WPP_STATUS_UNAVAILABLE");
        }

        const toArray = (status) => {
          const source = status?.statusMsgs || status?.msgs || [];
          if (Array.isArray(source)) return source;
          if (source && typeof source.getModelsArray === "function") return source.getModelsArray();
          if (Array.isArray(source?.models)) return source.models;
          return [];
        };
        const messageId = (msg) =>
          msg?.id?._serialized || msg?.id?.id || (msg?.id ? String(msg.id) : "");

        const beforeStatus = await wpp.status.getMyStatus().catch(() => null);
        const beforeIds = new Set(toArray(beforeStatus).map(messageId).filter(Boolean));
        const startedAt = Math.floor(Date.now() / 1000) - 2;

        // Fecha editor/menu de status anterior se houver.
        const closeBtn = document.querySelector(
          'button[aria-label="Fechar janela de post de status"], button[aria-label="Fechar"]',
        );
        if (closeBtn) {
          closeBtn.click();
          await sleep(250);
        }

        // Abre a aba nativa de Status.
        let addBtn = document.querySelector(
          'button[aria-label="Add Status"], div[role="button"][aria-label="Add Status"]',
        );
        if (!addBtn) {
          const statusTab = document.querySelector(
            'button[aria-label="Status"], div[aria-label="Status"], span[data-icon="status-outline"]',
          );
          if (!statusTab) throw new Error("STATUS_NATIVE_TAB_NOT_FOUND");
          (statusTab.closest('button, div[role="button"]') || statusTab).click();
          await sleep(700);
          addBtn = document.querySelector(
            'button[aria-label="Add Status"], div[role="button"][aria-label="Add Status"]',
          );
        }
        if (!addBtn) throw new Error("STATUS_NATIVE_ADD_NOT_FOUND");

        // Snapshot visual do último Status antes da nova publicação. O painel
        // nativo atualiza este card antes do cache de getMyStatus() em alguns
        // builds do WhatsApp Web.
        const beforeStatusHeader = document.querySelector('button[data-testid="status-header"]');
        const beforeStatusHeaderHtml = beforeStatusHeader?.outerHTML || "";
        const beforeStatusHeaderText = (beforeStatusHeader?.innerText || "").trim();

        // Abre o compositor nativo de texto.
        let textBtn = document.querySelector('button[aria-label="Texto"][role="menuitem"]');
        if (!textBtn) {
          addBtn.click();
          await sleep(450);
          textBtn = document.querySelector('button[aria-label="Texto"][role="menuitem"]');
        }
        if (!textBtn) throw new Error("STATUS_NATIVE_TEXT_NOT_FOUND");

        textBtn.click();
        await sleep(800);

        const editable = document.querySelector(
          'div[contenteditable="true"][role="textbox"], div[role="textbox"]',
        );
        if (!editable) throw new Error("STATUS_NATIVE_EDITOR_NOT_FOUND");

        editable.focus();

        // O editor do WhatsApp é Lexical e pode reter um rascunho de uma
        // tentativa anterior. Selecionamos explicitamente apenas o conteúdo
        // do editor antes de inserir, em vez de depender de selectAll global.
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("insertText", false, text);

        if (typeof font === "number" && font > 0) {
          const fontBtn = document.querySelector('button[aria-label="Fonte"]');
          for (let i = 0; i < font; i += 1) {
            if (!fontBtn) break;
            fontBtn.click();
            await sleep(100);
          }
        }

        await sleep(350);
        const sendBtn = document.querySelector(
          'button[aria-label="Enviar"], div[role="button"][aria-label="Enviar"]',
        );
        if (!sendBtn) throw new Error("STATUS_NATIVE_SEND_NOT_FOUND");
        sendBtn.click();

        // Confirma no próprio store do WhatsApp que surgiu uma NOVA publicação
        // e que ela não foi marcada como falha. Não usamos mais o retorno otimista
        // do wrapper do WPP como prova de entrega.
        let candidate = null;
        let nativeUiStableMatches = 0;
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await sleep(500);
          const currentStatus = await wpp.status.getMyStatus().catch(() => null);
          const messages = toArray(currentStatus);
          const fresh = messages
            .filter((msg) => {
              const id = messageId(msg);
              const timestamp = Number(msg?.t || 0);
              return id && !beforeIds.has(id) && timestamp >= startedAt;
            })
            .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0));

          candidate =
            fresh.find((msg) => String(msg?.body || "") === text)
            || fresh[fresh.length - 1]
            || null;

          if (candidate?.isSendFailure === true) {
            throw new Error("STATUS_NATIVE_SEND_FAILURE");
          }
          if (candidate && Number(candidate.ack || 0) > 0) {
            return {
              id: messageId(candidate),
              ack: Number(candidate.ack || 0),
              nativeUI: true,
              confirmedVia: "status-store",
              isSendFailure: false,
              participant: candidate?.id?.participant?._serialized || candidate?.id?.participant || null,
              author: candidate?.author?._serialized || candidate?.author || null,
            };
          }

          // Fallback nativo: em algumas versões o card "Meu status" atualiza
          // vários segundos/minutos antes do cache do WPP. Exigimos:
          // - compositor fechado;
          // - card realmente mudou;
          // - novo card contém exatamente o texto publicado;
          // - condição estável por 5s, dando tempo para uma falha aparecer no store.
          const composerStillOpen = Boolean(
            document.querySelector('button[aria-label="Fechar janela de post de status"]'),
          );
          const statusHeader = document.querySelector('button[data-testid="status-header"]');
          const headerHtml = statusHeader?.outerHTML || "";
          const headerText = (statusHeader?.innerText || "").trim();
          const headerChanged =
            Boolean(statusHeader)
            && headerHtml !== beforeStatusHeaderHtml
            && headerText !== beforeStatusHeaderText;
          const headerMatchesText =
            headerText === text
            || headerText.startsWith(`${text}\n`)
            || headerText.includes(`\n${text}\n`);

          if (!composerStillOpen && headerChanged && headerMatchesText) {
            nativeUiStableMatches += 1;
          } else {
            nativeUiStableMatches = 0;
          }

          if (nativeUiStableMatches >= 10) {
            return {
              id: null,
              ack: 0,
              nativeUI: true,
              confirmedVia: "native-status-header",
              pendingStoreConfirmation: true,
              isSendFailure: false,
              participant: null,
              author: null,
            };
          }
        }

        if (candidate?.isSendFailure === true) throw new Error("STATUS_NATIVE_SEND_FAILURE");
        if (candidate && Number(candidate.ack || 0) <= 0) {
          throw new Error("STATUS_NATIVE_ACK_NOT_CONFIRMED");
        }
        throw new Error("STATUS_NATIVE_NOT_CREATED");
      },
      {
        text: validated.text,
        backgroundColor: validated.backgroundColor,
        font: validated.font,
      },
    );

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new WhatsAppStatusError(
            "WHATSAPP2_STATUS_TIMEOUT",
            `Tempo limite de ${timeoutMs / 1000}s excedido ao aguardar confirmação do status pelo WhatsApp.`,
            504,
          ),
        );
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });

    const sendResult = await Promise.race([sendPromise, timeoutPromise]);

    const statusId = typeof sendResult?.id === "string"
      ? sendResult.id
      : sendResult?.id?._serialized || sendResult?.id?.id || (sendResult?.id ? String(sendResult.id) : null);

    const ack = typeof sendResult?.ack === "number" ? sendResult.ack : 1;

    const finalResponse = {
      ok: true,
      id: statusId,
      ack,
      status: "sent",
      type: "text",
      text: validated.text,
      backgroundColor: validated.backgroundColor || null,
      font: validated.font,
      publishedAt: new Date().toISOString(),
    };

    idempotencyCache.set(cacheKey, {
      state: "completed",
      result: finalResponse,
      createdAt: Date.now(),
    });

    return finalResponse;
  } catch (error) {
    idempotencyCache.delete(cacheKey);

    if (error instanceof WhatsAppStatusError) {
      throw error;
    }

    const message = String(error?.message || error);
    if (message.includes("WPP_NOT_READY")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "A biblioteca de controle do WhatsApp Web ainda está iniciando. Tente novamente em instantes.",
        503,
      );
    }
    if (message.includes("WPP_STATUS_UNAVAILABLE")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_UNSUPPORTED",
        "A versão atual do WhatsApp Web carregada não possui suporte a publicação de status.",
        501,
      );
    }

    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_FAILED",
      `Falha ao publicar status no WhatsApp: ${message}`,
      500,
    );
  }
}

/**
 * Valida e prepara os dados de mídia para publicação de status com imagem.
 */
async function prepareImageStatusData(body) {
  if (!body || typeof body !== "object") {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_PAYLOAD",
      "Payload inválido para publicação de imagem no status.",
      400,
    );
  }

  const { mediaBase64, mediaUrl, mimetype, filename, caption, idempotencyKey } = body;

  if (!mediaBase64 && !mediaUrl) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_MISSING_MEDIA",
      "Informe mediaBase64 ou mediaUrl para publicar imagem no status.",
      400,
    );
  }

  let rawCaption = null;
  if (caption !== undefined && caption !== null) {
    const trimmedCaption = String(caption).trim();
    if (trimmedCaption.length > MAX_STATUS_CAPTION_LENGTH) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_CAPTION_TOO_LONG",
        `A legenda excede o limite máximo de ${MAX_STATUS_CAPTION_LENGTH} caracteres (atual: ${trimmedCaption.length}).`,
        400,
      );
    }
    rawCaption = trimmedCaption || null;
  }

  const requestedFilename = filename
    ? sanitizeAttachmentFilename(String(filename), "image")
    : null;

  let buffer;
  let sourceMime = mimetype;

  if (mediaUrl) {
    const urlStr = String(mediaUrl).trim();
    if (!/^https?:\/\//i.test(urlStr)) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_INVALID_MEDIA_URL",
        "A URL da imagem deve ser um endereço HTTP ou HTTPS válido.",
        400,
      );
    }
    try {
      const downloaded = await downloadHttpMediaBounded(urlStr, {
        maxBytes: MAX_MEDIA_BYTES,
        fileName: requestedFilename || "status-image",
        timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      });
      buffer = downloaded.buffer;
      sourceMime = downloaded.contentType || sourceMime;
    } catch (err) {
      const isTooLarge = err?.code === "WHATSAPP2_MEDIA_TOO_LARGE" || /too_large/i.test(err?.message);
      const code = isTooLarge ? "WHATSAPP2_MEDIA_TOO_LARGE" : "WHATSAPP2_STATUS_DOWNLOAD_FAILED";
      const status = isTooLarge ? 413 : 400;
      throw new WhatsAppStatusError(code, `Falha ao baixar imagem do status: ${err.message}`, status);
    }
  } else {
    let cleanBase64 = String(mediaBase64).trim();
    const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
      sourceMime = sourceMime || dataUrlMatch[1];
      cleanBase64 = dataUrlMatch[2];
    }
    try {
      assertMediaSizeWithinLimit({
        base64: cleanBase64,
        maxBytes: MAX_MEDIA_BYTES,
      });
      buffer = Buffer.from(cleanBase64, "base64");
      assertMediaSizeWithinLimit({
        actualBytes: buffer.length,
        maxBytes: MAX_MEDIA_BYTES,
      });
    } catch (err) {
      const isTooLarge = err?.code === "WHATSAPP2_MEDIA_TOO_LARGE" || /too_large/i.test(err?.message);
      const code = isTooLarge ? "WHATSAPP2_MEDIA_TOO_LARGE" : "WHATSAPP2_STATUS_INVALID_BASE64";
      const status = isTooLarge ? 413 : 400;
      throw new WhatsAppStatusError(code, `Dados da imagem inválidos: ${err.message}`, status);
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_EMPTY_MEDIA",
      "O arquivo de imagem está vazio.",
      400,
    );
  }

  const sniffedImageMime = sniffMimeType(buffer);
  if (!sniffedImageMime || !ALLOWED_IMAGE_MIMES.has(sniffedImageMime)) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_IMAGE_MIME",
      "O arquivo fornecido não é uma imagem válida (JPEG, PNG ou WEBP) ou possui cabeçalho corrompido.",
      400,
    );
  }

  const trustedMime = resolveTrustedMimeType(
    sniffedImageMime,
    buffer,
    requestedFilename,
  );

  if (!ALLOWED_IMAGE_MIMES.has(trustedMime)) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_IMAGE_MIME",
      `Formato de imagem não suportado: '${trustedMime}'. Formatos permitidos: JPEG, PNG e WEBP.`,
      400,
    );
  }

  const resolvedFilename = requestedFilename || (
    trustedMime === "image/jpeg" ? "status.jpg" :
    trustedMime === "image/png" ? "status.png" : "status.webp"
  );

  const cleanIdempotencyKey = typeof idempotencyKey === "string" && idempotencyKey.trim()
    ? idempotencyKey.trim().slice(0, 128)
    : null;

  const privacy = body.privacy ? validatePrivacyPayload(body.privacy) : null;

  return {
    buffer,
    mimeType: trustedMime,
    filename: resolvedFilename,
    caption: rawCaption,
    idempotencyKey: cleanIdempotencyKey,
    privacy,
  };
}

/**
 * Gera chave de idempotência segura para deduplicação automática de imagens
 */
function resolveEffectiveImageIdempotencyKey(prepared) {
  if (prepared.idempotencyKey) {
    return `custom:img:${prepared.idempotencyKey}`;
  }
  const sample = prepared.buffer.subarray(0, 64 * 1024);
  const hash = crypto
    .createHash("sha256")
    .update(sample)
    .update(String(prepared.buffer.length))
    .update(prepared.caption || "")
    .digest("hex");
  return `auto:img:${hash}`;
}

/**
 * Publica um status com imagem através do Puppeteer e @wppconnect/wa-js injetado.
 */
async function publishImageStatus({ client, body, timeoutMs = STATUS_MEDIA_TIMEOUT_MS }) {
  cleanStaleIdempotencyEntries();

  const prepared = await prepareImageStatusData(body);
  const cacheKey = resolveEffectiveImageIdempotencyKey(prepared);
  const existing = idempotencyCache.get(cacheKey);

  if (existing) {
    if (existing.state === "in_flight") {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_IN_FLIGHT",
        "Esta publicação de status já está em processamento.",
        409,
      );
    }
    if (existing.state === "completed" && existing.result) {
      const isAutoKey = cacheKey.startsWith("auto:img:");
      const maxAge = isAutoKey ? AUTO_DEDUP_WINDOW_MS : IDEMPOTENCY_TTL_MS;
      if (Date.now() - existing.createdAt < maxAge) {
        return {
          ...existing.result,
          cached: true,
        };
      }
    }
  }

  idempotencyCache.set(cacheKey, {
    state: "in_flight",
    createdAt: Date.now(),
  });

  try {
    if (!client) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "Cliente do WhatsApp não está conectado.",
        503,
      );
    }

    const page = client.pupPage;
    if (!page) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
        "Página do WhatsApp Web não disponível no momento.",
        503,
      );
    }

    if (prepared.privacy) {
      await applyStatusPrivacy(page, prepared.privacy);
    }

    const dataUrl = `data:${prepared.mimeType};base64,${prepared.buffer.toString("base64")}`;

    const sendPromise = page.evaluate(
      async ({ dataUrl, caption, filename }) => {
        const wpp = globalThis.WPP;
        if (!wpp || !wpp.isReady) {
          throw new Error("WPP_NOT_READY");
        }
        if (!wpp.status || typeof wpp.status.sendImageStatus !== "function") {
          throw new Error("WPP_STATUS_UNAVAILABLE");
        }

        const options = {
          waitForAck: true,
          ...(caption ? { caption } : {}),
          ...(filename ? { filename } : {}),
        };

        try {
          const result = await wpp.status.sendImageStatus(dataUrl, options);
          return result ? JSON.parse(JSON.stringify(result)) : null;
        } catch (err) {
          const errStr = String(err?.message || err);
          if (errStr.includes("timeout_on_register_status") || errStr.includes("timeout_on_send_status")) {
            try {
              const myStatus = typeof wpp.status.getMyStatus === "function" ? await wpp.status.getMyStatus() : null;
              const msgs = myStatus?.msgs;
              const latestMsg = msgs?.last?.() || (Array.isArray(msgs) ? msgs[msgs.length - 1] : null);
              if (latestMsg && (Date.now() / 1000 - Number(latestMsg.t || 0)) < 60) {
                return {
                  id: latestMsg.id?._serialized || String(latestMsg.id || ""),
                  ack: typeof latestMsg.ack === "number" ? latestMsg.ack : 1,
                  sendMsgResult: { messageSendResult: "OK" },
                  recoveredFromTimeout: true,
                };
              }
            } catch {}
          }
          throw err;
        }
      },
      {
        dataUrl,
        caption: prepared.caption,
        filename: prepared.filename,
      },
    );

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new WhatsAppStatusError(
            "WHATSAPP2_STATUS_TIMEOUT",
            `Tempo limite de ${timeoutMs / 1000}s excedido ao aguardar envio e confirmação da imagem de status pelo WhatsApp.`,
            504,
          ),
        );
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });

    const sendResult = await Promise.race([sendPromise, timeoutPromise]);

    const statusId = typeof sendResult?.id === "string"
      ? sendResult.id
      : sendResult?.id?._serialized || sendResult?.id?.id || (sendResult?.id ? String(sendResult.id) : null);

    const ack = typeof sendResult?.ack === "number" ? sendResult.ack : 1;

    const finalResponse = {
      ok: true,
      id: statusId,
      ack,
      status: "sent",
      type: "image",
      caption: prepared.caption || null,
      mimeType: prepared.mimeType,
      fileSize: prepared.buffer.length,
      publishedAt: new Date().toISOString(),
    };

    idempotencyCache.set(cacheKey, {
      state: "completed",
      result: finalResponse,
      createdAt: Date.now(),
    });

    return finalResponse;
  } catch (error) {
    idempotencyCache.delete(cacheKey);

    if (error instanceof WhatsAppStatusError) {
      throw error;
    }

    const message = String(error?.message || error);
    if (message.includes("WPP_NOT_READY")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "A biblioteca de controle do WhatsApp Web ainda está iniciando. Tente novamente em instantes.",
        503,
      );
    }
    if (message.includes("WPP_STATUS_UNAVAILABLE")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_UNSUPPORTED",
        "A versão atual do WhatsApp Web carregada não possui suporte a publicação de imagem em status.",
        501,
      );
    }
    if (message.includes("timeout_on_send_status") || message.includes("timeout_on_register_status")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_TIMEOUT",
        "O WhatsApp Web demorou para confirmar o envio do status de imagem.",
        504,
      );
    }

    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_FAILED",
      `Falha ao publicar imagem no status do WhatsApp: ${message}`,
      500,
    );
  }
}

/**
 * Valida e prepara os dados de mídia para publicação de status com vídeo.
 */
async function prepareVideoStatusData(body) {
  if (!body || typeof body !== "object") {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_PAYLOAD",
      "Payload inválido para publicação de vídeo no status.",
      400,
    );
  }

  const { mediaBase64, mediaUrl, mimetype, filename, caption, idempotencyKey, skipTranscode } = body;

  if (!mediaBase64 && !mediaUrl) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_MISSING_MEDIA",
      "Informe mediaBase64 ou mediaUrl para publicar vídeo no status.",
      400,
    );
  }

  let rawCaption = null;
  if (caption !== undefined && caption !== null) {
    const trimmedCaption = String(caption).trim();
    if (trimmedCaption.length > MAX_STATUS_CAPTION_LENGTH) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_CAPTION_TOO_LONG",
        `A legenda excede o limite máximo de ${MAX_STATUS_CAPTION_LENGTH} caracteres (atual: ${trimmedCaption.length}).`,
        400,
      );
    }
    rawCaption = trimmedCaption || null;
  }

  const requestedFilename = filename
    ? sanitizeAttachmentFilename(String(filename), "video")
    : null;

  let buffer;
  let sourceMime = mimetype;

  if (mediaUrl) {
    const urlStr = String(mediaUrl).trim();
    if (!/^https?:\/\//i.test(urlStr)) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_INVALID_MEDIA_URL",
        "A URL do vídeo deve ser um endereço HTTP ou HTTPS válido.",
        400,
      );
    }
    try {
      const downloaded = await downloadHttpMediaBounded(urlStr, {
        maxBytes: 64 * 1024 * 1024,
        fileName: requestedFilename || "status-video",
        timeoutMs: 60_000,
      });
      buffer = downloaded.buffer;
      sourceMime = downloaded.contentType || sourceMime;
    } catch (err) {
      const isTooLarge = err?.code === "WHATSAPP2_MEDIA_TOO_LARGE" || /too_large/i.test(err?.message);
      const code = isTooLarge ? "WHATSAPP2_MEDIA_TOO_LARGE" : "WHATSAPP2_STATUS_DOWNLOAD_FAILED";
      const status = isTooLarge ? 413 : 400;
      throw new WhatsAppStatusError(code, `Falha ao baixar vídeo do status: ${err.message}`, status);
    }
  } else {
    let cleanBase64 = String(mediaBase64).trim();
    const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
      sourceMime = sourceMime || dataUrlMatch[1];
      cleanBase64 = dataUrlMatch[2];
    }
    try {
      assertMediaSizeWithinLimit({
        base64: cleanBase64,
        maxBytes: 64 * 1024 * 1024,
      });
      buffer = Buffer.from(cleanBase64, "base64");
      assertMediaSizeWithinLimit({
        actualBytes: buffer.length,
        maxBytes: 64 * 1024 * 1024,
      });
    } catch (err) {
      const isTooLarge = err?.code === "WHATSAPP2_MEDIA_TOO_LARGE" || /too_large/i.test(err?.message);
      const code = isTooLarge ? "WHATSAPP2_MEDIA_TOO_LARGE" : "WHATSAPP2_STATUS_INVALID_BASE64";
      const status = isTooLarge ? 413 : 400;
      throw new WhatsAppStatusError(code, `Dados do vídeo inválidos: ${err.message}`, status);
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_EMPTY_MEDIA",
      "O arquivo de vídeo está vazio.",
      400,
    );
  }

  const trustedMime = resolveTrustedMimeType(
    sourceMime,
    buffer,
    requestedFilename,
  );

  if (!ALLOWED_VIDEO_MIMES.has(trustedMime)) {
    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_INVALID_VIDEO_MIME",
      `Formato de vídeo não suportado: '${trustedMime}'. Formatos permitidos: MP4, WebM, MOV, 3GP.`,
      400,
    );
  }

  let finalBuffer = buffer;
  let finalMime = "video/mp4";

  if (!skipTranscode) {
    try {
      const transcoded = await transcodeVideoForStatus(buffer, {
        maxSeconds: MAX_STATUS_VIDEO_SECONDS,
      });
      finalBuffer = transcoded.buffer;
      finalMime = transcoded.mimeType;
    } catch (err) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_TRANSCODE_FAILED",
        `Falha ao processar e normalizar vídeo para o WhatsApp: ${err.message}`,
        422,
      );
    }
  }

  const cleanIdempotencyKey = typeof idempotencyKey === "string" && idempotencyKey.trim()
    ? idempotencyKey.trim().slice(0, 128)
    : null;

  const privacy = body.privacy ? validatePrivacyPayload(body.privacy) : null;

  return {
    buffer: finalBuffer,
    mimeType: finalMime,
    filename: requestedFilename || "status.mp4",
    caption: rawCaption,
    idempotencyKey: cleanIdempotencyKey,
    privacy,
  };
}

/**
 * Gera chave de idempotência para deduplicação automática de vídeos
 */
function resolveEffectiveVideoIdempotencyKey(prepared) {
  if (prepared.idempotencyKey) {
    return `custom:vid:${prepared.idempotencyKey}`;
  }
  const sample = prepared.buffer.subarray(0, 64 * 1024);
  const hash = crypto
    .createHash("sha256")
    .update(sample)
    .update(String(prepared.buffer.length))
    .update(prepared.caption || "")
    .digest("hex");
  return `auto:vid:${hash}`;
}

/**
 * Publica um status com vídeo através do Puppeteer e @wppconnect/wa-js injetado.
 */
async function publishVideoStatus({ client, body, timeoutMs = STATUS_VIDEO_TIMEOUT_MS }) {
  cleanStaleIdempotencyEntries();

  const prepared = await prepareVideoStatusData(body);
  const cacheKey = resolveEffectiveVideoIdempotencyKey(prepared);
  const existing = idempotencyCache.get(cacheKey);

  if (existing) {
    if (existing.state === "in_flight") {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_IN_FLIGHT",
        "Esta publicação de vídeo no status já está em processamento.",
        409,
      );
    }
    if (existing.state === "completed" && existing.result) {
      const isAutoKey = cacheKey.startsWith("auto:vid:");
      const maxAge = isAutoKey ? AUTO_DEDUP_WINDOW_MS : IDEMPOTENCY_TTL_MS;
      if (Date.now() - existing.createdAt < maxAge) {
        return {
          ...existing.result,
          cached: true,
        };
      }
    }
  }

  idempotencyCache.set(cacheKey, {
    state: "in_flight",
    createdAt: Date.now(),
  });

  try {
    if (!client) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "Cliente do WhatsApp não está conectado.",
        503,
      );
    }

    const page = client.pupPage;
    if (!page) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_PAGE_UNAVAILABLE",
        "Página do WhatsApp Web não disponível no momento.",
        503,
      );
    }

    if (prepared.privacy) {
      await applyStatusPrivacy(page, prepared.privacy);
    }

    const dataUrl = `data:${prepared.mimeType};base64,${prepared.buffer.toString("base64")}`;

    const sendPromise = page.evaluate(
      async ({ dataUrl, caption, filename }) => {
        const wpp = globalThis.WPP;
        if (!wpp || !wpp.isReady) {
          throw new Error("WPP_NOT_READY");
        }
        if (!wpp.status || typeof wpp.status.sendVideoStatus !== "function") {
          throw new Error("WPP_STATUS_UNAVAILABLE");
        }

        const options = {
          waitForAck: true,
          ...(caption ? { caption } : {}),
          ...(filename ? { filename } : {}),
        };

        try {
          const result = await wpp.status.sendVideoStatus(dataUrl, options);
          return result ? JSON.parse(JSON.stringify(result)) : null;
        } catch (err) {
          const errStr = String(err?.message || err);
          if (errStr.includes("timeout_on_register_status") || errStr.includes("timeout_on_send_status")) {
            try {
              const myStatus = typeof wpp.status.getMyStatus === "function" ? await wpp.status.getMyStatus() : null;
              const msgs = myStatus?.msgs;
              const latestMsg = msgs?.last?.() || (Array.isArray(msgs) ? msgs[msgs.length - 1] : null);
              if (latestMsg && (Date.now() / 1000 - Number(latestMsg.t || 0)) < 60) {
                return {
                  id: latestMsg.id?._serialized || String(latestMsg.id || ""),
                  ack: typeof latestMsg.ack === "number" ? latestMsg.ack : 1,
                  sendMsgResult: { messageSendResult: "OK" },
                  recoveredFromTimeout: true,
                };
              }
            } catch {}
          }
          throw err;
        }
      },
      {
        dataUrl,
        caption: prepared.caption,
        filename: prepared.filename,
      },
    );

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new WhatsAppStatusError(
            "WHATSAPP2_STATUS_TIMEOUT",
            `Tempo limite de ${timeoutMs / 1000}s excedido ao aguardar envio e confirmação do vídeo de status pelo WhatsApp.`,
            504,
          ),
        );
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });

    const sendResult = await Promise.race([sendPromise, timeoutPromise]);

    const statusId = typeof sendResult?.id === "string"
      ? sendResult.id
      : sendResult?.id?._serialized || sendResult?.id?.id || (sendResult?.id ? String(sendResult.id) : null);

    const ack = typeof sendResult?.ack === "number" ? sendResult.ack : 1;

    const finalResponse = {
      ok: true,
      id: statusId,
      ack,
      status: "sent",
      type: "video",
      caption: prepared.caption || null,
      mimeType: prepared.mimeType,
      fileSize: prepared.buffer.length,
      publishedAt: new Date().toISOString(),
    };

    idempotencyCache.set(cacheKey, {
      state: "completed",
      result: finalResponse,
      createdAt: Date.now(),
    });

    return finalResponse;
  } catch (error) {
    idempotencyCache.delete(cacheKey);

    if (error instanceof WhatsAppStatusError) {
      throw error;
    }

    const message = String(error?.message || error);
    if (message.includes("WPP_NOT_READY")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_NOT_READY",
        "A biblioteca de controle do WhatsApp Web ainda está iniciando. Tente novamente em instantes.",
        503,
      );
    }
    if (message.includes("WPP_STATUS_UNAVAILABLE")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_UNSUPPORTED",
        "A versão atual do WhatsApp Web carregada não possui suporte a publicação de vídeo em status.",
        501,
      );
    }
    if (message.includes("timeout_on_send_status") || message.includes("timeout_on_register_status")) {
      throw new WhatsAppStatusError(
        "WHATSAPP2_STATUS_TIMEOUT",
        "O WhatsApp Web demorou para confirmar o envio do status de vídeo.",
        504,
      );
    }

    throw new WhatsAppStatusError(
      "WHATSAPP2_STATUS_FAILED",
      `Falha ao publicar vídeo no status do WhatsApp: ${message}`,
      500,
    );
  }
}

/**
 * Limpa o cache de idempotência (útil para testes unitários).
 */
function resetIdempotencyCacheForTests() {
  idempotencyCache.clear();
}

module.exports = {
  MAX_STATUS_TEXT_LENGTH,
  MAX_STATUS_CAPTION_LENGTH,
  STATUS_TIMEOUT_MS,
  STATUS_MEDIA_TIMEOUT_MS,
  STATUS_VIDEO_TIMEOUT_MS,
  IDEMPOTENCY_TTL_MS,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  VALID_PRIVACY_TYPES,
  WhatsAppStatusError,
  validatePrivacyPayload,
  applyStatusPrivacy,
  getStatusPrivacy,
  setStatusPrivacy,
  getStatusContacts,
  validateTextStatusPayload,
  publishTextStatus,
  prepareImageStatusData,
  publishImageStatus,
  prepareVideoStatusData,
  publishVideoStatus,
  resetIdempotencyCacheForTests,
};
