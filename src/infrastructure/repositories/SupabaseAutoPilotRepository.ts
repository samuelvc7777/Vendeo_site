import { IAutoPilotRepository } from "@/domain/repositories/IAutoPilotRepository";
import { AutoPilotConfig, AutoPilotChatState } from "@/domain/entities/AutoPilot";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const DEFAULT_CONFIG: AutoPilotConfig = {
  isEnabledGlobally: true,
  mode: "automatic", // 100% Automático direto (semiautomático removido)
  activationWaitMinutes: 1,
  pauseOnPhotoReceived: true,
  pauseOnSensitiveContent: true,
  handOffAtRaffleStep: true,
  typingDelaySecondsPerBalloon: 4,
  updatedAt: new Date().toISOString(),
};

export class SupabaseAutoPilotRepository implements IAutoPilotRepository {
  private cachedConfig: AutoPilotConfig | null = null;
  private cachedStates: Record<string, AutoPilotChatState> | null = null;
  private lastFetchConfigTime = 0;
  private lastFetchStatesTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || typeof window === "undefined") return;
    const client = this.getClient();
    if (!client) return;

    // Marca antes de subscribe para impedir corrida entre chamadas simult?neas.
    this.realtimeSubscribed = true;
    try {
      client.channel("vendeo_autopilot_settings_sync_v2")
        .on("postgres_changes", {
          event: "*", schema: "public", table: "autopilot_settings", filter: "id=eq.global",
        }, (payload: any) => {
          const row = payload?.new;
          if (row?.config && typeof row.config === "object") {
            this.cachedConfig = { ...DEFAULT_CONFIG, ...row.config };
            this.lastFetchConfigTime = Date.now();
          }
        }).subscribe();

      client.channel("vendeo_autopilot_state_rows_v2")
        .on("postgres_changes", {
          event: "*", schema: "public", table: "autopilot_chat_states",
        }, (payload: any) => {
          const row = payload?.new;
          if (!row?.conversation_id || !row?.state) return;
          const next = this.mapStateRow(row);
          this.cachedStates = this.mergeStatesMonotonic(this.cachedStates || {}, { [next.conversationId]: next });
          this.lastFetchStatesTime = Date.now();
        }).subscribe();
    } catch (err) {
      this.realtimeSubscribed = false;
      console.warn("Aviso ao assinar realtime do Piloto Autom?tico:", err);
    }
  }

  private mapStateRow(row: any): AutoPilotChatState {
    const state = row?.state && typeof row.state === "object" ? row.state : {};
    return {
      ...state,
      conversationId: String(row.conversation_id || state.conversationId || ""),
      isEnabled: row.is_enabled ?? state.isEnabled === true,
      status: (row.status || state.status || (row.is_enabled ? "idle" : "disabled")) as AutoPilotChatState["status"],
      stateUpdatedAt: row.state_updated_at || state.stateUpdatedAt,
      stateRevision: Number(row.state_revision ?? state.stateRevision ?? 0),
    };
  }

  async getConfig(force = false): Promise<AutoPilotConfig> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedConfig && now - this.lastFetchConfigTime < this.cacheDurationMs) return this.cachedConfig;

    const client = this.getClient();
    if (!client) return this.cachedConfig || DEFAULT_CONFIG;

    const { data, error } = await client
      .from("autopilot_settings")
      .select("config, updated_at")
      .eq("id", "global")
      .single();
    if (error) throw error;

    const resolvedConfig: AutoPilotConfig = { ...DEFAULT_CONFIG, ...(data?.config || {}) };
    this.cachedConfig = resolvedConfig;
    this.lastFetchConfigTime = now;
    return resolvedConfig;
  }

  async saveConfig(config: Partial<AutoPilotConfig>): Promise<AutoPilotConfig> {
    const current = await this.getConfig();
    const updated: AutoPilotConfig = {
      ...current,
      ...config,
      updatedAt: new Date().toISOString(),
    };

    this.cachedConfig = updated;
    this.lastFetchConfigTime = Date.now();

    const client = this.getClient();
    if (client) {
      try {
        const { error } = await client.from("autopilot_settings").upsert({
          id: "global",
          config: updated as any,
          updated_at: updated.updatedAt,
        });
        if (error) throw error;

        if (config.isEnabledGlobally !== undefined) {
          try {
            const { getApiUrl } = await import("@/infrastructure/http/network");
            await fetch(getApiUrl("/api/autopilot/toggle-global"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isEnabledGlobally: config.isEnabledGlobally }),
            });
          } catch (e) {
            console.warn("Aviso ao notificar toggle-global na API:", e);
          }
        }
      } catch (err) {
        console.warn("Aviso ao persistir config do Piloto Automático no Supabase:", err);
      }
    }

    return updated;
  }

  async getAllChatStates(force = false): Promise<Record<string, AutoPilotChatState>> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedStates && now - this.lastFetchStatesTime < this.cacheDurationMs) return this.cachedStates;
    const client = this.getClient();
    if (!client) return this.cachedStates || {};

    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client.from("autopilot_chat_states")
        .select("conversation_id, is_enabled, status, state, state_updated_at, state_revision")
        .order("conversation_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    const nextStates = Object.fromEntries(rows.map((row: any) => {
      const state = this.mapStateRow(row);
      return [state.conversationId, state];
    })) as Record<string, AutoPilotChatState>;
    this.cachedStates = this.mergeStatesMonotonic(this.cachedStates || {}, nextStates);
    this.lastFetchStatesTime = now;
    return this.cachedStates;
  }

  private async persistStateToCloud(state: AutoPilotChatState, expectedStateUpdatedAt?: string): Promise<void> {
    this.cachedStates = { ...(this.cachedStates || {}), [state.conversationId]: state };
    this.lastFetchStatesTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const item = { ...state } as AutoPilotChatState;
      const { data, error } = await (client as any).rpc("patch_autopilot_projection_state_atomic", {
        p_conversation_id: item.conversationId,
        p_state_patch: item,
        ...(expectedStateUpdatedAt ? { p_expected_state_updated_at: expectedStateUpdatedAt } : {}),
      });
      if (error || data?.success === false) throw error || new Error(data?.reason || "autopilot_projection_patch_failed");
      if (data?.state && typeof data.state === "object") {
        const canonical = {
          ...data.state,
          stateRevision: Number(data.stateRevision ?? data.state.stateRevision ?? 0),
          stateUpdatedAt: data.stateUpdatedAt || data.state.stateUpdatedAt,
        } as AutoPilotChatState;
        this.cachedStates = { ...(this.cachedStates || {}), [item.conversationId]: canonical };
      }
    } catch (err) {
      console.warn("Aviso ao persistir estado visual do Piloto Automático no Supabase:", err);
    }
  }

  private mergeStatesMonotonic(current: Record<string, AutoPilotChatState>, incoming: Record<string, AutoPilotChatState>) {
    const merged = { ...current };
    for (const [id, next] of Object.entries(incoming)) {
      const oldRevision = Number(merged[id]?.stateRevision || 0);
      const nextRevision = Number(next?.stateRevision || 0);
      const oldVersion = Date.parse(merged[id]?.stateUpdatedAt || "") || 0;
      const nextVersion = Date.parse(next?.stateUpdatedAt || "") || 0;
      const isNewer = nextRevision > 0 || oldRevision > 0
        ? nextRevision >= oldRevision
        : nextVersion >= oldVersion;
      if (!merged[id] || isNewer) merged[id] = next;
    }
    return merged;
  }

  async getChatState(conversationId: string): Promise<AutoPilotChatState | null> {
    const cached = this.cachedStates?.[conversationId];
    if (cached) return cached;
    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client.from("autopilot_chat_states")
          .select("conversation_id, is_enabled, status, state, state_updated_at, state_revision")
          .eq("conversation_id", conversationId).maybeSingle();
        if (!error && data) {
          const state = this.mapStateRow(data);
          this.cachedStates = { ...(this.cachedStates || {}), [conversationId]: state };
          return state;
        }
      } catch {}
    }
    const all = await this.getAllChatStates();
    return all[conversationId] || null;
  }

  async saveChatState(
    conversationId: string,
    state: Partial<AutoPilotChatState>
  ): Promise<AutoPilotChatState> {
    const existing = (await this.getChatState(conversationId)) || {
      conversationId,
      isEnabled: false,
      status: "idle" as const,
    };

    const updated: AutoPilotChatState = {
      ...existing,
      ...state,
      stateUpdatedAt: new Date().toISOString(),
    };

    this.cachedStates = { ...(this.cachedStates || {}), [conversationId]: updated };
    await this.persistStateToCloud(updated, existing.stateUpdatedAt);
    return updated;
  }

  async resetChatDebounce(
    conversationId: string,
    lastMessageTimestamp?: string
  ): Promise<AutoPilotChatState> {
    const current = await this.getChatState(conversationId);

    if (!current || !current.isEnabled || current.status === "paused_handoff" || current.status === "paused_guardrail") {
      return current || { conversationId, isEnabled: false, status: "idle" };
    }

    const updated: AutoPilotChatState = {
      ...current,
      activity: null,
      isSending: false,
      sendingStartedAt: null,
      sendingCycleToken: null,
      lastClientMessageAt: lastMessageTimestamp || new Date().toISOString(),
      scheduledResponseAt: undefined,
      status: "waiting_delay",
      stateUpdatedAt: new Date().toISOString(),
    };

    this.cachedStates = { ...(this.cachedStates || {}), [conversationId]: updated };
    await this.persistStateToCloud(updated, current.stateUpdatedAt);
    return updated;
  }

  async triggerCronTick(): Promise<{ success: boolean; processedCount?: number }> {
    try {
      const client = this.getClient();
      const { data, error } = await client.functions.invoke("api/autopilot/cron-tick", {
        method: "POST",
        body: {},
      });
      if (error) throw error;
      return data || { success: true, processedCount: 0 };
    } catch (e) {
      // Falha silenciosa de telemetria / heartbeat
      return { success: false, processedCount: 0 };
    }
  }
}

