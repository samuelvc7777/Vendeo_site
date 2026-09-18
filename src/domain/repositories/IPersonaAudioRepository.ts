import { PersonaAudioAsset, AudioDeliveryHistory } from "../entities/ChatStage";

export interface IPersonaAudioRepository {
  getAudios(filters?: { stageId?: string; enabledOnly?: boolean }): Promise<PersonaAudioAsset[]>;
  getAudioById(id: string): Promise<PersonaAudioAsset | null>;
  saveAudio(audio: Omit<PersonaAudioAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaAudioAsset>;
  updateAudio(id: string, updates: Partial<PersonaAudioAsset>): Promise<PersonaAudioAsset>;
  deleteAudio(id: string): Promise<void>;
  searchAudios(query: string, stageId?: string): Promise<PersonaAudioAsset[]>;
  getDeliveryHistory(conversationId: string): Promise<AudioDeliveryHistory[]>;
  recordDelivery(conversationId: string, audioId: string, providerMessageId?: string): Promise<AudioDeliveryHistory>;
}
