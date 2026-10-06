import { ConversationSchedule } from "@/domain/entities/ConversationSchedule";
import { IConversationScheduleRepository } from "@/domain/repositories/IConversationScheduleRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabaseConversationScheduleRepository implements IConversationScheduleRepository {
  private customClient?: any;
  private cache: ConversationSchedule[] | null = null;
  private cacheAt = 0;

  constructor(client?: any) {
    this.customClient = client;
  }

  private getClient() {
    if (this.customClient) return this.customClient;
    return typeof window !== "undefined" ? getSupabaseBrowserClient() : getSupabaseServerClient();
  }

  private map(row: any): ConversationSchedule {
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description || undefined,
      category: row.category || "custom",
      executionMode: row.execution_mode === "connection_window" ? "connection_window" : "goal_driven",
      connectionIntent: row.connection_intent || undefined,
      temporalPhases: Array.isArray(row.temporal_phases) ? row.temporal_phases : undefined,
      finalAction: row.final_action && typeof row.final_action === "object" ? row.final_action : null,
      order: Number(row.schedule_order || 0),
      isActive: row.is_active !== false,
      durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
      responseDelayMode: row.response_delay_mode === "range" ? "range" : "fixed",
      responseDelayFixedSeconds: row.response_delay_fixed_seconds == null ? null : Number(row.response_delay_fixed_seconds),
      responseDelayMinSeconds: row.response_delay_min_seconds == null ? null : Number(row.response_delay_min_seconds),
      responseDelayMaxSeconds: row.response_delay_max_seconds == null ? null : Number(row.response_delay_max_seconds),
      brainModel: row.brain_model || "gpt-6.1-sol",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getSchedules(force = false): Promise<ConversationSchedule[]> {
    const now = Date.now();
    if (!force && this.cache && now - this.cacheAt < 2500) return [...this.cache];
    const client = this.getClient();
    if (!client) return [];
    const { data, error } = await client
      .from("conversation_schedules")
      .select("*")
      .order("schedule_order", { ascending: true });
    if (error) throw new Error(error.message || "Falha ao carregar cronogramas.");
    this.cache = (data || []).map((row: any) => this.map(row));
    this.cacheAt = now;
    return [...(this.cache || [])];
  }

  async createSchedule(data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">): Promise<ConversationSchedule> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const id = "schedule_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString();
    const payload = {
      id,
      name: data.name,
      description: data.description || null,
      category: data.category,
      execution_mode: data.executionMode,
      connection_intent: data.connectionIntent || null,
      temporal_phases: data.temporalPhases || undefined,
      final_action: data.finalAction || null,
      schedule_order: data.order,
      is_active: data.isActive,
      duration_minutes: data.durationMinutes ?? null,
      response_delay_mode: data.responseDelayMode,
      response_delay_fixed_seconds: data.responseDelayMode === "fixed" ? data.responseDelayFixedSeconds ?? 0 : null,
      response_delay_min_seconds: data.responseDelayMode === "range" ? data.responseDelayMinSeconds ?? 0 : null,
      response_delay_max_seconds: data.responseDelayMode === "range" ? data.responseDelayMaxSeconds ?? 0 : null,
      brain_model: data.brainModel,
      created_at: now,
      updated_at: now,
    };
    const { data: inserted, error } = await client.from("conversation_schedules").insert(payload).select().single();
    if (error) throw new Error(error.message || "Falha ao criar cronograma.");
    this.cache = null;
    return this.map(inserted);
  }

  async updateSchedule(id: string, data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>): Promise<ConversationSchedule> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description || null;
    if (data.category !== undefined) payload.category = data.category;
    if (data.executionMode !== undefined) payload.execution_mode = data.executionMode;
    if (data.connectionIntent !== undefined) payload.connection_intent = data.connectionIntent || null;
    if (data.temporalPhases !== undefined) payload.temporal_phases = data.temporalPhases || [];
    if (data.finalAction !== undefined) payload.final_action = data.finalAction || null;
    if (data.order !== undefined) payload.schedule_order = data.order;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.durationMinutes !== undefined) payload.duration_minutes = data.durationMinutes ?? null;
    if (data.responseDelayMode !== undefined) payload.response_delay_mode = data.responseDelayMode;
    if (data.brainModel !== undefined) payload.brain_model = data.brainModel;
    if (data.responseDelayFixedSeconds !== undefined) payload.response_delay_fixed_seconds = data.responseDelayFixedSeconds ?? null;
    if (data.responseDelayMinSeconds !== undefined) payload.response_delay_min_seconds = data.responseDelayMinSeconds ?? null;
    if (data.responseDelayMaxSeconds !== undefined) payload.response_delay_max_seconds = data.responseDelayMaxSeconds ?? null;

    if (data.responseDelayMode === "fixed") {
      payload.response_delay_min_seconds = null;
      payload.response_delay_max_seconds = null;
    } else if (data.responseDelayMode === "range") {
      payload.response_delay_fixed_seconds = null;
    }

    const { data: updated, error } = await client
      .from("conversation_schedules")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message || "Falha ao atualizar cronograma.");
    this.cache = null;
    return this.map(updated);
  }

  async deleteSchedule(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    const { error } = await client.from("conversation_schedules").delete().eq("id", id);
    if (error) throw new Error(error.message || "Falha ao excluir cronograma.");
    this.cache = null;
  }

  async reorderSchedules(ids: string[]): Promise<ConversationSchedule[]> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível.");
    for (let index = 0; index < ids.length; index += 1) {
      const { error } = await client
        .from("conversation_schedules")
        .update({ schedule_order: index, updated_at: new Date().toISOString() })
        .eq("id", ids[index]);
      if (error) throw new Error(error.message || "Falha ao reordenar cronogramas.");
    }
    this.cache = null;
    return this.getSchedules(true);
  }
}
