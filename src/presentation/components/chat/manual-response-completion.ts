export interface PendingManualResponseSnapshot {
  inboundMessageIds: string[];
  source?: string;
}

export interface PendingManualReplyDelivery {
  conversationId: string;
  messageId: string;
  pending: PendingManualResponseSnapshot;
  responseText: string;
  complete: () => Promise<unknown>;
}

export interface ManualResponseHistoryMessage {
  id: string;
  is_mine: boolean;
  status: string | null;
  timestamp: string | null;
  text: string | null;
}

export function findConfirmedReplyAfterPendingManualResponse(
  pending: PendingManualResponseSnapshot & { createdAt?: string },
  history: ManualResponseHistoryMessage[]
): ManualResponseHistoryMessage | null {
  const pendingIds = new Set(pending.inboundMessageIds);
  const inboundMessages = history.filter((message) => pendingIds.has(message.id));
  const inboundTimestamp = inboundMessages.reduce((latest, message) => {
    const timestamp = message.timestamp ? Date.parse(message.timestamp) : 0;
    return Math.max(latest, Number.isFinite(timestamp) ? timestamp : 0);
  }, pending.createdAt ? Date.parse(pending.createdAt) : 0);

  if (!inboundTimestamp) return null;

  const latestMessage = history.reduce<ManualResponseHistoryMessage | null>((latest, message) => {
    if (!latest) return message;
    const latestTimestamp = latest.timestamp ? Date.parse(latest.timestamp) : 0;
    const timestamp = message.timestamp ? Date.parse(message.timestamp) : 0;
    return timestamp > latestTimestamp ? message : latest;
  }, null);

  if (!latestMessage?.is_mine || latestMessage.status !== "sent") return null;
  const responseText = latestMessage.text?.trim() || "";
  if (!responseText || /^\[(?:audio|image):/i.test(responseText)) return null;

  const responseTimestamp = latestMessage.timestamp ? Date.parse(latestMessage.timestamp) : 0;
  return responseTimestamp > inboundTimestamp ? latestMessage : null;
}

export function isConfirmedManualReplyDelivery(
  pending: Pick<PendingManualReplyDelivery, "conversationId" | "messageId">,
  event: { conversationId?: string | null; id?: string | null; oldId?: string | null; status?: string | null }
): boolean {
  return event.conversationId === pending.conversationId &&
    (event.id === pending.messageId || event.oldId === pending.messageId) &&
    event.status === "sent";
}

export async function completePendingManualReplyForEvent(
  deliveries: Map<string, PendingManualReplyDelivery>,
  event: { conversationId?: string | null; id?: string | null; oldId?: string | null; status?: string | null }
): Promise<boolean> {
  for (const [key, pendingReply] of deliveries) {
    if (!isConfirmedManualReplyDelivery(pendingReply, event)) continue;
    await pendingReply.complete();
    deliveries.delete(key);
    return true;
  }
  return false;
}

export async function completeManualResponseAfterSend(input: {
  deliveryStatus: "sent" | "sending" | "failed";
  responseText: string;
  pending: PendingManualResponseSnapshot | null | undefined;
  saveMemory: (pending: PendingManualResponseSnapshot, responseText: string) => Promise<boolean>;
  clearPending: () => Promise<unknown>;
}): Promise<"resolved" | "memory_failed" | null> {
  const responseText = input.responseText.trim();
  if (input.deliveryStatus !== "sent" || !responseText || !input.pending) return null;

  let memorySaved = true;
  if (input.pending.inboundMessageIds.length > 0) {
    try {
      memorySaved = await input.saveMemory(input.pending, responseText);
    } catch {
      memorySaved = false;
    }
  }

  await input.clearPending();
  return memorySaved ? "resolved" : "memory_failed";
}
