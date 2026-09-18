import { ChatStage, ChatProgress, ConversationGoal } from "../entities/ChatStage";

export interface IChatStageRepository {
  // Gestão de Etapas
  getStages(): Promise<ChatStage[]>;
  createStage(data: Omit<ChatStage, "id" | "createdAt" | "updatedAt">): Promise<ChatStage>;
  updateStage(id: string, data: Partial<Omit<ChatStage, "id" | "createdAt" | "updatedAt">>): Promise<ChatStage>;
  deleteStage(id: string): Promise<void>;
  reorderStages(stageIds: string[]): Promise<ChatStage[]>;

  // Gestão de Objetivos da Conversa (Goals)
  addGoal?(stageId: string, goal: Omit<ConversationGoal, "id" | "stageId">): Promise<ConversationGoal>;
  updateGoal?(stageId: string, goalId: string, updates: Partial<ConversationGoal>): Promise<void>;
  deleteGoal?(stageId: string, goalId: string): Promise<void>;
  reorderGoals?(stageId: string, goalIds: string[]): Promise<void>;

  // Gestão do Progresso por Conversa
  getChatProgress(conversationId: string): Promise<ChatProgress | null>;
  getAllChatProgresses(): Promise<Record<string, ChatProgress>>;
  saveChatProgress(progress: ChatProgress): Promise<void>;
  toggleItemCompletion(conversationId: string, itemId: string, isCompleted: boolean): Promise<ChatProgress>;
  toggleGoalCompletion?(conversationId: string, goalId: string, isCompleted: boolean): Promise<ChatProgress>;
  advanceStage(conversationId: string, nextStageId: string): Promise<ChatProgress>;
  markAsConverted(conversationId: string, isConverted: boolean): Promise<ChatProgress>;
}
