import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { ChatStage, ChatProgress, ConversationGoal, CANONICAL_CHAT_STAGES_MATRIX } from "@/domain/entities/ChatStage";
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
  private customClient?: any;
  private cachedStages: ChatStage[] | null = null;
  private cachedProgress: Record<string, ChatProgress> | null = null;
  private lastFetchStagesTime = 0;
  private lastFetchProgressTime = 0;
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
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
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
            filter: "contact_id=in.(__chat_stages__,__chat_progress__)",
          },
          (payload: any) => {
            const contactId = payload?.new?.contact_id || payload?.new?.id;
            const rules = payload?.new?.stage_completed_rules;
            if (contactId === "__chat_stages__" && rules?.stages) {
              this.cachedStages = rules.stages;
              this.saveLocalStages(rules.stages);
              this.lastFetchStagesTime = Date.now();
            } else if (contactId === "__chat_progress__" && rules?.progresses) {
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

  /**
   * Reconcilia etapas existentes com a matriz canônica oficial sem perder IDs,
   * nomes nem dados prévios, aplicando as novas regras da matriz.
   */
  public reconcileWithCanonicalMatrix(existingStages: ChatStage[]): ChatStage[] {
    const canonicalMatrix = CANONICAL_CHAT_STAGES_MATRIX;
    const reconciled: ChatStage[] = existingStages.map((stg) => ({ ...stg, goals: [...(stg.goals || [])] }));

    // 1. Localiza ou cria as 3 etapas canônicas
    let conexaoStage = reconciled.find(
      (s) => s.id === "stage_1_conexao" || s.id === "stage_1" || s.name.toLowerCase().includes("conex")
    );
    let descobertaStage = reconciled.find(
      (s) => s.id === "stage_2_descoberta" || s.id === "stage_2" || s.name.toLowerCase().includes("descoberta")
    );
    let compatibilidadeStage = reconciled.find(
      (s) => s.id === "stage_3_compatibilidade" || s.id === "stage_3" || s.name.toLowerCase().includes("compat")
    );

    if (!conexaoStage) {
      const canon = canonicalMatrix.find((c) => c.id === "stage_1_conexao");
      if (canon) {
        conexaoStage = JSON.parse(JSON.stringify(canon));
        if (conexaoStage) {
          conexaoStage.order = 0;
          reconciled.push(conexaoStage);
        }
      }
    }

    if (!descobertaStage) {
      const canon = canonicalMatrix.find((c) => c.id === "stage_2_descoberta");
      if (canon) {
        descobertaStage = JSON.parse(JSON.stringify(canon));
        if (descobertaStage) {
          descobertaStage.order = 1;
          reconciled.push(descobertaStage);
        }
      }
    }

    if (!compatibilidadeStage) {
      const canonComp = canonicalMatrix.find((c) => c.id === "stage_3_compatibilidade");
      if (canonComp) {
        compatibilidadeStage = JSON.parse(JSON.stringify(canonComp));
        if (compatibilidadeStage) {
          compatibilidadeStage.order = 2;
          reconciled.push(compatibilidadeStage);
        }
      }
    }

    reconciled.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    // 2. Reconcilia objetivos em cada etapa
    for (const stage of reconciled) {
      const isConexao = stage === conexaoStage;
      const isDescoberta = stage === descobertaStage;
      const isCompatibilidade = stage === compatibilidadeStage;

      const goals = stage.goals || [];
      const updatedGoals = goals.map((g) => {
        const copy = { ...g };

        // goal_age: required vira false, kind fact
        if (copy.id === "goal_age") {
          copy.required = false;
          copy.kind = "fact";
          if (!copy.allowedSubagents || copy.allowedSubagents.length === 0) copy.allowedSubagents = ["descoberta"];
          copy.primarySubagent = copy.primarySubagent || "descoberta";
        }
        // goal_city: required vira false, kind fact
        if (copy.id === "goal_city") {
          copy.required = false;
          copy.kind = "fact";
          if (!copy.allowedSubagents || copy.allowedSubagents.length === 0) copy.allowedSubagents = ["conexao_inicial", "descoberta"];
          copy.primarySubagent = copy.primarySubagent || "conexao_inicial";
        }
        // goal_job: required vira false, kind fact
        if (copy.id === "goal_job") {
          copy.required = false;
          copy.kind = "fact";
          if (!copy.allowedSubagents || copy.allowedSubagents.length === 0) copy.allowedSubagents = ["conexao_inicial", "descoberta"];
          copy.primarySubagent = copy.primarySubagent || "conexao_inicial";
        }
        // goal_relationship: semântica restrita a status de relacionamento
        if (copy.id === "goal_relationship") {
          copy.required = false;
          copy.kind = "fact";
          copy.title = "Status de relacionamento";
          copy.label = "Status de relacionamento";
          copy.description = "Descobrir o status atual de relacionamento dele (solteiro, separado, divorciado, etc.). Não usar para filhos nem intenção.";
          copy.allowedSubagents = ["compatibilidade"];
          copy.primarySubagent = "compatibilidade";
        }

        if (!copy.kind) {
          copy.kind = copy.id.includes("reciprocity") || copy.id.includes("depth") ? "conversation_state" : "fact";
        }

        return copy;
      });

      // Adiciona objetivos canônicos faltantes para a etapa correspondente
      if (isConexao) {
        const canonConexao = canonicalMatrix.find((c) => c.id === "stage_1_conexao");
        for (const cg of canonConexao?.goals || []) {
          if (!updatedGoals.some((g) => g.id === cg.id)) {
            updatedGoals.push({ ...cg, stageId: stage.id, order: updatedGoals.length + 1 });
          }
        }
      }

      if (isDescoberta) {
        const canonDescoberta = canonicalMatrix.find((c) => c.id === "stage_2_descoberta");
        for (const dg of canonDescoberta?.goals || []) {
          if (!updatedGoals.some((g) => g.id === dg.id)) {
            updatedGoals.push({ ...dg, stageId: stage.id, order: updatedGoals.length + 1 });
          }
        }
      }

      if (isCompatibilidade) {
        const canonComp = canonicalMatrix.find((c) => c.id === "stage_3_compatibilidade");
        for (const cg of canonComp?.goals || []) {
          if (!updatedGoals.some((g) => g.id === cg.id)) {
            updatedGoals.push({ ...cg, stageId: stage.id, order: updatedGoals.length + 1 });
          }
        }
      }

      stage.goals = updatedGoals.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    return reconciled;
  }

  async getStages(force = false): Promise<ChatStage[]> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedStages && now - this.lastFetchStagesTime < this.cacheDurationMs) {
      return this.cachedStages;
    }

    const client = this.getClient();
    let stagesFromDb: ChatStage[] | null = null;

    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("contact_id", "__chat_stages__")
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredStagesPayload;
          if (Array.isArray(rules.stages) && rules.stages.length > 0) {
            stagesFromDb = rules.stages;
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar etapas do Supabase:", err);
      }
    }

    let finalStages: ChatStage[] = [];

    if (stagesFromDb && stagesFromDb.length > 0) {
      // Reconcilia com a matriz canônica sem perder dados nem IDs existentes
      finalStages = this.reconcileWithCanonicalMatrix(stagesFromDb);
    } else {
      const local = this.getLocalStages();
      if (local.length > 0) {
        finalStages = this.reconcileWithCanonicalMatrix(local);
      } else {
        // Inicializa com a matriz canônica completa
        finalStages = JSON.parse(JSON.stringify(CANONICAL_CHAT_STAGES_MATRIX));
        // Persiste no Supabase imediatamente para que a fonte de verdade seja preenchida
        this.persistStagesToCloud(finalStages).catch((err) => {
          console.warn("Aviso ao persistir matriz canônica inicial:", err);
        });
      }
    }

    finalStages.sort((a, b) => a.order - b.order);
    this.cachedStages = finalStages;
    this.saveLocalStages(finalStages);
    this.lastFetchStagesTime = now;
    return finalStages;
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

      await client.from("instagram_conversations").upsert(
        {
          contact_id: "__chat_stages__",
          username: "system_stages",
          display_name: "Sistema de Etapas e Checklists",
          status: "system",
          unread_count: 0,
          last_message_preview: `Etapas sincronizadas: ${stages.length}`,
          last_message_at: new Date().toISOString(),
          is_restricted: false,
          stage_completed_rules: payload as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "contact_id" }
      );
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

  // --- GESTÃO DE OBJETIVOS DA CONVERSA (GOALS) ---

  async addGoal(
    stageId: string,
    goalData: Omit<ConversationGoal, "id" | "stageId">
  ): Promise<ConversationGoal> {
    const stages = await this.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Etapa com id ${stageId} não encontrada.`);
    }

    const currentGoals = stage.goals || [];
    const newGoal: ConversationGoal = {
      ...goalData,
      id: "goal_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      stageId,
      order: goalData.order ?? currentGoals.length,
      enabled: goalData.enabled ?? true,
      required: goalData.required ?? false,
      kind: goalData.kind ?? "fact",
    };

    stage.goals = [...currentGoals, newGoal].sort((a, b) => a.order - b.order);
    stage.updatedAt = new Date().toISOString();

    await this.persistStagesToCloud(stages);
    return newGoal;
  }

  async updateGoal(
    stageId: string,
    goalId: string,
    updates: Partial<ConversationGoal>
  ): Promise<void> {
    const stages = await this.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Etapa com id ${stageId} não encontrada.`);
    }

    const goals = stage.goals || [];
    const index = goals.findIndex((g) => g.id === goalId);
    if (index === -1) {
      throw new Error(`Objetivo com id ${goalId} não encontrado na etapa ${stageId}.`);
    }

    goals[index] = {
      ...goals[index],
      ...updates,
    };
    goals.sort((a, b) => a.order - b.order);
    stage.goals = goals;
    stage.updatedAt = new Date().toISOString();

    await this.persistStagesToCloud(stages);
  }

  async deleteGoal(stageId: string, goalId: string): Promise<void> {
    const stages = await this.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Etapa com id ${stageId} não encontrada.`);
    }

    const filtered = (stage.goals || []).filter((g) => g.id !== goalId);
    filtered.forEach((g, idx) => {
      g.order = idx;
    });
    stage.goals = filtered;
    stage.updatedAt = new Date().toISOString();

    await this.persistStagesToCloud(stages);
  }

  async reorderGoals(stageId: string, goalIds: string[]): Promise<void> {
    const stages = await this.getStages();
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`Etapa com id ${stageId} não encontrada.`);
    }

    const currentGoals = stage.goals || [];
    const goalMap = new Map(currentGoals.map((g) => [g.id, g]));
    const reordered: ConversationGoal[] = [];

    goalIds.forEach((id, idx) => {
      const g = goalMap.get(id);
      if (g) {
        g.order = idx;
        reordered.push(g);
      }
    });

    currentGoals.forEach((g) => {
      if (!goalIds.includes(g.id)) {
        g.order = reordered.length;
        reordered.push(g);
      }
    });

    stage.goals = reordered;
    stage.updatedAt = new Date().toISOString();

    await this.persistStagesToCloud(stages);
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
          .eq("contact_id", "__chat_progress__")
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
        contact_id: "__chat_progress__",
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

  async toggleGoalCompletion(
    conversationId: string,
    goalId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    const all = await this.getAllChatProgresses();
    const existing = all[conversationId] || {
      conversationId,
      currentStageId: "",
      completedItemIds: [],
      completedGoalIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    let completedGoals = new Set(existing.completedGoalIds || []);
    if (isCompleted) {
      completedGoals.add(goalId);
    } else {
      completedGoals.delete(goalId);
    }

    const updated: ChatProgress = {
      ...existing,
      completedGoalIds: Array.from(completedGoals),
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
