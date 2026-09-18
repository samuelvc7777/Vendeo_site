import { ITinderRepository, TinderMessageItem } from "@/domain/repositories/ITinderRepository";

export class SendTinderMessageUseCase {
  constructor(private tinderRepository: ITinderRepository) {}

  async execute(matchId: string, text: string): Promise<TinderMessageItem> {
    if (!text || !text.trim()) {
      throw new Error("A mensagem não pode estar vazia.");
    }
    return await this.tinderRepository.sendMessage(matchId, text.trim());
  }
}
