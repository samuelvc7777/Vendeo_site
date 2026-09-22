import { useCallback, useEffect, useRef, useState } from "react";
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
}

/** Console do AutoPilot: processamento autônomo exclusivamente no backend. */
export function useAutoPilot({ onSendMessage, onStageChange }: UseAutoPilotOptions) {
  const [config, setConfig] = useState<AutoPilotConfig | null>(null);
  const [chatStates, setChatStates] = useState<Record<string, AutoPilotChatState>>({});
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(null);
  const chatStatesRef = useRef(chatStates);
  useEffect(() => { chatStatesRef.current = chatStates; }, [chatStates]);

  const mergeStatesMonotonic = useCallback((incoming: Record<string, AutoPilotChatState>) => {
    setChatStates((previous) => {
      const merged = { ...previous };
      for (const [conversationId, next] of Object.entries(incoming)) {
        const current = merged[conversationId];
        const currentVersion = current?.stateUpdatedAt ? Date.parse(current.stateUpdatedAt) : 0;
        const nextVersion = next?.stateUpdatedAt ? Date.parse(next.stateUpdatedAt) : 0;
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

  // Contingência para navegadores que perderem um broadcast do Realtime.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void autoPilotRepo.getAllChatStates(true).then(mergeStatesMonotonic).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [mergeStatesMonotonic]);

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

    // Sincroniza via endpoint oficial do backend para garantir travas atômicas na nuvem
    void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/toggle-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, isEnabled }),
    }).catch((err) => console.warn("Aviso ao notificar toggle-chat:", err));

    if (isEnabled) {
      void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (data?.triggered) {
          toast.info("A IA já começou a responder a mensagem pendente deste contato!");
        }
      }).catch((err) => console.warn("Aviso ao disparar trigger de ativação:", err));
    } else {
      void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch((err) => console.warn("Aviso ao pausar no backend:", err));
    }

    return updated;
  }, []);

  const registerClientMessage = useCallback(async (conversationId: string, timestamp?: string) => {
    if (!chatStatesRef.current[conversationId]?.isEnabled) return;
    const updated = await autoPilotRepo.resetChatDebounce(conversationId, timestamp);
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
  }, []);

  const resumeChatFromPause = useCallback(async (conversationId: string) => {
    const updated = await autoPilotRepo.saveChatState(conversationId, { isEnabled: true, status: "idle", pauseReason: undefined, pausedAt: undefined });
    setChatStates((previous) => ({ ...previous, [conversationId]: updated }));
    toast.success("Piloto Automático retomado no backend.");

    void fetch("https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch((err) => console.warn("Aviso ao disparar trigger de retomada:", err));

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

  return { config, chatStates, activeQueue: [], currentProcessingId, updateConfig, toggleAutoPilotForChat, registerClientMessage, resumeChatFromPause, approvePendingAction, updatePendingResponses, rejectPendingAction, refreshState, applyRemoteStateUpdate };
}
