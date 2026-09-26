import { VaultItemType } from "./Vault";

/**
 * Objetivo Semântico da Etapa (Canônico).
 * Define um resultado desejado que a persona deve alcançar/descobrir de forma natural.
 */
export interface StageObjective {
  id: string;
  stageId: string;
  title?: string;
  label?: string; // Compatibilidade com v231 (alias para title)
  description?: string;
  kind?: "fact" | "conversation_state"; // "fact": biográfico durável | "conversation_state": checkpoint de evolução
  /** @deprecated No Vendeo todo objetivo ativo (enabled !== false) é obrigatório por definição */
  required?: boolean;
  enabled: boolean;
  order: number;
  memoryEntity?: string; // Ex: "self", "familia"
  memoryField?: string;  // Ex: "age", "city", "occupation"
  /** Política de conclusão: "conversation_evidence" (padrão conversacional) ou "fact_only" (auto-completa se já souber o fato) */
  completionPolicy?: "conversation_evidence" | "fact_only";
  createdAt?: string;
  updatedAt?: string;
}

export type ObjectiveCompletionPolicy = "conversation_evidence" | "fact_only";

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
  legacyStageId?: string; // Identifica áudio antigo ainda sem vínculo a objetivo.
  title: string;
  audioUrl: string;
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
 * Representa o momento macro da conversa, totalmente independente de pastas do Cofre.
 */
export interface ChatStage {
  id: string;
  name: string;
  order: number;
  folderId?: string; // @deprecated: mantido opcional para compatibilidade transitória
  color?: string; // Cor de identificação da etapa (ex: #3b82f6, #10b981, #f59e0b)
  icon?: string;
  description?: string;
  objectives?: StageObjective[]; // Coleção canônica de objetivos
  goals?: StageObjective[]; // Alias para compatibilidade
  createdAt: string;
  updatedAt: string;
}

/**
 * @deprecated: Estrutura antiga de checklist baseada em arquivos do Cofre.
 */
export interface StageChecklistItem {
  id: string; // ID do VaultItem
  folderId: string;
  type: VaultItemType;
  title: string;
  content?: string;
  mediaUrl?: string;
  duration?: number;
  linkedItemId?: string;
  isCompleted: boolean;
}

export interface ChatProgress {
  conversationId: string;
  currentStageId: string;
  completedItemIds?: string[]; // @deprecated: lista de VaultItems legados
  completedGoalIds?: string[]; // Lista de IDs de objetivos concluídos
  objectiveProgress?: Record<string, ConversationObjectiveProgress>; // Progresso detalhado
  isConverted: boolean; // Se atingiu o Objetivo Final
  updatedAt: string;
}

export interface ChatStageWithStats extends ChatStage {
  totalItems: number;
  folderName?: string;
}
