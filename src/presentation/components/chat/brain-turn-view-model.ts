export type BrainOperationalEvent = {
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

export type BrainTurnStatus = "running" | "completed" | "waiting_human" | "failed" | "cancelled";

export type BrainTurnView = {
  id: string;
  turnId?: string;
  sessionId?: string;
  cycleId?: string;
  startedAt: string;
  finishedAt?: string;
  status: BrainTurnStatus;
  events: BrainOperationalEvent[];
  summary: { actionCount: number; sentCount: number; failedCount: number };
};

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
  turn_completed: "Turno concluído",
  cycle_completed: "Turno concluído",
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
  completed: "Concluído",
  turn_completed: "Concluído",
  cycle_completed: "Concluído",
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
  atria: "Revisando a conversa",
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
  "action_failed_confirmed", "failed_confirmed", "action_dispatch_uncertain", "dispatch_uncertain",
]);
const FAILED_EVENTS = new Set(["cycle_failed", "action_failed_confirmed", "failed_confirmed", "action_dispatch_uncertain", "dispatch_uncertain"]);
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

export function isTerminalBrainTurn(turn: Pick<BrainTurnView, "status">): boolean {
  return turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled";
}

function eventGroupId(event: BrainOperationalEvent): string {
  if (event.turnId) return `turn:${event.turnId}`;
  if (event.sessionId) return `session:${event.sessionId}`;
  if (event.cycleId) return `cycle:${event.cycleId}`;
  return `conversation:${event.conversationId || "unknown"}`;
}

function eventTime(event: BrainOperationalEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyTurn(events: BrainOperationalEvent[]): BrainTurnStatus {
  const latest = events[events.length - 1];
  if (!latest) return "running";
  const eventName = latest.event;
  const status = latest.status || "";
  if (WAITING_EVENTS.has(eventName) || status === "waiting_human" || status === "manual_resolution_required") return "waiting_human";
  if (CANCELLED_EVENTS.has(eventName) || status === "cancelled" || status === "cycle_cancelled") return "cancelled";
  if (FAILED_EVENTS.has(eventName) || FAILED_EVENTS.has(status) || status === "failed" || status === "failed_technical") return "failed";
  if (TERMINAL_EVENTS.has(eventName) || status === "completed" || status === "cycle_completed") return "completed";
  return "running";
}

export function groupBrainTurns(events: BrainOperationalEvent[]): BrainTurnView[] {
  const groups = new Map<string, BrainOperationalEvent[]>();
  for (const event of events) {
    const id = eventGroupId(event);
    const list = groups.get(id) || [];
    list.push(event);
    groups.set(id, list);
  }

  return [...groups.entries()].map(([id, group]) => {
    const sorted = [...group].sort((a, b) => eventTime(a) - eventTime(b) || (a.sequence || 0) - (b.sequence || 0));
    const latest = sorted[sorted.length - 1];
    const first = sorted[0];
    const actionEvents = sorted.filter((item) => ACTION_EVENTS.has(item.event));
    const actionKey = (item: BrainOperationalEvent) => item.actionId
      || String(item.metadata?.actionIndex ?? item.metadata?.action_index ?? `${item.sequence ?? item.timestamp}`);
    const uniqueActions = new Map(actionEvents.map((item) => [actionKey(item), item]));
    const sentActions = new Map(actionEvents.filter((item) => SENT_EVENTS.has(item.event)).map((item) => [actionKey(item), item]));
    const failedActions = new Map(actionEvents.filter((item) => FAILED_EVENTS.has(item.event) || FAILED_EVENTS.has(item.status || "")).map((item) => [actionKey(item), item]));
    return {
      id,
      turnId: first.turnId,
      sessionId: first.sessionId,
      cycleId: first.cycleId,
      startedAt: first.timestamp,
      finishedAt: isTerminalBrainTurn({ status: classifyTurn(sorted) }) ? latest.timestamp : undefined,
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
