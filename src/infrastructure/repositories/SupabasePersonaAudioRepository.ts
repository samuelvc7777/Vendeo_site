/**
 * src/infrastructure/repositories/SupabasePersonaAudioRepository.ts
 * Repositório Oficial de Áudios da Persona Larissa e Histórico de Envios.
 * 
 * Regra Arquitetural Absoluta:
 * - As tabelas 'public.persona_audios' e 'public.audio_delivery_history' são as ÚNICAS fontes de verdade.
 * - Zero localStorage.
 * - Zero pseudo-registros globais (__persona_audios__, __audio_history__).
 * - Sincronização em tempo real via canais do Supabase Realtime.
 */

import { IPersonaAudioRepository } from "@/domain/repositories/IPersonaAudioRepository";
import { PersonaAudioAsset, AudioDeliveryHistory } from "@/domain/entities/ChatStage";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabasePersonaAudioRepository implements IPersonaAudioRepository {
  private customClient?: any;
  private cachedAudios: PersonaAudioAsset[] | null = null;
  private lastFetchAudiosTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  constructor(client?: any) {
    if (client) {
      this.customClient = client;
    }
  }

  private getClient() {
    if (this.customClient) {
      return this.customClient;
    }
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private mapRowToAudio(row: any): PersonaAudioAsset {
    return {
      id: row.id,
      stageId: row.stage_id || undefined,
      title: row.title,
      audioUrl: row.audio_url,
      duration: row.duration != null ? Number(row.duration) : undefined,
      transcript: row.transcript || "",
      usageInstruction: row.usage_instruction || "",
      enabled: row.enabled ?? true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToHistory(row: any): AudioDeliveryHistory {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      audioId: row.audio_id,
      sentAt: row.sent_at,
      providerMessageId: row.provider_message_id || undefined,
    };
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("persona-audios-db-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "persona_audios",
          },
          () => {
            this.cachedAudios = null;
            this.lastFetchAudiosTime = 0;
          }
        )
        .subscribe();
    } catch {
      // Fail-safe silencioso
    }
  }

  async getAudios(filters?: { stageId?: string; enabledOnly?: boolean }): Promise<PersonaAudioAsset[]> {
    this.initRealtimeSubscription();
    const now = Date.now();

    let allAudios: PersonaAudioAsset[] = [];
    if (this.cachedAudios && now - this.lastFetchAudiosTime < this.cacheDurationMs) {
      allAudios = this.cachedAudios;
    } else {
      const client = this.getClient();
      if (client) {
        try {
          const { data, error } = await client
            .from("persona_audios")
            .select("*")
            .order("title", { ascending: true });

          if (!error && data && Array.isArray(data)) {
            allAudios = data.map((r) => this.mapRowToAudio(r));
            this.cachedAudios = allAudios;
            this.lastFetchAudiosTime = now;
          } else if (error) {
            console.error("[SupabasePersonaAudioRepository] Erro ao buscar áudios:", error);
          }
        } catch (err) {
          console.error("[SupabasePersonaAudioRepository] Exceção ao consultar persona_audios:", err);
        }
      }
    }

    return allAudios.filter((a) => {
      if (filters?.enabledOnly && !a.enabled) return false;
      if (filters?.stageId && a.stageId && a.stageId !== filters.stageId) return false;
      return true;
    });
  }

  async getAudioById(id: string): Promise<PersonaAudioAsset | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("persona_audios")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;
      return this.mapRowToAudio(data);
    } catch (err) {
      console.warn(`[SupabasePersonaAudioRepository] Erro ao buscar áudio ${id}:`, err);
      return null;
    }
  }

  async saveAudio(data: Omit<PersonaAudioAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaAudioAsset> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const newId = "audio_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();

    const rowPayload = {
      id: newId,
      stage_id: data.stageId || null,
      title: data.title.trim(),
      audio_url: data.audioUrl,
      duration: data.duration != null ? Math.round(data.duration) : null,
      transcript: data.transcript || "",
      usage_instruction: data.usageInstruction || "",
      enabled: data.enabled ?? true,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error } = await client
      .from("persona_audios")
      .insert(rowPayload)
      .select()
      .single();

    if (error) {
      console.error("[SupabasePersonaAudioRepository] Erro ao salvar áudio no Supabase:", error);
      throw new Error(error.message || "Falha ao gravar áudio no banco");
    }

    this.cachedAudios = null;
    this.lastFetchAudiosTime = 0;
    return this.mapRowToAudio(inserted);
  }

  async updateAudio(id: string, updates: Partial<PersonaAudioAsset>): Promise<PersonaAudioAsset> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: now,
    };

    if (updates.stageId !== undefined) updatePayload.stage_id = updates.stageId || null;
    if (updates.title !== undefined) updatePayload.title = updates.title.trim();
    if (updates.audioUrl !== undefined) updatePayload.audio_url = updates.audioUrl;
    if (updates.duration !== undefined) updatePayload.duration = updates.duration != null ? Math.round(updates.duration) : null;
    if (updates.transcript !== undefined) updatePayload.transcript = updates.transcript;
    if (updates.usageInstruction !== undefined) updatePayload.usage_instruction = updates.usageInstruction;
    if (updates.enabled !== undefined) updatePayload.enabled = Boolean(updates.enabled);

    const { data: updated, error } = await client
      .from("persona_audios")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[SupabasePersonaAudioRepository] Erro ao atualizar áudio ${id}:`, error);
      throw new Error(error.message || "Falha ao atualizar áudio no banco");
    }

    this.cachedAudios = null;
    this.lastFetchAudiosTime = 0;
    return this.mapRowToAudio(updated);
  }

  async deleteAudio(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const { error } = await client.from("persona_audios").delete().eq("id", id);
    if (error) {
      console.error(`[SupabasePersonaAudioRepository] Erro ao excluir áudio ${id}:`, error);
      throw new Error(error.message || "Falha ao excluir áudio do banco");
    }

    this.cachedAudios = null;
    this.lastFetchAudiosTime = 0;
  }

  async searchAudios(query: string, stageId?: string): Promise<PersonaAudioAsset[]> {
    const all = await this.getAudios({ enabledOnly: true });
    const q = query.trim().toLowerCase();

    return all.filter((audio) => {
      if (stageId && audio.stageId && audio.stageId !== stageId) {
        return false;
      }
      if (!q) return true;

      const titleMatch = audio.title.toLowerCase().includes(q);
      const transcriptMatch = (audio.transcript || "").toLowerCase().includes(q);
      const usageMatch = (audio.usageInstruction || "").toLowerCase().includes(q);
      return titleMatch || transcriptMatch || usageMatch;
    });
  }

  async getDeliveryHistory(conversationId: string): Promise<AudioDeliveryHistory[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("audio_delivery_history")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });

      if (error || !data) return [];
      return data.map((r: any) => this.mapRowToHistory(r));
    } catch (err) {
      console.warn(`[SupabasePersonaAudioRepository] Erro ao buscar histórico de entrega de áudio:`, err);
      return [];
    }
  }

  async recordDelivery(
    conversationId: string,
    audioId: string,
    providerMessageId?: string
  ): Promise<AudioDeliveryHistory> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const newId = "deliv_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();

    const rowPayload = {
      id: newId,
      conversation_id: conversationId,
      audio_id: audioId,
      sent_at: now,
      provider_message_id: providerMessageId || null,
    };

    const { data, error } = await client
      .from("audio_delivery_history")
      .insert(rowPayload)
      .select()
      .single();

    if (error) {
      console.error("[SupabasePersonaAudioRepository] Erro ao registrar entrega de áudio:", error);
      throw new Error(error.message || "Falha ao registrar entrega no banco");
    }

    return this.mapRowToHistory(data);
  }
}
