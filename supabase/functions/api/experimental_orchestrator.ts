// ============================================================================
// experimental_orchestrator.ts
// Motor Experimental de Orquestração por Conversa (Clean Architecture)
// Arquitetura: Backend Determinístico + Agente da Conversa + Subagentes
// Suporta modos: 'legacy' | 'shadow' | 'experimental'
// ============================================================================
import { publishAutoPilotState, activity } from "./cloud_autopilot.ts";

export type OrchestrationMode = "legacy" | "shadow" | "experimental";
export type OrchestrationPhase = "conexao_inicial" | "descoberta";
export type OrchestrationAction = "reply" | "send_audio" | "wait" | "advance_phase" | "escalate";
export type SubagentTarget = "conexao_inicial" | "descoberta" | "none";
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

export interface SubagentDecision {
  action: OrchestrationAction;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
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
}

export interface OrchestratorDecision {
  action: OrchestrationAction;
  currentPhase: OrchestrationPhase;
  nextPhase: OrchestrationPhase;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
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
}

export interface ConversationOrchestrationState {
  version: 1;
  mode: OrchestrationMode;
  currentPhase: OrchestrationPhase;
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
  fallbackPhase: OrchestrationPhase
): ConversationRoutingDecision {
  if (!data || typeof data !== "object") {
    return {
      targetSubagent: fallbackPhase,
      action: "delegate",
      reason: "Fallback por payload não-objeto",
    };
  }
  const obj = data as Record<string, any>;

  if (
    obj.targetSubagent === "conexao_inicial" ||
    obj.targetSubagent === "descoberta" ||
    obj.targetSubagent === "none"
  ) {
    const action = obj.action === "wait" || obj.action === "pause" ? obj.action : "delegate";
    return {
      targetSubagent: obj.targetSubagent,
      action,
      reason: typeof obj.reason === "string" ? obj.reason.trim() : "Decisão de roteamento válida",
    };
  }

  // Compatibilidade resiliente com mocks e decisões diretas
  if (obj.currentPhase === "descoberta" || obj.nextPhase === "descoberta") {
    return {
      targetSubagent: "descoberta",
      action: "delegate",
      reason: "Roteado com base na fase da decisão",
    };
  }

  return {
    targetSubagent: fallbackPhase || "conexao_inicial",
    action: obj.action === "wait" ? "wait" : "delegate",
    reason: typeof obj.reasoning === "string" ? obj.reasoning.trim() : "Roteamento padrão para fase atual",
  };
}

// ----------------------------------------------------------------------------
// 2. Validador de Decisão de Subagente
// ----------------------------------------------------------------------------
export function validateSubagentDecision(
  data: unknown,
  currentPhase: OrchestrationPhase
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

  const nextPhase: OrchestrationPhase =
    obj.nextPhase === "descoberta" ? "descoberta" : "conexao_inicial";

  const checkpoint =
    typeof obj.checkpoint === "string" && obj.checkpoint.trim()
      ? obj.checkpoint.trim()
      : currentPhase === "descoberta"
      ? "chk_pergunta_sobre_ele"
      : "chk_saudacao_feita";

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "Turno processado";
  const suggestedResponse = typeof obj.suggestedResponse === "string" ? obj.suggestedResponse.trim() : "";
  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim()
      ? obj.reasoning.trim()
      : "Execução especializada do subagente";

  let objectiveCompletion: { objectiveId: string; evidenceMessageId?: string; value?: any } | undefined;
  const rawObjComp = obj.objectiveCompletion || obj.objective_completion;
  if (rawObjComp && typeof rawObjComp === "object" && rawObjComp.objectiveId) {
    objectiveCompletion = {
      objectiveId: String(rawObjComp.objectiveId || rawObjComp.goalId || "").trim(),
      evidenceMessageId: rawObjComp.evidenceMessageId ? String(rawObjComp.evidenceMessageId).trim() : undefined,
      value: rawObjComp.value !== undefined ? rawObjComp.value : true,
    };
  }

  return {
    action,
    checkpoint,
    summary,
    suggestedResponse,
    nextPhase,
    reasoning,
    requiredTools: Array.isArray(obj.requiredTools) ? obj.requiredTools.map(String) : [action === "send_audio" ? "send_audio" : "send_text"],
    audioId: rawAudioId,
    audioUrl: typeof obj.audioUrl === "string" ? obj.audioUrl.trim() : undefined,
    objectiveCompletion,
  };
}

