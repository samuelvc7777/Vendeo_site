export type BrainOperationalEvent = {
  id?: string | number;
  turnId?: string;
  sessionId?: string;
  cycleId?: string;
  actionId?: string;
  decisionId?: string;
  conversationId?: string;
  sequence?: number;
  event: string;
  status?: string;
  phase?: string;
  label?: string;
  detail?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type BrainDecisionAction = {
  id: string;
  decisionId?: string;
  turnId?: string;
  actionIndex: number;
  actionType: string;
  status: string;
  providerMessageId?: string | null;
  attempts?: number;
  deliveryStatus?: string | null;
};

export type DeliveryUiState = "idle" | "pending" | "sending" | "partially_sent" | "fully_sent" | "failed" | "uncertain";

export type DeliveryProjection = {
  status: DeliveryUiState;
  actionCount: number;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
  uncertainCount: number;
  sendingCount: number;
  statusLabel: string;
  label: string;
  showSuccess: boolean;
};

export type BrainTurnStatus = "running" | "completed" | "waiting_human" | "failed" | "cancelled" | "stale";

export type BrainTurnView = {
  id: string;
  turnId?: string;
  sessionId?: string;
  cycleId?: string;
  provisional: boolean;
  startedAt: string;
  finishedAt?: string;
  status: BrainTurnStatus;
  events: BrainOperationalEvent[];
  summary: { actionCount: number; sentCount: number; failedCount: number };
  deliveryActions?: BrainDecisionAction[];
  delivery?: DeliveryProjection;
};

export function deriveDeliveryProjection(
  actions: BrainDecisionAction[],
  context: { deliveryStatus?: string | null; cycleStatus?: string | null; sentBalloonsCount?: number } = {},
): DeliveryProjection {
  const actionCount = actions.length;
  let sentCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let uncertainCount = 0;
  let sendingCount = 0;
  const decisionDeliveryStatus = context.deliveryStatus?.toLowerCase() || "";

  for (const action of actions) {
    const status = action.status.toLowerCase();
    if (status === "sent") {
      if (action.providerMessageId?.trim()) sentCount += 1;
      else uncertainCount += 1;
    } else if (status === "failed_confirmed" || status === "failed") {
      failedCount += 1;
    } else if (status === "dispatch_uncertain" || status === "uncertain") {
      uncertainCount += 1;
    } else if (status === "sending") {
      sendingCount += 1;
    } else {
      pendingCount += 1;
      if (status === "failed_retryable") sendingCount += 1;
    }
  }

  let status: DeliveryUiState = "idle";
  if (actionCount > 0) {
    if (uncertainCount > 0 || decisionDeliveryStatus === "dispatch_uncertain") status = "uncertain";
    else if (failedCount > 0 || decisionDeliveryStatus === "delivery_failed") status = "failed";
    else if (sentCount === actionCount && (!decisionDeliveryStatus || decisionDeliveryStatus === "fully_sent")) status = "fully_sent";
    else if (decisionDeliveryStatus === "delivery_pending") status = sendingCount > 0 ? "sending" : "pending";
    else if (sentCount > 0 || decisionDeliveryStatus === "partially_sent") status = "partially_sent";
    else if (sendingCount > 0) status = "sending";
    else status = "pending";
  }

  const statusLabel = status === "fully_sent"
    ? "Envio concluído"
    : status === "partially_sent"
    ? "Envio parcial"
    : status === "failed"
    ? "Falha no envio"
    : status === "uncertain"
    ? "Confirmação de envio pendente"
    : status === "sending"
    ? "Tentando enviar"
    : status === "pending"
    ? "Envio pendente"
    : "Envio ainda não iniciado";
  const label = actionCount > 0
    ? `${sentCount} de ${actionCount} mensagens enviadas`
    : "Envio ainda não iniciado";

  return {
    status,
    actionCount,
    sentCount,
    pendingCount,
    failedCount,
    uncertainCount,
    sendingCount,
    statusLabel,
    label,
    showSuccess: status === "fully_sent" && actionCount > 0,
  };
}

export function attachDeliveryActionsToTurns(
  turns: BrainTurnView[],
  actions: BrainDecisionAction[],
): BrainTurnView[] {
  return turns.map((turn) => {
    const decisionIds = new Set(turn.events.flatMap((event) => event.decisionId ? [event.decisionId] : []));
    const deliveryActions = actions.filter((action) =>
      (turn.turnId && action.turnId === turn.turnId)
      || (action.decisionId && decisionIds.has(action.decisionId))
    ).sort((left, right) => left.actionIndex - right.actionIndex);
    const decisionStatuses = new Set(deliveryActions.map((action) => action.deliveryStatus?.toLowerCase()).filter(Boolean));
    const deliveryStatus = decisionStatuses.has("dispatch_uncertain")
      ? "dispatch_uncertain"
      : decisionStatuses.has("delivery_failed")
      ? "delivery_failed"
      : decisionStatuses.has("delivery_pending")
      ? "delivery_pending"
      : decisionStatuses.has("partially_sent")
      ? "partially_sent"
      : decisionStatuses.has("fully_sent")
      ? "fully_sent"
      : null;
    const delivery = deriveDeliveryProjection(deliveryActions, { deliveryStatus });
    return {
      ...turn,
      deliveryActions,
      delivery,
      summary: {
        actionCount: delivery.actionCount,
        sentCount: delivery.sentCount,
        failedCount: delivery.failedCount,
      },
    };
  });
}

const EVENT_LABELS: Record<string, string> = {
  turn_started: "Turno iniciado",
  brain_started: "Brain iniciou",
  agent_wait_started: "Brain analisando a resposta",
  context_loaded: "Contexto carregado",
  brain_context_loaded: "Contexto carregado",
  brain_memory: "Memórias consultadas",
  brain_decision: "Decisão formulada",
  decision_persisted: "Decisão registrada",
  response_ready: "Resposta pronta",
  manual_resolution_required: "Brain precisa de uma informação",
  manual_resolution_received: "Informação recebida · Brain retomando",
  manual_resolution: "Resolução manual",
  action_sending: "Enviando mensagem",
  action_sent: "Mensagem enviada",
  action_cancelled: "Ação cancelada",
  action_failed_retryable: "Falha no envio · nova tentativa programada",
  action_failed_confirmed: "Falha confirmada no envio",
  failed_confirmed: "Falha confirmada no envio",
  action_dispatch_uncertain: "Confirmação de envio pendente",
  dispatch_uncertain: "Confirmação de envio pendente",
  turn_completed: "Processamento do Brain concluído",
  cycle_completed: "Processamento do Brain concluído",
  fully_sent: "Todas as mensagens enviadas",
  phase_scheduled: "Próxima análise agendada",
  toggle_immediate_started: "Iniciando análise",
  cycle_cancelled: "Turno cancelado",
  cycle_failed: "Turno com erro",
  completed: "Turno concluído",
  waiting_human: "Aguardando operador",
  brain_running: "Brain processando",
  processing: "Processando",
  idle: "Aguardando nova mensagem",
};

const STATUS_LABELS: Record<string, string> = {
  waiting_human: "Aguardando operador",
  brain_running: "Brain processando",
  processing: "Processando",
  executing: "Enviando mensagem",
  decision_persisted: "Decisão registrada",
  completed: "Brain concluído",
  turn_completed: "Brain concluído",
  cycle_completed: "Brain concluído",
  failed: "Com erro",
  failed_technical: "Com erro",
  failed_confirmed: "Falha confirmada",
  action_dispatch_uncertain: "Envio pendente de confirmação",
  dispatch_uncertain: "Envio pendente de confirmação",
  cancelled: "Cancelado",
  cycle_cancelled: "Cancelado",
  idle: "Aguardando nova mensagem",
  disabled: "IA desligada",
  collecting: "Carregando contexto",
  active: "Em andamento",
  stale: "Atividade incompleta antiga",
};

const PHASE_LABELS: Record<string, string> = {
  waiting: "Aguardando",
  scheduled: "Programado",
  starting: "Iniciando",
  loading_context: "Carregando contexto",
  context: "Preparando contexto",
  search: "Consultando informações",
  reanalyzing: "Revisando a resposta",
  brain: "Brain processando",
  sol: "Preparando a resposta",
  checklist: "Conferindo a resposta",
  validating: "Validando a ação",
  typing: "Preparando mensagem",
  recording_audio: "Preparando áudio",
  sending: "Enviando mensagem",
  completed: "Concluído",
  cancelled: "Cancelado",
  idle: "Aguardando nova mensagem",
  failed: "Com erro",
};

const TERMINAL_EVENTS = new Set([
  "turn_completed", "cycle_completed", "cycle_cancelled", "cycle_failed",
]);
const FAILED_EVENTS = new Set(["cycle_failed"]);
const FAILED_ACTION_EVENTS = new Set(["action_failed_confirmed", "failed_confirmed"]);
const CANCELLED_EVENTS = new Set(["cycle_cancelled"]);
const WAITING_EVENTS = new Set(["manual_resolution_required", "waiting_human"]);
const SENT_EVENTS = new Set(["action_sent", "sent"]);
const ACTION_EVENTS = new Set([
  "action_sending", "action_sent", "action_cancelled", "action_failed_retryable",
  "action_failed_confirmed", "failed_confirmed", "action_dispatch_uncertain", "dispatch_uncertain",
]);

export function formatBrainStatus(status: string | null | undefined): string {
  if (!status) return "Estado atualizado";
  return STATUS_LABELS[status] || "Estado atualizado";
}

export function formatBrainEvent(event: string | null | undefined): string {
  if (!event) return "Evento do sistema";
  return EVENT_LABELS[event] || "Evento do sistema";
}

export function formatBrainPhase(phase: string | null | undefined): string {
  if (!phase) return "Etapa atualizada";
  return PHASE_LABELS[phase] || "Etapa atualizada";
}

export function formatVisibleBrainIdentity(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\bAtria[- ]Dawn(?:[- ]Preview)?(?:\s*\(Atria-ASI\))?/gi, "Brain")
    .replace(/\bAtria\b/gi, "Brain");
}

