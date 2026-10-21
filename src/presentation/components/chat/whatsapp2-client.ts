import {
  whatsappAccountIdFromConversationId,
  whatsappAccountIdFromWid,
  whatsapp2ConversationIdForAccount,
  whatsappProviderIdFromConversationId,
  whatsappConversationBelongsToAccount,
  isLatestWhatsAppAccountLoad,
  resolveWhatsAppContactDisplayName,
} from "@/domain/entities/whatsapp2-account-scope.cjs";

export {
  whatsappAccountIdFromConversationId,
  whatsappAccountIdFromWid,
  whatsapp2ConversationIdForAccount,
  whatsappProviderIdFromConversationId,
  whatsappConversationBelongsToAccount,
  isLatestWhatsAppAccountLoad,
  resolveWhatsAppContactDisplayName,
};

export const WHATSAPP2_GATEWAY_URL =
  process.env.NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL || "http://127.0.0.1:8788";

export const IS_WHATSAPP2_REMOTE_BUILD =
  WHATSAPP2_GATEWAY_URL === "/wa2" ||
  !/^http:\/\/(?:127\.0\.0\.1|localhost):8788\/?$/i.test(WHATSAPP2_GATEWAY_URL);

export type WhatsApp2AttachmentKind =
  | "audio"
  | "image"
  | "video"
  | "sticker"
  | "document"
  | "file"
  | "unsupported";

export interface WhatsApp2TextExtraction {
  source: "pdf_text_layer" | string;
  status: "extracted" | "no_text" | "too_large" | "protected" | "invalid_pdf" | "error" | string;
  text: string | null;
  extractedChars: number;
  extractedPages: number;
  totalPages: number | null;
  truncated: boolean;
  errorCode: string | null;
}

export interface WhatsApp2DocumentMetadata {
  title?: string | null;
  author?: string | null;
  subject?: string | null;
  creator?: string | null;
  producer?: string | null;
}

export interface WhatsApp2ContactCard {
  name: string | null;
  phones: string[];
  emails: string[];
  organization: string | null;
}

export interface WhatsApp2MessageMetadata {
  providerType?: string | null;
  nativeKind?: "contact" | "location" | "poll" | "album" | "call" | "group_invite" | "interactive" | "order" | "product" | "payment" | "link" | "revoked" | string | null;
  isForwarded?: boolean;
  forwardingScore?: number | null;
  contacts?: WhatsApp2ContactCard[];
  location?: {
    latitude: number | null;
    longitude: number | null;
    name: string | null;
    address: string | null;
    url: string | null;
    isLive: boolean;
    shareDuration: number | null;
  };
  poll?: {
    question: string | null;
    options: Array<{ id: number | null; name: string | null }>;
    allowMultipleAnswers: boolean;
    invalidated: boolean;
    votesByVoter?: Record<string, { selectedOptions?: Array<{ id?: number | null; name?: string | null }>; interactedAt?: string }>;
  };
  album?: { expectedItems?: number | null };
  call?: { summary?: string | null };
  groupInvite?: { groupName?: string | null; expiresAt?: number | null };
  interactive?: { selectedButtonId?: string | null; selectedRowId?: string | null };
  links?: Array<{ url: string | null; suspicious: boolean }>;
  linkPreview?: { title?: string | null; description?: string | null; url?: string | null };
}

export interface WhatsApp2Attachment {
  kind: WhatsApp2AttachmentKind;
  providerType: string | null;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  mediaUrl: string | null;
  caption: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  isGif: boolean;
  isAnimated: boolean;
  isViewOnce: boolean;
  isForwarded: boolean;
  forwardingScore: number | null;
  downloadable: boolean;
  previewable: boolean;
  textExtraction?: WhatsApp2TextExtraction | null;
  documentMetadata?: WhatsApp2DocumentMetadata | null;
  documentKind?: string | null;
  documentStructure?: Record<string, unknown> | null;
}