// ----------------------------------------------------------------------------
// 3. Validador de Esquema Estrito (Compatibilidade Retroativa)
// ----------------------------------------------------------------------------
export function validateOrchestratorDecision(data: unknown): OrchestratorDecision {
  if (!data || typeof data !== "object") {
    throw new Error("Decisão do orquestrador inválida: payload não é um objeto.");
  }
  const obj = data as Record<string, any>;

  const validActions: OrchestrationAction[] = ["reply", "send_audio", "wait", "advance_phase", "escalate"];
  if (!validActions.includes(obj.action)) {
    throw new Error(`Ação inválida: "${obj.action}". Esperado: ${validActions.join(", ")}`);
  }

  const validPhases: OrchestrationPhase[] = ["conexao_inicial", "descoberta"];
  if (!validPhases.includes(obj.currentPhase)) {
    throw new Error(`Fase atual inválida: "${obj.currentPhase}".`);
  }
  if (!validPhases.includes(obj.nextPhase)) {
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

  return {
    action: obj.action,
    currentPhase: obj.currentPhase,
    nextPhase: obj.nextPhase,
    checkpoint: obj.checkpoint.trim(),
    summary: obj.summary.trim(),
    suggestedResponse: obj.suggestedResponse.trim(),
    requiredTools: obj.requiredTools.map(String),
    reasoning: obj.reasoning.trim(),
  };
}

// ----------------------------------------------------------------------------
// 4. Validador de Transição de Fase pelo Backend (Guarda de Integridade)
// ----------------------------------------------------------------------------
export function validatePhaseTransition(
  currentPhase: OrchestrationPhase,
  requestedNextPhase: OrchestrationPhase,
  checkpoint: string
): { allowed: boolean; validatedNextPhase: OrchestrationPhase; reason?: string } {
  if (requestedNextPhase === currentPhase) {
    return { allowed: true, validatedNextPhase: currentPhase };
  }

  // Transição de 'conexao_inicial' -> 'descoberta'
  if (currentPhase === "conexao_inicial" && requestedNextPhase === "descoberta") {
    const validCheckpoints = ["chk_rapport_estabelecido", "chk_conexao_validada", "chk_saudacao_reciproca"];
    if (validCheckpoints.includes(checkpoint)) {
      return { allowed: true, validatedNextPhase: "descoberta" };
    }
    return {
      allowed: false,
      validatedNextPhase: "conexao_inicial",
      reason: `Checkpoint "${checkpoint}" insuficiente para avançar para descoberta. Requer um de: ${validCheckpoints.join(", ")}`,
    };
  }

  // Descoberta não regride automaticamente sem comando explícito
  if (currentPhase === "descoberta" && requestedNextPhase === "conexao_inicial") {
    return {
      allowed: false,
      validatedNextPhase: "descoberta",
      reason: "Regressão de fase não permitida automaticamente pelo agente.",
    };
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
    replyToMessageId: raw.reply_to_message_id || raw.replyToMessageId || null,
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

    return {
      acknowledged: Boolean(data.acknowledged),
      currentRevision: data.currentRevision,
      expectedRevision: data.expectedRevision,
      reason: data.reason || "unknown",
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

  return `Você é o Agente da Conversa da Larissa no Vendeo.
Sua missão é estritamente de roteamento: analisar o estágio do diálogo e decidir qual subagente especializado deve responder ao pretendente.

### SUBAGENTES DISPONÍVEIS:
1. "conexao_inicial": Atendimento inicial, troca de saudações ("oi", "tudo bem", "como foi seu dia"), acolhimento caloroso e estabelecimento de reciprocidade inicial.
2. "descoberta": Quando o contato inicial já foi correspondido e o diálogo deve aprofundar em quem ele é (profissão/trabalho, cidade onde mora, rotina, gostos).
3. "none": Mensagem não exige resposta imediata ou deve aguardar.

### CONTEXTO DA CONVERSA
${contextBlock}

### DIRETRIZ DE DECISÃO
- Se a fase atual for 'conexao_inicial' e o pretendente estiver apenas cumprimentando ou trocando amenidades, direcione para "conexao_inicial".
- Se ele já cumprimentou, respondeu com reciprocidade e deu abertura para saber mais, ou se a conversa já estiver na fase 'descoberta', direcione para "descoberta".

Responda ESTRITAMENTE em JSON puro com as seguintes chaves:
{
  "targetSubagent": "conexao_inicial" | "descoberta" | "none",
  "action": "delegate" | "wait" | "pause",
  "reason": "explicação curta da escolha do subagente"
}`;
}

// ----------------------------------------------------------------------------
// 7. Construtores de Prompt dos Subagentes Especializados (Camada 2 - Enxutos)
// ----------------------------------------------------------------------------
export function buildConexaoInicialPrompt(input: SubagentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_saudacao_feita"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  return `Você é a subagente especialista em CONEXÃO INICIAL da Larissa (23 anos, moça meiga de Minas Gerais).
Seu objetivo é acolher com carinho, simpatia e validação de reciprocidade.

### DIRETRIZES DA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Tom: meigo, carinhoso, mineiro natural (usando 'né', 'kkk', 'vc', 'tô', 'tá', 'pra').
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Jamais chame o pretendente de Larissa.
- Responda ao que ele falou antes de fazer qualquer pergunta leve.
- Mantenha o balão curto e natural de celular.
- REGRA INVIOLÁVEL DE 'UAI' (RARO E OPCIONAL): O 'uai' é estritamente OPCIONAL e MUITO RARO (use no máximo em 1 a cada 15 falas). Na dúvida, NUNCA use 'uai'. A mineiridade natural da Larissa vem de "vc", "tô", "tá", "né", "pra", pelo ritmo acolhedor e humor, NUNCA carimbando 'uai'. Se puder falar sem 'uai', prefira SEMPRE sem 'uai'.
- DIRETRIZ DE FECHAMENTO (ZERO PERGUNTA MECÂNICA): NÃO termine toda fala devolvendo a pergunta ("e você?", "e vc?", "você costuma...?"). Uma resposta pode simplesmente fechar afirmando ou rindo (ex: "bife com batata frita fácil kkk", "Simone Mendes fácil kkk", "sou moça de família rapaz kkk"). Só devolva pergunta se houver motivo real ou curiosidade genuína (em no máximo 20% das falas). Na dúvida, termine sem pergunta.
- PROIBIÇÃO DE TOOLS EM SAUDAÇÕES E EMPATIA: Para cumprimentos comuns ("oi", "tudo bem?", "boa noite", "oie"), risadas ("kkkk") ou reações de empatia ("nossa deve ser puxado mesmo"), É TERMINANTEMENTE PROIBIDO chamar ferramentas (nem persona_audio_search, nem persona_get_fact, nem persona_search). Responda DIRETO em texto com action: "reply".
- INTERPRETAÇÃO RIGOROSA DE BOOLEANOS (false): Se persona_get_fact ou persona_search retornar um fato com value: false (ex: drinks.likes_wine: false, food.likes_coffee: false, movies.likes_shark_movies: false), significa CATEGORICAMENTE que a Larissa NÃO GOSTA, NÃO BEBE, NÃO CONSOME e NÃO ASSISTE. Jamais diga que gosta "às vezes" ou "de vez em quando". Se for false, ela afirma com meiguice e naturalidade que não curte / não bebe / não gosta.

### CONTEXTO DA CONVERSA
${contextBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA
Trabalhe primeiro apenas com o contexto recebido.
Se precisar checar fatos já descobertos ou consultar preferências pontuais:
- persona_get_fact: consulta fato específico sobre a Larissa (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta). Priorize SEMPRE persona_get_fact quando a pergunta for sobre um atributo identificável. Ex: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}
- persona_search: busca aberta para perguntas narrativas, perrengues, motivos ou histórias da Larissa. Ex: {"action": "call_tool", "tool": "persona_search", "parameters": {"query": "estudos faculdade estágio"}}
- memory_get_fact: consulta fato estruturado sobre o pretendente (ContactMemory). Ex: {"action": "call_tool", "tool": "memory_get_fact", "parameters": {"entity": "self", "field": "age" | "city"}}
- memory_search: busca aberta por trechos relevantes sobre o pretendente. Ex: {"action": "call_tool", "tool": "memory_search", "parameters": {"entity": "self", "query": "..."}}

Regras de Uso:
- PRIORIDADE ABSOLUTA DE FATOS: PersonaMemory canônica (persona_get_fact / persona_search) > contexto da conversa. Exemplos de diálogos externos/seeds servem APENAS para calibrar estilo coloquial, NUNCA para inventar ou sobrescrever fatos pessoais da Larissa.
- Não consulte memória por curiosidade ou se o contexto atual já for suficiente. Em saudações triviais, NUNCA chame ferramentas.
- A Larissa NUNCA tem os dados do pretendente e o pretendente NUNCA tem os dados da Larissa.
- Para acionar ferramenta, responda em JSON compacto: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}

### CHECKPOINTS DESTA FASE
- 'chk_saudacao_feita': Se ainda for troca de cumprimento ou reciprocidade inicial. Próxima fase: 'conexao_inicial'.
- 'chk_rapport_estabelecido': Se o pretendente demonstrou engajamento recíproco e a conexão inicial foi firmada, autorizando avançar para 'descoberta'.

Responda ESTRITAMENTE em JSON puro, compacto e sem explicações longas de raciocínio:
{
  "action": "reply",
  "checkpoint": "chk_saudacao_feita" | "chk_rapport_estabelecido",
  "summary": "resumo de 3 palavras",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "conexao_inicial" | "descoberta"
}`;
}

export interface SemanticGoalDefinition {
  id: string;
  stageId?: string;
  label: string;
  memoryEntity: string;
  memoryField: string;
  description?: string;
  required?: boolean;
  order?: number;
  enabled?: boolean;
}

export interface ResolvedStageGoal {
  id: string;
  label: string;
  status: "completed" | "pending";
  value: any;
  required?: boolean;
}

export const DEFAULT_DESCOBERTA_GOALS: SemanticGoalDefinition[] = [
  {
    id: "goal_age",
    label: "Idade",
    memoryEntity: "self",
    memoryField: "age",
    description: "Descobrir a idade naturalmente",
    required: true,
    order: 1,
    enabled: true,
  },
  {
    id: "goal_city",
    label: "Cidade",
    memoryEntity: "self",
    memoryField: "city",
    description: "Descobrir onde ele mora",
    required: true,
    order: 2,
    enabled: true,
  },
  {
    id: "goal_job",
    label: "Profissão",
    memoryEntity: "self",
    memoryField: "job",
    description: "Descobrir o trabalho ou ocupação dele",
    required: false,
    order: 3,
    enabled: true,
  },
  {
    id: "goal_relationship",
    label: "Relacionamento / Filhos",
    memoryEntity: "self",
    memoryField: "relationship_status",
    description: "Saber sobre status de relacionamento ou se tem filhos",
    required: false,
    order: 4,
    enabled: true,
  },
];

export async function resolveStageChecklistGoals(params: {
  supabase: any;
  conversationId: string;
  stageNameOrId?: string;
  memoryProvider: MemoryProvider;
  completedGoalIds?: string[];
}): Promise<{ stage: string; goals: ResolvedStageGoal[] }> {
  const { supabase, conversationId, stageNameOrId, memoryProvider, completedGoalIds = [] } = params;
  const targetStageQuery = (stageNameOrId || "descoberta").trim().toLowerCase();

  let stagesList: any[] = [];
  try {
    const { data: stagesRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__chat_stages__")
      .maybeSingle();

    if (stagesRow?.stage_completed_rules?.stages && Array.isArray(stagesRow.stage_completed_rules.stages)) {
      stagesList = stagesRow.stage_completed_rules.stages;
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
  }

  let rawGoals: SemanticGoalDefinition[] = [];
  if (matchedStage?.objectives && Array.isArray(matchedStage.objectives) && matchedStage.objectives.length > 0) {
    rawGoals = matchedStage.objectives.map((o: any) => ({
      id: o.id,
      stageId: o.stageId,
      label: o.title || o.label,
      memoryEntity: o.memoryEntity || "self",
      memoryField: o.memoryField || "",
      description: o.description,
      required: o.required,
      order: o.order,
      enabled: o.enabled,
    }));
  } else if (matchedStage?.goals && Array.isArray(matchedStage.goals) && matchedStage.goals.length > 0) {
    rawGoals = matchedStage.goals;
  } else if (targetStageQuery.includes("descoberta") || targetStageQuery === "descoberta") {
    rawGoals = DEFAULT_DESCOBERTA_GOALS;
  }

  // Filtra apenas habilitados
  const activeGoals = rawGoals
    .filter((g) => g.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const resolvedGoals: ResolvedStageGoal[] = [];

  for (const goal of activeGoals) {
    const entity = (goal.memoryEntity || "self").trim().toLowerCase();
    const field = (goal.memoryField || "").trim().toLowerCase();

    // 1. Consulta fato estruturado na memória do contato (deterministico)
    const factRes = await memoryProvider.getFact(conversationId, entity, field);

    if (factRes.found && factRes.value !== undefined && factRes.value !== null && factRes.value !== "") {
      resolvedGoals.push({
        id: goal.id,
        label: goal.label,
        status: "completed",
        value: factRes.value,
        required: goal.required,
      });
    } else if (completedGoalIds.includes(goal.id)) {
      resolvedGoals.push({
        id: goal.id,
        label: goal.label,
        status: "completed",
        value: true,
        required: goal.required,
      });
    } else {
      resolvedGoals.push({
        id: goal.id,
        label: goal.label,
        status: "pending",
        value: null,
        required: goal.required,
      });
    }
  }

  // ZERO nextGoal no backend: a IA decide organicamente
  return {
    stage: matchedStage?.name || targetStageQuery,
    goals: resolvedGoals,
    objectives: resolvedGoals.map((g) => ({
      id: g.id,
      title: g.label,
      label: g.label,
      status: g.status,
      value: g.value,
      required: g.required,
    })),
  };
}

export const resolveStageObjectives = resolveStageChecklistGoals;

// ----------------------------------------------------------------------------
// Persona Memory da Larissa (Dossiê Canônico Estruturado & Persistente)
// ----------------------------------------------------------------------------
export interface PersonaMemoryFact {
  id?: string;
  persona_id: string;
  category: string;
  key: string;
  value: any;
  source_type: "canonical" | "temporal" | "generated";
  confidence: number;
  aliases: string[];
  valid_from: string | null;
  valid_until: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PersonaFactResult {
  found: boolean;
  field: string;
  value: any;
  category?: string;
  source_type?: "canonical" | "temporal" | "generated" | "legacy_fallback";
  confidence?: number;
  valid_from?: string | null;
  valid_until?: string | null;
}

// Objeto de fallback mantido estritamente para compatibilidade operacional temporária
// Saneamento canônico estrito: excluídos café preto, vinho suave, cerveja, álcool, Tribo da Periferia, filmes de tubarão e almoço sem líquido.
export const LARISSA_PERSONA_FACTS: Record<string, any> = {
  name: "Larissa",
  full_name: "Larissa Cristina Paiva Resende",
  age: 23,
  birth_date: "2002-11-06",
  city: "São João del Rei (Minas Gerais)",
  neighborhood: "Matosinhos",
  location: "São João del Rei - MG (Bairro Matosinhos)",
  course: "Enfermagem",
  college_period: "10º",
  graduation: "final de 2026",
  studies: "Faculdade de Enfermagem (10º período, formatura no final de 2026 com estágio em hospital)",
  profession: "Estudante de Enfermagem (estágio hospitalar) e trabalha com vendas em casa",
  occupation: "Estudante de Enfermagem (estágio hospitalar) e trabalha com vendas em casa",
  job: "Vendas online e digitais em casa pelo celular e computador",
  work: "Trabalho em casa com vendas online e estágio no hospital",
  hobbies: "Filmes de terror e suspense psicológico, doces e chocolates, passeios ao pôr do sol em mirantes",
  music: "Simone Mendes, Henrique & Juliano, Marília Mendonça, Jorge & Mateus e sertanejo romântico/universitário",
  favorite_food: "bife com batata frita (prato favorito: strogonoff)",
  favorite_dish: "strogonoff",
  drinks: "Água, sucos naturais e refrigerante (não consome bebidas alcoólicas; bebe líquido durante as refeições)",
  values: "Moça certinha de família, de igreja, honra pai, mãe e avó",
  dislikes: "Odeia pessoa seca ou respostas monossilábicas, café preto, bebidas alcoólicas, baladas lotadas e barulhentas com bebida jogada, e falta de consideração",
};

let personaMemoryCache: {
  facts: PersonaMemoryFact[];
  expiresAt: number;
} | null = null;
const PERSONA_CACHE_TTL_MS = 60 * 1000;

export function setPersonaMemoryCache(facts: PersonaMemoryFact[], ttlMs: number = PERSONA_CACHE_TTL_MS) {
  personaMemoryCache = {
    facts: [...facts],
    expiresAt: Date.now() + ttlMs,
  };
}

export function clearPersonaMemoryCache() {
  personaMemoryCache = null;
}

export function isTemporalFactActive(fact: PersonaMemoryFact, checkDate: Date = new Date()): boolean {
  if (fact.source_type !== "temporal") return true;
  const t = checkDate.getTime();
  if (fact.valid_from && new Date(fact.valid_from).getTime() > t) return false;
  if (fact.valid_until && new Date(fact.valid_until).getTime() < t) return false;
  return true;
}

export async function loadPersonaMemoryFacts(params: {
  supabase?: any;
  personaId?: string;
  forceRefresh?: boolean;
}): Promise<PersonaMemoryFact[]> {
  const personaId = params.personaId || "larissa";
  const now = Date.now();
  if (
    !params.forceRefresh &&
    personaMemoryCache &&
    personaMemoryCache.expiresAt > now &&
    personaMemoryCache.facts.length > 0
  ) {
    return personaMemoryCache.facts;
  }

  if (params.supabase) {
    try {
      const { data, error } = await params.supabase
        .from("persona_memory")
        .select("*")
        .eq("persona_id", personaId);

      if (!error && Array.isArray(data) && data.length > 0) {
        personaMemoryCache = {
          facts: data as PersonaMemoryFact[],
          expiresAt: now + PERSONA_CACHE_TTL_MS,
        };
        return data as PersonaMemoryFact[];
      }
    } catch (err) {
      console.warn("[PersonaMemory] Falha ao carregar fatos de persona_memory:", err);
    }
  }

  return personaMemoryCache?.facts || [];
}

function stripAccents(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Resolução de fato a partir de coleção com prioridade estrita:
 * canonical (3) > temporal vigente (2) > generated (1)
 */
export function resolveFactFromCollection(
  field: string,
  facts: PersonaMemoryFact[],
  nowDate: Date = new Date()
): PersonaFactResult | null {
  const norm = (field || "").trim().toLowerCase();
  if (!norm) return null;
  const normClean = stripAccents(norm);

  // Busca correspondência direta e exata na chave ou nos aliases (com suporte a acentuação)
  const matchingFacts = facts.filter((f) => {
    const keyNorm = (f.key || "").toLowerCase();
    const keyClean = stripAccents(f.key || "");
    const keyMatch = keyNorm === norm || keyClean === normClean;
    const aliasMatch = Array.isArray(f.aliases) && f.aliases.some((a) => {
      const aNorm = (a || "").toLowerCase();
      const aClean = stripAccents(a || "");
      return aNorm === norm || aClean === normClean;
    });
    return keyMatch || aliasMatch;
  });

  // Filtra vigência temporal
  const activeMatches = matchingFacts.filter((f) => isTemporalFactActive(f, nowDate));
  if (activeMatches.length === 0) return null;

  const priorityWeight = (source: string) => {
    if (source === "canonical") return 3;
    if (source === "temporal") return 2;
    if (source === "generated") return 1;
    return 0;
  };

  activeMatches.sort((a, b) => {
    const pwDiff = priorityWeight(b.source_type) - priorityWeight(a.source_type);
    if (pwDiff !== 0) return pwDiff;
    return (b.confidence || 1) - (a.confidence || 1);
  });

  const best = activeMatches[0];
  return {
    found: true,
    field: best.key,
    value: best.value,
    category: best.category,
    source_type: best.source_type,
    confidence: best.confidence,
    valid_from: best.valid_from,
    valid_until: best.valid_until,
  };
}

export function resolveLegacyFactFallback(field: string): PersonaFactResult {
  const normField = (field || "").trim().toLowerCase();
  if (normField in LARISSA_PERSONA_FACTS) {
    return {
      found: true,
      field: normField,
      value: LARISSA_PERSONA_FACTS[normField],
      source_type: "legacy_fallback",
    };
  }
  if (normField === "idade" || normField === "age" || normField === "identity.age") return { found: true, field: "age", value: LARISSA_PERSONA_FACTS.age, source_type: "legacy_fallback" };
  if (normField === "nascimento" || normField === "aniversario" || normField === "birth_date" || normField === "identity.birth_date") return { found: true, field: "birth_date", value: LARISSA_PERSONA_FACTS.birth_date, source_type: "legacy_fallback" };
  if (normField === "cidade" || normField === "city" || normField === "location.city") return { found: true, field: "city", value: LARISSA_PERSONA_FACTS.city, source_type: "legacy_fallback" };
  if (normField === "bairro" || normField === "neighborhood") return { found: true, field: "neighborhood", value: LARISSA_PERSONA_FACTS.neighborhood, source_type: "legacy_fallback" };
  if (normField === "curso" || normField === "course" || normField === "education.course") return { found: true, field: "course", value: LARISSA_PERSONA_FACTS.course, source_type: "legacy_fallback" };
  if (normField === "periodo" || normField === "college_period" || normField === "education.period") return { found: true, field: "college_period", value: LARISSA_PERSONA_FACTS.college_period, source_type: "legacy_fallback" };
  if (normField === "formatura" || normField === "graduation") return { found: true, field: "graduation", value: LARISSA_PERSONA_FACTS.graduation, source_type: "legacy_fallback" };
  if (normField === "trabalho" || normField === "profissao" || normField === "profession") return { found: true, field: "profession", value: LARISSA_PERSONA_FACTS.profession, source_type: "legacy_fallback" };
  if (normField === "faculdade" || normField === "estudos" || normField === "studies") return { found: true, field: "studies", value: LARISSA_PERSONA_FACTS.studies, source_type: "legacy_fallback" };
  if (normField === "gostos" || normField === "interesses" || normField === "hobbies") return { found: true, field: "hobbies", value: LARISSA_PERSONA_FACTS.hobbies, source_type: "legacy_fallback" };

  return { found: false, field: normField, value: null };
}

/**
 * Função síncrona retrocompatível para testes e consumidores locais
 */
export function getPersonaFact(
  field: string,
  options?: { now?: Date | string; cachedFacts?: PersonaMemoryFact[] }
): PersonaFactResult {
  const checkDate = options?.now ? new Date(options.now) : new Date();
  const facts = options?.cachedFacts || personaMemoryCache?.facts || [];

  if (facts.length > 0) {
    const resolved = resolveFactFromCollection(field, facts, checkDate);
    if (resolved) return resolved;
  }

  return resolveLegacyFactFallback(field);
}

/**
 * Resolução assíncrona principal: consulta Supabase persona_memory com prioridade estrita e fallback
 */
export async function resolvePersonaFact(
  field: string,
  options?: {
    supabase?: any;
    personaId?: string;
    now?: Date | string;
    cachedFacts?: PersonaMemoryFact[];
  }
): Promise<PersonaFactResult> {
  const checkDate = options?.now ? new Date(options.now) : new Date();
  let facts = options?.cachedFacts || [];

  if (facts.length === 0) {
    facts = await loadPersonaMemoryFacts({
      supabase: options?.supabase,
      personaId: options?.personaId,
    });
  }

  if (facts.length > 0) {
    const resolved = resolveFactFromCollection(field, facts, checkDate);
    if (resolved) return resolved;

    // Se a chave exata existe na memória mas está expirada temporalmente, respeita a expiração e cai para legacy_fallback
    const norm = (field || "").trim().toLowerCase();
    const isExactExpiredKey = facts.some((f) => {
      const keyNorm = (f.key || "").toLowerCase();
      return keyNorm === norm && !isTemporalFactActive(f, checkDate);
    });

    if (!isExactExpiredKey) {
      // Fallback inteligente resiliente para chaves com variação sintática (ex: "music.favorite_singer", "education.disliked_subject")
      const cleanFieldQuery = (field || "").replace(/[._]/g, " ").trim();
      const searchMatches = await searchPersonaMemory({
        query: cleanFieldQuery,
        limit: 1,
        now: checkDate,
        cachedFacts: facts,
      });
      if (searchMatches.length > 0 && searchMatches[0].score >= 12) {
        const top = searchMatches[0];
        return {
          found: true,
          field: top.key,
          value: top.value,
          category: top.category,
          source_type: top.source_type,
          confidence: 0.95,
        };
      }
    }
  }

  return resolveLegacyFactFallback(field);
}

/**
 * Ferramenta persona_search(query, limit = 8) para busca textual/semântica sob demanda
 */
export async function searchPersonaMemory(params: {
  supabase?: any;
  personaId?: string;
  query: string;
  limit?: number;
  now?: Date | string;
  cachedFacts?: PersonaMemoryFact[];
}): Promise<Array<{
  key: string;
  category: string;
  value: any;
  source_type: string;
  score: number;
}>> {
  const { supabase, query } = params;
  const personaId = params.personaId || "larissa";
  const limit = Math.min(Math.max(params.limit || 8, 1), 20);
  const checkDate = params.now ? new Date(params.now) : new Date();

  let facts = params.cachedFacts || [];
  if (facts.length === 0) {
    facts = await loadPersonaMemoryFacts({ supabase, personaId });
  }

  // Se o Supabase estiver sem fatos (ex: teste local puro), usa chaves do fallback legado
  if (facts.length === 0) {
    facts = Object.entries(LARISSA_PERSONA_FACTS).map(([k, v]) => ({
      persona_id: personaId,
      category: "geral",
      key: k,
      value: v,
      source_type: "canonical" as const,
      confidence: 1.0,
      aliases: [k],
      valid_from: null,
      valid_until: null,
    }));
  }

  const rawTerms = (query || "")
    .toLowerCase()
    .replace(/[^\w\sáéíóúâêîôûãõç]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (rawTerms.length === 0) {
    return [];
  }

  const SYNONYM_MAP: Record<string, string[]> = {
    singer: ["cantora", "cantor", "artista"],
    singers: ["cantoras", "cantores", "artistas"],
    subject: ["materia", "disciplina"],
    subjects: ["materias", "disciplinas"],
    disliked: ["menos gosta", "odeia", "chata", "dislikes"],
    dislikes: ["menos gosta", "odeia", "chata"],
    hardest: ["dificil", "sofreu", "dificuldade"],
    easiest: ["facil", "tranquila"],
    food: ["comida", "prato", "comer"],
    dish: ["prato", "comida"],
    drink: ["bebida", "beber", "bebe"],
    drinks: ["bebidas", "beber", "bebe", "alcool"],
    alcohol: ["alcool", "bebida", "cerveja", "vinho"],
    movie: ["filme", "cinema"],
    movies: ["filmes", "cinema"],
    music: ["musica", "estilo musical", "gosto musical", "cantora", "cantor"],
    city: ["cidade", "onde mora", "onde nasceu"],
    neighborhood: ["bairro", "matosinhos", "mora"],
    period: ["periodo", "semestre"],
    course: ["curso", "faculdade", "enfermagem"],
    graduation: ["formatura", "formar", "forma"],
  };

  const searchTermsSet = new Set<string>(rawTerms);
  for (const t of rawTerms) {
    const tClean = stripAccents(t);
    if (SYNONYM_MAP[tClean]) {
      for (const syn of SYNONYM_MAP[tClean]) {
        for (const part of syn.split(/\s+/)) {
          if (part.length >= 2) searchTermsSet.add(stripAccents(part));
        }
      }
    }
  }
  const searchTerms = Array.from(searchTermsSet);

  const scored: Array<{
    key: string;
    category: string;
    value: any;
    source_type: string;
    score: number;
  }> = [];

  for (const fact of facts) {
    if (!isTemporalFactActive(fact, checkDate)) {
      continue;
    }

    let score = 0;
    const factKey = (fact.key || "").toLowerCase();
    const factCategory = (fact.category || "").toLowerCase();
    const factValStr =
      typeof fact.value === "string" ? fact.value.toLowerCase() : JSON.stringify(fact.value).toLowerCase();
    const factAliases = (fact.aliases || []).map((a) => (a || "").toLowerCase());

    for (const term of searchTerms) {
      if (factKey === term) score += 10;
      else if (factKey.includes(term)) score += 5;

      for (const alias of factAliases) {
        if (alias === term) score += 8;
        else if (alias.includes(term)) score += 4;
      }

      if (factCategory === term) score += 6;
      else if (factCategory.includes(term)) score += 3;

      if (factValStr.includes(term)) score += 3;
    }

    const fullQueryClean = stripAccents(query || "");
    for (const alias of factAliases) {
      const aliasClean = stripAccents(alias);
      if (aliasClean === fullQueryClean) score += 20;
      else if (fullQueryClean.length > 3 && (fullQueryClean.includes(aliasClean) || aliasClean.includes(fullQueryClean))) score += 12;
    }

    const narrativeKeywords = ["historia", "perrengue", "aconteceu", "lembra", "porque", "por que", "motivacao", "experiencia", "sofreu", "dificil", "dificuldade"];
    const isNarrativeQuery = narrativeKeywords.some((w) => fullQueryClean.includes(w));
    if (isNarrativeQuery && (factCategory === "stories" || factCategory === "education")) {
      score += 10;
    }

    if (score > 0) {
      if (fact.source_type === "canonical") score += 2;
      else if (fact.source_type === "temporal") score += 1;

      scored.push({
        key: fact.key,
        category: fact.category,
        value: fact.value,
        source_type: fact.source_type,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ----------------------------------------------------------------------------
// Busca Semântica na Biblioteca de Áudios da Larissa
// ----------------------------------------------------------------------------
export async function searchPersonaAudios(params: {
  supabase: any;
  conversationId: string;
  intent: string;
  stageId?: string;
}): Promise<Array<PersonaAudioAsset & { alreadySentInConversation: boolean }>> {
  const { supabase, conversationId, intent, stageId } = params;
  let audios: PersonaAudioAsset[] = [];

  try {
    const { data: row } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__persona_audios__")
      .maybeSingle();

    if (row?.stage_completed_rules?.audios && Array.isArray(row.stage_completed_rules.audios)) {
      audios = row.stage_completed_rules.audios;
    }
  } catch {}

  if (audios.length === 0 && (supabase as any)?.__mockPersonaAudios) {
    audios = (supabase as any).__mockPersonaAudios;
  }

  let sentAudioIds = new Set<string>();
  try {
    const { data: histRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__audio_history__")
      .maybeSingle();

    const histList: AudioDeliveryHistory[] = histRow?.stage_completed_rules?.history || [];
    histList
      .filter((h) => h.conversationId === conversationId)
      .forEach((h) => sentAudioIds.add(h.audioId));
  } catch {}

  if ((supabase as any)?.__mockAudioHistory) {
    const mockHist: AudioDeliveryHistory[] = (supabase as any).__mockAudioHistory;
    mockHist
      .filter((h) => h.conversationId === conversationId)
      .forEach((h) => sentAudioIds.add(h.audioId));
  }

  const queryTerms = (intent || "").toLowerCase().split(/\s+/).filter(Boolean);

  const matched = audios
    .filter((a) => a.enabled !== false)
    .filter((a) => {
      if (stageId && a.stageId && a.stageId !== stageId) {
        return false;
      }
      return true;
    })
    .map((a) => {
      const searchHaystack = `${a.title || ""} ${a.transcript || ""} ${a.usageInstruction || ""}`.toLowerCase();
      let matchScore = 0;
      for (const term of queryTerms) {
        if (searchHaystack.includes(term)) {
          matchScore += 1;
        }
      }
      const alreadySent = sentAudioIds.has(a.id);
      return {
        ...a,
        matchScore,
        alreadySentInConversation: alreadySent,
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
    const { data: row } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__audio_history__")
      .maybeSingle();

    const currentHistory: AudioDeliveryHistory[] = row?.stage_completed_rules?.history || [];
    const newEntry: AudioDeliveryHistory = {
      id: `adh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      audioId,
      sentAt: new Date().toISOString(),
      providerMessageId,
    };
    currentHistory.push(newEntry);

    await supabase
      .from("instagram_conversations")
      .upsert({
        id: "__audio_history__",
        stage_completed_rules: {
          history: currentHistory,
          updated_at: new Date().toISOString(),
        },
      });

    if ((supabase as any)?.__mockAudioHistory) {
      (supabase as any).__mockAudioHistory.push(newEntry);
    }
  } catch (err) {
    console.warn("[Orchestrator] Falha ao gravar histórico de áudio:", err);
  }
}

