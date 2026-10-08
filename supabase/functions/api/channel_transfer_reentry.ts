type TransferOutcome = "failed" | "uncertain";
type TransferStatus = "confirmed" | "failed" | "uncertain";

type TransferReentryEvent = {
  id: string;
  type: "channel_transfer_result";
  sourceChannel: string;
  targetChannel: string;
  status: TransferOutcome;
  technicalCode: string;
  details?: string;
};

function isSuccessfulRpc(data: any): boolean {
  return data?.success === true;
}

async function enqueueRowsById(supabase: any, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data: rows, error: readError } = await supabase
    .from("conversation_channel_transfers")
    .select("id, conversation_id, brain_reentry_message_id, brain_reentry_status, brain_reentry_queued_at, updated_at")
    .in("id", ids);
  if (readError) throw new Error(`transfer_reentry_read_failed:${readError.message}`);

  const eligible = (rows || []).filter((row: any) =>
    row.brain_reentry_status === "pending" || (
      row.brain_reentry_status === "queueing" &&
      Date.parse(String(row.brain_reentry_queued_at || row.updated_at || "")) < Date.now() - 120_000
    )
  );
  const byConversation = new Map<string, any[]>();
  for (const row of eligible) {
    const conversationId = String(row.conversation_id || "");
    if (!conversationId) continue;
    byConversation.set(conversationId, [...(byConversation.get(conversationId) || []), row]);
  }

  let queuedCount = 0;
  for (const [conversationId, group] of byConversation) {
    const rowIds = group.map((row) => String(row.id));
    const messageId = [...group]
      .sort((a, b) => Date.parse(String(a.updated_at || 0)) - Date.parse(String(b.updated_at || 0)))
      .map((row) => String(row.brain_reentry_message_id || ""))
      .find(Boolean);
    if (!messageId) {
      await supabase.from("conversation_channel_transfers")
        .update({ brain_reentry_status: "blocked", updated_at: new Date().toISOString() })
        .in("id", rowIds)
        .in("brain_reentry_status", ["pending", "queueing"]);
      continue;
    }

    const claimedIds: string[] = [];
    const pendingIds = group.filter((row) => row.brain_reentry_status === "pending").map((row) => String(row.id));
    if (pendingIds.length > 0) {
      const { data: claimedRows, error: claimError } = await supabase
        .from("conversation_channel_transfers")
        .update({ brain_reentry_status: "queueing", brain_reentry_queued_at: new Date().toISOString() })
        .in("id", pendingIds)
        .eq("brain_reentry_status", "pending")
        .select("id");
      if (claimError) throw new Error(`transfer_reentry_claim_failed:${claimError.message}`);
      claimedIds.push(...(claimedRows || []).map((row: any) => String(row.id)));
    }
    const queueingIds = group.filter((row) => row.brain_reentry_status === "queueing").map((row) => String(row.id));
    if (queueingIds.length > 0) {
      const staleCutoff = new Date(Date.now() - 120_000).toISOString();
      const { data: claimedRows, error: claimError } = await supabase
        .from("conversation_channel_transfers")
        .update({ brain_reentry_queued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in("id", queueingIds)
        .eq("brain_reentry_status", "queueing")
        .lt("brain_reentry_queued_at", staleCutoff)
        .select("id");
      if (claimError) throw new Error(`transfer_reentry_recovery_claim_failed:${claimError.message}`);
      claimedIds.push(...(claimedRows || []).map((row: any) => String(row.id)));
    }
    if (claimedIds.length === 0) continue;

    const { data: queueResult, error: queueError } = await supabase.rpc("enqueue_autopilot_inbound_job", {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_due_at: new Date().toISOString(),
    });

    if (queueError || !isSuccessfulRpc(queueResult)) {
      await supabase.from("conversation_channel_transfers")
        .update({ brain_reentry_status: "pending", brain_reentry_queued_at: null, updated_at: new Date().toISOString() })
        .in("id", claimedIds)
        .eq("brain_reentry_status", "queueing");
      throw new Error(`transfer_reentry_enqueue_failed:${queueError?.message || queueResult?.reason || "unknown"}`);
    }

    const { error: queuedError } = await supabase.from("conversation_channel_transfers")
      .update({ brain_reentry_status: "queued", brain_reentry_queued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", claimedIds)
      .eq("brain_reentry_status", "queueing");
    if (queuedError) {
      // O job já está durável na fila. A varredura recupera o estado queueing vencido.
      console.error("[TransferReentry] Job enfileirado, mas estado do evento não foi atualizado:", queuedError);
    } else {
      queuedCount += claimedIds.length;
    }
  }
  return queuedCount;
}

export async function queueTransferBrainReentry(params: {
  supabase: any;
  conversationId: string;
  sourceChannel: string;
  targetChannel: string;
  targetRecipient: string;
  initialMessageText: string;
  idempotencyKey?: string;
  sourceMessageIds?: string[];
  status: TransferStatus;
  transferStatus?: TransferStatus;
  providerMessageId?: string | null;
  technicalCode: string;
  details?: string;
  rawInput?: string;
}): Promise<{ eventId: string | null; queued: boolean }> {
  const { supabase } = params;
  const transferKey = params.idempotencyKey || `transfer:${params.conversationId}:${params.targetChannel}:${params.targetRecipient}`;
  let sourceMessageId = (params.sourceMessageIds || []).map(String).filter(Boolean).at(-1) || null;
  if (!sourceMessageId) {
    try {
      const { data: latestInbound, error: messageError } = await supabase
        .from("instagram_messages")
        .select("id")
        .eq("conversation_id", params.conversationId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (messageError) {
        console.warn("[TransferReentry] Não foi possível localizar uma mensagem de origem para o retorno:", messageError);
      }
      sourceMessageId = latestInbound?.id ? String(latestInbound.id) : null;
    } catch (messageLookupError) {
      console.warn("[TransferReentry] Consulta de mensagem de origem indisponível:", messageLookupError);
    }
  }

  const eventStatus: TransferOutcome = params.status === "uncertain" ? "uncertain" : "failed";
  const technicalCode = String(params.technicalCode || "transfer_failed").slice(0, 160);
  const details = params.details ? String(params.details).slice(0, 1200) : null;
  const rawInput = String(params.rawInput ?? params.targetRecipient ?? "").slice(0, 128);
  const now = new Date().toISOString();
  const eventFields = {
    status: params.transferStatus || params.status,
    provider_message_id: params.providerMessageId || null,
    failure_reason: technicalCode,
    brain_reentry_status: sourceMessageId ? "pending" : "blocked",
    brain_reentry_message_id: sourceMessageId,
    brain_reentry_processed_at: null,
    brain_reentry_queued_at: null,
    brain_reentry_outcome: eventStatus,
    brain_reentry_technical_code: technicalCode,
    brain_reentry_details: details,
    updated_at: now,
  };

  const { data: existing, error: lookupError } = await supabase
    .from("conversation_channel_transfers")
    .select("id")
    .eq("idempotency_key", transferKey)
    .maybeSingle();
  if (lookupError) throw new Error(`transfer_reentry_transfer_lookup_failed:${lookupError.message}`);

  let eventId = existing?.id ? String(existing.id) : null;
  if (eventId) {
    const { error: updateError } = await supabase.from("conversation_channel_transfers")
      .update(eventFields)
      .eq("id", eventId);
    if (updateError) throw new Error(`transfer_reentry_transfer_update_failed:${updateError.message}`);
  } else {
    const { data: inserted, error: insertError } = await supabase.from("conversation_channel_transfers")
      .insert({
        conversation_id: params.conversationId,
        source_channel: params.sourceChannel,
        target_channel: params.targetChannel,
        target_recipient: rawInput,
        initial_message_text: params.initialMessageText,
        idempotency_key: transferKey,
        metadata: { rawInput },
        ...eventFields,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(`transfer_reentry_transfer_insert_failed:${insertError.message}`);
    eventId = inserted?.id ? String(inserted.id) : null;
  }

  if (!eventId || !sourceMessageId) return { eventId, queued: false };
  const queued = await enqueueRowsById(supabase, [eventId]);
  return { eventId, queued: queued > 0 };
}

export async function enqueuePendingTransferBrainReentries(supabase: any, limit = 50): Promise<number> {
  const staleQueueingAt = new Date(Date.now() - 120_000).toISOString();
  const { data: pendingRows, error: pendingError } = await supabase
    .from("conversation_channel_transfers")
    .select("id")
    .eq("brain_reentry_status", "pending")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (pendingError) throw new Error(`transfer_reentry_pending_scan_failed:${pendingError.message}`);
  const { data: staleRows, error: staleError } = await supabase
    .from("conversation_channel_transfers")
    .select("id")
    .eq("brain_reentry_status", "queueing")
    .lt("brain_reentry_queued_at", staleQueueingAt)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (staleError) throw new Error(`transfer_reentry_stale_scan_failed:${staleError.message}`);
  const ids = [...new Set([...(pendingRows || []), ...(staleRows || [])].map((row: any) => String(row.id)).filter(Boolean))];
  return enqueueRowsById(supabase, ids);
}

export async function loadPendingTransferBrainEvents(supabase: any, conversationId: string): Promise<TransferReentryEvent[]> {
  const { data, error } = await supabase
    .from("conversation_channel_transfers")
    .select("id, source_channel, target_channel, brain_reentry_outcome, brain_reentry_technical_code, brain_reentry_details")
    .eq("conversation_id", conversationId)
    .in("brain_reentry_status", ["queued", "queueing"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`transfer_reentry_events_load_failed:${error.message}`);
  return (data || []).map((row: any) => ({
    id: String(row.id),
    type: "channel_transfer_result" as const,
    sourceChannel: String(row.source_channel || ""),
    targetChannel: String(row.target_channel || ""),
    status: row.brain_reentry_outcome === "uncertain" ? "uncertain" as const : "failed" as const,
    technicalCode: String(row.brain_reentry_technical_code || "transfer_failed"),
    details: row.brain_reentry_details ? String(row.brain_reentry_details) : undefined,
  }));
}

export async function markTransferBrainEventsProcessed(supabase: any, events: TransferReentryEvent[]): Promise<void> {
  const ids = events.map((event) => event.id).filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabase.from("conversation_channel_transfers")
    .update({ brain_reentry_status: "processed", brain_reentry_processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("id", ids)
    .in("brain_reentry_status", ["queued", "queueing"]);
  if (error) throw new Error(`transfer_reentry_events_complete_failed:${error.message}`);
}
