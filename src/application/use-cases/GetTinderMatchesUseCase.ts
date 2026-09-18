import { ITinderRepository, TinderMatchItem } from "@/domain/repositories/ITinderRepository";

export class GetTinderMatchesUseCase {
  constructor(private tinderRepository: ITinderRepository) {}

  async execute(): Promise<TinderMatchItem[]> {
    return await this.tinderRepository.getMatches();
  }
}
