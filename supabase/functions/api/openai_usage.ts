export type OpenAiUsageSource = "agents_turn" | "agents_session" | "chat_completion";

export interface NormalizedOpenAiUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
}

export interface AgentSessionUsageTelemetry {
  sessionId: string;
  model: string | null;
  sessionUsage?: unknown;
  turns: Array<{ id: string; usage: unknown }>;
  generationIds: string[] | null;
}

export interface OpenAiCycleUsageSnapshot extends NormalizedOpenAiUsage {
  cycleId: string;
  requestCount: number | null;
  cacheHitRate: number | null;
  estimatedUsd: number | null;
  estimatedBrl: number | null;
  usdBrlEstimate: number | null;
  models: string[];
  serviceTier: string | null;
  pricingBasis: "standard";
}

export interface OpenAiUsageRecord {
  id: string;
  source: OpenAiUsageSource;
  model: string | null;
  usage: unknown;
  serviceTier?: string | null;
}

const MODEL_PRICING_STANDARD: Record<string, {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
}> = {
  // Tarifas Standard fornecidas para esta implementação; revisar se a OpenAI alterar preços.
  "gpt-6-sol": { inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 10 },
  "gpt-6-luna": { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, cacheWritePerMillion: 0.125, outputPerMillion: 0.5 },
};

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeOpenAiUsage(rawUsage: unknown): NormalizedOpenAiUsage | null {
  const raw = asRecord(rawUsage);
  if (!raw) return null;

  const inputDetails = asRecord(raw.input_tokens_details) || asRecord(raw.prompt_tokens_details);
  const outputDetails = asRecord(raw.output_tokens_details) || asRecord(raw.completion_tokens_details);
  const inputTokens = tokenCount(raw.input_tokens ?? raw.prompt_tokens);
  const cachedInputTokensRaw = tokenCount(inputDetails?.cached_tokens);
  const cachedInputTokens = inputTokens === null || cachedInputTokensRaw === null
    ? cachedInputTokensRaw
    : Math.min(inputTokens, cachedInputTokensRaw);
  const outputTokens = tokenCount(raw.output_tokens ?? raw.completion_tokens);
  const totalTokens = tokenCount(raw.total_tokens);
  const cacheWriteTokens = tokenCount(inputDetails?.cache_write_tokens);

  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens !== null && cachedInputTokens !== null
      ? Math.max(0, inputTokens - cachedInputTokens)
      : null,
    outputTokens,
    reasoningTokens: tokenCount(outputDetails?.reasoning_tokens),
    cacheWriteTokens,
    totalTokens,
  };
}