export function isTerminalBrainTurn(turn: Pick<BrainTurnView, "status">): boolean {
  return turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled";
}

function eventTime(event: BrainOperationalEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

const PROVISIONAL_EVENTS = new Set(["toggle_immediate_started", "starting"]);
const PROGRESS_EVENTS = new Set([
  "cycle_claimed", "turn_started", "brain_started", "agent_wait_started", "context_loaded",
  "brain_context_loaded", "brain_late", "brain_memory", "brain_decision", "decision_persisted",
  "response_ready", "manual_resolution_required", "manual_resolution_received", "action_sending",
  "action_sent", "action_cancelled", "action_failed_retryable", "action_failed_confirmed",
  "action_dispatch_uncertain", "manual_delivery_authorized", "cycle_completed", "turn_completed",
  "cycle_failed", "cycle_cancelled",
]);
export const PROVISIONAL_BRAIN_TURN_TTL_MS = 20_000;
export const ACTIVE_BRAIN_TURN_STALE_AFTER_MS = 90_000;

export type BrainTurnRuntimeState = {
  activeCycleToken?: string | null;
  now?: number | string | Date;
};

function terminalStatusForEvent(event: BrainOperationalEvent): BrainTurnStatus | null {
  const status = event.status || "";
  if (CANCELLED_EVENTS.has(event.event) || status === "cancelled" || status === "cycle_cancelled") return "cancelled";
  if (FAILED_EVENTS.has(event.event) || FAILED_EVENTS.has(status) || status === "failed" || status === "failed_technical") return "failed";
  if (TERMINAL_EVENTS.has(event.event) || status === "completed" || status === "cycle_completed") return "completed";
  return null;
}

function lastTerminalEvent(events: BrainOperationalEvent[]): BrainOperationalEvent | undefined {
  return [...events].reverse().find((event) => terminalStatusForEvent(event) !== null);
}

function classifyTurn(events: BrainOperationalEvent[]): BrainTurnStatus {
  const terminal = lastTerminalEvent(events);
  if (terminal) return terminalStatusForEvent(terminal)!;
  const latest = events[events.length - 1];
  if (!latest) return "running";
  const status = latest.status || "";
  if (WAITING_EVENTS.has(latest.event) || status === "waiting_human" || status === "manual_resolution_required") return "waiting_human";
  return "running";
}

export function getEffectiveBrainTurnEvent(turn: BrainTurnView): BrainOperationalEvent | undefined {
  return lastTerminalEvent(turn.events) || turn.events[turn.events.length - 1];
}

function isProvisionalEvent(event: BrainOperationalEvent): boolean {
  return PROVISIONAL_EVENTS.has(event.event) || event.phase === "starting";
}

function hasOperationalProgress(turn: BrainTurnView): boolean {
  return turn.events.some((event) => PROGRESS_EVENTS.has(event.event)
    || WAITING_EVENTS.has(event.event)
    || event.status === "waiting_human");
}

function turnActivityTime(turn: BrainTurnView): number {
  return Math.max(0, ...turn.events.map(eventTime));
}

function runtimeNow(runtime: BrainTurnRuntimeState): number {
  const value = runtime.now instanceof Date ? runtime.now.getTime() : runtime.now;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function turnMatchesCycleToken(turn: BrainTurnView, token: string): boolean {
  return turn.cycleId === token || turn.turnId === token || turn.events.some((event) => event.cycleId === token);
}

function isSupersededBrainTurn(turn: BrainTurnView, turns: BrainTurnView[]): boolean {
  const startedAt = eventTime({ event: "", timestamp: turn.startedAt });
  return turns.some((candidate) => candidate.id !== turn.id && candidate.turnId
    && eventTime({ event: "", timestamp: candidate.startedAt }) > startedAt);
}

export function selectActiveBrainTurn(
  turns: BrainTurnView[],
  runtime: BrainTurnRuntimeState = {},
): BrainTurnView | null {
  const now = runtimeNow(runtime);
  const token = runtime.activeCycleToken?.trim();
  if (token) {
    const canonical = turns.find((turn) => turnMatchesCycleToken(turn, token)
      && !isTerminalBrainTurn(turn)
      && (hasOperationalProgress(turn) || turn.provisional));
    const canonicalAge = canonical ? now - turnActivityTime(canonical) : 0;
    if (canonical && (!canonical.provisional || (canonicalAge >= 0 && canonicalAge <= PROVISIONAL_BRAIN_TURN_TTL_MS))) {
      return canonical;
    }
  }

  const candidates = turns.filter((turn) => {
    if (isTerminalBrainTurn(turn) || isSupersededBrainTurn(turn, turns)) return false;
    const age = now - turnActivityTime(turn);
    if (turn.status === "waiting_human") return true;
    if (turn.provisional && !hasOperationalProgress(turn)) return age >= 0 && age <= PROVISIONAL_BRAIN_TURN_TTL_MS;
    return hasOperationalProgress(turn) && age >= 0 && age <= ACTIVE_BRAIN_TURN_STALE_AFTER_MS;
  });
  candidates.sort((left, right) => turnActivityTime(right) - turnActivityTime(left));
  return candidates[0] || null;
}

export function getVisibleBrainTurns(
  turns: BrainTurnView[],
  runtime: BrainTurnRuntimeState = {},
): BrainTurnView[] {
  const active = selectActiveBrainTurn(turns, runtime);
  return turns.flatMap((turn) => {
    if (isTerminalBrainTurn(turn) || turn.id === active?.id) return [turn];
    if (!turn.turnId) return [];
    return [{ ...turn, status: "stale" as const }];
  });
}

export function groupBrainTurns(events: BrainOperationalEvent[]): BrainTurnView[] {
  const turnByCycle = new Map<string, string>();
  for (const event of events) {
    if (event.turnId && event.cycleId && !turnByCycle.has(event.cycleId)) {
      turnByCycle.set(event.cycleId, event.turnId);
    }
  }
  const groups = new Map<string, BrainOperationalEvent[]>();
  for (const [index, event] of events.entries()) {
    const canonicalTurnId = event.turnId || (event.cycleId ? turnByCycle.get(event.cycleId) : undefined);
    const fallbackId = event.id ?? (event.sequence && event.sequence !== 0
      ? event.sequence
      : `${event.timestamp}:${event.event}:${index}`);
    const id = canonicalTurnId
      ? `turn:${canonicalTurnId}`
      : event.cycleId
      ? `cycle:${event.cycleId}`
      : `event:${event.conversationId || "unknown"}:${fallbackId}`;
    const list = groups.get(id) || [];
    list.push(event);
    groups.set(id, list);
  }

  return [...groups.entries()].map(([id, group]) => {
    const sorted = [...group].sort((a, b) => eventTime(a) - eventTime(b) || (a.sequence || 0) - (b.sequence || 0));
    const first = sorted[0];
    const terminal = lastTerminalEvent(sorted);
    const actionEvents = sorted.filter((item) => ACTION_EVENTS.has(item.event));
    const actionKey = (item: BrainOperationalEvent) => item.actionId
      || String(item.metadata?.actionIndex ?? item.metadata?.action_index ?? `${item.sequence ?? item.timestamp}`);
    const uniqueActions = new Map(actionEvents.map((item) => [actionKey(item), item]));
    const sentActions = new Map(actionEvents.filter((item) => SENT_EVENTS.has(item.event)).map((item) => [actionKey(item), item]));
    const failedActions = new Map(actionEvents.filter((item) => FAILED_ACTION_EVENTS.has(item.event) || FAILED_ACTION_EVENTS.has(item.status || "")).map((item) => [actionKey(item), item]));
    return {
      id,
      turnId: sorted.find((item) => item.turnId)?.turnId
        || (sorted.find((item) => item.cycleId)?.cycleId
          ? turnByCycle.get(sorted.find((item) => item.cycleId)!.cycleId!)
          : undefined),
      sessionId: sorted.find((item) => item.sessionId)?.sessionId,
      cycleId: sorted.find((item) => item.cycleId)?.cycleId,
      provisional: sorted.every(isProvisionalEvent),
      startedAt: first.timestamp,
      finishedAt: terminal?.timestamp,
      status: classifyTurn(sorted),
      events: sorted,
      summary: { actionCount: uniqueActions.size, sentCount: sentActions.size, failedCount: failedActions.size },
    };
  }).sort((a, b) => eventTime(b.events[b.events.length - 1]) - eventTime(a.events[a.events.length - 1]));
}

export type BrainTurnUiState = {
  activeTurnId: string | null;
  expandedTurnIds: Set<string>;
  manuallyExpandedTurnIds: Set<string>;
};

export type BrainTurnUiAction =
  | { type: "activate"; turnId: string | null }
  | { type: "toggle"; turnId: string }
  | { type: "collapse_finished"; turnId: string };

export const initialBrainTurnUiState: BrainTurnUiState = {
  activeTurnId: null,
  expandedTurnIds: new Set(),
  manuallyExpandedTurnIds: new Set(),
};

export function brainTurnUiReducer(state: BrainTurnUiState, action: BrainTurnUiAction): BrainTurnUiState {
  if (action.type === "toggle") {
    const expanded = new Set(state.expandedTurnIds);
    const manual = new Set(state.manuallyExpandedTurnIds);
    if (expanded.has(action.turnId)) {
      expanded.delete(action.turnId);
      manual.delete(action.turnId);
    } else {
      expanded.add(action.turnId);
      manual.add(action.turnId);
    }
    return { ...state, expandedTurnIds: expanded, manuallyExpandedTurnIds: manual };
  }

  if (action.type === "collapse_finished") {
    if (state.manuallyExpandedTurnIds.has(action.turnId)) return state;
    const expanded = new Set(state.expandedTurnIds);
    expanded.delete(action.turnId);
    return { ...state, expandedTurnIds: expanded };
  }

  if (action.turnId === null) return { ...state, activeTurnId: null };

  const expanded = new Set(state.expandedTurnIds);
  if (state.activeTurnId && state.activeTurnId !== action.turnId && !state.manuallyExpandedTurnIds.has(state.activeTurnId)) {
    expanded.delete(state.activeTurnId);
  }
  if (action.turnId) expanded.add(action.turnId);
  return { ...state, activeTurnId: action.turnId, expandedTurnIds: expanded };
}
