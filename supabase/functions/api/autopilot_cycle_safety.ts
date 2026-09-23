// O escopo de memória do Agent já expira em 300s. O lock do ciclo não pode
// vencer antes da espera local legítima (90s de polling + I/O limitado).
export const ACTIVE_CYCLE_TTL_SECONDS = 300;
export const AGENT_LOCAL_WAIT_MS = 120_000;

export function resolveMissionMemoryContext(value: unknown, fallbackSegments: string[]): string {
  if (value === undefined || value === null) {
    return fallbackSegments.filter(Boolean).join("\n\n");
  }
  if (typeof value !== "string") {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`invalid_array_contract: field=missionPackage.relevantMemoryContext actual_type=${actualType} expected_type=string`);
  }
  return value;
}

export function classifyCycleOutboxEvidence(
  outbox: Record<string, { cycleId?: string; status?: string; providerMessageId?: string | null; isUncertain?: boolean }> | null | undefined,
  cycleId: string,
): { possibleSend: boolean; uncertain: boolean; entryCount: number } {
  const entries = Object.values(outbox || {}).filter((entry) => entry?.cycleId === cycleId);
  return {
    possibleSend: entries.some((entry) => Boolean(entry.providerMessageId || entry.isUncertain || ["sending", "sent", "dispatch_uncertain"].includes(entry.status || ""))),
    uncertain: entries.some((entry) => Boolean(entry.isUncertain || ["sending", "dispatch_uncertain"].includes(entry.status || ""))),
    entryCount: entries.length,
  };
}

export async function checkCycleAuthority(supabase: any, conversationId: string, cycleId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();
    return !error && data?.stage_completed_rules?.active_cycle_token === cycleId;
  } catch {
    return false;
  }
}
