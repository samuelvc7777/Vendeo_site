/**
 * src/infrastructure/repositories/SupabaseSubagentRepository.ts
 * Implementação Oficial da Persistência do Catálogo de Subagentes via Supabase.
 * 
 * Regra Arquitetural Absoluta:
 * - Supabase (public.subagent_definitions) é a ÚNICA fonte de verdade persistente.
 * - Zero localStorage.
 * - Zero pseudo-registros em conversas.
 * - Sincronização em tempo real via Supabase Realtime Channel.
 */

import { ISubagentRepository } from "@/domain/repositories/ISubagentRepository";
import { SubagentDefinition, CANONICAL_SUBAGENTS_LIST } from "@/domain/entities/Subagent";
import { ChatStage } from "@/domain/entities/ChatStage";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabaseSubagentRepository implements ISubagentRepository {
  private customClient?: any;
  private cachedSubagents: SubagentDefinition[] | null = null;
  private lastFetchTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;
  private listeners: Array<() => void> = [];

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

  public subscribeToChanges(callback: () => void): () => void {
    this.listeners.push(callback);
    this.initRealtimeSubscription();
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  private notifyChangeListeners() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.warn("[SupabaseSubagentRepository] Erro ao notificar listener de realtime:", err);
      }
    }
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("subagent-definitions-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "subagent_definitions",
          },
          () => {
            // Invalida cache em memória e notifica componentes conectados
            this.cachedSubagents = null;
            this.lastFetchTime = 0;
            this.notifyChangeListeners();
          }
        )
        .subscribe();
    } catch (err) {
      console.warn("[SupabaseSubagentRepository] Falha ao inicializar realtime de subagentes:", err);
    }
  }

  /**
   * Converte registro do banco (snake_case) para entidade de domínio (camelCase).
   */
  private mapRowToEntity(row: any): SubagentDefinition {
    return {
      id: row.id,
      name: row.name,
      mission: row.mission,
      enabled: row.enabled ?? true,
      isSystem: row.is_system ?? false,
      description: row.description || undefined,
      stageIds: Array.isArray(row.stage_ids) ? row.stage_ids : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Lista todos os subagentes diretamente do Supabase.
   */
  async list(): Promise<SubagentDefinition[]> {
    this.initRealtimeSubscription();

    const now = Date.now();
    if (this.cachedSubagents && now - this.lastFetchTime < this.cacheDurationMs) {
      return [...this.cachedSubagents];
    }

    const client = this.getClient();
    if (!client) {
      // Fallback em memória estrito para os canônicos quando não há cliente configurado
      return [...CANONICAL_SUBAGENTS_LIST];
    }

    try {
      const { data, error } = await client
        .from("subagent_definitions")
        .select("*")
        .order("is_system", { ascending: false })
        .order("name", { ascending: true });

      if (error) {
        console.error("[SupabaseSubagentRepository] Erro ao consultar subagent_definitions:", error);
        if (this.cachedSubagents) return [...this.cachedSubagents];
        return [...CANONICAL_SUBAGENTS_LIST];
      }

      if (data && Array.isArray(data) && data.length > 0) {
        const entities = data.map((r) => this.mapRowToEntity(r));
        this.cachedSubagents = entities;
        this.lastFetchTime = now;
        return [...entities];
      }

      // Caso a tabela esteja vazia (ex: antes do seed), retorna os 3 canônicos
      return [...CANONICAL_SUBAGENTS_LIST];
    } catch (err) {
      console.error("[SupabaseSubagentRepository] Exceção ao listar subagentes:", err);
      if (this.cachedSubagents) return [...this.cachedSubagents];
      return [...CANONICAL_SUBAGENTS_LIST];
    }
  }

  async listSubagents(): Promise<SubagentDefinition[]> {
    return this.list();
  }

  /**
   * Obtém um subagente específico por ID diretamente do Supabase.
   */
  async getById(id: string): Promise<SubagentDefinition | null> {
    const client = this.getClient();
    if (!client) {
      const found = CANONICAL_SUBAGENTS_LIST.find((s) => s.id === id);
      return found ? { ...found } : null;
    }

    try {
      const { data, error } = await client
        .from("subagent_definitions")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return this.mapRowToEntity(data);
    } catch (err) {
      console.error(`[SupabaseSubagentRepository] Erro ao buscar subagente ${id}:`, err);
      return null;
    }
  }

  async getSubagent(id: string): Promise<SubagentDefinition | null> {
    return this.getById(id);
  }

  /**
   * Cria um novo subagente customizado diretamente no Supabase.
   */
  async create(subagent: SubagentDefinition): Promise<SubagentDefinition> {
    const rawId = (subagent.id || "").trim();
    if (!rawId) throw new Error("ID do subagente é obrigatório");

    const cleanId = rawId
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const cleanName = (subagent.name || "").trim();
    const cleanMission = (subagent.mission || "").trim();

    if (!cleanId) throw new Error("ID do subagente é obrigatório");
    if (!cleanName) throw new Error("Nome do subagente é obrigatório");
    if (!cleanMission) throw new Error("Missão do subagente é obrigatória");

    // Impede que agente custom use ID reservado dos canônicos
    const reservedIds = ["conexao_inicial", "descoberta", "compatibilidade", "none"];
    if (reservedIds.includes(cleanId) && !subagent.isSystem) {
      throw new Error(`O identificador '${cleanId}' é reservado pelo sistema.`);
    }

    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    // Verifica duplicidade prévia
    const existing = await this.getById(cleanId);
    if (existing) {
      throw new Error(`Um subagente com o identificador '${cleanId}' já existe no catálogo.`);
    }

    const rowPayload = {
      id: cleanId,
      name: cleanName,
      mission: cleanMission,
      enabled: subagent.enabled ?? true,
      is_system: subagent.isSystem ?? false,
      description: subagent.description?.trim() || null,
      stage_ids: Array.isArray(subagent.stageIds) ? subagent.stageIds : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from("subagent_definitions")
      .insert(rowPayload)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseSubagentRepository] Erro ao criar subagente no Supabase:", error);
      throw new Error(error.message || "Falha ao criar subagente no banco de dados");
    }

    // Invalida cache
    this.cachedSubagents = null;
    this.lastFetchTime = 0;

    return this.mapRowToEntity(data);
  }

  /**
   * Atualiza um subagente existente no Supabase.
   */
  async update(id: string, updates: Partial<SubagentDefinition>): Promise<SubagentDefinition> {
    const cleanId = id.trim().toLowerCase();
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (!cleanName) throw new Error("Nome do subagente não pode ser vazio");
      updatePayload.name = cleanName;
    }

    if (updates.mission !== undefined) {
      const cleanMission = updates.mission.trim();
      if (!cleanMission) throw new Error("Missão do subagente não pode ser vazia");
      updatePayload.mission = cleanMission;
    }

    if (updates.enabled !== undefined) {
      updatePayload.enabled = Boolean(updates.enabled);
    }

    if (updates.description !== undefined) {
      updatePayload.description = updates.description?.trim() || null;
    }

    if (updates.stageIds !== undefined) {
      updatePayload.stage_ids = Array.isArray(updates.stageIds) ? updates.stageIds : [];
    }

    const { data, error } = await client
      .from("subagent_definitions")
      .update(updatePayload)
      .eq("id", cleanId)
      .select()
      .single();

    if (error) {
      console.error(`[SupabaseSubagentRepository] Erro ao atualizar subagente ${cleanId}:`, error);
      throw new Error(error.message || "Falha ao atualizar subagente no banco de dados");
    }

    // Invalida cache
    this.cachedSubagents = null;
    this.lastFetchTime = 0;

    return this.mapRowToEntity(data);
  }

  async saveSubagent(subagent: SubagentDefinition): Promise<SubagentDefinition> {
    const existing = await this.getById(subagent.id);
    if (existing) {
      return this.update(subagent.id, subagent);
    }
    return this.create(subagent);
  }

  /**
   * Ativa ou desativa um subagente no Supabase.
   */
  async setEnabled(id: string, enabled: boolean): Promise<SubagentDefinition> {
    return this.update(id, { enabled });
  }

  async toggleSubagent(id: string, enabled: boolean): Promise<SubagentDefinition> {
    return this.setEnabled(id, enabled);
  }

  /**
   * Exclui com segurança um subagente customizado do Supabase.
   * Regra estrita: agentes canônicos (is_system=true) são protegidos tanto no backend quanto no PostgreSQL.
   */
  async deleteCustom(id: string): Promise<boolean> {
    const cleanId = id.trim().toLowerCase();
    const subagent = await this.getById(cleanId);

    if (!subagent) {
      return true; // Já não existe
    }

    if (subagent.isSystem) {
      throw new Error(`Subagentes canônicos de sistema ('${cleanId}') não podem ser excluídos.`);
    }

    // Verifica vínculos prévios com objetivos
    const linkedCount = await this.countLinkedObjectives(cleanId);
    if (linkedCount > 0) {
      throw new Error(
        `Não é possível excluir o subagente '${subagent.name}'. Ele está vinculado a ${linkedCount} objetivo(s) ativo(s). Desvincule ou desative-o primeiro.`
      );
    }

    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const { error } = await client
      .from("subagent_definitions")
      .delete()
      .eq("id", cleanId);

    if (error) {
      console.error(`[SupabaseSubagentRepository] Erro ao excluir subagente ${cleanId}:`, error);
      throw new Error(error.message || "Falha ao excluir subagente do banco de dados");
    }

    // Invalida cache
    this.cachedSubagents = null;
    this.lastFetchTime = 0;

    return true;
  }

  async deleteSubagent(id: string): Promise<boolean> {
    return this.deleteCustom(id);
  }

  /**
   * Conta quantos objetivos de etapa possuem este subagente configurado em allowedSubagents.
   */
  async countLinkedObjectives(subagentId: string): Promise<number> {
    const client = this.getClient();
    if (!client) return 0;

    try {
      const { data, error } = await client
        .from("chat_stages")
        .select("goals");

      if (error || !data || !Array.isArray(data)) {
        return 0;
      }

      let count = 0;
      for (const stg of data) {
        for (const goal of (stg.goals || []) as any[]) {
          const allowed = goal.allowedSubagents || goal.allowed_subagents;
          if (Array.isArray(allowed) && allowed.includes(subagentId)) {
            count++;
          }
        }
      }

      return count;
    } catch (err) {
      console.warn(`[SupabaseSubagentRepository] Erro ao contar objetivos vinculados a ${subagentId}:`, err);
      return 0;
    }
  }
}

let _subagentRepoInstance: SupabaseSubagentRepository | null = null;

export function getSubagentRepository(): SupabaseSubagentRepository {
  if (!_subagentRepoInstance) {
    _subagentRepoInstance = new SupabaseSubagentRepository();
  }
  return _subagentRepoInstance;
}