export interface WhatsApp2GatewayMessage {
  id: string | null;
  from: string | null;
  to: string | null;
  body: string;
  type: string | null;
  timestamp: number | null;
  fromMe: boolean;
  hasMedia: boolean;
  hasQuotedMsg: boolean;
  ack: number | null;
  attachment?: WhatsApp2Attachment | null;
  messageMetadata?: WhatsApp2MessageMetadata | null;
}

const WHATSAPP2_INTERNAL_SYSTEM_MESSAGE_TYPES = new Set([
  "notification_template",
  "e2e_notification",
  "protocol",
  "ciphertext",
  "debug",
  "notification",
  "group_notification",
  "broadcast_notification",
]);

export function isWhatsApp2InternalSystemMessage(
  message: WhatsApp2GatewayMessage | null | undefined,
): boolean {
  return WHATSAPP2_INTERNAL_SYSTEM_MESSAGE_TYPES.has(
    String(message?.type || "").toLowerCase(),
  );
}

export function normalizeWhatsApp2Attachment(
  value: unknown,
  fallback?: Partial<WhatsApp2Attachment>,
): WhatsApp2Attachment | undefined {
  const raw = value && typeof value === "object"
    ? value as Partial<WhatsApp2Attachment>
    : {};
  const kind = String(raw.kind || fallback?.kind || "") as WhatsApp2AttachmentKind;
  if (![
    "audio", "image", "video", "sticker", "document", "file", "unsupported",
  ].includes(kind)) {
    return undefined;
  }

  const finite = (input: unknown): number | null => {
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const nullableString = (input: unknown): string | null => {
    const text = String(input ?? "").trim();
    return text || null;
  };

  return {
    kind,
    providerType: nullableString(raw.providerType ?? fallback?.providerType),
    mimeType: nullableString(raw.mimeType ?? fallback?.mimeType),
    fileName: nullableString(raw.fileName ?? fallback?.fileName),
    fileSize: finite(raw.fileSize ?? fallback?.fileSize),
    mediaUrl: nullableString(raw.mediaUrl ?? fallback?.mediaUrl),
    caption: nullableString(raw.caption ?? fallback?.caption),
    duration: finite(raw.duration ?? fallback?.duration),
    width: finite(raw.width ?? fallback?.width),
    height: finite(raw.height ?? fallback?.height),
    pageCount: finite(raw.pageCount ?? fallback?.pageCount),
    isGif: Boolean(raw.isGif ?? fallback?.isGif),
    isAnimated: Boolean(raw.isAnimated ?? fallback?.isAnimated),
    isViewOnce: Boolean(raw.isViewOnce ?? fallback?.isViewOnce),
    isForwarded: Boolean(raw.isForwarded ?? fallback?.isForwarded),
    forwardingScore: finite(raw.forwardingScore ?? fallback?.forwardingScore),
    downloadable: Boolean(raw.downloadable ?? fallback?.downloadable),
    previewable: Boolean(raw.previewable ?? fallback?.previewable),
    textExtraction: raw.textExtraction ?? fallback?.textExtraction ?? null,
    documentMetadata: raw.documentMetadata ?? fallback?.documentMetadata ?? null,
    documentKind: nullableString(raw.documentKind ?? fallback?.documentKind),
    documentStructure:
      raw.documentStructure && typeof raw.documentStructure === "object"
        ? raw.documentStructure
        : fallback?.documentStructure ?? null,
  };
}

export interface WhatsApp2GatewayChat {
  id: string;
  name: string;
  savedContactName?: string | null;
  avatarUrl?: string | null;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  archived: boolean;
  isLocked: boolean;
  isBlocked: boolean;
  pinned: boolean;
  lastMessage: WhatsApp2GatewayMessage | null;
}

export interface WhatsApp2PresencePayload {
  subscriptionId?: string;
  chatId: string;
  sourceChatId?: string;
  available: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  state?: string | null;
  isTyping?: boolean;
  isRecording?: boolean;
  reason?: string | null;
  updatedAt?: string;
}

export interface WhatsApp2GatewayEvent {
  type: string;
  payload?: unknown;
  at?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${WHATSAPP2_GATEWAY_URL}${path}`, {
    cache: "no-store",
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Gateway do WhatsApp HTTP ${response.status}`);
  }
  return data as T;
}

