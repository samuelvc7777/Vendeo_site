// ============================================================================
// OPENAI AGENT BRAIN CLIENT (Fase 1 - Migração Arquitetural)
// Integração desacoplada com o OpenAI Agent Brain e suporte a Function Tools reais.
// ============================================================================

import {
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
  type PersonaMemoryCompactToolOutput,
} from "./persona_memory.ts";
import {
  searchContactMemory,
  resolveAgentMemoryScope,
  type ContactMemoryCompactToolOutput,
} from "./contact_memory.ts";
import {
  searchUnifiedConversationMemory,
  type UnifiedConversationMemoryOutput,
} from "./conversation_episodic_memory.ts";
import {
  LARISSA_INTERACTION_DNA_VERSION,
  LARISSA_INTERACTION_DNA_HASH,
} from "./larissa_interaction_dna.ts";
import { SOCIAL_CUE_AND_DELTA_GUIDANCE } from "./brain_conversation_guidance.ts";
import type { AgentSessionUsageTelemetry } from "./openai_usage.ts";
import { MEMORY_SCOPE_HEADER, prepareMemoryToolCall } from "../_shared/memory_tool_context.ts";

export interface OpenAiBrainToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export const PERSONA_MEMORY_TOOL_DEFINITION: OpenAiBrainToolDefinition = {
  type: "function",
  function: {
    name: "persona_memory_search",
    description:
      "Pesquisa a PersonaMemory oficial da Larissa no Supabase para descobrir fatos reais que possam gerar afinidade, conexão pessoal, reação autêntica, experiência parecida, diferença interessante, comentário pessoal ou grounding factual. Use para profissão, formação, estudos, hobbies, experiências, viagens, rotina, preferências, gostos, hábitos, valores e reação pessoal. Quando o pretendente revelar um fato pessoal relevante e o contexto não trouxer informação suficiente da Larissa sobre o tema, prefira consultar esta ferramenta antes de concluir que não existe conexão. Não invente fatos que podem ser consultados nesta ferramenta.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Termos de busca para encontrar fatos na memória da Larissa (ex: 'motocross', 'comida favorita', 'estágio', 'música', 'onde mora').",
        },
        limit: {
          type: "number",
          description: "Número máximo de fatos retornados (entre 1 e 8, default: 4).",
        },
      },
      required: ["query"],
    },
  },
};

export const CONTACT_MEMORY_TOOL_DEFINITION: OpenAiBrainToolDefinition = {
  type: "function",
  function: {
    name: "contact_memory_search",
    description:
      "Pesquisa a Contact Memory do pretendente (fatos duráveis, entidades citadas e frases marcantes) no Supabase. Permite consultar detalhes já revelados sobre ele (onde mora, profissão, idade, pets, gostos, rotina, planos). O contexto da conversa é associado pela infraestrutura. Em caso de erro técnico, não trate como busca vazia nem adie uma decisão somente por essa falha.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termos de busca sobre fatos ou citações do pretendente (ex: 'onde mora', 'idade', 'trabalho', 'irmã', 'moto').",
        },
        scopes: {
          type: "array",
          items: { type: "string", enum: ["facts", "entities", "quotes"] },
          description: "Escopos opcionais de busca em Contact Memory.",
        },
        limit: {
          type: "number",
          description: "Número máximo de itens retornados (entre 1 e 8, default: 5).",
        },
      },
      required: ["query"],
    },
  },
};

export const CONVERSATION_MEMORY_TOOL_DEFINITION: OpenAiBrainToolDefinition = {
  type: "function",
  function: {
    name: "conversation_memory_search",
    description:
      "Pesquisa marcos, episódios passados, atos de fala, combinados/promessas pendentes (open loops) e histórico da conversa no Supabase. Use para evitar perguntas repetidas, honrar combinados e recuperar contexto de turnos anteriores. O contexto da conversa é associado pela infraestrutura. Em caso de erro técnico, não trate como busca vazia nem adie uma decisão somente por essa falha.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termos de busca sobre episódios, acordos ou perguntas feitas.",
        },
        scopes: {
          type: "array",
          items: { type: "string", enum: ["episodes", "speech_acts", "open_loops", "history"] },
          description: "Escopos opcionais de busca em Conversation Memory.",
        },
        limit: {
          type: "number",
          description: "Número máximo de itens retornados (entre 1 e 8, default: 5).",
        },
      },
      required: ["query"],
    },
  },
};

export function buildSessionAgentToolsWithMemoryScope(agentTools: unknown, scopeId: string): any[] {
  if (!Array.isArray(agentTools)) throw new Error("OpenAI Agent configuration is missing its tools array.");
  let matched = false;
  const updatedTools = agentTools.map((tool: any) => {
    if (tool?.type !== "mcp" || tool?.server_label !== "vendeo_memory") return tool;
    matched = true;
    return {
      ...tool,
      transport: {
        ...(tool.transport || {}),
        headers: {
          ...(tool.transport?.headers || {}),
          [MEMORY_SCOPE_HEADER]: scopeId,
        },
      },
    };
  });
  if (!matched) throw new Error("OpenAI Agent configuration has no vendeo_memory MCP tool.");
  return updatedTools;
}

function parseMemoryToolTelemetry(item: any, toolName: string): OpenAiBrainTurnResult["telemetry"]["memoryToolResults"][number] {
  let payload: any = item?.output;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.content)) {
    payload = payload.content;
  }
  if (Array.isArray(payload)) {
    const text = payload.find((part: any) => part?.type === "text" && typeof part.text === "string")?.text;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
  } else if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }

  const reasonCode = ["memory_scope_missing", "memory_scope_invalid", "memory_scope_validation_failed", "memory_search_failed", "memory_scope_context_unavailable"].includes(payload?.reasonCode)
    ? payload.reasonCode
    : undefined;
  const isError = Boolean(
    item?.error || item?.isError || item?.status === "failed" || item?.status === "error" || payload?.status === "tool_error",
  );
  const status = isError
    ? "tool_error"
    : payload?.status === "success_no_results" || payload?.status === "success_with_results"
    ? payload.status
    : Array.isArray(payload?.results)
    ? payload.results.length > 0 || payload.found === true ? "success_with_results" : "success_no_results"
    : payload?.found === false
    ? "success_no_results"
    : "tool_error";

  return {
    toolName,
    status,
    ...(reasonCode ? { reasonCode } : status === "tool_error" ? { reasonCode: "memory_result_unavailable" } : {}),
    ...(Array.isArray(payload?.results) ? { resultCount: payload.results.length } : {}),
  };
}

export async function executePersonaMemoryTool(
  params: { query?: string; limit?: number },
  supabase: any
): Promise<PersonaMemoryCompactToolOutput> {
  const query = String(params?.query || "").trim().slice(0, 200);
  if (!query) {
    console.log("[PersonaMemory] query=\"\" (vazia)");
    console.log("[PersonaMemory] results=0");
    return { found: false, results: [] };
  }

  const safeLimit = Math.min(Math.max(Number(params?.limit) || 4, 1), 8);
  console.log(`[PersonaMemory] query="${query}"`);

  const hits = await searchPersonaMemory({
    supabase,
    personaId: "larissa",
    query,
    limit: safeLimit,
    allowLegacyFallback: false,
  });

  const output = formatPersonaMemoryForToolOutput(hits);
  console.log(`[PersonaMemory] results=${output.results.length}`);
  return output;
}

export interface PlanValidationResult {
  valid: boolean;
  error?: string;
}

