import { IPersonaAudioRepository } from "@/domain/repositories/IPersonaAudioRepository";
import { PersonaAudioAsset, AudioDeliveryHistory } from "@/domain/entities/ChatStage";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const LOCAL_STORAGE_AUDIOS_KEY = "vendeo_persona_audios_v1";
const LOCAL_STORAGE_AUDIO_HISTORY_KEY = "vendeo_audio_history_v1";

interface StoredAudiosPayload {
  audios: PersonaAudioAsset[];
  updated_at: string;
}

interface StoredAudioHistoryPayload {
  history: Record<string, AudioDeliveryHistory[]>;
  updated_at: string;
}

export class SupabasePersonaAudioRepository implements IPersonaAudioRepository {
  private cachedAudios: PersonaAudioAsset[] | null = null;
  private cachedHistory: Record<string, AudioDeliveryHistory[]> | null = null;
  private lastFetchAudiosTime = 0;
  private lastFetchHistoryTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private getLocalAudios(): PersonaAudioAsset[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_AUDIOS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.warn("Erro ao ler áudios locais:", e);
    }
    return [];
  }

  private saveLocalAudios(audios: PersonaAudioAsset[]) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_AUDIOS_KEY, JSON.stringify(audios));
    } catch (e) {
      console.warn("Erro ao salvar áudios locais:", e);
    }
  }

  private getLocalHistory(): Record<string, AudioDeliveryHistory[]> {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_AUDIO_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
      }
    } catch (e) {
      console.warn("Erro ao ler histórico de áudios local:", e);
    }
    return {};
  }

  private saveLocalHistory(history: Record<string, AudioDeliveryHistory[]>) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_AUDIO_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn("Erro ao salvar histórico de áudios local:", e);
    }
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || typeof window === "undefined") return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("persona-audios-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "instagram_conversations",
            filter: "id=in.(__persona_audios__,__audio_history__)",
          },
          (payload: any) => {
            const id = payload?.new?.id;
            const rules = payload?.new?.stage_completed_rules;
            if (id === "__persona_audios__" && rules?.audios) {
              this.cachedAudios = rules.audios;
              this.saveLocalAudios(rules.audios);
              this.lastFetchAudiosTime = Date.now();
            } else if (id === "__audio_history__" && rules?.history) {
              this.cachedHistory = rules.history;
              this.saveLocalHistory(rules.history);
              this.lastFetchHistoryTime = Date.now();
            }
          }
        )
        .subscribe();
    } catch {
      // Realtime fail-safe
    }
  }

  private async persistAudiosToCloud(audios: PersonaAudioAsset[]): Promise<void> {
    this.cachedAudios = audios;
    this.saveLocalAudios(audios);
    this.lastFetchAudiosTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const payload: StoredAudiosPayload = {
        audios,
        updated_at: new Date().toISOString(),
      };

      await client.from("instagram_conversations").upsert({
        id: "__persona_audios__",
        username: "system_persona_audios",
        full_name: "Biblioteca de Voz da Larissa",
        status: "system",
        unread: false,
        last_message: `Áudios cadastrados: ${audios.length}`,
        last_message_at: new Date().toISOString(),
        is_restricted: false,
        stage_completed_rules: payload as any,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Aviso ao persistir áudios no Supabase:", err);
    }
  }

  private async persistHistoryToCloud(history: Record<string, AudioDeliveryHistory[]>): Promise<void> {
    this.cachedHistory = history;
    this.saveLocalHistory(history);
    this.lastFetchHistoryTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const payload: StoredAudioHistoryPayload = {
        history,
        updated_at: new Date().toISOString(),
      };

      await client.from("instagram_conversations").upsert({
        id: "__audio_history__",
        username: "system_audio_history",
        full_name: "Histórico de Envios de Áudio",
        status: "system",
        unread: false,
        last_message: `Conversas com histórico: ${Object.keys(history).length}`,
        last_message_at: new Date().toISOString(),
        is_restricted: false,
        stage_completed_rules: payload as any,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Aviso ao persistir histórico de áudios no Supabase:", err);
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
      let loadedFromCloud = false;

      if (client) {
        try {
          const { data, error } = await client
            .from("instagram_conversations")
            .select("stage_completed_rules")
            .eq("id", "__persona_audios__")
            .maybeSingle();

          if (!error && data?.stage_completed_rules) {
            const rules = data.stage_completed_rules as StoredAudiosPayload;
            if (Array.isArray(rules.audios)) {
              allAudios = rules.audios;
              loadedFromCloud = true;
              this.cachedAudios = allAudios;
              this.saveLocalAudios(allAudios);
              this.lastFetchAudiosTime = now;
            }
          }
        } catch (err) {
          console.warn("Aviso ao carregar áudios do Supabase:", err);
        }
      }

      if (!loadedFromCloud) {
        allAudios = this.getLocalAudios();
        this.cachedAudios = allAudios;
        this.lastFetchAudiosTime = now;
      }
    }

    return allAudios.filter((a) => {
      if (filters?.enabledOnly && !a.enabled) return false;
      if (filters?.stageId && a.stageId && a.stageId !== filters.stageId) return false;
      return true;
    });
  }

  async getAudioById(id: string): Promise<PersonaAudioAsset | null> {
    const audios = await this.getAudios();
    return audios.find((a) => a.id === id) || null;
  }

  async saveAudio(data: Omit<PersonaAudioAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaAudioAsset> {
    const current = await this.getAudios();
    const newAudio: PersonaAudioAsset = {
      ...data,
      id: "audio_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [newAudio, ...current];
    await this.persistAudiosToCloud(updated);
    return newAudio;
  }

  async updateAudio(id: string, updates: Partial<PersonaAudioAsset>): Promise<PersonaAudioAsset> {
    const current = await this.getAudios();
    const index = current.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Áudio com ID ${id} não encontrado.`);
    }

    const updatedAudio: PersonaAudioAsset = {
      ...current[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    current[index] = updatedAudio;
    await this.persistAudiosToCloud(current);
    return updatedAudio;
  }

  async deleteAudio(id: string): Promise<void> {
    const current = await this.getAudios();
    const filtered = current.filter((a) => a.id !== id);
    await this.persistAudiosToCloud(filtered);
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
    this.initRealtimeSubscription();
    const now = Date.now();
    let historyMap: Record<string, AudioDeliveryHistory[]> = {};

    if (this.cachedHistory && now - this.lastFetchHistoryTime < this.cacheDurationMs) {
      historyMap = this.cachedHistory;
    } else {
      const client = this.getClient();
      if (client) {
        try {
          const { data, error } = await client
            .from("instagram_conversations")
            .select("stage_completed_rules")
            .eq("id", "__audio_history__")
            .maybeSingle();

          if (!error && data?.stage_completed_rules) {
            const rules = data.stage_completed_rules as StoredAudioHistoryPayload;
            if (rules.history) {
              historyMap = rules.history;
              this.cachedHistory = historyMap;
              this.saveLocalHistory(historyMap);
              this.lastFetchHistoryTime = now;
            }
          }
        } catch (err) {
          console.warn("Aviso ao buscar histórico de áudio no Supabase:", err);
        }
      }

      if (Object.keys(historyMap).length === 0) {
        historyMap = this.getLocalHistory();
        this.cachedHistory = historyMap;
        this.lastFetchHistoryTime = now;
      }
    }

    return historyMap[conversationId] || [];
  }

  async recordDelivery(
    conversationId: string,
    audioId: string,
    providerMessageId?: string
  ): Promise<AudioDeliveryHistory> {
    const currentHist = await this.getDeliveryHistory(conversationId);
    const newEntry: AudioDeliveryHistory = {
      id: "deliv_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      conversationId,
      audioId,
      sentAt: new Date().toISOString(),
      providerMessageId,
    };

    const allHistory = this.cachedHistory || this.getLocalHistory();
    const updatedConvHistory = [...currentHist, newEntry];
    allHistory[conversationId] = updatedConvHistory;

    await this.persistHistoryToCloud(allHistory);
    return newEntry;
  }
}
