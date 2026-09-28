/**
 * src/infrastructure/repositories/SupabaseChatStageRepository.ts
 * Repositório Oficial de Etapas da Conversa e Objetivos Canônicos.
 * 
 * Regra Arquitetural Absoluta:
 * - A tabela oficial 'public.chat_stages' é a ÚNICA fonte de verdade para etapas e objetivos.
 * - Zero localStorage ou cache local em disco.
 * - Zero pseudo-registros globais (__chat_stages__, __chat_progress__).
 * - O progresso da conversa pertence estritamente ao registro da conversa em 'instagram_conversations'.
 */

import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import {
  ChatStage,
  ChatProgress,
  ConversationGoal,
} from "@/domain/entities/ChatStage";
import { resolveCurrentStageId } from "@/domain/entities/stageAuthority";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";
import { brainOperatorFetch } from "../http/brainOperatorApi";

export class SupabaseChatStageRepository implements IChatStageRepository {
  private customClient?: any;
  private cachedStages: ChatStage[] | null = null;
  private lastFetchStagesTime = 0;
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

  private mapRowToStage(row: any): ChatStage {
    const goals: ConversationGoal[] = Array.isArray(row.goals) ? row.goals : [];
    return {
      id: row.id,
      name: row.name,
      order: Number(row.stage_order ?? 0),
      color: row.color || undefined,
      icon: row.icon || undefined,
      description: row.description || undefined,
      goals,
      objectives: goals,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("chat-stages-db-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_stages",
          },
          () => {
            this.cachedStages = null;
            this.lastFetchStagesTime = 0;
          }
        )
        .subscribe();
    } catch {
      // Falha silenciosa de realtime se websocket não conectar
    }
  }

  // --- MÉTODOS DE ETAPAS (chat_stages) ---

  async getStages(force = false): Promise<ChatStage[]> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedStages && now - this.lastFetchStagesTime < this.cacheDurationMs) {
      return [...this.cachedStages];
    }

    const client = this.getClient();
    if (!client) {
      return [];
    }

    try {
      const { data, error } = await client
        .from("chat_stages")
        .select("*")
        .order("stage_order", { ascending: true });

      if (error) {
        console.error("[SupabaseChatStageRepository] Erro ao carregar etapas de chat_stages:", error);
        if (this.cachedStages) return [...this.cachedStages];
        return [];
      }

      if (data && Array.isArray(data) && data.length > 0) {
        const stages = data.map((r) => this.mapRowToStage(r));
        stages.sort((a, b) => a.order - b.order);
        this.cachedStages = stages;
        this.lastFetchStagesTime = now;
        return [...stages];
      }

      this.cachedStages = [];
      this.lastFetchStagesTime = now;
      return [];
    } catch (err) {
      console.error("[SupabaseChatStageRepository] Exceção ao buscar etapas:", err);
      if (this.cachedStages) return [...this.cachedStages];
      return [];
    }
  }

  async createStage(data: Omit<ChatStage, "id" | "createdAt" | "updatedAt">): Promise<ChatStage> {
    const current = await this.getStages();
    const newId = "stage_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const order = data.order ?? current.length;
    const now = new Date().toISOString();

    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const goals = data.goals || data.objectives || [];

    const { data: inserted, error } = await client
      .from("chat_stages")
      .insert({
        id: newId,
        name: data.name,
        stage_order: order,
        color: data.color || null,
        icon: data.icon || null,
        description: data.description || null,
        goals,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error("[SupabaseChatStageRepository] Erro ao criar etapa:", error);
      throw new Error(error.message || "Falha ao criar etapa no banco de dados");
    }

    this.cachedStages = null;
    this.lastFetchStagesTime = 0;
    return this.mapRowToStage(inserted);
  }

  async updateStage(
    id: string,
    data: Partial<Omit<ChatStage, "id" | "createdAt" | "updatedAt">>
  ): Promise<ChatStage> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: now,
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.order !== undefined) updatePayload.stage_order = data.order;
    if (data.color !== undefined) updatePayload.color = data.color || null;
    if (data.icon !== undefined) updatePayload.icon = data.icon || null;
    if (data.description !== undefined) updatePayload.description = data.description || null;
    if (data.goals !== undefined) updatePayload.goals = data.goals;
    else if (data.objectives !== undefined) updatePayload.goals = data.objectives;

    const { data: updated, error } = await client
      .from("chat_stages")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[SupabaseChatStageRepository] Erro ao atualizar etapa ${id}:`, error);
      throw new Error(error.message || "Falha ao atualizar etapa no banco");
    }

    this.cachedStages = null;
    this.lastFetchStagesTime = 0;
    return this.mapRowToStage(updated);
  }

  async deleteStage(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const { error } = await client.from("chat_stages").delete().eq("id", id);
    if (error) {
      console.error(`[SupabaseChatStageRepository] Erro ao excluir etapa ${id}:`, error);
      throw new Error(error.message || "Falha ao excluir etapa no banco");
    }

    this.cachedStages = null;
    this.lastFetchStagesTime = 0;
  }

  async reorderStages(stageIds: string[]): Promise<ChatStage[]> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    for (let idx = 0; idx < stageIds.length; idx++) {
      const stageId = stageIds[idx];
      await client
        .from("chat_stages")
        .update({ stage_order: idx, updated_at: new Date().toISOString() })
        .eq("id", stageId);
    }

    this.cachedStages = null;
    this.lastFetchStagesTime = 0;
    return this.getStages(true);
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
      required: true,
      kind: goalData.kind ?? "fact",
    };

    const updatedGoals = [...currentGoals, newGoal].sort((a, b) => a.order - b.order);
    await this.updateStage(stageId, { goals: updatedGoals });
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
    await this.updateStage(stageId, { goals });
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
    await this.updateStage(stageId, { goals: filtered });
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

    await this.updateStage(stageId, { goals: reordered });
  }

  // --- MÉTODOS DE PROGRESSO POR CONVERSA (instagram_conversations) ---

  async getAllChatProgresses(): Promise<Record<string, ChatProgress>> {
    const client = this.getClient();
    const result: Record<string, ChatProgress> = {};
    if (!client) return result;

    // Caminho leve para lista/filtros: evita baixar stage_completed_rules de centenas de chats.
    try {
      const { data: summaries, error: summaryError } = await client
        .from("instagram_conversations")
        .select("id, current_stage_id, is_converted, updated_at")
        .not("id", "like", "\_\_%");
      if (!summaryError && summaries) {
        const configuredInitialStageId = (await this.getStages())[0]?.id || "";
        for (const row of summaries) {
          result[row.id] = {
            conversationId: row.id,
            currentStageId: resolveCurrentStageId(row.current_stage_id, configuredInitialStageId),
            completedItemIds: [],
            completedGoalIds: [],
            objectiveProgress: {},
            isConverted: Boolean(row.is_converted),
            updatedAt: row.updated_at || new Date(0).toISOString(),
          };
        }
        return result;
      }
    } catch {
      // Rollout compativel: a coluna normalizada ainda pode nao existir.
    }

    try {
      const { data, error } = await client
        .from("instagram_conversations")
        .select("id, contact_id, current_stage_id, stage_completed_rules")
        .not("id", "like", "\\_\\_%")
        .not("contact_id", "like", "\\_\\_%");

      if (error || !data) return result;
      const configuredInitialStageId = (await this.getStages())[0]?.id || "";

      for (const row of data) {
        const convId = row.id || row.contact_id;
        const rules = row.stage_completed_rules;
        if (!convId || !rules || convId.startsWith("__")) continue;

        const orch = rules.orchestration || {};
        const chatProgress = rules.chat_progress || rules;
        // A coluna normalizada é a fonte canônica; JSON é somente projeção legada.
        const currentStageId = resolveCurrentStageId(row.current_stage_id, configuredInitialStageId);
        const completedGoalIds = Array.isArray(orch.completedGoalIds)
          ? orch.completedGoalIds
          : (Array.isArray(rules.completed_goals)
            ? rules.completed_goals
            : (Array.isArray(chatProgress.completedGoalIds) ? chatProgress.completedGoalIds : []));
        const objectiveProgress = orch.objectiveProgress || rules.objective_progress || chatProgress.objectiveProgress || {};
        const completedItemIds = Array.isArray(chatProgress.completedItemIds) ? chatProgress.completedItemIds : [];

        result[convId] = {
          conversationId: convId,
          currentStageId,
          completedItemIds,
          completedGoalIds,
          objectiveProgress,
          isConverted: Boolean(chatProgress.isConverted || orch.isConverted),
          updatedAt: chatProgress.updatedAt || row.updated_at,
        };
      }
    } catch (err) {
      console.warn("[SupabaseChatStageRepository] Erro ao carregar progressos das conversas:", err);
    }

    return result;
  }

  async getChatProgress(conversationId: string): Promise<ChatProgress | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("instagram_conversations")
        .select("id, contact_id, current_stage_id, stage_completed_rules, updated_at")
        .or(`id.eq.${conversationId},contact_id.eq.${conversationId}`)
        .maybeSingle();

      if (error || !data?.stage_completed_rules) return null;
      const configuredInitialStageId = (await this.getStages())[0]?.id || "";

      const rules = data.stage_completed_rules;
      const orch = rules.orchestration || {};
      const chatProgress = rules.chat_progress || rules;
      // A coluna normalizada é a fonte canônica; JSON é somente projeção legada.
      const currentStageId = resolveCurrentStageId(data.current_stage_id, configuredInitialStageId);
      const completedGoalIds = Array.isArray(orch.completedGoalIds)
        ? orch.completedGoalIds
        : (Array.isArray(rules.completed_goals)
          ? rules.completed_goals
          : (Array.isArray(chatProgress.completedGoalIds) ? chatProgress.completedGoalIds : []));
      const objectiveProgress = orch.objectiveProgress || rules.objective_progress || chatProgress.objectiveProgress || {};
      const completedItemIds = Array.isArray(chatProgress.completedItemIds) ? chatProgress.completedItemIds : [];

      return {
        conversationId,
        currentStageId,
        completedItemIds,
        completedGoalIds,
        objectiveProgress,
        isConverted: Boolean(chatProgress.isConverted || orch.isConverted),
        updatedAt: chatProgress.updatedAt || data.updated_at,
      };
    } catch (err) {
      console.warn(`[SupabaseChatStageRepository] Erro ao buscar progresso de ${conversationId}:`, err);
      return null;
    }
  }

  async saveChatProgress(progress: ChatProgress): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      const convId = progress.conversationId;
      const now = new Date().toISOString();

      const patchPayload = {
        currentStageId: progress.currentStageId,
        completedItemIds: progress.completedItemIds || [],
        completedGoalIds: progress.completedGoalIds || [],
        objectiveProgress: progress.objectiveProgress || {},
        isConverted: Boolean(progress.isConverted),
        updatedAt: progress.updatedAt || now,
      };

      // A RPC service_role só é chamada pela Edge Function com sessão validada.
      const response = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, progressPatch: patchPayload }),
      });
      const result = await response.json().catch(() => ({}));
      const rpcResult = response.ok ? result : null;
      const rpcError = response.ok ? null : { message: result.error || `HTTP ${response.status}` };

      if (!rpcError && rpcResult?.success) {
        return;
      }

      // 2. FAIL-CLOSED ABSOLUTO: Se a RPC falhar ou estiver indisponível, NUNCA recorrer
      // a read-modify-write em JS (SELECT -> merge -> UPDATE stage_completed_rules),
      // pois qualquer escrita de coluna inteira por JS causa lost update e clobber da outbox/lock.
      const errorMsg = rpcError?.message || rpcResult?.error || "RPC não retornou sucesso";
      console.error(
        `[SupabaseChatStageRepository] FAIL-CLOSED: Erro ao executar patch_chat_progress_atomic para conv=${convId}: ${errorMsg}. Escrita direta em stage_completed_rules terminantemente proibida.`
      );
      throw new Error(`Falha ao salvar progresso atômico: ${errorMsg}`);
    } catch (err) {
      console.error("[SupabaseChatStageRepository] Erro ao salvar progresso da conversa:", err);
      throw err;
    }
  }

  async toggleItemCompletion(
    conversationId: string,
    itemId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    const existing = (await this.getChatProgress(conversationId)) || {
      conversationId,
      currentStageId: (await this.getStages())[0]?.id || "",
      completedItemIds: [],
      completedGoalIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    const completed = new Set(existing.completedItemIds || []);
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

    await this.saveChatProgress(updated);
    return updated;
  }

  async toggleGoalCompletion(
    conversationId: string,
    goalId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    const existing = (await this.getChatProgress(conversationId)) || {
      conversationId,
      currentStageId: (await this.getStages())[0]?.id || "",
      completedItemIds: [],
      completedGoalIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    const completedGoals = new Set(existing.completedGoalIds || []);
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

    await this.saveChatProgress(updated);
    return updated;
  }

  async advanceStage(conversationId: string, nextStageId: string): Promise<ChatProgress> {
    const existing = (await this.getChatProgress(conversationId)) || {
      conversationId,
      currentStageId: nextStageId,
      completedItemIds: [],
      completedGoalIds: [],
      isConverted: false,
      updatedAt: new Date().toISOString(),
    };

    const updated: ChatProgress = {
      ...existing,
      currentStageId: nextStageId,
      updatedAt: new Date().toISOString(),
    };

    await this.saveChatProgress(updated);
    return updated;
  }

  async markAsConverted(conversationId: string, isConverted: boolean): Promise<ChatProgress> {
    const existing = (await this.getChatProgress(conversationId)) || {
      conversationId,
      currentStageId: (await this.getStages())[0]?.id || "",
      completedItemIds: [],
      completedGoalIds: [],
      isConverted,
      updatedAt: new Date().toISOString(),
    };

    const updated: ChatProgress = {
      ...existing,
      isConverted,
      updatedAt: new Date().toISOString(),
    };

    await this.saveChatProgress(updated);
    return updated;
  }
}
