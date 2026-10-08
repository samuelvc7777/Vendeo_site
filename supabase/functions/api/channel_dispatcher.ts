/**
 * channel_dispatcher.ts
 *
 * Dispatcher determinístico multi-canal (Instagram Direct, WhatsApp2, Tinder).
 * Garante entrega pelo adaptador solicitado SEM fallback silencioso entre canais.
 * Autoridade: CONTEXT.md e ADR 0004.
 */

import {
  enqueueAndWaitWhatsApp2Delivery,
  whatsapp2ProviderIdFromConversationId,
} from "./whatsapp2_gateway.ts";
import { sendTinderMatchMessageForBackground } from "./tinder_match_routes.ts";

export interface OutboxEntryPayload {
  id?: string;
  idempotencyKey?: string;
  conversationId: string;
  recipientId?: string;
  channel?: "instagram" | "whatsapp" | "whatsapp2" | "tinder";
  messageType: "text" | "audio" | "image" | "video";
  content: string;
  mediaUrl?: string;
  vaultAudioId?: string;
  replyToMessageId?: string | null;
  payload?: Record<string, unknown>;
  status?: string;
  isUncertain?: boolean;
  lastError?: string;
  sentAt?: string;
  providerMessageId?: string | null;
}

export interface DispatchOutcome {
  success: boolean;
  channelUsed: "instagram" | "whatsapp" | "whatsapp2" | "tinder";
  providerMessageId?: string | null;
  isUncertain?: boolean;
  error?: string | null;
}

/**
 * Guarda de segurança estrita:
 * Impede chamadas reais de envio/leitura contra endpoints de terceiros do Tinder
 * enquanto a extensão formal da autorização escrita não estiver confirmada e a flag
 * de ambiente ENABLE_TINDER_LIVE_DISPATCH não for ativada explicitamente.
 */
export function isTinderLiveDispatchEnabled(): boolean {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
      return Deno.env.get("ENABLE_TINDER_LIVE_DISPATCH") === "true";
    }
  } catch {}
  try {
    if (typeof process !== "undefined" && process?.env) {
      return process.env.ENABLE_TINDER_LIVE_DISPATCH === "true";
    }
  } catch {}
  return false;
}

/**
 * Envio de mensagem pelo Tinder usando a mesma rota server-side já usada pelo Match.
 */
export async function sendTinderMessage(params: {
  supabase: any;
  matchId: string;
  text: string;
  tinderTokenOverride?: string;
}): Promise<{ success: boolean; providerMessageId?: string | null; error?: string }> {
  const { supabase, matchId, text, tinderTokenOverride } = params;

  if (!isTinderLiveDispatchEnabled()) {
    return {
      success: false,
      error: "tinder_live_dispatch_blocked_pending_scope_validation: chamadas reais ao Tinder bloqueadas por segurança até validação formal do escopo da autorização escrita",
    };
  }

  try {
    const sent = await sendTinderMatchMessageForBackground(
      supabase,
      matchId,
      text,
      tinderTokenOverride,
    );
    return {
      success: true,
      providerMessageId: sent.providerMessageId,
    };
  } catch (err: any) {
    const errorMessage = String(err?.message || err);
    return {
      success: false,
      error: errorMessage === "MATCH_TINDER_NOT_CONNECTED"
        ? "tinder_token_not_configured_or_inactive"
        : `tinder_dispatch_failed: ${errorMessage}`,
    };
  }
}

/**
 * Dispatcher canônico com seleção explícita de canal.
 * Garante que uma ação Tinder NUNCA tente chamar a Graph API do Instagram.
 */