export function buildDescobertaPrompt(input: SubagentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_pergunta_sobre_ele"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  return `Você é a subagente especialista em DESCOBERTA da Larissa (23 anos, moça meiga de Minas Gerais).
Seu objetivo é conduzir um diálogo afetuoso, recíproco e natural para conhecer quem o pretendente é.

### DIRETRIZES DA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Aplique a Regra da Reciprocidade: conte algo breve sobre você (estuda enfermagem, mora em São João del Rei, trabalha com vendas em casa).
- Tom: meigo, carinhoso, mineiro natural (usando 'né', 'kkk', 'vc', 'tô', 'tá', 'pra').
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Uma pergunta leve por vez, sem interrogatório. Balão curto de celular.
- REGRA INVIOLÁVEL DE 'UAI' (RARO E OPCIONAL): O 'uai' é estritamente OPCIONAL e MUITO RARO (use no máximo em 1 a cada 15 falas). Na dúvida, NUNCA use 'uai'. A mineiridade natural da Larissa vem de "vc", "tô", "tá", "né", "pra", pelo ritmo acolhedor e humor, NUNCA carimbando 'uai'. Se puder falar sem 'uai', prefira SEMPRE sem 'uai'.
- DIRETRIZ DE FECHAMENTO (ZERO PERGUNTA MECÂNICA): NÃO termine toda fala devolvendo pergunta ("e você?", "e vc?", "você costuma...?"). Em conversas reais, a Larissa com frequência apenas responde afirmando, comentando, fazendo deboche meigo ou rindo (ex: "bife com batata frita fácil kkk", "Simone Mendes fácil kkk", "sou moça de família rapaz kkk", "Matosinhos kkk"). Só faça pergunta se houver motivo real ou curiosidade genuína (em no máximo 20% a 30% das falas). Na dúvida, termine sem pergunta.
- PROIBIÇÃO DE TOOLS EM SAUDAÇÕES E EMPATIA: Para cumprimentos comuns ("oi", "tudo bem?", "boa noite", "oie"), risadas ("kkkk") ou reações de empatia ("nossa deve ser puxado mesmo"), É TERMINANTEMENTE PROIBIDO chamar ferramentas (nem persona_audio_search, nem persona_get_fact, nem persona_search). Responda DIRETO em texto com action: "reply".
- ESTILO NUNCA SOBRESCREVE FATO: Ser meiga não autoriza transformar desgostos ou matérias difíceis em algo positivo. A matéria mais difícil/que mais sofreu foi Embriologia e a que não gosta é Farmacologia. Responda com sinceridade humana e bom humor, sem dizer que gosta de tudo.
- INTERPRETAÇÃO RIGOROSA DE BOOLEANOS (false): Fatos com value: false significam CATEGORICAMENTE que a Larissa NÃO GOSTA, NÃO BEBE, NÃO CONSOME e NÃO ASSISTE. Jamais diga que gosta "às vezes" ou "de vez em quando". Se for false, ela afirma com naturalidade que não bebe / não curte / não gosta.

### REGRAS DE OURO DOS OBJETIVOS SEMÂNTICOS (BÚSSOLA DE CONVERSA)
1. Os objetivos da etapa são uma **BÚSSOLA DE ORIENTAÇÃO** para a conversa, **NUNCA UM INTERROGATÓRIO**.
2. **Máximo 1 pergunta leve por turno**: Jamais dispare múltiplas perguntas ou perguntas em sequência se ele não respondeu.
3. Responda e acolha com afeto o que o pretendente acabou de falar ANTES de qualquer pergunta.
4. Se o pretendente mudou de assunto, fez outra pergunta ou ignorou sua curiosidade anterior, **NÃO INSISTA**; acompanhe o fluxo dele com naturalidade.
5. Se ele já informou espontaneamente algo (ex: cidade, idade ou trabalho), registre como conhecido e **NÃO PERGUNTE DE NOVO**.
6. Você decide organicamente qual tópico abordar ou se neste turno deve apenas acolher sem fazer pergunta alguma.
7. PRIORIDADE DE LOOKUP DIRETO SOBRE VOCÊ:
   - Atributos pontuais identificáveis (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta) -> chame OBRIGATORIAMENTE persona_get_fact com o campo específico. NUNCA use persona_search quando lookup exato resolve.
   - "qual período vc tá?" refere-se estritamente ao período acadêmico da faculdade (10º período), NUNCA ao turno ou horário ("noturno").
   - "mora onde em São João?" refere-se ao bairro (Matosinhos). Não responda genericamente "parte quietinha".
   - Perguntas abertas ou histórias ("qual perrengue passou?", "o que te motiva?") -> use persona_search.
   - persona_audio_search só deve ser acionado se o usuário pedir áudio explicitamente ou em momentos gravados no cofre.

### CONTEXTO DA CONVERSA
${contextBlock}

### FERRAMENTAS DISPONÍVEIS SOB DEMANDA
Trabalhe primeiro apenas com o contexto recebido.
Se precisar checar fatos já descobertos, consultar objetivos ou buscar dados sobre a Larissa:
- stage_objectives_get (ou checklist_get_stage_state): consulta o estado atual dos objetivos da fase (quais tópicos estão 'completed' ou 'pending'). Ex: {"action": "call_tool", "tool": "stage_objectives_get", "parameters": {"stage": "descoberta"}}
- persona_get_fact: consulta fato pontual sobre a Larissa (idade, cidade, bairro, curso, período acadêmico, formatura, comida favorita, prato favorito, cantora favorita, matéria mais difícil, matéria que não gosta). Ex: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}
- persona_search: busca aberta para histórias, perrengues, motivos ou narrativas da Larissa. Ex: {"action": "call_tool", "tool": "persona_search", "parameters": {"query": "perrengue faculdade moto chuva"}}
- memory_get_fact: consulta fatos estruturados sobre o pretendente (ContactMemory). Ex: {"action": "call_tool", "tool": "memory_get_fact", "parameters": {"entity": "self", "field": "age" | "city" | "job"}}
- memory_search: busca aberta por trechos relevantes sobre o pretendente. Ex: {"action": "call_tool", "tool": "memory_search", "parameters": {"entity": "self", "query": "..."}}

