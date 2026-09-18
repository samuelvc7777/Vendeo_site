import { IChatRepository } from "@/domain/repositories/IChatRepository";
import { Conversation } from "@/domain/entities/Chat";

export class GetConversationsUseCase {
  constructor(private chatRepository: IChatRepository) {}

  async execute(): Promise<Conversation[]> {
    return this.chatRepository.getConversations();
  }
}
