export interface AutoPilotConfig {
  isEnabledGlobally: boolean;
  mode?: "automatic"; // 100% Automático direto (semiautomático removido)
  responseDelayMinutes: number; // Padrão: 1 min para testes, 10 min produção
  activationWaitMinutes: number; // Tempo de espera após ativar antes de começar (padrão: 1 min)
  pauseOnPhotoReceived: boolean; // Pausar se o cliente enviar foto
  pauseOnSensitiveContent: boolean; // Pausar se detectar conteúdo bizarro/ofensivo
  handOffAtRaffleStep: boolean; // Pausar e notificar o dono ao atingir o momento da rifa
  typingDelaySecondsPerBalloon: number; // Delay simulando digitação humana (ex: 4s)
  updatedAt: string;
}

export type AutoPilotChatStatus =
  | "idle" // Aguardando mensagem do cliente
  | "activation_wait" // Aguardando 1 minuto inicial após ativação
  | "waiting_delay" // Cliente mandou mensagem, aguardando expirar tempo de espera (debounce)
  | "scheduled" // Estado legado/canônico de espera publicado pelo backend
  | "waiting_debounce" // Alias semântico para waiting_delay
  | "in_queue" // Tempo expirou, está na fila sequencial global aguardando a vez
  | "processing" // Sendo respondido agora pela IA (simulando digitação)
  | "paused_guardrail" // Pausado por foto recebida ou conteúdo estranho
  | "paused_handoff" // Pausado por chegar no momento da rifa (chamar dono)
  | "waiting_human" // Brain não autorizou uma resposta; operador precisa assumir
  | "disabled" // Desativado pelo operador
  | "failed"; // Falha no ciclo do piloto automático

export type AutoPilotActivityPhase =
  | "waiting"
  | "scheduled"
  | "starting"
  | "loading_context"
  | "context"
  | "search"
  | "reanalyzing"
  | "brain"
  | "atria"
  | "sol"
  | "checklist"
  | "validating"
  | "typing"
  | "recording_audio"
  | "sending"
  | "completed"
  | "cancelled"
  | "idle"
  | "failed";

export interface AutoPilotActivity {
  phase: AutoPilotActivityPhase;
  label: string;
  detail?: string;
  currentBalloon?: number;
  totalBalloons?: number;
  updatedAt: string;
  brainThought?: string;
  atriaThought?: string;
  solThought?: string;
  previewResponses?: string[];
  currentResponsePreview?: string;
  countdownSeconds?: number;
  cycleId?: string;
  scheduledResponseAt?: string;
  audioDurationSeconds?: number;
}

export interface AutoPilotCycleEvent {
  cycleId: string;
  conversationId: string;
  sequence: number;
  phase: AutoPilotActivityPhase | string;
  event: string;
  label: string;
  detail?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AutoPilotLastThoughts {
  brainThought?: string;
  atriaThought?: string;
  solThought?: string;
  previewResponses?: string[];
  sentAt?: string;
}

export interface AutoPilotPendingAction {
  conversationId: string;
  conversationName: string;
  contactUsername?: string;
  responses: string[]; // balões de texto ou tags [audio:URL]
  completedChecklistIds?: string[];
  isRaffleStepReached?: boolean;
  createdAt: string;
  reason?: string;
}

export interface AutoPilotChatState {
  conversationId: string;
  isEnabled: boolean;
  enabledAt?: string;
  status: AutoPilotChatStatus;
  lastClientMessageAt?: string;
  scheduledResponseAt?: string;
  pauseReason?: string;
  pausedAt?: string;
  lastResponseSentAt?: string;
  pendingAction?: AutoPilotPendingAction;
  activity?: AutoPilotActivity | null;
  lastThoughts?: AutoPilotLastThoughts | null;
  isSending?: boolean;
  sendingStartedAt?: string | null;
  sendingCycleToken?: string | null;
  activeCycleToken?: string | null;
  cycleId?: string | null;
  cycleEvents?: AutoPilotCycleEvent[];
  lastError?: string;
  stateUpdatedAt?: string;
}

export interface AutoPilotQueueItem {
  conversationId: string;
  conversationName: string;
  contactUsername?: string;
  scheduledAt: string;
  priorityTimestamp: number;
}
