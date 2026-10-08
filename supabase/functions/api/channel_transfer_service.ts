/**
 * channel_transfer_service.ts
 *
 * Serviço determinístico de transferência de conversas entre canais (Tinder -> WhatsApp2).
 * Mantém a mesma identidade canônica, sessão de Brain, cronograma e checkpoints.
 * O backend apenas transporta, valida invariantes e retorna fatos reais ao Brain.
 * Autoridade: CONTEXT.md e ADR 0004.
 */

import {
  normalizePhoneNumber,
  classifyTransferOutcome,
  isChannelTransferPermitted,
  type ChannelTransferStatus,
  type SupportedChannel,
} from "./channel_identity.ts";
import {
  linkExternalChannelIdentity,
  checkPhoneCollision,
} from "./multichannel_identity_service.ts";
import {
  enqueueAndWaitWhatsApp2Delivery,
  type WhatsApp2QueuedDeliveryParams,
  type WhatsApp2QueuedDeliveryResult,
} from "./whatsapp2_gateway.ts";

export interface ExecuteTransferParams {
  supabase: any;
  conversationId: string;
  sourceChannel: SupportedChannel;
  targetChannel: SupportedChannel;
  targetPhoneRaw: string;
  initialMessageText: string;
  recipientContactName?: string;
  idempotencyKey?: string;
  whatsapp2Delivery?: (params: WhatsApp2QueuedDeliveryParams) => Promise<WhatsApp2QueuedDeliveryResult>;
  mockGateway?: (params: {
    recipientId: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<{
    success: boolean;
    isUncertain?: boolean;
    error?: string;
    providerMessageId?: string;
    contactSaveStatus?: "not_requested" | "not_sent" | "pending" | "saved" | "failed";
    contactSaveError?: string;
  }>;
}

export interface ExecuteTransferResult {
  success: boolean;
  status: ChannelTransferStatus;
  isUncertain?: boolean;
  providerMessageId?: string | null;
  contactSaveStatus?: "not_requested" | "not_sent" | "pending" | "saved" | "failed";
  brainFact: {
    event: "transfer_confirmed" | "transfer_failed" | "transfer_uncertain";
    technicalCode: string;
    rawInput?: string;
    details?: string;
  };
}

/**
 * Executa a tentativa de transferência de canal conforme decisão do Brain.
 */
export async function executeChannelTransfer(
  params: ExecuteTransferParams
): Promise<ExecuteTransferResult> {
  const {
    supabase,
    conversationId,
    sourceChannel,
    targetChannel,
    targetPhoneRaw,
    initialMessageText,
    recipientContactName,
    idempotencyKey,
    mockGateway,
    whatsapp2Delivery,
  } = params;

  if (!isChannelTransferPermitted(sourceChannel, targetChannel)) {
    return {
      success: false,
      status: "failed",
      brainFact: {
        event: "transfer_failed",
        technicalCode: "transfer_channel_pair_not_permitted",
        details: `Transferência não permitida entre ${sourceChannel} e ${targetChannel}.`,
      },
    };
  }

  const saveRecipientContact = sourceChannel === "tinder" && targetChannel === "whatsapp2";

  const nowIso = new Date().toISOString();

  // 1. Validação estrutural do número de telefone (Invariante determinística)
  const normalized = normalizePhoneNumber(targetPhoneRaw);
  if (!normalized) {
    // Backend NÃO inventa conversa nem declara invalidade semântica.
    // Apenas retorna o código técnico ao Brain.
    return {
      success: false,
      status: "failed",
      brainFact: {
        event: "transfer_failed",
        technicalCode: "phone_format_unparseable",
        rawInput: targetPhoneRaw,
        details: "O número fornecido não pôde ser estruturado em formato telefônico válido.",
      },
    };
  }

  // 2. Chave de idempotência determinística estável
  const cleanPhone = normalized.e164;
  const resolvedIdempotencyKey = idempotencyKey || `transfer:${conversationId}:${cleanPhone}`;

  // 3. Consulta de idempotência prévia e reconciliação
  const { data: existingTransfer } = await supabase
    .from("conversation_channel_transfers")
    .select("status, provider_message_id, failure_reason, metadata")
    .eq("idempotency_key", resolvedIdempotencyKey)
    .maybeSingle();

  if (existingTransfer) {
    if (existingTransfer.status === "confirmed") {
      return {
        success: true,
        status: "confirmed",
        providerMessageId: existingTransfer.provider_message_id || null,
        contactSaveStatus: existingTransfer.metadata?.recipientContactSaveStatus || "pending",
        brainFact: {
          event: "transfer_confirmed",
          technicalCode: "delivery_already_confirmed",
        },
      };
    }

    if (existingTransfer.status === "uncertain") {
      // REGRA CRÍTICA: Nenhum retry cego em incerteza!
      return {
        success: false,
        status: "uncertain",
        isUncertain: true,
        providerMessageId: existingTransfer.provider_message_id || null,
        brainFact: {
          event: "transfer_uncertain",
          technicalCode: "gateway_uncertain_pending_reconciliation",
          details: "Envio anterior em estado incerto. Novo disparo cego bloqueado para evitar duplicação.",
          rawInput: targetPhoneRaw,
        },
      };
    }

    if (existingTransfer.status === "sending") {
      // Bloqueia reenvio concorrente enquanto o processo anterior ainda está em envio
      return {
        success: false,
        status: "uncertain",
        isUncertain: true,
        providerMessageId: existingTransfer.provider_message_id || null,
        brainFact: {
          event: "transfer_uncertain",
          technicalCode: "transfer_in_progress_concurrent",
          details: "Envio anterior ainda em processamento ativo. Novo disparo cego bloqueado.",
          rawInput: targetPhoneRaw,
        },
      };
    }
  }

  // 4. Prevenção de colisão e bloqueio de merge silencioso
  const collision = await checkPhoneCollision({
    supabase,
    phoneE164: normalized.e164,
    currentConversationId: conversationId,
  });

  if (collision.error) {
    return {
      success: false,
      status: "failed",
      brainFact: {
        event: "transfer_failed",
        technicalCode: "phone_collision_check_unavailable",
        details: collision.error,
        rawInput: targetPhoneRaw,
      },
    };
  }

  if (collision.hasCollision) {
    await supabase.from("conversation_channel_transfers").upsert({
      conversation_id: conversationId,
      source_channel: sourceChannel,
      target_channel: targetChannel,
      target_recipient: normalized.e164,
      initial_message_text: initialMessageText,
      status: "failed",
      failure_reason: `collision_with_conversation_${collision.conflictingConversationId}`,
      idempotency_key: resolvedIdempotencyKey,
      metadata: {
        collision: true,
        conflictingConversationId: collision.conflictingConversationId,
        rawInput: targetPhoneRaw,
      },
      updated_at: nowIso,
    }, { onConflict: "idempotency_key" });

    return {
      success: false,
      status: "failed",
      brainFact: {
        event: "transfer_failed",
        technicalCode: "phone_collision_existing_contact",
        rawInput: targetPhoneRaw,
        details: "Este número já pertence a outra conversa cadastrada. Fusão automática bloqueada por segurança.",
      },
    };
  }

  // 5. Persistência durável da tentativa antes do envio (Fail-safe e idempotência)
  const { error: upsertErr } = await supabase.from("conversation_channel_transfers").upsert({
    conversation_id: conversationId,
    source_channel: sourceChannel,
    target_channel: targetChannel,
    target_recipient: normalized.e164,
    initial_message_text: initialMessageText,
    status: "sending",
    idempotency_key: resolvedIdempotencyKey,
    metadata: {
      rawInput: targetPhoneRaw,
      normalized,
    },
    updated_at: nowIso,
  }, { onConflict: "idempotency_key" });

  if (upsertErr) {
    return {
      success: false,
      status: "failed",
      brainFact: {
        event: "transfer_failed",
        technicalCode: "transfer_persistence_failed",
        details: upsertErr.message,
        rawInput: targetPhoneRaw,
      },
    };
  }

  // 6. Disparo do envio no destino (WhatsApp2)
  let gatewayResult: {
    success: boolean;
    isUncertain?: boolean;
    error?: string;
    providerMessageId?: string;
    contactSaveStatus?: "not_requested" | "not_sent" | "pending" | "saved" | "failed";
    contactSaveError?: string;
  };

  if (mockGateway) {
    gatewayResult = await mockGateway({
      recipientId: normalized.e164,
      text: initialMessageText,
      idempotencyKey: resolvedIdempotencyKey,
    });
  } else {
    // Gateway real de WhatsApp2
    const enqueueDelivery = whatsapp2Delivery || enqueueAndWaitWhatsApp2Delivery;
    const delivery = await enqueueDelivery({
      supabase,
      queueId: resolvedIdempotencyKey,
      conversationId,
      recipientId: normalized.e164,
      kind: "text",
      text: initialMessageText,
      saveRecipientContact,
      recipientContactName,
      timeoutMs: 18_000,
    });

    gatewayResult = {
      success: delivery.success,
      isUncertain: delivery.isUncertain,
      error: delivery.error,
      providerMessageId: delivery.providerMessageId || undefined,
      contactSaveStatus: delivery.contactSaveStatus || (saveRecipientContact
        ? (delivery.success ? "pending" : "not_sent")
        : "not_requested"),
      contactSaveError: delivery.contactSaveError,
    };
  }

  // 7. Classificação do resultado e persistência do estado durável
  const classified = classifyTransferOutcome(gatewayResult);

  // Atualiza registro da transferência verificando persistência
  const { error: updateErr } = await supabase
    .from("conversation_channel_transfers")
    .update({
      status: classified.status,
      provider_message_id: gatewayResult.providerMessageId || null,
      failure_reason: gatewayResult.error || null,
      metadata: {
        rawInput: targetPhoneRaw,
        normalized,
        recipientContactSaveStatus: gatewayResult.contactSaveStatus || (saveRecipientContact
          ? (gatewayResult.success ? "pending" : "not_sent")
          : "not_requested"),
        ...(gatewayResult.contactSaveError ? { recipientContactSaveError: gatewayResult.contactSaveError } : {}),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("idempotency_key", resolvedIdempotencyKey);

  if (updateErr) {
    console.error("[TransferService] Erro ao atualizar status da transferência após envio pelo provider:", updateErr);
    // CRÍTICO: Não reporta sucesso reconciliado nem permite retry cego.
    // O provider enviou a mensagem, mas a persistência do resultado local falhou.
    // O estado é modelado como incerto para evitar disparos duplicados em reprocessamentos.
    return {
      success: false,
      status: "uncertain",
      isUncertain: true,
      providerMessageId: gatewayResult.providerMessageId || null,
      brainFact: {
        event: "transfer_uncertain",
        technicalCode: "persistence_failed_after_delivery",
        details: `Mensagem entregue ao provider (${gatewayResult.providerMessageId}), mas falhou a persistência do resultado local: ${updateErr.message}`,
        rawInput: targetPhoneRaw,
      },
    };
  }

  // 8. Se confirmada a entrega, vincula canonicamente a nova identidade à mesma conversa
  if (classified.status === "confirmed") {
    const linkRes = await linkExternalChannelIdentity({
      supabase,
      conversationId,
      channel: targetChannel,
      externalIdentityId: normalized.e164,
      metadata: {
        transferredFrom: sourceChannel,
        transferredAt: nowIso,
        verifiedPhone: normalized,
        recipientContactSaveStatus: gatewayResult.contactSaveStatus || (saveRecipientContact ? "pending" : "not_requested"),
        ...(gatewayResult.contactSaveError ? { recipientContactSaveError: gatewayResult.contactSaveError } : {}),
      },
      status: "active",
    });

    if (!linkRes.success) {
      return {
        success: false,
        status: "failed",
        brainFact: {
          event: "transfer_failed",
          technicalCode: "channel_link_failed",
          details: linkRes.error || "Mensagem enviada, mas vínculo multi-canal falhou.",
          rawInput: targetPhoneRaw,
        },
      };
    }

    // Vincula também o canal de origem se não existir
    await linkExternalChannelIdentity({
      supabase,
      conversationId,
      channel: sourceChannel,
      externalIdentityId: conversationId.replace(/^tinder:/, ""),
      status: "transferred",
    });
  }

  return {
    success: classified.status === "confirmed",
    status: classified.status,
    providerMessageId: gatewayResult.providerMessageId || null,
    contactSaveStatus: gatewayResult.contactSaveStatus || (saveRecipientContact
      ? (gatewayResult.success ? "pending" : "not_sent")
      : "not_requested"),
    brainFact: {
      ...classified.brainFact,
      technicalCode: classified.brainFact.technicalCode || "transfer_result_unclassified",
      rawInput: targetPhoneRaw,
    },
  };
}
