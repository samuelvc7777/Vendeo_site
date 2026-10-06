import { ConversationSchedule } from "../entities/ConversationSchedule";

export interface IConversationScheduleRepository {
  getSchedules(force?: boolean): Promise<ConversationSchedule[]>;
  createSchedule(data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">): Promise<ConversationSchedule>;
  updateSchedule(id: string, data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>): Promise<ConversationSchedule>;
  deleteSchedule(id: string): Promise<void>;
  reorderSchedules(ids: string[]): Promise<ConversationSchedule[]>;
}