export async function getWhatsApp2Status() {
  return request<{
    ok: true;
    status: string;
    hasPairingCode?: boolean;
    pairingCode?: string | null;
    pairingPhone?: string | null;
    pairingUpdatedAt?: string | null;
    pairingExpiresAt?: string | null;
    readyAt?: string | null;
    me?: { wid?: string | null; pushname?: string | null; platform?: string | null } | null;
  }>("/status");
}

export async function requestWhatsApp2PairingCode(phoneNumber: string) {
  return request<{
    ok: true;
    status: "pairing_code";
    code: string;
    phoneNumber: string;
    updatedAt: string;
    expiresAt: string;
  }>("/pairing-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber }),
  });
}

export async function disconnectWhatsApp2() {
  return request<{
    ok: true;
    disconnected: boolean;
    status: string;
  }>("/disconnect", {
    method: "POST",
  });
}

export async function getWhatsApp2ProfilePhoto(chatId: string) {
  return request<{ ok: true; chatId: string; avatarUrl: string | null }>(
    `/chat/profile?chatId=${encodeURIComponent(chatId)}`,
  );
}

export async function refreshWhatsApp2ProfilePhoto(chatId: string, rejectedUrl: string) {
  return request<{ ok: true; chatId: string; avatarUrl: string | null }>(
    "/chat/profile/refresh",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, rejectedUrl }),
    },
  );
}

export async function getWhatsApp2Chats(limit = 160) {
  const data = await request<{ ok: true; chats: WhatsApp2GatewayChat[] }>(
    `/chats?limit=${Math.max(1, Math.min(limit, 500))}`,
  );
  return (data.chats || []).map((chat) =>
    isWhatsApp2InternalSystemMessage(chat.lastMessage)
      ? { ...chat, lastMessage: null }
      : chat
  );
}

export interface WhatsApp2ChatControlState {
  chatId: string;
  archived: boolean;
  isLocked: boolean;
  isBlocked: boolean;
}

export async function getWhatsApp2ChatState(chatId: string) {
  return request<{ ok: true } & WhatsApp2ChatControlState>(
    `/chat/state?chatId=${encodeURIComponent(chatId)}`,
  );
}

export async function getWhatsApp2ExternalChatLink(chatId: string) {
  return request<{
    ok: true;
    chatId: string;
    available: boolean;
    phoneNumber?: string;
    url?: string;
    reason?: string;
  }>(
    `/chat/external-link?chatId=${encodeURIComponent(chatId)}`,
  );
}

export interface WhatsApp2ResolvedPhone {
  chatId: string;
  phoneNumber: string | null;
  savedName?: string | null;
  available: boolean;
}

export async function saveWhatsApp2Contact(params: {
  chatId: string;
  conversationId: string;
  contactName: string;
  syncAddressBook: boolean;
}) {
  return request<{
    ok: true;
    chatId: string;
    conversationId: string;
    phoneNumber: string;
    savedName: string;
    syncAddressBookRequested: boolean;
  }>("/chat/contact/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function resolveWhatsApp2PhoneNumbers(chatIds: string[]) {
  const uniqueChatIds = Array.from(
    new Set(
      (Array.isArray(chatIds) ? chatIds : [])
        .map((chatId) => String(chatId || "").trim())
        .filter(Boolean),
    ),
  );

  const contacts: WhatsApp2ResolvedPhone[] = [];
  const batchSize = 200;

  for (let index = 0; index < uniqueChatIds.length; index += batchSize) {
    const response = await request<{
      ok: true;
      contacts: WhatsApp2ResolvedPhone[];
    }>("/chat/resolve-phones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatIds: uniqueChatIds.slice(index, index + batchSize) }),
    });

    contacts.push(...(response.contacts || []));
  }

  return {
    ok: true as const,
    contacts,
  };
}

