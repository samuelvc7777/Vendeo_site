type ShutdownState = {
  conversationId?: string;
  isEnabled?: boolean;
  status?: string;
  stateUpdatedAt?: string;
  activity?: { phase?: string; updatedAt?: string; [key: string]: unknown } | null;
  activeCycleToken?: string | null;
  cycleId?: string | null;
  isSending?: boolean;
  pendingManualResponse?: unknown;
  pendingObjectiveFinalization?: unknown;
  [key: string]: unknown;
};

type ConversationRules = {
  active_cycle_token?: string | null;
  active_cycle_at?: string | null;
  orchestration?: {
    activeCycle?: { cycleToken?: string | null; expiresAt?: string | null } | null;
  } | null;
};

const ACTIVE_STATUS = new Set(["starting", "processing"]);
const TERMINAL_REVIEW_STATUS = new Set(["needs_manual_response", "awaiting_finalization"]);

export function hasActiveBrainCycle(
  state: ShutdownState | null | undefined,
  rules: ConversationRules | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (rules?.active_cycle_token) return true;
  const activeCycle = rules?.orchestration?.activeCycle;
  const activeCycleExpiresAt = activeCycle?.expiresAt ? Date.parse(activeCycle.expiresAt) : 0;
  if (activeCycle?.cycleToken && activeCycleExpiresAt > nowMs) return true;

  const isActiveStatus = ACTIVE_STATUS.has(String(state?.status || ""));
  const latestActivity = state?.activity?.updatedAt || state?.stateUpdatedAt;
  const activityAgeMs = latestActivity ? nowMs - Date.parse(latestActivity) : Number.POSITIVE_INFINITY;
  return (isActiveStatus || Boolean(state?.activeCycleToken)) && activityAgeMs >= 0 && activityAgeMs <= 300_000;
}

export function createGlobalShutdownChatState(
  conversationId: string,
  current: ShutdownState | null | undefined,
  active: boolean,
  activeCycleToken?: string | null,
  nowIso = new Date().toISOString(),
): ShutdownState {
  const state: ShutdownState = {
    ...(current || {}),
    conversationId,
    isEnabled: false,
    stateUpdatedAt: nowIso,
    pauseReason: active ? "global_shutdown_pending" : "global_shutdown",
    pausedAt: nowIso,
    disableAfterCycle: active,
  };

  if (active) {
    state.status = ACTIVE_STATUS.has(String(current?.status || "")) ? current?.status : "processing";
    state.activeCycleToken = activeCycleToken || current?.activeCycleToken || null;
    if (!current?.activity || ["waiting", "scheduled", "idle", "completed"].includes(current.activity.phase || "")) {
      state.activity = {
        phase: "brain",
        label: "Concluindo ciclo atual",
        detail: "A IA terminará este ciclo e depois ficará desligada neste chat.",
        updatedAt: nowIso,
        cycleId: activeCycleToken || current?.cycleId || undefined,
      };
    }
    return state;
  }

  state.activeCycleToken = null;
  state.scheduledResponseAt = null;
  if (current?.pendingManualResponse) {
    state.status = "needs_manual_response";
    state.activity = current.activity;
  } else if (current?.pendingObjectiveFinalization) {
    state.status = "awaiting_finalization";
    state.activity = current.activity;
  } else {
    state.status = "disabled";
    state.activity = null;
  }
  return state;
}

export function applyDeferredGlobalShutdown<T extends Record<string, any>>(
  current: T,
  patch: Record<string, any>,
  statePatch: Record<string, any>,
  nowIso = new Date().toISOString(),
): { updated: T; shouldDisableConversation: boolean } {
  const updated = { ...current, ...statePatch } as T;
  const terminalPhase = statePatch.activity?.phase || patch.cycleEvent?.phase;
  const terminalStatus = ["idle", "disabled", "failed", "needs_manual_response", "awaiting_finalization"].includes(String(statePatch.status || ""));
  const cycleFinished = ["completed", "failed", "cancelled"].includes(String(terminalPhase || "")) || terminalStatus;
  if (!current.disableAfterCycle || !cycleFinished) {
    return { updated, shouldDisableConversation: false };
  }

  updated.disableAfterCycle = false;
  updated.isEnabled = false;
  updated.activeCycleToken = null;
  updated.pauseReason = "global_shutdown";
  updated.pausedAt = nowIso;
  updated.scheduledResponseAt = null;
  if (!TERMINAL_REVIEW_STATUS.has(String(updated.status || ""))) updated.status = "disabled";
  return { updated, shouldDisableConversation: true };
}