Regras de Uso de Ferramentas:
- PRIORIDADE ABSOLUTA DE FATOS: PersonaMemory canônica (persona_get_fact / persona_search) > contexto da conversa. Exemplos externos servem APENAS para estilo coloquial, NUNCA para inventar ou sobrescrever fatos pessoais da Larissa.
- Não consulte ferramentas por curiosidade ou se o contexto atual já for suficiente. Em saudações triviais, NUNCA chame ferramentas.
- A Larissa NUNCA tem os fatos do pretendente e o pretendente NUNCA tem os fatos da Larissa.
- Para acionar ferramenta, responda em JSON compacto: {"action": "call_tool", "tool": "persona_get_fact", "parameters": {"field": "education.current_period"}}

### CHECKPOINTS DESTA FASE
- 'chk_pergunta_sobre_ele': Perguntou sobre trabalho, rotina ou hobbies dele com reciprocidade.
- 'chk_troca_cidade': Falou/perguntou sobre cidade ou moradia.

Responda ESTRITAMENTE em JSON puro, compacto e sem explicações longas de raciocínio:
{
  "action": "reply",
  "checkpoint": "chk_pergunta_sobre_ele" | "chk_troca_cidade",
  "summary": "resumo de 3 palavras",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "descoberta"
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
}

/**
 * Provedor Oficial de Nuvem via Supabase (JSONB persistente em stage_completed_rules.orchestration.memory)
 */
