import { ConversationArsenalItem } from "../entities/ConversationArsenal";

export interface IConversationArsenalRepository {
  getItems(scheduleId: string): Promise<ConversationArsenalItem[]>;
  createItem(data: Omit<ConversationArsenalItem, "id" | "createdAt" | "updatedAt">): Promise<ConversationArsenalItem>;
  updateItem(id: string, data: Partial<Omit<ConversationArsenalItem, "id" | "scheduleId" | "createdAt" | "updatedAt">>): Promise<ConversationArsenalItem>;
  deleteItem(id: string): Promise<void>;
}