export function validateConversationBrainPlan(
  plan: any
): PlanValidationResult {
  if (!plan || typeof plan !== "object") {
    return { valid: false, error: "Plano retornado não é um objeto JSON válido" };
  }
  const validActions = ["reply", "wait"];
  if (!validActions.includes(plan.action)) {
    return {
      valid: false,
      error: `Ação do plano deve ser 'reply' ou 'wait', recebido: '${plan.action}'`,
    };
  }
  if (plan.action === "wait") {
    return { valid: true };
  }

  // Validação estrita de evidenceMessageId e satisfiedObjectiveId para already_satisfied
  if (plan.objectiveDecision === "already_satisfied") {
    if (!plan.satisfiedObjectiveId || typeof plan.satisfiedObjectiveId !== "string" || !plan.satisfiedObjectiveId.trim()) {
      return {
        valid: false,
        error: "satisfiedObjectiveId é obrigatório e deve ser string não vazia quando objectiveDecision='already_satisfied'",
      };
    }
    if (!plan.evidenceMessageId || typeof plan.evidenceMessageId !== "string" || !plan.evidenceMessageId.trim()) {
      return {
        valid: false,
        error: "evidenceMessageId é obrigatório e deve ser string não vazia quando objectiveDecision='already_satisfied'",
      };
    }
  }

  // Validação de turnContract (aceita tanto na raiz quanto em missionPackage)
  const turnContract = plan.turnContract || plan.missionPackage?.turnContract;
  if (!turnContract || typeof turnContract !== "object") {
    return { valid: false, error: "turnContract ausente ou inválido no plano" };
  }
  if (typeof turnContract.mustAnswerFirst !== "boolean") {
    return { valid: false, error: "turnContract.mustAnswerFirst deve ser booleano" };
  }
  if (typeof turnContract.newQuestionBudget !== "number" || isNaN(turnContract.newQuestionBudget)) {
    return { valid: false, error: "turnContract.newQuestionBudget deve ser numérico" };
  }
  if (!turnContract.responseShape || typeof turnContract.responseShape !== "string") {
    return { valid: false, error: "turnContract.responseShape deve ser string não vazia" };
  }
  if (!Array.isArray(turnContract.directQuestions)) {
    return { valid: false, error: "turnContract.directQuestions deve ser uma lista" };
  }
  if (!Number.isInteger(turnContract.maxBalloons) || turnContract.maxBalloons < 1 || turnContract.maxBalloons > 4) {
    return { valid: false, error: "turnContract.maxBalloons deve ser inteiro entre 1 e 4" };
  }

  // Síntese defensiva retrocompatível: se missionPackage estiver ausente, sintetiza a partir da raiz
  if (!plan.missionPackage || typeof plan.missionPackage !== "object") {
    plan.missionPackage = {
      objectiveDirective: plan.objectiveDecision || "none",
      draftResponse: Array.isArray(plan.responses) ? plan.responses.join("\n\n") : "",
      relevantPersonaFacts: plan.relevantPersonaFacts || [],
      memoryConsulted: plan.memoryConsulted,
      memoryRationale: plan.memoryRationale,
      personaMemoryQuery: plan.personaMemoryQuery,
      turnContract,
    };
  } else if (!plan.missionPackage.turnContract) {
    plan.missionPackage.turnContract = turnContract;
  }

  return { valid: true };
}

/**
 * Validação estrutural do novo modelo unificado: garante que respostas prontas
 * foram geradas pelo Agent no mesmo turno.
 */
