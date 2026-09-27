type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function cycleTokenFromDecision(decision: JsonRecord): string | null {
  const payload = asRecord(decision.payload);
  const semanticState = asRecord(payload?.semanticState);
  const value = semanticState?.cycleToken;
  return typeof value === "string" && value ? value : null;
}

function cycleTokenFromEvent(event: JsonRecord): string | null {
  const metadata = asRecord(event.metadata);
  const value = metadata?.cycleId ?? metadata?.cycle_id;
  return typeof value === "string" && value ? value : null;
}

/** Adds persisted turn/session IDs to projection events using their existing cycle token. */
export function enrichBrainTurnEventRows<T extends JsonRecord>(events: T[], decisions: JsonRecord[]): T[] {
  const turnByCycle = new Map<string, { turnId: string; sessionId?: string }>();
  for (const decision of decisions) {
    const cycleToken = cycleTokenFromDecision(decision);
    const turnId = decision.turn_id;
    if (!cycleToken || typeof turnId !== "string" || !turnId || turnByCycle.has(cycleToken)) continue;
    turnByCycle.set(cycleToken, {
      turnId,
      sessionId: typeof decision.session_id === "string" ? decision.session_id : undefined,
    });
  }

  return events.map((event) => {
    if (typeof event.turn_id === "string" && event.turn_id) return event;
    const cycleToken = cycleTokenFromEvent(event);
    const persistedTurn = cycleToken ? turnByCycle.get(cycleToken) : undefined;
    if (!persistedTurn) return event;
    return {
      ...event,
      turn_id: persistedTurn.turnId,
      session_id: typeof event.session_id === "string" && event.session_id ? event.session_id : persistedTurn.sessionId ?? null,
    };
  });
}
