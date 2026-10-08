/**
 * tinder_sync_service.ts
 *
 * Serviço de sincronização incremental, persistência canônica e dedupe de mensagens do Tinder.
 * Converte mensagens do Tinder no formato canônico do Vendeo com channel='tinder'.
 * Autoridade: CONTEXT.md e ADR 0004.
 */

import {
  resolveCanonicalConversationId,
  linkExternalChannelIdentity,
} from "./multichannel_identity_service.ts";

export interface TinderRawMessage {
  id: string;
  text: string;
  sentAt?: string | null;
  from?: string | null;
  isMine?: boolean;
}

export interface SyncTinderMatchParams {
  supabase: any;
  matchId: string;
  myUserId?: string;
  matchName?: string;
  matchAvatar?: string;
  rawMessages: TinderRawMessage[];
  autoPilotEnabled?: boolean;
}

export interface SyncTinderMatchResult {
  success: boolean;
  conversationId: string;
  newMessagesCount: number;
  newInboundCount: number;
  newInboundMessageIds: string[];
  latestInboundMessageId?: string | null;
  latestMessageCursor?: string | null;
  error?: string;
}

/**
 * Sincroniza mensagens de um match do Tinder de forma determinística e incremental.
 */
export async function syncTinderMatchMessages(
  params: SyncTinderMatchParams
): Promise<SyncTinderMatchResult> {
  const {
    supabase,
    matchId,
    matchName = "Match Tinder",
    matchAvatar = null,
    rawMessages = [],
    autoPilotEnabled = false,
  } = params;

  const cleanMatchId = String(matchId || "").trim();
  if (!cleanMatchId) {
    return {
      success: false,
      conversationId: "",
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      error: "matchId é obrigatório",
    };
  }

  const nowIso = new Date().toISOString();

  // 1. Resolve ou cria a identidade canônica da conversa
  const resolved = await resolveCanonicalConversationId({
    supabase,
    channel: "tinder",
    externalIdentityId: cleanMatchId,
  });

  if (resolved.error) {
    return {
      success: false,
      conversationId: "",
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      error: resolved.error,
    };
  }

  const conversationId = resolved.conversationId || `tinder:${cleanMatchId}`;

  // 2. Garante existência da conversa em instagram_conversations
  const { data: existingConv, error: conversationReadError } = await supabase
    .from("instagram_conversations")
    .select("id, ai_auto_respond, channel")
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationReadError) {
    return {
      success: false,
      conversationId,
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      error: `Erro ao consultar conversa Tinder: ${conversationReadError.message || conversationReadError}`,
    };
  }

  if (!existingConv) {
    const { error: conversationInsertError } = await supabase
      .from("instagram_conversations")
      .upsert({
        id: conversationId,
        username: matchName,
        full_name: matchName,
        avatar: matchAvatar,
        channel: "tinder",
        contact_id: cleanMatchId,
        status: "active",
        ai_auto_respond: autoPilotEnabled,
        created_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: "id", ignoreDuplicates: true });

    if (conversationInsertError) {
      return {
        success: false,
        conversationId,
        newMessagesCount: 0,
        newInboundCount: 0,
        newInboundMessageIds: [],
        error: `Erro ao criar conversa Tinder: ${conversationInsertError.message || conversationInsertError}`,
      };
    }
  }

  // 3. Garante vínculo em conversation_channel_identities
  const linkResult = await linkExternalChannelIdentity({
    supabase,
    conversationId,
    channel: "tinder",
    externalIdentityId: cleanMatchId,
    metadata: {
      name: matchName,
      avatar: matchAvatar,
    },
    status: "active",
  });

  if (!linkResult.success) {
    return {
      success: false,
      conversationId,
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      error: `Não foi possível vincular a identidade Tinder: ${linkResult.error || "identity_link_failed"}`,
    };
  }

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return {
      success: true,
      conversationId,
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      latestInboundMessageId: null,
      latestMessageCursor: null,
    };
  }

  // 4. Busca mensagens já existentes para deduplicação em lote
  const providerMessageIds = rawMessages
    .map((m) => String(m.id || "").trim())
    .filter(Boolean);

  const internalMessageIds = providerMessageIds.map((pid) => `tinder_msg_${pid}`);

  const { data: existingMsgs, error: existingMessagesError } = await supabase
    .from("instagram_messages")
    .select("id")
    .in("id", internalMessageIds);

  if (existingMessagesError) {
    return {
      success: false,
      conversationId,
      newMessagesCount: 0,
      newInboundCount: 0,
      newInboundMessageIds: [],
      error: `Erro ao consultar mensagens Tinder existentes: ${existingMessagesError.message || existingMessagesError}`,
    };
  }

  const existingIdsSet = new Set(
    (existingMsgs || []).map((m: any) => String(m.id))
  );

  // 5. Filtra mensagens novas a persistir
  const newMessagesToInsert: any[] = [];
  const timestampFor = (raw: TinderRawMessage): string => {
    const rawTimestamp = String(raw.sentAt || "");
    const parsed = Date.parse(rawTimestamp);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso;
  };
  const orderedRawMessages = [...rawMessages].sort((a, b) => {
    return Date.parse(timestampFor(a)) - Date.parse(timestampFor(b));
  });
  const seenInboundProviderIds = new Set<string>();
  const allInboundMessages = orderedRawMessages
    .filter((raw) => !raw.isMine && String(raw.id || "").trim())
    .filter((raw) => {
      const id = String(raw.id).trim();
      if (seenInboundProviderIds.has(id)) return false;
      seenInboundProviderIds.add(id);
      return true;
    })
    .map((raw) => ({
      id: `tinder_msg_${String(raw.id).trim()}`,
      timestamp: timestampFor(raw),
    }));

  const seenProviderIds = new Set<string>();
  for (const raw of orderedRawMessages) {
    const rawId = String(raw.id || "").trim();
    if (!rawId) continue;
    if (seenProviderIds.has(rawId)) continue;
    seenProviderIds.add(rawId);

    const canonicalMsgId = `tinder_msg_${rawId}`;
    if (existingIdsSet.has(canonicalMsgId)) {
      continue; // Já sincronizada
    }

    const isMine = Boolean(raw.isMine);
    const text = String(raw.text || "").trim();
    const timestamp = timestampFor(raw);

    newMessagesToInsert.push({
      id: canonicalMsgId,
      conversation_id: conversationId,
      sender_id: isMine ? "larissa" : (raw.from || cleanMatchId),
      text,
      is_mine: isMine,
      timestamp,
      channel: "tinder",
      status: "received",
      created_at: timestamp,
    });

  }

  // 6. Inserção atômica de mensagens novas
  let persistedNewMessages: any[] = [];
  if (newMessagesToInsert.length > 0) {
    const { data: insertedRows, error: insertErr } = await supabase
      .from("instagram_messages")
      .upsert(newMessagesToInsert, { onConflict: "id", ignoreDuplicates: true })
      .select("id");

    if (insertErr) {
      return {
        success: false,
        conversationId,
        newMessagesCount: 0,
        newInboundCount: 0,
        newInboundMessageIds: [],
        error: `Erro ao persistir mensagens Tinder: ${insertErr.message}`,
      };
    }

    if (!Array.isArray(insertedRows)) {
      return {
        success: false,
        conversationId,
        newMessagesCount: 0,
        newInboundCount: 0,
        newInboundMessageIds: [],
        error: "A persistência Tinder não retornou as mensagens efetivamente inseridas.",
      };
    }

    const insertedIds = new Set(insertedRows.map((row: any) => String(row.id)));
    persistedNewMessages = newMessagesToInsert.filter((message) => insertedIds.has(message.id));

    // Atualiza last_message na conversa
    const lastMsg = persistedNewMessages[persistedNewMessages.length - 1];
    if (lastMsg) {
      const { error: conversationUpdateError } = await supabase
      .from("instagram_conversations")
      .update({
        last_message: lastMsg.text,
        last_message_at: lastMsg.timestamp,
        last_direction: lastMsg.is_mine ? "out" : "in",
        updated_at: nowIso,
      })
      .eq("id", conversationId);

      if (conversationUpdateError) {
        return {
          success: false,
          conversationId,
          newMessagesCount: persistedNewMessages.length,
          newInboundCount: 0,
          newInboundMessageIds: [],
          error: `Mensagens Tinder persistidas, mas a conversa não foi atualizada: ${conversationUpdateError.message || conversationUpdateError}`,
        };
      }
    }
  }

  const newInboundMessageIds = persistedNewMessages
    .filter((message) => !message.is_mine)
    .map((message) => message.id);

  return {
    success: true,
    conversationId,
    newMessagesCount: persistedNewMessages.length,
    newInboundCount: newInboundMessageIds.length,
    newInboundMessageIds,
    latestInboundMessageId: allInboundMessages.at(-1)?.id || null,
    latestMessageCursor: rawMessages
      .map((raw) => ({ cursor: String(raw.sentAt || ""), time: Date.parse(String(raw.sentAt || "")) }))
      .filter((item) => Number.isFinite(item.time))
      .sort((a, b) => a.time - b.time)
      .at(-1)?.cursor || null,
  };
}

