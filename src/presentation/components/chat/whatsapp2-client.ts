export const WHATSAPP2_GATEWAY_URL =
  process.env.NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL || "http://127.0.0.1:8788";

export const IS_WHATSAPP2_REMOTE_BUILD = WHATSAPP2_GATEWAY_URL === "/wa2";

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
}

export interface WhatsApp2GatewayChat {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  archived: boolean;
  pinned: boolean;
  lastMessage: WhatsApp2GatewayMessage | null;
}async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    `/chats?limit=${Math.max(1, Math.min(limit, 300))}`,
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