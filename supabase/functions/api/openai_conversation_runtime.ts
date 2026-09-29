import OpenAI from "npm:openai@7.23.0";
import {
  getDefaultOpenAIClient,
  setDefaultOpenAIClient,
  setDefaultOpenAIKey,
  startOpenAIConversationsSession,
} from "npm:@openai/agents@0.18.0";

export const OPENAI_CONVERSATION_RUNTIME_VERSION = 1;

export interface OpenAiConversationLink {
  conversationId: string;
  openAiConversationId: string;
  created: boolean;
}

const BOOTSTRAP_DB_PAGE_SIZE = 500;
const BOOTSTRAP_OPENAI_BATCH_SIZE = 20;
const LARISSA_TIMEZONE = "America/Sao_Paulo";

function configureOpenAiRuntimeClient(apiKey: string): void {
  const normalizedKey = apiKey.trim();
  setDefaultOpenAIKey(normalizedKey);
  setDefaultOpenAIClient(new OpenAI({ apiKey: normalizedKey }));
}

async function ensureOpenAiRuntimeKey(supabase: any): Promise<void> {
  const envKey =
    (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_API_KEY") : process.env.OPENAI_API_KEY)
    || "";
  if (envKey.trim()) {
    configureOpenAiRuntimeClient(envKey);
    return;
  }

  const { data, error } = await supabase
    .from("instagram_config")
    .select("app_secret")
    .eq("id", "openai_api_key")
    .maybeSingle();

  const dbKey = String(data?.app_secret || "").trim();
  if (error || !dbKey) {
    throw new Error("openai_runtime_api_key_missing");
  }
  configureOpenAiRuntimeClient(dbKey);
}

function formatBootstrapTimestamp(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "data desconhecida";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone: LARISSA_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
    return `${formatted} (${LARISSA_TIMEZONE})`;
  } catch {
    return raw;
  }
}

function isOutboundMessage(row: any): boolean {
  return Boolean(row?.is_mine === true || row?.sender_id === "me" || row?.sender === "larissa");
}

function shouldBootstrapRow(row: any): boolean {
  if (!row?.id) return false;
  const isOutbound = isOutboundMessage(row);
  if (!isOutbound) return true;
  const status = String(row?.status || "").toLowerCase();
  return !["failed", "cancelled", "canceled", "pending", "sending", "waiting", "dispatch_uncertain"].includes(status);
}

function bootstrapMessageText(row: any): string {
  const originalAt = formatBootstrapTimestamp(row?.timestamp || row?.created_at);
  const mediaType = String(row?.media_type || row?.mediaType || "").toLowerCase();
  const rawText = String(row?.text || row?.message || "").trim();
  const transcript = String(row?.audio_transcript || row?.audioTranscript || "").trim();
  const looksAudio = mediaType === "audio" || rawText.startsWith("[audio:") || rawText.includes("[audio:");

  if (looksAudio) {
    const isPlaceholderText = /^(?:🎙️\s*)?(?:mensagem de voz|áudio|audio)$/i.test(rawText);
    const body = transcript
      || (!rawText.startsWith("[audio:") && !isPlaceholderText ? rawText : "")
      || "[transcrição indisponível no histórico]";
    return `[DATA/HORA ORIGINAL: ${originalAt}]\n[ÁUDIO TRANSCRITO]\n${body}`;
  }
  if (mediaType === "image") {
    return `[DATA/HORA ORIGINAL: ${originalAt}]\n[IMAGEM]${rawText ? `\n${rawText}` : ""}`;
  }
  if (mediaType === "video") {
    return `[DATA/HORA ORIGINAL: ${originalAt}]\n[VÍDEO]${rawText ? `\n${rawText}` : ""}`;
  }
  if (mediaType === "file") {
    return `[DATA/HORA ORIGINAL: ${originalAt}]\n[ARQUIVO]${rawText ? `\n${rawText}` : ""}`;
  }
  return `[DATA/HORA ORIGINAL: ${originalAt}]\n${rawText || "[mensagem sem texto]"}`;
}

