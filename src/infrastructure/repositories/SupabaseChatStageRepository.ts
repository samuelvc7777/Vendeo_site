import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { ChatStage, ChatProgress } from "@/domain/entities/ChatStage";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const LOCAL_STORAGE_STAGES_KEY = "vendeo_chat_stages_v1";
const LOCAL_STORAGE_PROGRESS_KEY = "vendeo_chat_progress_v1";

interface StoredStagesPayload {
  stages: ChatStage[];
  updated_at: string;
}

interface StoredProgressPayload {
  progresses: Record<string, ChatProgress>;
  updated_at: string;
}

export class SupabaseChatStageRepository implements IChatStageRepository {
  private cachedStages: ChatStage[] | null = null;
  private cachedProgress: Record<string, ChatProgress> | null = null;
  private lastFetchStagesTime = 0;
  private lastFetchProgressTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private getLocalStages(): ChatStage[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_STAGES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.warn("Erro ao ler etapas locais:", e);
    }
    return [];
  }

  private saveLocalStages(stages: ChatStage[]) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_STAGES_KEY, JSON.stringify(stages));
    } catch (e) {
      console.warn("Erro ao salvar etapas locais:", e);
    }
  }

  private getLocalProgress(): Record<string, ChatProgress> {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_PROGRESS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
      }
    } catch (e) {
      console.warn("Erro ao ler progresso local:", e);
    }
    return {};
  }

  private saveLocalProgress(progress: Record<string, ChatProgress>) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_PROGRESS_KEY, JSON.stringify(progress));
    } catch (e) {
      console.warn("Erro ao salvar progresso local:", e);
    }
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || typeof window === "undefined") return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("chat-stages-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "instagram_conversations",
            filter: "id=in.(__chat_stages__,__chat_progress__)",
          },
          (payload: any) => {
            const id = payload?.new?.id;
            const rules = payload?.new?.stage_completed_rules;
            if (id === "__chat_stages__" && rules?.stages) {
              this.cachedStages = rules.stages;
              this.saveLocalStages(rules.stages);
              this.lastFetchStagesTime = Date.now();
            } else if (id === "__chat_progress__" && rules?.progresses) {
              this.cachedProgress = rules.progresses;
              this.saveLocalProgress(rules.progresses);
              this.lastFetchProgressTime = Date.now();
            }
          }
        )
        .subscribe();
    } catch {
      // Falha silenciosa de realtime se websocket não conectar
    }
  }

  // --- MÉTODOS DE ETAPAS ---

  async getStages(force = false): Promise<ChatStage[]> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedStages && now - this.lastFetchStagesTime < this.cacheDurationMs) {
      return this.cachedStages;
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", "__chat_stages__")
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredStagesPayload;
          if (Array.isArray(rules.stages)) {
            this.cachedStages = rules.stages.sort((a, b) => a.order - b.order);
            this.saveLocalStages(this.cachedStages);
            this.lastFetchStagesTime = now;
            return this.cachedStages;
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar etapas do Supabase:", err);
      }
    }

    // Fallback local
    const local = this.getLocalStages().sort((a, b) => a.order - b.order);
    this.cachedStages = local;
    this.lastFetchStagesTime = now;
    return local;
  }

  private async persistStagesToCloud(stages: ChatStage[]): Promise<void> {
    this.cachedStages = stages;
    this.saveLocalStages(stages);
    this.lastFetchStagesTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const payload: StoredStagesPayload = {
        stages,
        updated_at: new Date().toISOString(),
      };

      await client.from("instagram_conversations").upsert({
        id: "__chat_stages__",
        username: "system_stages",
        full_name: "Sistema de Etapas e Checklists",
        status: "system",
        unread: false,
        last_message: `Etapas sincronizadas: ${stages.length}`,
        last_message_at: new Date().toISOString(),
        is_restricted: false,
        stage_completed_rules: payload as any,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Aviso ao persistir etapas no Supabase:", err);
    }
  }

  async createStage(data: Omit<ChatStage, "id" | "createdAt" | "updatedAt">): Promise<ChatStage> {
    const current = await this.getStages();
    const newStage: ChatStage = {
      ...data,
      id: "stage_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      order: data.order ?? current.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [...current, newStage].sort((a, b) => a.order - b.order);
    await this.persistStagesToCloud(updated);
    return newStage;
  }

  async updateStage(
    id: string,
    data: Partial<Omit<ChatStage, "id" | "createdAt" | "updatedAt">>
  ): Promise<ChatStage> {
    const current = await this.getStages();
    const index = current.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Etapa com id ${id} não encontrada.`);
    }

    const updatedStage: ChatStage = {
      ...current[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };

    current[index] = updatedStage;
    current.sort((a, b) => a.order - b.order);
    await this.persistStagesToCloud(current);
    return updatedStage;
  }

  async deleteStage(id: string): Promise<void> {
    const current = await this.getStages();
    const filtered = current.filter((s) => s.id !== id);
    // Reajusta a ordenação
    filtered.forEach((s, idx) => {
      s.order = idx;
    });
    await this.persistStagesToCloud(filtered);
  }

  async reorderStages(stageIds: string[]): Promise<ChatStage[]> {
    const current = await this.getStages();
    const stageMap = new Map(current.map((s) => [s.id, s]));

    const reordered: ChatStage[] = [];
    stageIds.forEach((id, idx) => {
      const stage = stageMap.get(id);
      if (stage) {
        stage.order = idx;
        stage.updatedAt = new Date().toISOString();
        reordered.push(stage);
      }
    });

    // Mantém eventuais etapas não listadas no final
    current.forEach((s) => {
      if (!stageIds.includes(s.id)) {
        s.order = reordered.length;
        reordered.push(s);
      }
    });

    await this.persistStagesToCloud(reordered);
    return reordered;
  }

  // --- MÉTODOS DE PROGRESSO POR CONVERSA ---

  async getAllChatProgresses(force = false): Promise<Record<string, ChatProgress>> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedProgress && now - this.lastFetchProgressTime < this.cacheDurationMs) {
      return this.cachedProgress;
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", "__chat_progress__")
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredProgressPayload;
          if (rules.progresses && typeof rules.progresses === "object") {
            this.cachedProgress = rules.progresses;
            this.saveLocalProgress(this.cachedProgress);
            this.lastFetchProgressTime = now;
            return this.cachedProgress;
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar progresso dos chats do Supabase:", err);
      }
    }

    const local = this.getLocalProgress();
    this.cachedProgress = local;
    this.lastFetchProgressTime = now;
    return local;
  }

  private async persistProgressToCloud(progresses: Record<string, ChatProgress>): Promise<void> {
    this.cachedProgress = progresses;
    this.saveLocalProgress(progresses);
    this.lastFetchProgressTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const payload: StoredProgressPayload = {
        progresses,
        updated_at: new Date().toISOString(),
      };

      await client.from("instagram_conversations").upsert({
        id: "__chat_progress__",
        username: "system_progress",
        full_name: "Progresso das Conversas",
        status: "system",
        unread: false,
        last_message: `Progresso rastreado em ${Object.keys(progresses).length} chats`,
        last_message_at: new Date().toISOString(),
        is_restricted: false,
        stage_completed_rules: payload as any,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Aviso ao persistir progresso no Supabase:", err);
    }
  }

  async getChatProgress(conversationId: string): Promise<ChatProgress | null> {
    const all = await this.getAllChatProgresses();
    return all[conversationId] || null;
  }

  async saveChatProgress(progress: ChatProgress): Promise<void> {
    const all = await this.getAllChatProgresses();
    all[progress.conversationId] = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };
    await this.persistProgressToCloud(all);
  }

  async toggleItemCompletion(
    conversationId: string,
    itemId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    const all = await this.getAllChatProgresses();
    const existing = all[conversationId] || {
      conversationId,
      currentStageId: "",
      completedItemIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    let completed = new Set(existing.completedItemIds || []);
    if (isCompleted) {
      completed.add(itemId);
    } else {
      completed.delete(itemId);
    }

    const updated: ChatProgress = {
      ...existing,
      completedItemIds: Array.from(completed),
      updatedAt: new Date().toISOString(),
    };

    all[conversationId] = updated;
    await this.persistProgressToCloud(all);
    return updated;
  }

  async advanceStage(conversationId: string, nextStageId: string): Promise<ChatProgress> {
    const all = await this.getAllChatProgresses();
    const existing = all[conversationId] || {
      conversationId,
      currentStageId: nextStageId,
      completedItemIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    const updated: ChatProgress = {
      ...existing,
      currentStageId: nextStageId,
      updatedAt: new Date().toISOString(),
    };

    all[conversationId] = updated;
    await this.persistProgressToCloud(all);
    return updated;
  }

  async markAsConverted(conversationId: string, isConverted: boolean): Promise<ChatProgress> {
    const all = await this.getAllChatProgresses();
    const existing = all[conversationId] || {
      conversationId,
      currentStageId: "",
      completedItemIds: [],
      isConverted: isConverted,
      updatedAt: new Date().toISOString(),
    };

    const updated: ChatProgress = {
      ...existing,
      isConverted,
      updatedAt: new Date().toISOString(),
    };

    all[conversationId] = updated;
    await this.persistProgressToCloud(all);
    return updated;
  }
}
