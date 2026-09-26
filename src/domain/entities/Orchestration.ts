export type OrchestrationPhase = "conexao_inicial" | "descoberta";

export type OrchestrationAction = "reply" | "wait" | "advance_phase" | "escalate";

export type ProcessingStatus =
  | "idle"
  | "analyzing"
  | "decided"
  | "needs_human"
  | "sent"
  | "failed";

export interface OrchestratorDecision {
  action: OrchestrationAction;
  currentPhase: OrchestrationPhase;
  nextPhase: OrchestrationPhase;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
  requiredTools: string[];
  reasoning: string;
}

export interface ConversationOrchestrationState {
  version: 1;
  currentPhase: OrchestrationPhase;
  checkpoint: string;
  lastProcessedMessageId: string | null;
  lastProcessedAt: string | null;
  lastProcessingStatus: ProcessingStatus;
  lastCorrelationId: string | null;
  lastDecision: OrchestratorDecision | null;
  lastError: string | null;
  durationMs?: number;
  tokens?: number;
  updatedAt: string;
}

export const DEFAULT_ORCHESTRATION_STATE: ConversationOrchestrationState = {
  version: 1,
  currentPhase: "conexao_inicial",
  checkpoint: "inicio",
  lastProcessedMessageId: null,
  lastProcessedAt: null,
  lastProcessingStatus: "idle",
  lastCorrelationId: null,
  lastDecision: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
};
