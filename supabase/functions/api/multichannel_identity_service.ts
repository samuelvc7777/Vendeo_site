/**
 * multichannel_identity_service.ts
 *
 * Gerenciamento determinístico de identidades multi-canal e vínculos canônicos.
 * Arquitetura: Clean Architecture / Backend Determinístico (Plumbing & Invariantes).
 * Autoridade: CONTEXT.md e ADR 0004.
 */

export interface ChannelIdentityRecord {
  id: string;
  conversation_id: string;
  channel: string;
  external_account_id?: string | null;
  external_identity_id: string;
  status: "active" | "transferred" | "pending_verification" | "archived" | "collision_review";
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ResolveIdentityResult {
  found: boolean;
  conversationId: string | null;
  identityRecord: ChannelIdentityRecord | null;
  isLegacyFallback: boolean;
  error?: string;
}

export interface LinkIdentityParams {
  supabase: any;
  conversationId: string;
  channel: "instagram" | "whatsapp" | "whatsapp2" | "tinder";
  externalIdentityId: string;
  externalAccountId?: string | null;
  metadata?: Record<string, unknown>;
  status?: "active" | "transferred" | "pending_verification" | "archived";
}

export interface LinkIdentityResult {
  success: boolean;
  conversationId: string;
  isNew: boolean;
  collisionDetected: boolean;
  existingConversationId?: string;
  error?: string;
}

/**
 * Resolve a identidade canônica da conversa a partir do canal e da identidade externa.
 * Respeita a regra de ADR 0004:
 * 1. Primeiro verifica se há registro em conversation_channel_identities.
 * 2. Se for WhatsApp2 e não houver vínculo registrado, mantém o comportamento legado: wa2:<chatId>.
 */
export async function resolveCanonicalConversationId(params: {
  supabase: any;
  channel?: "instagram" | "whatsapp" | "whatsapp2" | "tinder";
  externalIdentityId?: string;
  chatId?: string;
}): Promise<ResolveIdentityResult> {
  const { supabase } = params;
  const channel = params.channel || "whatsapp2";
  const cleanExternalId = String(params.externalIdentityId || params.chatId || "").trim();

  if (!cleanExternalId) {
    return {
      found: false,
      conversationId: null,
      identityRecord: null,
      isLegacyFallback: false,
    };
  }

  const isWhatsApp = channel === "whatsapp2" || channel === "whatsapp";
  const digits = cleanExternalId.replace(/\D+/g, "");
  const variations = isWhatsApp && digits
    ? Array.from(new Set([cleanExternalId, digits, `+${digits}`, `${digits}@c.us`]))
    : [cleanExternalId];

  try {
    let query = supabase
      .from("conversation_channel_identities")
      .select("id, conversation_id, channel, external_account_id, external_identity_id, status, metadata, created_at, updated_at");

    if (isWhatsApp) {
      if (typeof query.in === "function") {
        query = query.in("channel", ["whatsapp2", "whatsapp"]).in("external_identity_id", variations);
      } else {
        query = query.eq("channel", channel).eq("external_identity_id", cleanExternalId);
      }
    } else {
      query = query.eq("channel", channel).eq("external_identity_id", cleanExternalId);
    }

    if (typeof query.eq === "function") {
      query = query.eq("status", "active");
    }

    if (typeof query.order === "function") {
      query = query.order("created_at", { ascending: false });
    }
    if (typeof query.limit === "function") {
      query = query.limit(1);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return {
        found: false,
        conversationId: null,
        identityRecord: null,
        isLegacyFallback: false,
        error: `canonical_identity_lookup_failed: ${error.message || error}`,
      };
    }

    if (data?.conversation_id) {
      return {
        found: true,
        conversationId: data.conversation_id,
        identityRecord: data as ChannelIdentityRecord,
        isLegacyFallback: false,
      };
    }
  } catch (error) {
    return {
      found: false,
      conversationId: null,
      identityRecord: null,
      isLegacyFallback: false,
      error: `canonical_identity_lookup_failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Fallback retrocompatível para WhatsApp2 não vinculado
  if (channel === "whatsapp2") {
    const legacyId = cleanExternalId.startsWith("wa2:")
      ? cleanExternalId
      : `wa2:${cleanExternalId}`;
    return {
      found: false,
      conversationId: legacyId,
      identityRecord: null,
      isLegacyFallback: true,
    };
  }

  return {
    found: false,
    conversationId: null,
    identityRecord: null,
    isLegacyFallback: false,
  };
}

/**
 * Cria ou atualiza o vínculo de um canal externo à conversa canônica.
 * Proteção crítica: NUNCA executa merge silencioso de conversas.
 * Se a identidade externa já pertencer a outra conversa, bloqueia e marca collision_review.
 */
export async function linkExternalChannelIdentity(
  params: LinkIdentityParams
): Promise<LinkIdentityResult> {
  const {
    supabase,
    conversationId,
    channel,
    externalIdentityId,
    externalAccountId = null,
    metadata = {},
    status = "active",
  } = params;

  const cleanExternalId = String(externalIdentityId || "").trim();
  if (!cleanExternalId) {
    return {
      success: false,
      conversationId,
      isNew: false,
      collisionDetected: false,
      error: "externalIdentityId não pode ser vazio",
    };
  }

  const nowIso = new Date().toISOString();

  // Se a RPC atômica estiver disponível, executa com lock FOR UPDATE garantido pelo banco
  if (typeof supabase.rpc === "function") {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("link_conversation_channel_identity_atomic", {
        p_conversation_id: conversationId,
        p_channel: channel,
        p_external_identity_id: cleanExternalId,
        p_external_account_id: externalAccountId,
        p_metadata: metadata,
        p_status: status,
      });

      if (!rpcErr && rpcRes && typeof rpcRes === "object") {
        return {
          success: Boolean(rpcRes.success),
          conversationId,
          isNew: Boolean(rpcRes.is_new),
          collisionDetected: Boolean(rpcRes.collision),
          existingConversationId: rpcRes.existing_conversation_id || undefined,
          error: rpcRes.error || undefined,
        };
      }
    } catch (_e) {
      // Fallback para query direta se RPC não estiver declarada
    }
  }

  // Fallback seguro em queries diretas
  const { data: existing, error: queryErr } = await supabase
    .from("conversation_channel_identities")
    .select("id, conversation_id, channel, external_identity_id, status")
    .eq("channel", channel)
    .eq("external_identity_id", cleanExternalId)
    .maybeSingle();

  if (queryErr) {
    return {
      success: false,
      conversationId,
      isNew: false,
      collisionDetected: false,
      error: `Erro ao consultar vínculo existente: ${queryErr.message}`,
    };
  }

  // Se já existe e pertence a OUTRA conversa: BLOQUEAR MERGE SEM ALTERAR A OUTRA CONVERSA
  if (existing && existing.conversation_id !== conversationId) {
    return {
      success: false,
      conversationId,
      isNew: false,
      collisionDetected: true,
      existingConversationId: existing.conversation_id,
      error: `Colisão de identidade: ${channel}:${cleanExternalId} já pertence à conversa ${existing.conversation_id}. Merge automático estritamente proibido.`,
    };
  }

  // Se já existe e pertence à mesma conversa: atualiza idempotente
  if (existing && existing.conversation_id === conversationId) {
    const { error: updateErr } = await supabase
      .from("conversation_channel_identities")
      .update({
        external_account_id: externalAccountId,
        status,
        metadata,
        updated_at: nowIso,
      })
      .eq("id", existing.id);

    if (updateErr) {
      return {
        success: false,
        conversationId,
        isNew: false,
        collisionDetected: false,
        error: updateErr.message,
      };
    }

    return {
      success: true,
      conversationId,
      isNew: false,
      collisionDetected: false,
    };
  }

  // Inserção de novo vínculo
  const { error: insertErr } = await supabase
    .from("conversation_channel_identities")
    .insert({
      conversation_id: conversationId,
      channel,
      external_account_id: externalAccountId,
      external_identity_id: cleanExternalId,
      status,
      metadata,
      created_at: nowIso,
      updated_at: nowIso,
    });

  if (insertErr) {
    return {
      success: false,
      conversationId,
      isNew: false,
      collisionDetected: false,
      error: insertErr.message,
    };
  }

  return {
    success: true,
    conversationId,
    isNew: true,
    collisionDetected: false,
  };
}

/**
 * Verifica se um telefone já possui colisão com conversas existentes
 */
export async function checkPhoneCollision(params: {
  supabase: any;
  phoneE164: string;
  currentConversationId: string;
}): Promise<{ hasCollision: boolean; conflictingConversationId?: string; error?: string }> {
  const { supabase, phoneE164, currentConversationId } = params;
  const digits = phoneE164.replaceAll(/\D/g, "");
  const phoneVariations = Array.from(new Set([
    phoneE164,
    digits,
    `+${digits}`,
    `${digits}@c.us`,
    `${digits}@s.whatsapp.net`,
  ])).filter(Boolean);

  const legacyContactVariations = Array.from(new Set([
    ...phoneVariations,
    ...phoneVariations.map((value) => `wa2:${value}`),
  ]));
  const legacyConversationIds = Array.from(new Set([
    ...phoneVariations.map((value) => `wa2:${value}`),
    ...phoneVariations.map((value) => `whatsapp:${value}`),
    ...phoneVariations.map((value) => `whatsapp2:${value}`),
  ]));

  try {
    const { data: identities, error: identityError } = await supabase
      .from("conversation_channel_identities")
      .select("conversation_id, external_identity_id")
      .in("channel", ["whatsapp", "whatsapp2"])
      .in("external_identity_id", phoneVariations);

    if (identityError) {
      return { hasCollision: false, error: `identity_lookup_failed: ${identityError.message || identityError}` };
    }
    if (!Array.isArray(identities)) {
      return { hasCollision: false, error: "identity_lookup_failed: resposta inesperada do banco" };
    }
    for (const identity of identities) {
      if (identity.conversation_id && identity.conversation_id !== currentConversationId) {
        return {
          hasCollision: true,
          conflictingConversationId: identity.conversation_id,
        };
      }
    }

    const { data: legacyByContactId, error: legacyContactError } = await supabase
      .from("instagram_conversations")
      .select("id, contact_id")
      .in("channel", ["whatsapp", "whatsapp2"])
      .in("contact_id", legacyContactVariations);

    if (legacyContactError) {
      return { hasCollision: false, error: `legacy_contact_lookup_failed: ${legacyContactError.message || legacyContactError}` };
    }
    if (!Array.isArray(legacyByContactId)) {
      return { hasCollision: false, error: "legacy_contact_lookup_failed: resposta inesperada do banco" };
    }
    for (const conversation of legacyByContactId) {
      if (conversation.id && conversation.id !== currentConversationId) {
        return { hasCollision: true, conflictingConversationId: conversation.id };
      }
    }

    const { data: legacyById, error: legacyIdError } = await supabase
      .from("instagram_conversations")
      .select("id, contact_id")
      .in("channel", ["whatsapp", "whatsapp2"])
      .in("id", legacyConversationIds);

    if (legacyIdError) {
      return { hasCollision: false, error: `legacy_id_lookup_failed: ${legacyIdError.message || legacyIdError}` };
    }
    if (!Array.isArray(legacyById)) {
      return { hasCollision: false, error: "legacy_id_lookup_failed: resposta inesperada do banco" };
    }
    for (const conversation of legacyById) {
      if (conversation.id && conversation.id !== currentConversationId) {
        return { hasCollision: true, conflictingConversationId: conversation.id };
      }
    }
  } catch (error) {
    return {
      hasCollision: false,
      error: `phone_collision_lookup_failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { hasCollision: false };
}

/**
 * Resolve a conversa canônica de uma mensagem recebida pelo gateway WhatsApp2.
 * Preserva conversa, sessão, memória e progresso se houver vínculo multi-canal (ADR 0004).
 * Se não houver vínculo registrado, mantém o comportamento legado inalterado: wa2:<chatId>.
 */
export async function resolveWhatsapp2CanonicalConversationId(params: {
  supabase: any;
  chatId: string;
}): Promise<string> {
  const { supabase, chatId } = params;
  const cleanChatId = String(chatId || "").trim();
  if (!cleanChatId) return "wa2:unknown";
  const resolved = await resolveCanonicalConversationId({
    supabase,
    channel: "whatsapp2",
    externalIdentityId: cleanChatId,
  });
  if (resolved.error) throw new Error(resolved.error);
  return resolved.conversationId || (cleanChatId.startsWith("wa2:") ? cleanChatId : `wa2:${cleanChatId}`);
}
