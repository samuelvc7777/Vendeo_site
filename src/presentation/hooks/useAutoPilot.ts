import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch as fetch } from "@/infrastructure/http/apiFetch";
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
export function useAutoPilot({ onSendMessage, onStageChange, isRealtimeHealthy }: UseAutoPilotOptions) {
  const [config, setConfig] = useState<AutoPilotConfig | null>(null);
  const [chatStates, setChatStates] = useState<Record<string, AutoPilotChatState>>({});
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(null);
  const chatStatesRef = useRef(chatStates);
  const notifiedManualReviewsRef = useRef<Record<string, string>>({});
  const notifiedObjectiveFinalizationsRef = useRef<Record<string, string>>({});
  useEffect(() => { chatStatesRef.current = chatStates; }, [chatStates]);

  useEffect(() => {
    for (const [conversationId, state] of Object.entries(chatStates)) {
      const pending = state.pendingManualResponse;
      if (state.status !== "needs_manual_response" || !pending) continue;
      if (notifiedManualReviewsRef.current[conversationId] === pending.createdAt) continue;
      notifiedManualReviewsRef.current[conversationId] = pending.createdAt;
      const excerpt = pending.inboundMessage.length > 120
        ? `${pending.inboundMessage.slice(0, 117)}…`
        : pending.inboundMessage;
      toast("A IA precisa de você", {
        description: `Uma conversa aguarda resposta manual: “${excerpt}”`,
        duration: 10000,
      });
    }
  }, [chatStates]);

  useEffect(() => {
    for (const [conversationId, state] of Object.entries(chatStates)) {
      const pending = state.pendingObjectiveFinalization;
      if (!pending || state.status !== "awaiting_finalization") continue;
      if (notifiedObjectiveFinalizationsRef.current[conversationId] === pending.key) continue;
      notifiedObjectiveFinalizationsRef.current[conversationId] = pending.key;
      toast("Objetivos finais concluídos", {
        description: `A IA concluiu os objetivos de ${pending.stageName}. Abra o chat para finalizar.`,
        duration: 12000,
      });
    }
  }, [chatStates]);

  const mergeStatesMonotonic = useCallback((incoming: Record<string, AutoPilotChatState>) => {
    setChatStates((previous) => {
      const merged = { ...previous };
      for (const [conversationId, next] of Object.entries(incoming)) {
      const current = merged[conversationId];
      const currentVersion = current?.stateUpdatedAt ? Date.parse(current.stateUpdatedAt) : 0;
      const nextVersion = next?.stateUpdatedAt ? Date.parse(next.stateUpdatedAt) : 0;
      if (current?.cycleId && next?.cycleId === current.cycleId && Array.isArray(current.cycleEvents) && Array.isArray(next.cycleEvents)) {
        const currentSequence = current.cycleEvents[current.cycleEvents.length - 1]?.sequence || 0;
        const nextSequence = next.cycleEvents[next.cycleEvents.length - 1]?.sequence || 0;
        if (nextSequence < currentSequence) continue;
      }
        if (!current || nextVersion >= currentVersion) merged[conversationId] = next;
      }
      return merged;
    });
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const [nextConfig, nextStates] = await Promise.all([autoPilotRepo.getConfig(), autoPilotRepo.getAllChatStates()]);
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

  // Heartbeat proativo do AutoPilot: a cada 35s, se a aba estiver visível e o piloto estiver ativo,
  // aciona o cron-tick na nuvem como contingência para contornar eventuais timeouts do pg_cron do Supabase.
  useEffect(() => {
    const heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (config && !config.isEnabledGlobally) return;
      void autoPilotRepo.triggerCronTick().catch(() => {});
    }, 35000);
    return () => window.clearInterval(heartbeatTimer);
  }, [config]);



  const applyRemoteStateUpdate = useCallback((payload: Partial<AutoPilotChatState> & { conversationId: string; timestamp?: string }) => {
    setChatStates((previous) => {
      const existing = previous[payload.conversationId] || {
        conversationId: payload.conversationId,
        isEnabled: true,
        status: "idle" as const,
      };
      const currentVersion = existing.stateUpdatedAt ? Date.parse(existing.stateUpdatedAt) : 0;
      const incomingVersion = payload.stateUpdatedAt
        ? Date.parse(payload.stateUpdatedAt)
        : payload.timestamp ? Date.parse(payload.timestamp) : Date.now();
      if (currentVersion > incomingVersion) return previous;
      if (existing.cycleId && payload.cycleId === existing.cycleId && Array.isArray(existing.cycleEvents) && Array.isArray((payload as any).cycleEvents)) {
        const currentSequence = existing.cycleEvents[existing.cycleEvents.length - 1]?.sequence || 0;
        const incomingSequence = (payload as any).cycleEvents[(payload as any).cycleEvents.length - 1]?.sequence || 0;
        if (incomingSequence < currentSequence) return previous;
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
    const nowIso = new Date().toISOString();
    const updated = await autoPilotRepo.saveChatState(conversationId, {
      isEnabled,
      enabledAt: isEnabled ? nowIso : undefined,
      status: isEnabled ? "idle" : "disabled",
      pauseReason: isEnabled ? undefined : "paused_manual",
      pausedAt: isEnabled ? undefined : nowIso,
    });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
    toast.success(isEnabled ? "Piloto Automático ativado neste chat." : "Piloto Automático desativado neste chat.");

    // Sincroniza via endpoint oficial do backend para armar o piloto e registrar o watermark
    void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/toggle-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, isEnabled }),
    }).catch((err) => console.warn("Aviso ao notificar toggle-chat:", err));

    if (!isEnabled) {
      void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch((err) => console.warn("Aviso ao pausar no backend:", err));
    }

    return updated;
  }, []);

  const activateAutoPilotWithChoice = useCallback(async (
    conversationId: string,
    mode: "immediate" | "wait_next"
  ) => {
    const isImmediate = mode === "immediate";
    const nowIso = new Date().toISOString();
    const updated = await autoPilotRepo.saveChatState(conversationId, {
      isEnabled: true,
      enabledAt: nowIso,
      status: isImmediate ? "processing" : "idle",
      pauseReason: undefined,
      pausedAt: undefined,
    });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));

    try {
      const res = await fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/toggle-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          isEnabled: true,
          triggerImmediate: isImmediate,
        }),
      });

      const data = await res.json().catch(() => ({}));

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
    }

    return updated;
  }, []);

  const registerClientMessage = useCallback(async (conversationId: string, timestamp?: string) => {
    const state = chatStatesRef.current[conversationId];
    if (!state?.isEnabled || state.pendingManualResponse) return;
    const updated = await autoPilotRepo.resetChatDebounce(conversationId, timestamp);
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
  }, []);

  const resumeChatFromPause = useCallback(async (conversationId: string) => {
    const updated = await autoPilotRepo.saveChatState(conversationId, { isEnabled: true, status: "idle", pauseReason: undefined, pausedAt: undefined });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
    toast.success("Piloto Automático retomado no backend.");

    void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/toggle-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, isEnabled: true }),
    }).catch((err) => console.warn("Aviso ao sincronizar retomada:", err));

    return updated;
  }, []);

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

  const completeManualResponse = useCallback(async (conversationId: string) => {
    const updated = await autoPilotRepo.saveChatState(conversationId, {
      status: "idle",
      pendingManualResponse: null,
      lastResponseSentAt: new Date().toISOString(),
      pauseReason: undefined,
      pausedAt: undefined,
    });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
    return updated;
  }, []);

  const completeObjectiveFinalization = useCallback(async (conversationId: string) => {
    const pending = chatStatesRef.current[conversationId]?.pendingObjectiveFinalization;
    const updated = await autoPilotRepo.saveChatState(conversationId, {
      isEnabled: false,
      status: "disabled",
      pauseReason: "objectives_completed",
      pendingObjectiveFinalization: null,
      ...(pending ? { objectiveFinalizationHandledKey: pending.key } : {}),
    });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
    toast.success("Conversa finalizada e aviso confirmado.");
    return updated;
  }, []);

  return { config, chatStates, activeQueue: [], currentProcessingId, updateConfig, toggleAutoPilotForChat, activateAutoPilotWithChoice, registerClientMessage, resumeChatFromPause, approvePendingAction, updatePendingResponses, rejectPendingAction, completeManualResponse, completeObjectiveFinalization, refreshState, applyRemoteStateUpdate };
}
