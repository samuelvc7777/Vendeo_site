import { Conversation, ChatMessage } from "../entities/Chat";

export interface IChatRepository {
  getConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  sendMessage(conversationId: string, text: string): Promise<ChatMessage>;
  markAsRead(conversationId: string): Promise<void>;
}