export async function dispatchOutboundAction(params: {
  supabase: any;
  outboxEntry: OutboxEntryPayload;
  tinderTokenOverride?: string;
  mockAdapters?: {
    tinder?: (entry: OutboxEntryPayload) => Promise<{ success: boolean; providerMessageId?: string; error?: string }>;
    whatsapp2?: (entry: OutboxEntryPayload) => Promise<{ success: boolean; providerMessageId?: string; isUncertain?: boolean; error?: string }>;
    instagram?: (entry: OutboxEntryPayload) => Promise<{ success: boolean; providerMessageId?: string; error?: string }>;
  };
}): Promise<DispatchOutcome> {
  const { supabase, outboxEntry, tinderTokenOverride, mockAdapters } = params;
  const conversationId = outboxEntry.conversationId;

  // 1. Resolução do canal:
  // Se a própria ação especificou o canal no outboxEntry, esse canal é a autoridade máxima.
  let targetChannel: "instagram" | "whatsapp" | "whatsapp2" | "tinder" = outboxEntry.channel as any;

  if (!targetChannel) {
    const { data: convRow } = await supabase
      .from("instagram_conversations")
      .select("channel, contact_id")
      .eq("id", conversationId)
      .maybeSingle();

    targetChannel = (convRow?.channel as any) || "instagram";
  }

  // ==========================================
  // CANAL: TINDER
  // ==========================================
  if (targetChannel === "tinder") {
    if (outboxEntry.messageType === "video") {
      return {
        success: false,
        channelUsed: "tinder",
        error: "tinder_video_unsupported",
      };
    }
    if (mockAdapters?.tinder) {
      const mockRes = await mockAdapters.tinder(outboxEntry);
      return {
        success: mockRes.success,
        channelUsed: "tinder",
        providerMessageId: mockRes.providerMessageId,
        error: mockRes.error,
      };
    }

    const matchId = outboxEntry.recipientId || conversationId.replace(/^tinder:/, "");
    const sendRes = await sendTinderMessage({
      supabase,
      matchId,
      text: outboxEntry.content,
      tinderTokenOverride,
    });

    return {
      success: sendRes.success,
      channelUsed: "tinder",
      providerMessageId: sendRes.providerMessageId,
      error: sendRes.error,
    };
  }

  // ==========================================
  // CANAL: WHATSAPP2
  // ==========================================
  if (targetChannel === "whatsapp2") {
    if (mockAdapters?.whatsapp2) {
      const mockRes = await mockAdapters.whatsapp2(outboxEntry);
      return {
        success: mockRes.success,
        channelUsed: "whatsapp2",
        providerMessageId: mockRes.providerMessageId,
        isUncertain: mockRes.isUncertain,
        error: mockRes.error,
      };
    }

    let mediaUrl: string | undefined;
    let voiceNote = false;
    let kind: "text" | "audio" | "image" | "video" | "sticker" = "text";

    if (outboxEntry.messageType === "audio") {
      kind = "audio";
      mediaUrl = outboxEntry.mediaUrl || outboxEntry.content;
      if (mediaUrl?.startsWith("[audio:") && mediaUrl.endsWith("]")) {
        mediaUrl = mediaUrl.slice(7, -1).trim();
      }
      if (outboxEntry.vaultAudioId) {
        const { data: audioVariant } = await supabase
          .from("persona_audios")
          .select("whatsapp_audio_url")
          .eq("id", outboxEntry.vaultAudioId)
          .maybeSingle();
        const whatsappAudioUrl = String(audioVariant?.whatsapp_audio_url || "").trim();
        if (whatsappAudioUrl) {
          mediaUrl = whatsappAudioUrl;
          voiceNote = true;
        }
      }
    } else if (outboxEntry.messageType === "image") {
      kind = "image";
      mediaUrl = outboxEntry.mediaUrl || (
        typeof outboxEntry.payload?.mediaUrl === "string"
          ? outboxEntry.payload.mediaUrl
          : undefined
      );
    } else if (outboxEntry.messageType === "video") {
      kind = "video";
      mediaUrl = outboxEntry.mediaUrl || (
        typeof outboxEntry.payload?.mediaUrl === "string"
          ? outboxEntry.payload.mediaUrl
          : undefined
      );
    }

    const replyToMessageId = outboxEntry.replyToMessageId
      || (typeof outboxEntry.payload?.replyToMessageId === "string"
        ? outboxEntry.payload.replyToMessageId
        : null);

    const recipientId = outboxEntry.recipientId || whatsapp2ProviderIdFromConversationId(conversationId);

    const delivery = await enqueueAndWaitWhatsApp2Delivery({
      supabase,
      queueId: outboxEntry.idempotencyKey || outboxEntry.id || `outbox_${Date.now()}`,
      conversationId,
      recipientId,
      kind,
      text: kind === "text" ? outboxEntry.content : undefined,
      mediaUrl,
      voiceNote,
      replyToMessageId,
      timeoutMs: 18_000,
    });

    if (!delivery.success) {
      if (delivery.isUncertain) {
        return {
          success: false,
          channelUsed: "whatsapp2",
          isUncertain: true,
          error: delivery.error || "whatsapp2_delivery_uncertain",
        };
      }
      return {
        success: false,
        channelUsed: "whatsapp2",
        error: delivery.error || "whatsapp2_delivery_failed",
      };
    }

    return {
      success: true,
      channelUsed: "whatsapp2",
      providerMessageId: delivery.providerMessageId,
    };
  }

  // ==========================================
  // CANAL: INSTAGRAM (META GRAPH API)
  // ==========================================
  if (targetChannel === "instagram") {
    if (mockAdapters?.instagram) {
      const mockRes = await mockAdapters.instagram(outboxEntry);
      return {
        success: mockRes.success,
        channelUsed: "instagram",
        providerMessageId: mockRes.providerMessageId,
        error: mockRes.error,
      };
    }

    const { data: configRow } = await supabase
      .from("instagram_config")
      .select("access_token")
      .eq("id", "default")
      .maybeSingle();

    const accessToken = configRow?.access_token;
    if (!accessToken) {
      return {
        success: false,
        channelUsed: "instagram",
        error: "instagram_access_token_missing",
      };
    }

    const recipientId = outboxEntry.recipientId || conversationId;
    let bodyPayload: any;

    if (outboxEntry.messageType === "audio") {
      let audioUrl = outboxEntry.content;
      if (audioUrl.startsWith("[audio:") && audioUrl.endsWith("]")) {
        audioUrl = audioUrl.slice(7, -1).trim();
      }
      bodyPayload = {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "audio",
            payload: { url: audioUrl, is_reusable: false },
          },
        },
      };
    } else if (outboxEntry.messageType === "image" || outboxEntry.messageType === "video") {
      const mediaUrl = String(outboxEntry.mediaUrl || outboxEntry.content || "")
        .replace(/^\[(?:image|video):/, "")
        .replace(/\]$/, "")
        .trim();
      if (!mediaUrl) {
        return {
          success: false,
          channelUsed: "instagram",
          error: `${outboxEntry.messageType}_url_missing`,
        };
      }
      bodyPayload = {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: outboxEntry.messageType,
            payload: { url: mediaUrl },
          },
        },
      };
    } else {
      bodyPayload = {
        recipient: { id: recipientId },
        message: { text: outboxEntry.content },
      };
    }

    try {
      const res = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          channelUsed: "instagram",
          error: json?.error?.message || `graph_api_status_${res.status}`,
        };
      }

      return {
        success: true,
        channelUsed: "instagram",
        providerMessageId: json?.message_id || null,
      };
    } catch (err: any) {
      return {
        success: false,
        channelUsed: "instagram",
        error: `instagram_network_error: ${err?.message || String(err)}`,
      };
    }
  }

  return {
    success: false,
    channelUsed: targetChannel,
    error: `unsupported_channel: ${targetChannel}`,
  };
}
