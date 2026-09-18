import {
  InstagramAccount,
  InstagramConfig,
  InstagramConversation,
  InstagramMessage,
} from "@/domain/entities/Instagram";

export interface IInstagramRepository {
  getConfig(): Promise<InstagramConfig | null>;
  saveConfig(config: Partial<InstagramConfig>): Promise<InstagramConfig>;
  disconnect(): Promise<void>;
  getConversations(): Promise<InstagramConversation[]>;
  saveConversation(conv: Partial<InstagramConversation> & { id: string }): Promise<void>;
  getMessages(conversationId: string): Promise<InstagramMessage[]>;
  saveMessage(msg: InstagramMessage): Promise<void>;
}
