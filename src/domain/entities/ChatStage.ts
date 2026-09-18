import { VaultItemType } from "./Vault";

export interface ConversationGoal {
  id: string;
  stageId: string;
  label: string;
  memoryEntity: string; // Ex: "self", "familia"
  memoryField: string;  // Ex: "age", "city", "occupation"
  description?: string;
  required: boolean;
  order: number;
  enabled: boolean;
}

export interface ChatStage {
  id: string;
  name: string;
  order: number;
  folderId: string; // ID da pasta do cofre vinculada
  color?: string; // Cor de identificação da etapa (ex: #3b82f6, #10b981, #f59e0b)
  icon?: string;
  description?: string;
  goals?: ConversationGoal[]; // Objetivos semânticos da conversa
  createdAt: string;
  updatedAt: string;
}

export interface StageChecklistItem {
  id: string; // ID do VaultItem
  folderId: string;
  type: VaultItemType;
  title: string;
  content?: string;
  mediaUrl?: string;
  duration?: number;
  linkedItemId?: string; // ID do item vinculado para envio conjunto
  isCompleted: boolean;
}

export interface ChatProgress {
  conversationId: string;
  currentStageId: string;
  completedItemIds: string[]; // Lista de IDs de VaultItem concluídos nesta conversa
  completedGoalIds?: string[]; // Lista de IDs de ConversationGoal concluídos
  isConverted: boolean; // Se atingiu o Objetivo Final
  updatedAt: string;
}

export interface ChatStageWithStats extends ChatStage {
  totalItems: number;
  folderName?: string;
}
