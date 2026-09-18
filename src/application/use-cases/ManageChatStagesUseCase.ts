import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { ChatStage } from "@/domain/entities/ChatStage";

export class ManageChatStagesUseCase {
  constructor(private stageRepository: IChatStageRepository) {}

  async getStages(): Promise<ChatStage[]> {
    return this.stageRepository.getStages();
  }

  async createStage(data: {
    name: string;
    folderId: string;
    color?: string;
    icon?: string;
    description?: string;
  }): Promise<ChatStage> {
    if (!data.name.trim()) {
      throw new Error("O nome da etapa é obrigatório.");
    }
    if (!data.folderId) {
      throw new Error("É necessário vincular uma pasta do cofre à etapa.");
    }

    const current = await this.stageRepository.getStages();
    return this.stageRepository.createStage({
      name: data.name.trim(),
      folderId: data.folderId,
      order: current.length,
      color: data.color || "#3b82f6",
      icon: data.icon,
      description: data.description?.trim(),
    });
  }

  async updateStage(
    id: string,
    data: {
      name?: string;
      folderId?: string;
      color?: string;
      icon?: string;
      description?: string;
    }
  ): Promise<ChatStage> {
    return this.stageRepository.updateStage(id, data);
  }

  async deleteStage(id: string): Promise<void> {
    return this.stageRepository.deleteStage(id);
  }

  async moveStageUp(id: string): Promise<ChatStage[]> {
    const current = await this.stageRepository.getStages();
    const index = current.findIndex((s) => s.id === id);
    if (index <= 0) return current; // Já está no topo

    const reordered = [...current];
    const temp = reordered[index - 1];
    reordered[index - 1] = reordered[index];
    reordered[index] = temp;

    return this.stageRepository.reorderStages(reordered.map((s) => s.id));
  }

  async moveStageDown(id: string): Promise<ChatStage[]> {
    const current = await this.stageRepository.getStages();
    const index = current.findIndex((s) => s.id === id);
    if (index === -1 || index >= current.length - 1) return current; // Já está na base

    const reordered = [...current];
    const temp = reordered[index + 1];
    reordered[index + 1] = reordered[index];
    reordered[index] = temp;

    return this.stageRepository.reorderStages(reordered.map((s) => s.id));
  }
}
