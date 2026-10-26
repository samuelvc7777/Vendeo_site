import { PersonaImageAsset, ImageDeliveryHistory } from "@/domain/entities/ChatStage";

export interface IPersonaImageRepository {
  getImages(filters?: { objectiveId?: string; enabledOnly?: boolean }): Promise<PersonaImageAsset[]>;
  getImageById(id: string): Promise<PersonaImageAsset | null>;
  saveImage(data: Omit<PersonaImageAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaImageAsset>;
  updateImage(id: string, updates: Partial<PersonaImageAsset>): Promise<PersonaImageAsset>;
  deleteImage(id: string): Promise<void>;
  searchImages(query: string, objectiveId?: string): Promise<PersonaImageAsset[]>;
  getDeliveryHistory(conversationId: string): Promise<ImageDeliveryHistory[]>;
  recordDelivery(conversationId: string, imageId: string, providerMessageId?: string): Promise<ImageDeliveryHistory>;
}
