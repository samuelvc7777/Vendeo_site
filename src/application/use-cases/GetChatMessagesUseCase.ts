import { IChatRepository } from "@/domain/repositories/IChatRepository";
import { ChatMessage } from "@/domain/entities/Chat";

export class GetChatMessagesUseCase {
  constructor(private chatRepository: IChatRepository) {}

  async execute(conversationId: string): Promise<ChatMessage[]> {
    await this.chatRepository.markAsRead(conversationId);
    return this.chatRepository.getMessages(conversationId);
  }
}