export async function setWhatsApp2ChatBlocked(chatId: string, blocked: boolean) {
  return request<{
    ok: true;
    chatId: string;
    isBlocked: boolean;
    changed: boolean;
  }>(blocked ? "/chat/block" : "/chat/unblock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId }),
  });
}

export async function setWhatsApp2ChatLocked(chatId: string, locked: boolean) {
  return request<{
    ok: true;
    chatId: string;
    isLocked: boolean;
    changed: boolean;
  }>(locked ? "/chat/lock" : "/chat/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId }),
  });
}

export function getWhatsApp2MediaUrl(messageId: string) {
  return `${WHATSAPP2_GATEWAY_URL}/message/media?messageId=${encodeURIComponent(messageId)}`;
}

export async function getWhatsApp2Messages(chatId: string, limit = 120) {
  const data = await request<{
    ok: true;
    messages: WhatsApp2GatewayMessage[];
  }>(
    `/chat/messages?chatId=${encodeURIComponent(chatId)}&limit=${Math.max(1, Math.min(limit, 250))}`,
  );
  return (data.messages || []).filter(
    (message) => !isWhatsApp2InternalSystemMessage(message),
  );
}

export async function syncWhatsApp2LatestInbound(chatId: string, conversationId: string) {
  try {
    const result = await request<{
      ok: true;
      latestInbound: boolean;
      conversationId?: string;
      persisted: boolean;
      alreadyPersisted?: boolean;
      queued?: boolean;
      reason?: string | null;
    }>("/chat/sync-latest-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, conversationId }),
    });
    return { ...result, endpointAvailable: true };
  } catch (error) {
    if (error instanceof Error && /route_not_found|HTTP 404/i.test(error.message)) {
      throw new Error("O gateway do WhatsApp precisa ser atualizado para responder à mensagem pendente. Você ainda pode escolher aguardar a próxima mensagem.");
    }
    throw error;
  }
}

export async function getWhatsApp2Presence(chatId: string) {
  return request<{
    ok: true;
    available: boolean;
    isOnline?: boolean;
    lastSeenAt?: string | null;
    reason?: string | null;
    cached?: boolean;
  }>(`/chat/presence?chatId=${encodeURIComponent(chatId)}`);
}

export async function subscribeWhatsApp2Presence(params: {
  subscriptionId: string;
  chatId: string;
  refresh?: boolean;
}) {
  return request<{
    ok: true;
    subscribed: boolean;
    reused?: boolean;
    refreshed?: boolean;
    stale?: boolean;
    subscriptionId: string;
    chatId: string;
    candidateIds?: string[];
    available?: boolean;
    reason?: string | null;
  }>("/chat/presence/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function unsubscribeWhatsApp2Presence(
  subscriptionId: string,
  chatId?: string,
) {
  return request<{
    ok: true;
    unsubscribed: boolean;
    stale?: boolean;
    subscriptionId: string;
    chatId?: string;
  }>("/chat/presence/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscriptionId, chatId }),
  });
}

export function openWhatsApp2EventStream(
  onEvent: (event: WhatsApp2GatewayEvent) => void,
  options?: {
    onOpen?: () => void;
    onError?: () => void;
    onStatus?: (status: { status?: string; [key: string]: unknown }) => void;
  },
) {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => {};
  }

  const source = new EventSource(`${WHATSAPP2_GATEWAY_URL}/events`);
  const onWhatsApp2 = (event: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(event.data) as WhatsApp2GatewayEvent);
    } catch {}
  };
  const onStatus = (event: MessageEvent<string>) => {
    try {
      options?.onStatus?.(
        JSON.parse(event.data) as { status?: string; [key: string]: unknown },
      );
    } catch {}
  };
  const onOpen = () => options?.onOpen?.();
  const onError = () => options?.onError?.();

  source.addEventListener("whatsapp2", onWhatsApp2 as EventListener);
  source.addEventListener("status", onStatus as EventListener);
  source.addEventListener("open", onOpen as EventListener);
  source.addEventListener("error", onError as EventListener);

  return () => {
    source.removeEventListener("whatsapp2", onWhatsApp2 as EventListener);
    source.removeEventListener("status", onStatus as EventListener);
    source.removeEventListener("open", onOpen as EventListener);
    source.removeEventListener("error", onError as EventListener);
    source.close();
  };
}

