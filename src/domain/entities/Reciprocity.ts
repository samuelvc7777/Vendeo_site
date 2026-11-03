export type ReciprocityCategory = 'baixa' | 'moderada' | 'alta' | 'evidencia_insuficiente';
export type ReciprocityState = 'queued' | 'processing' | 'completed' | 'failed';
export type ReciprocityReason = 'manual' | 'retry' | 'reevaluation' | 'automatic';
export const RECIPROCITY_MODELS = [
  { value: 'gpt-6-luna', label: 'Luna' },
  { value: 'gpt-6.1-terra', label: 'Terra' },
  { value: 'gpt-6.1-sol', label: 'Sol' },
] as const;
export const RECIPROCITY_REASONING_LEVELS = [
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
] as const;
export interface ReciprocityConfiguration {
  model: typeof RECIPROCITY_MODELS[number]['value'];
  reasoning: typeof RECIPROCITY_REASONING_LEVELS[number]['value'];
}
export function isReciprocityConfiguration(value: unknown): value is ReciprocityConfiguration {
  if (!value || typeof value !== 'object') return false;
  const configuration = value as Partial<ReciprocityConfiguration>;
  return RECIPROCITY_MODELS.some(model => model.value === configuration.model)
    && RECIPROCITY_REASONING_LEVELS.some(level => level.value === configuration.reasoning);
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
