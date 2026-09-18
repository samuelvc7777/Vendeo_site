import { VaultItemType } from "./Vault";

export interface ChatStage {
  id: string;
  name: string;
  order: number;
  folderId: string; // ID da pasta do cofre vinculada
  color?: string; // Cor de identificação da etapa (ex: #3b82f6, #10b981, #f59e0b)
  icon?: string;
  description?: string;
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
  isConverted: boolean; // Se atingiu o Objetivo Final
  updatedAt: string;
}

export interface ChatStageWithStats extends ChatStage {
  totalItems: number;
  folderName?: string;
}
