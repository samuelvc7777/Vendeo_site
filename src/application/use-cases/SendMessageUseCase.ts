import { IChatRepository } from "@/domain/repositories/IChatRepository";
import { ChatMessage } from "@/domain/entities/Chat";

export class SendMessageUseCase {
  constructor(private chatRepository: IChatRepository) {}

  async execute(conversationId: string, text: string): Promise<ChatMessage> {
    if (!text.trim()) {
      throw new Error("A mensagem não pode ser vazia.");
    }
    return this.chatRepository.sendMessage(conversationId, text.trim());
  }
}
