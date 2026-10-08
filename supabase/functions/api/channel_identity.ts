/**
 * channel_identity.ts
 *
 * Entidades e Objetos de Valor - Identidade Multi-Canal e Transferência (Clean Architecture)
 * Versão autocontida para runtime das Edge Functions do Supabase (Deno bundle).
 * Autoridade: CONTEXT.md & ADR 0004
 */

export type SupportedChannel = "instagram" | "whatsapp" | "whatsapp2" | "tinder";

export const SUPPORTED_CHANNELS: readonly SupportedChannel[] = [
  "instagram",
  "whatsapp",
  "whatsapp2",
  "tinder",
] as const;

export type ChannelIdentityStatus =
  | "active"
  | "transferred"
  | "pending_verification"
  | "archived"
  | "collision_review";

export interface ChannelIdentity {
  id: string;
  conversationId: string;
  channel: SupportedChannel;
  externalAccountId?: string | null;
  externalIdentityId: string;
  status: ChannelIdentityStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export type ChannelTransferStatus =
  | "pending"
  | "sending"
  | "confirmed"
  | "failed"
  | "uncertain";

export interface ChannelTransfer {
  id: string;
  conversationId: string;
  sourceChannel: SupportedChannel;
  targetChannel: SupportedChannel;
  targetRecipient: string;
  initialMessageText?: string | null;
  status: ChannelTransferStatus;
  providerMessageId?: string | null;
  failureReason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface NormalizedPhone {
  e164: string;
  countryCode: string;
  ddd: string;
  nationalNumber: string;
  raw: string;
}

/**
 * Normaliza e valida canal suportado
 */
export function normalizeChannel(channel: unknown): SupportedChannel | null {
  if (typeof channel !== "string") return null;
  const normalized = channel.trim().toLowerCase();
  if (SUPPORTED_CHANNELS.includes(normalized as SupportedChannel)) {
    return normalized as SupportedChannel;
  }
  return null;
}

/**
 * Normaliza telefone com foco em regras brasileiras (DDI 55, DDD 2 dígitos, 8-9 dígitos).
 * Remove caracteres de formatação e pontuação.
 * Retorna null se a string não contiver um número de telefone viável.
 */
export function normalizePhoneNumber(raw: unknown): NormalizedPhone | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  const hasLeadingPlus = rawStr.startsWith("+");
  const digits = rawStr.replaceAll(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return null;

  // Se o número veio explicitamente com prefixo internacional '+'
  if (hasLeadingPlus) {
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      const national = digits.slice(2);
      const ddd = national.slice(0, 2);
      const dddNum = Number.parseInt(ddd, 10);
      if (Number.isNaN(dddNum) || dddNum < 11 || dddNum > 99) return null;
      return {
        e164: `+${digits}`,
        countryCode: "55",
        ddd,
        nationalNumber: national,
        raw: rawStr,
      };
    }

    return {
      e164: `+${digits}`,
      countryCode: digits.slice(0, 2),
      ddd: digits.slice(2, 4),
      nationalNumber: digits.slice(2),
      raw: rawStr,
    };
  }

  // Se veio sem prefixo internacional e aparenta ser número nacional brasileiro (10 ou 11 dígitos com DDD)
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const national = digits.slice(2);
    const ddd = national.slice(0, 2);
    const dddNum = Number.parseInt(ddd, 10);
    if (Number.isNaN(dddNum) || dddNum < 11 || dddNum > 99) return null;
    return {
      e164: `+${digits}`,
      countryCode: "55",
      ddd,
      nationalNumber: national,
      raw: rawStr,
    };
  }

  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const dddNum = Number.parseInt(ddd, 10);
    if (Number.isNaN(dddNum) || dddNum < 11 || dddNum > 99) return null;
    return {
      e164: `+55${digits}`,
      countryCode: "55",
      ddd,
      nationalNumber: digits,
      raw: rawStr,
    };
  }

  // Qualquer outro formato não inferível com certeza é retornado como null para o Brain tratar
  return null;
}

/**
 * Compara uma identidade canônica de WhatsApp com o ID de chat retornado pelo gateway.
 * O vínculo pode guardar E.164 enquanto o WhatsApp Web expõe um JID, como `@c.us`.
 */
export function matchesWhatsAppIdentity(externalIdentityId: unknown, chatIdentityId: unknown): boolean {
  const externalId = String(externalIdentityId ?? "").trim();
  const chatId = String(chatIdentityId ?? "").trim();
  if (!externalId || !chatId) return false;
  if (externalId === chatId) return true;
  if (externalId.endsWith("@lid") || chatId.endsWith("@lid")) return false;

  const externalDigits = externalId.replaceAll(/\D/g, "");
  const chatDigits = chatId.replaceAll(/\D/g, "");
  return externalDigits.length >= 8 && externalDigits === chatDigits;
}

/** Resolve the provider chat ID using a direct phone/JID match or a gateway-confirmed phone. */
export function resolveWhatsAppProviderChatId(params: {
  externalIdentityId: unknown;
  verifiedPhone?: unknown;
}): string | null {
  const externalId = String(params.externalIdentityId ?? "").trim();
  const phone = String(params.verifiedPhone ?? "").trim();
  const target = phone || externalId;
  if (!target) return null;
  if (target.endsWith("@c.us") || target.endsWith("@s.whatsapp.net")) {
    return target;
  }
  if (target.endsWith("@lid")) {
    return phone ? `${phone.replaceAll(/\D/g, "")}@c.us` : null;
  }
  const digits = target.replaceAll(/\D/g, "");
  if (!digits || digits.length < 8) return null;
  return `${digits}@c.us`;
}

/**
 * Valida se uma rota de transferência entre canais é suportada.
 */
export function isChannelTransferPermitted(
  fromChannel: SupportedChannel,
  toChannel: SupportedChannel
): boolean {
  if (fromChannel === toChannel) return false;
  // Fluxo autorizado: Tinder -> WhatsApp2
  if (fromChannel === "tinder" && toChannel === "whatsapp2") return true;
  // Instagram -> WhatsApp2
  if (fromChannel === "instagram" && toChannel === "whatsapp2") return true;
  return false;
}

/**
 * Mapeia o resultado de transporte da entrega para o estado e fato factual para o Brain.
 * O backend JAMAIS declara o número como semanticamente "inválido"; apenas repassa o fato técnico real.
 */
export function classifyTransferOutcome(outcome: {
  success: boolean;
  isUncertain?: boolean;
  error?: string | null;
  providerMessageId?: string | null;
}): {
  status: ChannelTransferStatus;
  brainFact: {
    event: "transfer_confirmed" | "transfer_failed" | "transfer_uncertain";
    technicalCode?: string;
    details?: string;
  };
} {
  if (outcome.success) {
    return {
      status: "confirmed",
      brainFact: {
        event: "transfer_confirmed",
        technicalCode: "delivery_success",
      },
    };
  }

  if (outcome.isUncertain) {
    return {
      status: "uncertain",
      brainFact: {
        event: "transfer_uncertain",
        technicalCode: "gateway_timeout_or_pending_ack",
        details: outcome.error || "Aguardando confirmação do provedor; reenvio cego bloqueado.",
      },
    };
  }

  return {
    status: "failed",
    brainFact: {
      event: "transfer_failed",
      technicalCode: outcome.error || "provider_delivery_rejected",
      details: outcome.error || "Falha técnica ao entregar mensagem no destino.",
    },
  };
}