export class SupabaseMemoryProvider implements MemoryProvider {
  constructor(private supabase: any) {}

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
    const { store } = await this.getStore(contactId);
    const normEntity = (entity || "self").toLowerCase().trim();
    const normField = (field || "").toLowerCase().trim();
    const fact = store.entities?.[normEntity]?.[normField];
    if (fact) {
      return { found: true, fact, value: fact.value };
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
// 8. Helper de Invocação de Modelo (Runtime Mock ou Atria-Dawn-Preview)
// ----------------------------------------------------------------------------
async function callModelOrAtria(
  prompt: string,
  options: {
    runtime?: { callModel?: (prompt: string) => Promise<{ content: string; tokens?: number }> };
    supabase: any;
  }
): Promise<{ content: string; tokens: number }> {
  if (options.runtime?.callModel) {
    const res = await options.runtime.callModel(prompt);
    return { content: res.content, tokens: res.tokens || 0 };
  }

  // Motor Oficial Atria (Atria-Dawn-Preview / api.atria-asi.ai)
  let atriaKey = (Deno?.env?.get?.("ATRIA_API_KEY") || "").trim();
  if (!atriaKey) {
    const { data: cfgSecret } = await options.supabase
      .from("instagram_config")
      .select("app_secret")
      .eq("id", "atria_api_key")
      .maybeSingle();
    atriaKey = (cfgSecret?.app_secret || "").trim();
  }
  if (!atriaKey) {
    throw new Error("Chave de API da Atria (atria_api_key) não configurada.");
  }

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
  });

  if (!atriaRes.ok) {
    throw new Error(`Atria retornou erro HTTP ${atriaRes.status}: ${await atriaRes.text()}`);
  }

  const jsonRes = await atriaRes.json();
  const choice = jsonRes.choices?.[0];
  const content = choice?.message?.content || "";
  const tokens = jsonRes.usage?.total_tokens || 0;

  if (!content) {
    console.error(
      `[Orchestrator] Atria retornou content vazio! finish_reason=${choice?.finish_reason}, tokens=${JSON.stringify(jsonRes.usage)}`
    );
    if (choice?.message?.reasoning_content) {
      console.log(`[Orchestrator] reasoning_content da Atria (${choice.message.reasoning_content.length} chars): ${choice.message.reasoning_content.slice(0, 300)}...`);
    }
  }

