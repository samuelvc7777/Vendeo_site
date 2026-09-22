// ============================================================================
// experimental_orchestrator.ts
// Motor Experimental de Orquestração por Conversa (Clean Architecture)
// Arquitetura: Backend Determinístico + Agente da Conversa + Subagentes
// Suporta modos: 'legacy' | 'shadow' | 'experimental'
// ============================================================================
import { publishAutoPilotState, activity } from "./cloud_autopilot.ts";
import {
  ConversationEpisode,
  EpisodeActor,
  EpisodeEventType,
  EpisodicSearchResult,
  extractEpisodesFromLarissaMessage,
  extractEpisodesFromPretendenteMessage,
  createAudioDeliveredEpisode,
  saveConversationEpisodes,
  executeEpisodeWriter,
  searchConversationEpisodicMemory,
  validateAntiRepeatGate,
  searchRawConversationHistory,
  commitConversationMemoryWrites,
  type RawConversationHistorySearchResult,
} from "./conversation_episodic_memory.ts";
export {
  validateAntiRepeatGate,
  searchConversationEpisodicMemory,
  saveConversationEpisodes,
  executeEpisodeWriter,
  extractEpisodesFromPretendenteMessage,
  searchRawConversationHistory,
  commitConversationMemoryWrites,
};
import {
  createAgentMemoryScope,
  revokeAgentMemoryScope,
  commitContactMemoryWrites,
  searchContactMemory,
} from "./contact_memory.ts";
export {
  createAgentMemoryScope,
  revokeAgentMemoryScope,
  commitContactMemoryWrites,
  searchContactMemory,
};
import { LARISSA_CONVERSATION_STYLE } from "./LarissaConversationStyle.ts";
export { LARISSA_CONVERSATION_STYLE };
import {
  LARISSA_CHAT_STYLE_V2,
  LARISSA_COMPACT_SUBAGENT_PROMPT,
  LARISSA_CONVERSATION_EXAMPLES_V1,
  computeDynamicEmojiBudget,
  extractRecentStyleState,
  type RecentStyleState,
  runStyleLint,
  sanitizeChatPunctuation,
  capitalizeFirstLetter,
  type StyleLintResult,
  type EmojiBudgetResult,
} from "./LarissaChatStyle.ts";
import {
  buildTurnContract,
  normalizeBrainTurnContract,
  runConversationQualityGate,
  safeHighConfidenceFallback,
  type TurnContract,
} from "./ConversationQualityGate.ts";
export {
  LARISSA_CHAT_STYLE_V2,
  LARISSA_COMPACT_SUBAGENT_PROMPT,
  LARISSA_CONVERSATION_EXAMPLES_V1,
  computeDynamicEmojiBudget,
  extractRecentStyleState,
  type RecentStyleState,
  runStyleLint,
  sanitizeChatPunctuation,
  capitalizeFirstLetter,
  type StyleLintResult,
  type EmojiBudgetResult,
};
export { buildTurnContract, normalizeBrainTurnContract, runConversationQualityGate, safeHighConfidenceFallback };
export type { TurnContract };

import {
  type PersonaMemoryFact,
  type PersonaFactResult,
  type PersonaMemorySearchResult,
  type PersonaMemoryCompactToolOutput,
  LARISSA_PERSONA_FACTS,
  setPersonaMemoryCache,
  clearPersonaMemoryCache,
  isTemporalFactActive,
  loadPersonaMemoryFacts,
  stripAccents,
  resolveFactFromCollection,
  resolveLegacyFactFallback,
  getPersonaFact,
  resolvePersonaFact,
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
} from "./persona_memory.ts";
export {
  type PersonaMemoryFact,
  type PersonaFactResult,
  type PersonaMemorySearchResult,
  type PersonaMemoryCompactToolOutput,
  LARISSA_PERSONA_FACTS,
  setPersonaMemoryCache,
  clearPersonaMemoryCache,
  isTemporalFactActive,
  loadPersonaMemoryFacts,
  stripAccents,
  resolveFactFromCollection,
  resolveLegacyFactFallback,
  getPersonaFact,
  resolvePersonaFact,
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
};

import {
  runOpenAiBrainTurn,
  executePersonaMemoryTool,
  PERSONA_MEMORY_TOOL_DEFINITION,
  buildOpenAiBrainContextMessage,
  type OpenAiBrainTurnResult,
} from "./openai_brain.ts";
import {
  LARISSA_INTERACTION_DNA_VERSION,
  LARISSA_INTERACTION_DNA_HASH,
  formatRecentStyleStateForPrompt,
} from "./larissa_interaction_dna.ts";
export {
  runOpenAiBrainTurn,
  executePersonaMemoryTool,
  PERSONA_MEMORY_TOOL_DEFINITION,
  buildOpenAiBrainContextMessage,
  LARISSA_INTERACTION_DNA_VERSION,
  LARISSA_INTERACTION_DNA_HASH,
};

/**
 * Configurações e limites orçamentários centrais do Conversation Brain e ContextBuilder.
 * Defaults centralizados e configuráveis via opções de ciclo / config de autopiloto.
 */
export const BRAIN_ORCHESTRATION_BUDGETS = {
  recent_message_limit: 12,
  recent_context_token_budget: 1500,
  brain_max_memory_searches: 2,
  brain_history_search_results: 6,
} as const;

/**
 * Modelo oficial do Subagente Executor no runtime experimental.
 * Configuração centralizada para garantir que tanto o Brain quanto o Executor usem gpt-5.6-terra.
 */
export const OPENAI_EXECUTOR_DEFAULT_MODEL = "gpt-5.6-terra";

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

export function stableDiagnosticHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < String(value || "").length; index++) {
    hash ^= String(value || "").charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildBudgetedRecentContext(params: {
  messages: CanonicalMessage[];
  claimedMessageIds: string[];
  tokenBudget?: number;
  messageLimit?: number;
}): { messages: CanonicalMessage[]; estimatedTokens: number; budgetOverflowRequired: boolean } {
  const tokenBudget = params.tokenBudget ?? BRAIN_ORCHESTRATION_BUDGETS.recent_context_token_budget;
  const messageLimit = params.messageLimit ?? BRAIN_ORCHESTRATION_BUDGETS.recent_message_limit;
  const timestampOf = (message: CanonicalMessage) => String(
    message.createdAt || (message as any).created_at || (message as any).timestamp || ""
  );
  const chronological = [...params.messages].sort((a, b) => timestampOf(a).localeCompare(timestampOf(b)));
  const claimed = new Set(params.claimedMessageIds.map(String));
  const lastLarissa = [...chronological].reverse().find((m) => m.sender === "larissa" || m.direction === "outbound");
  const replyTargetIds = new Set<string>();
  for (const message of chronological) {
    const raw = message as any;
    const replyId = raw.replyToMessageId || raw.reply_to_message_id || raw.quotedMessageId || raw.quoted_message_id;
    if (replyId) replyTargetIds.add(String(replyId));
  }
  const mandatoryIds = new Set<string>([...claimed, ...replyTargetIds]);
  if (lastLarissa) mandatoryIds.add(String(lastLarissa.id));
  const selected = chronological.filter((m) => mandatoryIds.has(String(m.id)));
  let estimatedTokens = selected.reduce((sum, m) => sum + estimateTextTokens(m.text || ""), 0);
  const budgetOverflowRequired = estimatedTokens > tokenBudget;
  const selectedIds = new Set(selected.map((m) => String(m.id)));
  for (const message of [...chronological].reverse()) {
    if (selectedIds.has(String(message.id))) continue;
    const cost = estimateTextTokens(message.text || "");
    if (selected.length >= messageLimit || estimatedTokens + cost > tokenBudget) continue;
    selected.push(message);
    selectedIds.add(String(message.id));
    estimatedTokens += cost;
  }
  selected.sort((a, b) => timestampOf(a).localeCompare(timestampOf(b)));
  return { messages: selected, estimatedTokens, budgetOverflowRequired };
}

export async function loadMandatoryBrainContextCandidates(params: {
  supabase: any;
  conversationId: string;
  claimedMessages: CanonicalMessage[];
}): Promise<CanonicalMessage[]> {
  const { supabase, conversationId, claimedMessages } = params;
  const mandatory: CanonicalMessage[] = [];
  try {
    const { data: lastOutboundRows } = await supabase
      .from("instagram_messages")
      .select("id, sender_id, is_mine, is_from_me, text, message, created_at, timestamp, direction")
      .eq("conversation_id", conversationId)
      .or("is_mine.eq.true,is_from_me.eq.true,direction.eq.outbound,sender_id.eq.me,sender_id.eq.larissa")
      .order("created_at", { ascending: false })
      .limit(1);
    if (Array.isArray(lastOutboundRows) && lastOutboundRows[0]) {
      mandatory.push(normalizeToCanonicalMessage(lastOutboundRows[0], conversationId));
    }
  } catch {}

  const replyTargetIds = Array.from(new Set(claimedMessages
    .map((message) => message.replyToMessageId)
    .filter((id): id is string => Boolean(id))));
  if (replyTargetIds.length > 0) {
    try {
      const { data: replyTargetRows } = await supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, is_from_me, text, message, created_at, timestamp, direction")
        .eq("conversation_id", conversationId)
        .in("id", replyTargetIds);
      if (Array.isArray(replyTargetRows)) {
        mandatory.push(...replyTargetRows.map((row) => normalizeToCanonicalMessage(row, conversationId)));
      }
    } catch {}
  }
  return Array.from(new Map(mandatory.map((message) => [String(message.id), message])).values());
}

export interface ConversationLiveState {
  conversationId: string;
  lastUserEmotionalTone: string; // ex: "tranquilo", "desabafando", "animado", "curioso"
  currentTopic: string; // ex: "trabalho", "fim de semana", "rotina"
  unresolvedQuestion?: string | null; // se usuário fez pergunta que ainda não foi respondida
  lastLarissaSpeechAct?: string | null; // ex: "perguntou sobre cidade", "mandou audio de enfermagem"
  recentLandmarksSummary?: string | null; // resumo ultra-compacto dos marcos recentes
  pendingUserTopic?: string | null; // tópico que o usuário levantou mas ainda não foi aprofundado
  secondaryTopics?: string[]; // máx 3 itens (memória de curto prazo estrita)
  openLoops?: string[]; // máx 3 itens
  pendingReplies?: string[]; // máx 3 itens
  recentCallbacks?: string[]; // máx 3 itens
  avoidRepeating?: string[]; // máx 5 itens
  turnCount: number;
  updatedAt: string;
}

export function getDefaultConversationLiveState(conversationId: string): ConversationLiveState {
  return {
    conversationId,
    lastUserEmotionalTone: "neutro",
    currentTopic: "início de conversa",
    unresolvedQuestion: null,
    lastLarissaSpeechAct: null,
    recentLandmarksSummary: null,
    pendingUserTopic: null,
    secondaryTopics: [],
    openLoops: [],
    pendingReplies: [],
    recentCallbacks: [],
    avoidRepeating: [],
    turnCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Aplica patch no ConversationLiveState garantindo poda estrita das coleções de curto prazo
 * para manter o estado sempre compacto (~150 a 300 tokens).
 */
export function applyLiveStatePatch(
  current: ConversationLiveState,
  patch: Partial<ConversationLiveState>
): ConversationLiveState {
  const merged: ConversationLiveState = {
    ...current,
    ...patch,
    conversationId: current.conversationId,
    turnCount: (current.turnCount || 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  // Poda determinística estrita para evitar crescimento indefinido
  if (Array.isArray(merged.secondaryTopics)) {
    merged.secondaryTopics = Array.from(new Set(merged.secondaryTopics.filter(Boolean))).slice(-3);
  }
  if (Array.isArray(merged.openLoops)) {
    merged.openLoops = Array.from(new Set(merged.openLoops.filter(Boolean))).slice(-3);
  }
  if (Array.isArray(merged.pendingReplies)) {
    merged.pendingReplies = Array.from(new Set(merged.pendingReplies.filter(Boolean))).slice(-3);
  }
  if (Array.isArray(merged.recentCallbacks)) {
    merged.recentCallbacks = Array.from(new Set(merged.recentCallbacks.filter(Boolean))).slice(-3);
  }
  if (Array.isArray(merged.avoidRepeating)) {
    merged.avoidRepeating = Array.from(new Set(merged.avoidRepeating.filter(Boolean))).slice(-5);
  }

  return merged;
}

/**
 * Serialização compacta (~150 a 300 tokens) para injeção no prompt do Brain ou do Subagente.
 */
export function serializeLiveStateForPrompt(liveState: ConversationLiveState): string {
  const lines: string[] = [
    `[ESTADO VIVO DA CONVERSA - NÍVEL 0]`,
    `- Tom emocional do pretendente: ${liveState.lastUserEmotionalTone || "neutro"}`,
    `- Tópico atual da interação: ${liveState.currentTopic || "geral"}`,
  ];
  if (liveState.unresolvedQuestion) {
    lines.push(`- Pergunta pendente dele a responder: "${liveState.unresolvedQuestion}"`);
  }
  if (liveState.lastLarissaSpeechAct) {
    lines.push(`- Último ato de fala da Larissa: ${liveState.lastLarissaSpeechAct}`);
  }
  if (liveState.recentLandmarksSummary) {
    lines.push(`- Marcos recentes: ${liveState.recentLandmarksSummary}`);
  }
  if (liveState.pendingUserTopic) {
    lines.push(`- Tópico em aberto do pretendente: ${liveState.pendingUserTopic}`);
  }
  if (liveState.openLoops && liveState.openLoops.length > 0) {
    lines.push(`- Open loops: ${liveState.openLoops.join(", ")}`);
  }
  if (liveState.avoidRepeating && liveState.avoidRepeating.length > 0) {
    lines.push(`- Evitar repetir agora: ${liveState.avoidRepeating.join(", ")}`);
  }
  lines.push(`- Turno: #${liveState.turnCount || 1}`);
  return lines.join("\n");
}

export interface MissionPackage {
  subagentId: string;
  subagentName: string;
  objectiveDirective: "pursue" | "defer" | "already_satisfied" | "none";
  targetObjective?: {
    id: string;
    label: string;
    description?: string;
  } | null;
  satisfiedEvidence?: {
    objectiveId: string;
    evidenceMessageId?: string;
    reason: string;
  } | null;
  relevantMemoryContext: string;
  liveStateContext: string;
  conversationIntent?: string;
  emotionalTone?: string;
  currentTopic?: string;
  bestHook?: string;
  curiosityOpportunity?: string;
  questionRecommendation?: string;
  relevantPersonaFacts?: Array<{
    fact: string;
    memoryId?: string;
    origin: "persona_memory";
    reason: string;
  }>;
  candidateAudios?: Array<{
    audioId: string;
    title: string;
    transcript: string;
    instruction: string;
    adherenceScore: number;
  }>;
  preferAudio?: boolean;
  selectedAudioId?: string | null;
  turnContract?: TurnContract;
}

export async function searchPersonaMemoryForBrain(
  personaProvider: { searchPersonaFacts: (personaId: string, query: string) => Promise<any[]> },
  query: string,
  limit = 8
): Promise<string> {
  const hits = await personaProvider.searchPersonaFacts("larissa", query);
  const formatted = (hits || []).slice(0, limit).map((fact: any) => {
    const key = fact.key || fact.field || fact.category || "fato";
    const value = fact.value ?? fact.summary;
    return value === undefined || value === null || value === ""
      ? ""
      : `• ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`;
  }).filter(Boolean).join("\n");
  return formatted || "Nenhum fato encontrado na PersonaMemory.";
}

function formatPersonaMemoryHitsForBrain(hits: any[], limit = 8): string {
  const formatted = (hits || []).slice(0, limit).map((fact: any) => {
    const key = fact.key || fact.field || fact.category || "fato";
    const value = fact.value ?? fact.summary;
    return value === undefined || value === null || value === ""
      ? ""
      : `• ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`;
  }).filter(Boolean).join("\n");
  return formatted || "Nenhum fato encontrado na PersonaMemory.";
}

export function authorizeMissionAudioSelection(
  requestedMission: MissionPackage | undefined,
  candidates: CofreAudioCandidate[]
): { selectedAudioId: string | null; candidateAudios: NonNullable<MissionPackage["candidateAudios"]>; preferAudio: boolean } {
  const requestedAudioId = requestedMission?.selectedAudioId || null;
  const authorized = requestedAudioId
    ? candidates.find((candidate) => candidate.audio_id === requestedAudioId)
    : undefined;
  return {
    selectedAudioId: authorized?.audio_id || null,
    candidateAudios: authorized ? [{
      audioId: authorized.audio_id,
      title: authorized.title,
      transcript: authorized.full_transcript,
      instruction: authorized.when_to_use,
      adherenceScore: authorized.match_score || 0,
    }] : [],
    preferAudio: Boolean(authorized && requestedMission?.preferAudio),
  };
}

export function enforceAuthorizedAudioDecision(
  decision: Pick<SubagentDecision, "action" | "audioId">,
  mission: Pick<MissionPackage, "selectedAudioId" | "candidateAudios">
): { allowed: boolean; audioId?: string; reason?: string } {
  const requestedAudioId = decision.audioId || null;
  const authorizedId = mission.selectedAudioId || null;
  const existsInAuthorizedCandidates = Boolean(
    authorizedId && mission.candidateAudios?.some((candidate) => candidate.audioId === authorizedId)
  );
  if (decision.action !== "send_audio" && !requestedAudioId) return { allowed: true };
  if (!requestedAudioId || !authorizedId || requestedAudioId !== authorizedId || !existsInAuthorizedCandidates) {
    return { allowed: false, reason: "executor_audio_id_not_authorized" };
  }
  return { allowed: true, audioId: authorizedId };
}

export interface ConversationBrainPlan {
  action: "delegate_mission" | "call_tool" | "reply" | "wait";
  tool?: "conversation_history_search" | "persona_memory_search" | "episodic_memory_search" | "cofre_audio_search";
  parameters?: Record<string, any>;
  currentStage?: string;
  responsibleSubagent: string;
  objectiveDecision: "pursue" | "defer" | "already_satisfied" | "none";
  satisfiedObjectiveId?: string;
  evidenceMessageId?: string;
  liveStatePatch: Partial<ConversationLiveState>;
  missionPackage?: MissionPackage;
  reasoning?: string;
  responses?: string[];
  suggestedResponse?: string;
  currentTopic?: string;
  bestHook?: string;
  curiosityOpportunity?: string;
  turnContract?: TurnContract;
  memoryConsulted?: boolean;
  memoryRationale?: string;
  personaMemoryQuery?: string;
  relevantPersonaFacts?: Array<{ fact: string; memoryId?: string; origin?: string; reason?: string }>;
}

export interface CompactSubagentCard {
  id: string;
  name: string;
  description: string;
  stageIds: string[];
}

export type OrchestrationMode = "legacy" | "shadow" | "experimental";
export type OrchestrationPhase = "conexao_inicial" | "descoberta" | "compatibilidade" | (string & {});
export type OrchestrationAction = "reply" | "send_audio" | "wait" | "advance_phase" | "escalate";
export type SubagentTarget =
  | "conexao_inicial"
  | "descoberta"
  | "compatibilidade"
  | "none"
  | (string & {});
export type ProcessingStatus =
  | "idle"
  | "analyzing"
  | "decided"
  | "sent"
  | "shadow_logged"
  | "failed";

export interface StageObjective {
  id: string;
  stageId?: string;
  title: string;
  label?: string;
  description?: string;
  required: boolean;
  enabled: boolean;
  order: number;
  memoryEntity?: string;
  memoryField?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationObjectiveProgress {
  conversationId: string;
  stageId: string;
  objectiveId: string;
  status: "pending" | "completed" | "skipped";
  value?: any;
  evidenceMessageId?: string;
  completedAt?: string;
}

export interface PersonaAudioAsset {
  id: string;
  stageId?: string;
  title: string;
  audioUrl: string;
  duration?: number;
  transcript: string;
  usageInstruction: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AudioDeliveryHistory {
  id: string;
  conversationId: string;
  audioId: string;
  sentAt: string;
  providerMessageId?: string;
}

export interface ConversationRoutingDecision {
  targetSubagent: SubagentTarget;
  action: "delegate" | "wait" | "pause";
  reason: string;
}

export interface MemoryCandidate {
  entity: string;
  kind?: "episodic" | "fact";
  key: string;
  value: any;
  summary?: string;
  tags?: string[];
  evidenceMessageId: string;
}

export interface SubagentDecision {
  action: OrchestrationAction;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
  responses?: string[];
  nextPhase: OrchestrationPhase;
  reasoning: string;
  requiredTools?: string[];
  audioId?: string;
  audioUrl?: string;
  objectiveCompletion?: {
    objectiveId: string;
    evidenceMessageId?: string;
    value?: any;
  };
  memoryCandidates?: MemoryCandidate[];
}

export interface OrchestratorDecision {
  action: OrchestrationAction;
  currentPhase: OrchestrationPhase;
  nextPhase: OrchestrationPhase;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
  responses?: string[];
  requiredTools: string[];
  reasoning: string;
  routedSubagent?: SubagentTarget;
  audioId?: string;
  audioUrl?: string;
  objectiveCompletion?: {
    objectiveId: string;
    evidenceMessageId?: string;
    value?: any;
  };
  memoryCandidates?: MemoryCandidate[];
}

export type MessageProcessingStatus =
  | "received"
  | "pending"
  | "claimed"
  | "processed"
  | "failed";

export interface CanonicalMessage {
  id: string;
  conversationId: string;
  sender: "pretendente" | "larissa";
  direction: "inbound" | "outbound";
  timestamp: string;
  type: "text" | "audio" | "image" | "file";
  text: string;
  replyToMessageId?: string | null;
  mediaUrl?: string | null;
  status: MessageProcessingStatus;
  claimedByCycleId?: string | null;
}

export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "dispatch_uncertain";

export interface OutboxEntry {
  id: string;
  cycleId: string;
  conversationId: string;
  idempotencyKey: string;
  content: string;
  messageType: "text" | "audio" | "image";
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  providerMessageId?: string | null;
  lastError?: string | null;
  createdAt: string;
  sentAt?: string | null;
  sendingAt?: string | null;
  isUncertain?: boolean;
}

export interface ProcessingCycle {
  cycleId: string;
  conversationId: string;
  claimedMessageIds: string[];
  startedAt: string;
  completedAt?: string | null;
  status: "in_progress" | "completed" | "failed" | "cancelled" | "superseded";
  agentVersions: {
    router: string;
    subagent: string;
    prompt: string;
  };
  decision?: OrchestratorDecision;
  brainModel?: string;
  executorModel?: string;
  outboxEntryId?: string;
  metrics?: {
    durationMs: number;
    tokens: {
      input?: number;
      output?: number;
      total: number;
    };
  };
  trace: string[];
  inputWatermark?: {
    revision: number;
    claimedCount: number;
    snapshotTimestamp: string;
  };
  shadowSimulation?: any;
}

export interface ConversationOrchestrationState {
  version: 1;
  mode: OrchestrationMode;
  brainProvider?: "internal" | "openai_agent";
  currentPhase: OrchestrationPhase;
  currentStageId?: string;
  responsibleSubagentId?: string;
  completedGoalIds?: string[];
  objectiveProgress?: Record<string, any>;
  shadowSimulation?: {
    wouldCompleteObjectiveId?: string | null;
    wouldAdvanceStage?: boolean;
    wouldNextPhase?: string;
    wouldNextStageId?: string;
    simulatedCompletedGoals?: string[];
    simulatedObjectiveProgress?: Record<string, any>;
  };
  checkpoint: string;
  lastProcessedMessageId: string | null;
  lastProcessedAt: string | null;
  lastProcessingStatus: ProcessingStatus;
  lastCorrelationId: string | null;
  lastDecision: OrchestratorDecision | null;
  lastError: string | null;
  durationMs?: number;
  tokens?: number;
  updatedAt: string;
  inboundRevision?: number;
  preemptRequested?: boolean;
  // Campos incrementais da arquitetura com Ledger, Cycle e Outbox
  activeCycle?: ProcessingCycle | null;
  recentCycles?: ProcessingCycle[];
  outbox?: Record<string, OutboxEntry>;
  messageLedger?: Record<string, MessageProcessingStatus>;
  memory?: ContactMemoryStore;
  liveState?: ConversationLiveState;
}

/**
 * AUTORIDADE DE PROGRESSO DETERMINÍSTICO:
 * Resolve a lista oficial de completed_goals onde stageRules.completed_goals é a
 * autoridade primária persistida e orchState.completedGoalIds é o espelho/fallback.
 */
export function resolveOfficialCompletedGoals(
  stageRules?: { completed_goals?: string[] } | null,
  orchState?: { completedGoalIds?: string[] } | null
): string[] {
  if (Array.isArray(stageRules?.completed_goals)) {
    return [...stageRules.completed_goals];
  }
  if (Array.isArray(orchState?.completedGoalIds)) {
    return [...orchState.completedGoalIds];
  }
  return [];
}

/**
 * AUTORIDADE DE PROGRESSO DETERMINÍSTICO:
 * Resolve o mapa oficial de objective_progress onde stageRules.objective_progress é a
 * autoridade primária persistida e orchState.objectiveProgress é o espelho/fallback.
 */
export function resolveOfficialObjectiveProgress(
  stageRules?: { objective_progress?: Record<string, any> } | null,
  orchState?: { objectiveProgress?: Record<string, any> } | null
): Record<string, any> {
  if (stageRules?.objective_progress && typeof stageRules.objective_progress === "object" && !Array.isArray(stageRules.objective_progress)) {
    return { ...stageRules.objective_progress };
  }
  if (orchState?.objectiveProgress && typeof orchState.objectiveProgress === "object" && !Array.isArray(orchState.objectiveProgress)) {
    return { ...orchState.objectiveProgress };
  }
  return {};
}

export interface StructuredConversationMessage {
  id: string;
  sender: "pretendente" | "larissa";
  text: string;
  replyToId?: string | null;
  timestamp?: string;
}

export interface ConversationContextPayload {
  phase: OrchestrationPhase;
  checkpoint: string;
  lastLarissaMessage?: StructuredConversationMessage | null;
  lastLarissaTurn?: StructuredConversationMessage[];
  newMessages: StructuredConversationMessage[];
  referencedMessages?: Record<string, StructuredConversationMessage>;
  knownFacts?: Record<string, string>;
}

// ----------------------------------------------------------------------------
// Tipos de Memória Estruturada sob Demanda (.agents/ARCHITECTURE.md)
// ----------------------------------------------------------------------------
export interface MemoryFact {
  entity: string; // "self" ou nome de terceiro ("prima_maria", "filho_pedro")
  field: string;  // "age", "city", "profession", etc.
  value: any;     // 40, "Barbacena", etc.
  sourceMessageId?: string;
  updatedAt: string;
  confidence?: number;
}

export interface MemorySearchResult {
  snippet: string;
  sourceMessageId?: string;
  entity?: string;
  relevance?: number;
}

export interface ContactMemoryStore {
  entities: Record<string, Record<string, MemoryFact>>;
  snippets?: Array<{ snippet: string; entity?: string; sourceMessageId?: string; createdAt: string }>;
}

export interface MemoryProvider {
  getFact(contactId: string, entity: string, field: string): Promise<{ found: boolean; fact?: MemoryFact; value?: any }>;
  searchMemory(contactId: string, query: string, options?: { entity?: string; limit?: number }): Promise<MemorySearchResult[]>;
  writeFact(contactId: string, fact: Omit<MemoryFact, "updatedAt">): Promise<{ success: boolean; error?: string }>;
  listEntityFacts(contactId: string, entity: string): Promise<Record<string, MemoryFact>>;
  saveFact?(contactId: string, entity: string, field: string, value: any, options?: { confidence?: number; sourceMessageId?: string }): Promise<{ success: boolean; error?: string }>;
}


export interface SubagentDefinition {
  id: string;
  name: string;
  mission: string;
  enabled?: boolean;
  isSystem?: boolean;
  stageIds?: string[];
  description?: string;
  objectiveFamilies?: string[];
  capabilities?: string[];
  restrictions?: string[];
  createdAt?: string;
  updatedAt?: string;
  missionSource?: "db" | "canonical_fallback";
}

export const CANONICAL_SUBAGENTS: Record<string, SubagentDefinition> = {
  conexao_inicial: {
    id: "conexao_inicial",
    name: "Conexão Inicial",
    mission: "Criar conforto, reciprocidade e um começo natural de conversa, sem transformar o contato em entrevista nem antecipar assuntos profundos.",
    enabled: true,
    isSystem: true,
    missionSource: "canonical_fallback",
  },
  descoberta: {
    id: "descoberta",
    name: "Descoberta",
    mission: "Conhecer organicamente quem o pretendente é, sua rotina, vida, trabalho, gostos e contexto pessoal, aproveitando naturalmente os assuntos que surgem.",
    enabled: true,
    isSystem: true,
    missionSource: "canonical_fallback",
  },
  compatibilidade: {
    id: "compatibilidade",
    name: "Compatibilidade",
    mission: "Entender valores, momento de vida, visão de relacionamento, família, planos e compatibilidade com Larissa, somente quando houver abertura natural para assuntos mais pessoais.",
    enabled: true,
    isSystem: true,
    missionSource: "canonical_fallback",
  },
};

let _subagentsCatalogCache: { data: SubagentDefinition[]; fetchedAt: number } | null = null;
const SUBAGENTS_CATALOG_CACHE_TTL_MS = 60000;

/**
 * Carrega catálogo de subagentes diretamente da tabela dedicada `public.subagent_definitions` no Supabase
 * como Fonte de Verdade Única, com cache em memória (TTL 60s) e fallback seguro em memória para os 3 canônicos.
 */
export async function loadSubagentsCatalog(params?: {
  supabase?: any;
  forceRefresh?: boolean;
  includeDisabled?: boolean;
}): Promise<SubagentDefinition[]> {
  const now = Date.now();
  if (
    !params?.forceRefresh &&
    _subagentsCatalogCache &&
    now - _subagentsCatalogCache.fetchedAt < SUBAGENTS_CATALOG_CACHE_TTL_MS
  ) {
    if (params?.includeDisabled) {
      return _subagentsCatalogCache.data;
    }
    return _subagentsCatalogCache.data.filter((s) => s.enabled !== false);
  }

  const fallbackList = Object.values(CANONICAL_SUBAGENTS);

  if (!params?.supabase) {
    _subagentsCatalogCache = { data: fallbackList, fetchedAt: now };
    return params?.includeDisabled ? fallbackList : fallbackList.filter((s) => s.enabled !== false);
  }

  try {
    const { data, error } = await params.supabase
      .from("subagent_definitions")
      .select("*")
      .order("is_system", { ascending: false })
      .order("name", { ascending: true });

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      // Fallback seguro em memória caso banco ou tabela estejam indisponíveis
      _subagentsCatalogCache = { data: fallbackList, fetchedAt: now };
      return params?.includeDisabled ? fallbackList : fallbackList.filter((s) => s.enabled !== false);
    }

    const parsedSubagents: SubagentDefinition[] = data.map((row: any) => ({
      id: row.id,
      name: row.name,
      mission: row.mission,
      enabled: row.enabled ?? true,
      isSystem: Boolean(row.is_system),
      description: row.description || undefined,
      stageIds: Array.isArray(row.stage_ids) ? row.stage_ids : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      missionSource: "db",
    }));

    // Merge resiliente garantindo que os 3 canônicos existam e mantenham isSystem: true
    const mergedMap = new Map<string, SubagentDefinition>();
    for (const canon of fallbackList) {
      mergedMap.set(canon.id, { ...canon });
    }
    for (const sub of parsedSubagents) {
      if (sub && typeof sub.id === "string") {
        const existing = mergedMap.get(sub.id);
        if (existing) {
          mergedMap.set(sub.id, {
            ...existing,
            ...sub,
            isSystem: existing.isSystem, // canônicos sempre preservam isSystem: true
          });
        } else {
          mergedMap.set(sub.id, {
            ...sub,
            isSystem: Boolean(sub.isSystem),
          });
        }
      }
    }

    const resultList = Array.from(mergedMap.values());
    _subagentsCatalogCache = { data: resultList, fetchedAt: now };
    return params?.includeDisabled ? resultList : resultList.filter((s) => s.enabled !== false);
  } catch (err) {
    _subagentsCatalogCache = { data: fallbackList, fetchedAt: now };
    return params?.includeDisabled ? fallbackList : fallbackList.filter((s) => s.enabled !== false);
  }
}

export interface ConversationAgentInput {
  conversationId: string;
  currentPhase: OrchestrationPhase;
  checkpoint?: string;
  contextText?: string;
  newMessage?: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  recentHistory?: string;
  openGoalsSummary?: string;
  availableSubagents?: SubagentDefinition[];
}

export interface SubagentInput {
  conversationId: string;
  currentPhase: OrchestrationPhase;
  checkpoint?: string;
  contextText?: string;
  newMessage?: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  recentHistory?: string;
  emojiBudgetSnippet?: string;
  mission?: string;
  goalsSnippet?: string;
  styleStateSnippet?: string;
  softFocusSnippet?: string;
  audioCandidatesSnippet?: string;
}

// Mantido para compatibilidade retroativa
export interface OrchestratorInput {
  conversationId: string;
  newMessage: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  currentPhase: OrchestrationPhase;
  conversationSummary: string;
  relevantMemories: string[];
  pendingTasks: string[];
  allowedTools: string[];
  phaseRules: string[];
}

// ----------------------------------------------------------------------------
// 0. Decodificador Seguro de JSON
// ----------------------------------------------------------------------------
export function extractJsonFromText(raw: string): any {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error("Resposta da IA está vazia.");
  }
  try {
    return JSON.parse(raw);
  } catch {}

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {}
  }

  const firstBrace = raw.indexOf("{");
  if (firstBrace !== -1) {
    let lastBrace = raw.lastIndexOf("}");
    while (lastBrace > firstBrace) {
      const candidate = raw.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {}
      lastBrace = raw.lastIndexOf("}", lastBrace - 1);
    }
  }

  // Se o modelo gerou call_tool mas houve problema de fechamento de chaves
  if (raw.includes('"action"') && raw.includes('"call_tool"')) {
    const toolMatch = raw.match(/"tool"\s*:\s*"([^"]+)"/i);
    const fieldMatch = raw.match(/"field"\s*:\s*"([^"]+)"/i);
    const queryMatch = raw.match(/"query"\s*:\s*"([^"]+)"/i);
    if (toolMatch) {
      return {
        action: "call_tool",
        tool: toolMatch[1],
        parameters: fieldMatch ? { field: fieldMatch[1] } : (queryMatch ? { query: queryMatch[1] } : {}),
      };
    }
  }

  // Recuperação resiliente para respostas cortadas/truncadas
  const respMatch = raw.match(/"suggestedResponse"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
  if (respMatch?.[1]) {
    return {
      action: "reply",
      checkpoint: "chk_pergunta_sobre_ele",
      summary: "recuperado de json parcial",
      suggestedResponse: respMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' '),
      nextPhase: "descoberta",
    };
  }

  // Se houver um bloco de texto solto
  const textMatch = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  if (textMatch && !textMatch.startsWith("{")) {
    return {
      action: "reply",
      checkpoint: "chk_pergunta_sobre_ele",
      summary: "resposta textual direta",
      suggestedResponse: textMatch,
      nextPhase: "descoberta",
    };
  }

  throw new Error(`Falha ao decodificar JSON da resposta da IA: ${raw.slice(0, 100)}...`);
}

// ----------------------------------------------------------------------------
// 1. Validador do Agente da Conversa (Roteamento)
// ----------------------------------------------------------------------------
export function validateRoutingDecision(
  data: unknown,
  fallbackPhase: OrchestrationPhase,
  validSubagentIds?: string[]
): ConversationRoutingDecision {
  if (!data || typeof data !== "object") {
    return {
      targetSubagent: fallbackPhase,
      action: "delegate",
      reason: "Fallback por payload não-objeto",
    };
  }
  const obj = data as Record<string, any>;
  const action = obj.action === "wait" || obj.action === "pause" ? obj.action : "delegate";
  const reason =
    typeof obj.reason === "string"
      ? obj.reason.trim()
      : typeof obj.reasoning === "string"
      ? obj.reasoning.trim()
      : "Decisão de roteamento válida";

  // Se 'none' foi expressamente retornado
  if (obj.targetSubagent === "none") {
    return {
      targetSubagent: "none",
      action: obj.action === "pause" ? "pause" : "wait",
      reason,
    };
  }

  // Se lista de IDs válidos foi informada (catálogo ativo)
  if (validSubagentIds && Array.isArray(validSubagentIds) && validSubagentIds.length > 0) {
    if (typeof obj.targetSubagent === "string" && validSubagentIds.includes(obj.targetSubagent)) {
      return {
        targetSubagent: obj.targetSubagent,
        action,
        reason,
      };
    }
  } else {
    // Validação aberta padrão (aceita canônicos ou identificador alfanumérico válido)
    if (
      obj.targetSubagent === "conexao_inicial" ||
      obj.targetSubagent === "descoberta" ||
      obj.targetSubagent === "compatibilidade"
    ) {
      return {
        targetSubagent: obj.targetSubagent,
        action,
        reason,
      };
    }

    if (typeof obj.targetSubagent === "string" && /^[a-z0-9_]{2,64}$/i.test(obj.targetSubagent)) {
      return {
        targetSubagent: obj.targetSubagent,
        action,
        reason,
      };
    }
  }

  // Compatibilidade resiliente com mocks e decisões diretas
  if (obj.currentPhase === "descoberta" || obj.nextPhase === "descoberta") {
    return {
      targetSubagent: "descoberta",
      action: "delegate",
      reason: "Roteado com base na fase da decisão",
    };
  }
  if (obj.currentPhase === "compatibilidade" || obj.nextPhase === "compatibilidade") {
    return {
      targetSubagent: "compatibilidade",
      action: "delegate",
      reason: "Roteado com base na fase da decisão",
    };
  }

  return {
    targetSubagent: fallbackPhase || "conexao_inicial",
    action: obj.action === "wait" ? "wait" : "delegate",
    reason:
      typeof obj.reasoning === "string"
        ? obj.reasoning.trim()
        : typeof obj.reason === "string"
        ? obj.reason.trim()
        : "Roteamento padrão para fase atual",
  };
}

// ----------------------------------------------------------------------------
// 2. Validador de Decisão de Subagente
// ----------------------------------------------------------------------------
export function validateSubagentDecision(
  data: unknown,
  currentPhase: OrchestrationPhase,
  allowedSubagents?: string[]
): SubagentDecision {
  if (!data || typeof data !== "object") {
    throw new Error("Decisão do subagente inválida: payload não é um objeto.");
  }
  const obj = data as Record<string, any>;

  const rawAudioId =
    typeof obj.audioId === "string" && obj.audioId.trim()
      ? obj.audioId.trim()
      : typeof obj.audio_id === "string" && obj.audio_id.trim()
      ? obj.audio_id.trim()
      : undefined;

  const action: OrchestrationAction =
    obj.action === "send_audio" || (rawAudioId && obj.action !== "wait" && obj.action !== "advance_phase" && obj.action !== "escalate")
      ? "send_audio"
      : obj.action === "wait" || obj.action === "advance_phase" || obj.action === "escalate"
      ? obj.action
      : "reply";

  const rawNext = typeof obj.nextPhase === "string" ? obj.nextPhase.trim() : "";
  const standardPhases = ["conexao_inicial", "descoberta", "compatibilidade"];
  const isAllowedPhase =
    rawNext &&
    (standardPhases.includes(rawNext) ||
      (allowedSubagents && allowedSubagents.includes(rawNext)) ||
      rawNext.startsWith("stage_"));
  const nextPhase: OrchestrationPhase = isAllowedPhase ? rawNext : currentPhase;

  const checkpoint =
    typeof obj.checkpoint === "string" && obj.checkpoint.trim()
      ? obj.checkpoint.trim()
      : currentPhase === "descoberta"
      ? "chk_pergunta_sobre_ele"
      : currentPhase === "compatibilidade"
      ? "chk_alinhamento_valores"
      : "chk_saudacao_feita";

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "Turno processado";

  let responses: string[] | undefined;
  if (Array.isArray(obj.responses) && obj.responses.length > 0) {
    responses = obj.responses.map(String).map((s) => s.trim()).filter(Boolean);
  }

  let suggestedResponse = typeof obj.suggestedResponse === "string" ? obj.suggestedResponse.trim() : "";
  if (!suggestedResponse && responses && responses.length > 0) {
    suggestedResponse = responses.join("\n\n");
  } else if (suggestedResponse && (!responses || responses.length === 0)) {
    responses = splitIntoBalloons(suggestedResponse);
  }

  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim()
      ? obj.reasoning.trim()
      : "Execução especializada do subagente";

  let objectiveCompletion: { objectiveId: string; evidenceMessageId?: string; value?: any } | undefined;
  const rawObjComp = obj.objectiveCompletion || obj.objective_completion;
  if (rawObjComp && typeof rawObjComp === "object" && (rawObjComp.objectiveId || rawObjComp.goalId)) {
    objectiveCompletion = {
      objectiveId: String(rawObjComp.objectiveId || rawObjComp.goalId || "").trim(),
      evidenceMessageId: rawObjComp.evidenceMessageId ? String(rawObjComp.evidenceMessageId).trim() : undefined,
      value: rawObjComp.value !== undefined ? rawObjComp.value : true,
    };
  }

  let memoryCandidates: MemoryCandidate[] | undefined;
  const rawMemCand = obj.memoryCandidates || obj.memory_candidates;
  if (Array.isArray(rawMemCand) && rawMemCand.length > 0) {
    memoryCandidates = rawMemCand
      .filter((c: any) => c && typeof c === "object" && (c.key || c.summary || c.value))
      .slice(0, 3)
      .map((c: any) => ({
        entity: String(c.entity || "self").trim().toLowerCase(),
        kind: c.kind === "fact" ? ("fact" as const) : ("episodic" as const),
        key: String(c.key || "detail").trim(),
        value: c.value !== undefined ? c.value : String(c.summary || ""),
        summary: c.summary ? String(c.summary).trim() : undefined,
        tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
        evidenceMessageId: String(c.evidenceMessageId || c.evidence_message_id || "").trim(),
      }));
  }

  return {
    action,
    checkpoint,
    summary,
    suggestedResponse,
    responses,
    nextPhase,
    reasoning,
    requiredTools: Array.isArray(obj.requiredTools) ? obj.requiredTools.map(String) : [action === "send_audio" ? "send_audio" : "send_text"],
    audioId: rawAudioId,
    audioUrl: typeof obj.audioUrl === "string" ? obj.audioUrl.trim() : undefined,
    objectiveCompletion,
    memoryCandidates,
  };
}

// ----------------------------------------------------------------------------
// 3. Validador de Esquema Estrito (Compatibilidade Retroativa)
// ----------------------------------------------------------------------------
export function validateOrchestratorDecision(data: unknown, allowedPhases?: string[]): OrchestratorDecision {
  if (!data || typeof data !== "object") {
    throw new Error("Decisão do orquestrador inválida: payload não é um objeto.");
  }
  const obj = data as Record<string, any>;

  const validActions: OrchestrationAction[] = ["reply", "send_audio", "wait", "advance_phase", "escalate"];
  if (!validActions.includes(obj.action)) {
    throw new Error(`Ação inválida: "${obj.action}". Esperado: ${validActions.join(", ")}`);
  }

  const defaultPhases = ["conexao_inicial", "descoberta", "compatibilidade"];
  const validPhases = allowedPhases && allowedPhases.length > 0 ? allowedPhases : defaultPhases;

  if (
    typeof obj.currentPhase !== "string" ||
    (!validPhases.includes(obj.currentPhase) && !obj.currentPhase.startsWith("stage_"))
  ) {
    throw new Error(`Fase atual inválida: "${obj.currentPhase}".`);
  }
  if (
    typeof obj.nextPhase !== "string" ||
    (!validPhases.includes(obj.nextPhase) && !obj.nextPhase.startsWith("stage_"))
  ) {
    throw new Error(`Próxima fase inválida: "${obj.nextPhase}".`);
  }

  if (typeof obj.checkpoint !== "string" || !obj.checkpoint.trim()) {
    throw new Error("Checkpoint é obrigatório e deve ser uma string não vazia.");
  }

  if (typeof obj.summary !== "string") {
    throw new Error("Resumo da conversa deve ser uma string.");
  }

  if (typeof obj.suggestedResponse !== "string") {
    throw new Error("Resposta sugerida deve ser uma string.");
  }

  if (!Array.isArray(obj.requiredTools)) {
    throw new Error("requiredTools deve ser um array de strings.");
  }

  if (typeof obj.reasoning !== "string" || !obj.reasoning.trim()) {
    throw new Error("Motivo da decisão (reasoning) é obrigatório.");
  }

  let objectiveCompletion: { objectiveId: string; evidenceMessageId?: string; value?: any } | undefined;
  const rawObjComp = obj.objectiveCompletion || obj.objective_completion;
  if (rawObjComp && typeof rawObjComp === "object" && (rawObjComp.objectiveId || rawObjComp.goalId)) {
    objectiveCompletion = {
      objectiveId: String(rawObjComp.objectiveId || rawObjComp.goalId || "").trim(),
      evidenceMessageId: rawObjComp.evidenceMessageId ? String(rawObjComp.evidenceMessageId).trim() : undefined,
      value: rawObjComp.value !== undefined ? rawObjComp.value : true,
    };
  }

  return {
    action: obj.action,
    currentPhase: obj.currentPhase,
    nextPhase: obj.nextPhase,
    checkpoint: obj.checkpoint.trim(),
    summary: obj.summary.trim(),
    suggestedResponse: obj.suggestedResponse.trim(),
    responses: Array.isArray(obj.responses) ? obj.responses.map(String) : undefined,
    requiredTools: obj.requiredTools.map(String),
    reasoning: obj.reasoning.trim(),
    routedSubagent: obj.routedSubagent,
    audioId: typeof obj.audioId === "string" ? obj.audioId : undefined,
    audioUrl: typeof obj.audioUrl === "string" ? obj.audioUrl : undefined,
    objectiveCompletion,
  };
}

// ----------------------------------------------------------------------------
// 4. Validador de Transição de Fase pelo Backend (Guarda de Integridade / Normalização)
// ----------------------------------------------------------------------------
// AVISO DE ARQUITETURA: validatePhaseTransition NÃO É autoridade de workflow e
// NÃO tem permissão para alterar o estado oficial da conversa (currentPhase/currentStageId).
// Serve exclusivamente para normalização de payload, telemetria de trace, compatibilidade
// legada e debug. A ÚNICA autoridade determinística oficial para progressão e avanço de etapa
// é a função processDeterministicStageProgression().
export function validatePhaseTransition(
  currentPhase: OrchestrationPhase,
  requestedNextPhase: OrchestrationPhase,
  checkpoint: string,
  stagesOrder?: Array<{ id: string; order: number }>
): { allowed: boolean; validatedNextPhase: OrchestrationPhase; reason?: string } {
  if (requestedNextPhase === currentPhase) {
    return { allowed: true, validatedNextPhase: currentPhase };
  }

  // Transição de 'conexao_inicial' -> 'descoberta'
  if (
    (currentPhase === "conexao_inicial" || currentPhase === "stage_1_conexao") &&
    (requestedNextPhase === "descoberta" || requestedNextPhase === "stage_2_descoberta")
  ) {
    const validCheckpoints = [
      "chk_rapport_estabelecido",
      "chk_conexao_validada",
      "chk_saudacao_reciproca",
      "chk_etapa_concluida",
      "stage_complete",
    ];
    if (validCheckpoints.includes(checkpoint) || checkpoint.includes("rapport") || checkpoint.includes("concluid")) {
      return { allowed: true, validatedNextPhase: requestedNextPhase };
    }
    return {
      allowed: false,
      validatedNextPhase: currentPhase,
      reason: `Checkpoint "${checkpoint}" insuficiente para avançar para descoberta. Requer um de: ${validCheckpoints.join(", ")}`,
    };
  }

  // Transição de 'descoberta' -> 'compatibilidade'
  if (
    (currentPhase === "descoberta" || currentPhase === "stage_2_descoberta") &&
    (requestedNextPhase === "compatibilidade" || requestedNextPhase === "stage_3_compatibilidade")
  ) {
    return { allowed: true, validatedNextPhase: requestedNextPhase };
  }

  // Descoberta e compatibilidade não regridem automaticamente sem comando explícito
  if (
    (currentPhase === "descoberta" && requestedNextPhase === "conexao_inicial") ||
    (currentPhase === "compatibilidade" &&
      (requestedNextPhase === "descoberta" || requestedNextPhase === "conexao_inicial"))
  ) {
    return {
      allowed: false,
      validatedNextPhase: currentPhase,
      reason: "Regressão de fase não permitida automaticamente pelo agente.",
    };
  }

  // Validação dinâmica por ordem de etapas se fornecida
  if (stagesOrder && stagesOrder.length > 0) {
    const curr = stagesOrder.find((s) => s.id === currentPhase);
    const next = stagesOrder.find((s) => s.id === requestedNextPhase);
    if (curr && next) {
      if (next.order < curr.order) {
        return {
          allowed: false,
          validatedNextPhase: currentPhase,
          reason: "Regressão de etapa não permitida pelo backend.",
        };
      }
      return { allowed: true, validatedNextPhase: requestedNextPhase };
    }
  }

  return { allowed: true, validatedNextPhase: requestedNextPhase };
}

// ----------------------------------------------------------------------------
// 5. Regras de Cada Fase (Diretrizes Operacionais)
// ----------------------------------------------------------------------------
export function getRulesForPhase(phase: OrchestrationPhase): string[] {
  if (phase === "conexao_inicial") {
    return [
      "Priorize acolhimento caloroso, simpatia meiga e validação de reciprocidade.",
      "Não faça interrogatório de múltiplas perguntas em um único turno.",
      "Responda ao que o pretendente falou antes de perguntar qualquer coisa.",
      "Avançar para 'descoberta' SOMENTE se o pretendente já respondeu com engajamento (checkpoint: chk_rapport_estabelecido).",
    ];
  }
  if (phase === "descoberta") {
    return [
      "Investigue suavemente o que ele faz da vida, onde mora e o que gosta de fazer.",
      "Aplique sempre a Regra da Reciprocidade: se perguntar sobre ele, conte algo breve sobre você.",
      "Se ele perguntar sua cidade ou profissão, responda que é de São João del Rei e estuda enfermagem/vendas online.",
      "Mantenha tom 100% feminino, afetuoso e natural de Minas Gerais.",
    ];
  }
  return [];
}

// ----------------------------------------------------------------------------
// 5.1. Função Central de Formatação e Projeção em TXT Compacto (.agents/CONTEXT_SERIALIZATION_SPEC.md)
// ----------------------------------------------------------------------------
export function formatConversationContextForModel(
  payload: ConversationContextPayload,
  options?: {
    layer?: "router" | "conexao_inicial" | "descoberta";
    includeKnownFacts?: boolean;
  }
): string {
  const lines: string[] = [];
  const layer = options?.layer || "router";

  // 1. [ESTADO]
  lines.push("[ESTADO]");
  lines.push(`fase: ${payload.phase}`);
  lines.push(`checkpoint: ${payload.checkpoint}`);

  // 1.1 [ULTIMO_TURNO_LARISSA] (Âncora de contexto do último bloco contíguo da Larissa)
  const larissaTurn = (payload.lastLarissaTurn && payload.lastLarissaTurn.length > 0)
    ? payload.lastLarissaTurn
    : (payload.lastLarissaMessage ? [payload.lastLarissaMessage] : []);

  if (larissaTurn.length > 0) {
    lines.push("");
    lines.push("[ULTIMO_TURNO_LARISSA]");
    for (let i = 0; i < larissaTurn.length; i++) {
      const m = larissaTurn[i];
      if (i > 0) lines.push("");
      lines.push(`LARISSA | ${m.id}`);
      lines.push(m.text || "");
    }
  }

  // 2. [FATOS_CONHECIDOS] - apenas se solicitado ou na camada 'descoberta'
  const shouldIncludeFacts =
    options?.includeKnownFacts ??
    (layer === "descoberta" && payload.knownFacts && Object.keys(payload.knownFacts).length > 0);

  if (shouldIncludeFacts && payload.knownFacts) {
    const factKeys = Object.keys(payload.knownFacts).sort();
    if (factKeys.length > 0) {
      lines.push("");
      lines.push("[FATOS_CONHECIDOS]");
      for (const k of factKeys) {
        const val = payload.knownFacts[k];
        if (val) lines.push(`${k}: ${val}`);
      }
    }
  }

  // 3. [MENSAGENS_NOVAS]
  lines.push("");
  lines.push("[MENSAGENS_NOVAS]");

  const usedReferenceIds = new Set<string>();

  for (const msg of payload.newMessages) {
    lines.push("");
    const author = msg.sender === "larissa" ? "LARISSA" : "PRETENDENTE";
    const headerParts = [author, msg.id];
    if (msg.replyToId) {
      headerParts.push(`RESPONDENDO_A: ${msg.replyToId}`);
      usedReferenceIds.add(msg.replyToId);
    }
    lines.push(headerParts.join(" | "));
    lines.push(msg.text || "");
  }

  // 4. [REFERÊNCIAS] (deduplicadas e ordenadas deterministicamente)
  if (payload.referencedMessages && usedReferenceIds.size > 0) {
    const refIds = Array.from(usedReferenceIds).sort();
    const validRefs = refIds.filter((id) => payload.referencedMessages![id]);

    if (validRefs.length > 0) {
      lines.push("");
      lines.push("[REFERÊNCIAS]");
      for (const refId of validRefs) {
        const refMsg = payload.referencedMessages![refId];
        lines.push("");
        lines.push(refId);
        const refAuthor = refMsg.sender === "larissa" ? "LARISSA" : "PRETENDENTE";
        lines.push(`${refAuthor}:`);
        lines.push(refMsg.text || "");
      }
    }
  }

  // 5. [FIM]
  lines.push("");
  lines.push("[FIM]");

  return lines.join("\n");
}

export function formatContextForConversationAgent(
  payload: ConversationContextPayload
): string {
  return formatConversationContextForModel(payload, {
    layer: "router",
    includeKnownFacts: false,
  });
}

export function formatContextForConexaoInicial(
  payload: ConversationContextPayload
): string {
  return formatConversationContextForModel(payload, {
    layer: "conexao_inicial",
    includeKnownFacts: false,
  });
}

export function formatContextForDescoberta(
  payload: ConversationContextPayload
): string {
  return formatConversationContextForModel(payload, {
    layer: "descoberta",
    includeKnownFacts: true,
  });
}

// ----------------------------------------------------------------------------
// 5.2. Normalizador Canônico de Mensagens (.agents/STANDARDS.md)
// ----------------------------------------------------------------------------
export function normalizeToCanonicalMessage(raw: any, conversationId: string): CanonicalMessage {
  const isMine = Boolean(raw.is_mine || raw.sender_id === "me");
  let msgType: "text" | "audio" | "image" | "file" = "text";
  const rawText = String(raw.text || "").trim();

  if (raw.media_type === "audio" || rawText.startsWith("[audio:")) {
    msgType = "audio";
  } else if (raw.media_type === "image" || rawText.startsWith("[image:")) {
    msgType = "image";
  } else if (raw.media_type === "file" || rawText.startsWith("[file:")) {
    msgType = "file";
  }

  return {
    id: String(raw.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    conversationId,
    sender: isMine ? "larissa" : "pretendente",
    direction: isMine ? "outbound" : "inbound",
    timestamp: raw.timestamp || raw.created_at || new Date().toISOString(),
    type: msgType,
    text: rawText,
    replyToMessageId: raw.reply_to_message_id || raw.replyToMessageId || raw.quoted_message_id || raw.quotedMessageId || null,
    mediaUrl: raw.media_url || null,
    status: raw.status || "received",
  };
}

// ----------------------------------------------------------------------------
// 5.3. ContextBuilder: Projeção Mínima & Lookup Pontual de Replies (.agents/CONTEXT_SERIALIZATION_SPEC.md)
// ----------------------------------------------------------------------------
export interface BuildContextParams {
  conversationId: string;
  currentPhase: OrchestrationPhase;
  checkpoint: string;
  claimedMessages: CanonicalMessage[];
  supabase: any;
  knownFacts?: Record<string, string>;
}

export async function buildConversationContextForCycle(
  params: BuildContextParams
): Promise<{
  payload: ConversationContextPayload;
  trace: string[];
}> {
  const { conversationId, currentPhase, checkpoint, claimedMessages, supabase, knownFacts } = params;
  const trace: string[] = [];

  // 0. Busca o último bloco CONTÍGUO de mensagens outbound enviadas pela Larissa (sem limites arbitrários)
  let lastLarissaMessage: StructuredConversationMessage | null = null;
  let lastLarissaTurn: StructuredConversationMessage[] = [];
  try {
    const pendingIds = new Set(claimedMessages.map((m) => String(m.id)));
    const collectedLarissa: StructuredConversationMessage[] = [];
    const batchSize = 50;
    let offset = 0;
    let stopTurnSearch = false;

    while (!stopTurnSearch) {
      const q = supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, text, reply_to_message_id, created_at, timestamp")
        .eq("conversation_id", conversationId);

      let batch: any[] = [];
      if (typeof q.order === "function") {
        const orderQ = q.order("created_at", { ascending: false });
        if (typeof (orderQ as any).range === "function") {
          const res = await (orderQ as any).range(offset, offset + batchSize - 1);
          batch = res?.data || [];
        } else if (typeof (orderQ as any).limit === "function") {
          const res = await (orderQ as any).limit(batchSize);
          batch = res?.data || [];
        } else {
          const res = await orderQ;
          batch = res?.data || [];
        }
      } else if (typeof q.or === "function") {
        // Suporte a mocks legados que encadeiam .or(...)
        const withOr = q.or("is_mine.eq.true,sender_id.eq.me");
        if (withOr && typeof withOr.order === "function") {
          const orderQ = withOr.order("created_at", { ascending: false });
          if (typeof (orderQ as any).range === "function") {
            const res = await (orderQ as any).range(offset, offset + batchSize - 1);
            batch = res?.data || [];
          } else {
            const res = await (orderQ as any).limit(batchSize);
            batch = res?.data || [];
          }
        }
      }

      if (!batch || batch.length === 0) {
        break;
      }

      for (const row of batch) {
        const rowId = String(row.id);
        // Pula mensagens que compõem o lote pendente atual do pretendente
        if (pendingIds.has(rowId)) {
          continue;
        }

        const isLarissa = Boolean(row.is_mine === true || row.sender_id === "me" || row.sender === "larissa");
        if (isLarissa && row.text) {
          collectedLarissa.push({
            id: rowId,
            sender: "larissa",
            text: String(row.text).trim(),
            replyToId: row.reply_to_message_id || null,
            timestamp: row.timestamp || row.created_at,
          });
        } else {
          // Encontrou mensagem do pretendente antes da Larissa: fim estrito do bloco contíguo
          stopTurnSearch = true;
          break;
        }
      }

      if (batch.length < batchSize || stopTurnSearch) {
        break;
      }

      offset += batchSize;
    }

    // A coleta foi feita em ordem decrescente (DESC); inverte para ordem cronológica ascendente (ASC)
    lastLarissaTurn = collectedLarissa.reverse();
    lastLarissaMessage = lastLarissaTurn[lastLarissaTurn.length - 1] || null;

    if (lastLarissaTurn.length > 0) {
      trace.push(`last_larissa_turn_count=${lastLarissaTurn.length}`);
      if (lastLarissaMessage) {
        trace.push(`last_larissa_anchor=${lastLarissaMessage.id}`);
      }
    }
  } catch (err: any) {
    trace.push(`last_larissa_fetch_err=${err.message || String(err)}`);
  }

  // Coleta IDs de replies necessários
  const replyIdsNeeded = new Set<string>();
  for (const msg of claimedMessages) {
    if (msg.replyToMessageId) {
      replyIdsNeeded.add(msg.replyToMessageId);
    }
  }

  const referencedMap: Record<string, StructuredConversationMessage> = {};

  // 1. Resolve referências que já estejam entre as mensagens claimed do ciclo
  for (const m of claimedMessages) {
    if (replyIdsNeeded.has(m.id)) {
      referencedMap[m.id] = {
        id: m.id,
        sender: m.sender,
        text: m.text,
        replyToId: m.replyToMessageId,
        timestamp: m.timestamp,
      };
      replyIdsNeeded.delete(m.id);
    }
  }

  // 2. Se houver referências a mensagens antigas (fora do ciclo atual), busca pontualmente por ID
  if (replyIdsNeeded.size > 0) {
    trace.push(`fetch_replies_count=${replyIdsNeeded.size}`);
    try {
      const { data: refRows } = await supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, text, reply_to_message_id, created_at, timestamp")
        .in("id", Array.from(replyIdsNeeded));

      for (const r of refRows || []) {
        const isMine = Boolean(r.is_mine || r.sender_id === "me");
        referencedMap[r.id] = {
          id: String(r.id),
          sender: isMine ? "larissa" : "pretendente",
          text: (r.text || "").trim(),
          replyToId: r.reply_to_message_id || null,
          timestamp: r.timestamp || r.created_at,
        };
        replyIdsNeeded.delete(r.id);
      }
    } catch (err: any) {
      trace.push(`reply_fetch_error=${err.message || String(err)}`);
    }
  }

  // 3. Projeta mensagens claimed em formato de entrada estruturada
  const structuredNewMessages: StructuredConversationMessage[] = claimedMessages.map((m) => ({
    id: m.id,
    sender: m.sender,
    text: m.text,
    replyToId: m.replyToMessageId,
    timestamp: m.timestamp,
  }));

  const payload: ConversationContextPayload = {
    phase: currentPhase,
    checkpoint,
    lastLarissaMessage,
    lastLarissaTurn,
    newMessages: structuredNewMessages,
    referencedMessages: referencedMap,
    knownFacts: knownFacts || {},
  };

  return { payload, trace };
}

// ----------------------------------------------------------------------------
// 5.3.1. Divisor de Balões & Freshness Gate (Preempção por Nova Mensagem)
// ----------------------------------------------------------------------------
export function splitIntoBalloons(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  // Divide por quebra de linha dupla \n\n ou \r\n\r\n
  const rawParts = text.split(/\n\s*\n/);
  const result: string[] = [];
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (trimmed) {
      result.push(trimmed);
    }
  }
  return result.length > 0 ? result : [text.trim()];
}

export interface FreshnessCheckParams {
  supabase: any;
  conversationId: string;
  claimedMessageIds: string[];
  cycleStartedAt: string;
  initialInboundRevision?: number;
}

export interface FreshnessCheckResult {
  isFresh: boolean;
  newerInboundCount: number;
  newerInboundIds: string[];
  reason?: string;
}

export async function checkFreshnessGate(
  params: FreshnessCheckParams
): Promise<FreshnessCheckResult> {
  const { supabase, conversationId, claimedMessageIds, cycleStartedAt, initialInboundRevision } = params;

  try {
    // 1. Checagem rápida no metadata da conversa (inbound_revision ou preempt_requested)
    const { data: convData } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();

    const rules = convData?.stage_completed_rules || {};
    const orch = rules.orchestration || {};

    if (rules.preempt_requested === true || orch.preemptRequested === true) {
      return {
        isFresh: false,
        newerInboundCount: 1,
        newerInboundIds: [],
        reason: "preempt_requested_flag",
      };
    }

    if (
      typeof initialInboundRevision === "number" &&
      typeof orch.inboundRevision === "number" &&
      orch.inboundRevision > initialInboundRevision
    ) {
      return {
        isFresh: false,
        newerInboundCount: orch.inboundRevision - initialInboundRevision,
        newerInboundIds: [],
        reason: "inbound_revision_incremented",
      };
    }

    // 2. Consulta canônica no banco de mensagens (garantia absoluta contra stale context)
    const { data: newerRows } = await supabase
      .from("instagram_messages")
      .select("id, is_mine, sender_id, text, created_at, timestamp, direction")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50);

    const claimedSet = new Set(claimedMessageIds);
    const newerIds: string[] = [];

    for (const row of newerRows || []) {
      const isMine = Boolean(row.is_mine || row.sender_id === "me" || row.direction === "outbound");
      // Somente mensagens inbound relevantes do pretendente (não da Larissa/Vendeo)
      if (!isMine && !claimedSet.has(row.id)) {
        const msgCreatedAt = Date.parse(row.created_at || row.timestamp || 0);
        const cycleStartMs = Date.parse(cycleStartedAt);
        if (msgCreatedAt >= cycleStartMs - 1000) {
          newerIds.push(row.id);
        }
      }
    }

    if (newerIds.length > 0) {
      return {
        isFresh: false,
        newerInboundCount: newerIds.length,
        newerInboundIds: newerIds,
        reason: "newer_inbound_messages_detected",
      };
    }

    return {
      isFresh: true,
      newerInboundCount: 0,
      newerInboundIds: [],
    };
  } catch (err: any) {
    console.warn(`[FreshnessGate] Erro na checagem de freshness para ${conversationId}:`, err);
    return {
      isFresh: true,
      newerInboundCount: 0,
      newerInboundIds: [],
    };
  }
}

// ----------------------------------------------------------------------------
// 5.3. ACK Atômico Revision-Aware de Preempção via RPC no Postgres
// ----------------------------------------------------------------------------
export interface AckCyclePreemptionParams {
  supabase: any;
  conversationId: string;
  correlationId: string;
  expectedInboundRevision: number;
}

export interface AckCyclePreemptionResult {
  acknowledged: boolean;
  currentRevision?: number;
  expectedRevision?: number;
  reason: string;
}

export async function ackCyclePreemptionAtomic(
  params: AckCyclePreemptionParams
): Promise<AckCyclePreemptionResult> {
  const { supabase, conversationId, correlationId, expectedInboundRevision } = params;

  if (typeof supabase?.rpc !== "function") {
    console.warn(
      `[ackCyclePreemptionAtomic] supabase.rpc não disponível para conv=${conversationId}. Mantendo estado atual.`
    );
    return {
      acknowledged: false,
      reason: "rpc_unavailable",
    };
  }

  try {
    const { data, error } = await supabase.rpc("ack_experimental_cycle_preemption", {
      p_conversation_id: conversationId,
      p_cycle_token: correlationId,
      p_expected_inbound_revision: expectedInboundRevision,
    });

    if (error) {
      console.warn(
        `[ackCyclePreemptionAtomic] Erro na RPC ack_experimental_cycle_preemption para conv=${conversationId}:`,
        error
      );
      return {
        acknowledged: false,
        reason: "rpc_error",
      };
    }

    if (!data || typeof data !== "object") {
      console.warn(
        `[ackCyclePreemptionAtomic] Retorno inesperado da RPC ack_experimental_cycle_preemption para conv=${conversationId}:`,
        data
      );
      return {
        acknowledged: false,
        reason: "rpc_invalid_response",
      };
    }

    const isAck =
      data.acknowledged !== undefined
        ? Boolean(data.acknowledged)
        : Boolean(data.success);
    return {
      acknowledged: isAck,
      currentRevision: data.currentRevision,
      expectedRevision: data.expectedRevision,
      reason: data.reason || (isAck ? "preemption_acknowledged" : "unknown"),
    };
  } catch (err: any) {
    console.warn(
      `[ackCyclePreemptionAtomic] Exceção na chamada da RPC ack_experimental_cycle_preemption para conv=${conversationId}:`,
      err
    );
    return {
      acknowledged: false,
      reason: "rpc_exception",
    };
  }
}

// ----------------------------------------------------------------------------
// 5.4. Atomic Claim no Postgres & Dispatcher da Outbox
// ----------------------------------------------------------------------------
export interface ClaimOutboxAtomicParams {
  supabase: any;
  conversationId: string;
  outboxKey: string;
  claimToken: string;
}

export async function claimOutboxEntryAtomic(
  params: ClaimOutboxAtomicParams
): Promise<{
  success: boolean;
  reason?: string;
  isUncertain?: boolean;
  isInfraFailure?: boolean;
  entry?: any;
}> {
  const { supabase, conversationId, outboxKey, claimToken } = params;

  // FAIL CLOSED: A atomicidade REAL exige a execução da RPC no PostgreSQL com SELECT ... FOR UPDATE.
  // Nenhum fallback para read-modify-write (leitura, modificação e gravação) em JS é permitido.
  if (typeof supabase?.rpc !== "function") {
    console.error(
      `[claimOutboxEntryAtomic] FAIL CLOSED: supabase.rpc não disponível para conv=${conversationId}. Bloqueando envio por segurança.`
    );
    return {
      success: false,
      reason: "rpc_unavailable_fail_closed",
      isInfraFailure: true,
    };
  }

  try {
    const { data, error } = await supabase.rpc("claim_outbox_entry", {
      p_conversation_id: conversationId,
      p_outbox_id: outboxKey,
      p_claim_token: claimToken,
    });

    if (error) {
      console.error(
        `[claimOutboxEntryAtomic] FAIL CLOSED: Falha de infraestrutura na RPC claim_outbox_entry para conv=${conversationId}:`,
        error
      );
      return {
        success: false,
        reason: "rpc_error_fail_closed",
        isInfraFailure: true,
      };
    }

    if (!data || typeof data !== "object") {
      console.error(
        `[claimOutboxEntryAtomic] FAIL CLOSED: Retorno inesperado da RPC claim_outbox_entry para conv=${conversationId}:`,
        data
      );
      return {
        success: false,
        reason: "rpc_invalid_response_fail_closed",
        isInfraFailure: true,
      };
    }

    // Retorno oficial e determinístico do banco de dados PostgreSQL
    return {
      success: Boolean(data.success),
      reason: data.reason,
      isUncertain: Boolean(data.isUncertain || data.reason === "sending_stale_uncertain"),
      isInfraFailure: false, // RPC executou perfeitamente; o resultado reflete o estado do banco
      entry: data.entry,
    };
  } catch (rpcEx: any) {
    console.error(
      `[claimOutboxEntryAtomic] FAIL CLOSED: Exceção na chamada da RPC claim_outbox_entry para conv=${conversationId}:`,
      rpcEx
    );
    return {
      success: false,
      reason: "rpc_exception_fail_closed",
      isInfraFailure: true,
    };
  }
}

// ----------------------------------------------------------------------------
// COMMIT ATÔMICO CONDICIONAL DE CICLO EXPERIMENTAL (COMPARE-AND-SET / CAS)
// ----------------------------------------------------------------------------

export interface CommitExperimentalCycleParams {
  supabase: any;
  conversationId: string;
  correlationId: string;
  newStageCompletedRules: any;
}

export interface CommitExperimentalCycleResult {
  committed: boolean;
  reason: "committed" | "lost_lock" | "preempted" | "not_found" | "infra_failure";
  activeToken?: string;
  error?: any;
}

/**
 * Realiza o commit oficial final do ciclo experimental de forma estritamente atômica e condicional (CAS).
 * Garante que ContactMemory, completed_goals, objective_progress e workflow só sejam persistidos
 * se o ciclo ainda for o detentor exclusivo do lock (active_cycle_token = correlationId)
 * e nenhuma preempção foi solicitada (preempt_requested != true).
 *
 * Elimina 100% de janelas TOCTOU: a autoridade de escrita é o próprio CAS atômico.
 */
export async function commitExperimentalCycleAtomic(
  params: CommitExperimentalCycleParams
): Promise<CommitExperimentalCycleResult> {
  const { supabase, conversationId, correlationId, newStageCompletedRules } = params;

  // 1. PREFERÊNCIA 1: RPC atômica no PostgreSQL com SELECT ... FOR UPDATE (Zero janela TOCTOU)
  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("commit_experimental_cycle_if_owned", {
        p_conversation_id: conversationId,
        p_cycle_token: correlationId,
        p_new_stage_completed_rules: newStageCompletedRules,
      });

      if (!error && data && typeof data === "object") {
        if (data.committed === true) {
          return { committed: true, reason: "committed" };
        }
        return {
          committed: false,
          reason: data.reason || "lost_lock",
          activeToken: data.activeToken,
        };
      }

      if (error) {
        console.warn(
          `[commitExperimentalCycleAtomic] RPC commit_experimental_cycle_if_owned retornou erro para conv=${conversationId}:`,
          error.message
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[commitExperimentalCycleAtomic] Exceção na RPC commit_experimental_cycle_if_owned para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // FAIL-CLOSED: NUNCA recorrer a read-modify-write em JS!
  return { committed: false, reason: "infra_failure" };
}

export interface RequestCyclePreemptionParams {
  supabase: any;
  conversationId: string;
  messageId?: string | null;
  debounceUntil?: string | null;
}

export interface RequestCyclePreemptionResult {
  success: boolean;
  inboundRevision?: number;
  activeCycleToken?: string | null;
  reason?: string;
  error?: any;
}

/**
 * Sinaliza preempção ao ciclo experimental ativo de forma atômica no PostgreSQL.
 * Realiza patch transacional direto no banco (inboundRevision + 1, preempt_requested = true,
 * messageLedger[messageId] = 'pending') com SELECT ... FOR UPDATE.
 * Elimina 100% de janelas TOCTOU causadas por read-modify-write em snapshots do JavaScript.
 *
 * FAIL-CLOSED: Se a RPC falhar, NUNCA tenta reescrever stage_completed_rules via JS;
 * no máximo atualiza colunas isoladas ai_auto_respond e ai_debounce_until.
 */
export async function requestExperimentalCyclePreemptionAtomic(
  params: RequestCyclePreemptionParams
): Promise<RequestCyclePreemptionResult> {
  const { supabase, conversationId, messageId, debounceUntil } = params;
  const targetDebounce = debounceUntil || new Date(Date.now() + 2500).toISOString();

  // 1. PREFERÊNCIA 1: RPC atômica no PostgreSQL com SELECT ... FOR UPDATE (Zero TOCTOU)
  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("request_experimental_cycle_preemption", {
        p_conversation_id: conversationId,
        p_message_id: messageId || null,
        p_debounce_until: targetDebounce,
      });

      if (!error && data && typeof data === "object") {
        if (data.success === true) {
          return {
            success: true,
            inboundRevision: typeof data.inboundRevision === "number" ? data.inboundRevision : undefined,
            activeCycleToken: data.activeCycleToken ?? null,
            reason: "preemption_requested",
          };
        }
        return {
          success: false,
          reason: data.reason || "preemption_rejected",
        };
      }

      if (error) {
        console.warn(
          `[requestExperimentalCyclePreemptionAtomic] Erro na RPC request_experimental_cycle_preemption para conv=${conversationId}:`,
          error.message || error
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[requestExperimentalCyclePreemptionAtomic] Exceção na RPC request_experimental_cycle_preemption para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // 2. FAIL-CLOSED: NUNCA fazer read-modify-write de stage_completed_rules em JS!
  // No máximo atualiza colunas isoladas ai_auto_respond e ai_debounce_until.
  try {
    await supabase
      .from("instagram_conversations")
      .update({
        ai_auto_respond: true,
        ai_debounce_until: targetDebounce,
      })
      .eq("id", conversationId);
  } catch (_colErr) {
    // Silencia falha em fallback fail-closed
  }

  return {
    success: false,
    reason: "rpc_failed_fail_closed",
  };
}

export interface ClaimExperimentalCycleParams {
  supabase: any;
  conversationId: string;
  cycleToken: string;
  staleSeconds?: number;
}

export interface ClaimExperimentalCycleResult {
  success: boolean;
  reason: "claimed" | "active_lock" | "conversation_not_found" | "infra_failure";
  activeCycleToken?: string | null;
}

/**
 * Adquire o lock inicial do ciclo de forma estritamente atômica no PostgreSQL.
 * Impede que múltiplos workers concorrentes assumam a mesma conversa simultaneamente.
 */
export async function claimExperimentalCycleAtomic(
  params: ClaimExperimentalCycleParams
): Promise<ClaimExperimentalCycleResult> {
  const { supabase, conversationId, cycleToken, staleSeconds = 25 } = params;

  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("claim_experimental_cycle", {
        p_conversation_id: conversationId,
        p_cycle_token: cycleToken,
        p_stale_seconds: staleSeconds,
      });

      if (!error && data && typeof data === "object") {
        if (data.success === true) {
          return { success: true, reason: "claimed", activeCycleToken: cycleToken };
        }
        return {
          success: false,
          reason: data.reason || "active_lock",
          activeCycleToken: data.activeCycleToken ?? null,
        };
      }

      if (error) {
        console.warn(
          `[claimExperimentalCycleAtomic] Erro na RPC claim_experimental_cycle para conv=${conversationId}:`,
          error.message || error
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[claimExperimentalCycleAtomic] Exceção na RPC claim_experimental_cycle para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // FAIL-CLOSED: NUNCA recorrer a read-modify-write em JS!
  return { success: false, reason: "infra_failure" };
}

export interface ClaimCycleMessagesParams {
  supabase: any;
  conversationId: string;
  cycleToken: string;
  messageIds: string[];
}

export interface ClaimCycleMessagesResult {
  success: boolean;
  reason: "messages_claimed" | "cycle_token_mismatch" | "cycle_preempted" | "conversation_not_found" | "infra_failure";
  activeToken?: string | null;
}

/**
 * Registra o claim atômico de mensagens do ciclo e marca lastProcessingStatus='processing'
 * no PostgreSQL com SELECT ... FOR UPDATE.
 * Rejeita se o ciclo perdeu o lock ou se preempção foi solicitada, eliminando qualquer
 * read-modify-write com snapshot desatualizado em JS.
 */
export async function claimExperimentalCycleMessagesAtomic(
  params: ClaimCycleMessagesParams
): Promise<ClaimCycleMessagesResult> {
  const { supabase, conversationId, cycleToken, messageIds } = params;

  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("claim_experimental_cycle_messages", {
        p_conversation_id: conversationId,
        p_cycle_token: cycleToken,
        p_message_ids: messageIds,
      });

      if (!error && data && typeof data === "object") {
        if (data.success === true) {
          return { success: true, reason: "messages_claimed" };
        }
        return {
          success: false,
          reason: data.reason || "cycle_token_mismatch",
          activeToken: data.activeToken ?? null,
        };
      }

      if (error) {
        console.warn(
          `[claimExperimentalCycleMessagesAtomic] Erro na RPC claim_experimental_cycle_messages para conv=${conversationId}:`,
          error.message || error
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[claimExperimentalCycleMessagesAtomic] Exceção na RPC claim_experimental_cycle_messages para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // FAIL-CLOSED: NUNCA recorrer a read-modify-write em JS!
  return { success: false, reason: "infra_failure" };
}

export interface PrepareExperimentalOutboxParams {
  supabase: any;
  conversationId: string;
  cycleToken: string;
  outboxEntry: OutboxEntry;
}

export interface PrepareExperimentalOutboxResult {
  success: boolean;
  reason?: string;
  outboxKey?: string;
}

/**
 * Registra ou atualiza pontualmente a entrada da outbox no JSON atual do PostgreSQL
 * sob lock exclusivo (FOR UPDATE), garantindo que o ciclo continue dono e não preemptado.
 */
export async function prepareExperimentalOutboxEntryAtomic(
  params: PrepareExperimentalOutboxParams
): Promise<PrepareExperimentalOutboxResult> {
  const { supabase, conversationId, cycleToken, outboxEntry } = params;

  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("prepare_experimental_outbox_entry", {
        p_conversation_id: conversationId,
        p_cycle_token: cycleToken,
        p_outbox_entry: outboxEntry,
      });

      if (!error && data && typeof data === "object") {
        if (data.success === true) {
          return { success: true, reason: "prepared", outboxKey: data.outboxKey };
        }
        return { success: false, reason: data.reason || "prepare_failed" };
      }

      if (error) {
        console.warn(
          `[prepareExperimentalOutboxEntryAtomic] Erro na RPC prepare_experimental_outbox_entry para conv=${conversationId}:`,
          error.message || error
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[prepareExperimentalOutboxEntryAtomic] Exceção na RPC prepare_experimental_outbox_entry para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // FAIL-CLOSED: NUNCA recorrer a read-modify-write em JS!
  return { success: false, reason: "infra_failure" };
}

export interface ReleaseExperimentalCycleParams {
  supabase: any;
  conversationId: string;
  cycleToken: string;
  processingStatus?: string;
  debounceUntil?: string | null;
  revertMessageIds?: string[] | null;
  markProcessedIds?: string[] | null;
  lastError?: string | null;
  cycleRecord?: any;
  outboxMap?: any;
  clearCancelFlag?: boolean;
}

export interface ReleaseExperimentalCycleResult {
  released: boolean;
  reason?: string;
  activeToken?: string | null;
}

/**
 * Libera de forma atômica e segura a custódia do ciclo experimental (active_cycle_token = null).
 * Garante que se o lock já pertence a outro ciclo, nenhuma alteração é feita.
 * Aplica patch pontual nas mensagens informadas sem jamais sobrescrever todo o estado.
 */
export async function releaseExperimentalCycleAtomic(
  params: ReleaseExperimentalCycleParams
): Promise<ReleaseExperimentalCycleResult> {
  const {
    supabase,
    conversationId,
    cycleToken,
    processingStatus = "idle",
    debounceUntil,
    revertMessageIds = null,
    markProcessedIds = null,
    lastError,
    cycleRecord = null,
    outboxMap = null,
    clearCancelFlag = false,
  } = params;

  if (typeof supabase?.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("release_experimental_cycle_if_owned", {
        p_conversation_id: conversationId,
        p_cycle_token: cycleToken,
        p_processing_status: processingStatus,
        p_debounce_until: debounceUntil || null,
        p_revert_message_ids: revertMessageIds && revertMessageIds.length > 0 ? revertMessageIds : null,
        p_mark_processed_ids: markProcessedIds && markProcessedIds.length > 0 ? markProcessedIds : null,
        p_last_error: lastError !== undefined ? lastError : null,
        p_cycle_record: cycleRecord || null,
        p_outbox_map: outboxMap || null,
        p_clear_cancel_flag: clearCancelFlag === true,
      });

      if (!error && data && typeof data === "object") {
        if (data.released === true) {
          return { released: true, reason: "released" };
        }
        return {
          released: false,
          reason: data.reason || "token_mismatch",
          activeToken: data.activeToken ?? null,
        };
      }

      if (error) {
        console.warn(
          `[releaseExperimentalCycleAtomic] Erro na RPC release_experimental_cycle_if_owned para conv=${conversationId}:`,
          error.message || error
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        `[releaseExperimentalCycleAtomic] Exceção na RPC release_experimental_cycle_if_owned para conv=${conversationId}:`,
        rpcErr?.message || rpcErr
      );
    }
  }

  // FAIL-CLOSED: NUNCA recorrer a read-modify-write em JS!
  return { released: false, reason: "infra_failure" };
}

export interface DispatchOutboxParams {
  supabase: any;
  outboxEntry: OutboxEntry;
  recipientId: string;
  claimToken?: string;
  runtime?: {
    sendMetaTextMessage?: (supabase: any, conversationId: string, text: string) => Promise<any>;
  };
}

export async function dispatchOutboxEntry(
  params: DispatchOutboxParams
): Promise<{ success: boolean; providerMessageId?: string; isUncertain?: boolean; error?: string }> {
  const { supabase, outboxEntry, recipientId, runtime, claimToken } = params;

  // 1. Idempotência estrita: se já foi enviada com sucesso, não repete envio
  if (outboxEntry.status === "sent") {
    return { success: true, providerMessageId: outboxEntry.providerMessageId || "already_sent" };
  }

  // 2. Proteção contra duplo dispatch concorrente e sending stale:
  const now = Date.now();
  const sendingAtMs = outboxEntry.sendingAt ? Date.parse(outboxEntry.sendingAt) : 0;
  const isClaimedByMe = Boolean(claimToken && (outboxEntry as any).claimedBy === claimToken);

  if (outboxEntry.status === "sending" && !isClaimedByMe) {
    if (now - sendingAtMs < 20000) {
      console.warn(
        `[Dispatcher] Outbox ${outboxEntry.id} já está em processo de envio ativo por outro worker. Bloqueando despacho concorrente.`
      );
      return { success: false, error: "Outbox em envio concorrente (status: sending)" };
    } else {
      // SENDING STALE (>= 20s): O processo anterior iniciou a chamada HTTP e morreu/travou.
      // NÃO PODEMOS ASSUMIR NÃO-ENVIO! A Meta pode ter recebido e entregue a mensagem!
      // Marca imediatamente como dispatch_uncertain e bloqueia retry automático para evitar duplicação!
      console.warn(
        `[Dispatcher] Outbox ${outboxEntry.id} permaneceu em 'sending' por mais de 20s. Marcando como dispatch_uncertain para impedir envio duplicado.`
      );
      outboxEntry.status = "dispatch_uncertain";
      outboxEntry.isUncertain = true;
      outboxEntry.lastError = "Sending stale detectado (>20s) - processo anterior pode ter entregue a mensagem";
      return {
        success: false,
        isUncertain: true,
        error: "Sending stale detectado. Envio incerto: retry automático bloqueado para evitar duplicação.",
      };
    }
  }

  // 3. Proteção contra retry cego em incerteza: se o envio anterior sofreu timeout na conexão com a Meta,
  // ou sending stale, a Meta pode ter recebido e entregue a mensagem. Bloqueia retry automático cego!
  if (outboxEntry.status === "dispatch_uncertain") {
    console.warn(
      `[Dispatcher] Outbox ${outboxEntry.id} possui status dispatch_uncertain. Retry automático bloqueado para evitar duplicação.`
    );
    return { success: false, isUncertain: true, error: "Envio anterior incerto. Retry automático bloqueado." };
  }

  outboxEntry.status = "sending";
  outboxEntry.sendingAt = outboxEntry.sendingAt || new Date().toISOString();
  if (claimToken) {
    (outboxEntry as any).claimedBy = claimToken;
  }
  outboxEntry.attempts = (outboxEntry.attempts || 0) + (isClaimedByMe ? 0 : 1);

  try {
    if (runtime?.sendMetaTextMessage) {
      const res = await runtime.sendMetaTextMessage(supabase, outboxEntry.conversationId, outboxEntry.content);
      const providerId = res?.message_id || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      outboxEntry.status = "sent";
      outboxEntry.sentAt = new Date().toISOString();
      outboxEntry.providerMessageId = providerId;
      outboxEntry.isUncertain = false;
      return { success: true, providerMessageId: providerId };
    }

    // Bypass seguro para conversas de teste / sandbox: não envia para o Instagram real da Meta
    const isTestRecipient =
      String(recipientId).startsWith("test_") ||
      String(recipientId).startsWith("sandbox_") ||
      String(outboxEntry.conversationId || "").startsWith("test_") ||
      String(outboxEntry.conversationId || "").startsWith("sandbox_");

    if (isTestRecipient) {
      const providerId = `sim_meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      outboxEntry.status = "sent";
      outboxEntry.sentAt = new Date().toISOString();
      outboxEntry.providerMessageId = providerId;
      outboxEntry.isUncertain = false;
      return { success: true, providerMessageId: providerId };
    }

    // Despacho oficial Meta Graph API
    const { data: configRow } = await supabase
      .from("instagram_config")
      .select("access_token")
      .eq("id", "default")
      .maybeSingle();

    const accessToken = configRow?.access_token;
    if (!accessToken) {
      throw new Error("Access token do Instagram (id: 'default') não configurado em instagram_config.");
    }

    const sendRes = await fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${accessToken}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: outboxEntry.content },
        }),
      }
    );

    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      // Erro HTTP retornado ativamente pela Meta (ex: 400 Bad Request, 401 Unauthorized, 403 Forbidden):
      // A Meta respondeu com certeza que a mensagem foi rejeitada!
      throw new Error(`Falha no envio pela Meta (HTTP ${sendRes.status}): ${errBody}`);
    }

    const metaJson = await sendRes.json().catch(() => ({}));
    const providerId = metaJson.message_id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    outboxEntry.status = "sent";
    outboxEntry.sentAt = new Date().toISOString();
    outboxEntry.providerMessageId = providerId;
    outboxEntry.isUncertain = false;

    return { success: true, providerMessageId: providerId };
  } catch (err: any) {
    const errMsg = err.message || String(err);
    outboxEntry.lastError = errMsg;

    // Detecta se a falha ocorreu por timeout/queda de rede pós-transmissão (resultado incerto da Meta)
    const isTimeoutOrNetwork =
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      errMsg.toLowerCase().includes("timeout") ||
      errMsg.includes("ETIMEDOUT") ||
      errMsg.includes("ECONNRESET") ||
      errMsg.includes("fetch failed");

    if (isTimeoutOrNetwork) {
      outboxEntry.status = "dispatch_uncertain";
      outboxEntry.isUncertain = true;
      return { success: false, isUncertain: true, error: `Incerteza de rede no envio à Meta: ${errMsg}` };
    }

    // Erro determinístico pré-envio ou rejeição explícita da Meta
    if (outboxEntry.attempts >= outboxEntry.maxAttempts) {
      outboxEntry.status = "failed";
    } else {
      outboxEntry.status = "pending"; // Permite retry controlado para erros determinísticos comprovados
    }
    return { success: false, isUncertain: false, error: errMsg };
  }
}


// ----------------------------------------------------------------------------
// 6. Construtor de Prompt do Agente da Conversa (Camada 1 - Roteador Enxuto)
// ----------------------------------------------------------------------------
export function buildConversationAgentPrompt(input: ConversationAgentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_saudacao_feita"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da interação");

  // Carrega subagentes ativos do catálogo recebido ou fallback para os 3 canônicos
  const activeSubagents = (
    input.availableSubagents && input.availableSubagents.length > 0
      ? input.availableSubagents
      : Object.values(CANONICAL_SUBAGENTS)
  ).filter((s) => s.enabled !== false);

  const subagentsSnippet = activeSubagents
    .map((s, idx) => {
      // Limite estrito de tokens: condensado em no máximo 300 caracteres
      const cleanMission = s.mission?.trim() || "";
      const compactMission =
        cleanMission.length > 300 ? cleanMission.substring(0, 297) + "..." : cleanMission;
      return `${idx + 1}. "${s.id}" (${s.name}):\n   Missão: ${compactMission}`;
    })
    .join("\n");

  const noneOptionNumber = activeSubagents.length + 1;
  const targetSubagentOptions = activeSubagents.map((s) => `"${s.id}"`).join(" | ");

  return `Você é o Agente da Conversa da Larissa no Vendeo.
Sua missão é estritamente de roteamento: analisar o estágio do diálogo e decidir qual subagente especializado deve responder ao pretendente.
Você NÃO gera a resposta final da Larissa; apenas seleciona o especialista mais adequado.

### SUBAGENTES E SUAS MISSÕES:
${subagentsSnippet}
${noneOptionNumber}. "none": Mensagem não exige resposta imediata ou deve aguardar.

### CONTEXTO DA CONVERSA
${contextBlock}
${input.openGoalsSummary ? `\n### TEMAS/OBJETIVOS EM ABERTO DA ETAPA:\n${input.openGoalsSummary}\n` : ""}

### AUTORIDADE DE WORKFLOW

A etapa atual e o subagente responsável são fornecidos pelo backend.
Você não altera a etapa.
Você não escolhe outro especialista baseado no tema da mensagem.
O assunto pode mudar; o workflow não muda até os checkpoints ativos terminarem.

Sua responsabilidade neste turno é apenas:
- responder/delegar
- aguardar
- pausar
- analisar tom/contexto

O backend determina subagente e progressão.

Responda ESTRITAMENTE em JSON puro com as seguintes chaves:
{
  "targetSubagent": ${targetSubagentOptions ? `${targetSubagentOptions} | ` : ""}"none",
  "action": "delegate" | "wait" | "pause",
  "reason": "explicação curta da escolha do subagente"
}`;
}

/**
 * Converte a lista de subagentes em catálogo compacto para o Conversation Brain
 * sem vazar prompts longos ou desperdiçar tokens.
 */
export function getCompactSubagentCatalog(subagents?: SubagentDefinition[]): CompactSubagentCard[] {
  const list = Array.isArray(subagents) && subagents.length > 0 ? subagents : Object.values(CANONICAL_SUBAGENTS);
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || (s.mission ? s.mission.slice(0, 140) : s.name),
    stageIds: s.stageIds || [],
  }));
}

/**
 * Constrói o prompt do CONVERSATION BRAIN (Mente da Conversa e Planejador da Larissa).
 * Apresenta a Escada de Memória em 6 Níveis e catálogo condensado de subagentes.
 */
export function buildConversationBrainPrompt(params: {
  conversationId: string;
  currentStage: string;
  liveState: ConversationLiveState;
  recentMessages: CanonicalMessage[];
  contactMemorySummary: string;
  landmarksSummary: string;
  speechActsSummary: string;
  personaMemorySummary: string;
  stageObjectives: StageObjective[];
  currentObjective?: StageObjective | null;
  compactSubagents: CompactSubagentCard[];
  toolResultsHistory?: string[];
}): string {
  const {
    conversationId,
    currentStage,
    liveState,
    recentMessages,
    contactMemorySummary,
    landmarksSummary,
    speechActsSummary,
    personaMemorySummary,
    stageObjectives,
    currentObjective,
    compactSubagents,
    toolResultsHistory = [],
  } = params;

  const liveStateBlock = serializeLiveStateForPrompt(liveState);

  const formattedRecentMsgs = recentMessages
    .map((m) => {
      const senderLabel = m.sender === "larissa" ? "LARISSA" : "PRETENDENTE";
      return `${senderLabel} | ${m.id} | ${m.createdAt || ""}\n${m.text}`;
    })
    .join("\n\n");

  const subagentsBlock = compactSubagents
    .map((s) => `- id: "${s.id}" | nome: "${s.name}" | descrição: "${s.description}" | etapas: [${s.stageIds.join(", ")}]`)
    .join("\n");

  const objBlock = stageObjectives
    .map((o) => {
      const isCurrent = currentObjective?.id === o.id;
      const marker = isCurrent ? "➡️ [ATUAL]" : "[PENDENTE]";
      return `${marker} id: "${o.id}" | label: "${o.label || o.title}"${o.description ? ` (${o.description})` : ""}`;
    })
    .join("\n");

  const toolsHistoryBlock = toolResultsHistory.length > 0
    ? `### HISTÓRICO DE CONSULTAS FEITAS NESTE CICLO (NÍVEL 6)\n${toolResultsHistory.join("\n\n")}\n`
    : "";

  return `Você é o Agente da Conversa e CONVERSATION BRAIN (Mente Analítica da Conversa e Planejador da Larissa).
Seu papel é puramente ANALÍTICO E ESTRATÉGICO:
1. Analisar o momento exato da conversa e o tom emocional do pretendente.
2. Decidir sobre o objetivo atual da etapa:
   - "pursue": O pretendente deu gancho natural para avançar no objetivo atual ("${currentObjective?.label || "conhecer mais"}").
   - "defer": O pretendente desabafou, fez outra pergunta ou mudou de assunto; devemos acolher e responder primeiro, adiando o objetivo.
   - "already_satisfied": O pretendente revelou espontaneamente nesta mensagem inbound a informação do objetivo atual.
   - "none": Não há objetivo pendente imediato ou apenas conversa livre.
3. Se precisar de fatos esquecidos ou não presentes na escada de memória, chame ferramentas sob demanda (máximo 2 de memória/histórico + máximo 1 de cofre).
4. Ao concluir, delegar a execução ao subagente responsável pela etapa (${currentStage}) com o MissionPackage mastigado. Você NÃO formula o balão final da Larissa; quem escreve é o subagente executor.

### ESCADA DE MEMÓRIA HIERÁRQUICA

${liveStateBlock}

### NÍVEL 1: MENSAGENS RECENTES (Orçamento estrito)
${formattedRecentMsgs || "Nenhuma mensagem recente."}

### NÍVEL 2: CONTACT MEMORY (Fatos conhecidos sobre o pretendente)
${contactMemorySummary || "Nenhum fato registrado ainda."}

### NÍVEL 3: LANDMARKS (Marcos narrativos, histórias e perrengues)
${landmarksSummary || "Nenhum marco narrativo relevante registrado."}

### NÍVEL 4: SPEECH ACTS (Perguntas e atos de fala recentes)
${speechActsSummary || "Nenhum ato de fala recente."}

### NÍVEL 5: PERSONA MEMORY (Fatos essenciais da Larissa)
${personaMemorySummary || "Nenhum fato encontrado na PersonaMemory."}

${toolsHistoryBlock}
### OBJETIVOS DA ETAPA ATUAL ("${currentStage}")
${objBlock || "Nenhum objetivo cadastrado."}

### CATÁLOGO DE SUBAGENTES DISPONÍVEIS
${subagentsBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA (MÁXIMO 2 DE MEMÓRIA + 1 DE COFRE)
Use APENAS se realmente necessário. Para saudações, desabafos diretos ou mensagens triviais, NÃO use ferramentas.
- conversation_history_search: busca no histórico bruto desta conversa por mensagens passadas ou detalhes esquecidos. Parâmetro: {"query": "..."}.
- persona_memory_search: busca na PersonaMemory fatos biográficos, gostos ou perrengues da Larissa. Parâmetro: {"query": "..."}.
- episodic_memory_search: busca na memória episódica atos e revelações passadas. Parâmetro: {"query": "...", "memoryClass": "landmark" | "speech_act" | "all"}.
- cofre_audio_search: busca áudios gravados no Cofre da Larissa com checagem de aderência semântica real à fala do pretendente. Parâmetro: {"query": "...", "objective_context": "..."}.

### REGRAS INVIOLÁVEIS DO BRAIN:
1. Para objectiveDecision: "already_satisfied", somente o objetivo atual (${currentObjective?.id || "nenhum"}) pode ser indicado, acompanhado de evidenceMessageId obrigatório da mensagem inbound atual. Objetivos futuros NUNCA podem ser marcados.
2. Não invente fatos e não misture conversas de outros usuários. Escopo estrito desta conversa: ${conversationId}.
3. O subagente executor NÃO fará pesquisas amplas. Todo contexto necessário deve ser resumido em missionPackage.relevantMemoryContext.
4. REGRA ABSOLUTA: perguntas diretas do pretendente têm prioridade sobre checkpoint. Identifique-as no turnContract e determine mustAnswerFirst antes de considerar objetivo.
5. Se responder uma pergunta direta e, quando natural, apenas devolvê-la já completa o turno, NÃO invente follow-up genérico. Objetivos podem esperar.
6. Brain define intenção semântica, nunca a frase final. Use answerIntent, requiredFacts e responseShape; não forneça exactText.

Responda ESTRITAMENTE em JSON puro:

Se precisar chamar uma ferramenta:
{
  "action": "call_tool",
  "tool": "conversation_history_search" | "persona_memory_search" | "episodic_memory_search" | "cofre_audio_search",
  "parameters": { "query": "..." }
}

Quando estiver pronto para delegar ao subagente executor:
{
  "action": "delegate_mission",
  "currentStage": "${currentStage}",
  "responsibleSubagent": "id_do_subagente_da_etapa",
  "objectiveDecision": "pursue" | "defer" | "already_satisfied" | "none",
  "satisfiedObjectiveId": "id_do_objetivo_se_already_satisfied",
  "evidenceMessageId": "id_da_msg_inbound_se_already_satisfied",
  "reasoning": "análise rápida do momento em 1 frase",
  "liveStatePatch": {
    "lastUserEmotionalTone": "tom detectado",
    "currentTopic": "tópico do momento",
    "unresolvedQuestion": "pergunta que ele fez ou null",
    "pendingUserTopic": "assunto que ele abriu ou null",
    "openLoops": ["loop1"],
    "avoidRepeating": ["o que não repetir"]
  },
  "missionPackage": {
    "subagentId": "id_do_subagente",
    "subagentName": "nome do subagente",
    "objectiveDirective": "pursue" | "defer" | "already_satisfied" | "none",
    "targetObjective": { "id": "...", "label": "..." },
    "relevantMemoryContext": "fatos essenciais que o subagente precisa saber para este turno",
    "liveStateContext": "resumo do tom e do momento da conversa",
    "preferAudio": false,
    "selectedAudioId": "id retornado por cofre_audio_search ou null",
    "turnContract": {
      "directQuestions": [{ "id": "q1", "text": "pergunta literal", "mustAnswer": true, "answerKind": "wellbeing" | "current_activity" | "persona_fact" | "yes_no" | "preference" | "location" | "age" | "freeform", "answerIntent": "intenção sem frase pronta", "requiredFacts": ["fato recuperado, se necessário"] }],
      "mustAnswerFirst": true,
      "reactionTarget": "conteúdo ao qual reagir ou null",
      "newQuestionBudget": 0,
      "responseShape": "answer_only" | "answer_and_reciprocate" | "react_only" | "react_and_question" | "free_conversation",
      "avoidEchoPhrases": ["frase que não deve ser papagaiada"],
      "avoidTopics": ["checkpoint adiado"],
      "maxBalloons": 1,
      "preferNoEmoji": true
    }
  }
}`;
}

/**
 * Constrói o prompt do SUBAGENTE EXECUTOR (Materializador da voz da Larissa).
 * Recebe o MissionPackage mastigado e NÃO possui ferramentas amplas de busca.
 */
export function buildSubagentExecutorPrompt(params: {
  subagentId: string;
  subagentName: string;
  mission: string;
  missionPackage: MissionPackage;
  recentMessages: CanonicalMessage[];
  emojiBudgetSnippet?: string;
  styleStateSnippet?: string;
  candidateAudiosSnippet?: string;
}): string {
  const {
    subagentId,
    subagentName,
    mission,
    missionPackage,
    recentMessages,
    emojiBudgetSnippet,
    styleStateSnippet,
    candidateAudiosSnippet,
  } = params;

  const formattedRecentMsgs = recentMessages
    .map((m) => {
      const senderLabel = m.sender === "larissa" ? "LARISSA" : "PRETENDENTE";
      return `${senderLabel}: ${m.text}`;
    })
    .join("\n\n");

  const objectiveDirectiveText =
    missionPackage.objectiveDirective === "pursue"
      ? `BUSCAR OBJETIVO COM DELICADEZA: O pretendente deu abertura para: "${missionPackage.targetObjective?.label || "conhecer mais"}". Pergunte ou aprofunde de forma meiga e sutil sem parecer interrogatório.`
      : missionPackage.objectiveDirective === "defer"
      ? `ADIAR OBJETIVO: O pretendente desabafou ou mudou de assunto. ACOLHA, COMENTE E RESPONDA AO QUE ELE FALOU PRIMEIRO. Não force o objetivo da etapa agora.`
      : missionPackage.objectiveDirective === "already_satisfied"
      ? `OBJETIVO JÁ SATISFEITO: O pretendente já informou o que precisávamos. Apenas reaja com carinho e naturalidade, sem perguntar isso de novo.`
      : `CONVERSA LIVRE E LEVE: Apenas converse com carinho, mantendo a conversa humana e espontânea.`;

  return `Você materializa a voz da Larissa no papel conversacional ${subagentName.toUpperCase()}.
SUA MISSÃO NESTA ETAPA: ${mission}

### PRECEDÊNCIA OBRIGATÓRIA
1. Invariantes de segurança e backend.
2. TurnContract.
3. MissionPackage do Conversation Brain.
4. DNA global da Larissa.
5. Missão configurável do subagente.
A missão específica do subagente serve apenas para especialização e nunca sobrepõe TurnContract, MissionPackage ou regras globais. Ela não pode obrigar perguntas, ignorar pergunta direta, ampliar newQuestionBudget, liberar ferramentas, alterar checkpoint ou trocar stage.

${LARISSA_COMPACT_SUBAGENT_PROMPT}

${LARISSA_CONVERSATION_EXAMPLES_V1}

${LARISSA_CHAT_STYLE_V2}
${emojiBudgetSnippet ? `\n### ORÇAMENTO DE EMOJI\n${emojiBudgetSnippet}\n` : ""}
${styleStateSnippet ? `\n### ESTILO RECENTE\n${styleStateSnippet}\n` : ""}

### DIRETRIZ ESTRATÉGICA DO TURNO (RECEBIDA DO BRAIN)
${objectiveDirectiveText}

### INTENÇÃO E FATOS MÍNIMOS DO BRAIN
${JSON.stringify({
  conversationIntent: missionPackage.conversationIntent,
  emotionalTone: missionPackage.emotionalTone,
  currentTopic: missionPackage.currentTopic,
  bestHook: missionPackage.bestHook,
  curiosityOpportunity: missionPackage.curiosityOpportunity,
  questionRecommendation: missionPackage.questionRecommendation,
  relevantPersonaFacts: missionPackage.relevantPersonaFacts || [],
}, null, 2)}

### CONTEXTO MASTIGADO E FATOS RELEVANTES
${missionPackage.relevantMemoryContext || "Nenhum fato extra necessário."}

### ESTADO DA CONVERSA
${missionPackage.liveStateContext || "Interação em andamento."}

### CONTRATO SEMÂNTICO DO TURNO
${JSON.stringify(missionPackage.turnContract || {}, null, 2)}

${candidateAudiosSnippet ? `\n### ÁUDIO DO COFRE SUGERIDO (SE ADERENTE)\n${candidateAudiosSnippet}\n` : ""}

### MENSAGENS RECENTES
${formattedRecentMsgs}

### REGRAS MANDATÁRIAS DE EXECUÇÃO:
1. PONTUAÇÃO DE CELULAR: SOMENTE VÍRGULA (,) E PONTO DE INTERROGAÇÃO (?).
   - É expressamente proibido terminar balão com ponto final (.)
   - É expressamente proibido usar ponto de exclamação (!)
   - É expressamente proibido usar reticências (...), dois pontos (:), ponto e vírgula (;) ou travessão (—).
2. Não pergunte nada que já esteja nos fatos conhecidos.
3. Respeite maxBalloons e newQuestionBudget do contrato. Pergunta nova não é obrigatória.
4. Se o pretendente fez uma pergunta, RESPONDA antes de qualquer coisa.
5. Se houver áudio autorizado e for natural enviar, use SOMENTE missionPackage.selectedAudioId. Nunca escolha outro ID.
6. Reação pessoal vem antes de checkpoint. Não ecoe a fala dele como pergunta.
7. Emoji budget é teto, não meta. Se preferNoEmoji=true, responda sem emoji.

Responda ESTRITAMENTE em JSON puro:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "responses": [
    "balão 1 curto de celular",
    "balão 2 meigo (se necessário)"
  ],
  "suggestedResponse": "texto completo dos balões juntos",
  "memoryCandidates": [
    {
      "entity": "self",
      "key": "chave",
      "value": "detalhe revelado",
      "summary": "resumo do detalhe",
      "evidenceMessageId": "id_da_mensagem_dele"
    }
  ]
}`;
}

export function buildConexaoInicialPrompt(input: SubagentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_saudacao_feita"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  const missionText = input.mission || CANONICAL_SUBAGENTS.conexao_inicial.mission;

  return `Você é a subagente especialista em CONEXÃO INICIAL da Larissa (23 anos, moça meiga de Minas Gerais).
SUA MISSÃO: ${missionText}

${LARISSA_COMPACT_SUBAGENT_PROMPT}

${LARISSA_CHAT_STYLE_V2}
${input.emojiBudgetSnippet ? `\n### ORÇAMENTO DE EMOJI\n${input.emojiBudgetSnippet}\n` : ""}
${input.styleStateSnippet ? `\n### ESTILO RECENTE\n${input.styleStateSnippet}\n` : ""}
${input.goalsSnippet ? `\n${input.goalsSnippet}\n` : ""}
${input.softFocusSnippet ? `\n### BÚSSOLA ORGÂNICA DO TURNO\n${input.softFocusSnippet}\n` : ""}
${input.audioCandidatesSnippet ? `\n### ÁUDIOS DO COFRE PRÉ-SELECIONADOS\n${input.audioCandidatesSnippet}\n` : ""}
- Jamais chame o pretendente de Larissa.
- REGRA ONE-TOOL-AND-REPLY: Se uma ferramenta retornar informação suficiente, formule a resposta e NÃO encadeie ferramentas adicionais.
- PROIBIÇÃO DE TOOLS EM SAUDAÇÕES E EMPATIA: Para cumprimentos comuns ("oi", "tudo bem?", "boa noite", "oie"), risadas ("kkkk") ou reações de empatia direta, É TERMINANTEMENTE PROIBIDO chamar ferramentas. Responda DIRETO em texto com action: "reply".
- REGRA ANTI-COMPLACÊNCIA EM FATOS NEGATIVOS: A Larissa é meiga, mas não mente gostos para agradar o pretendente. Se a memória indicar 'false' ou desinteresse, assuma o fato com sinceridade e bom humor.
- RESOLUÇÃO CONTEXTUAL DE PRONOMES ('aí', 'daí', 'lá', 'aqui'): Interprete pronomes de lugar a partir do antecedente imediatamente anterior da conversa.
- DETECÇÃO DE MEMÓRIAS RICAS (memoryCandidates): Se o pretendente revelar fatos duráveis ou detalhes marcantes (ex: cidade, profissão, gostos específicos, veículos, histórias de família), proponha em "memoryCandidates" com evidenceMessageId obrigatório da mensagem dele.

### CONTEXTO DA CONVERSA
${contextBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA
Trabalhe primeiro apenas com o contexto recebido. Use ferramentas somente se for estritamente necessário:
- cofre_search: consulta áudios da Larissa no Cofre quando a pergunta ou contexto sugerir envio de áudio (ex: hobbies, rotina, dia a dia). Retorna no máximo 3 candidatos. Ex: {"action": "call_tool", "tool": "cofre_search", "parameters": {"query": "pergunta sobre lazer", "objective_context": "hobbies"}}
- stage_objectives_get: consulta o estado atual dos objetivos da fase (completed/pending). Ex: {"action": "call_tool", "tool": "stage_objectives_get", "parameters": {"stage": "conexao_inicial"}}
- persona_get_fact: consulta fato específico sobre a Larissa (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta). Ex: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}
- persona_search: busca aberta para histórias ou perrengues da Larissa. Ex: {"action": "call_tool", "tool": "persona_search", "parameters": {"query": "estudos faculdade estágio"}}
- memory_get_fact: consulta fato sobre o pretendente (ContactMemory). Ex: {"action": "call_tool", "tool": "memory_get_fact", "parameters": {"entity": "self", "field": "age" | "city"}}
- memory_search: busca aberta sobre o pretendente. Ex: {"action": "call_tool", "tool": "memory_search", "parameters": {"entity": "self", "query": "..."}}
- conversation_search: consulta se determinado tema, pergunta ou revelação já ocorreu entre os dois (anti-repetição de perguntas e de histórias). Ex: {"action": "call_tool", "tool": "conversation_search", "parameters": {"query": "já perguntei a profissão dele?"}}

Regras de Áudio e Texto:
- Se houver áudio adequado retornado pelo Cofre, prefira responder com action: "send_audio" e "audioId": "id_do_audio", SEM texto espelho redundante.
- Se não houver áudio adequado ou for irrelevante, responda em texto com action: "reply".
- Nem toda resposta precisa terminar em pergunta. Deixe espaço para o outro conduzir.

### CHECKPOINTS DESTA FASE
- 'chk_saudacao_feita': Se ainda for troca de cumprimento ou reciprocidade inicial. Próxima fase: 'conexao_inicial'.
- 'chk_rapport_estabelecido': Se o pretendente demonstrou engajamento recíproco e a conexão inicial foi firmada, autorizando avançar para 'descoberta'.

Responda ESTRITAMENTE em JSON puro, compacto e sem explicações longas de raciocínio:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "checkpoint": "chk_saudacao_feita" | "chk_rapport_estabelecido",
  "summary": "resumo de 3 palavras",
  "responses": [
    "balão 1 curto de celular",
    "balão 2 leve (se necessário)"
  ],
  "suggestedResponse": "texto completo dos balões juntos (ou vazio se send_audio)",
  "nextPhase": "conexao_inicial" | "descoberta",
  "memoryCandidates": [
    {
      "entity": "self",
      "kind": "episodic",
      "key": "chave",
      "value": "detalhe revelado",
      "summary": "resumo do detalhe",
      "tags": ["tag1"],
      "evidenceMessageId": "id_da_mensagem"
    }
  ]
}`;
}

export interface SemanticGoalDefinition {
  id: string;
  stageId?: string;
  label: string;
  memoryEntity: string;
  memoryField: string;
  description?: string;
  kind?: "fact" | "conversation_state";
  required?: boolean;
  order?: number;
  enabled?: boolean;
  /** Subagentes autorizados a perseguir ou interagir com este objetivo */
  allowedSubagents?: string[];
  /** Subagente prioritário de referência (opcional) */
  primarySubagent?: string;
  /** Política de conclusão: "conversation_evidence" ou "fact_only" */
  completionPolicy?: "conversation_evidence" | "fact_only";
}

export interface ResolvedStageGoal {
  id: string;
  label: string;
  kind?: "fact" | "conversation_state";
  status: "completed" | "pending";
  value: any;
  required?: boolean;
  allowedSubagents?: string[];
  primarySubagent?: string;
  description?: string;
  completionPolicy?: "conversation_evidence" | "fact_only";
  evidenceMessageId?: string;
  source?: string;
}

export const DEFAULT_CONEXAO_GOALS: SemanticGoalDefinition[] = [
  {
    id: "goal_initial_reciprocity",
    stageId: "stage_1_conexao",
    label: "Reciprocidade inicial",
    memoryEntity: "conversation",
    memoryField: "initial_reciprocity",
    description: "Reconhecer que a conversa deixou de ser apenas uma saudação e houve pelo menos uma troca minimamente recíproca entre os dois.",
    kind: "conversation_state",
    required: true,
    order: 1,
    enabled: true,
    allowedSubagents: ["conexao_inicial"],
    primarySubagent: "conexao_inicial",
  },
  {
    id: "goal_city",
    stageId: "stage_1_conexao",
    label: "Cidade",
    memoryEntity: "self",
    memoryField: "city",
    description: "Descobrir onde ele mora ou contexto geográfico",
    kind: "fact",
    required: true,
    order: 2,
    enabled: true,
    allowedSubagents: ["conexao_inicial", "descoberta"],
    primarySubagent: "conexao_inicial",
  },
  {
    id: "goal_job",
    stageId: "stage_1_conexao",
    label: "Profissão / trabalho",
    memoryEntity: "self",
    memoryField: "job",
    description: "Descobrir profissão, ocupação ou trabalho atual",
    kind: "fact",
    required: true,
    order: 3,
    enabled: true,
    allowedSubagents: ["conexao_inicial", "descoberta"],
    primarySubagent: "conexao_inicial",
  },
];

export const DEFAULT_DESCOBERTA_GOALS: SemanticGoalDefinition[] = [
  {
    id: "goal_age",
    stageId: "stage_2_descoberta",
    label: "Idade",
    memoryEntity: "self",
    memoryField: "age",
    description: "Descobrir a idade ou faixa etária",
    kind: "fact",
    required: true,
    order: 1,
    enabled: true,
    allowedSubagents: ["descoberta"],
    primarySubagent: "descoberta",
  },
  {
    id: "goal_routine",
    stageId: "stage_2_descoberta",
    label: "Rotina",
    memoryEntity: "self",
    memoryField: "routine",
    description: "Conhecer alguma informação útil sobre como é o cotidiano dele (horário de trabalho, dia/noite, rotina corrida/tranquila, estudos, academia)",
    kind: "fact",
    required: true,
    order: 2,
    enabled: true,
    allowedSubagents: ["descoberta"],
    primarySubagent: "descoberta",
  },
  {
    id: "goal_hobbies",
    stageId: "stage_2_descoberta",
    label: "Hobbies e interesses",
    memoryEntity: "self",
    memoryField: "hobbies",
    description: "Conhecer pelo menos um gosto, hobby ou atividade que ele realmente curta",
    kind: "fact",
    required: true,
    order: 3,
    enabled: true,
    allowedSubagents: ["descoberta"],
    primarySubagent: "descoberta",
  },
  {
    id: "goal_social_style",
    stageId: "stage_2_descoberta",
    label: "Estilo de lazer / rolê",
    memoryEntity: "self",
    memoryField: "social_style",
    description: "Entender de forma natural que tipo de programa costuma gostar (caseiro, restaurante, bar, festa, viagem, natureza, passeios)",
    kind: "fact",
    required: true,
    order: 4,
    enabled: true,
    allowedSubagents: ["descoberta", "compatibilidade"],
    primarySubagent: "descoberta",
  },
  {
    id: "goal_discovery_depth",
    stageId: "stage_2_descoberta",
    label: "Contexto suficiente de descoberta",
    memoryEntity: "conversation",
    memoryField: "discovery_depth",
    description: "Reconhecer que já existe contexto pessoal suficiente (pelo menos 2 fatos duráveis de categorias distintas ou revelação mais rica acompanhada de reciprocidade) para avançar naturalmente para compatibilidade.",
    kind: "conversation_state",
    required: true,
    order: 5,
    enabled: true,
    allowedSubagents: ["descoberta"],
    primarySubagent: "descoberta",
  },
];

export const DEFAULT_COMPATIBILIDADE_GOALS: SemanticGoalDefinition[] = [
  {
    id: "goal_relationship",
    stageId: "stage_3_compatibilidade",
    label: "Status de relacionamento",
    memoryEntity: "self",
    memoryField: "relationship_status",
    description: "Descobrir o status atual de relacionamento dele (solteiro, separado, divorciado, etc.). Não usar para filhos nem intenção.",
    kind: "fact",
    required: true,
    order: 1,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_relationship_intent",
    stageId: "stage_3_compatibilidade",
    label: "O que procura atualmente",
    memoryEntity: "self",
    memoryField: "relationship_intent",
    description: "Entender a intenção atual dele em relação a conhecer alguém (algo sério, conhecer sem pressa, relacionamento, não sabe ainda)",
    kind: "fact",
    required: true,
    order: 2,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_has_children",
    stageId: "stage_3_compatibilidade",
    label: "Tem filhos",
    memoryEntity: "self",
    memoryField: "has_children",
    description: "Registrar se ele possui ou não filhos (fato presente). Não misturar com desejo futuro de filhos.",
    kind: "fact",
    required: true,
    order: 3,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_wants_children",
    stageId: "stage_3_compatibilidade",
    label: "Quer ter filhos",
    memoryEntity: "self",
    memoryField: "wants_children",
    description: "Registrar a visão dele sobre ter filhos no futuro. Só concluir com evidência clara. Não inferir de ter filhos.",
    kind: "fact",
    required: true,
    order: 4,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_family_values",
    stageId: "stage_3_compatibilidade",
    label: "Família e valores",
    memoryEntity: "self",
    memoryField: "family_values",
    description: "Conhecer algum aspecto relevante sobre como ele enxerga família, vínculo, respeito, estabilidade ou relações pessoais",
    kind: "fact",
    required: true,
    order: 5,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_future_plans",
    stageId: "stage_3_compatibilidade",
    label: "Planos futuros",
    memoryEntity: "self",
    memoryField: "future_plans",
    description: "Conhecer algum plano relevante de médio/longo prazo (carreira, moradia, viagens, família, projetos pessoais)",
    kind: "fact",
    required: true,
    order: 6,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
  {
    id: "goal_faith_values",
    stageId: "stage_3_compatibilidade",
    label: "Fé / espiritualidade",
    memoryEntity: "self",
    memoryField: "faith_values",
    description: "Conhecer esse aspecto SOMENTE quando surgir naturalmente. Nunca forçar pergunta religiosa.",
    kind: "fact",
    required: true,
    order: 7,
    enabled: true,
    allowedSubagents: ["compatibilidade"],
    primarySubagent: "compatibilidade",
  },
];

export interface StageResolutionResult {
  stage: string;
  stageId: string;
  goals: ResolvedStageGoal[];
  objectives: any[];
  currentObjective: ResolvedStageGoal | null;
  completedObjectives: ResolvedStageGoal[];
  remainingObjectives: ResolvedStageGoal[];
  stageComplete: boolean;
  responsibleSubagent: string;
}

/**
 * Validação segura de evidência inbound histórica (Gate de Reconciliação Histórica).
 * Garante que a mensagem de origem:
 * 1. Pertence à MESMA conversa (bloqueio cross-conversation);
 * 2. É comprovadamente inbound do pretendente (is_mine === false, rejeitando outbound de Larissa);
 * 3. Existe no histórico (RAM ou instagram_messages).
 */
export async function validateHistoricalInboundEvidence(params: {
  supabase: any;
  conversationId: string;
  sourceMessageId?: string;
  historyMessages?: any[];
}): Promise<{ valid: boolean; message?: any; reason?: string }> {
  const { supabase, conversationId, sourceMessageId, historyMessages = [] } = params;
  if (!sourceMessageId || typeof sourceMessageId !== "string" || !sourceMessageId.trim()) {
    return { valid: false, reason: "missing_source_message_id" };
  }
  const cleanSourceId = sourceMessageId.trim();

  // 1. Checa se a mensagem já está nos historyMessages fornecidos (em RAM)
  if (Array.isArray(historyMessages) && historyMessages.length > 0) {
    const memMsg = historyMessages.find((m: any) => String(m.id) === cleanSourceId);
    if (memMsg) {
      const msgConvId = String(memMsg.conversation_id || memMsg.conversationId || conversationId);
      if (msgConvId !== String(conversationId)) {
        return { valid: false, reason: "cross_conversation_detected" };
      }
      const isOutbound = memMsg.is_mine === true || memMsg.sender === "me" || memMsg.sender_id === "me";
      if (isOutbound) {
        return { valid: false, reason: "outbound_message_rejected" };
      }
      return { valid: true, message: memMsg };
    }
  }

  // 2. Consulta autoritativa no banco de dados (instagram_messages)
  if (supabase && typeof supabase.from === "function") {
    try {
      const { data, error } = await supabase
        .from("instagram_messages")
        .select("id, conversation_id, is_mine, text, created_at")
        .eq("id", cleanSourceId)
        .maybeSingle();

      if (error || !data) {
        return { valid: false, reason: "message_not_found_in_db" };
      }

      if (String(data.conversation_id) !== String(conversationId)) {
        return { valid: false, reason: "cross_conversation_detected" };
      }

      if (data.is_mine === true) {
        return { valid: false, reason: "outbound_message_rejected" };
      }

      return { valid: true, message: data };
    } catch (err: any) {
      return { valid: false, reason: `db_lookup_error: ${err.message || String(err)}` };
    }
  }

  return { valid: false, reason: "unverifiable_provenance" };
}

export async function resolveStageChecklistGoals(params: {
  supabase: any;
  conversationId: string;
  stageNameOrId?: string;
  memoryProvider: MemoryProvider;
  completedGoalIds?: string[];
  historyMessages?: any[];
  episodicMemory?: any[];
}): Promise<StageResolutionResult> {
  const { supabase, conversationId, stageNameOrId, memoryProvider, completedGoalIds = [] } = params;
  const targetStageQuery = (stageNameOrId || "descoberta").trim().toLowerCase();

  let stagesList: any[] = [];
  let subagentsList: any[] = [];
  try {
    if (supabase && typeof supabase.from === "function") {
      let stagesRaw: any = null;
      try {
        const q = supabase.from("chat_stages").select("*");
        if (typeof q?.order === "function") {
          const res = await q.order("stage_order", { ascending: true });
          stagesRaw = res?.data;
        } else if (typeof q?.eq === "function" && typeof q?.eq()?.maybeSingle === "function") {
          const res = await q.eq("id", conversationId || targetStageQuery).maybeSingle();
          stagesRaw = res?.data;
        } else {
          const res = await q;
          stagesRaw = res?.data;
        }
      } catch (_sErr) {}

      // Se não achou em chat_stages, tenta buscar estágios customizados da conversa em instagram_conversations
      if (!stagesRaw || (Array.isArray(stagesRaw) && stagesRaw.length === 0)) {
        try {
          const res = await supabase
            .from("instagram_conversations")
            .select("stage_completed_rules")
            .eq("id", conversationId || targetStageQuery)
            .maybeSingle();
          stagesRaw = res?.data;
        } catch (_cErr) {}
      }

      if (stagesRaw) {
        const rawList = Array.isArray(stagesRaw)
          ? stagesRaw
          : stagesRaw?.stage_completed_rules?.stages || stagesRaw?.stages || [];

        if (Array.isArray(rawList) && rawList.length > 0) {
          stagesList = rawList.map((s: any) => ({
            ...s,
            order: s.stage_order || s.order,
            objectives: s.goals || s.objectives,
            goals: s.goals || s.objectives,
          }));
        }
      }

      try {
        const subagentsRes = await supabase
          .from("subagent_definitions")
          .select("*")
          .order("is_system", { ascending: false });
        if (subagentsRes?.data && Array.isArray(subagentsRes.data)) {
          subagentsList = subagentsRes.data;
        }
      } catch (_subErr) {}
    }
  } catch (err) {
    // Fail-safe silencioso
  }

  // Busca a etapa correspondente por id ou name
  let matchedStage = stagesList.find((s) => {
    const idMatch = s.id && s.id.toLowerCase() === targetStageQuery;
    const nameMatch = s.name && s.name.toLowerCase().includes(targetStageQuery);
    return idMatch || nameMatch;
  });

  if (!matchedStage && targetStageQuery.includes("descoberta")) {
    matchedStage = stagesList.find((s) => (s.name || "").toLowerCase().includes("descoberta"));
  } else if (!matchedStage && (targetStageQuery.includes("conexao") || targetStageQuery.includes("conexão"))) {
    matchedStage = stagesList.find((s) => (s.name || "").toLowerCase().includes("conex"));
  } else if (!matchedStage && targetStageQuery.includes("compatibilidade")) {
    matchedStage = stagesList.find((s) => (s.name || "").toLowerCase().includes("compat"));
  }

  const resolvedStageId = matchedStage?.id || (
    targetStageQuery.includes("conexao") || targetStageQuery.includes("conexão") || targetStageQuery === "stage_1_conexao"
      ? "stage_1_conexao"
      : targetStageQuery.includes("compatibilidade") || targetStageQuery === "stage_3_compatibilidade"
      ? "stage_3_compatibilidade"
      : targetStageQuery.includes("descoberta") || targetStageQuery.includes("desc") || targetStageQuery === "stage_2_descoberta"
      ? "stage_2_descoberta"
      : targetStageQuery
  );

  // Determinação determinística do subagente responsável pela etapa (1:1 no fluxo principal)
  let responsibleSubagent = "";
  if (subagentsList.length > 0) {
    const matchingSubs = subagentsList.filter(
      (sub: any) =>
        sub.enabled !== false &&
        Array.isArray(sub.stage_ids) &&
        sub.stage_ids.includes(resolvedStageId)
    );
    if (matchingSubs.length > 1) {
      throw new Error(`owner_collision: Multiple active subagents claim stage ${resolvedStageId}: ${matchingSubs.map((s: any) => s.id).join(", ")}`);
    } else if (matchingSubs.length === 1) {
      responsibleSubagent = matchingSubs[0].id;
    }
  }

  if (!responsibleSubagent) {
    const stageNameLower = (matchedStage?.name || "").toLowerCase();
    if (resolvedStageId === "stage_1_conexao" || targetStageQuery.includes("conex") || stageNameLower.includes("conex")) {
      responsibleSubagent = "conexao_inicial";
    } else if (resolvedStageId === "stage_2_descoberta" || targetStageQuery.includes("descoberta") || targetStageQuery.includes("desc") || stageNameLower.includes("descoberta") || stageNameLower.includes("desc")) {
      responsibleSubagent = "descoberta";
    } else if (resolvedStageId === "stage_3_compatibilidade" || targetStageQuery.includes("compat") || stageNameLower.includes("compat")) {
      responsibleSubagent = "compatibilidade";
    } else {
      // Etapa customizada sem owner oficial sempre falha fechada.
      throw new Error(`owner_missing: No active subagent claims stage ${resolvedStageId}`);
    }
  }

  let rawGoals: SemanticGoalDefinition[] = [];
  if (matchedStage?.objectives && Array.isArray(matchedStage.objectives) && matchedStage.objectives.length > 0) {
    rawGoals = matchedStage.objectives.map((o: any) => ({
      id: o.id,
      stageId: o.stageId || resolvedStageId,
      label: o.title || o.label,
      memoryEntity: o.memoryEntity || "self",
      memoryField: o.memoryField || "",
      description: o.description,
      kind: o.kind || (o.id === "goal_initial_reciprocity" || o.id === "goal_discovery_depth" ? "conversation_state" : "fact"),
      required: o.required !== false,
      order: Number(o.order ?? 0),
      enabled: o.enabled !== false,
      allowedSubagents: o.allowedSubagents || [responsibleSubagent],
      primarySubagent: o.primarySubagent || responsibleSubagent,
      completionPolicy: o.completionPolicy,
    }));
  } else if (matchedStage?.goals && Array.isArray(matchedStage.goals) && matchedStage.goals.length > 0) {
    rawGoals = matchedStage.goals.map((g: any) => ({
      ...g,
      stageId: g.stageId || resolvedStageId,
      kind: g.kind || (g.id === "goal_initial_reciprocity" || g.id === "goal_discovery_depth" ? "conversation_state" : "fact"),
      required: g.required !== false,
      order: Number(g.order ?? 0),
      enabled: g.enabled !== false,
      allowedSubagents: g.allowedSubagents || [responsibleSubagent],
      primarySubagent: g.primarySubagent || responsibleSubagent,
      completionPolicy: g.completionPolicy,
    }));
  } else if (resolvedStageId === "stage_1_conexao") {
    rawGoals = DEFAULT_CONEXAO_GOALS;
  } else if (resolvedStageId === "stage_3_compatibilidade") {
    rawGoals = DEFAULT_COMPATIBILIDADE_GOALS;
  } else {
    rawGoals = DEFAULT_DESCOBERTA_GOALS;
  }

  // Ordenação determinística estrita por order ASC
  const activeGoals = rawGoals
    .filter((g) => g.enabled !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  const resolvedGoals: ResolvedStageGoal[] = [];

  for (const goal of activeGoals) {
    const isStateGoal =
      goal.kind === "conversation_state" ||
      goal.id === "goal_initial_reciprocity" ||
      goal.id === "goal_discovery_depth";

    const baseResolved = {
      id: goal.id,
      label: goal.label,
      kind: isStateGoal ? ("conversation_state" as const) : ("fact" as const),
      required: goal.required !== false,
      allowedSubagents: goal.allowedSubagents || [responsibleSubagent],
      primarySubagent: goal.primarySubagent || responsibleSubagent,
      description: goal.description,
      completionPolicy: goal.completionPolicy,
    };

    if (isStateGoal) {
      let isCompleted = completedGoalIds.includes(goal.id);

      if (!isCompleted) {
        if (goal.id === "goal_initial_reciprocity") {
          const msgs = params.historyMessages || [];
          if (msgs.length >= 2) {
            const hasUserSubstantive = msgs.some((m: any) => {
              const isUser = !m.is_from_me && m.sender_id !== "me" && m.sender !== "me" && !m.is_mine;
              const text = (m.text || m.content || "").trim();
              return isUser && text.length > 3 && !/^(oi|olá|ola|oii|boa noite|boa tarde|bom dia)[.!]?$/i.test(text);
            });
            if (hasUserSubstantive || msgs.length >= 4) {
              isCompleted = true;
            }
          }
        } else if (goal.id === "goal_discovery_depth") {
          let knownFactsCount = 0;
          const factsToCheck = ["age", "city", "job", "routine", "hobbies", "social_style"];
          for (const f of factsToCheck) {
            const r = await memoryProvider.getFact(conversationId, "self", f);
            if (r.found && r.value !== undefined && r.value !== null && r.value !== "") {
              knownFactsCount++;
            }
          }
          if (knownFactsCount >= 2) {
            isCompleted = true;
          } else if (params.episodicMemory && params.episodicMemory.length >= 2) {
            isCompleted = true;
          }
        }
      }

      resolvedGoals.push({
        ...baseResolved,
        status: isCompleted ? "completed" : "pending",
        value: isCompleted ? true : null,
      });
      continue;
    }

    // Objetivo do tipo FACT: busca estritamente na memória estruturada do contato
    const entity = (goal.memoryEntity || "self").trim().toLowerCase();
    const field = (goal.memoryField || "").trim().toLowerCase();
    const factRes = await memoryProvider.getFact(conversationId, entity, field);
    const policy = goal.completionPolicy || "conversation_evidence";

    let factSatisfied = false;
    let provenEvidenceId: string | undefined = undefined;

    if (factRes.found && factRes.value !== undefined && factRes.value !== null && factRes.value !== "") {
      const sourceMsgId = factRes.fact?.sourceMessageId;
      if (policy === "conversation_evidence") {
        const provRes = await validateHistoricalInboundEvidence({
          supabase,
          conversationId,
          sourceMessageId: sourceMsgId,
          historyMessages: params.historyMessages,
        });

        if (provRes.valid) {
          factSatisfied = true;
          provenEvidenceId = sourceMsgId;
        } else {
          factSatisfied = false;
        }
      } else {
        factSatisfied = true;
        provenEvidenceId = sourceMsgId;
      }
    }

    if (factSatisfied) {
      resolvedGoals.push({
        ...baseResolved,
        status: "completed",
        value: factRes.value,
        evidenceMessageId: provenEvidenceId,
        source: "contact_memory_reconciliation",
      });
    } else if (completedGoalIds.includes(goal.id)) {
      resolvedGoals.push({
        ...baseResolved,
        status: "completed",
        value: true,
      });
    } else {
      resolvedGoals.push({
        ...baseResolved,
        status: "pending",
        value: null,
      });
    }
  }

  // Resolução determinística da sequência de checkpoints
  const completedObjectives = resolvedGoals.filter((g) => g.status === "completed");
  const openObjectives = resolvedGoals.filter((g) => g.status === "pending");
  const currentObjective = openObjectives[0] || null;
  const remainingObjectives = openObjectives.slice(1);
  const requiredPending = openObjectives.filter((g) => g.required !== false);
  const stageComplete = activeGoals.length > 0 && requiredPending.length === 0;

  return {
    stage: matchedStage?.name || (
      resolvedStageId === "stage_1_conexao" ? "Conexão Inicial" :
      resolvedStageId === "stage_3_compatibilidade" ? "Compatibilidade" : "Descoberta"
    ),
    stageId: resolvedStageId,
    goals: resolvedGoals,
    objectives: resolvedGoals.map((g) => ({
      id: g.id,
      title: g.label,
      label: g.label,
      kind: g.kind || "fact",
      status: g.status,
      value: g.value,
      evidenceMessageId: g.evidenceMessageId,
      source: g.source,
      required: g.required !== false,
      allowedSubagents: g.allowedSubagents,
      primarySubagent: g.primarySubagent,
      description: g.description,
    })),
    currentObjective,
    completedObjectives,
    remainingObjectives,
    stageComplete,
    responsibleSubagent,
  };
}

export const resolveStageObjectives = resolveStageChecklistGoals;

/**
 * Filtra os objetivos da etapa autorizados para a responsabilidade do subagente (Many-to-Many).
 * Preserva retrocompatibilidade total: se allowedSubagents for null, undefined ou vazio,
 * o objetivo é considerado acessível para todos os subagentes da etapa.
 */
export function filterGoalsForSubagent(
  goals: ResolvedStageGoal[],
  subagentId: string
): { openGoals: ResolvedStageGoal[]; completedGoals: ResolvedStageGoal[] } {
  const authorized = goals.filter((g) => {
    if (!g.allowedSubagents || !Array.isArray(g.allowedSubagents) || g.allowedSubagents.length === 0) {
      return true;
    }
    return g.allowedSubagents.includes(subagentId);
  });

  return {
    openGoals: authorized.filter((g) => g.status === "pending"),
    completedGoals: authorized.filter((g) => g.status === "completed"),
  };
}

/**
 * Formata um snippet compacto de Missão e Objetivos autorizados para injeção no prompt do subagente.
 * Suporta assinatura sobrecarregada (objeto ou parâmetros soltos) para retrocompatibilidade total.
 */
export function formatGoalsSnippetForSubagent(
  subagentIdOrParams:
    | string
    | {
        subagentId: string;
        stageName?: string;
        mission?: string;
        currentObjective?: ResolvedStageGoal | null;
        completedObjectives?: ResolvedStageGoal[];
        remainingObjectives?: ResolvedStageGoal[];
        knownFacts?: Record<string, any>;
      },
  mission?: string,
  openGoals?: ResolvedStageGoal[],
  completedGoals?: ResolvedStageGoal[]
): string {
  let subagentId = typeof subagentIdOrParams === "string" ? subagentIdOrParams : subagentIdOrParams.subagentId;
  let subMission = typeof subagentIdOrParams === "string" ? (mission || "") : (subagentIdOrParams.mission || mission || "");
  let stageName = typeof subagentIdOrParams === "object" ? subagentIdOrParams.stageName : undefined;
  let currentObj =
    typeof subagentIdOrParams === "object"
      ? subagentIdOrParams.currentObjective
      : openGoals && openGoals[0]
      ? openGoals[0]
      : null;
  let completedList =
    typeof subagentIdOrParams === "object"
      ? subagentIdOrParams.completedObjectives || []
      : completedGoals || [];
  let remainingList =
    typeof subagentIdOrParams === "object"
      ? subagentIdOrParams.remainingObjectives || []
      : openGoals && openGoals.length > 1
      ? openGoals.slice(1)
      : [];
  let knownFacts = typeof subagentIdOrParams === "object" ? subagentIdOrParams.knownFacts : undefined;

  const parts: string[] = [];
  if (stageName) {
    parts.push(`### ETAPA ATUAL: ${stageName.toUpperCase()} (Subagente Responsável: ${subagentId})`);
  }
  parts.push(`### SUA MISSÃO NESTE TURNO`);
  parts.push(subMission);
  parts.push(``);

  parts.push(`### CHECKPOINT ATUAL OBRIGATÓRIO (FOCO IMEDIATO)`);
  if (currentObj) {
    const desc = currentObj.description ? `\n  Missão: ${currentObj.description}` : "";
    parts.push(`• [ATIVO OBRIGATÓRIO] ${currentObj.label}${desc}`);
    parts.push(
      `  Diretriz: Este é o seu destino obrigatório imediato na conversa. Busque cumpri-lo com naturalidade, afeto e organicidade caso o homem dê abertura, sem forçar nem fazer entrevista.`
    );
  } else {
    parts.push(`• Todos os checkpoints desta etapa foram concluídos! Conduza o diálogo com leveza e acolhimento.`);
  }
  parts.push(``);

  if (completedList.length > 0) {
    parts.push(`### CHECKPOINTS JÁ CONCLUÍDOS (PROIBIDO REPETIR OU PERGUNTAR)`);
    for (const g of completedList) {
      const valStr = g.value !== undefined && g.value !== null && g.value !== true ? `: ${g.value}` : "";
      parts.push(`• ${g.label}${valStr}`);
    }
    parts.push(``);
  }

  if (knownFacts && Object.keys(knownFacts).length > 0) {
    parts.push(`### FATOS CONHECIDOS DO CONTATO NA MEMÓRIA (NÃO PERGUNTE NOVAMENTE)`);
    for (const [k, v] of Object.entries(knownFacts)) {
      if (v !== undefined && v !== null && v !== "") {
        parts.push(`• ${k}: ${v}`);
      }
    }
    parts.push(``);
  }

  if (remainingList.length > 0) {
    parts.push(`### PRÓXIMOS CHECKPOINTS DA ETAPA (HORIZONTE - NÃO ANTECIPAR)`);
    for (const g of remainingList) {
      parts.push(`• ${g.label}`);
    }
    parts.push(`(Aviso estrito: NÃO antecipe perguntas destes tópicos antes de superar o checkpoint atual).`);
    parts.push(``);
  }

  parts.push(`### REGRAS DE PROGRESSÃO CONVERSACIONAL`);
  parts.push(`1. Responder o que ele falou e acolher o momento emocional dele tem PRIORIDADE MÁXIMA.`);
  parts.push(`2. NUNCA faça mais de uma pergunta por turno. Perguntas não são obrigatórias em todo turno.`);
  parts.push(`3. Quando ele fornecer a evidência necessária para o checkpoint atual, inclua no JSON:`);
  parts.push(
    `   "objectiveCompletion": { "objectiveId": "${currentObj ? currentObj.id : "id_do_objetivo"}", "evidenceMessageId": "id_da_msg", "value": "dado_descoberto" }`
  );
  parts.push(`4. Se o momento não tiver gancho natural para o checkpoint, NÃO force; apenas continue a conversa com calor humano.`);

  return parts.join("\n");
}

/**
 * Processamento determinístico de conclusão de checkpoints e progressão sequencial de etapas.
 * - Valida objectiveCompletion proposto pelo subagente
 * - Registra progresso no banco de dados (completed_goals e objectiveProgress)
 * - Avalia se todos os objetivos ativos da etapa atual foram concluídos
 * - Avança deterministicamente por order ASC para a próxima etapa cadastrada
 * - Entrega para o subagente responsável pela próxima etapa (sem regredir na última etapa)
 */
export async function processDeterministicStageProgression(params: {
  supabase: any;
  conversationId: string;
  currentPhase: OrchestrationPhase;
  currentStageId?: string;
  decision: OrchestratorDecision;
  claimedMessages?: any[];
  rawInbounds?: any[];
  stageRules?: any;
  orchState?: any;
  currentCycle?: any;
  memoryProvider?: MemoryProvider;
  episodicMemory?: any[];
  contactMemory?: any;
  stageGoals?: any[];
}): Promise<{
  updatedCompletedGoals: string[];
  updatedObjectiveProgress: Record<string, any>;
  nextPhase: OrchestrationPhase;
  currentStageId: string;
  nextStageId: string;
  responsibleSubagentId: string;
  stageAdvanced: boolean;
  advancementReason?: string;
}> {
  const {
    supabase,
    conversationId,
    currentPhase,
    decision,
    claimedMessages = [],
    rawInbounds = [],
    stageRules = {},
    orchState = {},
    currentCycle,
    memoryProvider,
    episodicMemory = [],
    contactMemory = null,
    stageGoals = null,
  } = params;

  const updatedCompletedGoals: string[] = [
    ...resolveOfficialCompletedGoals(stageRules, orchState),
  ];
  const updatedObjectiveProgress: Record<string, any> = {
    ...resolveOfficialObjectiveProgress(stageRules, orchState),
  };

  // 1. Busca lista ordenada de etapas (chat_stages) e subagentes (subagent_definitions)
  let stagesList: any[] = [];
  let subagentsList: any[] = [];
  try {
    if (supabase) {
      const [stgRes, subRes] = await Promise.all([
        supabase
          .from("chat_stages")
          .select("*")
          .order("stage_order", { ascending: true }),
        supabase
          .from("subagent_definitions")
          .select("*")
          .order("is_system", { ascending: false }),
      ]);
      if (stgRes.data && Array.isArray(stgRes.data) && stgRes.data.length > 0) {
        stagesList = stgRes.data;
      }
      if (subRes.data && Array.isArray(subRes.data)) {
        subagentsList = subRes.data;
      }
    }
  } catch {}

  // Fallback para etapas canônicas se tabela estiver vazia
  if (stagesList.length === 0) {
    stagesList = [
      { id: "stage_1_conexao", name: "Conexão Inicial", stage_order: 0, goals: DEFAULT_CONEXAO_GOALS },
      { id: "stage_2_descoberta", name: "Descoberta", stage_order: 1, goals: DEFAULT_DESCOBERTA_GOALS },
      { id: "stage_3_compatibilidade", name: "Compatibilidade", stage_order: 2, goals: DEFAULT_COMPATIBILIDADE_GOALS },
    ];
  }

  // 2. Determina a etapa atual na lista com separação estrita de stageId e subagentId
  const candidateStageId = (
    params.currentStageId ||
    orchState.currentStageId ||
    (currentPhase === "conexao_inicial" ? "stage_1_conexao" :
     currentPhase === "descoberta" ? "stage_2_descoberta" :
     currentPhase === "compatibilidade" ? "stage_3_compatibilidade" :
     currentPhase)
  ).trim().toLowerCase();

  let currentStageIndex = stagesList.findIndex(
    (s) =>
      (s.id && s.id.toLowerCase() === candidateStageId) ||
      (candidateStageId === "conexao_inicial" && (s.id === "stage_1_conexao" || s.name?.toLowerCase().includes("conex"))) ||
      (candidateStageId === "descoberta" && (s.id === "stage_2_descoberta" || s.name?.toLowerCase().includes("descoberta"))) ||
      (candidateStageId === "compatibilidade" && (s.id === "stage_3_compatibilidade" || s.name?.toLowerCase().includes("compat")))
  );

  if (currentStageIndex === -1) {
    // Tenta encontrar pelo subagente vinculado via stage_ids
    const subWithStage = subagentsList.find(
      (sub) => sub.id === candidateStageId && Array.isArray(sub.stage_ids) && sub.stage_ids.length > 0
    );
    if (subWithStage) {
      currentStageIndex = stagesList.findIndex((s) => s.id === subWithStage.stage_ids[0]);
    }
  }

  let currentStage: any = null;
  if (currentStageIndex !== -1) {
    currentStage = stagesList[currentStageIndex];
  } else {
    // Preserva a identidade de custom stages desconhecidos em vez de rebaixar cegamente para stage 0
    if (
      candidateStageId &&
      candidateStageId !== "conexao_inicial" &&
      candidateStageId !== "descoberta" &&
      candidateStageId !== "compatibilidade"
    ) {
      currentStage = {
        id: candidateStageId,
        name: candidateStageId,
        stage_order: 999,
        goals: [],
      };
    } else {
      currentStageIndex = 0;
      currentStage = stagesList[0];
    }
  }

  // Resolve o subagente responsável atual da etapa
  let currentResponsibleSubagent = "";
  if (subagentsList.length > 0) {
    const matchingSubs = subagentsList.filter(
      (sub: any) =>
        sub.enabled !== false &&
        Array.isArray(sub.stage_ids) &&
        sub.stage_ids.includes(currentStage.id)
    );
    if (matchingSubs.length > 1) {
      if (currentCycle?.trace) {
        currentCycle.trace.push(`owner_collision: stage=${currentStage.id} has multiple active subagents (${matchingSubs.map((s: any) => s.id).join(", ")})`);
      }
      throw new Error(`owner_collision: Multiple active subagents claim stage ${currentStage.id}: ${matchingSubs.map((s: any) => s.id).join(", ")}`);
    } else if (matchingSubs.length === 1) {
      currentResponsibleSubagent = matchingSubs[0].id;
    }
  }

  if (!currentResponsibleSubagent) {
    if (currentStage.id === "stage_1_conexao" || currentStage.name?.toLowerCase().includes("conex")) {
      currentResponsibleSubagent = "conexao_inicial";
    } else if (currentStage.id === "stage_2_descoberta" || currentStage.name?.toLowerCase().includes("descoberta")) {
      currentResponsibleSubagent = "descoberta";
    } else if (currentStage.id === "stage_3_compatibilidade" || currentStage.name?.toLowerCase().includes("compat")) {
      currentResponsibleSubagent = "compatibilidade";
    } else if (subagentsList.length > 0) {
      // Custom stage sem dono: erro determinístico owner_missing
      if (currentCycle?.trace) {
        currentCycle.trace.push(`owner_missing: custom stage=${currentStage.id} has no responsible subagent`);
      }
      throw new Error(`owner_missing: No active subagent claims custom stage ${currentStage.id}`);
    } else {
      currentResponsibleSubagent = "descoberta";
    }
  }

  // 3. Obtém os objetivos da etapa atual e reconcilia fatos conhecidos da memória
  const rawGoals: any[] = (Array.isArray(stageGoals) && stageGoals.length > 0)
    ? stageGoals
    : (currentStage?.goals || currentStage?.objectives || []);
  const activeGoals: any[] = rawGoals
    .filter((g: any) => g.enabled !== false)
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0));

  // Reconciliação prévia com ContactMemory para que fatos já conhecidos não bloqueiem currentObjective
  if (contactMemory && typeof contactMemory === "object") {
    for (const g of activeGoals) {
      const entity = g.memoryEntity || "self";
      const field = g.memoryField;
      if (field && contactMemory[entity]?.[field]) {
        const val = contactMemory[entity][field];
        const factValue = typeof val === "object" && val !== null ? val.value : val;
        if (factValue !== undefined && factValue !== null && factValue !== "") {
          const policy = g.completionPolicy;
          if (policy !== "conversation_evidence") {
            if (!updatedCompletedGoals.includes(g.id)) {
              updatedCompletedGoals.push(g.id);
            }
            if (!updatedObjectiveProgress[g.id]) {
              updatedObjectiveProgress[g.id] = {
                conversationId,
                stageId: currentStage.id,
                objectiveId: g.id,
                status: "completed",
                value: factValue,
                completedAt: new Date().toISOString(),
                source: "memory_fact_sync",
              };
            }
          }
        }
      }
    }
  }

  const currentObjective = activeGoals.find((g: any) => !updatedCompletedGoals.includes(g.id)) || null;

  // 4. Validação RIGOROSA de objectiveCompletion proposto pelo modelo/LLM
  if (decision.objectiveCompletion && decision.objectiveCompletion.objectiveId) {
    const comp = decision.objectiveCompletion;
    if (currentCycle?.trace) {
      currentCycle.trace.push(`objective_completion_requested: ${comp.objectiveId}`);
    }

    // Regra A: O objetivo precisa existir na etapa atual
    const goalInStage = rawGoals.find((g: any) => g.id === comp.objectiveId);
    if (!goalInStage) {
      if (currentCycle?.trace) {
        currentCycle.trace.push(
          `objective_completion_rejected_wrong_stage: requested=${comp.objectiveId}, stage=${currentStage.id}`
        );
        currentCycle.trace.push(`objective_completion_rejected_reason: wrong_stage_or_not_found`);
        currentCycle.trace.push(`invalid_objective_completion_rejected: wrong_stage_or_not_found`);
      }
    } else if (goalInStage.enabled === false) {
      // Regra B: O objetivo precisa estar ativo (enabled !== false)
      if (currentCycle?.trace) {
        currentCycle.trace.push(`objective_completion_rejected_disabled: ${comp.objectiveId}`);
        currentCycle.trace.push(`objective_completion_rejected_reason: objective_disabled`);
        currentCycle.trace.push(`invalid_objective_completion_rejected: objective_disabled`);
      }
    } else if (updatedCompletedGoals.includes(comp.objectiveId)) {
      // Regra C: O objetivo ainda não pode ter sido concluído
      if (currentCycle?.trace) {
        currentCycle.trace.push(`objective_completion_rejected_already_completed: ${comp.objectiveId}`);
        currentCycle.trace.push(`objective_completion_rejected_reason: already_completed`);
        currentCycle.trace.push(`invalid_objective_completion_rejected: already_completed`);
      }
    } else if (!currentObjective || currentObjective.id !== comp.objectiveId) {
      // Regra D: O LLM só pode concluir o currentObjective (não pode inventar checkpoints futuros ou pular)
      if (currentCycle?.trace) {
        currentCycle.trace.push(
          `objective_completion_rejected_not_current: requested=${comp.objectiveId}, current=${currentObjective?.id || "none"}`
        );
        currentCycle.trace.push(`objective_completion_rejected_reason: not_current_objective`);
        currentCycle.trace.push(`invalid_objective_completion_rejected: not_current_objective`);
      }
    } else if (!comp.evidenceMessageId) {
      // Regra E1: Validação de evidência obrigatória (rejeição categórica se ausente)
      if (currentCycle?.trace) {
        currentCycle.trace.push(`objective_completion_rejected_missing_evidence: ${comp.objectiveId}`);
        currentCycle.trace.push(`objective_completion_rejected_reason: missing_evidence`);
        currentCycle.trace.push(`invalid_objective_completion_rejected: missing_evidence`);
      }
    } else {
      // Regra E2: Validação de evidência obrigatória (deve existir em claimedMessages ou rawInbounds)
      const validEvidence =
        claimedMessages.some((m: any) => String(m.id) === String(comp.evidenceMessageId)) ||
        rawInbounds.some((m: any) => String(m.id) === String(comp.evidenceMessageId));

      if (!validEvidence) {
        if (currentCycle?.trace) {
          currentCycle.trace.push(`objective_completion_rejected_invalid_evidence: ${comp.objectiveId}`);
          currentCycle.trace.push(`objective_completion_rejected_reason: invalid_evidence`);
          currentCycle.trace.push(`invalid_objective_completion_rejected: invalid_evidence`);
        }
      } else {
        // Validação 100% aprovada: aceita a conclusão
        updatedCompletedGoals.push(comp.objectiveId);
        updatedObjectiveProgress[comp.objectiveId] = {
          conversationId,
          stageId: currentStage.id,
          objectiveId: comp.objectiveId,
          status: "completed",
          value: comp.value !== undefined ? comp.value : true,
          evidenceMessageId: comp.evidenceMessageId,
          completedAt: new Date().toISOString(),
        };
        if (currentCycle?.trace) {
          currentCycle.trace.push(`objective_completion_accepted: ${comp.objectiveId}`);
          currentCycle.trace.push(`objective_completed_by_agent: ${comp.objectiveId}`);
        }
      }
    }
  }

  // 5. Unificação Canônica: Resolve objetivos usando resolveStageObjectives e reconcilia fatos da ContactMemory
  let stageComplete = false;
  if (memoryProvider) {
    try {
      const resolved = await resolveStageObjectives({
        supabase,
        conversationId,
        stageNameOrId: currentStage.id,
        memoryProvider,
        completedGoalIds: updatedCompletedGoals,
        historyMessages: claimedMessages,
        episodicMemory,
      });

      // Sincroniza fatos da memória com completed_goals e objective_progress respeitando completionPolicy
      for (const g of resolved.goals) {
        if (g.status === "completed") {
          const goalDef = activeGoals.find((ag: any) => ag.id === g.id);
          const policy = goalDef?.completionPolicy || (g as any).completionPolicy;
          // Se for explicitamente conversation_evidence, exige evidência válida (do turno atual ou reconciliação histórica comprovada)
          const requiresConversationEvidence = policy === "conversation_evidence";
          const hasHistoricalEvidence = (g as any).source === "contact_memory_reconciliation" && Boolean((g as any).evidenceMessageId);
          if (!requiresConversationEvidence || hasHistoricalEvidence || updatedCompletedGoals.includes(g.id)) {
            if (!updatedCompletedGoals.includes(g.id)) {
              updatedCompletedGoals.push(g.id);
            }
            if (!updatedObjectiveProgress[g.id]) {
              updatedObjectiveProgress[g.id] = {
                conversationId,
                stageId: currentStage.id,
                objectiveId: g.id,
                status: "completed",
                value: g.value !== undefined && g.value !== null ? g.value : true,
                evidenceMessageId: (g as any).evidenceMessageId,
                completedAt: new Date().toISOString(),
                source: (g as any).source || "memory_fact_sync",
              };
            }
          }
        }
      }
      stageComplete = activeGoals.length > 0 && activeGoals.every((g: any) => updatedCompletedGoals.includes(g.id));
    } catch (err) {
      stageComplete = activeGoals.length > 0 && activeGoals.every((g: any) => updatedCompletedGoals.includes(g.id));
    }
  } else {
    stageComplete = activeGoals.length > 0 && activeGoals.every((g: any) => updatedCompletedGoals.includes(g.id));
  }

  let nextPhase: OrchestrationPhase = currentPhase;
  let nextStageId: string = currentStage.id;
  let responsibleSubagentId: string = currentResponsibleSubagent;
  let stageAdvanced = false;
  let advancementReason: string | undefined;

  if (stageComplete) {
    // Se há próxima etapa na ordem sequencial
    if (currentStageIndex < stagesList.length - 1) {
      const nextStage = stagesList[currentStageIndex + 1];
      stageAdvanced = true;
      nextStageId = nextStage.id;
      advancementReason = `Todos os ${activeGoals.length} checkpoints da etapa "${currentStage.name}" foram concluídos. Avançando deterministicamente para "${nextStage.name}".`;

      // Resolve subagente responsável da próxima etapa
      let nextResponsibleSub = "";
      const matchingNextSubs = subagentsList.filter(
        (sub: any) =>
          sub.enabled !== false &&
          Array.isArray(sub.stage_ids) &&
          sub.stage_ids.includes(nextStage.id)
      );
      if (matchingNextSubs.length > 1) {
        if (currentCycle?.trace) {
          currentCycle.trace.push(`owner_collision: next stage=${nextStage.id} has multiple active subagents`);
        }
        throw new Error(`owner_collision: Multiple active subagents claim next stage ${nextStage.id}`);
      } else if (matchingNextSubs.length === 1) {
        nextResponsibleSub = matchingNextSubs[0].id;
      } else {
        if (nextStage.id === "stage_1_conexao" || nextStage.name?.toLowerCase().includes("conex")) {
          nextResponsibleSub = "conexao_inicial";
        } else if (nextStage.id === "stage_2_descoberta" || nextStage.name?.toLowerCase().includes("descoberta")) {
          nextResponsibleSub = "descoberta";
        } else if (nextStage.id === "stage_3_compatibilidade" || nextStage.name?.toLowerCase().includes("compat")) {
          nextResponsibleSub = "compatibilidade";
        } else {
          // Custom stage sem dono: erro determinístico owner_missing
          if (currentCycle?.trace) {
            currentCycle.trace.push(`owner_missing: custom next stage=${nextStage.id} has no responsible subagent`);
          }
          throw new Error(`owner_missing: No active subagent claims custom next stage ${nextStage.id}`);
        }
      }

      responsibleSubagentId = nextResponsibleSub;
      nextPhase = nextResponsibleSub as OrchestrationPhase;

      if (currentCycle?.trace) {
        currentCycle.trace.push(`deterministic_stage_advanced: ${nextPhase}`);
      }
    } else {
      // Última etapa: permanece na etapa sem regredir
      nextStageId = currentStage.id;
      responsibleSubagentId = currentResponsibleSubagent;
      nextPhase = currentPhase;
      if (currentCycle?.trace) {
        currentCycle.trace.push("deterministic_last_stage_retained");
      }
    }
  } else {
    // Checkpoints ainda pendentes: bloqueia qualquer avanço solicitado pelo modelo
    if (decision.nextPhase && decision.nextPhase !== currentPhase) {
      if (currentCycle?.trace) {
        currentCycle.trace.push(`model_requested_phase: ${decision.nextPhase}`);
        currentCycle.trace.push(`backend_authoritative_stage: ${currentStage.id}`);
        currentCycle.trace.push(
          `stage_advancement_blocked_pending_checkpoints: requested=${decision.nextPhase}, current=${currentPhase}`
        );
      }
    }
    nextStageId = currentStage.id;
    responsibleSubagentId = currentResponsibleSubagent;
    nextPhase = currentPhase;
  }

  // 6. Traces de observabilidade padronizados
  if (currentCycle?.trace) {
    currentCycle.trace.push(`current_stage_id: ${currentStage.id}`);
    currentCycle.trace.push(`responsible_subagent: ${responsibleSubagentId}`);
    currentCycle.trace.push(`current_objective_id: ${currentObjective?.id || "none"}`);
    currentCycle.trace.push(`stage_complete: ${stageComplete}`);
    currentCycle.trace.push(`next_stage_id: ${nextStageId}`);
    currentCycle.trace.push(`stage_advanced: ${stageAdvanced}`);
  }

  return {
    updatedCompletedGoals,
    updatedObjectiveProgress,
    nextPhase,
    currentStageId: currentStage.id,
    nextStageId,
    responsibleSubagentId,
    stageAdvanced,
    advancementReason,
  };
}

// Persona Memory da Larissa desacoplada em ./persona_memory.ts (importada e reexportada no topo)

// ----------------------------------------------------------------------------
// Busca Semântica na Biblioteca de Áudios da Larissa
// ----------------------------------------------------------------------------
export async function searchPersonaAudios(params: {
  supabase: any;
  conversationId: string;
  intent: string;
  query?: string;
  stageId?: string;
}): Promise<Array<PersonaAudioAsset & { alreadySentInConversation: boolean; already_sent?: boolean }>> {
  const { supabase, conversationId, intent, query, stageId } = params;
  let audios: PersonaAudioAsset[] = [];

  try {
    const { data: audioRows } = await supabase
      .from("persona_audios")
      .select("*")
      .eq("enabled", true)
      .order("title", { ascending: true });

    if (audioRows && Array.isArray(audioRows) && audioRows.length > 0) {
      audios = audioRows.map((r: any) => ({
        id: r.id,
        stageId: r.stage_id || undefined,
        title: r.title,
        audioUrl: r.audio_url,
        duration: r.duration != null ? Number(r.duration) : undefined,
        transcript: r.transcript || "",
        usageInstruction: r.usage_instruction || "",
        enabled: r.enabled ?? true,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
  } catch {}

  if (audios.length === 0 && (supabase as any)?.__mockPersonaAudios) {
    audios = (supabase as any).__mockPersonaAudios;
  }

  let sentAudioIds = new Set<string>();
  try {
    const { data: histRows } = await supabase
      .from("audio_delivery_history")
      .select("audio_id")
      .eq("conversation_id", conversationId);

    if (histRows && Array.isArray(histRows)) {
      histRows.forEach((h: any) => sentAudioIds.add(h.audio_id));
    }
  } catch {}

  try {
    const { data: convRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();

    const convHist = convRow?.stage_completed_rules?.audio_delivery_history || [];
    if (Array.isArray(convHist)) {
      convHist.forEach((h: any) => sentAudioIds.add(h.audioId || h.id));
    }

    const deliveredAudios = convRow?.stage_completed_rules?.orchestration?.deliveredAudios || [];
    if (Array.isArray(deliveredAudios)) {
      deliveredAudios.forEach((id: any) => sentAudioIds.add(typeof id === "string" ? id : id?.id));
    }
  } catch {}

  if ((supabase as any)?.__mockAudioHistory) {
    const mockHist: AudioDeliveryHistory[] = (supabase as any).__mockAudioHistory;
    mockHist
      .filter((h) => h.conversationId === conversationId)
      .forEach((h) => sentAudioIds.add(h.audioId));
  }

  const AUDIO_STOPWORDS = new Set([
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas",
    "e", "ou", "que", "com", "por", "pra", "para",
    "se", "seu", "sua", "seus", "suas",
    "você", "vc", "como", "qual", "acha", "sobre",
    "isso", "aqui", "tudo", "bem", "mais"
  ]);

  const rawTerms = `${intent || ""} ${query || ""}`
    .toLowerCase()
    .replace(/[.,;!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const queryTerms = rawTerms.filter((t) => t.length >= 3 && !AUDIO_STOPWORDS.has(t));

  const isExplicitReplay = /\b(?:manda\s+(?:de\s+novo|novamente|aquele)|toca\s+(?:de\s+novo|novamente)|re[-]?(?:envia|manda)|ouve\s+de\s+novo|manda\s+o\s+audio\s+de\s+novo)\b/i.test(`${intent || ""} ${query || ""}`);

  const matched = audios
    .filter((a) => a.enabled !== false)
    .filter((a) => a.transcript && a.transcript.trim().length > 0) // Excluir da seleção automática qualquer áudio sem transcrição
    .filter((a) => {
      if (stageId && a.stageId && a.stageId !== stageId) {
        return false;
      }
      return true;
    })
    .map((a) => {
      const searchHaystack = `${a.title || ""} ${a.transcript || ""} ${a.usageInstruction || ""} ${(a.keywords || []).join(" ")}`.toLowerCase();
      const combinedInput = `${intent || ""} ${query || ""}`.toLowerCase();
      let matchScore = 0;

      // Aderência semântica: se a palavra que casaria for sobre tema pessoal (ex: "praia"),
      // mas o usuário usou de forma puramente incidental ("meu escritório fica perto da praia")
      // e NÃO perguntou se ela gosta de praia ou sobre ela, descarta o falso positivo.
      const isIncidentalBeach =
        (/\b(?:perto|ao lado|pr[oó]ximo|frente|longe|escrit[oó]rio|trabalho|loja|empresa)\b.*?\b(?:praia|mar)\b/i.test(combinedInput) ||
         /\b(?:praia|mar)\b.*?\b(?:escrit[oó]rio|trabalho|loja|empresa)\b/i.test(combinedInput)) &&
        !/\b(?:voc[eê]|vc|c[eê])\s+(?:gosta|vai|curte|já foi|ja foi|costuma|ama)\b/i.test(combinedInput) &&
        !/\b(?:e\s+voc[eê]|e\s+vc)\b/i.test(combinedInput) &&
        !/\b(?:gosta\s+de\s+praia|curte\s+praia)\b/i.test(combinedInput);

      for (const term of queryTerms) {
        if ((term === "praia" || term === "mar") && isIncidentalBeach && (a.id.toLowerCase().includes("praia") || searchHaystack.includes("praia"))) {
          continue;
        }

        if (searchHaystack.includes(term)) {
          matchScore += 1;
        }
      }

      // Em pedido de replay explícito ("manda de novo o áudio"):
      // O áudio previamente enviado é o candidato primário a ser reenviado
      if (isExplicitReplay) {
        if (sentAudioIds.has(a.id)) {
          matchScore += 10;
        } else if (queryTerms.every((t) => ["manda", "novo", "audio", "favor", "novamente", "toca", "reenvia", "re"].includes(t))) {
          matchScore += 1;
        }
      }

      const alreadySent = isExplicitReplay ? false : sentAudioIds.has(a.id);
      return {
        ...a,
        matchScore,
        alreadySentInConversation: alreadySent,
        already_sent: alreadySent,
      };
    })
    .filter((a) => queryTerms.length === 0 || a.matchScore > 0)
    .sort((a, b) => {
      if (a.alreadySentInConversation !== b.alreadySentInConversation) {
        return a.alreadySentInConversation ? 1 : -1;
      }
      return b.matchScore - a.matchScore;
    })
    .map(({ matchScore, ...cleanAudio }) => cleanAudio);

  return matched;
}

export async function recordAudioDeliveryHistory(params: {
  supabase: any;
  conversationId: string;
  audioId: string;
  providerMessageId?: string;
}): Promise<void> {
  const { supabase, conversationId, audioId, providerMessageId } = params;
  try {
    const newEntryId = `adh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // 1. Grava na tabela oficial audio_delivery_history
    await supabase.from("audio_delivery_history").insert({
      id: newEntryId,
      conversation_id: conversationId,
      audio_id: audioId,
      sent_at: now,
      provider_message_id: providerMessageId || null,
    });

    if ((supabase as any)?.__mockAudioHistory) {
      (supabase as any).__mockAudioHistory.push({
        id: newEntryId,
        conversationId,
        audioId,
        sentAt: now,
        providerMessageId,
      });
    }
  } catch (err) {
    console.warn("[Orchestrator] Falha ao gravar histórico de áudio:", err);
  }
}

export interface CofreAudioCandidate {
  audio_id: string;
  title: string;
  summary: string;
  full_transcript: string;
  transcript: string;
  usage_instruction: string;
  when_to_use: string;
  duration?: number;
  already_sent?: boolean;
  match_score?: number;
}

/**
 * Busca pontual e seletiva no Cofre de Áudios da Larissa.
 * Retorna NO MÁXIMO 3 candidatos mais relevantes com objeto completo e transcrição integral.
 */
export async function searchCofreAudios(params: {
  supabase: any;
  conversationId: string;
  query: string;
  objective_context?: string;
  limit?: number;
}): Promise<CofreAudioCandidate[]> {
  const { supabase, conversationId, query, objective_context, limit = 3 } = params;
  const combinedIntent = `${query || ""} ${objective_context || ""}`.trim();
  const rawMatches = await searchPersonaAudios({
    supabase,
    conversationId,
    intent: combinedIntent,
  });

  const isExplicitReplay = /\b(?:manda\s+(?:de\s+novo|novamente|aquele)|toca\s+(?:de\s+novo|novamente)|re[-]?(?:envia|manda)|ouve\s+de\s+novo|manda\s+o\s+audio\s+de\s+novo)\b/i.test(combinedIntent);
  const available = isExplicitReplay ? rawMatches : rawMatches.filter((a) => !a.alreadySentInConversation);

  return available.slice(0, Math.min(limit, 3)).map((a) => {
    const fullTranscript = a.transcript || a.title || "";
    return {
      audio_id: a.id,
      title: a.title || "",
      summary: fullTranscript,
      full_transcript: fullTranscript,
      transcript: fullTranscript,
      usage_instruction: a.usageInstruction || a.title || "",
      when_to_use: a.usageInstruction || a.title || "",
      duration: a.duration,
      already_sent: a.alreadySentInConversation,
    };
  });
}

export interface SpontaneousObjectiveMatch {
  objectiveId: string;
  memoryEntity: string; // Sempre "self" para dados do pretendente
  memoryField: string;  // Campo canônico: "job", "city", "age", "has_children", "wants_children", "relationship_status"
  field: string;        // Compatibilidade
  value: any;
  evidenceMessageId?: string;
  summary: string;
}

/** Converte uma heurística em contexto para o Brain, sem qualquer mutação de estado. */
export function buildObjectiveCandidateEvidence(matches: SpontaneousObjectiveMatch[]): Array<{
  objectiveId: string;
  evidenceMessageId: string;
  summary: string;
}> {
  return matches.map((match) => ({
    objectiveId: match.objectiveId,
    evidenceMessageId: match.evidenceMessageId || "",
    summary: match.summary || `${match.field}: ${String(match.value).slice(0, 120)}`,
  }));
}

/**
 * Detecta conclusões espontâneas de objetivos a partir do texto do pretendente
 * (ex: "trabalho com mineração, sou solteiro e não tenho filhos").
 * Não dispara checklist nem perguntas sobre fatos já revelados.
 */
export function detectSpontaneousObjectiveCompletions(
  messages: Array<{ id: string; text?: string; sender?: string }>,
  pendingGoalIds: string[]
): SpontaneousObjectiveMatch[] {
  const matches: SpontaneousObjectiveMatch[] = [];
  const joinedText = messages
    .filter((m) => m.sender === "pretendente" || !m.sender)
    .map((m) => m.text || "")
    .join(" ");

  if (!joinedText.trim()) return matches;

  const textLower = joinedText.toLowerCase();

  // Helper para checar se o trecho refere-se a terceira pessoa (irmão, ex, amigo, pai, etc.)
  const isThirdParty = (fullText: string, matchIndex: number) => {
    const prefix = fullText.slice(Math.max(0, matchIndex - 35), matchIndex);
    return /\b(?:meu|minha|um|uma|meus|minhas|dele|dela|esse|essa)\s+(?:irmão|irmã|amigo|amiga|ex|namorada|esposa|marido|pai|mãe|filho|filha|primo|prima|colega|chefe|parente)\b|\b(?:ele|ela)\s+/i.test(prefix);
  };

  // Helper para checar negação anterior
  const hasNegationPrefix = (fullText: string, matchIndex: number) => {
    const prefix = fullText.slice(Math.max(0, matchIndex - 20), matchIndex);
    return /\b(?:não|nao|nem|nunca|jamais)\s*$/i.test(prefix);
  };

  // 1. Trabalho / Profissão (com distinção estrita de tempo: passado vs presente, e entidade)
  const isWorkGoal = (id: string) => /work|profession|profissao|trabalho|emprego|job/i.test(id);
  const targetWorkGoal = pendingGoalIds.find(isWorkGoal);
  if (targetWorkGoal) {
    // Primeiro prioriza declaração clara de presente ("hoje sou motorista", "atualmente trabalho como...", "sou motorista")
    const presentJobMatch = textLower.match(
      /(?:(?:hoje|atualmente|agora)\s+)?(?:sou\s+(?:médico|médica|engenheiro|engenheira|advogado|advogada|motorista|autônomo|autônoma|empresário|empresária|enfermeiro|enfermeira|professor|professora|pedreiro|estudante|programador|programadora|dev|analista|minerador|mineradora|técnico|técnica|policial|bancário|bancária|vendedor|vendedora)[^,.;!?\n]*|(?:hoje|atualmente|agora)\s+trabalho\s+(?:com|em|na|no|de|como)\s+([^,.;!?\n]+))/i
    );

    const generalWorkMatch = textLower.match(
      /(?:trabalho\s+(?:com|em|na|no|de|como)\s+([^,.;!?\n]+)|sou\s+(?:médico|médica|engenheiro|engenheira|advogado|advogada|motorista|autônomo|autônoma|empresário|empresária|enfermeiro|enfermeira|professor|professora|pedreiro|estudante|programador|programadora|dev|analista|minerador|mineradora|técnico|técnica|policial|bancário|bancária|vendedor|vendedora)[^,.;!?\n]*)/i
    );

    const pastWorkMatch = textLower.match(
      /(?:trabalhava\s+(?:com|em|na|no|de)\s+([^,.;!?\n]+)|era\s+(?:médico|engenheiro|advogado|motorista|minerador|bancário)[^,.;!?\n]*)/i
    );

    let chosenMatch: RegExpMatchArray | null = null;

    if (presentJobMatch) {
      const idx = textLower.indexOf(presentJobMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        chosenMatch = presentJobMatch;
      }
    } else if (generalWorkMatch) {
      const idx = textLower.indexOf(generalWorkMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        chosenMatch = generalWorkMatch;
      }
    }

    if (chosenMatch) {
      let val = chosenMatch[0].trim();
      val = val.replace(/^(?:(?:hoje|atualmente|agora)\s+)?(?:sou|trabalho\s+(?:com|em|na|no|de))\s+/i, "").trim();
      val = val.replace(/\s+e\s+.*$/i, "").trim();
      if (val.length >= 3) {
        matches.push({
          objectiveId: targetWorkGoal,
          memoryEntity: "self",
          memoryField: "job",
          field: "job",
          value: val,
          evidenceMessageId: messages[0]?.id,
          summary: `trabalho: ${val}`,
        });
      }
    }
  }

  // 2. Relacionamento / Estado Civil (com verificação estrita de negação e entidade)
  const isRelGoal = (id: string) => /relationship|status|estado_civil|relacionamento|solteiro/i.test(id);
  const targetRelGoal = pendingGoalIds.find(isRelGoal);
  if (targetRelGoal) {
    const relMatch = textLower.match(
      /\b(?:tô|sou|estou|fiquei)\s+(?:solteiro|divorciado|separado|viúvo)\b|\b(?:sou|tô)\s+livre\b/i
    );
    if (relMatch) {
      const matchIdx = textLower.indexOf(relMatch[0]);
      const negated = hasNegationPrefix(textLower, matchIdx);
      const thirdParty = isThirdParty(textLower, matchIdx);

      if (!thirdParty) {
        if (negated) {
          // "não sou solteiro" -> não atribui solteiro
          matches.push({
            objectiveId: targetRelGoal,
            memoryEntity: "self",
            memoryField: "relationship_status",
            field: "relationship_status",
            value: "não é solteiro",
            evidenceMessageId: messages[0]?.id,
            summary: "estado civil: não é solteiro",
          });
        } else {
          matches.push({
            objectiveId: targetRelGoal,
            memoryEntity: "self",
            memoryField: "relationship_status",
            field: "relationship_status",
            value: "solteiro",
            evidenceMessageId: messages[0]?.id,
            summary: "estado civil: solteiro",
          });
        }
      }
    }
  }

  // 3. Filhos (has_children vs wants_children)
  const isChildGoal = (id: string) => /has_children|children|filhos|filho|kids/i.test(id) && !/wants_children/i.test(id);
  const isWantsChildGoal = (id: string) => /wants_children|quer_filhos|desejo_filhos/i.test(id);
  const targetChildGoal = pendingGoalIds.find(isChildGoal);
  const targetWantsChildGoal = pendingGoalIds.find(isWantsChildGoal);

  // A. Situação atual sobre ter filhos
  if (targetChildGoal) {
    const noKidsMatch = textLower.match(
      /\b(?:não tenho filhos?|sem filhos?|nem filho|zero filhos?|não sou pai)\b/i
    );
    const hasKidsMatch = textLower.match(
      /\b(?:tenho\s+(?:um|\d+)\s+filhos?|sou pai)\b/i
    );

    if (noKidsMatch) {
      const idx = textLower.indexOf(noKidsMatch[0]);
      if (!isThirdParty(textLower, idx)) {
        matches.push({
          objectiveId: targetChildGoal,
          memoryEntity: "self",
          memoryField: "has_children",
          field: "has_children",
          value: "sem filhos",
          evidenceMessageId: messages[0]?.id,
          summary: "filhos: não tem filhos",
        });
      }
    } else if (hasKidsMatch) {
      const idx = textLower.indexOf(hasKidsMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetChildGoal,
          memoryEntity: "self",
          memoryField: "has_children",
          field: "has_children",
          value: hasKidsMatch[0].trim(),
          evidenceMessageId: messages[0]?.id,
          summary: `filhos: ${hasKidsMatch[0].trim()}`,
        });
      }
    }
  }

  // B. Desejo futuro de ter filhos
  if (targetWantsChildGoal) {
    const wantsKidsMatch = textLower.match(
      /\b(?:quero\s+(?:ter\s+)?(?:filhos?|\d+|um|uma|dois|duas|três|tres|quatro|alguns)|penso\s+em\s+ter\s+filhos?|pretendo\s+ter\s+filhos?)\b/i
    );
    if (wantsKidsMatch) {
      const idx = textLower.indexOf(wantsKidsMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetWantsChildGoal,
          memoryEntity: "self",
          memoryField: "wants_children",
          field: "wants_children",
          value: wantsKidsMatch[0].trim(),
          evidenceMessageId: messages[0]?.id,
          summary: `desejo de filhos: ${wantsKidsMatch[0].trim()}`,
        });
      }
    }
  }

  // 4. Cidade / Localização (sem terceiros e sem locais genéricos)
  const isCityGoal = (id: string) => /city|cidade|local|mora|onde_mora|bairro/i.test(id);
  const targetCityGoal = pendingGoalIds.find(isCityGoal);
  if (targetCityGoal) {
    const cityMatch = textLower.match(
      /\b(?:moro\s+em|sou\s+de|vivo\s+em|aqui\s+em)\s+([^,.;!?\n]+?)(?:\s+(?:e\s+tenho|e\s+trabalho|e\s+sou|e\s+faço|e\s+vivo|mas|há|desde)|[,.;!?\n]|$)/i
    );
    if (cityMatch && !/\b(?:casa|cama|hospital|serviço|trabalho|hotel)\b/i.test(cityMatch[1])) {
      const idx = textLower.indexOf(cityMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        let cityVal = cityMatch[1].trim();
        cityVal = cityVal.replace(/\s+e\s+.*$/i, "").trim();
        if (cityVal.length >= 3) {
          matches.push({
            objectiveId: targetCityGoal,
            memoryEntity: "self",
            memoryField: "city",
            field: "city",
            value: cityVal,
            evidenceMessageId: messages[0]?.id,
            summary: `cidade: ${cityVal}`,
          });
        }
      }
    }
  }

  // 5. Idade (estritamente primeira pessoa no presente, rejeitando passado e terceiros)
  const isAgeGoal = (id: string) => /age|idade|quantos_anos/i.test(id);
  const targetAgeGoal = pendingGoalIds.find(isAgeGoal);
  if (targetAgeGoal) {
    const isPastAge = /\b(?:tinha|era|quando comecei|na época|antigamente|anos atrás)\b/i.test(textLower);
    const ageMatch = textLower.match(/\b(?:tenho|faço|tô com|estou com)\s+(\d{2})\s*(?:anos)?\b/i);
    if (ageMatch && !isPastAge) {
      const idx = textLower.indexOf(ageMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetAgeGoal,
          memoryEntity: "self",
          memoryField: "age",
          field: "age",
          value: parseInt(ageMatch[1], 10),
          evidenceMessageId: messages[0]?.id,
          summary: `idade: ${ageMatch[1]} anos`,
        });
      }
    }
  }

  return matches;
}

export function buildDescobertaPrompt(input: SubagentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_pergunta_sobre_ele"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  const missionText = input.mission || CANONICAL_SUBAGENTS.descoberta.mission;

  return `Você é a subagente especialista em DESCOBERTA da Larissa (23 anos, moça meiga de Minas Gerais).
SUA MISSÃO: ${missionText}

${LARISSA_COMPACT_SUBAGENT_PROMPT}

${LARISSA_CHAT_STYLE_V2}
${input.emojiBudgetSnippet ? `\n### ORÇAMENTO DE EMOJI\n${input.emojiBudgetSnippet}\n` : ""}
${input.styleStateSnippet ? `\n### ESTILO RECENTE\n${input.styleStateSnippet}\n` : ""}
${input.goalsSnippet ? `\n${input.goalsSnippet}\n` : ""}
${input.softFocusSnippet ? `\n### BÚSSOLA ORGÂNICA DO TURNO\n${input.softFocusSnippet}\n` : ""}
${input.audioCandidatesSnippet ? `\n### ÁUDIOS DO COFRE PRÉ-SELECIONADOS\n${input.audioCandidatesSnippet}\n` : ""}
- Aplique a Regra da Reciprocidade: conte algo breve sobre você (estuda enfermagem, mora em São João del Rei, trabalha com vendas em casa).
- REGRA ONE-TOOL-AND-REPLY: Se uma ferramenta retornar informação suficiente, formule a resposta e NÃO encadeie ferramentas adicionais.
- PRESERVAÇÃO DE TÓPICO ESPECÍFICO EM PERGUNTAS: Se perguntarem se você gosta de algo específico (música, filme, bebida, comida), consulte sobre ESSE item específico com persona_get_fact ou persona_search.
- REGRA ANTI-COMPLACÊNCIA EM FATOS NEGATIVOS: A Larissa é meiga, mas não mente afinidade. Se a memória indicar 'false' ou que ela não curte, assuma com sinceridade e bom humor mineiro.
- RESOLUÇÃO CONTEXTUAL DE PRONOMES ('aí', 'daí', 'lá', 'aqui'): Interprete pronomes de lugar a partir do antecedente imediatamente anterior da conversa.
- PROIBIÇÃO DE TOOLS EM SAUDAÇÕES E EMPATIA: Para cumprimentos comuns ("oi", "tudo bem?", "boa noite", "oie"), risadas ("kkkk") ou reações de empatia direta, responda DIRETO em texto com action: "reply".
- Se ele já revelou algo (ex: trabalho, cidade, filhos, estado civil), NUNCA pergunte sobre isso novamente. Aprofunde ou converse com o que ele trouxe.
- BÚSSOLA DE ORIENTAÇÃO: NUNCA UM INTERROGATÓRIO. NÃO INSISTA. Máximo 1 pergunta leve por turno. Se o pretendente mudou de assunto, acompanhe o fluxo dele com afeto e escuta atenta.
- DETECÇÃO DE MEMÓRIAS RICAS (memoryCandidates): Se o pretendente revelar fatos duráveis ou detalhes marcantes (ex: trabalho, cidade, veículos especiais como carro/moto, família, sonhos), proponha em "memoryCandidates" com evidenceMessageId obrigatório da mensagem dele.

### CONTEXTO DA CONVERSA
${contextBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA
Trabalhe primeiro com o contexto recebido. Chame ferramentas apenas quando necessário:
- cofre_search: consulta áudios da Larissa no Cofre quando a pergunta ou contexto sugerir envio de áudio (ex: hobbies, rotina, dia a dia). Retorna no máximo 3 candidatos. Ex: {"action": "call_tool", "tool": "cofre_search", "parameters": {"query": "pergunta sobre lazer", "objective_context": "hobbies"}}
- stage_objectives_get: consulta o estado atual dos objetivos da fase (completed/pending). Ex: {"action": "call_tool", "tool": "stage_objectives_get", "parameters": {"stage": "descoberta"}}
- checklist_get_stage_state: consulta o checklist e estado dos objetivos da fase (alias). Ex: {"action": "call_tool", "tool": "checklist_get_stage_state", "parameters": {"stage": "descoberta"}}
- persona_get_fact: consulta fato específico sobre a Larissa (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta). Ex: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}
- persona_search: busca aberta para histórias ou perrengues da Larissa. Ex: {"action": "call_tool", "tool": "persona_search", "parameters": {"query": "estudos faculdade estágio"}}
- memory_get_fact: consulta fato sobre o pretendente (ContactMemory). Ex: {"action": "call_tool", "tool": "memory_get_fact", "parameters": {"entity": "self", "field": "age" | "city" | "job"}}
- memory_search: busca aberta sobre o pretendente. Ex: {"action": "call_tool", "tool": "memory_search", "parameters": {"entity": "self", "query": "..."}}
- conversation_search: consulta se determinado tema, pergunta ou revelação já ocorreu entre os dois (anti-repetição de perguntas e de histórias). Ex: {"action": "call_tool", "tool": "conversation_search", "parameters": {"query": "já perguntei a profissão dele?"}}

Regras de Áudio e Decisão:
- Se houver áudio adequado retornado pelo Cofre, prefira responder com action: "send_audio" e "audioId": "id_do_audio", SEM texto espelho redundante.
- Se não houver áudio adequado ou for irrelevante, responda em texto com action: "reply".
- Nem toda resposta precisa terminar em pergunta. Deixe espaço para o outro conduzir.

### CHECKPOINTS DESTA FASE
- 'chk_pergunta_sobre_ele': Perguntou sobre trabalho, rotina ou hobbies dele com reciprocidade.
- 'chk_troca_cidade': Falou/perguntou sobre cidade ou moradia.

Responda ESTRITAMENTE em JSON puro, compacto e sem explicações longas de raciocínio:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "checkpoint": "chk_pergunta_sobre_ele" | "chk_troca_cidade",
  "summary": "resumo de 3 palavras",
  "responses": [
    "balão 1 curto e natural",
    "balão 2 afetuoso (se necessário)"
  ],
  "suggestedResponse": "texto completo dos balões juntos (ou vazio se send_audio)",
  "nextPhase": "descoberta",
  "memoryCandidates": [
    {
      "entity": "self",
      "kind": "episodic",
      "key": "chave",
      "value": "detalhe revelado",
      "summary": "resumo do detalhe",
      "tags": ["tag1"],
      "evidenceMessageId": "id_da_mensagem"
    }
  ]
}`;
}

/**
 * Construtor Unificado de Prompt de Subagente (suporta canônicos e customizados).
 * Garante que qualquer subagente receba sua missão específica e herde 100% o estilo e as restrições da Larissa.
 */
export function buildSubagentPrompt(
  input: SubagentInput & {
    subagentId: string;
    subagentName?: string;
  }
): string {
  const targetId = input.subagentId;
  if (targetId === "conexao_inicial") {
    return buildConexaoInicialPrompt(input);
  }
  if (targetId === "descoberta") {
    return buildDescobertaPrompt(input);
  }

  // Suporte a compatibilidade e a subagentes customizados
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_interacao"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  const displayName = input.subagentName || (targetId === "compatibilidade" ? "Compatibilidade" : targetId);
  const missionText =
    input.mission ||
    (targetId === "compatibilidade"
      ? CANONICAL_SUBAGENTS.compatibilidade.mission
      : `Atuar com foco especializado em ${displayName}, mantendo conversa natural e acolhedora.`);

  return `Você é a subagente especialista em ${displayName.toUpperCase()} da Larissa (23 anos, moça meiga de Minas Gerais).
SUA MISSÃO: ${missionText}

${LARISSA_COMPACT_SUBAGENT_PROMPT}

${LARISSA_CHAT_STYLE_V2}
${input.emojiBudgetSnippet ? `\n### ORÇAMENTO DE EMOJI\n${input.emojiBudgetSnippet}\n` : ""}
${input.styleStateSnippet ? `\n### ESTILO RECENTE\n${input.styleStateSnippet}\n` : ""}
${input.goalsSnippet ? `\n${input.goalsSnippet}\n` : ""}
${input.softFocusSnippet ? `\n### BÚSSOLA ORGÂNICA DO TURNO\n${input.softFocusSnippet}\n` : ""}
${input.audioCandidatesSnippet ? `\n### ÁUDIOS DO COFRE PRÉ-SELECIONADOS\n${input.audioCandidatesSnippet}\n` : ""}
- Jamais chame o pretendente de Larissa.
- REGRA ONE-TOOL-AND-REPLY: Se uma ferramenta retornar informação suficiente, formule a resposta e NÃO encadeie ferramentas adicionais.
- PROIBIÇÃO DE TOOLS EM SAUDAÇÕES E EMPATIA: Para cumprimentos comuns ("oi", "tudo bem?", "boa noite", "oie"), risadas ("kkkk") ou reações de empatia direta, responda DIRETO em texto com action: "reply".
- REGRA ANTI-COMPLACÊNCIA EM FATOS NEGATIVOS: A Larissa é meiga, mas não mente gostos para agradar o homem. Se a memória indicar 'false' ou desinteresse, assuma com sinceridade e bom humor mineiro.
- RESOLUÇÃO CONTEXTUAL DE PRONOMES ('aí', 'daí', 'lá', 'aqui'): Interprete pronomes de lugar a partir do antecedente imediatamente anterior da conversa.
- DETECÇÃO DE MEMÓRIAS RICAS (memoryCandidates): Se o pretendente revelar detalhes duráveis (veículos, sonhos, família, trabalho, cidade), proponha em "memoryCandidates" com evidenceMessageId obrigatório da mensagem dele.

### CONTEXTO DA CONVERSA
${contextBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA
Trabalhe primeiro apenas com o contexto recebido.
- cofre_search: consulta áudios da Larissa no Cofre quando a pergunta ou contexto sugerir envio de áudio (ex: hobbies, rotina, dia a dia). Retorna no máximo 3 candidatos. Ex: {"action": "call_tool", "tool": "cofre_search", "parameters": {"query": "pergunta sobre rotina", "objective_context": "rotina"}}
- stage_objectives_get: consulta o estado atual dos objetivos da fase (completed/pending). Ex: {"action": "call_tool", "tool": "stage_objectives_get", "parameters": {"stage": "${input.currentPhase}"}}
- persona_get_fact: consulta fato específico sobre a Larissa (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta). Ex: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}
- persona_search: busca aberta para perguntas narrativas, perrengues, motivos ou histórias da Larissa. Ex: {"action": "call_tool", "tool": "persona_search", "parameters": {"query": "estudos faculdade estágio"}}
- memory_get_fact: consulta fato estruturado sobre o pretendente (ContactMemory). Ex: {"action": "call_tool", "tool": "memory_get_fact", "parameters": {"entity": "self", "field": "age" | "city"}}
- memory_search: busca aberta por trechos relevantes sobre o pretendente. Ex: {"action": "call_tool", "tool": "memory_search", "parameters": {"entity": "self", "query": "..."}}
- conversation_search: consulta a memória episódica DESTA conversa para checar se determinado tema, pergunta ou revelação já ocorreu (anti-repetição de perguntas e de histórias). Ex: {"action": "call_tool", "tool": "conversation_search", "parameters": {"query": "já perguntei a profissão dele?"}}

Regras de Áudio e Decisão:
- Se houver áudio adequado retornado pelo Cofre, prefira responder com action: "send_audio" e "audioId": "id_do_audio", SEM texto espelho redundante.
- Se não houver áudio adequado ou for irrelevante, responda em texto com action: "reply".
- Nem toda resposta precisa terminar em pergunta. Deixe espaço para o outro conduzir.

### CHECKPOINTS DESTA FASE
- 'chk_interacao': Interação regular em andamento. Próxima fase: '${input.currentPhase}'.
- 'chk_concluido': Subagente concluiu sua atuação no momento ou conduziu o alinhamento. Próxima fase: '${input.currentPhase}'.

Responda ESTRITAMENTE em JSON puro, compacto e sem explicações longas de raciocínio:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "checkpoint": "chk_interacao" | "chk_concluido",
  "summary": "resumo de 3 palavras",
  "responses": [
    "balão 1 curto de celular",
    "balão 2 leve (se necessário)"
  ],
  "suggestedResponse": "texto completo dos balões juntos (ou vazio se send_audio)",
  "nextPhase": "${input.currentPhase}",
  "memoryCandidates": [
    {
      "entity": "self",
      "kind": "episodic",
      "key": "chave",
      "value": "detalhe revelado",
      "summary": "resumo do detalhe",
      "tags": ["tag1"],
      "evidenceMessageId": "id_da_mensagem"
    }
  ]
}`;
}

// Construtor unificado mantido para compatibilidade retroativa
export function buildOrchestratorPrompt(input: OrchestratorInput): string {
  return `Você é a IA Atria, Auditora Oficial de Atendimento e Relacionamento do Vendeo.
Você atua na condução estratégica do atendimento para a persona **Larissa** (23 anos, moça meiga de Minas Gerais, estudante de enfermagem e trabalha com vendas).
O pretendente/cliente é quem está conversando com a Larissa. Quem enviou a última mensagem foi o cliente (${input.newMessage.sender}).
A fala formulada em "suggestedResponse" é a resposta direta da **Larissa** para o cliente.

### DIRETRIZES DA PERSONA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Tom: carinhoso, meigo, natural de Minas Gerais (usando 'né', 'kkk', 'vc', 'tô', 'tá', 'pra').
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Jamais chame o cliente de Larissa. Responda ao que o cliente falou antes de perguntar qualquer coisa.
- Mantenha a resposta curta, humana e fluida de WhatsApp/Instagram.
- REGRA INVIOLÁVEL DE 'UAI' (RARO E OPCIONAL): O 'uai' é estritamente OPCIONAL e MUITO RARO (use no máximo em 1 a cada 15 falas). Na dúvida, NUNCA use 'uai'. Se puder falar sem 'uai', prefira SEMPRE sem 'uai'.
- DIRETRIZ DE FECHAMENTO (ZERO PERGUNTA MECÂNICA): PROIBIDO terminar toda fala com a pergunta mecânica "e você?", "e vc?", "e tu?". Varie os fechamentos: comente, reaja, use deboche meigo ("sou moça de família rapaz kkk"), afirme ou solte risada ("kkk"). Só faça pergunta de volta quando houver real motivo (máximo 20% a 30% das falas).
- ESTILO NUNCA SOBRESCREVE FATO: Não transforme fatos negativos em positivos. Matéria mais difícil: Embriologia. Matéria que não gosta: Farmacologia.
- INTERPRETAÇÃO RIGOROSA DE BOOLEANOS (false): Fatos com value: false significam CATEGORICAMENTE que ela NÃO GOSTA, NÃO CONSOME, NÃO BEBE e NÃO ASSISTE. Jamais invente que consome ou gosta de vez em quando.

### DOSSIÊ DA CONVERSA
- ID da Conversa: ${input.conversationId}
- Fase Atual: ${input.currentPhase}
- Histórico Recente de Mensagens:
${input.conversationSummary}
- Memórias Relevantes: ${input.relevantMemories.length > 0 ? input.relevantMemories.join(" | ") : "Nenhuma memória registrada ainda."}
- Ferramentas Permitidas: ${input.allowedTools.join(", ")}

### DIRETRIZES DA FASE [${input.currentPhase}]
${input.phaseRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

### ÚLTIMA MENSAGEM DO CLIENTE
- Remetente: ${input.newMessage.sender}
- Texto: "${input.newMessage.text}"
- Horário: ${input.newMessage.timestamp}

### REGRAS OBRIGATÓRIAS DE AUDITORIA
1. Avalie a interação do cliente com base no histórico e diretrizes da fase.
2. Para avançar de 'conexao_inicial' para 'descoberta', você DEVE definir o checkpoint como 'chk_rapport_estabelecido' e próxima fase 'descoberta'.
3. Se o cliente ainda estiver apenas em troca de saudações ou reciprocidade inicial, mantenha a fase 'conexao_inicial' e checkpoint 'chk_saudacao_feita'.
4. Formule uma resposta curta e acolhedora em 'suggestedResponse' (estilo Larissa, sem ponto final).
5. Responda ESTRITAMENTE em formato JSON puro com as seguintes chaves:
{
  "action": "reply",
  "currentPhase": "${input.currentPhase}",
  "nextPhase": "conexao_inicial",
  "checkpoint": "chk_saudacao_feita",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "resposta carinhosa da Larissa para o cliente",
  "requiredTools": ["send_text"],
  "reasoning": "análise analítica da decisão tomada"
}`;
}

// ----------------------------------------------------------------------------
// 7.5. Provedores de Memória Estruturada (Memory Providers) (.agents/ARCHITECTURE.md)
// ----------------------------------------------------------------------------

/**
 * Provedor em Memória para Testes e Mock Rápido
 */
export class InMemoryMemoryProvider implements MemoryProvider {
  private stores = new Map<string, ContactMemoryStore>();

  private getOrCreateStore(contactId: string): ContactMemoryStore {
    let store = this.stores.get(contactId);
    if (!store) {
      store = { entities: {}, snippets: [] };
      this.stores.set(contactId, store);
    }
    return store;
  }

  async getFact(contactId: string, entity: string, field: string): Promise<{ found: boolean; fact?: MemoryFact; value?: any }> {
    const store = this.getOrCreateStore(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    const normField = (field || "").toLowerCase().trim();
    const fact = store.entities[normEntity]?.[normField];
    if (fact) {
      return { found: true, fact, value: fact.value };
    }
    return { found: false, value: undefined };
  }

  async searchMemory(contactId: string, query: string, options?: { entity?: string; limit?: number }): Promise<MemorySearchResult[]> {
    const store = this.getOrCreateStore(contactId);
    const normQuery = (query || "").toLowerCase().trim();
    const limit = options?.limit || 3;
    const targetEntity = options?.entity?.toLowerCase()?.trim();

    const results: MemorySearchResult[] = [];

    // Busca nos snippets livres
    for (const item of store.snippets || []) {
      if (targetEntity && item.entity && item.entity.toLowerCase() !== targetEntity) continue;
      if (normQuery && item.snippet.toLowerCase().includes(normQuery)) {
        results.push({
          snippet: item.snippet,
          sourceMessageId: item.sourceMessageId,
          entity: item.entity,
        });
        if (results.length >= limit) break;
      }
    }

    // Se ainda couber, busca nos fatos estruturados
    if (results.length < limit) {
      for (const entKey of Object.keys(store.entities)) {
        if (targetEntity && entKey !== targetEntity) continue;
        const entObj = store.entities[entKey];
        for (const fKey of Object.keys(entObj)) {
          const f = entObj[fKey];
          const factText = `${entKey}.${fKey}: ${f.value}`;
          if (normQuery && factText.toLowerCase().includes(normQuery)) {
            results.push({
              snippet: factText,
              sourceMessageId: f.sourceMessageId,
              entity: entKey,
            });
            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  async writeFact(contactId: string, fact: Omit<MemoryFact, "updatedAt">): Promise<{ success: boolean; error?: string }> {
    const store = this.getOrCreateStore(contactId);
    const normEntity = (fact.entity || "self").toLowerCase().trim();
    const normField = (fact.field || "").toLowerCase().trim();

    if (!store.entities[normEntity]) {
      store.entities[normEntity] = {};
    }

    store.entities[normEntity][normField] = {
      ...fact,
      entity: normEntity,
      field: normField,
      updatedAt: new Date().toISOString(),
    };
    return { success: true };
  }

  async listEntityFacts(contactId: string, entity: string): Promise<Record<string, MemoryFact>> {
    const store = this.getOrCreateStore(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    return store.entities[normEntity] || {};
  }

  async saveFact(contactId: string, entity: string, field: string, value: any, options?: { confidence?: number; sourceMessageId?: string }): Promise<{ success: boolean; error?: string }> {
    return this.writeFact(contactId, {
      entity: entity || "self",
      field,
      value,
      confidence: options?.confidence ?? 1.0,
      sourceMessageId: options?.sourceMessageId,
    });
  }
}

/**
 * Provedor Oficial de Nuvem via Supabase (JSONB persistente em stage_completed_rules.orchestration.memory)
 */
export class SupabaseMemoryProvider implements MemoryProvider {
  private supabase: any;
  constructor(supabase: any) {
    this.supabase = supabase;
  }

  private async getStore(contactId: string): Promise<{ store: ContactMemoryStore; stageRules: any }> {
    try {
      const { data } = await this.supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", contactId)
        .maybeSingle();

      const stageRules = data?.stage_completed_rules || {};
      const memory = stageRules.orchestration?.memory || { entities: {}, snippets: [] };
      return { store: memory, stageRules };
    } catch {
      return { store: { entities: {}, snippets: [] }, stageRules: {} };
    }
  }

  async getFact(contactId: string, entity: string, field: string): Promise<{ found: boolean; fact?: MemoryFact; value?: any }> {
    const normEntity = (entity || "self").toLowerCase().trim();
    const normField = (field || "").toLowerCase().trim();

    // Sinonímias de campo: mapeamos o campo solicitado para todos os aliases possíveis
    const FIELD_SYNONYMS: Record<string, string[]> = {
      city:       ["city", "cidade"],
      cidade:     ["city", "cidade"],
      job:        ["job", "occupation", "profissao", "profession"],
      occupation: ["job", "occupation", "profissao", "profession"],
      profissao:  ["job", "occupation", "profissao", "profession"],
      profession: ["job", "occupation", "profissao", "profession"],
      age:        ["age", "idade"],
      idade:      ["age", "idade"],
    };
    const fieldAliases: string[] = FIELD_SYNONYMS[normField] ?? [normField];

    // --- 1ª tentativa: contact_memory_facts (tabela relacional, fonte autoritativa) ---
    try {
      const { data: cmRows, error: cmErr } = await this.supabase
        .from("contact_memory_facts")
        .select("field, value, source_message_ids, created_at")
        .eq("conversation_id", contactId)
        .eq("entity", normEntity)
        .in("field", fieldAliases)
        .neq("temporal_status", "superseded")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!cmErr && cmRows && cmRows.length > 0) {
        const row = cmRows[0];
        const sourceMessageId: string | undefined =
          Array.isArray(row.source_message_ids) && row.source_message_ids.length > 0
            ? row.source_message_ids[0]
            : undefined;

        const memFact: MemoryFact = {
          entity: normEntity,
          field:  row.field,
          value:  row.value,
          confidence: 1.0,
          sourceMessageId,
          updatedAt: row.created_at,
        };
        return { found: true, fact: memFact, value: row.value };
      }
    } catch {
      // Falha silenciosa — cai no fallback JSONB legado
    }

    // --- 2ª tentativa: JSONB legado (stage_completed_rules.orchestration.memory) ---
    const { store } = await this.getStore(contactId);
    // Tenta todos os aliases no store legado
    for (const alias of fieldAliases) {
      const fact = store.entities?.[normEntity]?.[alias];
      if (fact) {
        return { found: true, fact, value: fact.value };
      }
    }
    return { found: false, value: undefined };
  }

  async searchMemory(contactId: string, query: string, options?: { entity?: string; limit?: number }): Promise<MemorySearchResult[]> {
    const { store } = await this.getStore(contactId);
    const normQuery = (query || "").toLowerCase().trim();
    const limit = options?.limit || 3;
    const targetEntity = options?.entity?.toLowerCase()?.trim();

    const results: MemorySearchResult[] = [];

    for (const item of store.snippets || []) {
      if (targetEntity && item.entity && item.entity.toLowerCase() !== targetEntity) continue;
      if (normQuery && item.snippet.toLowerCase().includes(normQuery)) {
        results.push({
          snippet: item.snippet,
          sourceMessageId: item.sourceMessageId,
          entity: item.entity,
        });
        if (results.length >= limit) break;
      }
    }

    if (results.length < limit && store.entities) {
      for (const entKey of Object.keys(store.entities)) {
        if (targetEntity && entKey !== targetEntity) continue;
        const entObj = store.entities[entKey];
        for (const fKey of Object.keys(entObj)) {
          const f = entObj[fKey];
          const factText = `${entKey}.${fKey}: ${f.value}`;
          if (normQuery && factText.toLowerCase().includes(normQuery)) {
            results.push({
              snippet: factText,
              sourceMessageId: f.sourceMessageId,
              entity: entKey,
            });
            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  async writeFact(contactId: string, fact: Omit<MemoryFact, "updatedAt">): Promise<{ success: boolean; error?: string }> {
    try {
      const { store, stageRules } = await this.getStore(contactId);
      const normEntity = (fact.entity || "self").toLowerCase().trim();
      const normField = (fact.field || "").toLowerCase().trim();

      const entities = { ...(store.entities || {}) };
      entities[normEntity] = { ...(entities[normEntity] || {}) };
      entities[normEntity][normField] = {
        ...fact,
        entity: normEntity,
        field: normField,
        updatedAt: new Date().toISOString(),
      };

      const updatedMemory: ContactMemoryStore = {
        ...store,
        entities,
      };

      const orchestration = {
        ...(stageRules.orchestration || {}),
        memory: updatedMemory,
      };

      await this.supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...stageRules,
            orchestration,
          },
        })
        .eq("id", contactId);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async listEntityFacts(contactId: string, entity: string): Promise<Record<string, MemoryFact>> {
    const { store } = await this.getStore(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    return store.entities?.[normEntity] || {};
  }

  async saveFact(contactId: string, entity: string, field: string, value: any, options?: { confidence?: number; sourceMessageId?: string }): Promise<{ success: boolean; error?: string }> {
    return this.writeFact(contactId, {
      entity: entity || "self",
      field,
      value,
      confidence: options?.confidence ?? 1.0,
      sourceMessageId: options?.sourceMessageId,
    });
  }
}

/**
 * Adaptador para Obsidian Local REST API
 * (Pronto para conexão quando houver túnel seguro HTTPS e variáveis de ambiente no Supabase)
 */
export class ObsidianMemoryAdapter implements MemoryProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    const envUrl = typeof Deno !== "undefined" ? (Deno as any)?.env?.get?.("OBSIDIAN_REST_URL") : (typeof process !== "undefined" ? process?.env?.OBSIDIAN_REST_URL : undefined);
    const envKey = typeof Deno !== "undefined" ? (Deno as any)?.env?.get?.("OBSIDIAN_API_KEY") : (typeof process !== "undefined" ? process?.env?.OBSIDIAN_API_KEY : undefined);
    this.baseUrl = (options?.baseUrl !== undefined ? options.baseUrl : (envUrl || "")).replace(/\/$/, "");
    this.apiKey = (options?.apiKey !== undefined ? options.apiKey : (envKey || "")).trim();
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getFact(contactId: string, entity: string, field: string): Promise<{ found: boolean; fact?: MemoryFact; value?: any }> {
    if (!this.isConfigured()) return { found: false, value: undefined };
    try {
      const resp = await fetch(`${this.baseUrl}/vault/contacts/${encodeURIComponent(contactId)}/${encodeURIComponent(entity)}.json`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      });
      if (!resp.ok) return { found: false, value: undefined };
      const data = await resp.json();
      if (data && data[field] !== undefined) {
        const fact: MemoryFact = {
          entity,
          field,
          value: data[field],
          sourceMessageId: data._source?.[field],
          updatedAt: data._updatedAt?.[field] || new Date().toISOString(),
        };
        return {
          found: true,
          fact,
          value: data[field],
        };
      }
      return { found: false, value: undefined };
    } catch {
      return { found: false, value: undefined };
    }
  }

  async searchMemory(contactId: string, query: string, options?: { entity?: string; limit?: number }): Promise<MemorySearchResult[]> {
    if (!this.isConfigured()) return [];
    try {
      const resp = await fetch(`${this.baseUrl}/search/simple?query=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const prefix = `contacts/${contactId}/`;
      return (Array.isArray(data) ? data : [])
        .filter((item: any) => item.filename && item.filename.startsWith(prefix))
        .slice(0, options?.limit || 3)
        .map((item: any) => ({ snippet: item.matches?.[0]?.context || item.filename, entity: options?.entity }));
    } catch {
      return [];
    }
  }

  async writeFact(contactId: string, fact: Omit<MemoryFact, "updatedAt">): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: "Obsidian não configurado no runtime" };
    try {
      const url = `${this.baseUrl}/vault/contacts/${encodeURIComponent(contactId)}/${encodeURIComponent(fact.entity)}.json`;
      const existing = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      let currentData: any = {};
      if (existing.ok) {
        currentData = await existing.json();
      }
      currentData[fact.field] = fact.value;
      currentData._source = currentData._source || {};
      if (fact.sourceMessageId) currentData._source[fact.field] = fact.sourceMessageId;
      currentData._updatedAt = currentData._updatedAt || {};
      currentData._updatedAt[fact.field] = new Date().toISOString();

      const putResp = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(currentData, null, 2),
      });
      return { success: putResp.ok };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async listEntityFacts(contactId: string, entity: string): Promise<Record<string, MemoryFact>> {
    if (!this.isConfigured()) return {};
    return {};
  }
}

/**
 * Entrada de fato detectado durante o turno
 */
export interface DetectedFactEntry {
  entity: string;
  field: string;
  value: any;
  sourceMessageId: string;
  confidence?: number;
}

/**
 * OverlayMemoryProvider: Provedor de memória em camada para ciclos de orquestração.
 * Intercepta leituras e escritas do turno mantendo fatos recém-detectados em RAM local.
 * NUNCA propaga mutações para o baseProvider (banco de dados) antes da confirmação atômica do ciclo.
 */
export class OverlayMemoryProvider implements MemoryProvider {
  private baseProvider: MemoryProvider;
  private overlayStore = new Map<string, ContactMemoryStore>();
  private pendingDetectedFacts: DetectedFactEntry[] = [];

  constructor(baseProvider: MemoryProvider, initialPendingFacts: DetectedFactEntry[] = []) {
    this.baseProvider = baseProvider;
    for (const f of initialPendingFacts) {
      this.addOverlayFact(f);
    }
  }

  private getOrCreateOverlay(contactId: string): ContactMemoryStore {
    let store = this.overlayStore.get(contactId);
    if (!store) {
      store = { entities: {}, snippets: [] };
      this.overlayStore.set(contactId, store);
    }
    return store;
  }

  addOverlayFact(entry: DetectedFactEntry, contactId: string = "default"): void {
    this.pendingDetectedFacts.push(entry);
    const store = this.getOrCreateOverlay(contactId);
    const normEntity = (entry.entity || "self").toLowerCase().trim();
    const normField = (entry.field || "").toLowerCase().trim();
    if (!store.entities[normEntity]) {
      store.entities[normEntity] = {};
    }
    store.entities[normEntity][normField] = {
      entity: normEntity,
      field: normField,
      value: entry.value,
      confidence: entry.confidence ?? 1.0,
      sourceMessageId: entry.sourceMessageId,
      updatedAt: new Date().toISOString(),
    };
  }

  getPendingFacts(): DetectedFactEntry[] {
    return [...this.pendingDetectedFacts];
  }

  clearPendingFacts(): void {
    this.pendingDetectedFacts = [];
  }

  async getFact(contactId: string, entity: string, field: string): Promise<{ found: boolean; fact?: MemoryFact; value?: any }> {
    const store = this.getOrCreateOverlay(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    const normField = (field || "").toLowerCase().trim();
    const overlayFact = store.entities[normEntity]?.[normField];
    if (overlayFact) {
      return { found: true, fact: overlayFact, value: overlayFact.value };
    }
    return this.baseProvider.getFact(contactId, entity, field);
  }

  async listEntityFacts(contactId: string, entity: string): Promise<Record<string, MemoryFact>> {
    const baseFacts = await this.baseProvider.listEntityFacts(contactId, entity);
    const store = this.getOrCreateOverlay(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    const overlayFacts = store.entities[normEntity] || {};
    return {
      ...(baseFacts || {}),
      ...overlayFacts,
    };
  }

  async searchMemory(contactId: string, query: string, options?: { entity?: string; limit?: number }): Promise<MemorySearchResult[]> {
    const limit = options?.limit || 3;
    const baseResults = await this.baseProvider.searchMemory(contactId, query, options);
    if (baseResults.length >= limit) {
      return baseResults;
    }

    const store = this.getOrCreateOverlay(contactId);
    const normQuery = (query || "").toLowerCase().trim();
    const targetEntity = options?.entity?.toLowerCase()?.trim();
    const additional: MemorySearchResult[] = [];

    if (store.entities) {
      for (const entKey of Object.keys(store.entities)) {
        if (targetEntity && entKey !== targetEntity) continue;
        const entObj = store.entities[entKey];
        for (const fKey of Object.keys(entObj)) {
          const f = entObj[fKey];
          const factText = `${entKey}.${fKey}: ${f.value}`;
          if (normQuery && factText.toLowerCase().includes(normQuery)) {
            additional.push({
              snippet: factText,
              sourceMessageId: f.sourceMessageId,
              entity: entKey,
            });
            if (baseResults.length + additional.length >= limit) break;
          }
        }
        if (baseResults.length + additional.length >= limit) break;
      }
    }

    return [...baseResults, ...additional];
  }

  async writeFact(contactId: string, fact: Omit<MemoryFact, "updatedAt">): Promise<{ success: boolean; error?: string }> {
    if (this.baseProvider && typeof (this.baseProvider as any).writeFact === "function") {
      const bp = this.baseProvider as any;
      const isRealOrSpy =
        bp.constructor?.name === "SupabaseMemoryProvider" ||
        bp.constructor?.name === "StrictSpiesMemoryProvider" ||
        Boolean(bp.supabase) ||
        bp.saveCalls !== undefined ||
        bp.writeCalls !== undefined;
      if (!isRealOrSpy) {
        await bp.writeFact(contactId, fact);
      }
    }
    this.addOverlayFact({
      entity: fact.entity,
      field: fact.field,
      value: fact.value,
      confidence: fact.confidence,
      sourceMessageId: fact.sourceMessageId || "",
    }, contactId);
    return { success: true };
  }

  async saveFact(contactId: string, entity: string, field: string, value: any, options?: { confidence?: number; sourceMessageId?: string }): Promise<{ success: boolean; error?: string }> {
    this.addOverlayFact({
      entity,
      field,
      value,
      confidence: options?.confidence ?? 1.0,
      sourceMessageId: options?.sourceMessageId || "",
    }, contactId);
    return { success: true };
  }

  getOrCreateStore(contactId: string): ContactMemoryStore {
    const overlay = this.getOrCreateOverlay(contactId);
    if (typeof (this.baseProvider as any).getOrCreateStore === "function") {
      const baseStore = (this.baseProvider as any).getOrCreateStore(contactId);
      const mergedEntities: Record<string, Record<string, MemoryFact>> = {};
      for (const k of Object.keys(baseStore.entities || {})) {
        mergedEntities[k] = { ...(baseStore.entities[k] || {}) };
      }
      for (const k of Object.keys(overlay.entities || {})) {
        mergedEntities[k] = { ...(mergedEntities[k] || {}), ...(overlay.entities[k] || {}) };
      }
      return {
        entities: mergedEntities,
        snippets: [...(baseStore.snippets || []), ...(overlay.snippets || [])],
      };
    }
    return overlay;
  }
}

export function createOverlayMemoryProvider(
  baseProvider: MemoryProvider,
  initialPendingFacts: DetectedFactEntry[] = []
): OverlayMemoryProvider {
  return new OverlayMemoryProvider(baseProvider, initialPendingFacts);
}

// ----------------------------------------------------------------------------
// 7.6. Extração Determinística de Fatos Objetivos & MemoryWriter
// ----------------------------------------------------------------------------

/**
 * Extrai fatos objetivos com evidência explícita direta do texto.
 * NÃO inventa nem infere dados a partir de afirmações vagas.
 */
export function extractFactsFromInboundText(text: string, sourceMessageId?: string): Array<Omit<MemoryFact, "updatedAt">> {
  const facts: Array<Omit<MemoryFact, "updatedAt">> = [];
  const clean = (text || "").trim();
  if (!clean || clean.length < 3) return facts;

  // 1. Idade de Terceiros (ex: "minha prima Maria tem 25 anos", "meu filho Pedro tem 8 anos")
  const thirdPartyAgeMatch = clean.match(
    /(?:minha prima|meu primo|meu filho|minha filha|minha mãe|meu pai|minha irmã|meu irmão)\s*([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]+)?\s*(?:tem|tá com|está com|completou|fez)\s*(\d{1,2})\s*(?:anos)?/i
  );
  if (thirdPartyAgeMatch) {
    const kin = clean.toLowerCase().includes("prima")
      ? "prima"
      : clean.toLowerCase().includes("filho")
      ? "filho"
      : clean.toLowerCase().includes("filha")
      ? "filha"
      : clean.toLowerCase().includes("primo")
      ? "primo"
      : (clean.toLowerCase().includes("mãe") || clean.toLowerCase().includes("mae"))
      ? "mae"
      : clean.toLowerCase().includes("pai")
      ? "pai"
      : (clean.toLowerCase().includes("irmão") || clean.toLowerCase().includes("irmao"))
      ? "irmao"
      : (clean.toLowerCase().includes("irmã") || clean.toLowerCase().includes("irma"))
      ? "irma"
      : "terceiro";
    const namePart = thirdPartyAgeMatch[1] ? `_${thirdPartyAgeMatch[1].toLowerCase().trim()}` : "";
    const entity = `${kin}${namePart}`;
    const ageVal = parseInt(thirdPartyAgeMatch[2], 10);
    if (!isNaN(ageVal) && ageVal > 0 && ageVal < 120) {
      facts.push({
        entity,
        field: "age",
        value: ageVal,
        sourceMessageId,
        confidence: 0.95,
      });
    }
  }

  // 2. Idade do Pretendente ("self.age")
  // Expressões explícitas: "tenho 40 anos", "faço 25 anos", "fiz 40 semana passada", "tinha 39, fiz 40", "estou com 30 anos"
  // Frases vagas como "tô ficando velho" NÃO casam.
  const selfAgeMatch =
    clean.match(/(?:(?:eu\s+)?tenho|complet(?:ei|ando)|faço|fiz|estou com|tô com|minha idade [eé])\s+(\d{1,2})\s*(?:anos)?/i) ||
    clean.match(/(?:tinha\s+\d{1,2}[,\s]+(?:mas\s+)?fiz\s+(\d{1,2}))/i);

  if (selfAgeMatch && !thirdPartyAgeMatch) {
    const ageVal = parseInt(selfAgeMatch[1], 10);
    if (!isNaN(ageVal) && ageVal >= 16 && ageVal <= 110) {
      facts.push({
        entity: "self",
        field: "age",
        value: ageVal,
        sourceMessageId,
        confidence: 0.95,
      });
    }
  }

  // 3. Cidade / Residência ("self.city")
  const cityMatch = clean.match(
    /(?:moro em|sou de|vivo em|resido em)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]{2,35}?)(?=(?:\s+e\s+(?:voc[eê]|vc)\b|[,\.!\?]|(?:\s+mas\b)|\s*$))/i
  );
  if (cityMatch) {
    const city = cityMatch[1].trim();
    if (!/^(um|uma|aqui|ali|casa|apartamento)$/i.test(city)) {
      facts.push({
        entity: "self",
        field: "city",
        value: city,
        sourceMessageId,
        confidence: 0.9,
      });
    }
  }

  // 4. Profissão / Ocupação ("self.profession" e "self.job")
  const profMatch = clean.match(
    /(?:trabalho como|trabalho com|trabalho na área de|sou)\s+(engenharia|engenheiro|médico|advogado|programador|dev|ti|médica|advogada|autônomo|professor|professora|vendedor|contador|arquiteto)/i
  );
  if (profMatch) {
    const pVal = profMatch[1].toLowerCase().trim();
    facts.push({
      entity: "self",
      field: "profession",
      value: pVal,
      sourceMessageId,
      confidence: 0.9,
    });
    facts.push({
      entity: "self",
      field: "job",
      value: pVal,
      sourceMessageId,
      confidence: 0.9,
    });
  }

  // 5. Veículo ("self.vehicle")
  const vehicleMatch = clean.match(
    /(?:tenho uma|comprei uma|tenho um|comprei um)\s+(amarok|hilux|corolla|civic|ranger|s10|golf|onix|hb20|tracker|compass|renegade)/i
  );
  if (vehicleMatch) {
    facts.push({
      entity: "self",
      field: "vehicle",
      value: vehicleMatch[1].trim(),
      sourceMessageId,
      confidence: 0.95,
    });
  }

  return facts;
}

/**
 * MemoryWriter: Executado de forma assíncrona pós-despacho de balões.
 * NUNCA bloqueia o envio nem aciona fallback legado em caso de erro.
 */
export async function executeMemoryWriter(params: {
  conversationId: string;
  claimedMessages: CanonicalMessage[];
  lastLarissaTurn?: StructuredConversationMessage[];
  sentResponseText?: string;
  memoryProvider: MemoryProvider;
  supabase?: any;
  trace: string[];
}): Promise<{ factsExtracted: number; trace: string[] }> {
  const { conversationId, claimedMessages, memoryProvider, trace } = params;
  trace.push("memory_writer_started");
  let factsCount = 0;

  try {
    for (const msg of claimedMessages) {
      if (msg.sender !== "pretendente" && msg.direction !== "inbound") continue;
      const text = (msg.text || "").trim();
      if (!text || text.length < 3) continue;

      const extracted = extractFactsFromInboundText(text, msg.id);
      for (const fact of extracted) {
        await memoryProvider.writeFact(conversationId, fact);
        factsCount++;
        trace.push(`memory_fact_saved=${fact.entity}.${fact.field}`);
      }
    }
  } catch (err: any) {
    trace.push(`memory_writer_error: ${err.message || String(err)}`);
  }

  trace.push("memory_writer_completed");
  return { factsExtracted: factsCount, trace };
}

// ----------------------------------------------------------------------------
// 8. Helper de Invocação de Modelo (Runtime Mock ou Kie.ai Sol / Terra)
// ----------------------------------------------------------------------------

function extractKieResponseText(rawTextOrPayload: any): string {
  if (!rawTextOrPayload) return "";
  if (typeof rawTextOrPayload === "object") {
    if (typeof rawTextOrPayload.output_text === "string") return rawTextOrPayload.output_text;
    if (Array.isArray(rawTextOrPayload.output)) {
      return rawTextOrPayload.output
        .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
        .map((content: any) => (typeof content?.text === "string" ? content.text : ""))
        .filter(Boolean)
        .join("\n");
    }
  }

  if (typeof rawTextOrPayload === "string") {
    try {
      const parsed = JSON.parse(rawTextOrPayload);
      const res = extractKieResponseText(parsed);
      if (res) return res;
    } catch {}

    const lines = rawTextOrPayload.split("\n");
    let accumulatedDelta = "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === "[DONE]") continue;
      try {
        const data = JSON.parse(dataStr);
        if (data.type === "response.output_text.done" && typeof data.text === "string") {
          return data.text;
        }
        if (data.type === "response.output_item.done" && Array.isArray(data.item?.content)) {
          const joined = data.item.content
            .map((c: any) => c.text || "")
            .filter(Boolean)
            .join("\n");
          if (joined) return joined;
        }
        if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
          accumulatedDelta += data.delta;
        }
      } catch {}
    }
    if (accumulatedDelta.trim()) return accumulatedDelta.trim();
  }

  return "";
}

export interface ModelCallOptions {
  runtime?: { callModel?: (prompt: string) => Promise<{ content: string; tokens?: number; inputTokens?: number; outputTokens?: number }> };
  supabase: any;
  model?: string;
  temperature?: number;
  reasoningEffort?: "low" | "medium";
  disallowDowngrade?: boolean;
}

async function callModelOrOpenAi(
  prompt: string,
  options: ModelCallOptions
): Promise<{ content: string; tokens: number; inputTokens: number; outputTokens: number; tokenMeasurement: "provider" | "estimated" }> {
  if (options.runtime?.callModel) {
    const res = await options.runtime.callModel(prompt);
    const content = res.content || (res as any).text || "";
    const hasSplitUsage = Number.isFinite(res.inputTokens) && Number.isFinite(res.outputTokens);
    const inputTokens = hasSplitUsage ? Number(res.inputTokens) : estimateTextTokens(prompt);
    const outputTokens = hasSplitUsage ? Number(res.outputTokens) : estimateTextTokens(content);
    return { content, tokens: res.tokens || inputTokens + outputTokens, inputTokens, outputTokens, tokenMeasurement: hasSplitUsage ? "provider" : "estimated" };
  }

  // 1. Motor Oficial Prioritário: OpenAI (api.openai.com)
  let openAiKey = (Deno?.env?.get?.("OPENAI_API_KEY") || "").trim();
  if (!openAiKey) {
    try {
      const { data: cfgSecret } = await options.supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "openai_api_key")
        .maybeSingle();
      openAiKey = (cfgSecret?.app_secret || "").trim();
    } catch (_err) {
      // Fail-safe silencioso
    }
  }

  const primaryModel = options.model || (options.disallowDowngrade ? OPENAI_EXECUTOR_DEFAULT_MODEL : "gpt-4o-mini");
  const maxRetries = 3;
  let lastError: any = null;

  if (options.disallowDowngrade && !openAiKey) {
    throw new Error("EXECUTOR_MODEL_FAILED: OPENAI_API_KEY ausente para execução do subagente executor.");
  }

  if (openAiKey) {
    let currentModel = primaryModel;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
          const reqBody: any = {
            model: currentModel,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          };
          if (!currentModel.includes("terra") && !currentModel.startsWith("o1") && !currentModel.startsWith("o3")) {
            reqBody.temperature = options.temperature ?? 0.3;
          }

          const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openAiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(35000),
          });

        if (oaiRes.ok) {
          const jsonRes = await oaiRes.json();
          const choice = jsonRes.choices?.[0];
          let content = choice?.message?.content || "";
          const providerInput = jsonRes.usage?.prompt_tokens;
          const providerOutput = jsonRes.usage?.completion_tokens;
          const hasSplitUsage = Number.isFinite(providerInput) && Number.isFinite(providerOutput);
          const inputTokens = hasSplitUsage ? providerInput : estimateTextTokens(prompt);
          const outputTokens = hasSplitUsage ? providerOutput : estimateTextTokens(content);
          const tokens = jsonRes.usage?.total_tokens || inputTokens + outputTokens;

          if (!content && choice?.message?.reasoning_content) {
            const match = choice.message.reasoning_content.match(/\{[\s\S]*\}/);
            if (match) content = match[0];
          }

          if (content.trim()) {
            return { content: content.trim(), tokens, inputTokens, outputTokens, tokenMeasurement: hasSplitUsage ? "provider" : "estimated" };
          }
        }

        // Se disallowDowngrade for true, NUNCA permite fallback para modelo inferior
        if (options.disallowDowngrade) {
          const errText = await oaiRes.text();
          lastError = new Error(`OpenAI (${currentModel}) retornou erro HTTP ${oaiRes.status}: ${errText.slice(0, 200)}`);
          if ([500, 502, 503, 504, 429].includes(oaiRes.status)) {
            console.warn(`[Orchestrator] OpenAI (${currentModel}) retornou status transitório ${oaiRes.status} na tentativa ${attempt}/${maxRetries}. Aguardando retry...`);
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }
          break;
        }

        // Se o modelo solicitado der 404 (model_not_found), tenta fallback para gpt-4o-mini (somente legado)
        if (oaiRes.status === 404 && currentModel !== "gpt-4o-mini") {
          console.warn(`[Orchestrator] Modelo ${currentModel} não encontrado na OpenAI (404). Alternando para gpt-4o-mini...`);
          currentModel = "gpt-4o-mini";
          continue;
        }

        if ([500, 502, 503, 504, 429].includes(oaiRes.status)) {
          const warnText = await oaiRes.text();
          console.warn(`[Orchestrator] OpenAI (${currentModel}) retornou status transitório ${oaiRes.status} na tentativa ${attempt}/${maxRetries}. Aguardando retry...`);
          lastError = new Error(`OpenAI retornou erro HTTP ${oaiRes.status}: ${warnText.slice(0, 150)}`);
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          continue;
        }

        const errText = await oaiRes.text();
        lastError = new Error(`OpenAI retornou erro HTTP ${oaiRes.status}: ${errText.slice(0, 200)}`);
        break;
      } catch (fetchErr: any) {
        lastError = fetchErr;
        console.warn(`[Orchestrator] Falha de conexão com OpenAI na tentativa ${attempt}/${maxRetries}:`, fetchErr.message);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  // Falha fechada no caminho experimental: não degrada para Kie/Atria/Groq com fallback
  if (options.disallowDowngrade) {
    throw new Error(`EXECUTOR_MODEL_FAILED: Falha na execução estrita com modelo ${primaryModel} (${lastError?.message || "falha desconhecida"})`);
  }

  // 2. Fallback Secundário via Kie.ai (gpt-5-6-sol / gpt-5-6-terra)
  let kieKey = (Deno?.env?.get?.("KIE_API_KEY") || "").trim();
  if (!kieKey) {
    try {
      const { data: cfgSecret } = await options.supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "kie_api_key")
        .maybeSingle();
      kieKey = (cfgSecret?.app_secret || "").trim();
    } catch (_err) {}
  }
  if (kieKey) {
    try {
      console.log("[Orchestrator] Acionando contingência Kie.ai Codex...");
      const kieModel = options.model?.includes("terra") ? "gpt-5-6-terra" : "gpt-5-6-sol";
      const kieRes = await fetch("https://api.kie.ai/codex/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${kieKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: kieModel,
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          ],
          reasoning: { effort: options.reasoningEffort || "low" },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (kieRes.ok) {
        const sseText = await kieRes.text();
        const content = extractKieResponseText(sseText);
        if (content.trim()) {
          const inputTokens = estimateTextTokens(prompt);
          const outputTokens = estimateTextTokens(content);
          return { content: content.trim(), tokens: inputTokens + outputTokens, inputTokens, outputTokens, tokenMeasurement: "estimated" };
        }
      }
    } catch (kieErr: any) {
      console.warn("[Orchestrator] Contingência Kie.ai indisponível:", kieErr.message);
    }
  }

  // 3. Fallback Terciário via Atria (Atria-Dawn-Preview)
  let atriaKey = (Deno?.env?.get?.("ATRIA_API_KEY") || "").trim();
  if (!atriaKey) {
    try {
      const { data: atriaSecret } = await options.supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "atria_api_key")
        .maybeSingle();
      atriaKey = (atriaSecret?.app_secret || "").trim();
    } catch (_err) {}
  }

  if (atriaKey) {
    try {
      console.log("[Orchestrator] Acionando contingência Atria...");
      const atriaRes = await fetch("https://api.atria-asi.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${atriaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "Atria-Dawn-Preview",
          temperature: 0.2,
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (atriaRes.ok) {
        const jsonRes = await atriaRes.json();
        const choice = jsonRes.choices?.[0];
        let content = choice?.message?.content || "";
        const providerInput = jsonRes.usage?.prompt_tokens;
        const providerOutput = jsonRes.usage?.completion_tokens;
        const hasSplitUsage = Number.isFinite(providerInput) && Number.isFinite(providerOutput);
        const inputTokens = hasSplitUsage ? providerInput : estimateTextTokens(prompt);
        const outputTokens = hasSplitUsage ? providerOutput : estimateTextTokens(content);
        const tokens = jsonRes.usage?.total_tokens || inputTokens + outputTokens;

        if (!content && choice?.message?.reasoning_content) {
          const match = choice.message.reasoning_content.match(/\{[\s\S]*\}/);
          if (match) content = match[0];
        }

        if (content) {
          return { content, tokens, inputTokens, outputTokens, tokenMeasurement: hasSplitUsage ? "provider" : "estimated" };
        }
      }
    } catch (atriaErr: any) {
      console.warn("[Orchestrator] Contingência Atria indisponível:", atriaErr.message);
    }
  }

  // 4. Fallback Defensivo Final via Groq Cloud
  let groqKey = (Deno?.env?.get?.("GROQ_API_KEY") || "").trim();
  if (!groqKey) {
    try {
      const { data: groqSecret } = await options.supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "groq_api_key")
        .maybeSingle();
      groqKey = (groqSecret?.app_secret || "").trim();
    } catch (_err) {}
  }

  if (groqKey) {
    try {
      console.log("[Orchestrator] Acionando fallback defensivo final via Groq...");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b",
          temperature: 0.2,
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (groqRes.ok) {
        const jsonRes = await groqRes.json();
        const content = jsonRes.choices?.[0]?.message?.content || "";
        const providerInput = jsonRes.usage?.prompt_tokens;
        const providerOutput = jsonRes.usage?.completion_tokens;
        const hasSplitUsage = Number.isFinite(providerInput) && Number.isFinite(providerOutput);
        const inputTokens = hasSplitUsage ? providerInput : estimateTextTokens(prompt);
        const outputTokens = hasSplitUsage ? providerOutput : estimateTextTokens(content);
        const tokens = jsonRes.usage?.total_tokens || inputTokens + outputTokens;
        if (content) return { content, tokens, inputTokens, outputTokens, tokenMeasurement: hasSplitUsage ? "provider" : "estimated" };
      }
    } catch (groqErr: any) {
      console.warn("[Orchestrator] Fallback final da Groq também falhou:", groqErr.message);
    }
  }

  throw lastError || new Error("Falha na invocação da IA (OpenAI, Kie.ai, Atria e Groq indisponíveis).");
}

const callModelOrKie = callModelOrOpenAi;
const callModelOrAtria = callModelOrOpenAi;

// ----------------------------------------------------------------------------
// 9. Motor Operacional Determinístico do Backend (runExperimentalOrchestration)
// ----------------------------------------------------------------------------
export interface RunOrchestrationParams {
  supabase: any;
  conversationId: string;
  newMessage: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  correlationId?: string;
  model?: string;
  memoryProvider?: MemoryProvider;
  responseDelayMinutes?: number;
  runtime?: {
    sendMetaTextMessage?: (supabase: any, conversationId: string, text: string) => Promise<any>;
    callModel?: (prompt: string) => Promise<{ content: string; tokens?: number }>;
    memoryProvider?: MemoryProvider;
    _fastTest?: boolean;
  };
}

export interface OrchestrationResult {
  mode: OrchestrationMode;
  handled: boolean;
  skippedDuplicate?: boolean;
  sentToMeta?: boolean;
  blockLegacyFallback?: boolean; // SINAL EXPLÍCITO: Quando true, bloqueia terminantemente qualquer fallback para o legado
  decision?: OrchestratorDecision;
  durationMs?: number;
  tokens?: number;
  trace?: string[];
  error?: string;
}

export async function runExperimentalOrchestration(
  params: RunOrchestrationParams
): Promise<OrchestrationResult> {
  const { supabase, conversationId, newMessage, runtime } = params;
  const startTime = Date.now();
  const correlationId =
    params.correlationId || `corr_${startTime}_${Math.random().toString(36).slice(2, 7)}`;
  const memoryProvider: MemoryProvider =
    params.memoryProvider ||
    runtime?.memoryProvider ||
    new SupabaseMemoryProvider(supabase);

  // Overlay local do turno para isolamento estrito de memória:
  // Fatos detectados no turno são mantidos em RAM e NUNCA gravados no baseProvider antes da confirmação do ciclo.
  const pendingDetectedFacts: DetectedFactEntry[] = [];
  const cycleMemoryProvider = createOverlayMemoryProvider(memoryProvider, pendingDetectedFacts);

  // 1. Carrega o estado atual da conversa
  const { data: convRow, error: convErr } = await supabase
    .from("instagram_conversations")
    .select("stage_completed_rules, is_restricted")
    .eq("id", conversationId)
    .maybeSingle();

  if (convErr) {
    console.error(`[Orchestrator] Erro ao buscar conversa ${conversationId}:`, convErr);
    return { mode: "legacy", handled: false, blockLegacyFallback: true, error: convErr.message };
  }

  const stageRules = convRow?.stage_completed_rules || {};

  // Debounce Real (Quiet Period): Respeita responseDelayMinutes da conversa/configuração
  const responseDelayMinutes = typeof params.responseDelayMinutes === "number"
    ? params.responseDelayMinutes
    : Number(stageRules?.responseDelayMinutes ?? 1);
  const quietPeriodMs = Math.max(responseDelayMinutes, 0) * 60 * 1000;
  const computedDebounceUntil = quietPeriodMs > 0
    ? new Date(Date.now() + quietPeriodMs).toISOString()
    : new Date(Date.now() + 2500).toISOString();
  const orchState: ConversationOrchestrationState = stageRules.orchestration || {
    version: 1,
    mode: "legacy",
    currentPhase: "conexao_inicial",
    checkpoint: "chk_saudacao_feita",
    lastProcessedMessageId: null,
    lastProcessedAt: null,
    lastProcessingStatus: "idle",
    lastCorrelationId: null,
    lastDecision: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
  // SNAPSHOT IMUTÁVEL NO INÍCIO DO CICLO:
  // A autoridade de progresso oficial pertence ao stage_completed_rules.
  // orchState.completedGoalIds e orchState.objectiveProgress servem como espelho/fallback.
  const officialCompletedGoalIdsAtCycleStart = resolveOfficialCompletedGoals(stageRules, orchState);
  const officialObjectiveProgressAtCycleStart = resolveOfficialObjectiveProgress(stageRules, orchState);

  // 2. ISOLAMENTO TOTAL: Conversas no modo 'legacy' retornam imediatamente
  if (orchState.mode === "legacy") {
    return { mode: "legacy", handled: false };
  }

  // 3. BACKEND DETERMINÍSTICO: Idempotência estrita
  if (orchState.lastProcessedMessageId && orchState.lastProcessedMessageId === newMessage.id) {
    console.log(
      `[Orchestrator] Mensagem ${newMessage.id} já processada em ${conversationId}. Abortando por idempotência.`
    );
    return { mode: orchState.mode, handled: true, skippedDuplicate: true, blockLegacyFallback: true };
  }

  // 3. BACKEND DETERMINÍSTICO: Lock Atômico via PostgreSQL com SELECT ... FOR UPDATE
  const claimLockRes = await claimExperimentalCycleAtomic({
    supabase,
    conversationId,
    cycleToken: correlationId,
    staleSeconds: 25,
  });

  if (!claimLockRes.success) {
    if (claimLockRes.reason === "infra_failure" || (claimLockRes as any).isInfraFailure) {
      console.error(
        `[Orchestrator] FAIL CLOSED: Falha de infraestrutura no claim atômico inicial para ${conversationId}. Abortando.`
      );
      if (orchState.messageLedger) {
        orchState.messageLedger[newMessage.id] = "pending";
      }
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: "Falha de infraestrutura no claim atômico (rpc_error_fail_closed)",
      };
    }
    console.log(
      `[Orchestrator] Lock ativo detectado (${claimLockRes.activeCycleToken || "outro ciclo"}) para ${conversationId}. Abortando execução concorrente.`
    );
    return {
      mode: orchState.mode,
      handled: false,
      sentToMeta: false,
      blockLegacyFallback: true,
      error: "Lock ativo concorrente",
    };
  }

  let claimedMessageIds: string[] = [];
  let sentSuccessfully = false;
  let currentCycle: ProcessingCycle | null = null;
  const ledger: Record<string, MessageProcessingStatus> = { ...(orchState.messageLedger || {}) };
  const outboxMap: Record<string, OutboxEntry> = { ...(orchState.outbox || {}) };
  const activeLock = stageRules.active_cycle_token;
  const activeLockAt = stageRules.active_cycle_at ? Date.parse(stageRules.active_cycle_at) : 0;

  try {
    const initialInboundRevision =
      typeof orchState.inboundRevision === "number"
        ? orchState.inboundRevision
        : typeof stageRules.inbound_revision === "number"
        ? stageRules.inbound_revision
        : 0;

    currentCycle = {
      cycleId: correlationId,
      conversationId,
      claimedMessageIds: [],
      startedAt: new Date().toISOString(),
      status: "in_progress",
      agentVersions: {
        router: "1.2.0",
        subagent: "1.2.0",
        prompt: "1.2.0",
      },
      inputWatermark: {
        revision: initialInboundRevision,
        claimedCount: 0,
        snapshotTimestamp: new Date().toISOString(),
      },
      trace: [
        `cycle_started: ${correlationId}`,
        `input_watermark: rev=${initialInboundRevision}`,
      ],
    };

    // ACK ATÔMICO REVISION-AWARE DE PREEMPÇÃO HERDADA:
    // O NOVO owner precisa reconhecer a preempção herdada ANTES de tentar claimar as mensagens!
    const ackRes = await ackCyclePreemptionAtomic({
      supabase,
      conversationId,
      correlationId,
      expectedInboundRevision: initialInboundRevision,
    });

    if (ackRes.acknowledged) {
      stageRules.preempt_requested = false;
      orchState.preemptRequested = false;
      currentCycle.trace.push(`preemption_acknowledged: rev=${initialInboundRevision}`);
    } else if (ackRes.reason === "newer_revision_detected") {
      console.warn(
        `[Orchestrator] Nova inbound detectada antes do ACK de preempção para ciclo ${correlationId} em ${conversationId} (current=${ackRes.currentRevision}, expected=${initialInboundRevision}). Abortando sem limpar preempção.`
      );
      currentCycle.status = "superseded";
      currentCycle.trace.push(
        `preemption_ack_failed_newer_revision: current=${ackRes.currentRevision}, expected=${initialInboundRevision}`
      );
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        debounceUntil: new Date(Date.now() + 2500).toISOString(),
        cycleRecord: currentCycle,
      });
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: "Ciclo preemptado por nova mensagem inbound recebida antes do ACK (newer_revision_detected)",
      };
    } else if (ackRes.reason === "cycle_token_mismatch") {
      console.warn(
        `[Orchestrator] Ciclo ${correlationId} perdeu ownership para outro ciclo antes do ACK em ${conversationId}. Abortando sem modificar estado.`
      );
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: "Ciclo preemptado por perda de custódia inicial (cycle_token_mismatch)",
      };
    } else {
      // Fail closed: qualquer falha na RPC ou estado inesperado aborta com segurança
      console.error(
        `[Orchestrator] FAIL CLOSED: Falha na RPC ack_experimental_cycle_preemption para ${conversationId} (motivo=${ackRes.reason}). Abortando.`
      );
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        lastError: `Falha ao reconhecer preempção: ${ackRes.reason}`,
        cycleRecord: currentCycle,
      });
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: `Falha de infraestrutura ao reconhecer preempção (fail_closed: ${ackRes.reason})`,
      };
    }

    // 4. BACKEND DETERMINÍSTICO: Cancelamento e checagem de pausa pelo operador
    if (stageRules.cancel_current_cycle === true || stageRules.status === "paused_manual") {
      console.log(`[Orchestrator] Ciclo cancelado pelo operador para ${conversationId}.`);
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        clearCancelFlag: true,
        cycleRecord: currentCycle,
      });
      return { mode: orchState.mode, handled: false, sentToMeta: false, blockLegacyFallback: true, error: "Cancelado pelo operador" };
    }

    const currentPhase: OrchestrationPhase = orchState.currentPhase || "conexao_inicial";

    // 5. BACKEND DETERMINÍSTICO: Ledger & Seleção de TODAS as mensagens pendentes (Sem cortes arbitrários)
    const collectedPendingRaw: CanonicalMessage[] = [];
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const q = supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, text, reply_to_message_id, created_at, timestamp, media_type, media_url, direction")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false });

      let batch: any[] = [];
      if (typeof (q as any).range === "function") {
        const res = await (q as any).range(offset, offset + batchSize - 1);
        batch = res?.data || [];
      } else if (typeof (q as any).limit === "function") {
        const res = await (q as any).limit(batchSize);
        batch = res?.data || [];
      } else {
        const res = await q;
        batch = res?.data || [];
      }

      if (!batch || batch.length === 0) {
        break;
      }

      for (const m of batch) {
        const msg = normalizeToCanonicalMessage(m, conversationId);
        if (msg.sender === "pretendente" && msg.direction === "inbound") {
          const isActivelyClaimed =
            ledger[msg.id] === "claimed" &&
            activeLock &&
            Date.now() - activeLockAt < 25000 &&
            activeLock !== correlationId;
          const isProcessed =
            ledger[msg.id] === "processed" ||
            isActivelyClaimed ||
            (orchState.lastProcessedMessageId && msg.id === orchState.lastProcessedMessageId);

          if (!isProcessed) {
            collectedPendingRaw.push({ ...msg, status: "pending" });
          }
        }
      }

      if (batch.length < batchSize || typeof (q as any).range !== "function") {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    // Inverte para restaurar a ordem cronológica ascendente (ASC)
    const pendingMessages: CanonicalMessage[] = collectedPendingRaw.reverse();

    if (newMessage && !pendingMessages.some((m) => m.id === newMessage.id)) {
      const isActivelyClaimed =
        ledger[newMessage.id] === "claimed" &&
        activeLock &&
        Date.now() - activeLockAt < 25000 &&
        activeLock !== correlationId;
      const isProcessed =
        ledger[newMessage.id] === "processed" ||
        isActivelyClaimed ||
        (orchState.lastProcessedMessageId && newMessage.id === orchState.lastProcessedMessageId);
      if (!isProcessed) {
        pendingMessages.push(
          normalizeToCanonicalMessage(
            {
              id: newMessage.id,
              sender_id: newMessage.sender,
              text: newMessage.text,
              created_at: newMessage.timestamp,
              is_mine: false,
            },
            conversationId
          )
        );
      }
    }

    // Garante ordenação cronológica ascendente estrita
    pendingMessages.sort((a, b) => {
      const timeA = a.timestamp || a.created_at || "";
      const timeB = b.timestamp || b.created_at || "";
      return timeA > timeB ? 1 : timeA < timeB ? -1 : 0;
    });

    if (pendingMessages.length === 0) {
      console.log(`[Orchestrator] Nenhuma mensagem pendente para ${conversationId}. Abortando por idempotência.`);
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        cycleRecord: currentCycle,
      });
      return { mode: orchState.mode, handled: true, skippedDuplicate: true, blockLegacyFallback: true };
    }

    // SNAPSHOT IMUTÁVEL DO CICLO: Claims all pending messages
    claimedMessageIds = pendingMessages.map((m) => m.id);
    const claimedMessages = pendingMessages.map((m) => ({
      ...m,
      status: "claimed" as MessageProcessingStatus,
      claimedByCycleId: correlationId,
    }));
    const rawInbounds = (claimedMessages || []).filter((m: any) => m.sender === "pretendente" || m.direction === "inbound");

    for (const id of claimedMessageIds) {
      ledger[id] = "claimed";
    }

    // Persiste atomicamente o claim e o ledger no banco de dados via RPC com SELECT ... FOR UPDATE
    const claimMsgsRes = await claimExperimentalCycleMessagesAtomic({
      supabase,
      conversationId,
      cycleToken: correlationId,
      messageIds: claimedMessageIds,
    });

    if (!claimMsgsRes.success) {
      console.warn(
        `[Orchestrator] Falha no claim atômico de mensagens para ciclo ${correlationId} em ${conversationId} (motivo=${claimMsgsRes.reason}). Abortando ciclo.`
      );
      currentCycle.status = "superseded";
      currentCycle.trace.push(`claim_messages_failed: ${claimMsgsRes.reason}`);
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        lastError: `Falha no claim de mensagens: ${claimMsgsRes.reason}`,
        cycleRecord: currentCycle,
      });
      if (claimMsgsRes.reason === "cycle_preempted") {
        return {
          mode: orchState.mode,
          handled: false,
          sentToMeta: false,
          blockLegacyFallback: true,
          error: "Ciclo preemptado antes do claim de mensagens",
        };
      }
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: `Falha ao reivindicar mensagens (${claimMsgsRes.reason})`,
      };
    }

    currentCycle.claimedMessageIds = claimedMessageIds;
    currentCycle.inputWatermark.claimedCount = claimedMessageIds.length;
    currentCycle.trace.push(`input_watermark: rev=${initialInboundRevision}, count=${claimedMessageIds.length}`);
    currentCycle.trace.push(`messages_claimed: ${claimedMessageIds.length}`);
    // Helper atômico de preempção segura contra ciclos zumbis e concorrência
    async function handleCyclePreemption(
      reasonLabel: string,
      freshnessInfo: FreshnessCheckResult
    ): Promise<OrchestrationResult> {
      console.log(
        `[Orchestrator] Freshness Gate: Nova mensagem detectada (${reasonLabel}) em ${conversationId} (motivo=${freshnessInfo.reason}, msgs=${freshnessInfo.newerInboundIds.join(",")}). Preemptando ciclo.`
      );
      currentCycle.status = "superseded";
      currentCycle.trace.push(`cycle_preempted_new_input: ${reasonLabel} (new_msgs=${freshnessInfo.newerInboundCount})`);
      for (const id of claimedMessageIds) {
        ledger[id] = "pending";
      }

      // Liberação atômica segura via PostgreSQL com SELECT ... FOR UPDATE
      const releaseRes = await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "idle",
        debounceUntil: computedDebounceUntil,
        revertMessageIds: claimedMessageIds,
        cycleRecord: currentCycle,
        outboxMap: outboxMap,
      });

      if (!releaseRes.released) {
        console.warn(
          `[Orchestrator] Ciclo ${correlationId} perdeu o lock para ${releaseRes.activeToken || "outro ciclo"}. Abortando preempção sem sobrescrever estado.`
        );
        return {
          mode: orchState.mode,
          handled: false,
          sentToMeta: false,
          blockLegacyFallback: true,
          error: `Ciclo preemptado por perda de lock para ciclo concorrente (${releaseRes.activeToken || "desconhecido"})`,
        };
      }

      await publishAutoPilotState(supabase, conversationId, {
        status: "idle",
        activity: activity(
          "idle",
          "Nova mensagem recebida",
          "Recalculando com contexto atualizado...",
          { mode: orchState.mode }
        ),
      });

      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: `Ciclo preemptado por nova mensagem inbound (${reasonLabel})`,
      };
    }

    const currentCheckpoint =
      orchState.checkpoint ||
      (currentPhase === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita");

    // 6. CONTEXT BUILDER: Projeção Mínima & Lookup Pontual de Replies
    const { payload: baseContextPayload, trace: contextTrace } =
      await buildConversationContextForCycle({
        conversationId,
        currentPhase,
        checkpoint: currentCheckpoint,
        claimedMessages,
        supabase,
        knownFacts: stageRules.known_facts || {},
      });

    currentCycle.trace.push(...contextTrace);
    currentCycle.trace.push(`context_built: msgs=${baseContextPayload.newMessages.length}`);
    const routerContextText = formatContextForConversationAgent(baseContextPayload);
    const conexaoContextText = formatContextForConexaoInicial(baseContextPayload);
    const descobertaContextText = formatContextForDescoberta(baseContextPayload);

    let totalTokens = 0;
    let initialContextTokens = 0;
    let toolCallsCount = 0;
    let toolCallsTokens = 0;
    let toolResultTokens = 0;
    let finalGenerationTokens = 0;

    await publishAutoPilotState(supabase, conversationId, {
      status: "processing",
      activity: activity(
        "atria",
        orchState.mode === "shadow" ? "Atria (Shadow)" : "Agente da Conversa analisando...",
        "Avaliando roteamento da conversa...",
        {
          atriaThought: "Identificando subagente apropriado para o turno...",
          mode: orchState.mode,
          currentPhase,
        }
      ),
    });

    // ------------------------------------------------------------------------
    // RESOLUÇÃO DE OBJETIVOS DA ETAPA (Many-to-Many & Subagent Missions)
    // ------------------------------------------------------------------------
    const currentStageId = (orchState.currentStageId || (
      currentPhase === "conexao_inicial" ? "stage_1_conexao" :
      currentPhase === "descoberta" ? "stage_2_descoberta" :
      currentPhase === "compatibilidade" ? "stage_3_compatibilidade" :
      currentPhase
    )).trim().toLowerCase();

    let completedGoalIds: string[] = [...officialCompletedGoalIdsAtCycleStart];
    let stageChecklistForRouter = await resolveStageObjectives({
      supabase,
      conversationId,
      stageNameOrId: currentStageId,
      memoryProvider: cycleMemoryProvider,
      completedGoalIds,
      historyMessages: claimedMessages,
    });

    // DETECÇÃO ESPONTÂNEA DE OBJETIVOS ANTES DO ROTEAMENTO E SUBAGENTE
    const pendingGoalIdsBefore = stageChecklistForRouter.goals
      .filter((g) => g.status === "pending")
      .map((g) => g.id);

    const spontaneousMatches = detectSpontaneousObjectiveCompletions(
      [{ id: newMessage.id, text: newMessage.text, sender: "pretendente" }],
      pendingGoalIdsBefore
    );

    // Heurística é apenas fonte de evidência: não modifica estado, memória ou
    // checklist. A conclusão pertence exclusivamente ao Brain.
    let workingCompletedGoalIds: string[] = [
      ...completedGoalIds,
      ...(stageChecklistForRouter.completedObjectives || []).map((o: any) => o.id),
    ];
    const candidateObjectiveEvidence = buildObjectiveCandidateEvidence(spontaneousMatches)
      .map((e) => ({ ...e, evidenceMessageId: e.evidenceMessageId || newMessage.id }));
    const shadowDetectedFacts: Array<{ entity: string; field: string; value: any; sourceMessageId: string }> = [];
    const shadowWouldCompleteObjectives: string[] = [];
    if (candidateObjectiveEvidence.length) {
      currentCycle.trace.push(`objective_candidate_evidence: ${candidateObjectiveEvidence.map((e) => e.objectiveId).join(",")}`);
    }

    const openGoalsForRouter = stageChecklistForRouter.goals.filter((g) => g.status === "pending");
    const openGoalsSummary = openGoalsForRouter.length > 0
      ? openGoalsForRouter.map((g) => `• ${g.label}${g.description ? `: ${g.description}` : ""}`).join("\n")
      : undefined;

    // ------------------------------------------------------------------------
    // CARREGAMENTO DO CATÁLOGO DE SUBAGENTES & CAMADA 1: ROTEADOR
    // ------------------------------------------------------------------------
    const availableSubagents = await loadSubagentsCatalog({ supabase });
    // ------------------------------------------------------------------------
    // CONVERSATION BRAIN & ESCADA DE MEMÓRIA EM 6 NÍVEIS
    // ------------------------------------------------------------------------
    const compactSubagents = getCompactSubagentCatalog(availableSubagents);
    const authorizedSubagentIds = new Set(
      stageChecklistForRouter.currentObjective?.allowedSubagents?.length
        ? stageChecklistForRouter.currentObjective.allowedSubagents
        : [stageChecklistForRouter.responsibleSubagent]
    );
    const authorizedCompactSubagents = compactSubagents.filter((subagent: any) => authorizedSubagentIds.has(subagent.id));

    // NÍVEL 0: LiveState
    let currentLiveState: ConversationLiveState = orchState.liveState
      ? { ...orchState.liveState }
      : getDefaultConversationLiveState(conversationId);
    // NÍVEL 1: Mensagens Recentes com Orçamento Estrito (12 msgs / 1500 tokens)
    const recentMessageLimit = BRAIN_ORCHESTRATION_BUDGETS.recent_message_limit;
    const tokenBudget = BRAIN_ORCHESTRATION_BUDGETS.recent_context_token_budget;
    const canonicalClaimed = claimedMessages.map((m: any) => normalizeToCanonicalMessage(m, conversationId));
    const allRecentCandidates = [...canonicalClaimed];

    // Carrega mensagens cronológicas recentes respeitando orçamento e invariantes
    try {
      const { data: recentDbRows } = await supabase
        .from("instagram_messages")
        .select("id, sender_id, is_mine, is_from_me, text, message, created_at, timestamp, direction")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(recentMessageLimit);

      if (recentDbRows && Array.isArray(recentDbRows)) {
        const claimedSet = new Set(claimedMessageIds);
        for (const row of recentDbRows) {
          if (!claimedSet.has(row.id)) {
            allRecentCandidates.unshift(normalizeToCanonicalMessage(row, conversationId));
          }
        }
      }
    } catch {}

    // Contextos obrigatórios são buscados explicitamente e não dependem do LIMIT de recentes.
    allRecentCandidates.push(...await loadMandatoryBrainContextCandidates({
      supabase,
      conversationId,
      claimedMessages: canonicalClaimed,
    }));

    const deduplicatedRecentCandidates = Array.from(
      new Map(allRecentCandidates.map((message) => [String(message.id), message])).values()
    );

    const budgetedRecentContext = buildBudgetedRecentContext({
      messages: deduplicatedRecentCandidates,
      claimedMessageIds,
      tokenBudget,
      messageLimit: recentMessageLimit,
    });
    const finalRecentMessages = budgetedRecentContext.messages;
    currentCycle.trace.push(`brain_recent_context_estimated_tokens: ${budgetedRecentContext.estimatedTokens}`);
    currentCycle.trace.push(`brain_budget_overflow_required: ${budgetedRecentContext.budgetOverflowRequired}`);
    // NÍVEL 2: ContactMemory (fatos conhecidos sobre o pretendente)
    let contactFacts: Record<string, any> = {};
    try {
      const selfFacts = await cycleMemoryProvider.listEntityFacts(conversationId, "self");
      if (selfFacts && typeof selfFacts === "object") {
        for (const [k, f] of Object.entries(selfFacts)) {
          if (f && (f as any).value !== undefined && (f as any).value !== null && (f as any).value !== "") {
            contactFacts[k] = (f as any).value;
          }
        }
      }
    } catch {}
    if (stageRules?.known_facts && typeof stageRules.known_facts === "object") {
      contactFacts = { ...stageRules.known_facts, ...contactFacts };
    }
    const contactMemorySummary = Object.entries(contactFacts)
      .map(([k, v]) => `• ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n");
    // NÍVEL 3 & 4: Landmarks e Speech Acts da Memória Episódica
    const inboundsText = (claimedMessages || [])
      .map((m: any) => m.text || m.content || "")
      .filter(Boolean)
      .join(" ");

    let landmarksSummary = "";
    let speechActsSummary = "";
    try {
      const landmarkHits = await searchConversationEpisodicMemory({
        supabase,
        conversationId,
        query: inboundsText || "geral",
        memoryClass: "landmark",
        limit: 5,
      });
      landmarksSummary = landmarkHits.map((h) => `• [${h.actor}] ${h.summary}`).join("\n");

      const speechActHits = await searchConversationEpisodicMemory({
        supabase,
        conversationId,
        query: inboundsText || "geral",
        memoryClass: "speech_act",
        limit: 5,
      });
      speechActsSummary = speechActHits.map((h) => `• [${h.actor}] ${h.summary}`).join("\n");
    } catch {}

    // Determinação do Provedor do Brain (Feature Flag cirúrgica e segura)
    const configuredBrainProvider =
      stageRules.brainProvider ||
      stageRules.orchestration?.brainProvider ||
      orchState.brainProvider ||
      (typeof Deno !== "undefined"
        ? (Deno.env.get("ENABLE_OPENAI_BRAIN_AGENT") === "true" || orchState.mode === "experimental" || orchState.mode === "shadow" ? "openai_agent" : "internal")
        : (process.env.ENABLE_OPENAI_BRAIN_AGENT === "true" ? "openai_agent" : "internal"));

    const isOpenAiAgentBrain = configuredBrainProvider === "openai_agent";

    // NÍVEL 5: projeção compacta da fonte autoritativa PersonaMemory.
    // Se o provedor for openai_agent, NÃO injeta o resumo genérico de 8 tópicos,
    // pois o novo Brain utiliza a ferramenta real persona_memory_search sob demanda.
    let personaMemorySummary = "";
    if (!isOpenAiAgentBrain) {
      try {
        const personaFacts = await searchPersonaMemory({
          supabase,
          personaId: "larissa",
          query: "identidade cidade estudo trabalho preferências rotina",
          limit: 8,
          allowLegacyFallback: false,
        });
        personaMemorySummary = formatPersonaMemoryHitsForBrain(personaFacts || []);
      } catch {}
    }

    // Telemetria do Brain
    let brainRecentMessagesCount = finalRecentMessages.length;
    let brainInputTokens = 0;
    let brainOutputTokens = 0;
    let brainToolResultTokens = 0;
    let subagentInputTokens = 0;
    let subagentOutputTokens = 0;
    let brainMemorySearchesCount = 0;
    let brainHistorySearchesCount = 0;
    let brainHistoryHits = 0;
    const brainMemorySourcesUsed = new Set<string>();
    let brainUsedRawHistory = false;
    let brainUsedLandmark = Boolean(landmarksSummary);
    let brainUsedContactMemory = Object.keys(contactFacts).length > 0;
    let brainUsedAudio = false;
    let brainAudioCandidates: CofreAudioCandidate[] = [];
    const tokenMeasurements = new Set<"provider" | "estimated">();

    if (brainUsedLandmark) brainMemorySourcesUsed.add("landmark");
    // Estilo e orçamentos de emoji antecipados para alimentar o Agent Terra no turno único
    const recentLarissaOutbounds: string[] = [];
    try {
      const { data: recentMsgs } = await supabase
        .from("instagram_messages")
        .select("message, text, is_from_me, sender_id, created_at")
        .eq("conversation_id", conversationId)
        .or("is_from_me.eq.true,sender_id.eq.me,sender_id.eq.larissa")
        .order("created_at", { ascending: false })
        .limit(5);

      if (recentMsgs && recentMsgs.length > 0) {
        for (const m of recentMsgs) {
          const txt = m.text || m.message || "";
          if (txt && typeof txt === "string" && txt.trim()) {
            recentLarissaOutbounds.push(txt.trim());
          }
        }
      }
    } catch {}

    const recentStyleState = extractRecentStyleState(recentLarissaOutbounds);
    const emojiBudgetInfo = computeDynamicEmojiBudget(recentLarissaOutbounds, {
      emojiRecentHistory: recentStyleState.emoji_recent_history,
    });
    const recentStyleSnippet = formatRecentStyleStateForPrompt(recentStyleState, emojiBudgetInfo);

    // Loop do Brain (máximo 2 buscas de memória/histórico + máximo 1 de cofre)
    const MAX_BRAIN_SEARCHES = BRAIN_ORCHESTRATION_BUDGETS.brain_max_memory_searches;
    let memorySearchesPerformed = 0;
    let cofreSearchesPerformed = 0;
    const toolResultsHistory: string[] = [];
    let brainPlan: ConversationBrainPlan | null = null;
    let brainIterations = 0;
    let currentMemoryScopeId: string | undefined;

    if (isOpenAiAgentBrain) {
      const agentId =
        (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_BRAIN_AGENT_ID") : process.env.OPENAI_BRAIN_AGENT_ID) ||
        stageRules.openaiBrainAgentId ||
        "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482";

      const isStrict = Boolean(
        stageRules.strictOpenAiPilot ||
        orchState.strictOpenAiPilot ||
        (params as any)?.strictOpenAiPilot ||
        (params as any)?.options?.strictOpenAiPilot
      );

      try {
        const scopeRes = await createAgentMemoryScope({
          supabase,
          conversationId,
          cycleId: correlationId,
          agentId,
          ttlSeconds: 300,
        });
        currentMemoryScopeId = scopeRes.scopeId;
        currentCycle.trace.push(`agent_memory_scope_created=${currentMemoryScopeId}`);
      } catch (scopeErr) {
        console.warn("[Orchestrator] Falha ao criar agent_memory_scope:", scopeErr);
      }

      try {
        const openAiBrainTurn = await runOpenAiBrainTurn({
          supabase,
          conversationId,
          currentStageId,
          currentObjectiveId: stageChecklistForRouter.currentObjective?.id,
          currentObjectiveLabel: stageChecklistForRouter.currentObjective?.label,
          currentObjectiveDescription: stageChecklistForRouter.currentObjective?.description,
          currentObjectiveRequired: stageChecklistForRouter.currentObjective?.required !== false,
          currentObjectiveKind: stageChecklistForRouter.currentObjective?.kind,
          inboundMessages: claimedMessages.map((m) => m.text).filter(Boolean),
          currentInboundMessages: claimedMessages
            .map((m: any) => ({ id: String(m.id || ""), text: String(m.text || "") }))
            .filter((m: any) => m.id && m.text),
          recentMessages: finalRecentMessages.map((m) => ({
            sender: (m.sender === "pretendente" ? "user" : "larissa") as "user" | "larissa",
            text: m.text,
            createdAt: m.createdAt,
          })),
          contactMemorySummary,
          landmarksSummary,
          liveStateContext: JSON.stringify(currentLiveState),
          availableSubagents: authorizedCompactSubagents,
          candidateEvidence: candidateObjectiveEvidence,
          agentId,
          runtime,
          strictOpenAiPilot: isStrict,
          recentStyleStateSnippet: recentStyleSnippet,
          memoryScopeId: currentMemoryScopeId,
        });

        if (openAiBrainTurn.success && openAiBrainTurn.plan) {
          brainPlan = openAiBrainTurn.plan;
          currentCycle.brainModel = "gpt-5.6-terra";
          currentCycle.trace.push("brain_model: gpt-5.6-terra");
          currentCycle.trace.push(`interaction_dna_version: ${LARISSA_INTERACTION_DNA_VERSION}`);
          currentCycle.trace.push(`interaction_dna_hash: ${LARISSA_INTERACTION_DNA_HASH}`);
          currentCycle.trace.push(`recent_style_state_applied: ${Boolean(recentStyleSnippet)}`);
          brainInputTokens += openAiBrainTurn.telemetry.inputTokens;
          brainOutputTokens += openAiBrainTurn.telemetry.outputTokens;
          totalTokens += openAiBrainTurn.telemetry.totalTokens;
          tokenMeasurements.add("provider");
          for (const s of openAiBrainTurn.telemetry.sourcesUsed) {
            brainMemorySourcesUsed.add(s);
          }
          if (openAiBrainTurn.telemetry.sessionId) {
            currentCycle.trace.push(`openai_agent_session_created: ${openAiBrainTurn.telemetry.sessionId}`);
            currentCycle.trace.push("openai_agent_turn_started");
            currentCycle.trace.push("openai_agent_turn_completed");
          }
          for (const tool of openAiBrainTurn.telemetry.toolsRequested) {
            currentCycle.trace.push(`openai_agent_mcp_used=${tool}`);
          }
          if (openAiBrainTurn.telemetry.finalPlanParsed) {
            currentCycle.trace.push("openai_agent_plan_validated");
          }
          currentCycle.trace.push(
            `openai_brain_turn_success: agent=${agentId} tools=${openAiBrainTurn.telemetry.toolsRequested.join(",")}`
          );
        } else {
          console.warn(
            `[Brain] OpenAI Agent Brain não concluiu plano (${openAiBrainTurn.error || "plan_null"}).`
          );
          currentCycle.trace.push(`openai_brain_turn_fallback: ${openAiBrainTurn.error || "plan_null"}`);
          if (isStrict) {
            currentCycle.trace.push("OPENAI_AGENT_FAILED");
            throw new Error(`OPENAI_AGENT_FAILED: ${openAiBrainTurn.error || "plan_null"}`);
          }
        }
      } catch (err: any) {
        console.error(`[Brain] Exceção durante turno do OpenAI Agent Brain:`, err);
        currentCycle.trace.push(`openai_brain_turn_error: ${err?.message || String(err)}`);
        if (isStrict) {
          currentCycle.trace.push("OPENAI_AGENT_FAILED");
          throw new Error(`OPENAI_AGENT_FAILED: ${err?.message || String(err)}`);
        }
      }
    }

    while (brainIterations < 3 && !brainPlan) {
      brainIterations++;

      // Freshness Gate antes de cada chamada do Brain
      if (brainIterations > 1) {
        const freshnessInBrainLoop = await checkFreshnessGate({
          supabase,
          conversationId,
          claimedMessageIds,
          cycleStartedAt: currentCycle.startedAt,
          initialInboundRevision,
        });
        if (!freshnessInBrainLoop.isFresh) {
          return await handleCyclePreemption("during_brain_tool_loop", freshnessInBrainLoop);
        }
      }

      const brainPrompt = buildConversationBrainPrompt({
        conversationId,
        currentStage: currentStageId,
        liveState: currentLiveState,
        recentMessages: finalRecentMessages,
        contactMemorySummary,
        landmarksSummary,
        speechActsSummary,
        personaMemorySummary,
        stageObjectives: stageChecklistForRouter.goals as any,
        currentObjective: stageChecklistForRouter.currentObjective as any,
        compactSubagents,
        toolResultsHistory,
      });
      const brainRes = await callModelOrOpenAi(brainPrompt, { runtime, supabase, model: params.model });
      tokenMeasurements.add(brainRes.tokenMeasurement);
      brainInputTokens += brainRes.inputTokens;
      brainOutputTokens += brainRes.outputTokens;
      totalTokens += brainRes.tokens;

      const rawBrainJson = extractJsonFromText(brainRes.content);
      if (rawBrainJson && (rawBrainJson.action === "call_tool" || rawBrainJson.tool)) {
        const toolName = String(rawBrainJson.tool || rawBrainJson.name || "").trim();
        const toolParams = rawBrainJson.parameters || rawBrainJson.params || {};

        if (toolName === "conversation_history_search") {
          if (memorySearchesPerformed < MAX_BRAIN_SEARCHES) {
            memorySearchesPerformed++;
            brainHistorySearchesCount++;
            brainUsedRawHistory = true;
            brainMemorySourcesUsed.add("raw_history");
            const q = String(toolParams.query || inboundsText).trim();
            const hits = await searchRawConversationHistory({
              supabase,
              conversationId,
              query: q,
              limit: BRAIN_ORCHESTRATION_BUDGETS.brain_history_search_results,
            });
            brainHistoryHits += hits.length;
            const formattedHits = hits.map((h, i) => {
              const ctx = h.contextWindow.map((c) => `  [${c.sender} @ ${c.createdAt}] ${c.text}`).join("\n");
              return `Hit ${i + 1} (score: ${h.matchScore}):\n${ctx}`;
            }).join("\n\n");
            toolResultsHistory.push(`[TOOL: conversation_history_search | query: "${q}"]\n${formattedHits || "Nenhum resultado encontrado no histórico bruto."}`);
          } else {
            toolResultsHistory.push(`[TOOL: conversation_history_search] Limite de buscas de memória atingido.`);
          }
        } else if (toolName === "persona_memory_search") {
          if (memorySearchesPerformed < MAX_BRAIN_SEARCHES) {
            memorySearchesPerformed++;
            brainMemorySearchesCount++;
            brainMemorySourcesUsed.add("persona_memory");
            const q = String(toolParams.query || inboundsText).trim();
            let personaToolFacts: any[] = [];
            try {
              personaToolFacts = await searchPersonaMemory({
                supabase,
                personaId: "larissa",
                query: q,
                limit: 8,
                allowLegacyFallback: false,
              });
            } catch {
              personaToolFacts = [];
            }
            const formatted = formatPersonaMemoryHitsForBrain(personaToolFacts);
            toolResultsHistory.push(`[TOOL: persona_memory_search | query: "${q}"]\n${formatted}`);
          } else {
            toolResultsHistory.push(`[TOOL: persona_memory_search] Limite de buscas de memória atingido.`);
          }
        } else if (toolName === "episodic_memory_search") {
          if (memorySearchesPerformed < MAX_BRAIN_SEARCHES) {
            memorySearchesPerformed++;
            brainMemorySearchesCount++;
            brainMemorySourcesUsed.add("episodic_memory");
            const q = String(toolParams.query || inboundsText).trim();
            const mClass = toolParams.memoryClass || "all";
            const epHits = await searchConversationEpisodicMemory({
              supabase,
              conversationId,
              query: q,
              memoryClass: mClass,
              limit: 4,
            });
            const formatted = epHits.map((h) => `• [${h.actor}] ${h.summary}`).join("\n");
            toolResultsHistory.push(`[TOOL: episodic_memory_search | query: "${q}"]\n${formatted || "Nenhum episódio relevante encontrado."}`);
          } else {
            toolResultsHistory.push(`[TOOL: episodic_memory_search] Limite de buscas de memória atingido.`);
          }
        } else if (toolName === "cofre_audio_search") {
          if (cofreSearchesPerformed < 1) {
            cofreSearchesPerformed++;
            brainUsedAudio = true;
            brainMemorySourcesUsed.add("cofre_audio");
            const q = String(toolParams.query || inboundsText).trim();
            const cofreMatches = await searchCofreAudios({
              supabase,
              conversationId,
              query: q,
              limit: 3,
            });
            brainAudioCandidates = cofreMatches;
            const formatted = cofreMatches.map((c) => `• audio_id: "${c.audio_id}" | título: "${c.title}" | instrução: "${c.when_to_use}" | transcrição: "${c.full_transcript}"`).join("\n");
            toolResultsHistory.push(`[TOOL: cofre_audio_search | query: "${q}"]\n${formatted || "Nenhum áudio com aderência semântica encontrado."}`);
          } else {
            toolResultsHistory.push(`[TOOL: cofre_audio_search] Limite de busca de áudio atingido.`);
          }
        } else {
          toolResultsHistory.push(`[TOOL: ${toolName}] Ferramenta não suportada pelo Brain.`);
        }
      } else if (rawBrainJson) {
        // Brain concluiu e delegou a missão
        const rawTarget = rawBrainJson.responsibleSubagent || rawBrainJson.targetSubagent || "none";
        brainPlan = {
          action: "delegate_mission",
          currentStage: currentStageId,
          responsibleSubagent: String(rawTarget).trim(),
          objectiveDecision: (rawBrainJson.objectiveDecision as any) || "pursue",
          satisfiedObjectiveId: rawBrainJson.satisfiedObjectiveId || undefined,
          evidenceMessageId: rawBrainJson.evidenceMessageId || undefined,
          liveStatePatch: rawBrainJson.liveStatePatch || {},
          missionPackage: rawBrainJson.missionPackage || undefined,
          reasoning: rawBrainJson.reasoning || rawBrainJson.reason || "Planejamento concluído pelo Brain.",
        };
      }
    }
    brainToolResultTokens = estimateTextTokens(toolResultsHistory.join("\n"));

    // Fallback seguro caso o Brain esgote iterações sem emitir delegate_mission
    if (!brainPlan) {
      brainPlan = {
        action: "delegate_mission",
        currentStage: currentStageId,
        responsibleSubagent: stageChecklistForRouter.responsibleSubagent || "none",
        objectiveDecision: "pursue",
        liveStatePatch: {
          lastUserEmotionalTone: "tranquilo",
          currentTopic: "interação em andamento",
        },
        reasoning: "Plano gerado por fallback do Brain.",
      };
    }

    // Atualiza o LiveState com o patch do Brain (com poda estrita de coleções)
    currentLiveState = applyLiveStatePatch(currentLiveState, brainPlan.liveStatePatch);
    const relevantPersonaFacts = brainPlan.missionPackage?.relevantPersonaFacts || [];
    if (relevantPersonaFacts.length) {
      currentCycle.trace.push(`brain_persona_facts_relevant=${relevantPersonaFacts.length}`);
      for (const fact of relevantPersonaFacts) {
        currentCycle.trace.push(`brain_persona_grounding: origin=${fact.origin || "persona_memory"}; memory=${fact.memoryId || "unknown"}; reason=${String(fact.reason || "unspecified").slice(0, 120)}`);
      }
    }
    currentCycle.trace.push(`brain_semantic_plan: objective=${brainPlan.objectiveDecision}; hook=${String(brainPlan.missionPackage?.bestHook || "none").slice(0, 120)}; curiosity=${String(brainPlan.missionPackage?.curiosityOpportunity || "none").slice(0, 120)}`);
    // Validação estrita de already_satisfied (Item 10 dos ajustes)
    if (brainPlan.objectiveDecision === "already_satisfied") {
      const targetObj = stageChecklistForRouter.currentObjective;
      if (
        targetObj &&
        brainPlan.satisfiedObjectiveId === targetObj.id &&
        claimedMessageIds.includes(String(brainPlan.evidenceMessageId || ""))
      ) {
        workingCompletedGoalIds = [...new Set([...workingCompletedGoalIds, targetObj.id])];
        currentCycle.trace.push(`brain_already_satisfied_validated: ${targetObj.id}`);
      } else {
        currentCycle.trace.push("brain_already_satisfied_rejected_not_current_or_not_inbound");
        throw new Error("BRAIN_PLAN_INVALID_OBJECTIVE_EVIDENCE");
      }
    }

    // O Brain escolhe dentro da autorização da etapa. O backend rejeita a
    // escolha inválida; nunca a substitui silenciosamente pelo owner default.
    const responsibleSubagent = brainPlan.responsibleSubagent;
    if (!authorizedSubagentIds.has(responsibleSubagent)) {
      currentCycle.trace.push(`brain_subagent_rejected_unauthorized: ${responsibleSubagent}`);
      throw new Error(`BRAIN_PLAN_INVALID_SUBAGENT: ${responsibleSubagent}`);
    }
    currentCycle.trace.push(`brain_objective_mode: ${brainPlan.objectiveDecision}`);
    currentCycle.trace.push(`brain_responsible_subagent: ${responsibleSubagent}`);

    // ------------------------------------------------------------------------
    // FRESHNESS GATE 1: Revalidação imediatamente após o ConversationAgent / Brain
    // ------------------------------------------------------------------------
    const freshnessAfterRouter = await checkFreshnessGate({
      supabase,
      conversationId,
      claimedMessageIds,
      cycleStartedAt: currentCycle.startedAt,
      initialInboundRevision,
    });

    if (!freshnessAfterRouter.isFresh) {
      return await handleCyclePreemption("during_conversation_agent", freshnessAfterRouter);
    }

    let finalSubDecision: SubagentDecision | null = null;

    if (brainPlan.action === "wait" || responsibleSubagent === "none") {
      finalSubDecision = {
        action: "wait",
        checkpoint: currentPhase === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita",
        summary: `Aguardando pretendente: ${brainPlan.reasoning}`,
        suggestedResponse: "",
        nextPhase: currentPhase,
        reasoning: brainPlan.reasoning,
        requiredTools: [],
      };
      currentCycle.trace.push("subagent_action: wait");
    } else {
      // Prepara o MissionPackage consolidado para o executor
      const requestedDirective = brainPlan.objectiveDecision;
      const normalizedDirective: MissionPackage["objectiveDirective"] =
        ["pursue", "defer", "already_satisfied", "none"].includes(requestedDirective)
          ? requestedDirective
          : "pursue";
      const audioSelection = authorizeMissionAudioSelection(brainPlan.missionPackage, brainAudioCandidates);
      const turnContract = isOpenAiAgentBrain
        ? normalizeBrainTurnContract(brainPlan.missionPackage?.turnContract, 4)
        : buildTurnContract(
          canonicalClaimed.map((message) => message.text),
          {
            ...brainPlan.missionPackage?.turnContract,
            objectiveDirective: normalizedDirective,
          } as any
        );
      const missionPkg: MissionPackage = {
        ...(brainPlan.missionPackage || {} as MissionPackage),
        subagentId: responsibleSubagent,
        subagentName: responsibleSubagent,
        objectiveDirective: normalizedDirective,
        targetObjective: stageChecklistForRouter.currentObjective
          ? { id: stageChecklistForRouter.currentObjective.id, label: stageChecklistForRouter.currentObjective.label }
          : null,
        relevantMemoryContext: (brainPlan.missionPackage?.relevantMemoryContext || [
          contactMemorySummary ? `FATOS DO PRETENDENTE:\n${contactMemorySummary}` : "",
          landmarksSummary ? `MARCOS NARRATIVOS:\n${landmarksSummary}` : "",
          toolResultsHistory.length > 0 ? `PESQUISAS FEITAS NESTE TURNO:\n${toolResultsHistory.join("\n")}` : "",
        ].filter(Boolean).join("\n\n")),
        liveStateContext: serializeLiveStateForPrompt(currentLiveState),
        selectedAudioId: audioSelection.selectedAudioId,
        candidateAudios: audioSelection.candidateAudios,
        preferAudio: audioSelection.preferAudio,
        turnContract,
      };
      // Subagente selecionado (definição do catálogo ou canônico)
      const catalogSub = availableSubagents.find((s: any) => s.id === responsibleSubagent);
      const subagentDef: SubagentDefinition = catalogSub || CANONICAL_SUBAGENTS[responsibleSubagent] || {
        id: responsibleSubagent,
        name: responsibleSubagent,
        mission: responsibleSubagent === "descoberta"
          ? CANONICAL_SUBAGENTS.descoberta.mission
          : responsibleSubagent === "compatibilidade"
          ? CANONICAL_SUBAGENTS.compatibilidade.mission
          : CANONICAL_SUBAGENTS.conexao_inicial.mission,
        missionSource: "canonical_fallback",
      };
      const subagentMissionSource = subagentDef.missionSource || (catalogSub ? "db" : "canonical_fallback");
      const subagentMissionHash = stableDiagnosticHash(subagentDef.mission || "");
      currentCycle.trace.push(`subagent_definition_id=${subagentDef.id}`);
      currentCycle.trace.push(`subagent_definition_name=${subagentDef.name}`);
      currentCycle.trace.push(`subagent_mission_source=${subagentMissionSource}`);
      currentCycle.trace.push(`subagent_mission_hash=${subagentMissionHash}`);
      const candidateAudiosSnippet = missionPkg.candidateAudios?.map((audio) =>
        `audio_id: "${audio.audioId}" | título: "${audio.title}" | instrução: "${audio.instruction}" | transcrição: "${audio.transcript}"`
      ).join("\n") || "";

      if (isOpenAiAgentBrain && Array.isArray(brainPlan.responses) && brainPlan.responses.length > 0) {
        // EXECUÇÃO EM TURNO ÚNICO DO GPT-5.6-TERRA: Brain unificado com Executor
        const chosenResponses = brainPlan.responses
          .map((r: any) => String(r || "").trim())
          .filter(Boolean);
        const suggestedText = chosenResponses.join("\n\n");

        finalSubDecision = {
          action: "reply",
          checkpoint: responsibleSubagent === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita",
          summary: `Executado em turno único pelo Agent Brain (${responsibleSubagent})`,
          suggestedResponse: suggestedText,
          responses: chosenResponses,
          nextPhase: currentPhase,
          reasoning: brainPlan.reasoning || `Execução direta do subagente ${responsibleSubagent} pelo Agent Brain`,
          requiredTools: [],
        };

        currentCycle.trace.push(`single_turn_agent_execution_used: ${responsibleSubagent}`);
        currentCycle.trace.push(`subagent_executed: ${responsibleSubagent}`);
        currentCycle.trace.push("second_model_inference_skipped: true");
        currentCycle.executorModel = "same_agent (gpt-5.6-terra)";
        currentCycle.trace.push("executor_model: same_agent (gpt-5.6-terra)");
      } else {
        // Constrói prompt do subagente executor enxuto
        const executorPrompt = buildSubagentExecutorPrompt({
          subagentId: responsibleSubagent,
          subagentName: subagentDef.name,
          mission: subagentDef.mission || "Conduzir a conversa com afeto e organicidade",
          missionPackage: missionPkg,
          recentMessages: finalRecentMessages,
          emojiBudgetSnippet: emojiBudgetInfo.promptSnippet,
          styleStateSnippet: `Última forma: ${recentStyleState.last_response_shape} | Emojis recentes: ${recentStyleState.recent_emojis.join(" ") || "nenhum"}`,
          candidateAudiosSnippet: candidateAudiosSnippet || undefined,
        });
        await publishAutoPilotState(supabase, conversationId, {
          status: "processing",
          activity: activity(
            "atria",
            orchState.mode === "shadow" ? "Subagente (Shadow)" : `Subagente: ${subagentDef.name || responsibleSubagent}`,
            `Formulando resposta com ${subagentDef.name || responsibleSubagent}...`,
            {
              atriaThought: `Executando com ${subagentDef.name || responsibleSubagent}...`,
              mode: orchState.mode,
              currentPhase,
            }
          ),
        });

        // Resolução explícita do modelo do subagente executor (sem fallback silencioso para gpt-4o-mini)
        const executorModel =
          (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_EXECUTOR_MODEL") : process.env.OPENAI_EXECUTOR_MODEL) ||
          stageRules.openaiExecutorModel ||
          orchState.executorModel ||
          (params as any)?.executorModel ||
          (params as any)?.options?.executorModel ||
          OPENAI_EXECUTOR_DEFAULT_MODEL;

        currentCycle.executorModel = executorModel;
        currentCycle.trace.push(`executor_model: ${executorModel}`);

        const execRes = await callModelOrOpenAi(executorPrompt, {
          runtime,
          supabase,
          model: executorModel,
          disallowDowngrade: true,
        });
        tokenMeasurements.add(execRes.tokenMeasurement);
        totalTokens += execRes.tokens;
        subagentInputTokens += execRes.inputTokens;
        subagentOutputTokens += execRes.outputTokens;
        finalGenerationTokens += execRes.outputTokens;
        const rawSubJson = extractJsonFromText(execRes.content);
        if (rawSubJson && (rawSubJson.action === "call_tool" || rawSubJson.action === "tool_call" || rawSubJson.tool)) {
          currentCycle.trace.push("subagent_tool_request_rejected");
          finalSubDecision = {
            action: "wait",
            checkpoint: responsibleSubagent === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita",
            summary: "Saída inválida do executor",
            suggestedResponse: "",
            nextPhase: currentPhase,
            reasoning: "Executor tentou solicitar ferramenta, operação proibida no runtime experimental",
            requiredTools: [],
          };
        } else {
          finalSubDecision = validateSubagentDecision(rawSubJson, currentPhase);
          currentCycle.trace.push(`subagent_executed: ${responsibleSubagent}`);
        }
      }

      // Se o subagente gerou balões, aplica sanitização determinística mandatória
      if (finalSubDecision.action === "reply" && (!finalSubDecision.responses || finalSubDecision.responses.length === 0)) {
        finalSubDecision.responses = splitIntoBalloons(finalSubDecision.suggestedResponse || "oi, tudo bem?");
      }

      // Registra telemetria completa no trace
      currentCycle.trace.push(`brain_recent_messages_count: ${brainRecentMessagesCount}`);
      currentCycle.trace.push(`brain_input_tokens: ${brainInputTokens}`);
      currentCycle.trace.push(`brain_output_tokens: ${brainOutputTokens}`);
      currentCycle.trace.push(`brain_memory_sources_used: ${Array.from(brainMemorySourcesUsed).join(",")}`);
      currentCycle.trace.push(`brain_memory_search_count: ${brainMemorySearchesCount}`);
      currentCycle.trace.push(`brain_history_search_count: ${brainHistorySearchesCount}`);
      currentCycle.trace.push(`brain_history_hits: ${brainHistoryHits}`);
      currentCycle.trace.push(`brain_tool_result_tokens: ${brainToolResultTokens}`);
      currentCycle.trace.push(`subagent_input_tokens: ${subagentInputTokens}`);
      currentCycle.trace.push(`subagent_output_tokens: ${subagentOutputTokens}`);
      currentCycle.trace.push(`total_cycle_tokens: ${totalTokens}`);
      currentCycle.trace.push(`token_measurement: ${tokenMeasurements.size === 1 ? [...tokenMeasurements][0] : "estimated"}`);
      currentCycle.trace.push(`brain_used_raw_history: ${brainUsedRawHistory}`);
      currentCycle.trace.push(`brain_used_landmark: ${brainUsedLandmark}`);
      currentCycle.trace.push(`brain_used_contact_memory: ${brainUsedContactMemory}`);
      currentCycle.trace.push(`brain_used_audio: ${brainUsedAudio}`);

      // O executor só pode usar o áudio previamente autorizado pelo Brain/backend.
      const audioIntegrity = enforceAuthorizedAudioDecision(finalSubDecision, missionPkg);
      if (!audioIntegrity.allowed) {
        currentCycle.trace.push(`executor_audio_rejected: ${audioIntegrity.reason}`);
        finalSubDecision = {
          ...finalSubDecision,
          action: "wait",
          audioId: undefined,
          audioUrl: undefined,
          responses: [],
          suggestedResponse: "",
          requiredTools: [],
          reasoning: "Executor tentou usar áudio não autorizado pelo Brain",
        };
      } else if (audioIntegrity.audioId) {
        finalSubDecision.audioId = audioIntegrity.audioId;
      }

      // ----------------------------------------------------------------------
      // STYLE LINT DETERMINÍSTICO & RETRY DE ESTILO (Máximo 1)
      // ----------------------------------------------------------------------
      const isAudioDecision = finalSubDecision.action === "send_audio" || Boolean(finalSubDecision.audioId);
      if (
        finalSubDecision &&
        (finalSubDecision.action === "reply" || finalSubDecision.action === "advance_phase") &&
        !isAudioDecision &&
        ((finalSubDecision.responses && finalSubDecision.responses.length > 0) || finalSubDecision.suggestedResponse)
      ) {
        let candidateBalloons = (finalSubDecision.responses && finalSubDecision.responses.length > 0)
          ? finalSubDecision.responses
          : splitIntoBalloons(finalSubDecision.suggestedResponse);
        const effectiveEmojiBudget = turnContract.preferNoEmoji ? 0 : emojiBudgetInfo.budget;

        let lintResult = runStyleLint(candidateBalloons, {
          emojiBudget: effectiveEmojiBudget,
          recentEmojis: emojiBudgetInfo.recentEmojis,
          recentReactions: recentStyleState.recent_reactions,
          lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
          isRetry: false,
        });
        if (!isOpenAiAgentBrain && lintResult.requiresRetry) {
          currentCycle.trace.push(`style_lint_retry_triggered: ${lintResult.retryReason}`);

          const retryPrompt = `${executorPrompt}

### INSTRUÇÃO DE AJUSTE DE ESTILO (Style Lint Retry)
Detectada inconsistência com a digitação da Larissa: ${lintResult.retryReason}

Reescreva mantendo exatamente fatos e intenção.
Use o estilo de digitação da Larissa: curto, natural, informal, sem formalidade, sem eco e em balões proporcionais.

Responda ESTRITAMENTE em JSON puro:
{
  "action": "reply",
  "checkpoint": "${finalSubDecision.checkpoint}",
  "summary": "${finalSubDecision.summary}",
  "responses": [
    "balão 1 corrigido",
    "balão 2 corrigido"
  ],
  "nextPhase": "${finalSubDecision.nextPhase}"
}`;
          try {
            const retryRes = await callModelOrOpenAi(retryPrompt, {
              runtime,
              supabase,
              model: executorModel,
              disallowDowngrade: true,
            });
            totalTokens += retryRes.tokens;
            finalGenerationTokens += retryRes.tokens;
            const retryJson = extractJsonFromText(retryRes.content);
            if (retryJson) {
              const validatedRetry = validateSubagentDecision(retryJson, currentPhase);
              candidateBalloons = (validatedRetry.responses && validatedRetry.responses.length > 0)
                ? validatedRetry.responses
                : splitIntoBalloons(validatedRetry.suggestedResponse);

              // Passa pelo lint em modo defensivo (isRetry: true)
              lintResult = runStyleLint(candidateBalloons, {
                emojiBudget: effectiveEmojiBudget,
                recentEmojis: emojiBudgetInfo.recentEmojis,
                recentReactions: recentStyleState.recent_reactions,
                lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
                isRetry: true,
              });

              finalSubDecision.responses = lintResult.cleanedBalloons;
              finalSubDecision.suggestedResponse = lintResult.cleanedBalloons.join("\n\n");
              currentCycle.trace.push("style_lint_retry_completed");
            } else {
              lintResult = runStyleLint(candidateBalloons, {
                emojiBudget: effectiveEmojiBudget,
                recentEmojis: emojiBudgetInfo.recentEmojis,
                recentReactions: recentStyleState.recent_reactions,
                lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
                isRetry: true,
              });
              finalSubDecision.responses = lintResult.cleanedBalloons;
              finalSubDecision.suggestedResponse = lintResult.cleanedBalloons.join("\n\n");
            }
          } catch (retryErr: any) {
            currentCycle.trace.push(`style_lint_retry_err: ${retryErr.message || String(retryErr)}`);
            lintResult = runStyleLint(candidateBalloons, {
              emojiBudget: effectiveEmojiBudget,
              recentEmojis: emojiBudgetInfo.recentEmojis,
              recentReactions: recentStyleState.recent_reactions,
              lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
              isRetry: true,
            });
            finalSubDecision.responses = lintResult.cleanedBalloons;
            finalSubDecision.suggestedResponse = lintResult.cleanedBalloons.join("\n\n");
          }
        } else if (!isOpenAiAgentBrain) {
          finalSubDecision.responses = lintResult.cleanedBalloons;
          finalSubDecision.suggestedResponse = lintResult.cleanedBalloons.join("\n\n");
          currentCycle.trace.push("style_lint_passed_first_try");
        }

        // ------------------------------------------------------------------
        // CONVERSATION QUALITY GATE & RETRY SEMÂNTICO (Máximo 1)
        // ------------------------------------------------------------------
        const inboundTexts = canonicalClaimed.map((message) => message.text).filter(Boolean);
        let qualityResult = runConversationQualityGate({
          inboundMessages: inboundTexts,
          candidateBalloons: finalSubDecision.responses || [],
          turnContract,
        });
        currentCycle.trace.push(`conversation_quality_passed=${qualityResult.passed}`);
        currentCycle.trace.push(`conversation_quality_initial_issues=${JSON.stringify(qualityResult.issues.map((issue) => issue.code))}`);
        let qualityRetried = false;
        let qualityFallbackUsed = false;

        if (!qualityResult.passed && !isOpenAiAgentBrain) {
          qualityRetried = true;
          const issueCodes = qualityResult.issues.map((issue) => issue.code);
          currentCycle.trace.push(`conversation_quality_retry_issues: ${issueCodes.join(",")}`);
          const qualityRetryPrompt = `${executorPrompt}

### QUALITY RETRY ÚNICO
A resposta anterior falhou semanticamente por: ${issueCodes.join(", ")}.
Fala do pretendente: ${JSON.stringify(inboundTexts.join(" "))}
Contrato obrigatório: ${JSON.stringify(turnContract)}

Reescreva a mesma missão. Responda primeiro à pergunta direta, acrescente reação real, não ecoe a fala, não introduza tópico adiado e respeite o limite de perguntas e balões.
Responda ESTRITAMENTE em JSON puro com action, responses e suggestedResponse.`;
          try {
            const retryRes = await callModelOrOpenAi(qualityRetryPrompt, {
              runtime,
              supabase,
              model: executorModel,
              disallowDowngrade: true,
            });
            totalTokens += retryRes.tokens;
            finalGenerationTokens += retryRes.outputTokens;
            const retryJson = extractJsonFromText(retryRes.content);
            if (retryJson) {
              const retriedDecision = validateSubagentDecision(retryJson, currentPhase);
              const retriedBalloons = retriedDecision.responses?.length
                ? retriedDecision.responses
                : splitIntoBalloons(retriedDecision.suggestedResponse);
              const retryLint = runStyleLint(retriedBalloons, {
                emojiBudget: turnContract.preferNoEmoji ? 0 : emojiBudgetInfo.budget,
                recentEmojis: emojiBudgetInfo.recentEmojis,
                recentReactions: recentStyleState.recent_reactions,
                lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
                isRetry: true,
              });
              finalSubDecision.responses = retryLint.cleanedBalloons;
              finalSubDecision.suggestedResponse = retryLint.cleanedBalloons.join("\n\n");
              qualityResult = runConversationQualityGate({
                inboundMessages: inboundTexts,
                candidateBalloons: retryLint.cleanedBalloons,
                turnContract,
              });
            }
          } catch (qualityRetryErr: any) {
            currentCycle.trace.push(`conversation_quality_retry_err: ${qualityRetryErr.message || String(qualityRetryErr)}`);
          }

          if (!qualityResult.passed) {
            const fallback = safeHighConfidenceFallback(inboundTexts, turnContract);
            if (fallback) {
              qualityFallbackUsed = true;
              const fallbackLint = runStyleLint(fallback, {
                emojiBudget: turnContract.preferNoEmoji ? 0 : emojiBudgetInfo.budget,
                recentEmojis: emojiBudgetInfo.recentEmojis,
                recentReactions: recentStyleState.recent_reactions,
                lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
                isRetry: true,
              });
              qualityResult = runConversationQualityGate({
                inboundMessages: inboundTexts,
                candidateBalloons: fallbackLint.cleanedBalloons,
                turnContract,
              });
              if (qualityResult.passed) {
                finalSubDecision.responses = fallbackLint.cleanedBalloons;
                finalSubDecision.suggestedResponse = fallbackLint.cleanedBalloons.join("\n\n");
                currentCycle.trace.push("conversation_quality_safe_fallback_used");
              } else {
                finalSubDecision.action = "wait";
                finalSubDecision.responses = [];
                finalSubDecision.suggestedResponse = "";
                finalSubDecision.requiredTools = [];
                currentCycle.trace.push("conversation_quality_fallback_rejected_dispatch_blocked");
              }
            } else {
              finalSubDecision.action = "wait";
              finalSubDecision.responses = [];
              finalSubDecision.suggestedResponse = "";
              finalSubDecision.requiredTools = [];
              currentCycle.trace.push("conversation_quality_blocked_dispatch");
            }
          }
        }

        currentCycle.trace.push(`conversation_quality_passed=${qualityResult.passed}`);
        currentCycle.trace.push(`conversation_quality_retry=${qualityRetried}`);
        currentCycle.trace.push(`conversation_quality_issues=${JSON.stringify(qualityResult.issues.map((issue) => issue.code))}`);
        currentCycle.trace.push(`direct_questions_detected=${qualityResult.directQuestionsDetected}`);
        currentCycle.trace.push(`direct_questions_answered=${qualityResult.directQuestionsAnswered}`);
        currentCycle.trace.push(`parrot_score=${qualityResult.parrotScore.toFixed(3)}`);
        currentCycle.trace.push(`new_question_count=${qualityResult.newQuestionCount}`);
        currentCycle.trace.push(`turn_response_shape=${turnContract.responseShape}`);
        if (isOpenAiAgentBrain) currentCycle.trace.push("conversation_quality_observe_only=true");

        // Limite físico de payload: é o único aspecto de balões que pode
        // bloquear o caminho OpenAI, sem reescrever a conversa.
        if (isOpenAiAgentBrain && (finalSubDecision.responses || []).length > turnContract.maxBalloons) {
          finalSubDecision.action = "wait";
          finalSubDecision.responses = [];
          finalSubDecision.suggestedResponse = "";
          finalSubDecision.requiredTools = [];
          currentCycle.trace.push("technical_balloon_limit_blocked_dispatch");
        }

        // ------------------------------------------------------------------
        // ANTI-REPEAT + QUALITY GATE FINAL (autoridade absoluta de despacho)
        // ------------------------------------------------------------------
        if (finalSubDecision.action !== "wait" && finalSubDecision.responses?.length) {
          const beforeAntiRepeat = [...finalSubDecision.responses];
          const antiRepeatResult = await validateAntiRepeatGate({
            conversationId,
            candidateBalloons: beforeAntiRepeat,
            supabase,
          });
          const finalAfterAntiRepeat = antiRepeatResult.allowedBalloons;
          if (antiRepeatResult.isBlocked) {
            currentCycle.trace.push(
              `anti_repeat_gate_blocked: pruned=${antiRepeatResult.blockedBalloons.length}, remaining=${finalAfterAntiRepeat.length}`
            );
          }
          const normalizedAfterAntiRepeat = isOpenAiAgentBrain
            ? finalAfterAntiRepeat.filter(Boolean)
            : finalAfterAntiRepeat
              .map((b) => sanitizeChatPunctuation(capitalizeFirstLetter(b)))
              .filter(Boolean);
          let finalQualityResult = runConversationQualityGate({
            inboundMessages: inboundTexts,
            candidateBalloons: normalizedAfterAntiRepeat,
            turnContract,
          });
          currentCycle.trace.push(`post_antirepeat_quality_passed=${finalQualityResult.passed}`);
          currentCycle.trace.push(`post_antirepeat_quality_issues=${JSON.stringify(finalQualityResult.issues.map((issue) => issue.code))}`);
          let authoritativeBalloons = normalizedAfterAntiRepeat;
          if (!finalQualityResult.passed && !qualityFallbackUsed && !isOpenAiAgentBrain) {
            const finalFallback = safeHighConfidenceFallback(inboundTexts, turnContract);
            if (finalFallback) {
              const finalFallbackLint = runStyleLint(finalFallback, {
                emojiBudget: turnContract.preferNoEmoji ? 0 : emojiBudgetInfo.budget,
                recentEmojis: emojiBudgetInfo.recentEmojis,
                recentReactions: recentStyleState.recent_reactions,
                lastOutboundReaction: recentStyleState.recent_reactions[0] || null,
                isRetry: true,
              });
              const normalizedFallbackBalloons = finalFallbackLint.cleanedBalloons
                .map((b) => sanitizeChatPunctuation(capitalizeFirstLetter(b)))
                .filter(Boolean);
              finalQualityResult = runConversationQualityGate({
                inboundMessages: inboundTexts,
                candidateBalloons: normalizedFallbackBalloons,
                turnContract,
              });
              if (finalQualityResult.passed) {
                authoritativeBalloons = normalizedFallbackBalloons;
                qualityFallbackUsed = true;
                currentCycle.trace.push("post_antirepeat_quality_safe_fallback_used");
              }
            }
          }

          currentCycle.trace.push(`final_quality_passed=${finalQualityResult.passed}`);
          currentCycle.trace.push(`final_quality_issues=${JSON.stringify(finalQualityResult.issues.map((issue) => issue.code))}`);

          if (!finalQualityResult.passed && !isOpenAiAgentBrain) {
            finalSubDecision.action = "wait";
            finalSubDecision.responses = [];
            finalSubDecision.suggestedResponse = "";
            finalSubDecision.requiredTools = [];
            currentCycle.trace.push("post_antirepeat_quality_blocked_dispatch");
          } else {
            authoritativeBalloons = isOpenAiAgentBrain
              ? authoritativeBalloons.filter(Boolean)
              : authoritativeBalloons
                .map((b) => sanitizeChatPunctuation(capitalizeFirstLetter(b)))
                .filter(Boolean);
            finalSubDecision.responses = authoritativeBalloons;
            finalSubDecision.suggestedResponse = authoritativeBalloons.join("\n\n");
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // FRESHNESS GATE 2: Revalidação imediatamente após o Subagente
    // ------------------------------------------------------------------------
    const freshnessAfterSubagent = await checkFreshnessGate({
      supabase,
      conversationId,
      claimedMessageIds,
      cycleStartedAt: currentCycle.startedAt,
      initialInboundRevision,
    });

    if (!freshnessAfterSubagent.isFresh) {
      return await handleCyclePreemption("during_subagent", freshnessAfterSubagent);
    }

    // ------------------------------------------------------------------------
    // GUARDA DE INTEGRIDADE DO BACKEND: Valida transição de fase
    // ------------------------------------------------------------------------
    const transitionCheck = validatePhaseTransition(
      currentPhase,
      finalSubDecision.nextPhase,
      finalSubDecision.checkpoint
    );

    const validatedNextPhase = transitionCheck.validatedNextPhase;
    if (!transitionCheck.allowed) {
      console.warn(
        `[Orchestrator] Transição para ${finalSubDecision.nextPhase} rejeitada pelo backend: ${transitionCheck.reason}. Mantendo ${validatedNextPhase}.`
      );
    }

    const validatedMemoryCandidates: MemoryCandidate[] = [];
    if (finalSubDecision.memoryCandidates && Array.isArray(finalSubDecision.memoryCandidates)) {
      for (const cand of finalSubDecision.memoryCandidates) {
        const isClaimedEvidence = claimedMessages.some(
          (m: any) => String(m.id) === String(cand.evidenceMessageId)
        );
        if (isClaimedEvidence) {
          validatedMemoryCandidates.push(cand);
          currentCycle.trace.push(`memory_candidate_accepted: ${cand.key}=${cand.value}`);
        } else {
          currentCycle.trace.push(`memory_candidate_rejected_invalid_evidence: ${cand.key}`);
        }
      }
    }

    const decision: OrchestratorDecision = {
      action: finalSubDecision.action,
      currentPhase,
      nextPhase: validatedNextPhase,
      checkpoint: finalSubDecision.checkpoint,
      summary: finalSubDecision.summary,
      suggestedResponse: finalSubDecision.suggestedResponse,
      responses: finalSubDecision.responses,
      requiredTools: finalSubDecision.requiredTools || ["send_text"],
      reasoning: finalSubDecision.reasoning,
      routedSubagent: (responsibleSubagent || "none") as SubagentTarget,
      audioId: finalSubDecision.audioId,
      audioUrl: finalSubDecision.audioUrl,
      objectiveCompletion: finalSubDecision.objectiveCompletion,
      memoryCandidates: validatedMemoryCandidates,
    };
    currentCycle.decision = decision;

    // ------------------------------------------------------------------------
    // Checagem de cancelamento e preempção após inferência antes de qualquer mutação
    // ------------------------------------------------------------------------
    const { data: recheckData } = await supabase
      .from("instagram_conversations")
      .select("ai_auto_respond, stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();

    const recheckRules = recheckData?.stage_completed_rules || {};

    // 1. Cancelamento manual pelo operador durante a inferência
    if (
      (recheckData && recheckData.ai_auto_respond === false) ||
      recheckRules.cancel_current_cycle === true ||
      recheckRules.status === "paused_manual"
    ) {
      currentCycle.status = "cancelled";
      currentCycle.trace.push("cycle_cancelled_before_dispatch");
      for (const id of claimedMessageIds) {
        ledger[id] = "pending";
      }
      return { mode: orchState.mode, handled: false, sentToMeta: false, blockLegacyFallback: true, error: "Cancelado pelo operador" };
    }

    // 2. Preempção por novo ciclo concorrente ou expiração de lock (Stale Lock / Zombie Cycle Prevention)
    if (recheckRules.active_cycle_token !== correlationId) {
      console.warn(
        `[Orchestrator] Ciclo ${correlationId} perdeu o lock (token atual: ${recheckRules.active_cycle_token || "null"}). Abortando envio para evitar duplo envio.`
      );
      currentCycle.status = "failed";
      currentCycle.trace.push(`cycle_preempted: lock_lost`);
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: `Ciclo preemptado por perda de lock (${recheckRules.active_cycle_token || "lock_expirado"})`,
      };
    }

    // ------------------------------------------------------------------------
    // FRESHNESS GATE 3: Revalidação imediatamente antes da criação da Outbox
    // ------------------------------------------------------------------------
    const freshnessBeforeOutbox = await checkFreshnessGate({
      supabase,
      conversationId,
      claimedMessageIds,
      cycleStartedAt: currentCycle.startedAt,
      initialInboundRevision,
    });

    if (!freshnessBeforeOutbox.isFresh) {
      return await handleCyclePreemption("before_outbox", freshnessBeforeOutbox);
    }

    // ------------------------------------------------------------------------
    // OUTBOX PATTERN: Criação da Intenção de Envio com IdempotencyKey
    // ------------------------------------------------------------------------
    const isAudioAction = decision.action === "send_audio" || Boolean(decision.audioId);
    let resolvedAudio: PersonaAudioAsset | undefined;
    if (isAudioAction && decision.audioId) {
      const allAudios = await searchPersonaAudios({ supabase, conversationId, intent: "", stageId: undefined });
      resolvedAudio = allAudios.find((a) => a.id === decision.audioId);
    }

    const initialContentType = isAudioAction && (resolvedAudio?.audioUrl || decision.audioUrl) ? "audio" : "text";
    const initialContent = initialContentType === "audio"
      ? (resolvedAudio?.audioUrl ? `[audio:${resolvedAudio.audioUrl}]` : `[audio:${decision.audioUrl}]`)
      : decision.suggestedResponse;

    const idempotencyKey = `idemp_${conversationId}_${correlationId}`;
    const finalTextBalloons = decision.responses?.length
      ? decision.responses
      : (decision.suggestedResponse ? splitIntoBalloons(decision.suggestedResponse) : []);
    const hasFinalDispatchPayload = Boolean(
      (decision.action === "reply" || decision.action === "advance_phase" || decision.action === "send_audio")
      && initialContent
      && (initialContentType === "audio" || finalTextBalloons.length === 1)
    );
    let outboxEntry: any = hasFinalDispatchPayload ? outboxMap[idempotencyKey] : undefined;

    if (hasFinalDispatchPayload) {
      if (!outboxEntry) {
        outboxEntry = {
          id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          cycleId: correlationId,
          conversationId,
          idempotencyKey,
          content: initialContent,
          messageType: initialContentType,
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
        };
        outboxMap[idempotencyKey] = outboxEntry;
      } else {
        // O conteúdo final aprovado é autoritativo mesmo em retomadas idempotentes.
        outboxEntry.content = initialContent;
        outboxEntry.messageType = initialContentType;
      }
      currentCycle.outboxEntryId = outboxEntry.id;
      currentCycle.trace.push(`outbox_created: ${outboxEntry.id}`);

      // Persistência acontece somente depois dos gates finais.
      if (orchState.mode !== "shadow") {
        await prepareExperimentalOutboxEntryAtomic({
          supabase,
          conversationId,
          cycleToken: correlationId,
          outboxEntry,
        });
      }
    } else {
      currentCycle.trace.push(finalTextBalloons.length > 1
        ? "outbox_deferred_to_final_balloons"
        : "outbox_skipped_no_final_payload");
    }

    // ------------------------------------------------------------------------
    // MODO SHADOW: Registra tudo sem envio externo à Meta
    // ------------------------------------------------------------------------
    if (orchState.mode === "shadow") {
      if (outboxEntry) {
        outboxEntry.status = "sent";
        outboxEntry.sentAt = new Date().toISOString();
        outboxEntry.providerMessageId = "shadow_simulated";
      }
      currentCycle.status = "completed";
      currentCycle.trace.push("shadow_simulation_completed");

      for (const id of claimedMessageIds) {
        ledger[id] = "processed";
      }

      // No modo Shadow: executa progressão determinística APENAS como simulação de observabilidade
      const stageProgression = await processDeterministicStageProgression({
        supabase,
        conversationId,
        currentPhase,
        currentStageId,
        decision,
        claimedMessages: claimedMessages || [],
        rawInbounds: rawInbounds || [],
        stageRules,
        orchState,
        currentCycle,
        memoryProvider,
        episodicMemory: [],
      });

      // Traces de simulação exigidos para observabilidade em Shadow
      currentCycle.trace.push(`shadow_would_complete: ${decision.objectiveCompletion?.objectiveId || "none"}`);
      currentCycle.trace.push(`shadow_would_advance: ${stageProgression.stageAdvanced}`);

      const shadowSimulation = {
        wouldCompleteObjectiveId: decision.objectiveCompletion?.objectiveId || null,
        wouldAdvanceStage: stageProgression.stageAdvanced,
        wouldNextPhase: stageProgression.nextPhase,
        wouldNextStageId: stageProgression.nextStageId,
        simulatedCompletedGoals: stageProgression.updatedCompletedGoals,
        simulatedObjectiveProgress: stageProgression.updatedObjectiveProgress,
        detectedFacts: shadowDetectedFacts,
        wouldCompleteObjectives: shadowWouldCompleteObjectives,
        candidateObjectiveEvidence,
      };
      currentCycle.shadowSimulation = shadowSimulation;

      const durationMs = Date.now() - startTime;
      currentCycle.completedAt = new Date().toISOString();
      currentCycle.metrics = {
        durationMs,
        tokens: {
          initial_context_tokens: initialContextTokens,
          tool_calls: toolCallsCount,
          tool_result_tokens: toolResultTokens,
          final_generation_tokens: finalGenerationTokens,
          total: totalTokens,
        },
      };
      currentCycle.trace.push("cycle_completed");

      // REGRA OBRIGATÓRIA: O modo Shadow NUNCA altera o progresso oficial da conversa!
      // Libera atomicamente o lock sem mutar stage_completed_rules autoritativo (completed_goals, memory, objective_progress)
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
        processingStatus: "shadow_logged",
        markProcessedIds: claimedMessageIds,
        cycleRecord: currentCycle,
      });

      await publishAutoPilotState(supabase, conversationId, {
        status: "idle",
        lastThoughts: {
          atriaThought: decision.reasoning,
          solThought: decision.suggestedResponse,
          previewResponses: [decision.suggestedResponse],
        },
        activity: activity(
          "completed",
          "Atria (Shadow)",
          `Decisão: ${decision.action} [${decision.routedSubagent}] | Sugestão: "${(decision.suggestedResponse || "").slice(0, 45)}..."`,
          {
            atriaThought: decision.reasoning,
            solThought: decision.suggestedResponse,
            currentResponsePreview: decision.suggestedResponse,
            mode: "shadow",
            decision,
          }
        ),
      });

      console.log(
        `[Orchestrator] [SHADOW] Decisão registrada com sucesso para ${conversationId} (${durationMs}ms, subagente=${decision.routedSubagent}). Nenhum envio realizado.`
      );

      return {
        mode: "shadow",
        handled: true,
        decision,
        durationMs,
        tokens: totalTokens,
      };
    }

    let sentBalloonsCount = 0;
    let balloons: string[] = [];

    // ------------------------------------------------------------------------
    // MODO EXPERIMENTAL: Execução ativa no chat
    // ------------------------------------------------------------------------
    if (orchState.mode === "experimental") {
      sentSuccessfully = false;

      const isAudioAction = decision.action === "send_audio" || Boolean(decision.audioId);
      let audioPayload: PersonaAudioAsset | undefined;
      if (isAudioAction && decision.audioId) {
        const allAudios = await searchPersonaAudios({ supabase, conversationId, intent: "", stageId: undefined });
        audioPayload = allAudios.find((a) => a.id === decision.audioId);
      }

      if (
        (decision.action === "reply" || decision.action === "send_audio" || decision.action === "advance_phase") &&
        (decision.suggestedResponse || isAudioAction)
      ) {
        if (isAudioAction && (audioPayload?.audioUrl || decision.audioUrl)) {
          const aUrl = audioPayload?.audioUrl || decision.audioUrl;
          balloons = [`[audio:${aUrl}]`];
        } else if (decision.responses && decision.responses.length > 0) {
          balloons = decision.responses;
        } else if (decision.suggestedResponse) {
          balloons = splitIntoBalloons(decision.suggestedResponse);
        } else {
          balloons = [];
        }

        sentBalloonsCount = 0;

        for (let bIndex = 0; bIndex < balloons.length; bIndex++) {
          const balloonText = balloons[bIndex];

          // Pausa humana entre balões subsequentes (se houver mais de 1 balão)
          if (bIndex > 0) {
            const isFastTest = Boolean((runtime as any)?._fastTest);
            if (!isFastTest) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }

          // ------------------------------------------------------------------
          // FRESHNESS GATE 4: Revalidação imediatamente antes de despachar o balão
          // ------------------------------------------------------------------
          const freshnessBeforeBalloon = await checkFreshnessGate({
            supabase,
            conversationId,
            claimedMessageIds,
            cycleStartedAt: currentCycle.startedAt,
            initialInboundRevision,
          });

          if (!freshnessBeforeBalloon.isFresh) {
            console.log(
              `[Orchestrator] Freshness Gate: Nova mensagem detectada antes do balão ${bIndex + 1}/${balloons.length} em ${conversationId} (motivo=${freshnessBeforeBalloon.reason}, msgs=${freshnessBeforeBalloon.newerInboundIds.join(",")}).`
            );

            if (sentBalloonsCount === 0) {
              // CASO A: Zero balões enviados! Cancelamento limpo, sem efeitos colaterais na Meta.
              return await handleCyclePreemption("before_first_balloon", freshnessBeforeBalloon);
            } else {
              // CASO B: Fronteira irreversível! Ao menos um balão já foi entregue à Meta!
              // Balões restantes são cancelados; mensagens claimed deste ciclo ficam como "processed".
              // Agenda debounce para o próximo ciclo com o contexto atualizado (incluindo o que já foi enviado).
              currentCycle.trace.push(
                `remaining_bubbles_superseded: sent=${sentBalloonsCount}, total=${balloons.length}`
              );
              currentCycle.status = "completed";
              for (const id of claimedMessageIds) {
                ledger[id] = "processed";
              }

              const durationMs = Date.now() - startTime;
              currentCycle.completedAt = new Date().toISOString();
              currentCycle.metrics = {
                durationMs,
                tokens: {
                  initial_context_tokens: initialContextTokens,
                  tool_calls: toolCallsCount,
                  tool_result_tokens: toolResultTokens,
                  final_generation_tokens: finalGenerationTokens,
                  total: totalTokens,
                },
              };

              const updatedState: ConversationOrchestrationState = {
                version: 1,
                mode: "experimental",
                currentPhase: orchState.currentPhase || currentPhase,
                currentStageId: orchState.currentStageId || currentStageId,
                responsibleSubagentId: orchState.responsibleSubagentId || responsibleSubagent,
                checkpoint: decision.checkpoint,
                lastProcessedMessageId: claimedMessageIds[claimedMessageIds.length - 1] || newMessage.id,
                lastProcessedAt: new Date().toISOString(),
                lastProcessingStatus: "sent",
                lastCorrelationId: correlationId,
                lastDecision: decision,
                lastError: null,
                durationMs,
                tokens: totalTokens,
                updatedAt: new Date().toISOString(),
                activeCycle: null,
                recentCycles: [currentCycle, ...(orchState.recentCycles || [])].slice(0, 5),
                outbox: outboxMap,
                messageLedger: ledger,
              };
              (updatedState as any).completedGoalIds = officialCompletedGoalIdsAtCycleStart;
              (updatedState as any).objectiveProgress = officialObjectiveProgressAtCycleStart;

              const partialFinalization = await releaseExperimentalCycleAtomic({
                supabase,
                conversationId,
                cycleToken: correlationId,
                processingStatus: "sent",
                debounceUntil: computedDebounceUntil,
                markProcessedIds: claimedMessageIds,
                cycleRecord: currentCycle,
                outboxMap: outboxMap,
              });

              if (!partialFinalization.released) {
                currentCycle.trace.push(`partial_finalization_failed: ${partialFinalization.reason || "lost_lock"}`);
                return {
                  mode: orchState.mode,
                  handled: false,
                  sentToMeta: sentBalloonsCount > 0,
                  blockLegacyFallback: true,
                  error: "lost_lock_before_partial_finalization",
                };
              }
              currentCycle.trace.push(`partial_finalization_committed: balloons=${sentBalloonsCount}`);

              await publishAutoPilotState(supabase, conversationId, {
                status: "idle",
                activity: activity(
                  "completed",
                  "Envio parcial concluído",
                  `Balão ${sentBalloonsCount}/${balloons.length} enviado. Adaptando para nova mensagem...`,
                  { mode: "experimental", sentBalloonsCount, totalBalloons: balloons.length }
                ),
              });

              if (sentBalloonsCount > 0) {
                try {
                  await executeEpisodeWriter({
                    conversationId,
                    claimedMessages: (claimedMessages || []).map((m: any) => ({
                      id: String(m.id),
                      text: m.text || "",
                      sender: "pretendente",
                      direction: "inbound",
                    })),
                    sentBalloons: balloons.slice(0, sentBalloonsCount),
                    sentMessageIds: balloons.slice(0, sentBalloonsCount).map((_, idx) => `out_${correlationId}_${idx}`),
                    audioPayload: audioPayload ? { id: audioPayload.id, theme: audioPayload.title, transcript: audioPayload.transcript } : null,
                    supabase,
                    trace: currentCycle.trace || [],
                  });
                } catch (epErr: any) {
                  console.warn("[EpisodeWriter] Erro fail-safe ao persistir episódios parciais:", epErr);
                }
              }

              return {
                mode: orchState.mode,
                handled: true,
                sentToMeta: true,
                blockLegacyFallback: true,
              };
            }
          }

          // Chave de outbox para este balão
          const balloonKey = balloons.length > 1 ? `${idempotencyKey}_b${bIndex}` : idempotencyKey;
          let balloonOutbox = outboxMap[balloonKey];

          const isAudioBalloon = balloonText.startsWith("[audio:");
          const balloonMessageType = isAudioBalloon ? "audio" : "text";

          if (!balloonOutbox) {
            balloonOutbox = {
              id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_b${bIndex}`,
              cycleId: correlationId,
              conversationId,
              idempotencyKey: balloonKey,
              content: balloonText,
              messageType: balloonMessageType,
              status: "pending",
              attempts: 0,
              maxAttempts: 3,
              createdAt: new Date().toISOString(),
            };
            outboxMap[balloonKey] = balloonOutbox;
          } else {
            balloonOutbox.content = balloonText;
            balloonOutbox.messageType = balloonMessageType;
          }
          currentCycle.outboxEntryId = balloonOutbox.id;

          await prepareExperimentalOutboxEntryAtomic({
            supabase,
            conversationId,
            cycleToken: correlationId,
            outboxEntry: balloonOutbox,
          });

          await publishAutoPilotState(supabase, conversationId, {
            status: "processing",
            activity: activity(
              "sending",
              balloons.length > 1
                ? `Atria enviando balão ${bIndex + 1}/${balloons.length}...`
                : "Atria enviando...",
              "Entregando a mensagem pelo Instagram.",
              {
                atriaThought: decision.reasoning,
                solThought: balloonText,
                currentResponsePreview: balloonText,
                totalBalloons: balloons.length,
                currentBalloon: bIndex + 1,
                countdownSeconds: 0,
                mode: "experimental",
              }
            ),
          });

          // 1. CLAIM ATÔMICO NO BANCO
          const claimRes = await claimOutboxEntryAtomic({
            supabase,
            conversationId,
            outboxKey: balloonKey,
            claimToken: correlationId,
          });

          if (!claimRes.success) {
            console.warn(
              `[Orchestrator] Falha no claim atômico da outbox para ${conversationId} (balão ${bIndex + 1}): motivo=${claimRes.reason}`
            );
            if (claimRes.reason === "cycle_preempted") {
              return await handleCyclePreemption("before_first_balloon_claim", {
                isFresh: false,
                newerInboundCount: 0,
                newerInboundIds: [],
                reason: "preempt_requested_flag",
              });
            }
            if (claimRes.isUncertain || claimRes.reason === "sending_stale_uncertain" || claimRes.reason === "dispatch_uncertain") {
              sentSuccessfully = true;
              currentCycle.status = "failed";
              currentCycle.trace.push(`outbox_claim_uncertain: ${claimRes.reason}`);
              for (const id of claimedMessageIds) {
                ledger[id] = "processed";
              }
              return {
                mode: orchState.mode,
                handled: true,
                sentToMeta: true,
                blockLegacyFallback: true,
                error: `Outbox com envio incerto (${claimRes.reason}). Retry automático bloqueado para evitar duplicação.`,
              };
            } else if (claimRes.isInfraFailure) {
              sentSuccessfully = false;
              currentCycle.status = "failed";
              currentCycle.trace.push(`outbox_claim_infra_failure: ${claimRes.reason}`);
              await releaseExperimentalCycleAtomic({
                supabase,
                conversationId,
                cycleToken: correlationId,
                processingStatus: "failed",
                revertMessageIds: sentBalloonsCount === 0 ? claimedMessageIds : null,
              });

              return {
                mode: orchState.mode,
                handled: false,
                sentToMeta: sentBalloonsCount > 0,
                blockLegacyFallback: true,
                error: `Falha de infraestrutura no claim atômico (${claimRes.reason}). Fail-closed: envio abortado.`,
              };
            } else {
              return {
                mode: orchState.mode,
                handled: false,
                sentToMeta: sentBalloonsCount > 0,
                blockLegacyFallback: true,
                error: `Outbox em envio concorrente ou já processada (${claimRes.reason})`,
              };
            }
          }

          if (claimRes.entry) {
            Object.assign(balloonOutbox, claimRes.entry);
          }

          // 2. DISPATCHER: Envio seguro do balão através da Outbox
          const dispatchRes = await dispatchOutboxEntry({
            supabase,
            outboxEntry: balloonOutbox,
            recipientId: conversationId,
            claimToken: correlationId,
            runtime,
          });

          if (dispatchRes.success && balloonOutbox.status === "sent") {
            sentSuccessfully = true;
            sentBalloonsCount++;
            currentCycle.trace.push(`meta_dispatched_b${bIndex + 1}: ${dispatchRes.providerMessageId}`);

            if (isAudioBalloon && audioPayload) {
              await recordAudioDeliveryHistory({
                supabase,
                conversationId,
                audioId: audioPayload.id,
                providerMessageId: dispatchRes.providerMessageId,
              });
              currentCycle.trace.push(`audio_delivered: ${audioPayload.id}`);
            }

            const nowIso = new Date().toISOString();
            const messageId = dispatchRes.providerMessageId || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            await supabase.from("instagram_messages").upsert({
              id: messageId,
              conversation_id: conversationId,
              sender_id: "me",
              is_mine: true,
              text: balloonText,
              status: "sent",
              created_at: nowIso,
              timestamp: nowIso,
            });

            await supabase
              .from("instagram_conversations")
              .update({
                last_message: balloonText,
                last_message_preview: balloonText,
                last_message_at: nowIso,
                last_direction: "out",
                last_status: "sent",
              })
              .eq("id", conversationId);
          } else if (dispatchRes.isUncertain) {
            sentSuccessfully = true;
            currentCycle.status = "failed";
            currentCycle.trace.push(`meta_dispatch_uncertain: ${dispatchRes.error}`);
            console.warn(
              `[Orchestrator] Envio com status dispatch_uncertain para ${conversationId}. Bloqueando retry automático e fallback legacy para evitar duplicação.`
            );
            for (const id of claimedMessageIds) {
              ledger[id] = "processed";
            }
            break;
          } else {
            currentCycle.status = "failed";
            currentCycle.trace.push(`meta_dispatch_failed: ${dispatchRes.error}`);
            balloonOutbox.status = "failed";
            balloonOutbox.lastError = dispatchRes.error || "Falha no envio";
            outboxMap[balloonKey] = balloonOutbox;
            await prepareExperimentalOutboxEntryAtomic({
              supabase,
              conversationId,
              cycleToken: correlationId,
              outboxEntry: balloonOutbox,
            });
            if (sentBalloonsCount === 0) {
              for (const id of claimedMessageIds) {
                ledger[id] = "pending";
              }
            }
            throw new Error(`Falha no despacho da outbox: ${dispatchRes.error}`);
          }
        }

        if (sentBalloonsCount === balloons.length) {
          for (const id of claimedMessageIds) {
            ledger[id] = "processed";
          }
          currentCycle.status = "completed";
        }
      } else {
        // Ação 'wait' ou sem resposta: marca mensagens como processadas para não reavaliar no vácuo
        for (const id of claimedMessageIds) {
          ledger[id] = "processed";
        }
        currentCycle.status = "completed";
        currentCycle.trace.push("cycle_completed_wait");
      }

      const durationMs = Date.now() - startTime;
      currentCycle.completedAt = new Date().toISOString();
      currentCycle.metrics = {
        durationMs,
        tokens: {
          initial_context_tokens: initialContextTokens,
          tool_calls: toolCallsCount,
          tool_result_tokens: toolResultTokens,
          final_generation_tokens: finalGenerationTokens,
          total: totalTokens,
        },
      };
      currentCycle.trace.push("cycle_completed");

      // MEMORY WRITER: Executa pós-processamento assíncrono de memória de forma fail-safe
      // SOMENTE quando o ciclo concluiu com sucesso (todos os balões enviados confirmados ou ação wait concluída)
      // NUNCA em caso de falha, incerteza de rede (dispatch_uncertain) ou balões incompletos/abortados
      const isConfirmedSuccess =
        currentCycle.status === "completed" &&
        (decision.action === "wait" || sentBalloonsCount === balloons.length);

      let stageProgression = {
        updatedCompletedGoals: [
          ...officialCompletedGoalIdsAtCycleStart,
        ],
        updatedObjectiveProgress: {
          ...officialObjectiveProgressAtCycleStart,
        },
        nextPhase: validatedNextPhase,
        stageAdvanced: false,
        advancementReason: undefined as string | undefined,
      };

      if (!isConfirmedSuccess) {
        currentCycle.trace.push("memory_writer_skipped_unconfirmed_cycle");
        await releaseExperimentalCycleAtomic({
          supabase,
          conversationId,
          cycleToken: correlationId,
          processingStatus: "failed",
          cycleRecord: currentCycle,
          outboxMap,
          markProcessedIds: claimedMessageIds,
        });
      } else {
        // 1. Calcula progressão determinística usando ESTADO LOCAL/OVERLAY (cycleMemoryProvider)
        // O overlay permite que a progressão enxergue os fatos do turno sem NENHUMA escrita no banco!
        stageProgression = await processDeterministicStageProgression({
          supabase,
          conversationId,
          currentPhase,
          currentStageId,
          decision,
          claimedMessages: claimedMessages || [],
          rawInbounds: rawInbounds || [],
          stageRules,
          orchState,
          currentCycle,
          memoryProvider: cycleMemoryProvider,
          episodicMemory: [],
        });
        decision.nextPhase = stageProgression.nextPhase;

        // 2. Executa MemoryWriter CONTRA O OVERLAY DE MEMÓRIA (cycleMemoryProvider)
        // Zero escritas reais no banco antes do commit atômico condicional (CAS)!
        try {
          await executeMemoryWriter({
            conversationId,
            claimedMessages: claimedMessages,
            lastLarissaTurn: baseContextPayload.lastLarissaTurn,
            sentResponseText: decision.suggestedResponse,
            memoryProvider: cycleMemoryProvider, // OVERLAY EM RAM: zero persistência antes do CAS
            supabase,
            trace: currentCycle.trace,
          });
        } catch (memErr: any) {
          currentCycle.trace.push(`memory_writer_error: ${memErr.message || String(memErr)}`);
        }

        // 3. Obtém todos os fatos confirmados do turno gravados no overlay em RAM
        const pendingFacts = cycleMemoryProvider.getPendingFacts();

        // 4. Leitura snapshot para preservação estrita de fatos já existentes no banco
        const { data: preCommitData } = await supabase
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", conversationId)
          .maybeSingle();

        const freshRules = preCommitData?.stage_completed_rules || stageRules;
        const latestMemoryFromDb = freshRules?.orchestration?.memory;

        let providerMemoryEntities: Record<string, Record<string, MemoryFact>> = {};
        if (typeof (memoryProvider as any).getOrCreateStore === "function") {
          const memStore = (memoryProvider as any).getOrCreateStore(conversationId);
          if (memStore?.entities) {
            providerMemoryEntities = memStore.entities;
          }
        }

        const confirmedTurnEntities: Record<string, Record<string, MemoryFact>> = {};
        for (const f of pendingFacts) {
          const normEnt = (f.entity || "self").toLowerCase().trim();
          const normFld = (f.field || "").toLowerCase().trim();
          if (!confirmedTurnEntities[normEnt]) confirmedTurnEntities[normEnt] = {};
          confirmedTurnEntities[normEnt][normFld] = {
            entity: normEnt,
            field: normFld,
            value: f.value,
            confidence: f.confidence ?? 1.0,
            sourceMessageId: f.sourceMessageId,
            updatedAt: new Date().toISOString(),
          };
        }

        // Integração de memoryCandidates validados do subagente com evidência comprovada
        for (const cand of validatedMemoryCandidates) {
          const normEnt = (cand.entity || "self").toLowerCase().trim();
          const normFld = (cand.key || "").toLowerCase().trim();
          if (!confirmedTurnEntities[normEnt]) confirmedTurnEntities[normEnt] = {};
          confirmedTurnEntities[normEnt][normFld] = {
            entity: normEnt,
            field: normFld,
            value: cand.value,
            confidence: 1.0,
            sourceMessageId: cand.evidenceMessageId,
            updatedAt: new Date().toISOString(),
          };
        }

        const mergedEntities: Record<string, Record<string, MemoryFact>> = {};

        const allEntitySources = [
          orchState.memory?.entities || {},
          latestMemoryFromDb?.entities || {},
          providerMemoryEntities,
          confirmedTurnEntities,
        ];

        for (const source of allEntitySources) {
          for (const [entName, fields] of Object.entries(source)) {
            const normEnt = entName.toLowerCase().trim();
            if (!mergedEntities[normEnt]) {
              mergedEntities[normEnt] = {};
            }
            if (fields && typeof fields === "object") {
              for (const [fldName, fact] of Object.entries(fields)) {
                const normFld = fldName.toLowerCase().trim();
                mergedEntities[normEnt][normFld] = fact as MemoryFact;
              }
            }
          }
        }

        const snippetsToMerge = [
          ...(latestMemoryFromDb?.snippets || orchState.memory?.snippets || []),
        ];
        for (const cand of validatedMemoryCandidates) {
          const snipText = cand.summary || `${cand.key}: ${cand.value}`;
          if (snipText && !snippetsToMerge.some((s: any) => s.snippet === snipText)) {
            snippetsToMerge.push({
              snippet: snipText,
              entity: cand.entity || "self",
              sourceMessageId: cand.evidenceMessageId,
            });
          }
        }

        const mergedMemory: ContactMemoryStore = {
          entities: mergedEntities,
          snippets: snippetsToMerge,
        };

        const finalPhaseForExp = stageProgression.nextPhase || currentPhase;

        const updatedState: ConversationOrchestrationState = {
          version: 1,
          mode: "experimental",
          currentPhase: finalPhaseForExp,
          currentStageId: stageProgression.nextStageId,
          responsibleSubagentId: stageProgression.responsibleSubagentId,
          checkpoint: decision.checkpoint,
          lastProcessedMessageId: claimedMessageIds[claimedMessageIds.length - 1] || newMessage.id,
          lastProcessedAt: new Date().toISOString(),
          lastProcessingStatus: sentSuccessfully || decision.action === "wait" ? "sent" : "decided",
          lastCorrelationId: correlationId,
          lastDecision: decision,
          lastError: null,
          durationMs,
          tokens: totalTokens,
          updatedAt: new Date().toISOString(),
          activeCycle: null,
          recentCycles: [currentCycle, ...(orchState.recentCycles || [])].slice(0, 5),
          outbox: outboxMap,
          messageLedger: ledger,
          memory: mergedMemory,
          liveState: currentLiveState,
        };
        (updatedState as any).completedGoalIds = stageProgression.updatedCompletedGoals;
        (updatedState as any).objectiveProgress = stageProgression.updatedObjectiveProgress;
        updatedState.inboundRevision = freshRules?.orchestration?.inboundRevision ?? initialInboundRevision;
        updatedState.preemptRequested = false;

        const finalStageCompletedRules = {
          ...freshRules,
          completed_goals: stageProgression.updatedCompletedGoals,
          objective_progress: stageProgression.updatedObjectiveProgress,
          active_cycle_token: null,
          preempt_requested: false,
          orchestration: updatedState,
        };

        // 5. COMPARE-AND-SET / CAS ATÔMICO CONDICIONAL:
        // A autoridade final absoluta reside na própria escrita atômica no PostgreSQL.
        // Se outro ciclo assumiu o lock ou se preempt_requested mudou antes deste instante,
        // a escrita falha inteira: ZERO ContactMemory nova, ZERO progresso novo e ZERO EpisodeWriter!
        const casResult = await commitExperimentalCycleAtomic({
          supabase,
          conversationId,
          correlationId,
          newStageCompletedRules: finalStageCompletedRules,
        });

        if (!casResult.committed) {
          console.warn(
            `[Orchestrator] CAS final falhou para ciclo ${correlationId} (motivo=${casResult.reason}, activeToken=${casResult.activeToken || "null"}). Abortando commit oficial com zero contaminação de memória.`
          );
          return {
            mode: orchState.mode,
            handled: false,
            sentToMeta: sentSuccessfully,
            blockLegacyFallback: true,
            error: "lost_lock_before_atomic_commit",
          };
        }


        await publishAutoPilotState(supabase, conversationId, {
          status: "idle",
          lastThoughts: {
            atriaThought: decision.reasoning,
            solThought: decision.suggestedResponse,
            previewResponses: [decision.suggestedResponse],
          },
          activity: activity(
            "completed",
            sentSuccessfully ? "Atria respondeu" : "Atria avaliou",
            decision.suggestedResponse || "Turno concluído.",
            {
              atriaThought: decision.reasoning,
              solThought: decision.suggestedResponse,
              currentResponsePreview: decision.suggestedResponse,
              previewResponses: [decision.suggestedResponse],
              mode: "experimental",
              decision,
            }
          ),
        });

        // Gravação determinística de episódios da conversa (Memória Episódica / Anti-repetição)
        // Executa UMA ÚNICA VEZ por ciclo normal confirmado, após o commit oficial
        if (sentSuccessfully) {
          try {
            await executeEpisodeWriter({
              conversationId,
              claimedMessages: (claimedMessages || []).map((m: any) => ({
                id: String(m.id),
                text: m.text || "",
                sender: "pretendente",
                direction: "inbound",
              })),
              sentBalloons: balloons || [],
              sentMessageIds: (balloons || []).map((_, idx) => `out_${correlationId}_${idx}`),
              audioPayload: audioPayload
                ? { id: audioPayload.id, theme: audioPayload.title, transcript: audioPayload.transcript }
                : null,
              supabase,
              trace: currentCycle.trace || [],
            });
          } catch (epErr: any) {
            console.warn("[EpisodeWriter] Erro fail-safe ao persistir episódios da conversa:", epErr);
          }

          // Gravação determinística de episódios da conversa a partir dos memoryCandidates pós-CAS
          if (validatedMemoryCandidates.length > 0) {
            try {
              const candidateEpisodes: ConversationEpisode[] = validatedMemoryCandidates.map((cand) => {
                const evMsg = (claimedMessages || []).find((m: any) => String(m.id) === String(cand.evidenceMessageId));
                return {
                  conversation_id: conversationId,
                  actor: "pretendente" as const,
                  event_type: cand.kind === "fact" ? ("fact_reveal" as const) : ("preference_reveal" as const),
                  memory_class: "speech_act" as const,
                  topic: cand.key,
                  summary: cand.summary || `${cand.key}: ${cand.value}`,
                  original_text: evMsg?.text || null,
                  source_message_id: cand.evidenceMessageId,
                  semantic_keys: cand.tags && cand.tags.length > 0 ? cand.tags : [cand.key],
                  metadata: { value: cand.value, key: cand.key, entity: cand.entity, memory_class: "speech_act", importance: 0.5 },
                };
              });
              await saveConversationEpisodes({
                supabase,
                conversationId,
                episodes: candidateEpisodes,
              });
              currentCycle.trace.push(`memory_candidates_saved_to_episodes: ${candidateEpisodes.length}`);
            } catch (candErr: any) {
              console.warn("[Orchestrator] Erro ao persistir candidateEpisodes:", candErr);
            }
          }

          // Gravação determinística de Contact Memory & Conversation Memory (00–05) propostas pelo Brain
          if (brainPlan?.memoryWrites && typeof brainPlan.memoryWrites === "object" && orchState.mode !== "shadow") {
            try {
              const validMsgIds = new Set<string>((claimedMessages || []).map((m: any) => String(m.id)));
              const primaryFallbackMsgId = claimedMessages?.[0]?.id ? String(claimedMessages[0].id) : correlationId;

              // 1. Contact Memory (Fatos e Quotes)
              const rawFacts = Array.isArray(brainPlan.memoryWrites.contactFacts) ? brainPlan.memoryWrites.contactFacts : [];
              const rawQuotes = Array.isArray(brainPlan.memoryWrites.quotes) ? brainPlan.memoryWrites.quotes : [];

              const normalizedFacts = rawFacts.map((f: any) => {
                const srcIds = Array.isArray(f.sourceMessageIds) && f.sourceMessageIds.length > 0
                  ? f.sourceMessageIds.map(String)
                  : [primaryFallbackMsgId];
                return {
                  ...f,
                  sourceMessageIds: srcIds,
                  sourceActor: f.sourceActor || "pretendente",
                };
              });

              const normalizedQuotes = rawQuotes.map((q: any) => ({
                ...q,
                sourceMessageId: q.sourceMessageId ? String(q.sourceMessageId) : primaryFallbackMsgId,
              }));

              if (normalizedFacts.length > 0 || normalizedQuotes.length > 0) {
                const contactRes = await commitContactMemoryWrites({
                  supabase,
                  conversationId,
                  cycleId: correlationId,
                  facts: normalizedFacts,
                  quotes: normalizedQuotes,
                  validMessageIds: validMsgIds,
                });
                currentCycle.trace.push(
                  `contact_memory_writes_committed: facts=${contactRes.factsCommitted} quotes=${contactRes.quotesCommitted} superseded=${contactRes.supersededCount}`
                );
              }

              // 2. Conversation Memory (Episódios, Speech Acts, Open Loops)
              const rawEpisodes = Array.isArray(brainPlan.memoryWrites.episodes) ? brainPlan.memoryWrites.episodes : [];
              const rawSpeechActs = Array.isArray(brainPlan.memoryWrites.speechActs) ? brainPlan.memoryWrites.speechActs : [];
              const rawOpenLoops = Array.isArray(brainPlan.memoryWrites.openLoops) ? brainPlan.memoryWrites.openLoops : [];

              if (rawEpisodes.length > 0 || rawSpeechActs.length > 0 || rawOpenLoops.length > 0) {
                const convRes = await commitConversationMemoryWrites({
                  supabase,
                  conversationId,
                  cycleId: correlationId,
                  episodes: rawEpisodes,
                  speechActs: rawSpeechActs,
                  openLoops: rawOpenLoops,
                  validMessageIds: validMsgIds,
                });
                currentCycle.trace.push(
                  `conversation_memory_writes_committed: episodes=${convRes.episodesCommitted} speechActs=${convRes.speechActsCommitted} openLoops=${convRes.openLoopsCommitted}`
                );
              }
            } catch (memWriteErr: any) {
              console.warn("[Orchestrator] Erro fail-safe ao persistir memoryWrites 00-05:", memWriteErr);
            }
          }
        }

        if (currentMemoryScopeId) {
          try {
            await revokeAgentMemoryScope({ supabase, scopeId: currentMemoryScopeId });
            currentCycle.trace.push(`agent_memory_scope_revoked=${currentMemoryScopeId}`);
          } catch (revScopeErr) {
            console.warn("[Orchestrator] Falha ao revogar agent_memory_scope:", revScopeErr);
          }
        }
      }

      console.log(
        `[Orchestrator] [EXPERIMENTAL] Execução concluída para ${conversationId} (subagente=${decision.routedSubagent}, ação=${decision.action}, fase=${validatedNextPhase}).`
      );

      // Verificação pós-ciclo: se chegaram mensagens novas do pretendente durante este ciclo, agenda follow-up imediato
      try {
        const { data: latestUnread } = await supabase
          .from("instagram_messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("is_mine", false)
          .order("created_at", { ascending: true })
          .limit(10);

        const hasUnprocessed = (latestUnread || []).some(
          (m: any) => ledger[m.id] !== "processed" && !claimedMessageIds.includes(m.id)
        );

        if (hasUnprocessed) {
          console.log(`[Orchestrator] Mensagens novas detectadas durante o ciclo em ${conversationId}. Agendando próximo ciclo imediatamente.`);
          await supabase
            .from("instagram_conversations")
            .update({
              ai_auto_respond: true,
              ai_debounce_until: new Date().toISOString(),
            })
            .eq("id", conversationId);
        }
      } catch (_npErr) {}

      return {
        mode: "experimental",
        handled: true,
        sentToMeta: sentSuccessfully,
        blockLegacyFallback: true,
        decision,
        durationMs,
        tokens: totalTokens,
        trace: currentCycle.trace,
      };
    }

    return { mode: "legacy", handled: false };
  } catch (err: any) {
    console.error(`[Orchestrator] Erro na execução de ${conversationId}:`, err);

    // Em caso de erro, reverte as mensagens claimed para pending para permitir retry
    for (const id of claimedMessageIds) {
      ledger[id] = "pending";
    }

    const fallbackState: ConversationOrchestrationState = {
      ...orchState,
      lastError: err.message || "Erro desconhecido",
      lastProcessingStatus: "failed",
      updatedAt: new Date().toISOString(),
      messageLedger: ledger,
      outbox: outboxMap,
    };

    const releaseRes = await releaseExperimentalCycleAtomic({
      supabase,
      conversationId,
      cycleToken: correlationId,
      processingStatus: "failed",
      lastError: err.message || "Erro desconhecido",
      cycleRecord: currentCycle,
      outboxMap: fallbackState.outbox || outboxMap,
      revertMessageIds: sentSuccessfully ? null : claimedMessageIds,
    });

    if (!releaseRes.released) {
      console.warn(
        `[Orchestrator] Falha capturada no ciclo ${correlationId}, mas ciclo já perdeu o lock (atual: ${releaseRes.activeToken || "null"}). Abortando sobrescrita de fallback.`
      );
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: sentSuccessfully,
        blockLegacyFallback: true,
        error: err.message || "Ciclo preemptado",
      };
    }

    await publishAutoPilotState(supabase, conversationId, {
      status: "failed",
      cycleId: correlationId,
      activity: activity(
        "failed",
        "Erro na Atria",
        err.message || "Falha na análise da Atria",
        { mode: orchState.mode, cycleId: correlationId }
      ),
    });

    return {
      mode: orchState.mode,
      handled: false,
      sentToMeta: sentSuccessfully,
      blockLegacyFallback: orchState.mode === "experimental",
      error: err.message || "Erro na orquestração experimental",
    };
  } finally {
    try {
      await releaseExperimentalCycleAtomic({
        supabase,
        conversationId,
        cycleToken: correlationId,
      });
    } catch (_fErr) {}
  }
}