export function validateResponseGenerationInvariant(plan: any): PlanValidationResult {
  if (!plan || typeof plan !== "object") {
    return { valid: false, error: "Plano inválido" };
  }
  if (plan.action === "wait") {
    return { valid: true };
  }
  // Se for ação de reply ou tiver responses declarado
  if (plan.action === "reply" || Array.isArray(plan.responses)) {
    if (!Array.isArray(plan.responses) || plan.responses.length === 0) {
      return {
        valid: false,
        error: "PLAN_INCOMPLETE_RESPONSE_GENERATION: 'responses' ausente ou vazio para action != wait",
      };
    }
    if (plan.responses.length > 4) {
      return {
        valid: false,
        error: "PLAN_INCOMPLETE_RESPONSE_GENERATION: 'responses' excede o limite máximo de 4 balões",
      };
    }
    for (const b of plan.responses) {
      if (typeof b !== "string" || !b.trim()) {
        return {
          valid: false,
          error: "PLAN_INCOMPLETE_RESPONSE_GENERATION: cada balão em 'responses' deve ser string não vazia",
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Validação estrutural: o Brain continua decidindo se memória é necessária;
 * este guard apenas impede que um plano final descreva uma tool pendente.
 */
export function validatePersonaMemoryExecutionInvariant(
  plan: any,
  actualMemoryToolCalled: boolean,
): PlanValidationResult {
  const mission = plan?.missionPackage || {};
  const memoryConsulted = mission.memoryConsulted ?? plan?.memoryConsulted;
  const personaMemoryQuery = mission.personaMemoryQuery ?? plan?.personaMemoryQuery;
  const searchableText = [
    plan?.action,
    plan?.reasoning,
    mission.conversationIntent,
    mission.memoryRationale,
    mission.objectiveDirective,
  ].filter((value) => typeof value === "string").join("\n");
  const describesPendingSearch = /(?:vou\s+consultar|consultar\s+depois|consultar\s+persona\s*memory\s+e\s+ent[ãa]o|buscar\s+na\s+mem[oó]ria|usar\s+persona_memory_search|verificar\s+fatos\s+da\s+larissa)/i.test(searchableText);

  if (memoryConsulted === true && !actualMemoryToolCalled) {
    return { valid: false, error: "PLAN_INCOMPLETE_TOOL_EXECUTION: memoryConsulted=true sem mcp_call real" };
  }
  if (personaMemoryQuery && !actualMemoryToolCalled) {
    return { valid: false, error: "PLAN_INCOMPLETE_TOOL_EXECUTION: personaMemoryQuery sem mcp_call real" };
  }
  if (describesPendingSearch && !actualMemoryToolCalled) {
    return { valid: false, error: "PLAN_INCOMPLETE_TOOL_EXECUTION: plano descreve consulta futura sem executá-la" };
  }
  if (actualMemoryToolCalled && memoryConsulted === false) {
    return { valid: false, error: "PLAN_INCOMPLETE_TOOL_EXECUTION: mcp_call real contradiz memoryConsulted=false" };
  }
  return { valid: true };
}

export interface QuestionIntentAnnotation {
  responseIndex: number;
  intentKey: string;
  canonicalMeaning: string;
  kind: "discovery" | "continuity" | "follow_up" | "callback";
  target?: "pretendente" | "terceiro";
}

/**
 * Validação estrutural do ledger de intenções semânticas de perguntas:
 * - Se fornecido, valida integridade de questionIntents e resolvedQuestionIntentIds
 * - Se responses contiver '?', garante que o balão correspondente possui anotação em questionIntents
 */
export function validateQuestionIntentsInvariant(plan: any): PlanValidationResult {
  if (!plan || typeof plan !== "object") {
    return { valid: false, error: "Plano inválido para validação de questionIntents" };
  }
  if (plan.action === "wait") {
    return { valid: true };
  }

  // resolvedQuestionIntentIds (se presente, deve ser array de strings)
  if (plan.resolvedQuestionIntentIds !== undefined && plan.resolvedQuestionIntentIds !== null) {
    if (!Array.isArray(plan.resolvedQuestionIntentIds)) {
      return {
        valid: false,
        error: "PLAN_INVALID_QUESTION_INTENTS: 'resolvedQuestionIntentIds' deve ser um array de strings",
      };
    }
    for (const id of plan.resolvedQuestionIntentIds) {
      if (typeof id !== "string" || !id.trim()) {
        return {
          valid: false,
          error: "PLAN_INVALID_QUESTION_INTENTS: cada item em 'resolvedQuestionIntentIds' deve ser string não vazia",
        };
      }
    }
  }

  // questionIntents (se presente, deve ser array de anotações)
  const questionIntents = plan.questionIntents;
  if (questionIntents !== undefined && questionIntents !== null) {
    if (!Array.isArray(questionIntents)) {
      return {
        valid: false,
        error: "PLAN_INVALID_QUESTION_INTENTS: 'questionIntents' deve ser um array de anotações",
      };
    }
    const responses = Array.isArray(plan.responses) ? plan.responses : [];
    for (let i = 0; i < questionIntents.length; i++) {
      const q = questionIntents[i];
      if (!q || typeof q !== "object") {
        return {
          valid: false,
          error: `PLAN_INVALID_QUESTION_INTENTS: questionIntents[${i}] não é um objeto válido`,
        };
      }
      if (
        typeof q.responseIndex !== "number" ||
        !Number.isInteger(q.responseIndex) ||
        q.responseIndex < 0 ||
        q.responseIndex >= responses.length
      ) {
        return {
          valid: false,
          error: `PLAN_INVALID_QUESTION_INTENTS: questionIntents[${i}].responseIndex (${q.responseIndex}) fora dos limites de responses (tamanho ${responses.length})`,
        };
      }
      if (typeof q.intentKey !== "string" || !q.intentKey.trim()) {
        return {
          valid: false,
          error: `PLAN_INVALID_QUESTION_INTENTS: questionIntents[${i}].intentKey deve ser string não vazia`,
        };
      }
      if (typeof q.canonicalMeaning !== "string" || !q.canonicalMeaning.trim()) {
        return {
          valid: false,
          error: `PLAN_INVALID_QUESTION_INTENTS: questionIntents[${i}].canonicalMeaning deve ser string não vazia`,
        };
      }
    }
  }

  // Validação de correspondência: balões com '?' devem ter anotação em questionIntents
  const responses = Array.isArray(plan.responses) ? plan.responses : [];
  const questionIndexesWithMark: number[] = [];
  responses.forEach((resp: string, idx: number) => {
    if (typeof resp === "string" && resp.includes("?")) {
      questionIndexesWithMark.push(idx);
    }
  });

  if (questionIndexesWithMark.length > 0) {
    if (!Array.isArray(questionIntents) || questionIntents.length === 0) {
      return {
        valid: false,
        error: `PLAN_MISSING_QUESTION_INTENTS: Resposta contém balão com '?' no índice [${questionIndexesWithMark.join(", ")}], mas 'questionIntents' está ausente ou vazio`,
      };
    }
    const annotatedIndices = new Set(questionIntents.map((q: any) => q.responseIndex));
    for (const qIdx of questionIndexesWithMark) {
      if (!annotatedIndices.has(qIdx)) {
        return {
          valid: false,
          error: `PLAN_MISSING_QUESTION_INTENTS: Balão no índice ${qIdx} contém '?', mas não possui anotação em 'questionIntents'`,
        };
      }
    }
  }

  return { valid: true };
}

export function recoverSafeBrainPlan(parsedPlan: any): any | null {
  if (!parsedPlan || typeof parsedPlan !== "object" || Array.isArray(parsedPlan)) return null;
  const responses = Array.isArray(parsedPlan.responses) ? parsedPlan.responses : [];
  if (responses.length < 1 || responses.length > 4) return null;
  const safeResponses = responses.map((item: unknown) => typeof item === "string" ? item.trim() : "");
  if (safeResponses.some((item: string) => !item || item.length > 2000 || looksLikeInternalBrainPayload(item))) return null;
  return {
    ...parsedPlan,
    responses: safeResponses,
    suggestedResponse: safeResponses.join("\n\n"),
    action: parsedPlan.action === "wait" ? "wait" : "reply",
  };
}

function looksLikeInternalBrainPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  const markers = ["\"action\"", "\"reasoning\"", "\"memoryWrites\"", "\"questionIntents\"", "\"turnContract\"", "\"responses\""];
  return markers.filter((marker) => trimmed.includes(marker)).length >= 2;
}

export function buildFallbackBrainPlan(parsedPlan: any): any {
  const recovered = recoverSafeBrainPlan(parsedPlan);
  if (recovered) return recovered;
  const defaultContract = {
    directQuestions: [],
    mustAnswerFirst: true,
    newQuestionBudget: 1,
    responseShape: "answer_and_reciprocate",
    preferNoEmoji: false,
    maxBalloons: 2,
  };
  return {
    action: "reply",
    objectiveDecision: "none",
    satisfiedObjectiveId: null,
    evidenceMessageId: null,
    reasoning: "Plano inválido sem respostas seguras",
    liveStatePatch: {},
    responses: [],
    turnContract: defaultContract,
    missionPackage: {
      objectiveDirective: "none",
      draftResponse: "",
      turnContract: defaultContract,
    },
  };
}

export interface RunOpenAiBrainParams {
  supabase: any;
  conversationId: string;
  currentStageId: string;
  currentObjectiveId?: string | null;
  currentObjectiveLabel?: string | null;
  currentObjectiveDescription?: string | null;
  currentObjectiveRequired?: boolean;
  currentObjectiveKind?: string | null;
  inboundMessages: string[];
  currentInboundMessages?: Array<{ id: string; text: string; createdAt?: string }>;
  recentMessages: Array<{ id?: string; sender: "user" | "larissa"; text: string; createdAt?: string }>;
  contactMemorySummary?: string;
  landmarksSummary?: string;
  liveStateContext?: string;
  agentId?: string;
  apiKey?: string;
  signal?: AbortSignal;
  runtime?: any;
  strictOpenAiPilot?: boolean;
  vaultIds?: string[];
  candidateEvidence?: Array<{ objectiveId: string; evidenceMessageId: string; summary: string }>;
  schemaRetryCount?: number;
  schemaFeedback?: string;
  recentStyleStateSnippet?: string;
  memoryScopeId?: string;
  recentQuestionIntentsSnippet?: string;
  nextObjectives?: Array<{ id: string; label: string; description?: string; kind?: string }>;
  temporalContext?: string;
  contextPipeline?: {
    candidateCount: number;
    deduplicatedCount: number;
    budgetedCount: number;
    messageLimitCut: boolean;
    tokenBudgetCut: boolean;
    mandatoryTokenOverflow: boolean;
    lastLarissaOutboundId: string | null;
    mandatoryMessageIds?: string[];
    replyTargetIds?: string[];
  };
}

export interface OpenAiContextWindowTelemetry {
  candidateCount: number;
  deduplicatedCount: number;
  budgetedCount: number;
  includedCount: number;
  includedMessages: Array<{ id: string | null; sender: "Larissa" | "Pretendente"; timestamp: string | null }>;
  previews: Array<{ id: string | null; sender: "Larissa" | "Pretendente"; timestamp: string | null; text: string }>;
  lastLarissaOutboundId: string | null;
  finalMandatoryMessageIds: string[];
  mandatoryCount: number;
  lastLarissaOutboundRequired: boolean;
  lastLarissaOutboundIncluded: boolean | null;
  replyTargetRequiredCount: number;
  replyTargetsIncludedCount: number;
  currentInboundDuplicateCount: number;
  droppedNonMandatoryCount: number;
  mandatoryContextOverflow: boolean;
  cutByMessageLimit: boolean;
  cutByCharLimit: boolean;
  windowCharacterCount: number;
  cuts: {
    messageLimit: boolean;
    tokenBudget: boolean;
    finalCharacters: boolean;
    messageTextLimit: boolean;
    mandatoryTokenOverflow: boolean;
  };
}

export interface OpenAiBrainTurnResult {
  success: boolean;
  plan: any | null;
  error?: string;
  telemetry: {
    agentId: string;
    sessionId?: string;
    turnId?: string;
    status?: string;
    toolsRequested: string[];
    toolExecutionsCount: number;
    memoryToolResults: Array<{ toolName: string; status: string; reasonCode?: string; resultCount?: number }>;
    actualMemoryToolCalled: boolean;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    agentUsageSessions: AgentSessionUsageTelemetry[];
    sourcesUsed: string[];
    finalPlanParsed?: boolean;
    interactionDnaApplied?: boolean;
    interactionDnaVersion?: string;
    interactionDnaHash?: string;
    recentStyleStateApplied?: boolean;
    contextWindow?: OpenAiContextWindowTelemetry;
  };
}

async function fetchAgentGenerationIds(
  sessionId: string,
  headers: Record<string, string>,
): Promise<string[] | null> {
  const generationIds = new Set<string>();
  let after: string | null = null;

  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const url = new URL(`https://api.openai.com/v1/agents/sessions/${sessionId}/traces`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("after", after);

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) return null;
      const page = await response.json();
      const traceRows = Array.isArray(page?.data) ? page.data : [];
      for (const traceRow of traceRows) {
        const resourceSpans = traceRow?.otlp?.resourceSpans;
        if (!Array.isArray(resourceSpans)) continue;
        for (const resourceSpan of resourceSpans) {
          const scopeSpans = Array.isArray(resourceSpan?.scopeSpans) ? resourceSpan.scopeSpans : [];
          for (const scopeSpan of scopeSpans) {
            const spans = Array.isArray(scopeSpan?.spans) ? scopeSpan.spans : [];
            for (const span of spans) {
              const name = typeof span?.name === "string" ? span.name.toLowerCase() : "";
              if (!name.includes("generation")) continue;
              const spanId = typeof span?.spanId === "string" ? span.spanId : "";
              if (spanId) generationIds.add(spanId);
            }
          }
        }
      }

      if (page?.has_more !== true) {
        return generationIds.size > 0 ? [...generationIds] : null;
      }
      if (typeof page.last_id !== "string" || !page.last_id || page.last_id === after) return null;
      after = page.last_id;
    } catch {
      return null;
    }
  }

  // Não apresentar uma contagem parcial se a paginação não terminou.
  return null;
}

async function fetchAgentSessionUsageTelemetry(
  sessionId: string,
  model: string | null,
  sessionUsage: unknown,
  headers: Record<string, string>,
): Promise<AgentSessionUsageTelemetry> {
  const turns: AgentSessionUsageTelemetry["turns"] = [];
  let after: string | null = null;

  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const url = new URL(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("after", after);

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      const page = await response.json();
      for (const turn of Array.isArray(page?.data) ? page.data : []) {
        if (typeof turn?.id !== "string" || !turn.id) continue;
        turns.push({ id: turn.id, usage: turn.usage ?? null });
      }
      if (page?.has_more !== true) break;
      if (typeof page.last_id !== "string" || !page.last_id || page.last_id === after) break;
      after = page.last_id;
    } catch {
      break;
    }
  }

  const generationIds = await fetchAgentGenerationIds(sessionId, headers);
  return { sessionId, model, sessionUsage, turns, generationIds };
}

function buildAgentRecentWindow(params: RunOpenAiBrainParams): {
  text: string;
  includedRecentMessages: RunOpenAiBrainParams["recentMessages"];
  telemetry: OpenAiContextWindowTelemetry;
} {
  const recentMessages = params.recentMessages || [];
  const currentInboundMessages = params.currentInboundMessages || [];
  const inboundIds = new Set(currentInboundMessages.map((message) => String(message.id || "")).filter(Boolean));
  const priorMessages = recentMessages.filter((message) => !message.id || !inboundIds.has(String(message.id)));
  const lastLarissaOutboundId = params.contextPipeline?.lastLarissaOutboundId
    ?? [...recentMessages].reverse().find((message) => message.sender === "larissa")?.id
    ?? null;
  const mandatoryIds = new Set((params.contextPipeline?.mandatoryMessageIds || []).map(String).filter(Boolean));
  const replyTargetIds = new Set((params.contextPipeline?.replyTargetIds || []).map(String).filter(Boolean));
  if (lastLarissaOutboundId) mandatoryIds.add(String(lastLarissaOutboundId));
  for (const id of replyTargetIds) mandatoryIds.add(id);

  const mandatoryRecentMessages = priorMessages.filter((message) => message.id && mandatoryIds.has(String(message.id)));
  const normalRecentMessages = priorMessages.filter((message) => !message.id || !mandatoryIds.has(String(message.id)));
  const selectedMessageIds = new Set(mandatoryRecentMessages.map((message) => String(message.id)));
  const availableNormalSlots = Math.max(0, 20 - mandatoryRecentMessages.length);
  const selectedNormalMessages = availableNormalSlots > 0 ? normalRecentMessages.slice(-availableNormalSlots) : [];
  const selectedNormalMessageSet = new Set(selectedNormalMessages);
  const anonymousMessageKeys = new WeakMap<object, string>();
  priorMessages.forEach((message, index) => {
    if (!message.id) anonymousMessageKeys.set(message, `anonymous-${index}`);
  });
  for (const message of selectedNormalMessages) {
    if (message.id) selectedMessageIds.add(String(message.id));
  }
  const includedRecentMessages = priorMessages.filter((message) =>
    (message.id && selectedMessageIds.has(String(message.id))) || selectedNormalMessageSet.has(message)
  );
  const cutByMessageLimit = priorMessages.length > 20;
  const messageKey = (message: RunOpenAiBrainParams["recentMessages"][number]) =>
    message.id ? String(message.id) : anonymousMessageKeys.get(message) || "anonymous-unknown";
  const droppedNonMandatoryKeys = new Set(priorMessages
    .map((message) => ({ message, key: messageKey(message) }))
    .filter(({ message }) => !message.id || !mandatoryIds.has(String(message.id)))
    .filter(({ message }) => !selectedNormalMessageSet.has(message))
    .map(({ key }) => key));
  const renderMessage = (message: RunOpenAiBrainParams["recentMessages"][number]) => {
    const role = message.sender === "user" ? "Pretendente" : "Larissa";
    const idSnippet = message.id ? ` | id="${message.id}"` : "";
    let cleanText = String(message.text || "").trim();
    if (cleanText.length > 600) cleanText = cleanText.slice(0, 600) + " [...]";
    const timestamp = message.createdAt
      ? ` | ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.createdAt))}`
      : "";
    return `[${role}${idSnippet}${timestamp}]:\n${cleanText}`;
  };
  const windowLines = includedRecentMessages.map(renderMessage);
  let cutByCharLimit = false;
  while (windowLines.join("\n\n").length > 9000) {
    const oldestDiscardableIndex = includedRecentMessages.findIndex((message) =>
      !message.id || !mandatoryIds.has(String(message.id))
    );
    if (oldestDiscardableIndex < 0) break;
    const [droppedMessage] = includedRecentMessages.splice(oldestDiscardableIndex, 1);
    windowLines.splice(oldestDiscardableIndex, 1);
    droppedNonMandatoryKeys.add(messageKey(droppedMessage));
    cutByCharLimit = true;
  }
  const mandatoryContextOverflow = mandatoryRecentMessages.length > 20 || windowLines.join("\n\n").length > 9000;

  const records = new Map<string, OpenAiContextWindowTelemetry["includedMessages"][number]>();
  const previews = new Map<string, OpenAiContextWindowTelemetry["previews"][number]>();
  const addRecord = (message: { id?: string; sender: "user" | "larissa"; text: string; createdAt?: string }, previewText: string) => {
    const id = message.id ? String(message.id) : null;
    const key = id || `anonymous-${records.size}`;
    const sender = message.sender === "larissa" ? "Larissa" as const : "Pretendente" as const;
    const timestamp = typeof message.createdAt === "string" && message.createdAt ? message.createdAt : null;
    records.set(key, { id, sender, timestamp });
    previews.set(key, { id, sender, timestamp, text: previewText.slice(0, 180) });
  };
  for (const message of includedRecentMessages) {
    const text = String(message.text || "").trim();
    addRecord(message, text.length > 600 ? `${text.slice(0, 600)} [...]` : text);
  }
  for (const message of currentInboundMessages) {
    if (message.id && records.has(String(message.id))) continue;
    addRecord({ ...message, sender: "user" }, String(message.text || ""));
  }

  const timestampOf = (message: { timestamp: string | null }) => message.timestamp || "";
  const includedMessages = [...records.values()].sort((a, b) => timestampOf(a).localeCompare(timestampOf(b)));
  const includedKeys = new Set(includedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)));
  const includedMandatoryIds = [...mandatoryIds].filter((id) => includedKeys.has(id));
  const replyTargetsIncludedCount = [...replyTargetIds].filter((id) => includedKeys.has(id)).length;
  const telemetry: OpenAiContextWindowTelemetry = {
    candidateCount: params.contextPipeline?.candidateCount ?? recentMessages.length,
    deduplicatedCount: params.contextPipeline?.deduplicatedCount ?? recentMessages.length,
    budgetedCount: params.contextPipeline?.budgetedCount ?? recentMessages.length,
    includedCount: includedMessages.length,
    includedMessages,
    finalMandatoryMessageIds: includedMandatoryIds,
    mandatoryCount: includedMandatoryIds.length,
    lastLarissaOutboundRequired: Boolean(lastLarissaOutboundId),
    previews: [...previews.values()]
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))
      .slice(-8),
    lastLarissaOutboundId: lastLarissaOutboundId ? String(lastLarissaOutboundId) : null,
    lastLarissaOutboundIncluded: lastLarissaOutboundId
      ? includedKeys.has(String(lastLarissaOutboundId))
      : null,
    replyTargetRequiredCount: replyTargetIds.size,
    replyTargetsIncludedCount,
    currentInboundDuplicateCount: recentMessages.length - priorMessages.length,
    droppedNonMandatoryCount: droppedNonMandatoryKeys.size,
    mandatoryContextOverflow,
    cutByMessageLimit,
    cutByCharLimit,
    windowCharacterCount: windowLines.join("\n\n").length,
    cuts: {
      messageLimit: Boolean(params.contextPipeline?.messageLimitCut || cutByMessageLimit),
      tokenBudget: Boolean(params.contextPipeline?.tokenBudgetCut),
      finalCharacters: cutByCharLimit,
      messageTextLimit: includedRecentMessages.some((message) => String(message.text || "").trim().length > 600),
      mandatoryTokenOverflow: Boolean(params.contextPipeline?.mandatoryTokenOverflow),
    },
  };

  return { text: windowLines.join("\n\n"), includedRecentMessages, telemetry };
}

