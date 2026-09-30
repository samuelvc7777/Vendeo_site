import { useCallback, useEffect, useRef, useState } from "react";
import { autopilotApiFetch } from "@/infrastructure/http/autopilotApiFetch";
import { toast } from "sonner";
import { SupabaseAutoPilotRepository } from "@/infrastructure/repositories/SupabaseAutoPilotRepository";
import { AutoPilotChatState, AutoPilotConfig, AutoPilotPendingAction } from "@/domain/entities/AutoPilot";

const autoPilotRepo = new SupabaseAutoPilotRepository();

interface UseAutoPilotOptions {
  conversations: any[];
  messages: Record<string, any[]>;
  onSendMessage: (conversationId: string, text: string) => Promise<void>;
  onRefreshMessages?: (conversationId: string) => Promise<void>;
  onStageChange?: (conversationId: string) => Promise<void>;
  /** Saúde do canal Realtime. Quando true, o polling de fallback é suprimido. */
  isRealtimeHealthy?: boolean;
}

/** Console do AutoPilot: processamento autônomo exclusivamente no backend. */
export function useAutoPilot({ conversations, onSendMessage, onStageChange, isRealtimeHealthy }: UseAutoPilotOptions) {
  const [config, setConfig] = useState<AutoPilotConfig | null>(null);
  const [chatStates, setChatStates] = useState<Record<string, AutoPilotChatState>>({});
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(null);
  const chatStatesRef = useRef(chatStates);
  const notifiedHumanReviewRef = useRef<Record<string, string>>({});
  useEffect(() => { chatStatesRef.current = chatStates; }, [chatStates]);

  useEffect(() => {
    for (const [conversationId, state] of Object.entries(chatStates)) {
      if (state.status !== "waiting_human") continue;
      const reviewKey = state.cycleId || state.pausedAt || state.stateUpdatedAt || "waiting_human";
      if (notifiedHumanReviewRef.current[conversationId] === reviewKey) continue;
      notifiedHumanReviewRef.current[conversationId] = reviewKey;
      const conversation = conversations.find((item) => item.id === conversationId);
      const contactName = conversation?.fullName || conversation?.username || conversationId;
      const mediaObservation = String(state.pauseReason || "").startsWith("media_observation_required|");
      toast(mediaObservation ? "Precisa de observação" : "A IA precisa de você", {
        description: mediaObservation
          ? `${contactName} enviou uma mídia que precisa da sua observação antes de o Brain continuar.`
          : `${contactName} aguarda uma resposta sua. A IA continua habilitada neste chat.`,
        duration: 10000,
      });
    }
  }, [chatStates, conversations]);

  const mergeStatesMonotonic = useCallback((incoming: Record<string, AutoPilotChatState>) => {
    setChatStates((previous) => {
      const merged = { ...previous };
      for (const [conversationId, next] of Object.entries(incoming)) {
      const current = merged[conversationId];
      const currentRevision = Number(current?.stateRevision || 0);
      const nextRevision = Number(next?.stateRevision || 0);
      const currentVersion = current?.stateUpdatedAt ? Date.parse(current.stateUpdatedAt) : 0;
      const nextVersion = next?.stateUpdatedAt ? Date.parse(next.stateUpdatedAt) : 0;
      const isNewer = nextRevision > 0 || currentRevision > 0
        ? nextRevision >= currentRevision
        : nextVersion >= currentVersion;
      if (!current || isNewer) merged[conversationId] = next;
      }
      return merged;
    });
  }, []);

  const refreshState = useCallback(async (force = false) => {
    try {
      const [nextConfig, nextStates] = await Promise.all([autoPilotRepo.getConfig(), autoPilotRepo.getAllChatStates(force)]);
      setConfig(nextConfig); mergeStatesMonotonic(nextStates);
    } catch (error) { console.warn("Erro ao carregar estado do Piloto Automático:", error); }
  }, [mergeStatesMonotonic]);
  useEffect(() => { void refreshState(); }, [refreshState]);

  // Contingência para navegadores que perderem broadcast do Realtime.
  // Só executa quando o Realtime está degradado (isRealtimeHealthy === false).
  // Intervalo de 30s: fallback real, não polling primário.
  const isRealtimeHealthyRef = useRef(isRealtimeHealthy);
  useEffect(() => { isRealtimeHealthyRef.current = isRealtimeHealthy; }, [isRealtimeHealthy]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (isRealtimeHealthyRef.current) return; // Realtime saudável → não pollar
      void autoPilotRepo.getAllChatStates(true).then(mergeStatesMonotonic).catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [mergeStatesMonotonic]);

  // O scheduler e 100% backend. A UI nao chama cron-tick:
  // multiplas abas nao podem multiplicar workers nem pressionar o banco.
  const applyRemoteStateUpdate = useCallback((payload: Partial<AutoPilotChatState> & { conversationId: string; timestamp?: string }) => {
    setChatStates((previous) => {
      const existing = previous[payload.conversationId] || {
        conversationId: payload.conversationId,
        isEnabled: true,
        status: "idle" as const,
      };
      const currentRevision = Number(existing.stateRevision || 0);
      const incomingRevision = Number(payload.stateRevision || 0);
      const currentVersion = existing.stateUpdatedAt ? Date.parse(existing.stateUpdatedAt) : 0;
      const incomingVersion = payload.stateUpdatedAt
        ? Date.parse(payload.stateUpdatedAt)
        : payload.timestamp ? Date.parse(payload.timestamp) : Date.now();
      if (incomingRevision > 0 || currentRevision > 0) {
        if (incomingRevision < currentRevision) return previous;
      } else if (currentVersion > incomingVersion) {
        return previous;
      }
      const mergedActivity = payload.activity === null
        ? undefined
        : payload.activity
        ? { ...existing.activity, ...payload.activity }
        : existing.activity;
      const updated = {
        ...existing,
        ...payload,
        activity: mergedActivity,
        stateUpdatedAt: new Date(incomingVersion).toISOString(),
      };
      if (payload.activity === null) delete updated.activity;
      return { ...previous, [payload.conversationId]: updated };
    });
  }, []);

  const updateConfig = useCallback(async (partial: Partial<AutoPilotConfig>) => {
    const updated = await autoPilotRepo.saveConfig(partial); setConfig(updated);
    toast.success("Configurações do Piloto Automático atualizadas!"); return updated;
  }, []);

  const toggleAutoPilotForChat = useCallback(async (conversationId: string, forceState?: boolean) => {
    const isEnabled = forceState ?? !chatStatesRef.current[conversationId]?.isEnabled;
    try {
      const response = await autopilotApiFetch("/api/autopilot/toggle-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, isEnabled }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true || result.isEnabled !== isEnabled) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      await refreshState(true);
      const confirmedAt = result.stateUpdatedAt || new Date().toISOString();
      setChatStates((previous) => ({
        ...previous,
        ...(Date.parse(previous[conversationId]?.stateUpdatedAt || "") > Date.parse(confirmedAt) ? {} : {
        [conversationId]: {
          ...(previous[conversationId] || { conversationId }),
          conversationId,
          isEnabled,
          status: isEnabled ? "idle" : "disabled",
          pauseReason: isEnabled ? undefined : "paused_manual",
          pausedAt: isEnabled ? undefined : confirmedAt,
          enabledAt: isEnabled ? confirmedAt : previous[conversationId]?.enabledAt,
          activity: undefined,
          pendingAction: isEnabled ? previous[conversationId]?.pendingAction : undefined,
          scheduledResponseAt: isEnabled ? previous[conversationId]?.scheduledResponseAt : undefined,
          stateUpdatedAt: confirmedAt,
        },
        }),
      }));
      toast.success(isEnabled ? "Piloto Automático ativado neste chat." : "Piloto Automático desativado neste chat.");
    } catch (error) {
      console.error("Falha ao alterar o estado do Piloto Automático:", error);
      toast.error("Não foi possível confirmar a alteração do Piloto Automático.");
    }
  }, [refreshState]);

  const activateAutoPilotWithChoice = useCallback(async (
    conversationId: string,
    mode: "immediate" | "wait_next"
  ) => {
    const isImmediate = mode === "immediate";
    try {
      const res = await autopilotApiFetch("/api/autopilot/toggle-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          isEnabled: true,
          triggerImmediate: isImmediate,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true || data.isEnabled !== true) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await refreshState(true);
      const confirmedAt = data.stateUpdatedAt || new Date().toISOString();
      setChatStates((previous) => ({
        ...previous,
        ...(Date.parse(previous[conversationId]?.stateUpdatedAt || "") > Date.parse(confirmedAt) ? {} : {
        [conversationId]: {
          ...(previous[conversationId] || { conversationId }),
          conversationId,
          isEnabled: true,
          status: data.immediateTriggered ? "processing" : "idle",
          pauseReason: undefined,
          pausedAt: undefined,
          enabledAt: confirmedAt,
          activity: undefined,
          stateUpdatedAt: confirmedAt,
          ...(data.cycleId ? { cycleId: data.cycleId } : {}),
        },
        }),
      }));

      if (isImmediate) {
        if (data.immediateTriggered || data.result === "started") {
          toast.success("Piloto ativado! A IA está respondendo a mensagem pendente agora.");
        } else if (data.immediateReason === "nothing_to_answer" || data.result === "nothing_to_answer") {
          toast.info("Piloto ativado! A última mensagem já foi respondida; a IA aguardará a próxima mensagem do cliente.");
        } else {
          toast.success("Piloto Automático ativado!");
        }
      } else {
        toast.success("Piloto Automático ativado em espera!");
      }
    } catch (err) {
      console.warn("Aviso ao ativar piloto com modo:", err);
      toast.error("Erro ao sincronizar ativação com o backend.");
      throw err;
    }

  }, [refreshState]);

  const registerClientMessage = useCallback(async (conversationId: string, timestamp?: string) => {
    if (!chatStatesRef.current[conversationId]?.isEnabled) return;
    const updated = await autoPilotRepo.resetChatDebounce(conversationId, timestamp);
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
  }, []);

  const resumeChatFromPause = useCallback(async (conversationId: string) => {
    try {
      const response = await autopilotApiFetch("/api/autopilot/toggle-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, isEnabled: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true || result.isEnabled !== true) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      await refreshState(true);
      const confirmedAt = result.stateUpdatedAt || new Date().toISOString();
      setChatStates((previous) => ({
        ...previous,
        ...(Date.parse(previous[conversationId]?.stateUpdatedAt || "") > Date.parse(confirmedAt) ? {} : {
        [conversationId]: {
          ...(previous[conversationId] || { conversationId }),
          conversationId,
          isEnabled: true,
          status: "idle",
          pauseReason: undefined,
          pausedAt: undefined,
          enabledAt: confirmedAt,
          activity: undefined,
          stateUpdatedAt: confirmedAt,
        },
        }),
      }));
      toast.success("Piloto Automático retomado no backend.");
    } catch (error) {
      console.error("Falha ao retomar o Piloto Automático:", error);
      toast.error("Não foi possível confirmar a retomada do Piloto Automático.");
    }
  }, [refreshState]);

  const approvePendingAction = useCallback(async (conversationId: string, customResponses?: string[]) => {
    const pending = chatStatesRef.current[conversationId]?.pendingAction;
    const responses = customResponses?.length ? customResponses : pending?.responses;
    if (!responses?.length) return;
    setCurrentProcessingId(conversationId);
    try {
      for (const response of responses) await onSendMessage(conversationId, response);
      await autoPilotRepo.saveChatState(conversationId, { status: "idle", pendingAction: undefined, lastResponseSentAt: new Date().toISOString() });
      if (onStageChange) await onStageChange(conversationId); await refreshState(); toast.success("Resposta enviada com sucesso!");
    } finally { setCurrentProcessingId(null); }
  }, [onSendMessage, onStageChange, refreshState]);

  const updatePendingResponses = useCallback(async (conversationId: string, responses: string[]) => {
    const pending = chatStatesRef.current[conversationId]?.pendingAction; if (!pending) return;
    const updated = await autoPilotRepo.saveChatState(conversationId, { pendingAction: { ...pending, responses } });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
  }, []);

  const rejectPendingAction = useCallback(async (conversationId: string) => {
    const updated = await autoPilotRepo.saveChatState(conversationId, { status: "idle", pendingAction: undefined, scheduledResponseAt: undefined });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
  }, []);

  return { config, chatStates, activeQueue: [], currentProcessingId, updateConfig, toggleAutoPilotForChat, activateAutoPilotWithChoice, registerClientMessage, resumeChatFromPause, approvePendingAction, updatePendingResponses, rejectPendingAction, refreshState, applyRemoteStateUpdate };
}
