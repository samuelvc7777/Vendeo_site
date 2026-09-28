export async function runDeduplicatedConversationFetch(
  inFlight: Map<string, Promise<void>>,
  conversationId: string,
  request: () => Promise<void>,
  onDeduplicated?: () => void,
): Promise<void> {
  const existing = inFlight.get(conversationId);
  if (existing) {
    onDeduplicated?.();
    await existing;
    return;
  }

  const pending = Promise.resolve().then(request);
  inFlight.set(conversationId, pending);
  try {
    await pending;
  } finally {
    if (inFlight.get(conversationId) === pending) {
      inFlight.delete(conversationId);
    }
  }
}

export function hasNewConversationMessage(
  incomingTimestamp: number,
  latestKnownTimestamp: number,
  latestRealtimeMessageTimestamp = 0,
): boolean {
  if (!Number.isFinite(incomingTimestamp) || incomingTimestamp <= 0) return false;
  return incomingTimestamp > Math.max(latestKnownTimestamp, latestRealtimeMessageTimestamp);
}