export function buildOpenAiBrainContextMessageWithObservability(params: RunOpenAiBrainParams): {
  contextMessage: string;
  contextWindow: OpenAiContextWindowTelemetry;
} {
  const {
    currentStageId,
    currentObjectiveId,
    currentObjectiveLabel,
    currentObjectiveDescription,
    inboundMessages,
    contactMemorySummary,
    landmarksSummary,
    liveStateContext,
    recentStyleStateSnippet,
    recentQuestionIntentsSnippet,
  } = params;

  const recentWindow = buildAgentRecentWindow(params);

  const objectiveDesc = currentObjectiveDescription ? ` - Descrição: ${currentObjectiveDescription}` : "";
  const objectiveType = "[OBRIGATÓRIO]";
  const objectiveLine = currentObjectiveId
    ? `${currentObjectiveId} ("${currentObjectiveLabel || "em aberto"}") ${objectiveType}${objectiveDesc}`
    : "Nenhum objetivo pendente";

  const sections: string[] = [
    "# TURNO ATUAL DA CONVERSA",
    `ETAPA ATUAL: ${currentStageId}`,
    `OBJETIVO ATIVO DA ETAPA: ${objectiveLine}`,
  ];

  if (params.nextObjectives && params.nextObjectives.length > 0) {
    sections.push(
      `PRÓXIMOS OBJETIVOS PENDENTES DA ETAPA (usar como gancho natural de continuidade SE o objetivo atual for satisfeito neste turno e não houver assunto mais rico):\n` +
        params.nextObjectives.map((o) => `• ${o.id} ("${o.label}")${o.description ? ` - ${o.description}` : ""}`).join("\n")
    );
  }

  if (liveStateContext) {
    sections.push(`\n## ESTADO VIVO\n${liveStateContext}`);
  }
  if (params.temporalContext) {
    sections.push(`\n${params.temporalContext}`);
  }
  if (params.candidateEvidence?.length) {
    sections.push(`\n## EVIDÊNCIAS CANDIDATAS DE OBJETIVO (NÃO CONCLUEM NADA SOZINHAS)\n${params.candidateEvidence.map((e) => `- objetivo=${e.objectiveId}; mensagem=${e.evidenceMessageId}; evidência=${e.summary}`).join("\n")}`);
  }

  if (recentQuestionIntentsSnippet && recentQuestionIntentsSnippet.trim()) {
    sections.push(`\n## PERGUNTAS RECENTES (SEMANTIC QUESTION INTENTS)\n${recentQuestionIntentsSnippet.trim()}`);
  }

  if (contactMemorySummary) {
    sections.push(`\n## FATOS CONHECIDOS DO PRETENDENTE\n${contactMemorySummary}`);
  }

  if (landmarksSummary) {
    sections.push(`\n## MARCOS HISTÓRICOS DA CONVERSA\n${landmarksSummary}`);
  }

  // A janela final mantém mensagens obrigatórias e remove primeiro o histórico
  // normal mais antigo; a telemetria descreve exatamente o payload montado.
  if (recentWindow.text) sections.push(`\n## JANELA CONVERSACIONAL RECENTE\n${recentWindow.text}`);

  let inboundsText = "[Nenhuma mensagem nova]";
  if (params.currentInboundMessages && params.currentInboundMessages.length > 0) {
    inboundsText = params.currentInboundMessages
      .map((m) => `[MENSAGEM id="${m.id}"${m.createdAt ? ` | ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(m.createdAt))}` : ""}]: "${m.text}"`)
      .join("\n");
  } else if (inboundMessages && inboundMessages.length > 0) {
    inboundsText = inboundMessages.map((msg, i) => `[Mensagem ${i + 1}]: "${msg}"`).join("\n");
  }
  sections.push(`\n## NOVAS MENSAGENS RECEBIDAS NESTE TURNO\n${inboundsText}\n(ATENÇÃO - INBOUND COVERAGE GATE: Leia TODO o lote acima. Não responda apenas à última mensagem. Responda a todas as perguntas diretas e reconheça/reaja a conteúdos substantivos como elogios, revelações e comentários relevantes. Mensagens auxiliares como "sim kkk" são absorvidas pelo contexto.)`);

  if (recentStyleStateSnippet && recentStyleStateSnippet.trim()) {
    sections.push(`\n${recentStyleStateSnippet.trim()}`);
  }

  // Instrução operacional compacta do turno + contrato JSON
  sections.push(
    `\n## INSTRUÇÃO OPERACIONAL DO TURNO
Você opera em TURNO ÚNICO seguindo rigorosamente suas instruções persistentes e o LARISSA_INTERACTION_DNA.

PRIORIDADE CONVERSACIONAL DE CONTINUIDADE (CONNECTION OPPORTUNITY & INBOUND COVERAGE GATES):
Para decidir a resposta e a condução, considere rigorosamente nesta ordem:
1. PERGUNTAS DIRETAS DO PRETENDENTE (responder obrigatoriamente a todas as perguntas diretas presentes no lote; NUNCA trate perguntas normais como invasivas);
2. EMOÇÃO / ASSUNTO IMPORTANTE (desabafo, dor, hospital, família - acolher com carinho antes de tudo);
3. SOCIAL SALIENCE / INTEREST SIGNAL (priorizar gesto dirigido à Larissa, interesse, vulnerabilidade, valores, plano futuro e detalhe humano específico; significado relacional > fato genérico);
4. CONTEÚDO SUBSTANTIVO DO LOTE ATUAL (reconhecer e reagir a elogios, provocações, informações e comentários relevantes);
5. CONNECTION OPPORTUNITY (avaliar se o tópico pessoal tem potencial de conexão; ASSUNTO VIVO COM POTENCIAL DE CONEXÃO > PRÓXIMO CHECKLIST);
6. APROFUNDAR TÓPICO VIVO & JANELA CONVERSACIONAL RECENTE (acompanhar o ritmo sem dead-end fático nem salto brusco);
7. RECIPROCIDADE (compartilhar fato verdadeiro fundamentado da Larissa na PersonaMemory quando houver gancho);
8. OBJETIVOS DA ETAPA (podem avançar DENTRO do assunto vivo quando houver ponte natural; não são uma pauta concorrente);
9. FERRAMENTAS MCP sob demanda se houver dúvida factual ou gancho de afinidade.

Antes de responder, defina bestHook como o maior sinal humano/relacional do lote e derive curiosityOpportunity dele. Em áudios, use a transcrição como texto semântico, escolha 1 ou 2 elementos salientes e reaja a um detalhe específico.

GANCHO HUMANO, ANTI-PAPAGAIO E OBJETIVO:
- Use o fato recém-dito como gancho para acrescentar reação, opinião, humor, conexão verdadeira ou curiosidade; não devolva apenas uma paráfrase. Só retome o fato quando trouxer algo novo. Se o balão apenas reorganiza o que ele disse, reescreva.
- Selecione os ganchos humanos mais fortes do lote; não responda cada mensagem com uma paráfrase. Quando houver dois ganchos relevantes, pode reagir a ambos em 1–3 balões curtos, respeitando o turnContract e sem transformar a conversa em questionário.
- Antes de escolher defer, procure uma ponte semântica entre o assunto atual e o objetivo ativo. Se existir e couber naturalmente, prefira pursue dentro do assunto; não force mudança de tema. Use defer se não houver ponte genuína, se houver prioridade emocional, risco de soar como entrevista ou pergunta excessiva. Não infira fatos não revelados.

${SOCIAL_CUE_AND_DELTA_GUIDANCE}

CHECAGEM PRÉ-FINALIZAÇÃO:
Revise sem expor a revisão: algum balão apenas repete o pretendente ou a Larissa? Algum gancho humano relevante foi ignorado? Há ponte natural com o objetivo que estou adiando? A pergunta nasce do assunto e respeita o turnContract? Reescreva se necessário, mantendo reação, curiosidade e naturalidade.

Avalie o turno, consulte memórias sob demanda se houver incerteza ou gancho real, decida objectiveDecision (pursue, defer, already_satisfied ou none) e gere responses[].

DIRETRIZ DE EVIDÊNCIA:
Se objectiveDecision for "already_satisfied", satisfiedObjectiveId e evidenceMessageId são OBRIGATÓRIOS. O evidenceMessageId DEVE ser exatamente o ID de uma das mensagens de [MENSAGEM id="..."] deste turno. Para pursue, defer ou none, evidenceMessageId deve ser null.

CONTRATO DE SAÍDA JSON FINAL:
Emita EXCLUSIVAMENTE um único objeto JSON final com o seguinte formato:
{
  "action": "reply",
  "objectiveDecision": "pursue" | "defer" | "already_satisfied" | "none",
  "satisfiedObjectiveId": null,
  "evidenceMessageId": null,
  "reasoning": "sua justificativa estratégica sucinta",
  "liveStatePatch": { "lastUserEmotionalTone": "...", "currentTopic": "..." },
  "currentTopic": "tópico atual",
  "bestHook": "gancho principal",
  "curiosityOpportunity": "oportunidade de curiosidade",
  "objectiveBridgeDetected": true,
  "objectiveBridgeEvidence": "trecho curto da mensagem que cria uma ponte natural, ou null",
  "coveredHooks": ["gancho humano efetivamente usado"],
  "ignoredRelevantHooks": [],
  "socialCueInterpretation": { "primaryIntent": "intenção principal", "socialCueType": "direct_compliment" | "vocative" | "explicit_flirt" | "pickup_line" | "mixed" | "none", "socialCueExpression": null, "requiresExplicitAcknowledgement": false },
  "selfFactRepeatedRisk": false,
  "memoryConsulted": true | false,
  "memoryRationale": "justificativa da consulta ou da não consulta",
  "personaMemoryQuery": "query executada se memoryConsulted=true",
  "relevantPersonaFacts": [
    { "fact": "...", "memoryId": "quando disponível", "origin": "persona_memory", "reason": "por que é relevante" }
  ],
  "memoryWrites": {
    "contactFacts": [],
    "quotes": [],
    "episodes": [],
    "speechActs": [],
    "openLoops": []
  },
  "resolvedQuestionIntentIds": ["feeling.miss_previous_place"],
  "questionIntents": [
    {
      "responseIndex": 1,
      "intentKey": "feeling.miss_previous_place",
      "canonicalMeaning": "saber se o pretendente sente falta de morar no lugar anterior",
      "kind": "continuity",
      "target": "pretendente"
    }
  ],
  "turnContract": {
    "directQuestions": [],
    "mustAnswerFirst": true,
    "newQuestionBudget": 1,
    "responseShape": "answer_and_reciprocate",
    "preferNoEmoji": false,
    "maxBalloons": 2
  },
  "responses": [
    "balão 1",
    "balão 2"
  ]
}
Nota: "maxBalloons" varia de 1-2 (turno simples) a 2-4 (lote composto com múltiplos atos: elogio + comentário + pergunta). "directQuestions" lista as perguntas diretas do pretendente. "preferNoEmoji" deve ser true em assuntos sérios/delicados e false nos demais. Em turnos normais, use 0 a 1 emoji; em turnos afetivos, flerte ou lotes de 2-4 balões, podem aparecer até 2 emojis naturais (máximo 2). "resolvedQuestionIntentIds" e "questionIntents" são campos canônicos de continuidade (use [] se nenhuma pergunta for resolvida ou feita). "memoryWrites" é opcional (omita ou deixe vazio se nada novo e durável foi revelado). Os campos objectiveBridgeDetected, objectiveBridgeEvidence, coveredHooks, ignoredRelevantHooks, socialCueInterpretation e selfFactRepeatedRisk são observabilidade opcionais; relate somente o que o plano sustenta, sem inventar evidências. Os campos sociais não acionam lógica de correção no backend.`
  );

  if (params.schemaFeedback) sections.push(`\n## RETRY ESTRUTURAL\nO plano anterior falhou somente no schema: ${params.schemaFeedback}. Reenvie JSON válido sem alterar a estratégia por esse feedback.`);
  return { contextMessage: sections.join("\n"), contextWindow: recentWindow.telemetry };
}

