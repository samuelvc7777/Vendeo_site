export interface BoundedDebounceInput {
  nowMs?: number;
  responseDelayMinutes: number;
  maxDebounceWindowMinutes?: number;
  batchStartedAt?: string | null;
}

export interface BoundedDebounceResult {
  batchStartedAt: string;
  scheduledAt: string;
  delayMs: number;
  maxWindowMs: number;
  capped: boolean;
  dueNow: boolean;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function computeBoundedDebounce(input: BoundedDebounceInput): BoundedDebounceResult {
  const nowMs = input.nowMs ?? Date.now();
  const delayMinutes = finiteNonNegative(input.responseDelayMinutes, 0);
  const configuredMaxMinutes = finiteNonNegative(
    input.maxDebounceWindowMinutes,
    Math.max(delayMinutes, 3),
  );
  const effectiveMaxMinutes = Math.max(delayMinutes, configuredMaxMinutes);
  const delayMs = Math.round(delayMinutes * 60_000);
  const maxWindowMs = Math.round(effectiveMaxMinutes * 60_000);

  const parsedStartedAt = input.batchStartedAt
    ? new Date(input.batchStartedAt).getTime()
    : NaN;
  const batchStartMs = Number.isFinite(parsedStartedAt) && parsedStartedAt <= nowMs
    ? parsedStartedAt
    : nowMs;

  const desiredAtMs = nowMs + delayMs;
  const capAtMs = batchStartMs + maxWindowMs;
  const scheduledAtMs = Math.min(desiredAtMs, capAtMs);

  return {
    batchStartedAt: new Date(batchStartMs).toISOString(),
    scheduledAt: new Date(Math.max(nowMs, scheduledAtMs)).toISOString(),
    delayMs,
    maxWindowMs,
    capped: scheduledAtMs < desiredAtMs,
    dueNow: scheduledAtMs <= nowMs,
  };
}