export function parseUsdBrlEstimate(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function costForRecord(record: OpenAiUsageRecord, usage: NormalizedOpenAiUsage): number | null {
  const pricing = record.model ? MODEL_PRICING_STANDARD[record.model] : undefined;
  if (!pricing || usage.inputTokens === null || usage.cachedInputTokens === null || usage.outputTokens === null) {
    return null;
  }

  const tier = record.serviceTier?.toLowerCase();
  if (tier && !["auto", "default", "standard"].includes(tier)) return null;

  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const inputCost = uncachedInputTokens / 1_000_000 * pricing.inputPerMillion;
  const cachedCost = usage.cachedInputTokens / 1_000_000 * pricing.cachedInputPerMillion;
  const outputCost = usage.outputTokens / 1_000_000 * pricing.outputPerMillion;
  const cacheWriteCost = usage.cacheWriteTokens === null
    ? 0
    : usage.cacheWriteTokens / 1_000_000 * pricing.cacheWritePerMillion;
  return inputCost + cachedCost + outputCost + cacheWriteCost;
}

export class OpenAiCycleUsageAccumulator {
  private readonly cycleId: string;
  private readonly usdBrlEstimate: number | null;
  private readonly seenUsageIds = new Set<string>();
  private readonly seenInferenceIds = new Set<string>();
  private readonly seenAgentSessions = new Set<string>();
  private readonly seenGenerationIds = new Set<string>();
  private readonly modelSet = new Set<string>();
  private readonly records: Array<{ record: OpenAiUsageRecord; usage: NormalizedOpenAiUsage | null }> = [];
  private readonly traceAvailability = new Map<string, boolean>();
  private inferenceIdsComplete = true;
  private anonymousRecordCount = 0;

  constructor(cycleId: string, usdBrlEstimate: number | null) {
    this.cycleId = cycleId;
    this.usdBrlEstimate = usdBrlEstimate;
  }

  addInference(record: OpenAiUsageRecord): void {
    if (!record.id) {
      this.inferenceIdsComplete = false;
    } else if (!this.seenInferenceIds.has(`${record.source}:${record.id}`)) {
      this.seenInferenceIds.add(`${record.source}:${record.id}`);
    }
    const usageRecord = record.id
      ? record
      : { ...record, id: `anonymous-usage:${++this.anonymousRecordCount}` };
    this.addUsageRecord(usageRecord);
  }

  addAgentSession(session: AgentSessionUsageTelemetry): void {
    if (!session.sessionId || this.seenAgentSessions.has(session.sessionId)) return;
    this.seenAgentSessions.add(session.sessionId);

    if (session.model) this.modelSet.add(session.model);
    if (session.generationIds === null) {
      this.traceAvailability.set(session.sessionId, false);
    } else {
      this.traceAvailability.set(session.sessionId, true);
      for (const generationId of session.generationIds) {
        if (generationId) this.seenGenerationIds.add(`${session.sessionId}:${generationId}`);
      }
    }

    const sessionUsage = normalizeOpenAiUsage(session.sessionUsage);
    const hasSessionUsage = sessionUsage && Object.values(sessionUsage).some((value) => value !== null);
    if (hasSessionUsage) {
      this.addUsageRecord({
        id: `agents-session:${session.sessionId}`,
        source: "agents_session",
        model: session.model,
        usage: session.sessionUsage,
      });
      return;
    }

    const turnRecords = session.turns.filter((turn) => Boolean(turn.id));
    if (turnRecords.length === 0) {
      this.addUsageRecord({
        id: `agents-session:${session.sessionId}`,
        source: "agents_session",
        model: session.model,
        usage: null,
      });
      return;
    }

    for (const turn of turnRecords) {
      this.addUsageRecord({
        id: `agents-turn:${session.sessionId}:${turn.id}`,
        source: "agents_turn",
        model: session.model,
        usage: turn.usage,
      });
    }
  }

  private addUsageRecord(record: OpenAiUsageRecord): void {
    if (!record.id || this.seenUsageIds.has(record.id)) return;
    this.seenUsageIds.add(record.id);
    if (record.model) this.modelSet.add(record.model);
    this.records.push({ record, usage: normalizeOpenAiUsage(record.usage) });
  }

  snapshot(): OpenAiCycleUsageSnapshot | null {
    if (this.records.length === 0 && this.seenInferenceIds.size === 0 && this.seenGenerationIds.size === 0) {
      return null;
    }

    const fields: Array<keyof NormalizedOpenAiUsage> = [
      "inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens",
      "reasoningTokens", "cacheWriteTokens", "totalTokens",
    ];
    const totals = Object.fromEntries(fields.map((field) => [field, 0])) as Record<keyof NormalizedOpenAiUsage, number>;
    const complete = Object.fromEntries(fields.map((field) => [field, this.records.length > 0])) as Record<keyof NormalizedOpenAiUsage, boolean>;
    let estimatedUsd = 0;
    let costComplete = this.records.length > 0;
    const tiers = new Set<string>();

    for (const { record, usage } of this.records) {
      if (record.serviceTier) tiers.add(record.serviceTier);
      if (!usage) {
        for (const field of fields) complete[field] = false;
        costComplete = false;
        continue;
      }
      for (const field of fields) {
        const value = usage[field];
        if (value === null) complete[field] = false;
        else totals[field] += value;
      }
      const recordCost = costForRecord(record, usage);
      if (recordCost === null) costComplete = false;
      else estimatedUsd += recordCost;
    }

    const modelList = [...this.modelSet].sort();
    const hasUnknownTrace = [...this.traceAvailability.values()].some((available) => !available);
    const requestCount = hasUnknownTrace || !this.inferenceIdsComplete
      ? null
      : this.seenInferenceIds.size + this.seenGenerationIds.size;
    const inputTokens = complete.inputTokens ? totals.inputTokens : null;
    const cachedInputTokens = complete.cachedInputTokens ? totals.cachedInputTokens : null;
    const outputTokens = complete.outputTokens ? totals.outputTokens : null;
    const snapshot: OpenAiCycleUsageSnapshot = {
      cycleId: this.cycleId,
      requestCount,
      inputTokens,
      cachedInputTokens,
      uncachedInputTokens: complete.uncachedInputTokens ? totals.uncachedInputTokens : null,
      outputTokens,
      reasoningTokens: complete.reasoningTokens ? totals.reasoningTokens : null,
      cacheWriteTokens: complete.cacheWriteTokens ? totals.cacheWriteTokens : null,
      totalTokens: complete.totalTokens ? totals.totalTokens : null,
      cacheHitRate: inputTokens !== null && inputTokens > 0 && cachedInputTokens !== null
        ? Math.min(100, cachedInputTokens / inputTokens * 100)
        : null,
      estimatedUsd: costComplete ? estimatedUsd : null,
      estimatedBrl: costComplete && this.usdBrlEstimate !== null
        ? estimatedUsd * this.usdBrlEstimate
        : null,
      usdBrlEstimate: this.usdBrlEstimate,
      models: modelList,
      serviceTier: tiers.size === 1 ? [...tiers][0] : null,
      pricingBasis: "standard",
    };
    return snapshot;
  }
}