export function buildOpenAiBrainContextMessage(params: RunOpenAiBrainParams): string {
  return buildOpenAiBrainContextMessageWithObservability(params).contextMessage;
}

/**
 * Executa um turno com o OpenAI Agent Brain.
 * Suporta a execução via OpenAI Agents API oficial ou simulação controlada para testes.
 */
export async function runOpenAiBrainTurn(params: RunOpenAiBrainParams): Promise<OpenAiBrainTurnResult> {
  const startTime = Date.now();
  console.log("[Brain] turn_started");

  let apiKey =
    params.apiKey ||
    (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_API_KEY") : process.env.OPENAI_API_KEY);

  let agentId =
    params.agentId ||
    (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_BRAIN_AGENT_ID") : process.env.OPENAI_BRAIN_AGENT_ID);

  if ((!apiKey || !agentId || agentId === "agent_brain_default") && params.supabase) {
    try {
      const { data: configs } = await params.supabase
        .from("instagram_config")
        .select("id, app_secret")
        .in("id", ["openai_api_key", "openai_brain_agent_id"]);

      if (Array.isArray(configs)) {
        for (const cfg of configs) {
          if (cfg.id === "openai_api_key" && !apiKey && cfg.app_secret?.startsWith("sk-")) {
            apiKey = cfg.app_secret.trim();
          }
          if (cfg.id === "openai_brain_agent_id" && (!agentId || agentId === "agent_brain_default") && cfg.app_secret) {
            agentId = cfg.app_secret.trim();
          }
        }
      }
    } catch (_err) {
      // Falha defensiva silenciosa
    }
  }

  agentId = agentId || "agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482";

  const telemetry: OpenAiBrainTurnResult["telemetry"] = {
    agentId,
    toolsRequested: [],
    toolExecutionsCount: 0,
    memoryToolResults: [],
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    agentUsageSessions: [],
    sourcesUsed: [],
    actualMemoryToolCalled: false,
    interactionDnaApplied: true,
    interactionDnaVersion: LARISSA_INTERACTION_DNA_VERSION,
    interactionDnaHash: LARISSA_INTERACTION_DNA_HASH,
    recentStyleStateApplied: Boolean(params.recentStyleStateSnippet),
  };

  const builtContext = buildOpenAiBrainContextMessageWithObservability(params);
  telemetry.contextWindow = builtContext.contextWindow;
  const contextMessage = builtContext.contextMessage;

  // 1. Suporte a runtime de teste injetado (Zero dependência de rede em testes unitários)
  if (params.runtime && typeof params.runtime.callOpenAiAgent === "function") {
    try {
      const mockResult = await params.runtime.callOpenAiAgent({
        agentId,
        context: contextMessage,
        tools: [
          PERSONA_MEMORY_TOOL_DEFINITION,
          CONTACT_MEMORY_TOOL_DEFINITION,
          CONVERSATION_MEMORY_TOOL_DEFINITION,
        ],
        executeTool: async (toolName: string, toolArgs: any) => {
          if (toolName === "persona_memory_search") {
            console.log(`[Brain] tool_requested ${toolName}`);
            telemetry.toolsRequested.push(toolName);
            telemetry.toolExecutionsCount++;
            telemetry.actualMemoryToolCalled = true;
            if (!telemetry.sourcesUsed.includes("persona_memory")) {
              telemetry.sourcesUsed.push("persona_memory");
            }
            const prepared = prepareMemoryToolCall(toolName, toolArgs, params.memoryScopeId);
            const output = prepared.ok
              ? await executePersonaMemoryTool(prepared.arguments, params.supabase)
              : { status: prepared.status, reasonCode: prepared.reasonCode };
            telemetry.memoryToolResults.push({
              toolName,
              status: String((output as any)?.status || ((output as any)?.found ? "success_with_results" : "success_no_results")),
              reasonCode: (output as any)?.reasonCode,
              resultCount: Array.isArray((output as any)?.results) ? (output as any).results.length : 0,
            });
            console.log("[Brain] tool_output_submitted");
            return output;
          }
          if (toolName === "contact_memory_search") {
            console.log(`[Brain] tool_requested ${toolName}`);
            telemetry.toolsRequested.push(toolName);
            telemetry.toolExecutionsCount++;
            telemetry.actualMemoryToolCalled = true;
            if (!telemetry.sourcesUsed.includes("contact_memory")) {
              telemetry.sourcesUsed.push("contact_memory");
            }
            const prepared = prepareMemoryToolCall(toolName, toolArgs, params.memoryScopeId);
            let output: any;
            if (!prepared.ok) {
              output = { status: prepared.status, reasonCode: prepared.reasonCode };
            } else {
              try {
                const resolved = await resolveAgentMemoryScope({ supabase: params.supabase, scopeId: String(prepared.arguments.scope) });
                if (!resolved || resolved.conversationId !== params.conversationId) {
                  output = { status: "tool_error", reasonCode: "memory_scope_invalid" };
                } else {
                  output = await searchContactMemory({
                    supabase: params.supabase,
                    conversationId: resolved.conversationId,
                    query: String(prepared.arguments.query || ""),
                    scopes: prepared.arguments.scopes as string[] | undefined,
                    limit: prepared.arguments.limit as number | undefined,
                  });
                  output = { ...output, status: output.found ? "success_with_results" : "success_no_results" };
                }
              } catch {
                output = { status: "tool_error", reasonCode: "memory_search_failed" };
              }
            }
            telemetry.memoryToolResults.push({ toolName, status: output.status, reasonCode: output.reasonCode, resultCount: output.results?.length || 0 });
            console.log("[Brain] tool_output_submitted");
            return output;
          }
          if (toolName === "conversation_memory_search") {
            console.log(`[Brain] tool_requested ${toolName}`);
            telemetry.toolsRequested.push(toolName);
            telemetry.toolExecutionsCount++;
            telemetry.actualMemoryToolCalled = true;
            if (!telemetry.sourcesUsed.includes("conversation_memory")) {
              telemetry.sourcesUsed.push("conversation_memory");
            }
            const prepared = prepareMemoryToolCall(toolName, toolArgs, params.memoryScopeId);
            let output: any;
            if (!prepared.ok) {
              output = { status: prepared.status, reasonCode: prepared.reasonCode };
            } else {
              try {
                const resolved = await resolveAgentMemoryScope({ supabase: params.supabase, scopeId: String(prepared.arguments.scope) });
                if (!resolved || resolved.conversationId !== params.conversationId) {
                  output = { status: "tool_error", reasonCode: "memory_scope_invalid" };
                } else {
                  output = await searchUnifiedConversationMemory({
                    supabase: params.supabase,
                    conversationId: resolved.conversationId,
                    query: String(prepared.arguments.query || ""),
                    scopes: prepared.arguments.scopes as string[] | undefined,
                    limit: prepared.arguments.limit as number | undefined,
                  });
                  output = { ...output, status: output.found ? "success_with_results" : "success_no_results" };
                }
              } catch {
                output = { status: "tool_error", reasonCode: "memory_search_failed" };
              }
            }
            telemetry.memoryToolResults.push({ toolName, status: output.status, reasonCode: output.reasonCode, resultCount: output.results?.length || 0 });
            console.log("[Brain] tool_output_submitted");
            return output;
          }
          throw new Error(`Tool não suportada: ${toolName}`);
        },
      });

      console.log("[Brain] turn_completed");
      telemetry.durationMs = Date.now() - startTime;
      telemetry.totalTokens = mockResult.tokens || 100;
      telemetry.sessionId = mockResult.sessionId || `sess_runtime_${Date.now()}`;

      const basicValidation = validateConversationBrainPlan(mockResult.plan);
      const invariantValidation = validatePersonaMemoryExecutionInvariant(mockResult.plan, telemetry.actualMemoryToolCalled);
      const responseGenValidation = validateResponseGenerationInvariant(mockResult.plan);
      const validation = !basicValidation.valid
        ? basicValidation
        : !invariantValidation.valid
        ? invariantValidation
        : responseGenValidation;
      if (params.strictOpenAiPilot) {
        if (!mockResult.plan || !validation.valid) {
          if (!params.schemaRetryCount) {
            const retryResult = await runOpenAiBrainTurn({ ...params, schemaRetryCount: 1, schemaFeedback: validation.error || "plan_null" });
            retryResult.telemetry.agentUsageSessions = [...telemetry.agentUsageSessions, ...retryResult.telemetry.agentUsageSessions];
            return retryResult;
          }
          const errMsg = `[OpenAI Agent Strict Mode Mock] Plano inválido ou ausente: ${validation.error || "plan_null"}`;
          console.error(errMsg);
          telemetry.finalPlanParsed = false;
          telemetry.status = "failed";
          return {
            success: false,
            plan: null,
            error: errMsg,
            telemetry,
          };
        }
        telemetry.finalPlanParsed = true;
      } else {
        if (!mockResult.plan || !validation.valid) {
          telemetry.finalPlanParsed = false;
          console.warn(`[OpenAI Agent Mock] Recuperação defensiva ativada (openai_agent_plan_recovery_used): ${validation.error}`);
          mockResult.plan = buildFallbackBrainPlan(typeof mockResult.plan === "string" ? mockResult.plan : "");
        } else {
          telemetry.finalPlanParsed = true;
        }
      }

      return {
        success: true,
        plan: mockResult.plan,
        telemetry,
      };
    } catch (err: any) {
      console.error("[Brain] Erro no runtime mock do OpenAI Agent:", err);
      telemetry.durationMs = Date.now() - startTime;
      return {
        success: false,
        plan: null,
        error: err?.message || String(err),
        telemetry,
      };
    }
  }

  // 2. Chamada real à OpenAI Agents API oficial com Sessions e MCP Remoto
  if (!apiKey) {
    const errMsg = "OPENAI_API_KEY ausente para execução do OpenAI Agent Brain.";
    console.error(`[Brain] ${errMsg}`);
    telemetry.durationMs = Date.now() - startTime;
    telemetry.status = "failed";
    return {
      success: false,
      plan: null,
      error: errMsg,
      telemetry,
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "agents=v1",
  };
  let activeSessionId: string | null = null;
  let latestSessionData: any = null;
  let sessionUsageCollected = false;
  let collectSessionUsage: (() => Promise<void>) | null = null;

  try {
    collectSessionUsage = async () => {
      if (!activeSessionId || sessionUsageCollected) return;
      try {
        const finalSessionRes = await fetch(`https://api.openai.com/v1/agents/sessions/${activeSessionId}`, { headers });
        if (finalSessionRes.ok) latestSessionData = await finalSessionRes.json();
      } catch {}
      const sessionTelemetry = await fetchAgentSessionUsageTelemetry(
        activeSessionId,
        typeof latestSessionData?.agent?.model === "string" ? latestSessionData.agent.model : null,
        latestSessionData?.usage ?? null,
        headers,
      );
      telemetry.agentUsageSessions.push(sessionTelemetry);
      sessionUsageCollected = true;

      const turnUsage = sessionTelemetry.turns.filter((turn) => turn.usage && typeof turn.usage === "object");
      for (const turn of turnUsage) {
        if (turn.id) telemetry.turnId = turn.id;
        const usage = turn.usage as Record<string, any>;
        telemetry.inputTokens += usage.input_tokens ?? usage.prompt_tokens ?? 0;
        telemetry.outputTokens += usage.output_tokens ?? usage.completion_tokens ?? 0;
        telemetry.totalTokens += usage.total_tokens ?? 0;
      }
      if (telemetry.inputTokens === 0 && sessionTelemetry.sessionUsage && typeof sessionTelemetry.sessionUsage === "object") {
        const usage = sessionTelemetry.sessionUsage as Record<string, any>;
        telemetry.inputTokens = usage.input_tokens ?? 0;
        telemetry.outputTokens = usage.output_tokens ?? 0;
        telemetry.totalTokens = usage.total_tokens ?? 0;
      }
    };

    console.log(`[OpenAI Agent] session_created: agentId=${agentId}`);

    const defaultVaultId =
      (typeof Deno !== "undefined"
        ? Deno.env.get("OPENAI_MCP_VAULT_ID")
        : process.env.OPENAI_MCP_VAULT_ID) ||
      "vault_06e9b5cb8d2d4b0a9fb5bfcbd8700af3cfbe57dc729c4c4e8f";

    const sessionVaultIds =
      params.vaultIds && params.vaultIds.length > 0
        ? params.vaultIds
        : (defaultVaultId ? [defaultVaultId] : undefined);

    // Cria a sessão com o contexto compacto do turno e associa o Vault para autenticação MCP
    const sessionPayload: any = {
      agent_id: agentId,
      environment: { type: "none" },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: contextMessage,
            },
          ],
        },
      ],
    };

    if (sessionVaultIds && sessionVaultIds.length > 0) {
      sessionPayload.vault_ids = sessionVaultIds;
    }

    if (params.memoryScopeId) {
      try {
        const agentConfigRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
        if (!agentConfigRes.ok) throw new Error(`HTTP ${agentConfigRes.status}`);
        const agentConfig = await agentConfigRes.json();
        sessionPayload.agent = {
          tools: buildSessionAgentToolsWithMemoryScope(agentConfig?.tools, params.memoryScopeId),
        };
      } catch {
        // A sessão continua. A chamada MCP sem header falhará fechada com memory_scope_missing.
        telemetry.memoryToolResults.push({ toolName: "memory_scope_context", status: "tool_error", reasonCode: "memory_scope_context_unavailable" });
        console.warn("[OpenAI Agent] memory_scope_context_unavailable: sessão criada sem enriquecimento de contexto.");
      }
    }

    const sessionRes = await fetch("https://api.openai.com/v1/agents/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(sessionPayload),
    });

    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      throw new Error(`Falha HTTP ao criar sessão na OpenAI Agents API: ${sessionRes.status} - ${errText}`);
    }

    const sessionData = await sessionRes.json();
    const sessionId = sessionData.id;
    activeSessionId = typeof sessionId === "string" ? sessionId : null;
    latestSessionData = sessionData;
    telemetry.sessionId = sessionId;
    console.log(`[OpenAI Agent] session_created: sessionId=${sessionId}`);
    console.log(`[OpenAI Agent] turn_started: sessionId=${sessionId}`);

    // Polling de conclusão com timeout e backoff controlado (suporta reasoning do gpt-5.6-terra + chamada remota MCP)
    const maxPollAttempts = 45;
    const pollIntervalMs = 2000;
    let finalStatus = sessionData.status;

    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      if (finalStatus === "completed" || finalStatus === "idle") {
        break;
      }
      if (finalStatus === "failed") {
        break;
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const pollRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
      if (!pollRes.ok) {
        console.warn(`[OpenAI Agent] Falha no poll da sessão ${sessionId}: ${pollRes.status}`);
        continue;
      }

      const pollData = await pollRes.json();
      latestSessionData = pollData;
      finalStatus = pollData.status;

      if (finalStatus === "failed") {
        break;
      }
    }

    telemetry.status = finalStatus || "timeout";

    // Usage é coletado inclusive para turns que falharam ou expiraram.
    await collectSessionUsage();

    if (finalStatus === "failed") {
      const errorDetail = latestSessionData?.error ? JSON.stringify(latestSessionData.error) : "Erro desconhecido";
      throw new Error(`OpenAI Agent session falhou: ${errorDetail}`);
    }

    if (finalStatus !== "completed" && finalStatus !== "idle") {
      throw new Error(`OpenAI Agent session não concluiu a tempo (status: ${finalStatus})`);
    }

    console.log(`[OpenAI Agent] turn_completed: status=${finalStatus}`);

    // Busca itens da sessão para identificar resposta do assistente e uso de MCP
    const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
    if (!itemsRes.ok) {
      throw new Error(`Falha ao buscar itens da sessão ${sessionId}: ${itemsRes.status}`);
    }

    const itemsData = await itemsRes.json();
    const items: any[] = itemsData.data || [];

    for (const item of items) {
      const isToolCall = item.type === "tool_call" || item.type === "mcp_call";
      const rawName = String(item.name || "");
      if (isToolCall || rawName.includes("memory_search")) {
        const toolName = rawName || "memory_search";
        console.log(`[MCP] tool_called ${toolName}`);
        telemetry.toolsRequested.push(toolName);
        telemetry.toolExecutionsCount++;
        telemetry.actualMemoryToolCalled = true;
        if (/(?:persona|contact|conversation)_memory_search/.test(toolName)) {
          telemetry.memoryToolResults.push(parseMemoryToolTelemetry(item, toolName));
        }
        if (toolName.includes("persona_memory_search") && !telemetry.sourcesUsed.includes("persona_memory")) {
          telemetry.sourcesUsed.push("persona_memory");
        }
        if (toolName.includes("contact_memory_search") && !telemetry.sourcesUsed.includes("contact_memory")) {
          telemetry.sourcesUsed.push("contact_memory");
        }
        if (toolName.includes("conversation_memory_search") && !telemetry.sourcesUsed.includes("conversation_memory")) {
          telemetry.sourcesUsed.push("conversation_memory");
        }
      }
    }

    // Identifica mensagem final do assistente
    const assistantMsg = [...items].reverse().find(
      (it) => it.type === "message" && it.role === "assistant" && (it.phase === "final_answer" || !it.phase)
    );

    const rawResponseText = assistantMsg?.content?.[0]?.text || "";
    if (!rawResponseText) {
      throw new Error(`Nenhuma mensagem final do assistente encontrada na sessão ${sessionId}. Total itens: ${items.length}`);
    }

    let parsedPlan = extractJsonFromText(rawResponseText);
    const basicValidation = validateConversationBrainPlan(parsedPlan);
    const invariantValidation = validatePersonaMemoryExecutionInvariant(parsedPlan, telemetry.actualMemoryToolCalled);
    const responseGenValidation = validateResponseGenerationInvariant(parsedPlan);
    const questionIntentsValidation = validateQuestionIntentsInvariant(parsedPlan);
    const validation = !basicValidation.valid
      ? basicValidation
      : !invariantValidation.valid
      ? invariantValidation
      : !responseGenValidation.valid
      ? responseGenValidation
      : questionIntentsValidation;

    if (params.strictOpenAiPilot) {
      if (!parsedPlan || !validation.valid) {
        if (!params.schemaRetryCount) {
          const retryResult = await runOpenAiBrainTurn({ ...params, schemaRetryCount: 1, schemaFeedback: validation.error || "JSON estruturado não encontrado" });
          retryResult.telemetry.agentUsageSessions = [...telemetry.agentUsageSessions, ...retryResult.telemetry.agentUsageSessions];
          return retryResult;
        }
        const errorMsg = `[OpenAI Agent Strict Mode] Plano inválido ou ausente retornado pelo Brain: ${validation.error || "JSON estruturado não encontrado"}`;
        console.error(errorMsg);
        telemetry.finalPlanParsed = false;
        telemetry.status = "failed";
        telemetry.durationMs = Date.now() - startTime;
        return {
          success: false,
          plan: null,
          error: errorMsg,
          telemetry,
        };
      }
      telemetry.finalPlanParsed = true;
      console.log(`[OpenAI Agent] plan_validated`);
    } else {
      if (!parsedPlan || !validation.valid) {
        telemetry.finalPlanParsed = false;
        console.warn(`[OpenAI Agent] Recuperação defensiva ativada (openai_agent_plan_recovery_used): ${validation.error}`);
        parsedPlan = recoverSafeBrainPlan(parsedPlan);
        if (!parsedPlan) {
          telemetry.finalPlanParsed = false;
          telemetry.status = "failed";
          return {
            success: false,
            plan: null,
            error: "BRAIN_PLAN_INVALID_NO_SAFE_RESPONSES",
            telemetry,
          };
        }
        telemetry.finalPlanParsed = true;
        telemetry.recoveryMode = "safe_structured_recovery";
      } else {
        telemetry.finalPlanParsed = true;
        console.log(`[OpenAI Agent] plan_validated`);
      }
    }
    telemetry.durationMs = Date.now() - startTime;

    return {
      success: true,
      plan: parsedPlan,
      telemetry,
    };
  } catch (err: any) {
    try {
      await collectSessionUsage?.();
    } catch {}
    console.error("[Brain] Erro durante turno do OpenAI Agent Brain:", err);
    telemetry.durationMs = Date.now() - startTime;
    telemetry.status = "failed";
    return {
      success: false,
      plan: null,
      error: err?.message || String(err),
      telemetry,
    };
  }
}

function extractJsonFromText(raw: string): any {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {}
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
  }
  return null;
}
