export type ScheduleCategory = "sales" | "post_sale" | "relationship" | "reactivation" | "custom";
export type ScheduleResponseDelayMode = "fixed" | "range";
export type ScheduleBrainModel = "gpt-6-luna" | "gpt-6-sol" | "gpt-6.1-sol";
export type ScheduleExecutionMode = "goal_driven" | "connection_window";

export interface ScheduleTemporalPhase {
  id: string;
  label: string;
  fromPercent: number;
  toPercent: number;
  guidance: string;
}

export interface ScheduleFinalAction {
  type: "send_audio";
  assetId: string;
  title?: string;
  required: true;
  opportunityRequired: true;
  activationThresholdPercent: number;
}

export interface ConversationSchedule {
  id: string;
  name: string;
  description?: string;
  category: ScheduleCategory;
  executionMode: ScheduleExecutionMode;
  connectionIntent?: string;
  temporalPhases?: ScheduleTemporalPhase[];
  finalAction?: ScheduleFinalAction | null;
  order: number;
  isActive: boolean;
  durationMinutes?: number | null;
  responseDelayMode: ScheduleResponseDelayMode;
  responseDelayFixedSeconds?: number | null;
  responseDelayMinSeconds?: number | null;
  responseDelayMaxSeconds?: number | null;
  brainModel: ScheduleBrainModel;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationScheduleRun {
  id: string;
  conversationId: string;
  scheduleId: string;
  status: "active" | "completed" | "expired" | "expired_incomplete" | "completed_with_manual_action" | "cancelled";
  startedAt: string;
  expiresAt?: string | null;
  currentStageId?: string | null;
  completedAt?: string | null;
  finalActionStatus?: "pending" | "available" | "delivered" | "manual_required" | "failed" | null;
  finalActionDeliveredAt?: string | null;
  finalActionProviderMessageId?: string | null;
  manualActionNote?: string | null;
}

export const SCHEDULE_BRAIN_MODELS: Array<{ value: ScheduleBrainModel; label: string }> = [
  { value: "gpt-6-luna", label: "GPT-6 Luna" },
  { value: "gpt-6-sol", label: "GPT-6 Sol" },
  { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
];

export const SCHEDULE_CATEGORIES: Array<{ value: ScheduleCategory; label: string }> = [
  { value: "sales", label: "Venda" },
  { value: "post_sale", label: "Pós-venda" },
  { value: "relationship", label: "Relacionamento" },
  { value: "reactivation", label: "Reativação" },
  { value: "custom", label: "Personalizado" },
];
