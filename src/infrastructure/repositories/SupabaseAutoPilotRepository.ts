import { IAutoPilotRepository } from "@/domain/repositories/IAutoPilotRepository";
import { AutoPilotConfig, AutoPilotChatState } from "@/domain/entities/AutoPilot";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const LOCAL_STORAGE_CONFIG_KEY = "vendeo_autopilot_config_v1";
const LOCAL_STORAGE_STATES_KEY = "vendeo_autopilot_states_v1";

const DEFAULT_CONFIG: AutoPilotConfig = {
  isEnabledGlobally: true,
  mode: "automatic", // 100% Automático direto (semiautomático removido)
  responseDelayMinutes: 1, // Quiet period da última mensagem
  maxDebounceWindowMinutes: 3, // Impede que novas mensagens adiem o Brain indefinidamente
  activationWaitMinutes: 1,
  pauseOnPhotoReceived: true,
  pauseOnSensitiveContent: true,
  handOffAtRaffleStep: true,
  typingDelaySecondsPerBalloon: 4,
  updatedAt: new Date().toISOString(),
};

interface StoredConfigPayload {
  config: AutoPilotConfig;
  updated_at: string;
}

interface StoredStatesPayload {
  states: Record<string, AutoPilotChatState>;
  updated_at: string;
}

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

  private getLocalConfig(): AutoPilotConfig {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return { ...DEFAULT_CONFIG, ...parsed };
        }
      }
    } catch (e) {
      console.warn("Erro ao ler config do Piloto Automático local:", e);
    }
    return DEFAULT_CONFIG;
  }

  private saveLocalConfig(config: AutoPilotConfig) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn("Erro ao salvar config do Piloto Automático local:", e);
    }
  }

  private getLocalStates(): Record<string, AutoPilotChatState> {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_STATES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Erro ao ler estados do Piloto Automático local:", e);
    }
    return {};
  }

  private saveLocalStates(states: Record<string, AutoPilotChatState>) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCAL_STORAGE_STATES_KEY, JSON.stringify(states));
    } catch (e) {
      console.warn("Erro ao salvar estados do Piloto Automático local:", e);
    }
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || typeof window === "undefined") return;
    const client = this.getClient();
    if (!client) return;

    try {
      client.channel("vendeo_autopilot_config_sync")
        .on("postgres_changes", {
          event: "*", schema: "public", table: "instagram_conversations",
          filter: "id=eq.__autopilot_config__",
        }, (payload: any) => {
          const row = payload?.new;
          if (row?.stage_completed_rules?.config) {
            const nextConfig: AutoPilotConfig = { ...DEFAULT_CONFIG, ...row.stage_completed_rules.config };
            this.cachedConfig = nextConfig;
            this.saveLocalConfig(nextConfig);
          }
        }).subscribe();

      client.channel("vendeo_autopilot_state_rows")
        .on("postgres_changes", {
          event: "*", schema: "public", table: "autopilot_chat_states",
        }, (payload: any) => {
          const row = payload?.new;
          if (!row?.conversation_id || !row?.state) return;
          const next = this.mapStateRow(row);
          this.cachedStates = this.mergeStatesMonotonic(
            this.cachedStates || this.getLocalStates(),
            { [next.conversationId]: next }
          );
          this.saveLocalStates(this.cachedStates);
        }).subscribe();

      this.realtimeSubscribed = true;
    } catch (err) {
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
    if (!force && this.cachedConfig && now - this.lastFetchConfigTime < this.cacheDurationMs) {
      return this.cachedConfig;
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", "__autopilot_config__")
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredConfigPayload;
          if (rules.config && typeof rules.config === "object") {
            this.cachedConfig = { ...DEFAULT_CONFIG, ...rules.config };
            this.saveLocalConfig(this.cachedConfig);
            this.lastFetchConfigTime = now;
            return this.cachedConfig;
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar config do Piloto Automático do Supabase:", err);
      }
    }

    const local = this.getLocalConfig();
    this.cachedConfig = local;
    this.lastFetchConfigTime = now;
    return local;
  }

  async saveConfig(config: Partial<AutoPilotConfig>): Promise<AutoPilotConfig> {
    const current = await this.getConfig();
    const updated: AutoPilotConfig = {
      ...current,
      ...config,
      updatedAt: new Date().toISOString(),
    };

    this.cachedConfig = updated;
    this.saveLocalConfig(updated);
    this.lastFetchConfigTime = Date.now();

    const client = this.getClient();
    if (client) {
      try {
        const payload: StoredConfigPayload = {
          config: updated,
          updated_at: updated.updatedAt,
        };

        await client.from("instagram_conversations").upsert({
          id: "__autopilot_config__",
          username: "system_autopilot_config",
          full_name: "Configurações do Piloto Automático",
          status: "system",
          unread: false,
          last_message: `Delay: ${updated.responseDelayMinutes}m | Global: ${updated.isEnabledGlobally ? "ON" : "OFF"}`,
          last_message_at: new Date().toISOString(),
          is_restricted: false,
          stage_completed_rules: payload as any,
          updated_at: new Date().toISOString(),
        });

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
    if (client) {
      try {
        const rows: any[] = [];
        const pageSize = 500;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await client.from("autopilot_chat_states")
            .select("conversation_id, is_enabled, status, state, state_updated_at, state_revision")
            .order("conversation_id", { ascending: true }).range(from, from + pageSize - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }
        if (rows.length > 0) {
          const nextStates = Object.fromEntries(rows.map((row: any) => {
            const state = this.mapStateRow(row);
            return [state.conversationId, state];
          })) as Record<string, AutoPilotChatState>;
          this.cachedStates = this.mergeStatesMonotonic(this.cachedStates || {}, nextStates);
          this.saveLocalStates(this.cachedStates);
          this.lastFetchStatesTime = now;
          return this.cachedStates;
        }
      } catch {
        // Rollout compat?vel: tenta a proje??o global antiga.
      }

      try {
        const { data, error } = await client.from("instagram_conversations")
          .select("stage_completed_rules").eq("id", "__autopilot_states__").maybeSingle();
        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredStatesPayload;
          if (rules.states && typeof rules.states === "object") {
            const projectionStates = rules.states as Record<string, AutoPilotChatState>;
            const conversationIds = Object.keys(projectionStates);
            let canonicalEnabled: Record<string, boolean> = {};
            if (conversationIds.length) {
              const { data: conversations, error: canonicalError } = await client.from("instagram_conversations")
                .select("id, ai_auto_respond").in("id", conversationIds);
              if (canonicalError) throw canonicalError;
              canonicalEnabled = Object.fromEntries((conversations || []).map((row: any) => [row.id, row.ai_auto_respond === true]));
            }
            const canonicalStates = Object.fromEntries(Object.entries(projectionStates).map(([id, state]) => {
              const isEnabled = canonicalEnabled[id] ?? state.isEnabled === true;
              return [id, { ...state, isEnabled, status: !isEnabled ? "disabled" : state.status === "disabled" ? "idle" : state.status }];
            })) as Record<string, AutoPilotChatState>;
            this.cachedStates = this.mergeStatesMonotonic(this.cachedStates || {}, canonicalStates);
            this.saveLocalStates(this.cachedStates);
            this.lastFetchStatesTime = now;
            return this.cachedStates;
          }
        }
      } catch (err) { console.warn("Aviso ao carregar estados do Piloto Autom?tico:", err); }
    }
    const local = this.getLocalStates();
    this.cachedStates = local;
    this.lastFetchStatesTime = now;
    return local;
  }

  private async persistStateToCloud(state: AutoPilotChatState, expectedStateUpdatedAt?: string): Promise<void> {
    const states = { ...(this.cachedStates || this.getLocalStates()), [state.conversationId]: state };
    this.cachedStates = states;
    this.saveLocalStates(states);
    this.lastFetchStatesTime = Date.now();

    const client = this.getClient();
    if (!client) return;

    try {
      const item = { ...state } as AutoPilotChatState;
      const now = Date.now();
      const sendingStartedMs = item.sendingStartedAt ? Date.parse(item.sendingStartedAt) : 0;
      if (item.isSending && (sendingStartedMs === 0 || now - sendingStartedMs > 25000)) {
        item.isSending = false;
        item.sendingStartedAt = null;
        item.sendingCycleToken = null;
      }
      if (item.activity && item.activity.phase !== "completed") {
        const actUpdateMs = item.activity.updatedAt ? Date.parse(item.activity.updatedAt) : 0;
        if (actUpdateMs > 0 && now - actUpdateMs > 45000) {
          if (item.lastThoughts?.atriaThought || item.lastThoughts?.solThought) {
            item.activity = {
              phase: "completed",
              label: "Última resposta enviada",
              detail: "Aguardando nova mensagem do cliente para iniciar novo raciocínio.",
              updatedAt: new Date().toISOString(),
              atriaThought: item.lastThoughts.atriaThought,
              solThought: item.lastThoughts.solThought,
              previewResponses: item.lastThoughts.previewResponses,
            };
          } else {
            item.activity = null;
          }
          if (item.status === "processing" || item.status === "waiting_delay") item.status = "idle";
        }
      }

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
        this.saveLocalStates(this.cachedStates);
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
    const config = await this.getConfig();
    const current = await this.getChatState(conversationId);

    if (!current || !current.isEnabled || current.status === "paused_handoff" || current.status === "paused_guardrail") {
      return current || { conversationId, isEnabled: false, status: "idle" };
    }

    const clientTime = lastMessageTimestamp ? new Date(lastMessageTimestamp).getTime() : Date.now();
    const scheduledMs = clientTime + config.responseDelayMinutes * 60 * 1000;

    const updated: AutoPilotChatState = {
      ...current,
      activity: null,
      isSending: false,
      sendingStartedAt: null,
      sendingCycleToken: null,
      lastClientMessageAt: lastMessageTimestamp || new Date().toISOString(),
      scheduledResponseAt: new Date(scheduledMs).toISOString(),
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

