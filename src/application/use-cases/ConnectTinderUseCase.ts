import { ITinderRepository } from "@/domain/repositories/ITinderRepository";
import { TinderSession } from "@/domain/entities/Tinder";

export class ConnectTinderUseCase {
  constructor(private tinderRepository: ITinderRepository) {}

  async execute(token: string): Promise<TinderSession> {
    if (!token || !token.trim()) {
      throw new Error("O token de autenticação é obrigatório.");
    }
    return await this.tinderRepository.connect(token.trim());
  }
}
