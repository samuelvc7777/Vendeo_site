/**
 * Objetivo Semântico da Etapa (Canônico).
 * Define um resultado desejado que a persona deve alcançar/descobrir de forma natural.
 */
export type StageObjectiveKind = "fact" | "conversation_state" | "action";
export type StageActionType =
  | "send_audio"
  | "send_raffle_details"
  | "send_raffle_numbers"
  | "operator_handoff";

export interface StageActionConfig {
  raffleSource?: "active";
  numbersCount?: number;
  finalizeWorkflowOnCompletion?: boolean;
}

export interface StageObjective {
  id: string;
  stageId: string;
  title?: string;
  label?: string; // Compatibilidade com v231 (alias para title)
  description?: string;
  kind?: StageObjectiveKind; // "action": missão obrigatória executada pelo Brain
  /** Regra de produto: o Brain recebe este valor e não pode redefinir a obrigatoriedade. */
  required?: boolean;
  enabled: boolean;
  order: number;
  memoryEntity?: string; // Ex: "self", "familia"
  memoryField?: string;  // Ex: "age", "city", "occupation"
  /** Política de conclusão. Ações de entrega só concluem após confirmação real do provedor. */
  completionPolicy?: "conversation_evidence" | "fact_only" | "delivery_confirmed" | "operator_handoff";
  actionType?: StageActionType;
  actionConfig?: StageActionConfig;
  createdAt?: string;
  updatedAt?: string;
}

// Type alias para compatibilidade com código existente
export type ConversationGoal = StageObjective;

/**
 * Progresso de um Objetivo em uma Conversa específica.
 */
export interface ConversationObjectiveProgress {
  conversationId: string;
  stageId: string;
  objectiveId: string;
  status: "pending" | "completed" | "skipped";
  value?: string | number | boolean | null;
  evidenceMessageId?: string;
  completedAt?: string;
}

/**
 * Áudio da Persona (Biblioteca de Voz da Larissa no Cofre).
 */
export interface PersonaAudioAsset {
  id: string;
  objectiveId?: string;
  title: string;
  audioUrl: string;
  whatsappAudioUrl?: string;
  duration?: number; // Duração em segundos
  transcript: string; // Conteúdo persistido para busca semântica
  usageInstruction: string; // Quando usar este áudio
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Histórico de Entrega de Áudio na Conversa.
 */
export interface AudioDeliveryHistory {
  id: string;
  conversationId: string;
  audioId: string;
  sentAt: string;
  providerMessageId?: string;
}

/**
 * Etapa da Conversa (Canônica).
 * Representa o momento macro da conversa, independente de pastas do Cofre.
 */
export interface ChatStage {
  id: string;
  name: string;
  order: number;
  scheduleId: string;
  isRequired: boolean;
  color?: string; // Cor de identificação da etapa (ex: #3b82f6, #10b981, #f59e0b)
  icon?: string;
  description?: string;
  objectives?: StageObjective[]; // Coleção canônica de objetivos
  goals?: StageObjective[]; // Alias para compatibilidade
  createdAt: string;
  updatedAt: string;
}

export interface ChatProgress {
  conversationId: string;
  currentStageId: string;
  completedGoalIds?: string[]; // Lista de IDs de objetivos concluídos
  objectiveProgress?: Record<string, ConversationObjectiveProgress>; // Progresso detalhado
  isConverted: boolean; // Se atingiu o Objetivo Final
  updatedAt: string;
}
