import type { AutoPilotChatState } from "./AutoPilot.ts";

/** Um status antigo sem lote pendente não deve aparecer como aviso manual. */
export function hasPendingManualResponse(state: AutoPilotChatState | null | undefined): boolean {
  return state?.status === "needs_manual_response" && Boolean(
    state.pendingManualResponse &&
    Array.isArray(state.pendingManualResponse.inboundMessageIds) &&
    state.pendingManualResponse.inboundMessageIds.length > 0,
  );
}

export function hasConfirmedLatestResponse(state: AutoPilotChatState): boolean {
  const sentAtMs = state.lastThoughts?.sentAt ? Date.parse(state.lastThoughts.sentAt) : 0;
  const lastClientMessageMs = state.lastClientMessageAt ? Date.parse(state.lastClientMessageAt) : 0;
  return Number.isFinite(sentAtMs) && sentAtMs > 0 &&
    (!Number.isFinite(lastClientMessageMs) || lastClientMessageMs <= 0 || sentAtMs >= lastClientMessageMs);
}

export function isAutoPilotScheduledStateStale(state: AutoPilotChatState, nowMs = Date.now()): boolean {
  const isWaiting = state.activity?.phase === "waiting" ||
    state.status === "waiting_delay" ||
    state.status === "waiting_debounce" ||
    state.status === "scheduled";
  const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
  return isWaiting && Number.isFinite(scheduledMs) && scheduledMs > 0 && nowMs - scheduledMs > 120_000;
}

export function getAutoPilotStatusCopy(state: AutoPilotChatState, nowMs = Date.now()) {
  const hasConfirmedDelivery = hasConfirmedLatestResponse(state);
  if (state.status === "awaiting_finalization" && state.pendingObjectiveFinalization) {
    return {
      title: "Objetivos finais concluídos",
      detail: `A IA concluiu os objetivos de “${state.pendingObjectiveFinalization.stageName}”. Abra o chat para revisar e finalizar.`,
    };
  }
  if (hasPendingManualResponse(state)) {
    return {
      title: "Aguardando sua resposta",
      detail: state.pendingManualResponse?.reason || "A IA reteve o envio porque não encontrou uma resposta segura.",
    };
  }
  if (state.status === "failed") {
    return {
      title: "Falha no Brain",
      detail: state.lastError || "O ciclo falhou antes de confirmar o envio da resposta.",
    };
  }
  if (state.status === "paused_guardrail") {
    return {
      title: "IA pausada por erro",
      detail: state.pauseReason || "O provedor de IA não respondeu. Revise e retome o piloto.",
    };
  }
  if (state.status === "paused_handoff") {
    return {
      title: "IA pausada para intervenção",
      detail: state.pauseReason || "A conversa precisa de uma ação manual.",
    };
  }
  const actUpdatedAt = state.activity?.updatedAt || state.stateUpdatedAt;
  const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
  const isWaiting = state.activity?.phase === "waiting" || state.status === "waiting_delay" || state.status === "waiting_debounce" || state.status === "scheduled";
  const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
  const isStaleScheduledState = isAutoPilotScheduledStateStale(state, nowMs);
  const isCompleted = state.activity?.phase === "completed";
  const isStale = isCompleted
    ? false
    : isWaiting
    ? (scheduledMs > 0 && nowMs - scheduledMs > 120_000)
    : (updatedAtMs > 0 && nowMs - updatedAtMs > 90_000);
  if (state.activity && !isStale) {
    if (isCompleted && !hasConfirmedDelivery) {
      return {
        title: "Brain concluiu o ciclo",
        detail: "Não há confirmação de envio desta resposta.",
      };
    }
    return {
      title: state.activity.label,
      detail: state.activity.detail || "A IA está trabalhando nesta conversa.",
    };
  }
  if (state.status === "activation_wait") {
    return {
      title: "IA preparando o atendimento",
      detail: "Aguardando o período de segurança após a ativação.",
    };
  }
  if (isStaleScheduledState) {
    return {
      title: "Ciclo sem execução ativa",
      detail: "O horário programado venceu sem atualização do Brain. Nenhuma resposta está sendo enviada; use “Enviar agora” para iniciar uma nova tentativa.",
    };
  }
  if (state.status === "waiting_delay" || state.status === "waiting_debounce" || state.status === "scheduled") {
    return {
      title: "IA aguardando tempo pra agir",
      detail: "Esperando o tempo configurado antes de analisar e responder.",
    };
  }
  if (state.status === "in_queue") {
    return {
      title: "IA na fila",
      detail: "Esta conversa será processada em seguida.",
    };
  }
  if (scheduledMs > 0 && nowMs >= scheduledMs) {
    return {
      title: "IA na fila de resposta",
      detail: "Tempo programado concluído. Processando resposta.",
    };
  }
  if (hasConfirmedDelivery) {
    return {
      title: "Última resposta enviada",
      detail: "Aguardando nova mensagem do cliente para iniciar novo raciocínio.",
    };
  }
  if (state.lastThoughts?.brainThought || state.lastThoughts?.atriaThought || state.lastThoughts?.solThought) {
    return {
      title: "Último raciocínio do Brain",
      detail: "Não há confirmação de envio desta resposta.",
    };
  }
  return {
    title: "Piloto Automático ativo",
    detail: "Aguardando nova mensagem do cliente para iniciar raciocínio.",
  };
}
