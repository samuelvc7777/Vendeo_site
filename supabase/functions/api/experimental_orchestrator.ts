// ============================================================================
// experimental_orchestrator.ts
// Motor Experimental de Orquestração por Conversa (Clean Architecture)
// Arquitetura: Backend Determinístico + Agente da Conversa + Subagentes
// Suporta modos: 'legacy' | 'shadow' | 'experimental'
// ============================================================================
import { publishAutoPilotState, activity } from "./cloud_autopilot.ts";

export type OrchestrationMode = "legacy" | "shadow" | "experimental";
export type OrchestrationPhase = "conexao_inicial" | "descoberta";
export type OrchestrationAction = "reply" | "wait" | "advance_phase" | "escalate";
export type SubagentTarget = "conexao_inicial" | "descoberta" | "none";
export type ProcessingStatus =
  | "idle"
  | "analyzing"
  | "decided"
  | "sent"
  | "shadow_logged"
  | "failed";

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
  status: "in_progress" | "completed" | "failed" | "cancelled";
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
  // Campos incrementais da arquitetura com Ledger, Cycle e Outbox
  activeCycle?: ProcessingCycle | null;
  recentCycles?: ProcessingCycle[];
  outbox?: Record<string, OutboxEntry>;
  messageLedger?: Record<string, MessageProcessingStatus>;
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
  newMessages: StructuredConversationMessage[];
  referencedMessages?: Record<string, StructuredConversationMessage>;
  knownFacts?: Record<string, string>;
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
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonSubstring = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSubstring);
    } catch {}
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

  const action: OrchestrationAction =
    obj.action === "wait" || obj.action === "advance_phase" || obj.action === "escalate"
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

  return {
    action,
    checkpoint,
    summary,
    suggestedResponse,
    nextPhase,
    reasoning,
    requiredTools: Array.isArray(obj.requiredTools) ? obj.requiredTools.map(String) : ["send_text"],
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

  const validActions: OrchestrationAction[] = ["reply", "wait", "advance_phase", "escalate"];
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
    newMessages: structuredNewMessages,
    referencedMessages: referencedMap,
    knownFacts: knownFacts || {},
  };

  return { payload, trace };
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
  if (outboxEntry.status === "sent" && outboxEntry.providerMessageId) {
    return { success: true, providerMessageId: outboxEntry.providerMessageId };
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
- Tom: meigo, carinhoso, mineiro natural (usando 'uai', 'né', 'kkk' com moderação).
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Jamais chame o pretendente de Larissa.
- Responda ao que ele falou antes de fazer qualquer pergunta leve.
- Mantenha o balão curto e natural de celular.

### CONTEXTO DA CONVERSA
${contextBlock}

### CHECKPOINTS DESTA FASE
- 'chk_saudacao_feita': Se ainda for troca de cumprimento ou reciprocidade inicial. Próxima fase: 'conexao_inicial'.
- 'chk_rapport_estabelecido': Se o pretendente demonstrou engajamento recíproco e a conexão inicial foi firmada, autorizando avançar para 'descoberta'.

Responda ESTRITAMENTE em JSON puro:
{
  "action": "reply",
  "checkpoint": "chk_saudacao_feita" | "chk_rapport_estabelecido",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "conexao_inicial" | "descoberta",
  "reasoning": "análise analítica da resposta"
}`;
}

export function buildDescobertaPrompt(input: SubagentInput): string {
  const contextBlock =
    input.contextText ||
    (input.newMessage
      ? `[ESTADO]\nfase: ${input.currentPhase}\ncheckpoint: ${input.checkpoint || "chk_pergunta_sobre_ele"}\n\n[MENSAGENS_NOVAS]\n\nPRETENDENTE | ${input.newMessage.id}\n${input.newMessage.text}\n\n[FIM]`
      : input.recentHistory || "Início da conversa");

  return `Você é a subagente especialista em DESCOBERTA da Larissa (23 anos, moça meiga de Minas Gerais).
Seu objetivo é descobrir suavemente o que o pretendente faz da vida, onde mora e sua rotina.

### DIRETRIZES DA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Aplique sempre a Regra da Reciprocidade: se perguntar sobre ele, conte algo breve sobre você (estuda enfermagem, mora em São João del Rei, trabalha com vendas em casa).
- Tom: meigo, carinhoso, mineiro natural (usando 'uai', 'né', 'kkk' com moderação).
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Uma pergunta leve por vez, sem interrogatório. Balão curto de celular.

### CONTEXTO DA CONVERSA
${contextBlock}

### CHECKPOINTS DESTA FASE
- 'chk_pergunta_sobre_ele': Perguntou sobre trabalho, rotina ou hobbies dele com reciprocidade.
- 'chk_troca_cidade': Falou/perguntou sobre cidade ou moradia.

Responda ESTRITAMENTE em JSON puro:
{
  "action": "reply",
  "checkpoint": "chk_pergunta_sobre_ele" | "chk_troca_cidade",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "fala carinhosa da Larissa para o pretendente",
  "nextPhase": "descoberta",
  "reasoning": "análise analítica da resposta"
}`;
}

// Construtor unificado mantido para compatibilidade retroativa
export function buildOrchestratorPrompt(input: OrchestratorInput): string {
  return `Você é a IA Atria, Auditora Oficial de Atendimento e Relacionamento do Vendeo.
Você atua na condução estratégica do atendimento para a persona **Larissa** (23 anos, moça meiga de Minas Gerais, estudante de enfermagem e trabalha com vendas).
O pretendente/cliente é quem está conversando com a Larissa. Quem enviou a última mensagem foi o cliente (${input.newMessage.sender}).
A fala formulada em "suggestedResponse" é a resposta direta da **Larissa** para o cliente.

### DIRETRIZES DA PERSONA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Tom: carinhoso, meigo, natural de Minas Gerais (usando 'uai', 'né', 'kkk' com sutileza).
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Jamais chame o cliente de Larissa. Responda ao que o cliente falou antes de perguntar qualquer coisa.
- Mantenha a resposta curta, humana e fluida de WhatsApp/Instagram.

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
  runtime?: {
    sendMetaTextMessage?: (supabase: any, conversationId: string, text: string) => Promise<any>;
    callModel?: (prompt: string) => Promise<{ content: string; tokens?: number }>;
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
    const { data: rawMsgs } = await supabase
      .from("instagram_messages")
      .select("id, sender_id, is_mine, text, reply_to_message_id, created_at, timestamp, media_type, media_url, direction")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);

    const canonicalList: CanonicalMessage[] = (rawMsgs || []).map((m: any) =>
      normalizeToCanonicalMessage(m, conversationId)
    );

    const pendingMessages: CanonicalMessage[] = [];
    for (const msg of canonicalList) {
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
          pendingMessages.push({ ...msg, status: "pending" });
        }
      }
    }

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
      trace: [
        `cycle_started: ${correlationId}`,
        `messages_claimed: ${claimedMessageIds.length}`,
      ],
    };

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

    console.log(
      `[Orchestrator] Agente da Conversa roteou ${conversationId} para "${routingDecision.targetSubagent}" (ação=${routingDecision.action}, motivo=${routingDecision.reason}).`
    );

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

      const subRes = await callModelOrAtria(subagentPrompt, { runtime, supabase });
      totalTokens += subRes.tokens;
      const rawSubJson = extractJsonFromText(subRes.content);
      finalSubDecision = validateSubagentDecision(rawSubJson, currentPhase);
      currentCycle.trace.push(`subagent_executed: ${targetSubagent}`);
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
    // OUTBOX PATTERN: Criação da Intenção de Envio com IdempotencyKey
    // ------------------------------------------------------------------------
    const idempotencyKey = `idemp_${conversationId}_${correlationId}`;
    let outboxEntry = outboxMap[idempotencyKey];

    if (!outboxEntry) {
      outboxEntry = {
        id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        cycleId: correlationId,
        conversationId,
        idempotencyKey,
        content: decision.suggestedResponse,
        messageType: "text",
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

    // ------------------------------------------------------------------------
    // MODO EXPERIMENTAL: Execução ativa no chat
    // ------------------------------------------------------------------------
    if (orchState.mode === "experimental") {
      sentSuccessfully = false;

      if (
        (decision.action === "reply" || decision.action === "advance_phase") &&
        decision.suggestedResponse
      ) {
        await publishAutoPilotState(supabase, conversationId, {
          status: "processing",
          activity: activity(
            "sending",
            "Atria enviando...",
            "Entregando a mensagem pelo Instagram.",
            {
              atriaThought: decision.reasoning,
              solThought: decision.suggestedResponse,
              currentResponsePreview: decision.suggestedResponse,
              totalBalloons: 1,
              currentBalloon: 1,
              countdownSeconds: 0,
              mode: "experimental",
            }
          ),
        });

        // 1. CLAIM ATÔMICO NO BANCO (Postgres RPC claim_outbox_entry com SELECT ... FOR UPDATE)
        const claimRes = await claimOutboxEntryAtomic({
          supabase,
          conversationId,
          outboxKey: idempotencyKey,
          claimToken: correlationId,
        });

        if (!claimRes.success) {
          console.warn(
            `[Orchestrator] Falha no claim atômico da outbox para ${conversationId}: motivo=${claimRes.reason}`
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
            // FAIL CLOSED: Falha de infraestrutura na execução da RPC no Postgres
            // Não tenta envio, não assume entrega, não ativa fallback inseguro
            sentSuccessfully = false;
            currentCycle.status = "failed";
            currentCycle.trace.push(`outbox_claim_infra_failure: ${claimRes.reason}`);
            for (const id of claimedMessageIds) {
              ledger[id] = "pending";
            }
            return {
              mode: orchState.mode,
              handled: false,
              sentToMeta: false,
              blockLegacyFallback: true,
              error: `Falha de infraestrutura no claim atômico (${claimRes.reason}). Fail-closed: envio abortado.`,
            };
          } else {
            return {
              mode: orchState.mode,
              handled: false,
              sentToMeta: false,
              blockLegacyFallback: true,
              error: `Outbox em envio concorrente ou já processada (${claimRes.reason})`,
            };
          }
        }

        if (claimRes.entry) {
          Object.assign(outboxEntry, claimRes.entry);
        }

        // 2. DISPATCHER: Envio seguro através da Outbox
        const dispatchRes = await dispatchOutboxEntry({
          supabase,
          outboxEntry,
          recipientId: conversationId,
          claimToken: correlationId,
          runtime,
        });

        if (dispatchRes.success && outboxEntry.status === "sent") {
          sentSuccessfully = true;
          currentCycle.trace.push(`meta_dispatched: ${dispatchRes.providerMessageId}`);

          const nowIso = new Date().toISOString();
          const messageId = dispatchRes.providerMessageId || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          await supabase.from("instagram_messages").upsert({
            id: messageId,
            conversation_id: conversationId,
            sender_id: "me",
            is_mine: true,
            text: decision.suggestedResponse,
            status: "sent",
            created_at: nowIso,
            timestamp: nowIso,
          });

          await supabase
            .from("instagram_conversations")
            .update({
              last_message: decision.suggestedResponse,
              last_message_preview: decision.suggestedResponse,
              last_message_at: nowIso,
              last_direction: "out",
              last_status: "sent",
            })
            .eq("id", conversationId);

          for (const id of claimedMessageIds) {
            ledger[id] = "processed";
          }
          currentCycle.status = "completed";
        } else if (dispatchRes.isUncertain) {
          // Incerteza de rede (timeout / disconnect na chamada da Meta Graph API)
          // A Meta pode ter recebido e entregue a mensagem!
          // NÃO reverte mensagens para pending (para não gerar duplicata) e marca sentSuccessfully como true
          // para bloquear fallback para legacy no webhook handler.
          sentSuccessfully = true;
          currentCycle.status = "failed";
          currentCycle.trace.push(`meta_dispatch_uncertain: ${dispatchRes.error}`);
          console.warn(
            `[Orchestrator] Envio com status dispatch_uncertain para ${conversationId}. Bloqueando retry automático e fallback legacy para evitar duplicação.`
          );
          for (const id of claimedMessageIds) {
            ledger[id] = "processed";
          }
        } else {
          currentCycle.status = "failed";
          currentCycle.trace.push(`meta_dispatch_failed: ${dispatchRes.error}`);
          for (const id of claimedMessageIds) {
            ledger[id] = "pending"; // Reverte mensagens para retry limpo apenas em erro determinístico
          }
          throw new Error(`Falha no despacho da outbox: ${dispatchRes.error}`);
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
