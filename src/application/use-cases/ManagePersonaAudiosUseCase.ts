import { IPersonaAudioRepository } from "@/domain/repositories/IPersonaAudioRepository";
import { PersonaAudioAsset, AudioDeliveryHistory } from "@/domain/entities/ChatStage";

export class ManagePersonaAudiosUseCase {
  constructor(private audioRepository: IPersonaAudioRepository) {}

  async getAudios(stageId?: string): Promise<PersonaAudioAsset[]> {
    return this.audioRepository.getAudios({ stageId });
  }

  async getAudioById(id: string): Promise<PersonaAudioAsset | null> {
    return this.audioRepository.getAudioById(id);
  }

  async saveAudio(data: Omit<PersonaAudioAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaAudioAsset> {
    return this.audioRepository.saveAudio(data);
  }

  async updateAudio(id: string, updates: Partial<PersonaAudioAsset>): Promise<PersonaAudioAsset> {
    return this.audioRepository.updateAudio(id, updates);
  }

  async deleteAudio(id: string): Promise<void> {
    return this.audioRepository.deleteAudio(id);
  }

  async toggleAudioEnabled(id: string, currentEnabled: boolean): Promise<PersonaAudioAsset> {
    return this.audioRepository.updateAudio(id, { enabled: !currentEnabled });
  }

  async searchAudios(query: string, stageId?: string): Promise<PersonaAudioAsset[]> {
    return this.audioRepository.searchAudios(query, stageId);
  }

  async getDeliveryHistory(conversationId: string): Promise<AudioDeliveryHistory[]> {
    return this.audioRepository.getDeliveryHistory(conversationId);
  }

  async recordDelivery(
    conversationId: string,
    audioId: string,
    providerMessageId?: string
  ): Promise<AudioDeliveryHistory> {
    return this.audioRepository.recordDelivery(conversationId, audioId, providerMessageId);
  }
}

