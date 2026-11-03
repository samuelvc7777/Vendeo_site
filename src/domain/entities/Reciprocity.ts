export type ReciprocityCategory = 'baixa' | 'moderada' | 'alta' | 'evidencia_insuficiente';
export type ReciprocityState = 'queued' | 'processing' | 'completed' | 'failed';
export type ReciprocityReason = 'manual' | 'retry' | 'reevaluation' | 'automatic';
export interface ReciprocityConfiguration {
  model: 'gpt-6-luna' | 'gpt-6.1-terra' | 'gpt-6.1-sol';
  reasoning: 'low' | 'medium' | 'high';
}
export interface ReciprocityResult {
  participation: ReciprocityCategory;
  curiosity: ReciprocityCategory;
  summary: string;
  reasons: string[];
  evolution: 'aumento' | 'diminuicao' | 'estavel' | 'indeterminada';
  limitations: string[];
  evidence: Array<{ messageId: string; quote: string; reason: string }>;
}
export interface ReciprocityCoverage {
  firstMessageId: string | null;
  lastMessageId: string | null;
  from: string | null;
  to: string | null;
  messageCount: number;
  missingMediaCount: number;
}
export interface ReciprocityAttempt {
  id: string;
  scopeId: string;
  conversationId: string;
  reason: ReciprocityReason;
  state: ReciprocityState;
  configuration: ReciprocityConfiguration;
  criteriaVersion: string;
  createdAt: string;
  completedAt?: string;
  coverage: ReciprocityCoverage;
  result?: ReciprocityResult;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  estimatedCostUsd?: number | null;
  durationMs?: number;
  error?: string;
}
export interface ReciprocityView {
  state: ReciprocityState | 'none';
  latestCompleted: ReciprocityAttempt | null;
  attempts: ReciprocityAttempt[];
  eligible: boolean;
}
