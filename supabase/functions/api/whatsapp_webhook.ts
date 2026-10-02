import { isActionableInboundMessage } from "./ConversationQualityGate.ts";
import {
  persistWhatsAppInboundMedia,
  toWhatsAppConversationId,
} from "./whatsapp_cloud.ts";

function whatsappTimestamp(value: unknown): string {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function contactNameFor(value: any, waId: string): string {
  const contact = (value?.contacts || []).find((item: any) => String(item?.wa_id || "") === waId)
    || value?.contacts?.[0];
  return String(contact?.profile?.name || waId);
}

function statusPatch(status: any): Record<string, unknown> | null {
  const value = String(status?.status || "").toLowerCase();
  if (value === "read") {
    return { status: "seen", seen_at: whatsappTimestamp(status?.timestamp) };
  }
  if (value === "failed") return { status: "failed" };
  if (value === "sent" || value === "delivered") return { status: "sent" };
  return null;
}

async function processWhatsAppStatus(supabase: any, status: any): Promise<void> {
  const providerMessageId = String(status?.id || "");
  const patch = statusPatch(status);
  if (!providerMessageId || !patch) return;

  const { data: updatedRows } = await supabase
    .from("instagram_messages")
    .update(patch)
    .eq("id", providerMessageId)
    .eq("channel", "whatsapp")
    .select("conversation_id");

  const conversationId = updatedRows?.[0]?.conversation_id;
  if (!conversationId) return;

  const conversationPatch: Record<string, unknown> = {
    last_status: patch.status,
    updated_at: new Date().toISOString(),
  };
  if (patch.seen_at) conversationPatch.seen_at = patch.seen_at;

  await supabase
    .from("instagram_conversations")
    .update(conversationPatch)
    .eq("id", conversationId)
    .eq("channel", "whatsapp");
}

async function resolveInboundContent(
  supabase: any,
  message: any,
): Promise<{ text: string; preview: string; mediaUrl: string | null; mediaType: string | null }> {
  const type = String(message?.type || "unknown");
  if (type === "text") {
    const text = String(message?.text?.body || "").trim();
    return { text, preview: text, mediaUrl: null, mediaType: null };
  }

  if (type === "audio" || type === "image" || type === "video") {
    const mediaId = String(message?.[type]?.id || "");
    if (!mediaId) throw new Error(`WhatsApp enviou ${type} sem media id.`);

    const mediaUrl = await persistWhatsAppInboundMedia(supabase, {
      mediaId,
      messageId: String(message?.id || mediaId),
      kind: type,
    });

    if (!mediaUrl) throw new Error(`Não foi possível persistir ${type} recebido no WhatsApp.`);
    const label = type === "audio"
      ? "🎙️ Mensagem de voz"
      : type === "image"
      ? "📷 Foto"
      : "🎬 Vídeo";
    return {
      text: `[${type}:${mediaUrl}]`,
      preview: label,
      mediaUrl,
      mediaType: type,
    };
  }

  if (type === "button") {
    const text = String(message?.button?.text || "").trim();
    return { text, preview: text || "Resposta de botão", mediaUrl: null, mediaType: null };
  }

  if (type === "interactive") {
    const text = String(
      message?.interactive?.button_reply?.title
      || message?.interactive?.list_reply?.title
      || "",
    ).trim();
    return { text, preview: text || "Resposta interativa", mediaUrl: null, mediaType: null };
  }

  if (type === "location") {
    const latitude = message?.location?.latitude;
    const longitude = message?.location?.longitude;
    const text = latitude != null && longitude != null
      ? `Localização: ${latitude}, ${longitude}`
      : "📍 Localização";
    return { text, preview: "📍 Localização", mediaUrl: null, mediaType: null };
  }

  return {
    text: `[whatsapp:${type}]`,
    preview: "Mensagem do WhatsApp",
    mediaUrl: null,
    mediaType: null,
  };
}

export async function handleWhatsAppWebhook(
  supabase: any,
  body: any,
): Promise<{ success: true; processedMessages: number; processedStatuses: number }> {
  let processedMessages = 0;
  let processedStatuses = 0;
  const configuredPhoneNumberId = (Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "").trim();

  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const field = String(change?.field || "");
      const value = change?.value || {};
      const messagingProduct = String(value?.messaging_product || "");
      const incomingPhoneNumberId = String(value?.metadata?.phone_number_id || "");
      const mask = (value: string) => value ? `***${value.slice(-4)}` : "(empty)";

      console.log("[WhatsApp Webhook] Evento recebido", {
        field,
        messagingProduct,
        messages: Array.isArray(value?.messages) ? value.messages.length : 0,
        statuses: Array.isArray(value?.statuses) ? value.statuses.length : 0,
        incomingPhoneNumberId: mask(incomingPhoneNumberId),
        configuredPhoneNumberId: mask(configuredPhoneNumberId),
      });

      if (field !== "messages") continue;
      if (messagingProduct !== "whatsapp") continue;

      if (
        configuredPhoneNumberId
        && incomingPhoneNumberId
        && incomingPhoneNumberId !== configuredPhoneNumberId
      ) {
        console.warn("[WhatsApp Webhook] phone_number_id diferente do configurado", {
          incoming: mask(incomingPhoneNumberId),
          configured: mask(configuredPhoneNumberId),
        });
        continue;
      }

      for (const status of value?.statuses || []) {
        await processWhatsAppStatus(supabase, status);
        processedStatuses += 1;
      }

      for (const message of value?.messages || []) {
        const senderId = String(message?.from || "").replace(/\D/g, "");
        const messageId = String(message?.id || "");
        if (!senderId || !messageId) continue;

        const conversationId = toWhatsAppConversationId(senderId);
        const contactName = contactNameFor(value, senderId);
        const content = await resolveInboundContent(supabase, message);
        const timestamp = whatsappTimestamp(message?.timestamp);
        const replyToMessageId = message?.context?.id ? String(message.context.id) : null;
        const actionable = isActionableInboundMessage({
          text: content.text,
          mediaType: content.mediaType || undefined,
          audioTranscript: null,
        });

        const { data, error } = await supabase.rpc("ingest_whatsapp_inbound_atomic", {
          p_conversation_id: conversationId,
          p_raw_contact_id: senderId,
          p_message_id: messageId,
          p_sender_id: senderId,
          p_contact_name: contactName,
          p_text: content.text,
          p_timestamp: timestamp,
          p_preview_text: content.preview,
          p_media_url: content.mediaUrl,
          p_media_type: content.mediaType,
          p_reply_to_message_id: replyToMessageId,
          p_audio_transcript: null,
          p_audio_transcription_error: null,
          p_actionable: actionable,
        });

        if (error || data?.success !== true) {
          throw new Error(
            `Falha ao persistir inbound WhatsApp: ${error?.message || data?.reason || "unknown"}`,
          );
        }
        processedMessages += 1;
      }
    }
  }

  return { success: true, processedMessages, processedStatuses };
}
