import { ChatStage, ChatProgress } from "../entities/ChatStage";

export interface IChatStageRepository {
  // Gestão de Etapas
  getStages(): Promise<ChatStage[]>;
  createStage(data: Omit<ChatStage, "id" | "createdAt" | "updatedAt">): Promise<ChatStage>;
  updateStage(id: string, data: Partial<Omit<ChatStage, "id" | "createdAt" | "updatedAt">>): Promise<ChatStage>;
  deleteStage(id: string): Promise<void>;
  reorderStages(stageIds: string[]): Promise<ChatStage[]>;

  // Gestão do Progresso por Conversa
  getChatProgress(conversationId: string): Promise<ChatProgress | null>;
  getAllChatProgresses(): Promise<Record<string, ChatProgress>>;
  saveChatProgress(progress: ChatProgress): Promise<void>;
  toggleItemCompletion(conversationId: string, itemId: string, isCompleted: boolean): Promise<ChatProgress>;
  advanceStage(conversationId: string, nextStageId: string): Promise<ChatProgress>;
  markAsConverted(conversationId: string, isConverted: boolean): Promise<ChatProgress>;
}