export async function sendWhatsApp2Text(params: {
  to: string;
  text: string;
  replyToMessageId?: string | null;
}) {
  return request<{ ok: true; message: WhatsApp2GatewayMessage }>("/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function sendWhatsApp2Media(params: {
  to: string;
  mediaUrl: string;
  asVoice?: boolean;
  asSticker?: boolean;
  caption?: string;
  replyToMessageId?: string | null;
}) {
  return request<{ ok: true; message: WhatsApp2GatewayMessage }>("/messages/send-media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export type WhatsApp2DeliveryQueueItem = {
  id: string;
  kind: "text" | "audio" | "image" | string;
  text_content?: string | null;
  media_url?: string | null;
  voice_note?: boolean;
  status: "pending" | "sending" | string;
  scheduled_at: string;
  created_at?: string;
};

export async function queueWhatsApp2Finalization(params: {
  to: string;
  conversationId: string;
  requestId: string;
}) {
  return request<{
    ok: true;
    queued: true;
    alreadyQueued: boolean;
    count: number;
    batchId: string;
    lastScheduledAt: string;
    items?: WhatsApp2DeliveryQueueItem[];
  }>("/messages/finalization/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function getWhatsApp2DeliveryQueue(chatId: string) {
  try {
    const data = await request<{
      ok: true;
      pendingDeliveries: WhatsApp2DeliveryQueueItem[];
    }>(`/chat/delivery-queue?chatId=${encodeURIComponent(chatId)}`);
    return data.pendingDeliveries || [];
  } catch {
    return [];
  }
}

export type WhatsAppStatusPrivacyType = "contact" | "deny-list" | "allow-list";

export interface WhatsAppStatusPrivacyConfig {
  type: WhatsAppStatusPrivacyType;
  list?: string[];
  count?: number;
  verified?: boolean; // Confirmação apenas na sessão WhatsApp Web vinculada.
  scope?: "linked-web-session";
  mobileSynced?: boolean;
  source?: string;
}

export interface WhatsAppStatusContact {
  id: string;
  name: string;
  number: string;
  avatarUrl?: string | null;
  isMyContact?: boolean;
}

export interface WhatsAppStatusContactsResult {
  ok: true;
  contacts: WhatsAppStatusContact[];
  total: number;
  offset?: number;
  hasMore?: boolean;
}

export interface WhatsApp2PublishStatusTextParams {
  text: string;
  backgroundColor?: string;
  font?: number;
  idempotencyKey?: string;
  privacy?: WhatsAppStatusPrivacyConfig;
}

export interface WhatsApp2StatusPublishResult {
  ok: true;
  id: string | null;
  ack: number;
  status: "sent" | "pending";
  type: "text";
  text: string;
  backgroundColor?: string | null;
  font?: number;
  publishedAt: string;
  cached?: boolean;
}

export async function publishWhatsAppStatusText(
  params: WhatsApp2PublishStatusTextParams,
): Promise<WhatsApp2StatusPublishResult> {
  return request<WhatsApp2StatusPublishResult>("/status/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export interface WhatsApp2PublishStatusImageParams {
  mediaBase64?: string;
  mediaUrl?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  idempotencyKey?: string;
  privacy?: WhatsAppStatusPrivacyConfig;
}

export interface WhatsApp2StatusImagePublishResult {
  ok: true;
  id: string | null;
  ack: number;
  status: "sent" | "pending";
  type: "image";
  caption?: string | null;
  mimeType: string;
  fileSize?: number;
  publishedAt: string;
  cached?: boolean;
}

export async function publishWhatsAppStatusImage(
  params: WhatsApp2PublishStatusImageParams,
): Promise<WhatsApp2StatusImagePublishResult> {
  return request<WhatsApp2StatusImagePublishResult>("/status/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export interface WhatsApp2PublishStatusVideoParams {
  mediaBase64?: string;
  mediaUrl?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  idempotencyKey?: string;
  skipTranscode?: boolean;
  privacy?: WhatsAppStatusPrivacyConfig;
}

export interface WhatsApp2StatusVideoPublishResult {
  ok: true;
  id: string | null;
  ack: number;
  status: "sent" | "pending";
  type: "video";
  caption?: string | null;
  mimeType: string;
  fileSize?: number;
  publishedAt: string;
  cached?: boolean;
}

interface WhatsApp2StatusVideoJob {
  ok: true;
  jobId: string;
  status: "processing" | "sent" | "failed";
  result?: WhatsApp2StatusVideoPublishResult;
  error?: string;
  code?: string;
}

/**
 * Vídeos podem levar >90 segundos (download, conversão e confirmação WhatsApp).
 * O Cloudflare encerra requisições HTTP longas com 502 sem cabeçalhos CORS.
 * Envie o vídeo em um job de curta duração e acompanhe separadamente.
 */
export async function publishWhatsAppStatusVideo(
  params: WhatsApp2PublishStatusVideoParams,
): Promise<WhatsApp2StatusVideoPublishResult> {
  const key = params.idempotencyKey?.trim();
  let job: WhatsApp2StatusVideoJob | null = null;
  try {
    job = await request<WhatsApp2StatusVideoJob>("/status/video/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (error) {
    // Se o túnel perdeu a resposta, o gateway pode ter aceitado o job.
    // Nunca publique novamente automaticamente; procure pelo identificador.
    if (key) {
      try {
        job = await request<WhatsApp2StatusVideoJob>(
          `/status/video/job?idempotencyKey=${encodeURIComponent(key)}`,
        );
      } catch { /* Resposta realmente indisponível. */ }
    }
    if (!job) {
      throw new Error(
        "Não foi possível confirmar o recebimento do vídeo pelo gateway. " +
        "Confira seus Status antes de tentar novamente. " +
        (error instanceof Error ? error.message : ""),
      );
    }
  }
  const jobId = job.jobId;
  const deadline = Date.now() + 200_000;
  let consecutiveNetworkErrors = 0;
  while (Date.now() < deadline) {
    if (job.status === "sent" && job.result) return job.result;
    if (job.status === "failed") {
      throw new Error(job.error || "O WhatsApp não confirmou o envio do vídeo.");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1600));
    try {
      job = await request<WhatsApp2StatusVideoJob>(
        `/status/video/job?jobId=${encodeURIComponent(jobId)}`,
      );
      consecutiveNetworkErrors = 0;
    } catch {
      consecutiveNetworkErrors += 1;
      if (consecutiveNetworkErrors >= 12) break;
    }
  }
  throw new Error(
    "Não foi possível confirmar o resultado do vídeo. " +
    "O processamento pode continuar no gateway. " +
    "Verifique o Status do WhatsApp antes de tentar novamente, para evitar duplicação.",
  );
}
export interface WhatsApp2ActiveStatus {
  id: string;
  type: "text" | "image" | "video" | "other";
  text: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
}

export async function getWhatsApp2ActiveStatuses(): Promise<{
  ok: true;
  count: number;
  items: WhatsApp2ActiveStatus[];
}> {
  return request("/status/active");
}

export interface WhatsApp2StatusViewer {
  id: string;
  name: string;
  viewedAt: string;
}

export interface WhatsApp2StatusViews {
  ok: true;
  available: boolean;
  count: number | null;
  viewers: WhatsApp2StatusViewer[];
  reason?: string;
}

export async function getWhatsApp2StatusViews(messageId: string): Promise<WhatsApp2StatusViews> {
  return request<WhatsApp2StatusViews>(
    "/status/views?messageId=" + encodeURIComponent(messageId),
  );
}

export async function getWhatsApp2StatusPrivacy(): Promise<WhatsAppStatusPrivacyConfig & { ok: boolean }> {
  return request<WhatsAppStatusPrivacyConfig & { ok: boolean }>("/status/privacy", {
    method: "GET",
  });
}

export async function setWhatsApp2StatusPrivacy(
  config: WhatsAppStatusPrivacyConfig,
): Promise<WhatsAppStatusPrivacyConfig & { ok: boolean }> {
  return request<WhatsAppStatusPrivacyConfig & { ok: boolean }>("/status/privacy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export async function getWhatsApp2StatusContacts(
  search = "",
  limit = 300,
  offset = 0,
  storyId = "",
  tinderOnly = false,
): Promise<WhatsAppStatusContactsResult> {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (storyId) query.set("storyId", storyId);
  if (tinderOnly) query.set("tinderOnly", "1");
  if (limit) query.set("limit", String(limit));
  if (offset) query.set("offset", String(offset));
  const queryString = query.toString();
  return request<WhatsAppStatusContactsResult>(`/status/contacts${queryString ? `?${queryString}` : ""}`, {
    method: "GET",
  });
}

export interface WhatsAppStatusEvergreenRecipient {
  contactKey: string;
  contactId: string | null;
  contactNumber: string | null;
  statusPostId: string | null;
  sentAt: string;
}

export async function getWhatsApp2EvergreenRecipients(storyKey: string) {
  const query = new URLSearchParams({ storyKey });
  return request<{
    ok: true;
    storyKey: string;
    recipients: WhatsAppStatusEvergreenRecipient[];
    count: number;
  }>(`/status/evergreen-recipients?${query.toString()}`, {
    method: "GET",
  });
}

export async function getWhatsApp2LibraryRecipients(storyId: string) {
  return request<{
    ok: true;
    recipients: WhatsAppStatusEvergreenRecipient[];
    locks: Array<{ contact_key: string; state: "reserved" | "sent" | "uncertain" | "failed"; sent_at: string | null }>;
  }>(`/status/library/recipients?storyId=${encodeURIComponent(storyId)}`);
}

export async function publishWhatsAppLibraryStory(params: {
  storyId: string;
  recipients: Array<{ id: string; number?: string | null }>;
  caption?: string;
  idempotencyKey: string;
}): Promise<WhatsApp2StatusImagePublishResult | WhatsApp2StatusVideoPublishResult> {
  type Job = {
    ok: true;
    jobId: string;
    status: "processing" | "sent" | "failed";
    result?: WhatsApp2StatusImagePublishResult | WhatsApp2StatusVideoPublishResult;
    error?: string;
  };
  let job: Job | null = null;
  try {
    job = await request<Job>("/status/library/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (error) {
    // Se a resposta do túnel sumir, nunca inicie outra publicação às cegas.
    try {
      job = await request<Job>(
        `/status/library/publish/job?idempotencyKey=${encodeURIComponent(params.idempotencyKey)}`,
      );
    } catch { /* O estado permanece incerto. */ }
    if (!job) {
      throw new Error("Publicação sem confirmação do gateway. Confira o histórico antes de tentar de novo.");
    }
  }

  const deadline = Date.now() + 200_000;
  let errors = 0;
  while (Date.now() < deadline) {
    if (job.status === "sent" && job.result) return job.result;
    if (job.status === "failed") throw new Error(job.error || "Falha ao publicar o Story.");
    await new Promise<void>(resolve => setTimeout(resolve, 1600));
    try {
      job = await request<Job>(
        `/status/library/publish/job?jobId=${encodeURIComponent(job.jobId)}`,
      );
      errors = 0;
    } catch {
      if (++errors >= 12) break;
    }
  }
  throw new Error("Resultado da publicação ainda incerto. Não tente reenviar sem conferir os Status.");
}

export async function recordWhatsApp2EvergreenRecipients(params: {
  storyKey: string;
  statusPostId?: string | null;
  recipients: Array<{ id?: string | null; number?: string | null }>;
}) {
  return request<{
    ok: true;
    storyKey: string;
    inserted: number;
    recipients: WhatsAppStatusEvergreenRecipient[];
    count: number;
  }>("/status/evergreen-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
