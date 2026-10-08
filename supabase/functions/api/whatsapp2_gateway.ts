export type WhatsApp2DeliveryKind = "text" | "audio" | "image" | "video" | "sticker";

export interface WhatsApp2QueuedDeliveryParams {
  supabase: any;
  queueId: string;
  conversationId: string;
  gatewayAccountId?: string;
  recipientId: string;
  kind: WhatsApp2DeliveryKind;
  text?: string;
  mediaUrl?: string;
  voiceNote?: boolean;
  replyToMessageId?: string | null;
  saveRecipientContact?: boolean;
  recipientContactName?: string;
  timeoutMs?: number;
}

export function whatsapp2AccountIdFromConversationId(conversationId: string): string {
  const match = /^wa2:([^:]+):/.exec(String(conversationId || "").trim());
  return match?.[1] || "primary";
}

export function whatsapp2ProviderIdFromConversationId(conversationId: string): string {
  return String(conversationId || "").trim()
    .replace(/^wa2:(?:account-\d{8,15}:)?/i, "");
}

export type WhatsApp2ContactSaveStatus = "not_requested" | "not_sent" | "pending" | "saved" | "failed";

export interface WhatsApp2QueuedDeliveryResult {
  success: boolean;
  providerMessageId?: string;
  isUncertain?: boolean;
  error?: string;
  contactSaveStatus?: WhatsApp2ContactSaveStatus;
  contactSaveError?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueAndWaitWhatsApp2Delivery(
  params: WhatsApp2QueuedDeliveryParams,
): Promise<WhatsApp2QueuedDeliveryResult> {
  const {
    supabase,
    queueId,
    conversationId,
    gatewayAccountId = whatsapp2AccountIdFromConversationId(conversationId),
    recipientId,
    kind,
    text,
    mediaUrl,
    voiceNote = false,
    replyToMessageId = null,
    saveRecipientContact = false,
    recipientContactName = "",
    timeoutMs = 18_000,
  } = params;

  if (!supabase || !queueId || !conversationId || !recipientId) {
    return { success: false, error: "whatsapp2_delivery_invalid_params" };
  }

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp2_delivery_queue")
    .select("id,status,provider_message_id,last_error,recipient_contact_save_status,recipient_contact_save_error,gateway_account_id")
    .eq("id", queueId)
    .maybeSingle();

  if (existingError) {
    return { success: false, error: existingError.message || "whatsapp2_delivery_lookup_failed" };
  }
  if (existing && String(existing.gateway_account_id || "primary") !== gatewayAccountId) {
    return { success: false, error: "whatsapp2_delivery_account_mismatch" };
  }
  if (existing?.status === "sent" && existing.provider_message_id) {
    return {
      success: true,
      providerMessageId: existing.provider_message_id,
      contactSaveStatus: existing.recipient_contact_save_status || "not_requested",
      contactSaveError: existing.recipient_contact_save_error || undefined,
    };
  }
  if (existing?.status === "uncertain") {
    return {
      success: false,
      isUncertain: true,
      error: existing.last_error || "whatsapp2_delivery_uncertain",
    };
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from("whatsapp2_delivery_queue")
      .insert({
        id: queueId,
        conversation_id: conversationId,
        gateway_account_id: gatewayAccountId,
        recipient_id: recipientId,
        kind,
        text_content: text || null,
        media_url: mediaUrl || null,
        voice_note: voiceNote === true,
        reply_to_message_id: replyToMessageId || null,
        save_recipient_contact: saveRecipientContact === true,
        recipient_contact_name: recipientContactName || null,
        recipient_contact_save_status: saveRecipientContact ? "pending" : "not_requested",
        status: "pending",
        attempts: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (insertError) {
      const duplicate = String(insertError.code || "") === "23505";
      if (!duplicate) {
        return { success: false, error: insertError.message || "whatsapp2_delivery_insert_failed" };
      }
    }
  } else if (existing.status === "failed") {
    const { error: retryError } = await supabase
      .from("whatsapp2_delivery_queue")
      .update({
        status: "pending",
        gateway_account_id: gatewayAccountId,
        recipient_id: recipientId,
        kind,
        text_content: text || null,
        media_url: mediaUrl || null,
        voice_note: voiceNote === true,
        reply_to_message_id: replyToMessageId || null,
        save_recipient_contact: saveRecipientContact === true,
        recipient_contact_name: recipientContactName || null,
        recipient_contact_save_status: saveRecipientContact ? "pending" : "not_requested",
        recipient_contact_save_error: null,
        recipient_contact_saved_at: null,
        last_error: null,
        claimed_by: null,
        claimed_at: null,
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queueId)
      .eq("status", "failed");
    if (retryError) {
      return { success: false, error: retryError.message || "whatsapp2_delivery_retry_failed" };
    }
  }
  const deadline = Date.now() + Math.max(2_000, timeoutMs);
  while (Date.now() < deadline) {
    await sleep(350);
    const { data: row, error } = await supabase
      .from("whatsapp2_delivery_queue")
      .select("status,provider_message_id,last_error,recipient_contact_save_status,recipient_contact_save_error,gateway_account_id")
      .eq("id", queueId)
      .maybeSingle();

    if (error) {
      return { success: false, isUncertain: true, error: error.message || "whatsapp2_delivery_poll_failed" };
    }
    if (!row) continue;
    if (String(row.gateway_account_id || "primary") !== gatewayAccountId) {
      return { success: false, error: "whatsapp2_delivery_account_mismatch" };
    }
    if (row.status === "sent") {
      if (!row.provider_message_id) {
        return { success: false, isUncertain: true, error: "whatsapp2_sent_without_provider_id" };
      }
      return {
        success: true,
        providerMessageId: row.provider_message_id,
        contactSaveStatus: row.recipient_contact_save_status || "not_requested",
        contactSaveError: row.recipient_contact_save_error || undefined,
      };
    }
    if (row.status === "failed" || row.status === "cancelled") {
      return { success: false, error: row.last_error || `whatsapp2_delivery_${row.status}` };
    }
    if (row.status === "uncertain") {
      return { success: false, isUncertain: true, error: row.last_error || "whatsapp2_delivery_uncertain" };
    }
  }

  return {
    success: false,
    isUncertain: true,
    error: "whatsapp2_delivery_timeout",
  };
}
