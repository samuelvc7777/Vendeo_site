import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";

export class ManageChatStagesUseCase {
  constructor(private stageRepository: IChatStageRepository) {}

  async getStages(): Promise<ChatStage[]> {
    return this.stageRepository.getStages();
  }

  async createStage(data: {
    name: string;
    scheduleId: string;
    isRequired?: boolean;
    color?: string;
    icon?: string;
    description?: string;
  }): Promise<ChatStage> {
    if (!data.name.trim()) {
      throw new Error("O nome da etapa é obrigatório.");
    }

    const current = await this.stageRepository.getStages();
    const currentScheduleStages = current.filter((stage) => stage.scheduleId === data.scheduleId);
    return this.stageRepository.createStage({
      name: data.name.trim(),
      scheduleId: data.scheduleId,
      isRequired: data.isRequired ?? true,
      order: currentScheduleStages.length,
      color: data.color || "#3b82f6",
      icon: data.icon,
      description: data.description?.trim(),
    });
  }

  async updateStage(
    id: string,
    data: {
      name?: string;
      color?: string;
      icon?: string;
      description?: string;
      scheduleId?: string;
      isRequired?: boolean;
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
    const target = current.find((stage) => stage.id === id);
    if (!target) return current;
    const scheduleStages = current.filter((stage) => stage.scheduleId === target.scheduleId).sort((a, b) => a.order - b.order);
    const index = scheduleStages.findIndex((s) => s.id === id);
    if (index <= 0) return current;

    const reordered = [...scheduleStages];
    const temp = reordered[index - 1];
    reordered[index - 1] = reordered[index];
    reordered[index] = temp;

    return this.stageRepository.reorderStages(reordered.map((s) => s.id));
  }

  async moveStageDown(id: string): Promise<ChatStage[]> {
    const current = await this.stageRepository.getStages();
    const target = current.find((stage) => stage.id === id);
    if (!target) return current;
    const scheduleStages = current.filter((stage) => stage.scheduleId === target.scheduleId).sort((a, b) => a.order - b.order);
    const index = scheduleStages.findIndex((s) => s.id === id);
    if (index === -1 || index >= scheduleStages.length - 1) return current;

    const reordered = [...scheduleStages];
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
      memoryField?: string;
      description?: string;
      kind?: ConversationGoal["kind"];
      completionPolicy?: ConversationGoal["completionPolicy"];
      actionType?: ConversationGoal["actionType"];
      actionConfig?: ConversationGoal["actionConfig"];
      required?: boolean;
      enabled?: boolean;
    }
  ): Promise<ConversationGoal> {
    if (!data.label.trim()) {
      throw new Error("O rótulo do objetivo é obrigatório.");
    }
    const kind = data.kind || "fact";
    if (kind === "fact" && !data.memoryField?.trim()) {
      throw new Error("O campo de memória é obrigatório para objetivos factuais.");
    }
    if (kind === "action" && !data.actionType) {
      throw new Error("O tipo da ação é obrigatório para objetivos de ação.");
    }

    const memoryEntity = kind === "action"
      ? undefined
      : (data.memoryEntity || (kind === "conversation_state" ? "conversation" : "self")).trim().toLowerCase();
    const memoryField = data.memoryField?.trim().toLowerCase() || undefined;
    const completionPolicy = data.completionPolicy
      || (kind === "action" ? "delivery_confirmed" : "conversation_evidence");

    if (this.stageRepository.addGoal) {
      return this.stageRepository.addGoal(stageId, {
        title: data.label.trim(),
        label: data.label.trim(),
        kind,
        memoryEntity,
        memoryField,
        description: data.description?.trim(),
        completionPolicy,
        actionType: data.actionType,
        actionConfig: data.actionConfig,
        required: data.required ?? true,
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
      title: data.label.trim(),
      label: data.label.trim(),
      kind,
      memoryEntity,
      memoryField,
      description: data.description?.trim(),
      completionPolicy,
      actionType: data.actionType,
      actionConfig: data.actionConfig,
      required: data.required ?? true,
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
