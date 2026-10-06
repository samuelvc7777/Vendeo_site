import { ConversationSchedule } from "@/domain/entities/ConversationSchedule";
import { IConversationScheduleRepository } from "@/domain/repositories/IConversationScheduleRepository";

export class ManageConversationSchedulesUseCase {
  constructor(private repository: IConversationScheduleRepository) {}

  getSchedules() {
    return this.repository.getSchedules();
  }

  async createSchedule(data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt" | "order">) {
    if (!data.name.trim()) throw new Error("O nome do cronograma é obrigatório.");
    this.validateTiming(data);
    const current = await this.repository.getSchedules();
    return this.repository.createSchedule({ ...data, name: data.name.trim(), order: current.length });
  }

  async updateSchedule(id: string, data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>) {
    if (id === "schedule_sales" && data.executionMode && data.executionMode !== "goal_driven") {
      throw new Error("O cronograma de Venda deve permanecer orientado a objetivos.");
    }
    this.validateTiming(data);
    return this.repository.updateSchedule(id, data);
  }

  async deleteSchedule(id: string) {
    const schedules = await this.repository.getSchedules();
    if (schedules.length <= 1) throw new Error("O sistema precisa manter pelo menos um cronograma.");
    await this.repository.deleteSchedule(id);
  }

  async moveSchedule(id: string, direction: -1 | 1) {
    const schedules = await this.repository.getSchedules();
    const index = schedules.findIndex((item) => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= schedules.length) return schedules;
    const reordered = [...schedules];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    return this.repository.reorderSchedules(reordered.map((item) => item.id));
  }

  private validateTiming(data: Partial<ConversationSchedule>) {
    if (data.durationMinutes != null && data.durationMinutes <= 0) {
      throw new Error("A duração precisa ser maior que zero.");
    }
    if (data.responseDelayMode === "fixed" && (data.responseDelayFixedSeconds ?? 0) < 0) {
      throw new Error("O tempo fixo não pode ser negativo.");
    }
    if (data.responseDelayMode === "range") {
      const min = Number(data.responseDelayMinSeconds ?? 0);
      const max = Number(data.responseDelayMaxSeconds ?? 0);
      if (min < 0 || max < min) throw new Error("O tempo máximo deve ser maior ou igual ao mínimo.");
    }
  }
}