/**
 * Guarda de segurança estrita:
 * Impede requisições de leitura de rede ao Tinder em background
 * sem que o escopo da autorização formal esteja ativado por flag de ambiente.
 */
export function isTinderLiveSyncEnabled(): boolean {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
      return Deno.env.get("ENABLE_TINDER_LIVE_SYNC") === "true";
    }
  } catch {}
  try {
    if (typeof process !== "undefined" && process?.env) {
      return process.env.ENABLE_TINDER_LIVE_SYNC === "true";
    }
  } catch {}
  return false;
}

export interface TinderSyncCursorStore {
  getCursor(matchId: string): Promise<string | null>;
  setCursor(matchId: string, cursor: string): Promise<void>;
  acquireLease?(matchId: string, ttlSeconds?: number): Promise<boolean>;
  releaseLease?(matchId: string): Promise<void>;
}

export function createDatabaseTinderCursorStore(supabase: any): TinderSyncCursorStore {
  const leaseTokens = new Map<string, string>();
  return {
    async getCursor(matchId: string): Promise<string | null> {
      const { data, error } = await supabase
        .from("tinder_sync_state")
        .select("cursor")
        .eq("match_id", matchId)
        .maybeSingle();
      if (error) throw new Error(`tinder_sync_cursor_read_failed: ${error.message || error}`);
      return typeof data?.cursor === "string" ? data.cursor : null;
    },
    async setCursor(matchId: string, cursor: string): Promise<void> {
      const leaseToken = leaseTokens.get(matchId);
      if (!leaseToken) throw new Error("tinder_sync_cursor_write_without_lease");
      const { data, error } = await supabase.rpc("set_tinder_sync_cursor", {
        p_match_id: matchId,
        p_lease_token: leaseToken,
        p_cursor: cursor,
      });
      if (error || data?.success !== true) {
        throw new Error(`tinder_sync_cursor_write_failed: ${error?.message || data?.reason || "lease_lost"}`);
      }
    },
    async acquireLease(matchId: string, ttlSeconds = 60): Promise<boolean> {
      const leaseToken = crypto.randomUUID();
      const { data, error } = await supabase.rpc("claim_tinder_sync_lease", {
        p_match_id: matchId,
        p_lease_token: leaseToken,
        p_ttl_seconds: ttlSeconds,
      });
      if (error || data?.success !== true) {
        throw new Error(`tinder_sync_lease_claim_failed: ${error?.message || data?.reason || "unknown"}`);
      }
      if (data?.acquired !== true) return false;
      leaseTokens.set(matchId, leaseToken);
      return true;
    },
    async releaseLease(matchId: string): Promise<void> {
      const leaseToken = leaseTokens.get(matchId);
      if (!leaseToken) return;
      leaseTokens.delete(matchId);
      const { error } = await supabase.rpc("release_tinder_sync_lease", {
        p_match_id: matchId,
        p_lease_token: leaseToken,
      });
      if (error) throw new Error(`tinder_sync_lease_release_failed: ${error.message || error}`);
    },
  };
}