  return { content, tokens };
}

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
  memoryProvider?: MemoryProvider;
  runtime?: {
    sendMetaTextMessage?: (supabase: any, conversationId: string, text: string) => Promise<any>;
    callModel?: (prompt: string) => Promise<{ content: string; tokens?: number }>;
    memoryProvider?: MemoryProvider;
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

  // 3. BACKEND DETERMINÍSTICO: Lock Atômico concorrente
  const activeLock = stageRules.active_cycle_token;
  const activeLockAt = stageRules.active_cycle_at ? Date.parse(stageRules.active_cycle_at) : 0;
  if (activeLock && Date.now() - activeLockAt < 25000 && activeLock !== correlationId) {
    console.log(
      `[Orchestrator] Lock ativo detectado (${activeLock}) para ${conversationId}. Abortando execução concorrente.`
    );
    return { mode: orchState.mode, handled: false, sentToMeta: false, blockLegacyFallback: true, error: "Lock ativo concorrente" };
  }

  // Adquire o lock
  await supabase
    .from("instagram_conversations")
    .update({
      stage_completed_rules: {
        ...stageRules,
        active_cycle_token: correlationId,
        active_cycle_at: new Date().toISOString(),
      },
    })
    .eq("id", conversationId);

  let claimedMessageIds: string[] = [];
  let sentSuccessfully = false;
  const ledger: Record<string, MessageProcessingStatus> = { ...(orchState.messageLedger || {}) };
  const outboxMap: Record<string, OutboxEntry> = { ...(orchState.outbox || {}) };

  try {
    // 4. BACKEND DETERMINÍSTICO: Cancelamento e checagem de pausa pelo operador
    if (stageRules.cancel_current_cycle === true || stageRules.status === "paused_manual") {
      console.log(`[Orchestrator] Ciclo cancelado pelo operador para ${conversationId}.`);
      await supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...stageRules,
            active_cycle_token: null,
            cancel_current_cycle: null,
          },
        })
        .eq("id", conversationId);
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
          // Nota: Não interrompe ao encontrar mensagem processada. O ledger é a fonte
          // da verdade e todas as pendentes da conversa devem ser coletadas, mesmo que
          // existam inbounds intercaladas ou processadas anteriormente.
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
      return { mode: orchState.mode, handled: true, skippedDuplicate: true, blockLegacyFallback: true };
    }

    // SNAPSHOT IMUTÁVEL DO CICLO: Claims all pending messages
    claimedMessageIds = pendingMessages.map((m) => m.id);
    const claimedMessages = pendingMessages.map((m) => ({
      ...m,
      status: "claimed" as MessageProcessingStatus,
      claimedByCycleId: correlationId,
    }));

    for (const id of claimedMessageIds) {
      ledger[id] = "claimed";
    }

    // Persiste imediatamente o claim e o ledger no banco de dados para que ciclos concorrentes
    // saibam que estas mensagens já estão sob custódia deste ciclo
    await supabase
      .from("instagram_conversations")
      .update({
        stage_completed_rules: {
          ...stageRules,
          active_cycle_token: correlationId,
          active_cycle_at: new Date().toISOString(),
          orchestration: {
            ...orchState,
            messageLedger: ledger,
            lastProcessingStatus: "processing",
          },
        },
      })
      .eq("id", conversationId);

    const initialInboundRevision =
      typeof orchState.inboundRevision === "number" ? orchState.inboundRevision : 0;

    const currentCycle: ProcessingCycle = {
      cycleId: correlationId,
      conversationId,
      claimedMessageIds,
      startedAt: new Date().toISOString(),
      status: "in_progress",
      agentVersions: {
        router: "1.2.0",
        subagent: "1.2.0",
        prompt: "1.2.0",
      },
      inputWatermark: {
        revision: initialInboundRevision,
        claimedCount: claimedMessageIds.length,
        snapshotTimestamp: new Date().toISOString(),
      },
      trace: [
        `cycle_started: ${correlationId}`,
        `input_watermark: rev=${initialInboundRevision}, count=${claimedMessageIds.length}`,
        `messages_claimed: ${claimedMessageIds.length}`,
      ],
    };

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

      // Checa atomicamente se o lock ainda pertence a este ciclo antes de qualquer mutação
      const { data: convCheck } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", conversationId)
        .maybeSingle();

      const latestRules = convCheck?.stage_completed_rules || stageRules;
      const latestToken = latestRules.active_cycle_token;

      // Se outro ciclo já assumiu o lock (ex: stale lock roubado por worker B), aborta sem sobrescrever o banco
      if (latestToken && latestToken !== correlationId) {
        console.warn(
          `[Orchestrator] Ciclo ${correlationId} perdeu o lock para ${latestToken}. Abortando preempção sem sobrescrever estado.`
        );
        return {
          mode: orchState.mode,
          handled: false,
          sentToMeta: false,
          blockLegacyFallback: true,
          error: `Ciclo preemptado por perda de lock para ciclo concorrente (${latestToken})`,
        };
      }

      const latestOrch = latestRules.orchestration || orchState;
      const mergedLedger = { ...(latestOrch.messageLedger || {}), ...ledger };

      await supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...latestRules,
            active_cycle_token: null,
            ai_auto_respond: true,
            ai_debounce_until: new Date(Date.now() + 2500).toISOString(),
            orchestration: {
              ...latestOrch,
              messageLedger: mergedLedger,
              lastProcessingStatus: "idle",
              recentCycles: [currentCycle, ...(latestOrch.recentCycles || [])].slice(0, 5),
            },
          },
        })
        .eq("id", conversationId);

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

    // ACK ATÔMICO REVISION-AWARE DE PREEMPÇÃO:
    // Reconhece atomicamente a preempção do ciclo anterior e limpa as flags preempt_requested
    // SOMENTE se nenhuma nova mensagem tiver chegado após o snapshot (inboundRevision bate).
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
      const newerCount = (ackRes.currentRevision || initialInboundRevision + 1) - initialInboundRevision;
      return await handleCyclePreemption("during_cycle_initialization", {
        isFresh: false,
        newerInboundCount: newerCount,
        newerInboundIds: [],
        reason: "newer_revision_detected",
      });
    } else if (ackRes.reason === "cycle_token_mismatch") {
      console.warn(
        `[Orchestrator] Ciclo ${correlationId} perdeu a custódia antes do início em ${conversationId}. Abortando.`
      );
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: false,
        blockLegacyFallback: true,
        error: `Ciclo preemptado por perda de custódia inicial`,
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
    // CAMADA 1: AGENTE DA CONVERSA (ROTEADOR DE DECISÃO)
    // ------------------------------------------------------------------------
    const routingPrompt = buildConversationAgentPrompt({
      conversationId,
      currentPhase,
      checkpoint: currentCheckpoint,
      contextText: routerContextText,
      newMessage,
    });

    const routingRes = await callModelOrAtria(routingPrompt, { runtime, supabase });
    totalTokens += routingRes.tokens;
    const rawRoutingJson = extractJsonFromText(routingRes.content);
    const routingDecision = validateRoutingDecision(rawRoutingJson, currentPhase);
    currentCycle.trace.push(`agent_routed: ${routingDecision.targetSubagent}`);

    // ------------------------------------------------------------------------
    // FRESHNESS GATE 1: Revalidação imediatamente após o ConversationAgent
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

    let finalSubDecision: SubagentDecision;

    if (routingDecision.action === "wait" || routingDecision.targetSubagent === "none") {
      finalSubDecision = {
        action: "wait",
        checkpoint: currentPhase === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita",
        summary: `Aguardando pretendente: ${routingDecision.reason}`,
        suggestedResponse: "",
        nextPhase: currentPhase,
        reasoning: routingDecision.reason,
        requiredTools: [],
      };
      currentCycle.trace.push("subagent_action: wait");
    } else {
      const targetSubagent = routingDecision.targetSubagent;
      let subagentPrompt = "";

      if (targetSubagent === "descoberta") {
        subagentPrompt = buildDescobertaPrompt({
          conversationId,
          currentPhase: "descoberta",
          checkpoint: "chk_pergunta_sobre_ele",
          contextText: descobertaContextText,
          newMessage,
        });
      } else {
        subagentPrompt = buildConexaoInicialPrompt({
          conversationId,
          currentPhase: "conexao_inicial",
          checkpoint: "chk_saudacao_feita",
          contextText: conexaoContextText,
          newMessage,
        });
      }

      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "atria",
          orchState.mode === "shadow" ? "Subagente (Shadow)" : `Subagente: ${targetSubagent}`,
          `Formulando resposta na fase ${targetSubagent}...`,
          {
            atriaThought: `Executando diretrizes do subagente ${targetSubagent}...`,
            mode: orchState.mode,
            currentPhase,
          }
        ),
      });

      const MAX_TOOL_ITERATIONS = 3;
      let toolCallsCount = 0;
      let currentSubagentPrompt = subagentPrompt;
      let lastToolResultForFinalCall: any = null;

      while (toolCallsCount < MAX_TOOL_ITERATIONS) {
        // Freshness Gate intra-loop: Se nova mensagem chegou enquanto o subagente consultava memória, preempta imediatamente
        if (toolCallsCount > 0) {
          const freshnessInToolLoop = await checkFreshnessGate({
            supabase,
            conversationId,
            claimedMessageIds,
            cycleStartedAt: currentCycle.startedAt,
            initialInboundRevision,
          });

          if (!freshnessInToolLoop.isFresh) {
            return await handleCyclePreemption("during_subagent_tool_loop", freshnessInToolLoop);
          }
        }

        const subRes = await callModelOrAtria(currentSubagentPrompt, { runtime, supabase });
        totalTokens += subRes.tokens;
        const rawSubJson = extractJsonFromText(subRes.content);

        // Verifica se o subagente solicitou ferramenta de memória sob demanda
        if (
          rawSubJson &&
          (rawSubJson.action === "call_tool" || rawSubJson.action === "tool_call" || rawSubJson.tool)
        ) {
          toolCallsCount++;
          const toolName = String(rawSubJson.tool || rawSubJson.name || "memory_get_fact").trim();
          const toolParams = rawSubJson.parameters || rawSubJson.params || rawSubJson.arguments || {};
          const toolEntity = String(toolParams.entity || "self").trim();
          const toolField = String(toolParams.field || "").trim();

          currentCycle.trace.push(
            toolName === "stage_objectives_get" || toolName === "checklist_get_stage_state"
              ? `checklist_tool_requested: ${toolParams.stage || currentPhase}`
              : toolName === "persona_audio_search"
              ? `persona_audio_search_requested: ${toolParams.intent || toolParams.query}`
              : toolName === "persona_get_fact"
              ? `persona_fact_requested: ${toolParams.field || toolField}`
              : toolName === "persona_search"
              ? `persona_search_requested: ${toolParams.query || toolParams.intent || ""}`
              : `memory_tool_requested: ${toolEntity}.${toolField || toolParams.query || toolName}`
          );
          const tStart = Date.now();

          let toolResult: any;
          if (toolName === "stage_objectives_get" || toolName === "checklist_get_stage_state") {
            const requestedStage = String(toolParams.stage || currentPhase).trim();
            // BACKEND-BOUND SECURITY: O conversationId é injetado pelo runtime, ignorando qualquer valor externo
            const completedGoalIds = (orchState as any).completedGoalIds || stageRules.completed_goals || [];
            const stageChecklist = await resolveStageObjectives({
              supabase,
              conversationId, // Backend-bound estrito
              stageNameOrId: requestedStage,
              memoryProvider,
              completedGoalIds,
            });

            toolResult = {
              tool: toolName,
              stage: stageChecklist.stage,
              goals: stageChecklist.goals,
              objectives: stageChecklist.objectives,
            };
          } else if (toolName === "persona_audio_search") {
            const intent = String(toolParams.intent || toolParams.query || "").trim();
            const stageId = toolParams.stageId || toolParams.stage;
            const results = await searchPersonaAudios({
              supabase,
              conversationId, // Backend-bound estrito
              intent,
              stageId,
            });

            toolResult = {
              tool: "persona_audio_search",
              found: results.length > 0,
              audios: results,
            };
          } else if (toolName === "persona_get_fact") {
            const fieldToQuery = String(toolParams.field || toolField || "").trim();
            const pFact = await resolvePersonaFact(fieldToQuery, { supabase, personaId: "larissa" });

            toolResult = {
              tool: "persona_get_fact",
              found: pFact.found,
              field: pFact.field,
              value: pFact.value,
              category: pFact.category,
              source_type: pFact.source_type,
            };
          } else if (toolName === "persona_search") {
            const query = String(toolParams.query || toolParams.intent || "").trim();
            const limit = typeof toolParams.limit === "number" ? toolParams.limit : 8;
            const results = await searchPersonaMemory({
              supabase,
              personaId: "larissa",
              query,
              limit,
            });

            toolResult = {
              tool: "persona_search",
              found: results.length > 0,
              query,
              results,
            };
          } else if (toolName === "memory_search") {
            const query = String(toolParams.query || "").trim();
            const results = await memoryProvider.searchMemory(conversationId, query, {
              entity: toolEntity,
              limit: 3,
            });
            toolResult = {
              tool: "memory_search",
              found: results.length > 0,
              results,
            };
          } else {
            // memory_get_fact (ContactMemory do pretendente)
            const res = await memoryProvider.getFact(conversationId, toolEntity, toolField);
            toolResult = {
              tool: "memory_get_fact",
              found: res.found,
              entity: toolEntity,
              field: toolField,
              value: res.found ? res.fact?.value : null,
              sourceMessageId: res.found ? res.fact?.sourceMessageId : undefined,
            };
          }

          const toolDuration = Date.now() - tStart;
          currentCycle.trace.push(
            toolName === "stage_objectives_get" || toolName === "checklist_get_stage_state"
              ? `checklist_tool_goals_count: ${toolResult.goals?.length || 0}`
              : toolName === "persona_audio_search"
              ? `persona_audio_count: ${toolResult.audios?.length || 0}`
              : toolName === "persona_get_fact"
              ? `persona_fact_found: ${toolResult.found}`
              : toolName === "persona_search"
              ? `persona_search_count: ${toolResult.results?.length || 0}`
              : `memory_tool_found: ${toolResult.found}`
          );
          currentCycle.trace.push(`tool_duration_ms: ${toolDuration}`);
          lastToolResultForFinalCall = toolResult;

          if (toolCallsCount >= MAX_TOOL_ITERATIONS) {
            // Atingiu o limite de 3 chamadas de ferramentas. Interrompe o loop para a chamada final obrigatória sem ferramentas.
            break;
          }

          currentSubagentPrompt = `${subagentPrompt}

### RETORNO DA CONSULTA DE FERRAMENTA (Tool Call #${toolCallsCount})
\`\`\`json
${JSON.stringify(toolResult, null, 2)}
\`\`\`

Agora prossiga e gere sua resposta final em JSON:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "checkpoint": "${targetSubagent === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita"}",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente (ou observação do áudio)",
  "nextPhase": "${targetSubagent}",
  "reasoning": "análise analítica da resposta"
}`;
          continue;
        }

        // Subagente retornou resposta final
        finalSubDecision = validateSubagentDecision(rawSubJson, currentPhase);
        currentCycle.trace.push(`subagent_executed: ${targetSubagent}`);
        break;
      }

      // Se atingiu o limite de chamadas de ferramenta sem resposta final:
      // Executa UMA chamada final obrigatória de resposta ao modelo com ferramentas desabilitadas
      if (!finalSubDecision) {
        currentCycle.trace.push("tool_loop_limit_reached_final_call");

        // Freshness Gate antes da chamada final obrigatória
        const freshnessBeforeFinalCall = await checkFreshnessGate({
          supabase,
          conversationId,
          claimedMessageIds,
          cycleStartedAt: currentCycle.startedAt,
          initialInboundRevision,
        });

        if (!freshnessBeforeFinalCall.isFresh) {
          return await handleCyclePreemption("during_subagent_tool_loop_final_call", freshnessBeforeFinalCall);
        }

        const finalCallPrompt = `${subagentPrompt}

### RETORNO DA CONSULTA DE MEMÓRIA
\`\`\`json
${JSON.stringify(lastToolResultForFinalCall || {}, null, 2)}
\`\`\`

AVISO OBRIGATÓRIO:
Não solicite mais ferramentas. Responda agora com o que sabe e não invente fatos.
Gere sua resposta final estritamente no formato JSON abaixo:
{
  "action": "reply" | "send_audio",
  "audioId": "id_do_audio_se_send_audio",
  "checkpoint": "${targetSubagent === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita"}",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente (ou observação do áudio)",
  "nextPhase": "${targetSubagent}",
  "reasoning": "análise analítica da resposta"
}`;

        try {
          const finalRes = await callModelOrAtria(finalCallPrompt, { runtime, supabase });
          totalTokens += finalRes.tokens;
          const rawFinalJson = extractJsonFromText(finalRes.content);
          if (
            rawFinalJson &&
            rawFinalJson.action !== "call_tool" &&
            rawFinalJson.action !== "tool_call" &&
            !rawFinalJson.tool
          ) {
            const validated = validateSubagentDecision(rawFinalJson, currentPhase);
            if (validated.suggestedResponse || validated.action === "wait" || validated.action === "send_audio" || validated.audioId) {
              finalSubDecision = validated;
              currentCycle.trace.push(`tool_loop_final_call_success: ${finalSubDecision.action}`);
            }
          }
        } catch (finalCallErr: any) {
          currentCycle.trace.push(`tool_loop_final_call_err: ${finalCallErr.message || String(finalCallErr)}`);
        }

        // Se ainda assim a resposta final for inválida, não parsear ou falhar:
        // O subagente falha de forma segura: action: "wait", suggestedResponse: ""
        // e ZERO mensagem inventada pelo backend.
        if (!finalSubDecision) {
          currentCycle.trace.push("tool_loop_exhausted_safe_wait");
          finalSubDecision = {
            action: "wait",
            checkpoint: currentPhase === "descoberta" ? "chk_pergunta_sobre_ele" : "chk_saudacao_feita",
            summary: "Tool loop finalizado sem resposta válida do modelo; adotando wait seguro",
            suggestedResponse: "",
            nextPhase: currentPhase,
            reasoning: "Subagente atingiu o limite de consultas de ferramentas sem gerar resposta válida do modelo",
            requiredTools: [],
          };
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

    const decision: OrchestratorDecision = {
      action: finalSubDecision.action,
      currentPhase,
      nextPhase: validatedNextPhase,
      checkpoint: finalSubDecision.checkpoint,
      summary: finalSubDecision.summary,
      suggestedResponse: finalSubDecision.suggestedResponse,
      requiredTools: finalSubDecision.requiredTools || ["send_text"],
      reasoning: finalSubDecision.reasoning,
      routedSubagent: routingDecision.targetSubagent,
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
    let outboxEntry = outboxMap[idempotencyKey];

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
    }
    currentCycle.outboxEntryId = outboxEntry.id;
    currentCycle.trace.push(`outbox_created: ${outboxEntry.id}`);

    // Persiste imediatamente a Outbox com status 'pending' no banco antes de qualquer claim ou despacho
    await supabase
      .from("instagram_conversations")
      .update({
        stage_completed_rules: {
          ...stageRules,
          active_cycle_token: correlationId,
          active_cycle_at: new Date().toISOString(),
          orchestration: {
            ...orchState,
            outbox: outboxMap,
            messageLedger: ledger,
            lastDecision: decision,
          },
        },
      })
      .eq("id", conversationId);

    // ------------------------------------------------------------------------
    // MODO SHADOW: Registra tudo sem envio externo à Meta
    // ------------------------------------------------------------------------
    if (orchState.mode === "shadow") {
      outboxEntry.status = "sent";
      outboxEntry.sentAt = new Date().toISOString();
      outboxEntry.providerMessageId = "shadow_simulated";
      currentCycle.status = "completed";
      currentCycle.trace.push("shadow_simulation_completed");

      for (const id of claimedMessageIds) {
        ledger[id] = "processed";
      }

      const durationMs = Date.now() - startTime;
      currentCycle.completedAt = new Date().toISOString();
      currentCycle.metrics = {
        durationMs,
        tokens: { total: totalTokens },
      };
      currentCycle.trace.push("cycle_completed");

      const updatedState: ConversationOrchestrationState = {
        version: 1,
        mode: "shadow",
        currentPhase: validatedNextPhase,
        checkpoint: decision.checkpoint,
        lastProcessedMessageId: claimedMessageIds[claimedMessageIds.length - 1] || newMessage.id,
        lastProcessedAt: new Date().toISOString(),
        lastProcessingStatus: "shadow_logged",
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

      await supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...stageRules,
            active_cycle_token: null,
            orchestration: updatedState,
          },
        })
        .eq("id", conversationId);

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
                tokens: { total: totalTokens },
              };

              const updatedState: ConversationOrchestrationState = {
                version: 1,
                mode: "experimental",
                currentPhase: validatedNextPhase,
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

              await supabase
                .from("instagram_conversations")
                .update({
                  stage_completed_rules: {
                    ...stageRules,
                    active_cycle_token: null,
                    ai_auto_respond: true,
                    ai_debounce_until: new Date(Date.now() + 2500).toISOString(),
                    orchestration: updatedState,
                  },
                })
                .eq("id", conversationId);

              await publishAutoPilotState(supabase, conversationId, {
                status: "idle",
                activity: activity(
                  "completed",
                  "Envio parcial concluído",
                  `Balão ${sentBalloonsCount}/${balloons.length} enviado. Adaptando para nova mensagem...`,
                  { mode: "experimental", sentBalloonsCount, totalBalloons: balloons.length }
                ),
              });

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
          }

          await supabase
            .from("instagram_conversations")
            .update({
              stage_completed_rules: {
                ...stageRules,
                active_cycle_token: correlationId,
                orchestration: {
                  ...orchState,
                  outbox: outboxMap,
                },
              },
            })
            .eq("id", conversationId);

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
              if (sentBalloonsCount === 0) {
                for (const id of claimedMessageIds) {
                  ledger[id] = "pending";
                }
              }

              const { data: latestRow } = await supabase
                .from("instagram_conversations")
                .select("stage_completed_rules")
                .eq("id", conversationId)
                .maybeSingle();
              const latestRules = latestRow?.stage_completed_rules || stageRules;
              const latestOrch = latestRules.orchestration || orchState;
              const mergedLedger = { ...(latestOrch.messageLedger || {}), ...ledger };

              await supabase
                .from("instagram_conversations")
                .update({
                  stage_completed_rules: {
                    ...latestRules,
                    active_cycle_token: null,
                    orchestration: {
                      ...latestOrch,
                      messageLedger: mergedLedger,
                      lastProcessingStatus: "failed",
                      recentCycles: [currentCycle, ...(latestOrch.recentCycles || [])].slice(0, 5),
                    },
                  },
                })
                .eq("id", conversationId);

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
        tokens: { total: totalTokens },
      };
      currentCycle.trace.push("cycle_completed");

      // MEMORY WRITER: Executa pós-processamento assíncrono de memória de forma fail-safe
      // SOMENTE quando o ciclo concluiu com sucesso (todos os balões enviados confirmados ou ação wait concluída)
      // NUNCA em caso de falha, incerteza de rede (dispatch_uncertain) ou balões incompletos/abortados
      const isConfirmedSuccess =
        currentCycle.status === "completed" &&
        (decision.action === "wait" || sentBalloonsCount === balloons.length);

      if (isConfirmedSuccess) {
        try {
          await executeMemoryWriter({
            conversationId,
            claimedMessages: claimedMessages,
            lastLarissaTurn: baseContextPayload.lastLarissaTurn,
            sentResponseText: decision.suggestedResponse,
            memoryProvider,
            supabase,
            trace: currentCycle.trace,
          });
        } catch (memErr: any) {
          currentCycle.trace.push(`memory_writer_error: ${memErr.message || String(memErr)}`);
        }

        // Validação e conclusão de objetivo proposto semânticamente pelo agente
        if (decision.objectiveCompletion && decision.objectiveCompletion.objectiveId) {
          const comp = decision.objectiveCompletion;
          const validEvidence = comp.evidenceMessageId
            ? claimedMessages.some((m) => m.id === comp.evidenceMessageId) ||
              rawInbounds.some((m: any) => m.id === comp.evidenceMessageId)
            : true;

          if (validEvidence) {
            const currentCompletedGoals: string[] = [
              ...((orchState as any).completedGoalIds || stageRules.completed_goals || []),
            ];
            if (!currentCompletedGoals.includes(comp.objectiveId)) {
              currentCompletedGoals.push(comp.objectiveId);
            }
            (orchState as any).completedGoalIds = currentCompletedGoals;
            stageRules.completed_goals = currentCompletedGoals;

            const objProg: Record<string, any> = (orchState as any).objectiveProgress || {};
            objProg[comp.objectiveId] = {
              conversationId,
              stageId: currentPhase,
              objectiveId: comp.objectiveId,
              status: "completed",
              value: comp.value !== undefined ? comp.value : true,
              evidenceMessageId: comp.evidenceMessageId,
              completedAt: new Date().toISOString(),
            };
            (orchState as any).objectiveProgress = objProg;

            currentCycle.trace.push(`objective_completed_by_agent: ${comp.objectiveId}`);
          } else {
            currentCycle.trace.push(`objective_completion_rejected_invalid_evidence: ${comp.objectiveId}`);
          }
        }
      } else {
        currentCycle.trace.push("memory_writer_skipped_unconfirmed_cycle");
      }

      const updatedState: ConversationOrchestrationState = {
        version: 1,
        mode: "experimental",
        currentPhase: validatedNextPhase,
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
        memory: orchState.memory,
      };

      // Checagem de preempção antes do commit final no banco:
      // Se outro ciclo assumiu o lock durante o processamento/despacho, não sobrescreve seu estado!
      const { data: preCommitData } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", conversationId)
        .maybeSingle();

      const latestCycleToken = preCommitData?.stage_completed_rules?.active_cycle_token;
      if (latestCycleToken !== correlationId) {
        console.warn(
          `[Orchestrator] Ciclo ${correlationId} preemptado antes do commit final (token atual: ${latestCycleToken || "null"}). Ignorando sobrescrita de estado.`
        );
        return {
          mode: orchState.mode,
          handled: false,
          sentToMeta: sentSuccessfully,
          blockLegacyFallback: true,
          error: `Ciclo preemptado antes do commit por ${latestCycleToken || "lock_expirado"}`,
        };
      }

      // PRESERVAÇÃO ESTRITA DE MEMÓRIA:
      // O MemoryWriter (ou SupabaseMemoryProvider) gravou novos fatos em stage_completed_rules.orchestration.memory.
      // Mesclamos a memória mais recente do banco (e do provider) para JAMAIS sobrescrever com o snapshot antigo da RAM.
      const freshRules = preCommitData?.stage_completed_rules || stageRules;
      const latestMemoryFromDb = freshRules?.orchestration?.memory;

      let providerMemoryEntities: Record<string, Record<string, MemoryFact>> = {};
      if (typeof (memoryProvider as any).getOrCreateStore === "function") {
        const memStore = (memoryProvider as any).getOrCreateStore(conversationId);
        if (memStore?.entities) {
          providerMemoryEntities = memStore.entities;
        }
      }

      const mergedEntities = {
        ...(orchState.memory?.entities || {}),
        ...(latestMemoryFromDb?.entities || {}),
        ...providerMemoryEntities,
      };

      const mergedMemory: ContactMemoryStore = {
        entities: mergedEntities,
        snippets: latestMemoryFromDb?.snippets || orchState.memory?.snippets || [],
      };

      updatedState.memory = mergedMemory;
      updatedState.inboundRevision = freshRules?.orchestration?.inboundRevision ?? initialInboundRevision;
      updatedState.preemptRequested = freshRules?.orchestration?.preemptRequested ?? false;

      await supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...freshRules,
            active_cycle_token: null,
            orchestration: updatedState,
          },
        })
        .eq("id", conversationId);

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

    // Se o ciclo já foi preemptado por outro ciclo mais recente, não sobrescreve o banco nem o active_cycle_token
    const { data: errRecheck } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();

    if (errRecheck?.stage_completed_rules?.active_cycle_token !== correlationId) {
      console.warn(
        `[Orchestrator] Falha capturada no ciclo ${correlationId}, mas ciclo já perdeu o lock (atual: ${errRecheck?.stage_completed_rules?.active_cycle_token || "null"}). Abortando sobrescrita de fallback.`
      );
      return {
        mode: orchState.mode,
        handled: false,
        sentToMeta: sentSuccessfully,
        blockLegacyFallback: true,
        error: err.message || "Ciclo preemptado",
      };
    }

    await supabase
      .from("instagram_conversations")
      .update({
        stage_completed_rules: {
          ...stageRules,
          active_cycle_token: null,
          orchestration: fallbackState,
        },
      })
      .eq("id", conversationId);

    await publishAutoPilotState(supabase, conversationId, {
      status: "failed",
      activity: activity(
        "failed",
        "Erro na Atria",
        err.message || "Falha na análise da Atria",
        { mode: orchState.mode }
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
      const { data: finalCheck } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", conversationId)
        .maybeSingle();
      if (finalCheck?.stage_completed_rules?.active_cycle_token === correlationId) {
        await supabase
          .from("instagram_conversations")
          .update({
            stage_completed_rules: {
              ...finalCheck.stage_completed_rules,
              active_cycle_token: null,
            },
          })
          .eq("id", conversationId);
      }
    } catch (_fErr) {}
  }
}