export async function bootstrapOpenAiConversationHistory(params: {
  supabase: any;
  conversationId: string;
  openAiConversationId: string;
}): Promise<{ bootstrapped: boolean; messageCount: number }> {
  const { supabase, conversationId, openAiConversationId } = params;

  const { data: link, error: linkReadError } = await supabase
    .from("openai_conversation_links")
    .select("bootstrap_status, bootstrapped_at, bootstrap_message_count")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (linkReadError) {
    throw new Error(`openai_bootstrap_link_read_failed: ${linkReadError.message}`);
  }
  if (link?.bootstrap_status === "complete" && link?.bootstrapped_at) {
    return { bootstrapped: true, messageCount: Number(link.bootstrap_message_count || 0) };
  }

  const client = getDefaultOpenAIClient<any>();
  if (!client?.conversations?.items?.create) {
    throw new Error("openai_conversations_client_unavailable");
  }

  await supabase
    .from("openai_conversation_links")
    .update({
      bootstrap_status: "running",
      bootstrap_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId);

  let offset = 0;
  let totalSynced = 0;

  try {
    while (true) {
      const { data: rows, error: rowsError } = await supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, text, timestamp, created_at, status, media_type, audio_transcript")
        .eq("conversation_id", conversationId)
        .order("timestamp", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + BOOTSTRAP_DB_PAGE_SIZE - 1);

      if (rowsError) {
        throw new Error(`openai_bootstrap_history_read_failed: ${rowsError.message}`);
      }

      const page = (rows || []).filter(shouldBootstrapRow);
      if (page.length > 0) {
        const pageIds = page.map((row: any) => String(row.id));
        const { data: receipts, error: receiptsError } = await supabase
          .from("openai_message_receipts")
          .select("provider_message_id, openai_item_id, synced_at")
          .in("provider_message_id", pageIds);

        if (receiptsError) {
          throw new Error(`openai_bootstrap_receipts_read_failed: ${receiptsError.message}`);
        }

        const alreadySynced = new Set(
          (receipts || [])
            .filter((row: any) => row?.synced_at && row?.openai_item_id)
            .map((row: any) => String(row.provider_message_id)),
        );
        totalSynced += alreadySynced.size;

        const unsyncedRows = page.filter((row: any) => !alreadySynced.has(String(row.id)));
        for (let index = 0; index < unsyncedRows.length; index += BOOTSTRAP_OPENAI_BATCH_SIZE) {
          const batch = unsyncedRows.slice(index, index + BOOTSTRAP_OPENAI_BATCH_SIZE);
          if (batch.length === 0) continue;

          const items = batch.map((row: any) => ({
            type: "message",
            role: isOutboundMessage(row) ? "assistant" : "user",
            content: [{ type: "input_text", text: bootstrapMessageText(row) }],
          }));

          const firstId = String(batch[0].id);
          const lastId = String(batch[batch.length - 1].id);
          const created = await client.conversations.items.create(
            openAiConversationId,
            { items },
            {
              idempotencyKey: `vendeo:bootstrap:${conversationId}:${firstId}:${lastId}:${batch.length}`,
            },
          );

          const createdItems = Array.isArray(created?.data) ? created.data : [];
          if (createdItems.length !== batch.length) {
            throw new Error(
              `openai_bootstrap_item_count_mismatch: expected=${batch.length} actual=${createdItems.length}`,
            );
          }

          const syncedAt = new Date().toISOString();
          const receiptRows = batch.map((row: any, itemIndex: number) => ({
            provider_message_id: String(row.id),
            conversation_id: conversationId,
            direction: isOutboundMessage(row) ? "outbound" : "inbound",
            openai_item_id: String(createdItems[itemIndex]?.id || ""),
            received_at: row.timestamp || row.created_at || syncedAt,
            synced_at: syncedAt,
            sync_status: "synced",
            sync_started_at: null,
            next_retry_at: null,
            last_error: null,
            updated_at: syncedAt,
          }));

          if (receiptRows.some((row: any) => !row.openai_item_id)) {
            throw new Error("openai_bootstrap_item_missing_id");
          }

          const { error: receiptWriteError } = await supabase
            .from("openai_message_receipts")
            .upsert(receiptRows, { onConflict: "provider_message_id" });

          if (receiptWriteError) {
            throw new Error(`openai_bootstrap_receipts_write_failed: ${receiptWriteError.message}`);
          }
          totalSynced += receiptRows.length;
        }
      }

      if (!rows || rows.length < BOOTSTRAP_DB_PAGE_SIZE) break;
      offset += BOOTSTRAP_DB_PAGE_SIZE;
    }

    const completedAt = new Date().toISOString();
    const { error: completeError } = await supabase
      .from("openai_conversation_links")
      .update({
        bootstrap_status: "complete",
        bootstrapped_at: completedAt,
        bootstrap_message_count: totalSynced,
        bootstrap_last_error: null,
        updated_at: completedAt,
      })
      .eq("conversation_id", conversationId);

    if (completeError) {
      throw new Error(`openai_bootstrap_complete_write_failed: ${completeError.message}`);
    }

    return { bootstrapped: true, messageCount: totalSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("openai_conversation_links")
      .update({
        bootstrap_status: "failed",
        bootstrap_last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId);
    throw error;
  }
}

export async function enqueueOpenAiConversationMessageSync(params: {
  supabase: any;
  conversationId: string;
  providerMessageId: string;
  direction: "inbound" | "outbound";
  receivedAt?: string | null;
}): Promise<{ queued: boolean }> {
  const { supabase, conversationId } = params;
  const providerMessageId = String(params.providerMessageId || "").trim();
  if (!providerMessageId) return { queued: false };

  const { data: link, error: linkError } = await supabase
    .from("openai_conversation_links")
    .select("status, bootstrap_status")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (linkError) throw new Error(`openai_sync_queue_link_read_failed: ${linkError.message}`);
  if (link?.status !== "active" || link?.bootstrap_status !== "complete") {
    return { queued: false };
  }

  const now = new Date().toISOString();
  const { error: queueError } = await supabase
    .from("openai_message_receipts")
    .upsert({
      provider_message_id: providerMessageId,
      conversation_id: conversationId,
      direction: params.direction,
      received_at: params.receivedAt || now,
      sync_status: "pending",
      next_retry_at: null,
      last_error: null,
      updated_at: now,
    }, {
      onConflict: "provider_message_id",
      ignoreDuplicates: true,
    });

  if (queueError) throw new Error(`openai_sync_queue_write_failed: ${queueError.message}`);
  return { queued: true };
}

export async function processOpenAiConversationSyncQueue(params: {
  supabase: any;
  conversationId?: string;
  providerMessageIds?: string[];
  limit?: number;
}): Promise<{ processed: number; synced: number; failed: number }> {
  const { supabase } = params;
  const limit = Math.max(1, Math.min(100, params.limit || 25));
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 5 * 60_000).toISOString();

  try {
    let staleUpdate = supabase
      .from("openai_message_receipts")
      .update({
        sync_status: "failed",
        sync_started_at: null,
        next_retry_at: nowIso,
        last_error: "stale_sync_lease_recovered",
        updated_at: nowIso,
      })
      .eq("sync_status", "syncing")
      .lt("sync_started_at", staleBefore);
    if (params.conversationId) staleUpdate = staleUpdate.eq("conversation_id", params.conversationId);
    await staleUpdate;
  } catch {
    // Recovery de lease é best-effort; a fila continua processando outros itens.
  }

  let query = supabase
    .from("openai_message_receipts")
    .select("provider_message_id, conversation_id, direction, sync_status, sync_attempts, received_at")
    .in("sync_status", ["pending", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("received_at", { ascending: true })
    .limit(limit);

  if (params.conversationId) query = query.eq("conversation_id", params.conversationId);
  if (params.providerMessageIds?.length) {
    query = query.in("provider_message_id", params.providerMessageIds.map(String));
  }

  const { data: candidates, error: candidateError } = await query;
  if (candidateError) throw new Error(`openai_sync_queue_read_failed: ${candidateError.message}`);

  let processed = 0;
  let synced = 0;
  let failed = 0;

  for (const candidate of candidates || []) {
    const providerMessageId = String(candidate.provider_message_id);
    const attempt = Number(candidate.sync_attempts || 0) + 1;
    const startedAt = new Date().toISOString();

    const { data: claimed, error: claimError } = await supabase
      .from("openai_message_receipts")
      .update({
        sync_status: "syncing",
        sync_attempts: attempt,
        sync_started_at: startedAt,
        updated_at: startedAt,
      })
      .eq("provider_message_id", providerMessageId)
      .eq("sync_status", candidate.sync_status)
      .select("provider_message_id")
      .maybeSingle();

    if (claimError || !claimed?.provider_message_id) continue;
    processed += 1;

    try {
      const { data: message, error: messageError } = await supabase
        .from("instagram_messages")
        .select("id, conversation_id, text, timestamp, created_at, is_mine, sender_id, status, media_type, audio_transcript")
        .eq("conversation_id", candidate.conversation_id)
        .eq("id", providerMessageId)
        .maybeSingle();

      if (messageError) throw new Error(`openai_sync_message_read_failed: ${messageError.message}`);
      if (!message) throw new Error("openai_sync_message_missing");

      const result = candidate.direction === "outbound"
        ? await persistConfirmedOutboundToOpenAiConversation({
            supabase,
            conversationId: candidate.conversation_id,
            providerMessageId,
            text: message.text,
            audioTranscript: message.audio_transcript,
            mediaType: message.media_type,
            sentAt: message.timestamp || message.created_at || candidate.received_at,
          })
        : await persistInboundToOpenAiConversation({
            supabase,
            conversationId: candidate.conversation_id,
            providerMessageId,
            text: message.text,
            audioTranscript: message.audio_transcript,
            mediaType: message.media_type,
            receivedAt: message.timestamp || message.created_at || candidate.received_at,
          });

      if (!result.synced) throw new Error("openai_sync_conversation_not_ready");
      synced += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const retrySeconds = Math.min(3600, 15 * Math.pow(2, Math.min(attempt - 1, 8)));
      const retryAt = new Date(Date.now() + retrySeconds * 1000).toISOString();
      await supabase
        .from("openai_message_receipts")
        .update({
          sync_status: "failed",
          sync_started_at: null,
          next_retry_at: retryAt,
          last_error: message.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("provider_message_id", providerMessageId)
        .eq("sync_status", "syncing");
    }
  }

  return { processed, synced, failed };
}

export async function persistInboundToOpenAiConversation(params: {
  supabase: any;
  conversationId: string;
  providerMessageId: string;
  text?: string | null;
  audioTranscript?: string | null;
  mediaType?: string | null;
  receivedAt?: string | null;
}): Promise<{ synced: boolean; openAiItemId?: string }> {
  const { supabase, conversationId } = params;
  const providerMessageId = String(params.providerMessageId || "").trim();
  if (!providerMessageId) throw new Error("openai_inbound_provider_message_id_missing");

  const { data: link, error: linkError } = await supabase
    .from("openai_conversation_links")
    .select("openai_conversation_id, status, bootstrap_status")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (linkError) throw new Error(`openai_inbound_link_read_failed: ${linkError.message}`);
  // IA ligada/desligada não interfere aqui. Só exigimos que a Conversation já exista
  // e que o bootstrap inicial tenha terminado.
  if (!link?.openai_conversation_id || link?.status !== "active" || link?.bootstrap_status !== "complete") {
    return { synced: false };
  }

  const { data: existingReceipt, error: receiptReadError } = await supabase
    .from("openai_message_receipts")
    .select("openai_item_id, synced_at")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (receiptReadError) throw new Error(`openai_inbound_receipt_read_failed: ${receiptReadError.message}`);
  if (existingReceipt?.synced_at && existingReceipt?.openai_item_id) {
    return { synced: true, openAiItemId: String(existingReceipt.openai_item_id) };
  }

  await ensureOpenAiRuntimeKey(supabase);
  const client = getDefaultOpenAIClient<any>();
  if (!client?.conversations?.items?.create) {
    throw new Error("openai_conversations_client_unavailable");
  }

  const receivedAt = params.receivedAt || new Date().toISOString();
  const content = bootstrapMessageText({
    id: providerMessageId,
    text: params.text || "",
    timestamp: receivedAt,
    media_type: params.mediaType || null,
    audio_transcript: params.audioTranscript || null,
    is_mine: false,
  });

  const created = await client.conversations.items.create(
    String(link.openai_conversation_id),
    {
      items: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: content }],
      }],
    },
    { idempotencyKey: `vendeo:instagram:${providerMessageId}` },
  );

  const openAiItemId = String(created?.data?.[0]?.id || "");
  if (!openAiItemId) {
    throw new Error(`openai_inbound_item_missing_id: ${providerMessageId}`);
  }

  const syncedAt = new Date().toISOString();
  const { error: receiptWriteError } = await supabase
    .from("openai_message_receipts")
    .upsert({
      provider_message_id: providerMessageId,
      conversation_id: conversationId,
      direction: "inbound",
      openai_item_id: openAiItemId,
      received_at: receivedAt,
      synced_at: syncedAt,
      sync_status: "synced",
      sync_started_at: null,
      next_retry_at: null,
      last_error: null,
      updated_at: syncedAt,
    }, { onConflict: "provider_message_id" });

  if (receiptWriteError) {
    throw new Error(`openai_inbound_receipt_write_failed: ${receiptWriteError.message}`);
  }

  return { synced: true, openAiItemId };
}

export async function persistConfirmedOutboundToOpenAiConversation(params: {
  supabase: any;
  conversationId: string;
  providerMessageId: string;
  text?: string | null;
  audioId?: string | null;
  audioTranscript?: string | null;
  mediaType?: string | null;
  sentAt?: string | null;
}): Promise<{ synced: boolean; openAiItemId?: string }> {
  const { supabase, conversationId } = params;
  const providerMessageId = String(params.providerMessageId || "").trim();
  if (!providerMessageId) throw new Error("openai_outbound_provider_message_id_missing");

  const { data: link, error: linkError } = await supabase
    .from("openai_conversation_links")
    .select("openai_conversation_id, status, bootstrap_status")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (linkError) throw new Error(`openai_outbound_link_read_failed: ${linkError.message}`);
  // Se ainda não existe Conversation ativa, o histórico local continua sendo a verdade
  // e essa mensagem será absorvida pelo bootstrap quando o runtime novo for iniciado.
  if (!link?.openai_conversation_id || link?.status !== "active") {
    return { synced: false };
  }
  if (link?.bootstrap_status !== "complete") {
    return { synced: false };
  }

  const { data: existingReceipt, error: receiptReadError } = await supabase
    .from("openai_message_receipts")
    .select("openai_item_id, synced_at")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (receiptReadError) throw new Error(`openai_outbound_receipt_read_failed: ${receiptReadError.message}`);
  if (existingReceipt?.synced_at && existingReceipt?.openai_item_id) {
    return { synced: true, openAiItemId: String(existingReceipt.openai_item_id) };
  }

  await ensureOpenAiRuntimeKey(supabase);
  const client = getDefaultOpenAIClient<any>();
  if (!client?.conversations?.items?.create) {
    throw new Error("openai_conversations_client_unavailable");
  }

  const sentAt = params.sentAt || new Date().toISOString();
  let body = String(params.text || "").trim();
  const isAudio = Boolean(params.audioId) || String(params.mediaType || "").toLowerCase() === "audio";

  if (isAudio) {
    let transcript = String(params.audioTranscript || "").trim();
    if (!transcript && params.audioId) {
      const { data: audio, error: audioError } = await supabase
        .from("persona_audios")
        .select("id, transcript, title")
        .eq("id", params.audioId)
        .maybeSingle();
      if (audioError) {
        throw new Error(`openai_outbound_audio_lookup_failed: ${audioError.message}`);
      }
      transcript = String(audio?.transcript || "").trim();
    }
    body = `[ÁUDIO TRANSCRITO]\n${transcript || "[transcrição indisponível]"}`;
  } else {
    const mediaType = String(params.mediaType || "").toLowerCase();
    if (mediaType === "image") body = `[IMAGEM]${body ? `\n${body}` : ""}`;
    if (mediaType === "video") body = `[VÍDEO]${body ? `\n${body}` : ""}`;
    if (mediaType === "file") body = `[ARQUIVO]${body ? `\n${body}` : ""}`;
  }

  if (!body) body = "[mensagem enviada sem conteúdo textual]";
  const content = `[DATA/HORA ORIGINAL: ${formatBootstrapTimestamp(sentAt)}]\n${body}`;

  const created = await client.conversations.items.create(
    String(link.openai_conversation_id),
    {
      items: [{
        type: "message",
        role: "assistant",
        content: [{ type: "input_text", text: content }],
      }],
    },
    { idempotencyKey: `vendeo:instagram:${providerMessageId}` },
  );

  const openAiItemId = String(created?.data?.[0]?.id || "");
  if (!openAiItemId) {
    throw new Error(`openai_outbound_item_missing_id: ${providerMessageId}`);
  }

  const syncedAt = new Date().toISOString();
  const { error: receiptWriteError } = await supabase
    .from("openai_message_receipts")
    .upsert({
      provider_message_id: providerMessageId,
      conversation_id: conversationId,
      direction: "outbound",
      openai_item_id: openAiItemId,
      received_at: sentAt,
      synced_at: syncedAt,
      sync_status: "synced",
      sync_started_at: null,
      next_retry_at: null,
      last_error: null,
      updated_at: syncedAt,
    }, { onConflict: "provider_message_id" });

  if (receiptWriteError) {
    throw new Error(`openai_outbound_receipt_write_failed: ${receiptWriteError.message}`);
  }

  return { synced: true, openAiItemId };
}

export async function resolveOpenAiConversationId(params: {
  supabase: any;
  conversationId: string;
  apiKey: string;
}): Promise<OpenAiConversationLink> {
  const { supabase, conversationId, apiKey } = params;
  const { data: existing, error: readError } = await supabase
    .from("openai_conversation_links")
    .select("openai_conversation_id, status")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (readError) throw new Error(`openai_conversation_link_read_failed: ${readError.message}`);
  if (existing?.openai_conversation_id && existing?.status === "active") {
    return {
      conversationId,
      openAiConversationId: String(existing.openai_conversation_id),
      created: false,
    };
  }

  setDefaultOpenAIKey(apiKey);
  const openAiConversationId = await startOpenAIConversationsSession();

  const { error: upsertError } = await supabase
    .from("openai_conversation_links")
    .upsert({
      conversation_id: conversationId,
      openai_conversation_id: openAiConversationId,
      runtime_version: OPENAI_CONVERSATION_RUNTIME_VERSION,
      status: "active",
      bootstrap_status: "pending",
      bootstrapped_at: null,
      bootstrap_message_count: 0,
      bootstrap_last_error: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "conversation_id" });

  if (upsertError) {
    throw new Error(`openai_conversation_link_write_failed: ${upsertError.message}`);
  }

  return {
    conversationId,
    openAiConversationId,
    created: true,
  };
}

export async function markOpenAiConversationFailure(params: {
  supabase: any;
  conversationId: string;
  error: unknown;
}): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  await params.supabase
    .from("openai_conversation_links")
    .update({
      status: "failed",
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", params.conversationId);
}
