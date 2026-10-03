export const WHATSAPP2_GATEWAY_URL =
  process.env.NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL || "http://127.0.0.1:8788";

export const IS_WHATSAPP2_REMOTE_BUILD = WHATSAPP2_GATEWAY_URL === "/wa2";

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
  avatarUrl?: string | null;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  archived: boolean;
  isLocked: boolean;
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
    throw new Error(data?.error || `WhatsApp 2 gateway HTTP ${response.status}`);
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

export async function getWhatsApp2Chats(limit = 160) {
  const data = await request<{ ok: true; chats: WhatsApp2GatewayChat[] }>(
    `/chats?limit=${Math.max(1, Math.min(limit, 500))}`,
  );
  return data.chats || [];
}export function getWhatsApp2MediaUrl(messageId: string) {
  return `${WHATSAPP2_GATEWAY_URL}/message/media?messageId=${encodeURIComponent(messageId)}`;
}

export async function getWhatsApp2Messages(chatId: string, limit = 120) {
  const data = await request<{
    ok: true;
    messages: WhatsApp2GatewayMessage[];
  }>(
    `/chat/messages?chatId=${encodeURIComponent(chatId)}&limit=${Math.max(1, Math.min(limit, 250))}`,
  );
  return data.messages || [];
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