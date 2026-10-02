const DEFAULT_WHATSAPP_GRAPH_VERSION = "v26.0";

export type WhatsAppOutboundKind = "text" | "audio" | "image" | "sticker";

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export interface SendWhatsAppCloudMessageParams {
  recipientId: string;
  kind: WhatsAppOutboundKind;
  text?: string;
  mediaUrl?: string;
  voiceNote?: boolean;
  replyToMessageId?: string | null;
}

export function getWhatsAppCloudConfig(): WhatsAppCloudConfig {
  const accessToken = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "").trim();
  const phoneNumberId = (Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "").trim();
  const apiVersion = (Deno.env.get("WHATSAPP_GRAPH_VERSION") || DEFAULT_WHATSAPP_GRAPH_VERSION).trim();

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp Cloud API não configurada no servidor.");
  }

  return { accessToken, phoneNumberId, apiVersion };
}

export function toWhatsAppConversationId(waId: string): string {
  const normalized = String(waId || "").replace(/\D/g, "");
  return `wa:${normalized}`;
}

export function normalizeWhatsAppRecipient(value: string): string {
  const withoutPrefix = String(value || "").replace(/^wa:/i, "");
  return withoutPrefix.replace(/\D/g, "");
}

export async function sendWhatsAppCloudMessage(
  params: SendWhatsAppCloudMessageParams,
): Promise<{ messageId: string; raw: any }> {
  const config = getWhatsAppCloudConfig();
  const recipient = normalizeWhatsAppRecipient(params.recipientId);
  if (!recipient) throw new Error("Destinatário do WhatsApp inválido.");

  const payload: Record<string, any> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: params.kind,
  };

  if (params.kind === "text") {
    payload.text = { body: String(params.text || ""), preview_url: false };
  } else if (params.kind === "audio") {
    if (!params.mediaUrl) throw new Error("URL do áudio do WhatsApp ausente.");
    payload.audio = {
      link: params.mediaUrl,
      ...(params.voiceNote ? { voice: true } : {}),
    };
  } else if (params.kind === "sticker") {
    if (!params.mediaUrl) throw new Error("URL da figurinha do WhatsApp ausente.");
    payload.sticker = { link: params.mediaUrl };
  } else {
    if (!params.mediaUrl) throw new Error("URL da imagem do WhatsApp ausente.");
    payload.image = { link: params.mediaUrl };
  }

  if (params.replyToMessageId) {
    payload.context = { message_id: params.replyToMessageId };
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  );

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = raw?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Falha no envio pelo WhatsApp Cloud API: ${message}`);
  }

  const messageId = String(raw?.messages?.[0]?.id || "");
  if (!messageId) throw new Error("WhatsApp não retornou o ID da mensagem enviada.");
  return { messageId, raw };
}

function extensionForContentType(contentType: string, kind: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("mp4")) return kind === "audio" ? "m4a" : "mp4";
  if (type.includes("aac")) return "aac";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  return kind === "audio" ? "ogg" : kind === "video" ? "mp4" : kind === "sticker" ? "webp" : "jpg";
}

export async function persistWhatsAppInboundMedia(
  supabase: any,
  params: {
    mediaId: string;
    messageId: string;
    kind: "audio" | "image" | "video" | "sticker";
  },
): Promise<string | null> {
  const config = getWhatsAppCloudConfig();
  const mediaInfoResponse = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${params.mediaId}?phone_number_id=${encodeURIComponent(config.phoneNumberId)}`,
    {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );

  const mediaInfo = await mediaInfoResponse.json().catch(() => ({}));
  if (!mediaInfoResponse.ok || !mediaInfo?.url) {
    throw new Error(mediaInfo?.error?.message || "Não foi possível resolver a mídia do WhatsApp.");
  }

  const mediaResponse = await fetch(String(mediaInfo.url), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!mediaResponse.ok) {
    throw new Error(`Falha ao baixar mídia do WhatsApp (HTTP ${mediaResponse.status}).`);
  }

  const contentType = mediaResponse.headers.get("content-type") || "";
  const bytes = await mediaResponse.arrayBuffer();
  const safeId = params.messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = extensionForContentType(contentType, params.kind);
  const fileName = `whatsapp/${params.kind}_${safeId}.${ext}`;

  const { data, error } = await supabase.storage
    .from("vendeo_vault")
    .upload(fileName, bytes, {
      contentType: contentType || undefined,
      upsert: true,
    });

  if (error || !data?.path) {
    throw new Error(error?.message || "Falha ao persistir mídia do WhatsApp no Storage.");
  }

  const { data: publicData } = supabase.storage.from("vendeo_vault").getPublicUrl(data.path);
  return publicData?.publicUrl || null;
}
