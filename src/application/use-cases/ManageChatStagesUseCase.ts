import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";

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
      goals?: ConversationGoal[];
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

  // --- MÉTODOS DE OBJETIVOS (GOALS) ---

  async addGoal(
    stageId: string,
    data: {
      label: string;
      memoryEntity?: string;
      memoryField: string;
      description?: string;
      required?: boolean;
      enabled?: boolean;
    }
  ): Promise<ConversationGoal> {
    if (!data.label.trim()) {
      throw new Error("O rótulo do objetivo é obrigatório.");
    }
    if (!data.memoryField.trim()) {
      throw new Error("O campo de memória é obrigatório.");
    }

    if (this.stageRepository.addGoal) {
      return this.stageRepository.addGoal(stageId, {
        label: data.label.trim(),
        memoryEntity: (data.memoryEntity || "self").trim().toLowerCase(),
        memoryField: data.memoryField.trim().toLowerCase(),
        description: data.description?.trim(),
        required: data.required ?? false,
        order: 0,
        enabled: data.enabled ?? true,
      });
    }

    const stages = await this.stageRepository.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw new Error(`Etapa ${stageId} não encontrada.`);
    const currentGoals = stage.goals || [];
    const newGoal: ConversationGoal = {
      id: "goal_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      stageId,
      label: data.label.trim(),
      memoryEntity: (data.memoryEntity || "self").trim().toLowerCase(),
      memoryField: data.memoryField.trim().toLowerCase(),
      description: data.description?.trim(),
      required: data.required ?? false,
      order: currentGoals.length,
      enabled: data.enabled ?? true,
    };
    stage.goals = [...currentGoals, newGoal];
    await this.stageRepository.updateStage(stageId, { goals: stage.goals });
    return newGoal;
  }

  async updateGoal(
    stageId: string,
    goalId: string,
    updates: Partial<ConversationGoal>
  ): Promise<void> {
    if (this.stageRepository.updateGoal) {
      return this.stageRepository.updateGoal(stageId, goalId, updates);
    }
    const stages = await this.stageRepository.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw new Error(`Etapa ${stageId} não encontrada.`);
    const goals = stage.goals || [];
    const idx = goals.findIndex((g) => g.id === goalId);
    if (idx === -1) throw new Error(`Objetivo ${goalId} não encontrado.`);
    goals[idx] = { ...goals[idx], ...updates };
    await this.stageRepository.updateStage(stageId, { goals });
  }

  async deleteGoal(stageId: string, goalId: string): Promise<void> {
    if (this.stageRepository.deleteGoal) {
      return this.stageRepository.deleteGoal(stageId, goalId);
    }
    const stages = await this.stageRepository.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw new Error(`Etapa ${stageId} não encontrada.`);
    const goals = (stage.goals || []).filter((g) => g.id !== goalId);
    goals.forEach((g, i) => { g.order = i; });
    await this.stageRepository.updateStage(stageId, { goals });
  }

  async moveGoalUp(stageId: string, goalId: string): Promise<void> {
    const stages = await this.stageRepository.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const goals = [...(stage.goals || [])].sort((a, b) => a.order - b.order);
    const idx = goals.findIndex((g) => g.id === goalId);
    if (idx <= 0) return;
    const temp = goals[idx - 1];
    goals[idx - 1] = goals[idx];
    goals[idx] = temp;
    goals.forEach((g, i) => { g.order = i; });
    if (this.stageRepository.reorderGoals) {
      await this.stageRepository.reorderGoals(stageId, goals.map((g) => g.id));
    } else {
      await this.stageRepository.updateStage(stageId, { goals });
    }
  }

  async moveGoalDown(stageId: string, goalId: string): Promise<void> {
    const stages = await this.stageRepository.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const goals = [...(stage.goals || [])].sort((a, b) => a.order - b.order);
    const idx = goals.findIndex((g) => g.id === goalId);
    if (idx === -1 || idx >= goals.length - 1) return;
    const temp = goals[idx + 1];
    goals[idx + 1] = goals[idx];
    goals[idx] = temp;
    goals.forEach((g, i) => { g.order = i; });
    if (this.stageRepository.reorderGoals) {
      await this.stageRepository.reorderGoals(stageId, goals.map((g) => g.id));
    } else {
      await this.stageRepository.updateStage(stageId, { goals });
    }
  }
}