export async function enqueueTinderInboundJob(
  supabase: any,
  conversationId: string,
  messageIds: string[],
): Promise<void> {
  const latestMessageId = [...messageIds].filter(Boolean).at(-1);
  if (!latestMessageId) return;

  const { data: existingJob, error: readError } = await supabase
    .from("autopilot_inbound_jobs")
    .select("latest_message_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (readError) throw new Error(`tinder_brain_queue_read_failed: ${readError.message || readError}`);
  if (existingJob?.latest_message_id === latestMessageId) return;

  const { data, error } = await supabase.rpc("enqueue_autopilot_inbound_job", {
    p_conversation_id: conversationId,
    p_message_id: latestMessageId,
  });
  if (error || data?.success !== true) {
    throw new Error(`tinder_brain_enqueue_failed: ${error?.message || data?.reason || "unknown"}`);
  }
}

export interface ProcessTinderSyncOptions {
  supabase: any;
  cursorStore?: TinderSyncCursorStore;
  cursorStorage?: Map<string, string>;
  testMockFetchMessages?: (matchId: string, sinceDate?: string) => Promise<TinderRawMessage[]>;
  fetchMatchMessages?: (matchId: string, sinceDate?: string) => Promise<TinderRawMessage[]>;
  enqueueBrain?: (conversationId: string, messageIds: string[]) => Promise<void>;
  rateLimitMs?: number;
}

export interface ProcessTinderSyncResult {
  matchesProcessed: number;
  newMessagesTotal: number;
  newInboundTotal: number;
  syncedConversationIds: string[];
  skippedDueToLockOrScope?: boolean;
  errors: Array<{ matchId: string; error: string }>;
}

/**
 * Mecanismo durável de sincronização em background com interface fechada.
 * Possui cursor incremental persistente, deduplicação em lote, proteção contra concorrência e enqueue no Brain.
 */
export async function processTinderBackgroundSync(
  options: ProcessTinderSyncOptions
): Promise<ProcessTinderSyncResult> {
  const {
    supabase,
    cursorStore,
    cursorStorage,
    testMockFetchMessages,
    fetchMatchMessages,
    enqueueBrain,
    rateLimitMs = 50,
  } = options;

  const result: ProcessTinderSyncResult = {
    matchesProcessed: 0,
    newMessagesTotal: 0,
    newInboundTotal: 0,
    syncedConversationIds: [],
    errors: [],
  };

  // Separação estrita: se não for mock explícito de teste, bloqueia chamada de rede real se flag estiver desligada
  const isTestMock = Boolean(testMockFetchMessages);
  if (!isTestMock && !isTinderLiveSyncEnabled()) {
    result.skippedDueToLockOrScope = true;
    result.errors.push({
      matchId: "all",
      error: "tinder_live_sync_blocked_pending_scope_validation: sincronização real do Tinder bloqueada por segurança até validação formal do escopo da autorização escrita",
    });
    return result;
  }

  if (!testMockFetchMessages && !fetchMatchMessages) {
    result.skippedDueToLockOrScope = true;
    result.errors.push({ matchId: "all", error: "tinder_sync_reader_unavailable" });
    return result;
  }

  // 1. Consulta matches ativos com piloto automático habilitado
  const { data: matches, error: fetchErr } = await supabase
    .from("instagram_conversations")
    .select("id, contact_id, full_name, avatar")
    .eq("channel", "tinder")
    .eq("ai_auto_respond", true);

  if (fetchErr) {
    result.errors.push({ matchId: "query", error: fetchErr.message });
    return result;
  }

  if (!Array.isArray(matches) || matches.length === 0) {
    return result;
  }

  const effectiveCursorStore = cursorStore || (supabase ? createDatabaseTinderCursorStore(supabase) : undefined);

  // 2. Itera sobre os matches com proteção de concorrência e rate limit defensivo
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchId = match.contact_id || match.id.replace(/^tinder:/, "");
    let leaseAcquired = false;

    try {
      // Proteção de concorrência: erro de infraestrutura é registrado; lease ocupada só ignora este match.
      if (effectiveCursorStore?.acquireLease) {
        leaseAcquired = await effectiveCursorStore.acquireLease(matchId, 60);
        if (!leaseAcquired) continue;
      }

      const sinceDate = effectiveCursorStore
        ? (await effectiveCursorStore.getCursor(matchId)) || undefined
        : cursorStorage?.get(matchId) || undefined;

      let rawMessages: TinderRawMessage[] = [];
      if (testMockFetchMessages) {
        rawMessages = await testMockFetchMessages(matchId, sinceDate);
      } else if (fetchMatchMessages) {
        rawMessages = await fetchMatchMessages(matchId, sinceDate);
      }

      const syncRes = await syncTinderMatchMessages({
        supabase,
        matchId,
        matchName: match.full_name || "Match Tinder",
        matchAvatar: match.avatar || undefined,
        rawMessages,
        autoPilotEnabled: true,
      });

      if (!syncRes.success) {
        result.errors.push({ matchId, error: syncRes.error || "sync_failed" });
        continue;
      }

      result.matchesProcessed++;
      result.newMessagesTotal += syncRes.newMessagesCount;
      result.newInboundTotal += syncRes.newInboundCount;

      if (syncRes.newInboundCount > 0 || syncRes.latestInboundMessageId) {
        if (enqueueBrain && syncRes.newInboundMessageIds.length > 0) {
          await enqueueBrain(syncRes.conversationId, syncRes.newInboundMessageIds);
        } else if (syncRes.latestInboundMessageId) {
          await enqueueTinderInboundJob(supabase, syncRes.conversationId, [syncRes.latestInboundMessageId]);
        }

        if (syncRes.newInboundCount > 0) {
          result.syncedConversationIds.push(syncRes.conversationId);
        }
      }

      // Cursor avança somente depois de persistir as mensagens e confirmar que
      // a fila já contém o último inbound. Falha de enqueue preserva o watermark.
      let cursorToPersist = syncRes.latestMessageCursor;
      const previousCursorTime = sinceDate ? Date.parse(sinceDate) : NaN;
      const fetchedCursorTime = cursorToPersist ? Date.parse(cursorToPersist) : NaN;
      if (
        Number.isFinite(previousCursorTime)
        && Number.isFinite(fetchedCursorTime)
        && fetchedCursorTime < previousCursorTime
      ) {
        // Mensagens atrasadas entram no histórico, mas não reabrem o watermark
        // e não fazem o reader revisitar páginas antigas indefinidamente.
        cursorToPersist = sinceDate;
      }

      if (cursorToPersist) {
        if (effectiveCursorStore) {
          await effectiveCursorStore.setCursor(matchId, cursorToPersist);
        }
        if (cursorStorage) {
          cursorStorage.set(matchId, cursorToPersist);
        }
      }

    } catch (err: any) {
      result.errors.push({ matchId, error: err?.message || String(err) });
    } finally {
      if (leaseAcquired && effectiveCursorStore?.releaseLease) {
        try {
          await effectiveCursorStore.releaseLease(matchId);
        } catch (releaseError: any) {
          result.errors.push({ matchId, error: releaseError?.message || String(releaseError) });
        }
      }
    }

    // Rate limit entre requisições de matches diferentes
    if (rateLimitMs > 0 && i < matches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    }
  }

  return result;
}
