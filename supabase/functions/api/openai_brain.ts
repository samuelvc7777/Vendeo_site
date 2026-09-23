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
import { AGENT_LOCAL_WAIT_MS } from "./autopilot_cycle_safety.ts";

function fetchOpenAiBounded(url: string | URL, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
}

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
      "Pesquisa a PersonaMemory oficial no Supabase para descobrir fatos reais que possam gerar afinidade, conexão pessoal, reação autêntica, experiência parecida, diferença interessante, comentário pessoal ou grounding factual. Use para profissão, formação, estudos, hobbies, experiências, viagens, rotina, preferências, gostos, hábitos, valores e reação pessoal. Em perguntas amplas sobre identidade ocupacional, profissão ou atividade atual da Persona, busque fatos canônicos e complementares suficientes para representar a categoria de forma completa. Não encerre a busca em um fato parcial quando houver fato canônico mais abrangente relevante. Quando o pretendente revelar um fato pessoal relevante e o contexto não trouxer informação suficiente da Persona sobre o tema, prefira consultar esta ferramenta antes de concluir que não existe conexão. Não invente fatos que podem ser consultados nesta ferramenta.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Termos de busca para encontrar fatos na PersonaMemory (ex: 'profissão trabalho ocupação', 'comida favorita', 'hobbies', 'música', 'onde mora').",
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

export type OutboundAction =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "audio";
      audioId: string;
    };

export const COFRE_AUDIO_SEARCH_TOOL_DEFINITION: OpenAiBrainToolDefinition = {
  type: "function",
  function: {
    name: "cofre_audio_search",
    description:
      "Pesquisa no Cofre de Áudios da Larissa por áudios gravados que possam responder naturalmente a perguntas pessoais do pretendente (hobbies, rotina, gostos, faculdade, tempo livre, preferências). Retorna transcrição, quando usar e título dos áudios candidatos (máx 3). Áudios já enviados nesta conversa são automaticamente excluídos.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Termos de busca sobre o tema pessoal da Larissa a ser respondido em áudio (ex: 'hobbies e tempo livre', 'rotina da faculdade', 'comida preferida').",
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

export async function executeCofreAudioSearch(params: {
  supabase: any;
  conversationId: string;
  query: string;
  limit?: number;
}): Promise<Array<{
  audioId: string;
  title: string;
  transcript: string;
  whenToUse: string;
  duration?: number;
}>> {
  const { supabase, conversationId, query, limit = 3 } = params;
  if (!supabase) return [];

  let audios: any[] = [];
  try {
    const { data: rows } = await supabase
      .from("persona_audios")
      .select("*")
      .eq("enabled", true)
      .order("title", { ascending: true });
    if (Array.isArray(rows)) {
      audios = rows;
    }
  } catch {}

  if (audios.length === 0 && (supabase as any)?.__mockPersonaAudios) {
    audios = (supabase as any).__mockPersonaAudios;
  }

  // 1. Histórico de áudios já enviados nesta conversa (eliminação estrita sem exceção no autopiloto)
  const sentAudioIds = new Set<string>();
  try {
    const { data: histRows } = await supabase
      .from("audio_delivery_history")
      .select("audio_id")
      .eq("conversation_id", conversationId);
    if (Array.isArray(histRows)) {
      histRows.forEach((h: any) => sentAudioIds.add(String(h.audio_id)));
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
      convHist.forEach((h: any) => sentAudioIds.add(String(h.audioId || h.id)));
    }
    const delivered = convRow?.stage_completed_rules?.orchestration?.deliveredAudios || [];
    if (Array.isArray(delivered)) {
      delivered.forEach((d: any) => sentAudioIds.add(typeof d === "string" ? d : String(d?.id)));
    }
  } catch {}

  if ((supabase as any)?.__mockAudioHistory) {
    const mockHist: any[] = (supabase as any).__mockAudioHistory;
    mockHist
      .filter((h) => h.conversationId === conversationId)
      .forEach((h) => sentAudioIds.add(String(h.audioId)));
  }

  const queryTerms = String(query || "")
    .toLowerCase()
    .replace(/[.,;!?]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  // Filtra áudios habilitados, com transcrição, e NUNCA enviados
  const available = audios
    .filter((a) => a.enabled !== false)
    .filter((a) => Boolean(a.transcript && String(a.transcript).trim().length > 0))
    .filter((a) => !sentAudioIds.has(String(a.id)));

  const scored = available.map((a) => {
    const haystack = `${a.title || ""} ${a.transcript || ""} ${a.usage_instruction || a.usageInstruction || ""} ${(a.keywords || []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (haystack.includes(term)) score += 1;
    }
    return {
      audioId: String(a.id),
      title: String(a.title || ""),
      transcript: String(a.transcript || ""),
      whenToUse: String(a.usage_instruction || a.usageInstruction || a.when_to_use || a.title || ""),
      duration: a.duration != null ? Number(a.duration) : undefined,
      score,
    };
  });

  const filtered = queryTerms.length === 0 ? scored : scored.filter((s) => s.score > 0);
  filtered.sort((a, b) => b.score - a.score);

  return filtered.slice(0, Math.min(limit, 3)).map(({ score, ...c }) => c);
}

export const MAX_APP_TOOL_ROUNDS = 4;

export interface ExecuteOpenAiAppToolParams {
  toolName: string;
  toolArgs: any;
  supabase: any;
  conversationId: string;
  searchCofreAudios?: (params: { supabase: any; conversationId: string; query: string; limit?: number }) => Promise<any[]>;
  telemetry: OpenAiBrainTurnResult["telemetry"];
}

export interface AppToolExecutionResult {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  unsupportedTool?: string;
}

export async function executeOpenAiAppTool(params: ExecuteOpenAiAppToolParams): Promise<AppToolExecutionResult> {
  const { toolName, toolArgs, supabase, conversationId, searchCofreAudios, telemetry } = params;

  if (toolName !== "cofre_audio_search") {
    return {
      success: false,
      output: { status: "tool_error", reasonCode: "unsupported_tool", toolName },
      unsupportedTool: toolName,
      error: `agent_app_tool_unsupported:${toolName}`,
    };
  }

  // Validação estrita de argumentos para cofre_audio_search
  let rawQuery: any = toolArgs;
  if (typeof toolArgs === "object" && toolArgs !== null) {
    rawQuery = toolArgs.query;
  }
  if (typeof rawQuery !== "string" || !rawQuery.trim()) {
    console.warn("[OpenAI Agent] cofre_audio_search argumentos inválidos ou query vazia:", toolArgs);
    return {
      success: false,
      output: {
        status: "tool_error",
        reasonCode: "invalid_arguments",
      },
    };
  }

  const query = rawQuery.trim().slice(0, 200);

  telemetry.toolsRequested.push(toolName);
  telemetry.toolExecutionsCount++;
  if (!telemetry.sourcesUsed.includes("cofre_audio")) {
    telemetry.sourcesUsed.push("cofre_audio");
  }

  let candidates: any[] = [];
  try {
    if (typeof searchCofreAudios === "function") {
      candidates = await searchCofreAudios({
        supabase,
        conversationId,
        query,
        limit: 3,
      });
    } else {
      candidates = await executeCofreAudioSearch({
        supabase,
        conversationId,
        query,
        limit: 3,
      });
    }
  } catch (err: any) {
    console.warn("[Brain] Erro na busca de áudio do cofre:", err);
  }

  const sanitizedCandidates = (Array.isArray(candidates) ? candidates : []).slice(0, 3).map((c: any) => ({
    audioId: String(c.audioId || c.audio_id || c.id),
    title: String(c.title || ""),
    transcript: String(c.transcript || c.full_transcript || ""),
    whenToUse: String(c.whenToUse || c.when_to_use || c.usageInstruction || c.usage_instruction || ""),
    ...(c.duration != null ? { duration: Number(c.duration) } : {}),
  }));

  telemetry.authorizedCandidateAudios = sanitizedCandidates;
  console.log(`[Brain] audio_candidates_returned count=${sanitizedCandidates.length}`);

  const output = {
    status: sanitizedCandidates.length > 0 ? "success_with_results" : "success_no_results",
    count: sanitizedCandidates.length,
    candidates: sanitizedCandidates,
  };

  return {
    success: true,
    output,
  };
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
  const validActions = ["reply", "wait", "send_audio"];
  if (!validActions.includes(plan.action)) {
    return {
      valid: false,
      error: `Ação do plano deve ser 'reply' ou 'wait', recebido: '${plan.action}'`,
    };
  }
  if (plan.action === "send_audio") {
    plan.action = "reply";
  }
  if (plan.action === "wait") {
    return { valid: true };
  }

  // Validação e normalização canônica de outboundActions
  if (Array.isArray(plan.outboundActions)) {
    if (plan.outboundActions.length > 4) {
      return {
        valid: false,
        error: "PLAN_INCOMPLETE_RESPONSE_GENERATION: 'outboundActions' excede o limite máximo de 4 ações",
      };
    }
    let audioActionCount = 0;
    for (let i = 0; i < plan.outboundActions.length; i++) {
      const act = plan.outboundActions[i];
      if (!act || typeof act !== "object") {
        return { valid: false, error: `outboundActions[${i}] inválido ou não é um objeto` };
      }
      if (act.type === "text") {
        if (typeof act.text !== "string" || !act.text.trim()) {
          return { valid: false, error: `outboundActions[${i}] de texto deve ter 'text' como string não vazia` };
        }
      } else if (act.type === "audio") {
        audioActionCount++;
        if (audioActionCount > 1) {
          return { valid: false, error: "Limite excedido: máximo 1 áudio automático por turno" };
        }
        if (typeof act.audioId !== "string" || !act.audioId.trim()) {
          return { valid: false, error: `outboundActions[${i}] de áudio deve ter 'audioId' como string não vazia` };
        }
      } else {
        return { valid: false, error: `outboundActions[${i}] tipo inválido: '${act.type}'` };
      }
    }
    // Normalização retrocompatível: popula responses com os textos se responses não veio
    if (!Array.isArray(plan.responses)) {
      plan.responses = plan.outboundActions
        .filter((a: any) => a.type === "text")
        .map((a: any) => a.text);
    }
    const audioAct = plan.outboundActions.find((a: any) => a.type === "audio");
    if (audioAct) {
      plan.selectedAudioId = audioAct.audioId;
      plan.audioId = audioAct.audioId;
    }
  } else {
    // Retrocompatibilidade se outboundActions não foi enviado:
    const audioId = plan.audioId || plan.selectedAudioId;
    const isAudio = plan.action === "send_audio" || Boolean(audioId);
    if (Array.isArray(plan.responses) && plan.responses.length > 0) {
      plan.outboundActions = plan.responses.map((t: string) => ({ type: "text", text: String(t) }));
      if (isAudio && audioId) {
        plan.outboundActions.push({ type: "audio", audioId: String(audioId) });
      }
    } else if (isAudio && audioId) {
      plan.outboundActions = [{ type: "audio", audioId: String(audioId) }];
      plan.responses = [];
    }
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

  const memoryContext = plan.missionPackage.relevantMemoryContext;
  if (memoryContext !== undefined && memoryContext !== null && typeof memoryContext !== "string") {
    const actualType = Array.isArray(memoryContext) ? "array" : typeof memoryContext;
    return {
      valid: false,
      error: `invalid_array_contract: field=missionPackage.relevantMemoryContext actual_type=${actualType} expected_type=string`,
    };
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
  // Se possuir outboundActions válido (inclusive caso somente de áudio)
  if (Array.isArray(plan.outboundActions) && plan.outboundActions.length > 0) {
    if (plan.outboundActions.length > 4) {
      return {
        valid: false,
        error: "PLAN_INCOMPLETE_RESPONSE_GENERATION: 'outboundActions' excede o limite máximo de 4 ações",
      };
    }
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
  searchCofreAudios?: (params: any) => Promise<any[]>;
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
  allowSessionStatusFallback?: boolean;
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
    agentId: string;sessionId?: string;
turnId?: string;
status?: string;
sessionStatus?: string;
turnStatus?: string;
turnStartedAt?: string;
turnCompletedAt?: string;
completionSource?: "turn" | "session" | "pending";
    identifyAttempt?: number;
localWaitDeadlineReached?: boolean;
recoveryMode?: string;
toolsRequested: string[];
    toolExecutionsCount: number;
    memoryToolResults: Array<{ toolName: string; status: string; reasonCode?: string; resultCount?: number }>;
    authorizedCandidateAudios?: Array<{ audioId: string; title: string; transcript: string; whenToUse: string; duration?: number }>;
    audioSearchResults?: { query: string; count: number };
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
  deadlineMs = Date.now() + 15_000,
): Promise<string[] | null> {
  const generationIds = new Set<string>();
  let after: string | null = null;

  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    if (Date.now() >= deadlineMs) return null;
    const url = new URL(`https://api.openai.com/v1/agents/sessions/${sessionId}/traces`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("after", after);

    try {
      const response = await fetchOpenAiBounded(url, { headers }, Math.min(5_000, deadlineMs - Date.now()));
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
  deadlineMs = Date.now() + 15_000,
): Promise<AgentSessionUsageTelemetry> {
  const turns: AgentSessionUsageTelemetry["turns"] = [];
  let after: string | null = null;

  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    if (Date.now() >= deadlineMs) break;
    const url = new URL(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("after", after);

    try {
      const response = await fetchOpenAiBounded(url, { headers }, Math.min(5_000, deadlineMs - Date.now()));
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

  const generationIds = Date.now() < deadlineMs ? await fetchAgentGenerationIds(sessionId, headers, deadlineMs) : null;
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
export function findEligibleExecutionTurn(
  turnsList: any[],
  sessionId: string,
  executionStartTimeMs: number,
): any | null {
  if (!Array.isArray(turnsList) || turnsList.length === 0) return null;

  const eligibleTurns = turnsList.filter((t: any) => {
    if (!t || typeof t !== "object") return false;
    if (t?.session_id && t.session_id !== sessionId) return false;
    // Ignorar subagentes e turnos não-root
    if (t?.subagent_id || t?.parent_turn_id) return false;
    const tCreatedMs = typeof t?.created_at === "number" ? t.created_at * 1000 : Date.parse(t?.created_at || "");
    // Não escolher turn criado antes do início desta execução (limite de 15s de tolerância para drift de relógio)
    if (Number.isFinite(tCreatedMs) && tCreatedMs < executionStartTimeMs - 15_000) return false;
    return typeof t?.id === "string" && Boolean(t.id);
  });

  if (eligibleTurns.length === 0) return null;
  return eligibleTurns[0];
}

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
          if (toolName === "cofre_audio_search") {
            console.log(`[Brain] tool_requested ${toolName}`);
            const appToolRes = await executeOpenAiAppTool({
              toolName,
              toolArgs,
              supabase: params.supabase,
              conversationId: params.conversationId,
              searchCofreAudios: params.searchCofreAudios,
              telemetry,
            });
            if (appToolRes.unsupportedTool) {
              throw new Error(`Tool não suportada: ${toolName}`);
            }
            console.log("[Brain] tool_output_submitted");
            return appToolRes.output;
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
          if (validation.error?.startsWith("invalid_array_contract:")) {
            telemetry.finalPlanParsed = false;
            telemetry.status = "failed";
            return { success: false, plan: null, error: validation.error, telemetry };
          }
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
      const usageDeadlineMs = Date.now() + 15_000;
      try {
        const finalSessionRes = await fetchOpenAiBounded(`https://api.openai.com/v1/agents/sessions/${activeSessionId}`, { headers }, 5_000);
        if (finalSessionRes.ok) latestSessionData = await finalSessionRes.json();
      } catch {}
      const sessionTelemetry = await fetchAgentSessionUsageTelemetry(
        activeSessionId,
        typeof latestSessionData?.agent?.model === "string" ? latestSessionData.agent.model : null,
        latestSessionData?.usage ?? null,
        headers,
        usageDeadlineMs,
      );
      telemetry.agentUsageSessions.push(sessionTelemetry);
      sessionUsageCollected = true;

      if (telemetry.inputTokens === 0 && telemetry.outputTokens === 0) {
        const turnUsage = sessionTelemetry.turns.filter((turn) => turn.usage && typeof turn.usage === "object");
        for (const turn of turnUsage) {
          if (turn.id && !telemetry.turnId) telemetry.turnId = turn.id;
          const usage = turn.usage as Record<string, any>;
          telemetry.inputTokens += usage.input_tokens ?? usage.prompt_tokens ?? 0;
          telemetry.outputTokens += usage.output_tokens ?? usage.completion_tokens ?? 0;
          telemetry.totalTokens += usage.total_tokens ?? 0;
        }
      }
      if (telemetry.inputTokens === 0 && telemetry.outputTokens === 0 && sessionTelemetry.sessionUsage && typeof sessionTelemetry.sessionUsage === "object") {
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
        const agentConfigRes = await fetchOpenAiBounded(`https://api.openai.com/v1/agents/${agentId}`, { headers });
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

    const sessionRes = await fetchOpenAiBounded("https://api.openai.com/v1/agents/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(sessionPayload),
    }, 20_000);

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

    // 1. Identificação inicial do Turn correspondente a esta execução
    const executionStartTimeMs = startTime;
    const maxPollAttempts = 45;
    const pollIntervalMs = 2000;
    const waitDeadlineMs = Date.now() + AGENT_LOCAL_WAIT_MS;

    let turnId: string | null = null;
    let turnData: any = null;
    let identifyAttempt = 0;
    let lastLoggedPendingBucket = -1;
    let appToolRound = 0;
    const appToolCallCache = new Map<string, string>();

    if (typeof sessionData?.current_turn?.id === "string" && sessionData.current_turn.id) {
      turnId = sessionData.current_turn.id;
      turnData = sessionData.current_turn;
    } else if (typeof sessionData?.current_turn_id === "string" && sessionData.current_turn_id) {
      turnId = sessionData.current_turn_id;
    } else if (typeof sessionData?.turn_id === "string" && sessionData.turn_id) {
      turnId = sessionData.turn_id;
    } else if (typeof sessionData?.last_turn_id === "string" && sessionData.last_turn_id) {
      turnId = sessionData.last_turn_id;
    }

    let sessionStatus: string = typeof sessionData.status === "string" ? sessionData.status : "unknown";
    let turnStatus: string = typeof turnData?.status === "string"
      ? turnData.status
      : (turnId ? "in_progress" : "turn_identification_pending");

    if (turnId) {
      telemetry.turnId = turnId;
      telemetry.turnStatus = turnStatus;
      telemetry.completionSource = "turn";
      telemetry.identifyAttempt = 0;
      console.log(`[OpenAI Agent] agent_turn_identified: sessionId=${sessionId} turnId=${turnId} sessionStatus=${sessionStatus} turnStatus=${turnStatus} identifyAttempt=0 elapsedMs=${Date.now() - executionStartTimeMs} remainingWaitMs=${Math.max(0, waitDeadlineMs - Date.now())} completionSource=turn`);
    } else {
      telemetry.turnStatus = "turn_identification_pending";
      telemetry.completionSource = "pending";
      telemetry.identifyAttempt = 0;
      console.log(`[OpenAI Agent] agent_turn_identification_pending: sessionId=${sessionId} turnId=null sessionStatus=${sessionStatus} turnStatus=turn_identification_pending identifyAttempt=0 elapsedMs=${Date.now() - executionStartTimeMs} remainingWaitMs=${Math.max(0, waitDeadlineMs - Date.now())} completionSource=pending`);
      lastLoggedPendingBucket = 0;
    }

    telemetry.sessionStatus = sessionStatus;
    telemetry.turnStatus = turnStatus;
    if (turnData?.created_at) {
      telemetry.turnStartedAt = typeof turnData.created_at === "number" ? new Date(turnData.created_at * 1000).toISOString() : String(turnData.created_at);
    }
    console.log(`[OpenAI Agent] agent_wait_started sessionId=${sessionId} turnId=${turnId || "turn_identification_pending"} maxAttempts=${maxPollAttempts} intervalMs=${pollIntervalMs}`);

    // 2. Polling contínuo e unificado dentro da MESMA janela AGENT_LOCAL_WAIT_MS
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      if (turnStatus === "completed" || ["failed", "cancelled", "expired"].includes(turnStatus)) {
        break;
      }
      if (sessionStatus === "failed" || sessionStatus === "cancelled") {
        break;
      }

      if (Date.now() >= waitDeadlineMs) break;

      // Se turnId ainda não foi identificado, busca continuamente na listagem de /turns
      if (!turnId) {
        identifyAttempt++;
        telemetry.identifyAttempt = identifyAttempt;
        const elapsedMs = Date.now() - executionStartTimeMs;
        const remainingWaitMs = Math.max(0, waitDeadlineMs - Date.now());

        try {
          const listTurnsRes = await fetchOpenAiBounded(
            `https://api.openai.com/v1/agents/sessions/${sessionId}/turns?limit=10&order=desc`,
            { headers },
            Math.min(5000, remainingWaitMs),
          );

          if (listTurnsRes.ok) {
            const listTurnsData = await listTurnsRes.json();
            const turnsList: any[] = Array.isArray(listTurnsData?.data) ? listTurnsData.data : [];
            const matchedTurn = findEligibleExecutionTurn(turnsList, sessionId, executionStartTimeMs);

            if (matchedTurn) {
              turnId = matchedTurn.id;
              turnData = matchedTurn;
              turnStatus = typeof matchedTurn?.status === "string" ? matchedTurn.status : "in_progress";
              telemetry.turnId = turnId;
              telemetry.turnStatus = turnStatus;
              telemetry.completionSource = "turn";
              if (matchedTurn?.created_at) {
                telemetry.turnStartedAt = typeof matchedTurn.created_at === "number" ? new Date(matchedTurn.created_at * 1000).toISOString() : String(matchedTurn.created_at);
              }
              console.log(`[OpenAI Agent] agent_turn_identified: sessionId=${sessionId} turnId=${turnId} sessionStatus=${sessionStatus} turnStatus=${turnStatus} identifyAttempt=${identifyAttempt} elapsedMs=${elapsedMs} remainingWaitMs=${remainingWaitMs} completionSource=turn`);
            } else {
              turnStatus = "turn_identification_pending";
              telemetry.turnStatus = "turn_identification_pending";
              const currentBucket = Math.floor(elapsedMs / 10_000);
              if (currentBucket > lastLoggedPendingBucket) {
                console.log(`[OpenAI Agent] agent_turn_identification_pending: sessionId=${sessionId} turnId=null sessionStatus=${sessionStatus} turnStatus=turn_identification_pending identifyAttempt=${identifyAttempt} elapsedMs=${elapsedMs} remainingWaitMs=${remainingWaitMs} completionSource=pending`);
                lastLoggedPendingBucket = currentBucket;
              }
            }
          } else {
            console.warn(`[OpenAI Agent] turn_identification_http_error: status=${listTurnsRes.status} sessionId=${sessionId} identifyAttempt=${identifyAttempt} elapsedMs=${elapsedMs} remainingWaitMs=${remainingWaitMs}`);
          }
        } catch (findErr) {
          console.warn(`[OpenAI Agent] turn_identification_http_error: sessionId=${sessionId} identifyAttempt=${identifyAttempt} error=${findErr}`);
        }
      }

      // Se turnId já existe (inclusive se identificado nesta mesma iteração acima), faz polling focado no Turn
      if (turnId) {
        try {
          const remainingForTurn = Math.max(0, waitDeadlineMs - Date.now());
          const turnPollRes = await fetchOpenAiBounded(
            `https://api.openai.com/v1/agents/sessions/${sessionId}/turns/${turnId}`,
            { headers },
            Math.min(10_000, remainingForTurn),
          );
          if (turnPollRes.ok) {
            turnData = await turnPollRes.json();
            if (typeof turnData?.status === "string") {
              turnStatus = turnData.status;
            }
          }
        } catch (turnErr) {
          console.warn(`[OpenAI Agent] Poll HTTP sem resposta para turn ${turnId}:`, turnErr);
        }
      }

      if (turnStatus === "completed" || ["failed", "cancelled", "expired"].includes(turnStatus)) {
        break;
      }

      // Polling diagnóstico da Session (a cada 2 iterações, se turnStatus === 'waiting', ou se turnId ainda não foi identificado)
      if (!turnId || attempt % 2 === 1 || turnStatus === "waiting") {
        try {
          const remainingForSession = Math.max(0, waitDeadlineMs - Date.now());
          const sessionPollRes = await fetchOpenAiBounded(
            `https://api.openai.com/v1/agents/sessions/${sessionId}`,
            { headers },
            Math.min(10_000, remainingForSession),
          );
          if (sessionPollRes.ok) {
            latestSessionData = await sessionPollRes.json();
            if (typeof latestSessionData?.status === "string") {
              sessionStatus = latestSessionData.status;
              // NOTA: Se turnId for null, NUNCA assumimos sessionStatus como verdade autoritativa de conclusão!
              // Exceto se params.allowSessionStatusFallback for true (para mocks de testes legados sem turns)
              if (!turnId && params.allowSessionStatusFallback) {
                turnStatus = sessionStatus;
              }
            }
          }
        } catch (sessionErr) {
          console.warn(`[OpenAI Agent] Poll HTTP sem resposta para sessão ${sessionId}:`, sessionErr);
        }
      }

      // LOOP DE APP TOOLS: quando session entra em requires_action, executa a tool e submete o resultado
      if (sessionStatus === "requires_action" && turnId) {
        if (appToolRound >= MAX_APP_TOOL_ROUNDS) {
          const elapsedMs = Date.now() - executionStartTimeMs;
          console.error(`[OpenAI Agent] app_tool_max_rounds_exceeded sessionId=${sessionId} turnId=${turnId} rounds=${appToolRound} elapsedMs=${elapsedMs}`);
          telemetry.status = "requires_action";
          throw new Error(`agent_app_tool_max_rounds_exceeded: excedeu ${MAX_APP_TOOL_ROUNDS} rodadas`);
        }
        appToolRound++;
        const elapsedMs = Date.now() - executionStartTimeMs;
        const remainingWaitMs = Math.max(0, waitDeadlineMs - Date.now());
        console.log(`[OpenAI Agent] agent_requires_action_detected sessionId=${sessionId} turnId=${turnId} round=${appToolRound} elapsedMs=${elapsedMs} remainingWaitMs=${remainingWaitMs}`);

        const requiredActions: any[] = Array.isArray(latestSessionData?.required_actions)
          ? latestSessionData.required_actions
          : [];

        for (const action of requiredActions) {
          if (action?.type !== "function_call") continue;
          const callId = String(action.call_id || "");
          const actionTurnId = String(action.turn_id || "");
          const toolName = String(action.name || "");

          // ── VALIDAÇÃO: action.turn_id DEVE corresponder ao turn acompanhado ──
          if (actionTurnId !== turnId) {
            console.error(`[OpenAI Agent] app_tool_turn_mismatch callId=${callId} actionTurnId=${actionTurnId} trackedTurnId=${turnId}`);
            telemetry.status = "requires_action";
            throw new Error(`agent_app_tool_turn_mismatch: action.turn_id=${actionTurnId} differs from tracked turnId=${turnId}`);
          }

          // ── PARSE seguro de arguments (objeto direto ou string JSON) ──
          let toolArgs: Record<string, any>;
          if (typeof action.arguments === "string") {
            try {
              const parsed = JSON.parse(action.arguments);
              toolArgs = (parsed !== null && typeof parsed === "object") ? parsed : {};
            } catch {
              console.warn(`[OpenAI Agent] app_tool_args_parse_error callId=${callId} toolName=${toolName}`);
              toolArgs = {};
            }
          } else {
            toolArgs = (action.arguments !== null && typeof action.arguments === "object") ? action.arguments : {};
          }


          let outputString: string;
          if (appToolCallCache.has(callId)) {
            outputString = appToolCallCache.get(callId)!;
            console.log(`[OpenAI Agent] app_tool_cache_hit callId=${callId} toolName=${toolName}`);
          } else {
            console.log(`[OpenAI Agent] app_tool_requested: ${toolName} callId=${callId} round=${appToolRound}`);

            const toolRes = await executeOpenAiAppTool({
              toolName,
              toolArgs,
              supabase: params.supabase,
              conversationId: params.conversationId,
              searchCofreAudios: params.searchCofreAudios,
              telemetry,
            });

            if (toolRes.unsupportedTool) {
              telemetry.status = "requires_action";
              throw new Error(toolRes.error || `agent_app_tool_unsupported:${toolName}`);
            }

            outputString = JSON.stringify(toolRes.output);
            appToolCallCache.set(callId, outputString);
            const candidateCount = (toolRes.output as any)?.count ?? 0;
            console.log(`[OpenAI Agent] app_tool_candidates_count=${candidateCount} callId=${callId} round=${appToolRound}`);
          }

          // ── SUBMIT com retry para rede/5xx, FAIL CLOSED para 4xx ──
          // Idempotency-Key estável: enviado como HEADER HTTP, não no JSON body
          const idempotencyKey = `${sessionId}:${actionTurnId}:${callId}`;
          const submitHeaders = {
            ...headers,
            "Idempotency-Key": idempotencyKey,
          };
          const submitBody = JSON.stringify({
            events: [{
              type: "agent.session.input.tool_result",
              turn_id: actionTurnId,
              call_id: callId,
              success: true,
              output: outputString,
            }],
          });

          const MAX_SUBMIT_RETRIES = 3;
          let submitConfirmed = false;
          for (let submitAttempt = 1; submitAttempt <= MAX_SUBMIT_RETRIES; submitAttempt++) {
            const submitRemaining = Math.max(0, waitDeadlineMs - Date.now());
            if (submitRemaining <= 0) {
              console.warn(`[OpenAI Agent] app_tool_submit_deadline_expired callId=${callId} attempt=${submitAttempt}`);
              break;
            }

            let submitRes: { ok: boolean; status: number; text: () => Promise<string> } | null = null;
            let networkError = false;
            try {
              submitRes = await fetchOpenAiBounded(
                `https://api.openai.com/v1/agents/sessions/${sessionId}/events`,
                { method: "POST", headers: submitHeaders, body: submitBody },
                Math.min(10_000, submitRemaining),
              );
            } catch (submitErr) {
              networkError = true;
              console.warn(`[OpenAI Agent] app_tool_submit_network_error callId=${callId} attempt=${submitAttempt}/${MAX_SUBMIT_RETRIES}:`, submitErr);
            }

            if (!networkError && submitRes !== null) {
              if (submitRes.ok || submitRes.status === 202) {
                // Aceito — NÃO reenviar imediatamente, continua polling
                console.log(`[OpenAI Agent] app_tool_output_submitted callId=${callId} toolName=${toolName} round=${appToolRound} attempt=${submitAttempt} idempotencyKey=${idempotencyKey}`);
                submitConfirmed = true;
                break;
              } else if (submitRes.status >= 400 && submitRes.status < 500) {
                // 4xx definitivo — FAIL CLOSED, sem retry
                const errText = await submitRes.text().catch(() => "");
                console.error(`[OpenAI Agent] app_tool_submit_4xx_fatal callId=${callId} status=${submitRes.status} body=${errText}`);
                telemetry.status = "requires_action";
                throw new Error(`agent_app_tool_submit_failed: HTTP ${submitRes.status} ao submeter tool_result para callId=${callId}`);
              } else {
                // 5xx — retry com backoff, reutilizando mesmo output cacheado e mesma idempotency_key
                const errText = await submitRes.text().catch(() => "");
                console.warn(`[OpenAI Agent] app_tool_submit_5xx callId=${callId} status=${submitRes.status} attempt=${submitAttempt}/${MAX_SUBMIT_RETRIES} body=${errText}`);
              }
            }

            // Backoff antes de retry (rede ou 5xx), respeitando o deadline original
            if (submitAttempt < MAX_SUBMIT_RETRIES) {
              const backoffMs = Math.min(2_000 * submitAttempt, Math.max(0, waitDeadlineMs - Date.now()));
              if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
            }
          }

          if (!submitConfirmed) {
            // Esgotou retries sem 202 — polling continua; se agent persistir em requires_action,
            // MAX_APP_TOOL_ROUNDS será atingido e o erro será lançado lá
            console.warn(`[OpenAI Agent] app_tool_submit_unconfirmed callId=${callId} — continuando polling`);
          }
        }

        console.log(`[OpenAI Agent] app_tool_resumed sessionId=${sessionId} turnId=${turnId} round=${appToolRound}`);
        // Não faz break — continua polling normalmente
      }

      if (Date.now() >= waitDeadlineMs) break;
      const sleepMs = Math.min(pollIntervalMs, Math.max(0, waitDeadlineMs - Date.now()));
      if (sleepMs > 0) {
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }

    // 3. LEITURA FINAL AUTORITATIVA antes de declarar timeout
    // Se turnId nunca foi identificado durante o laço, tenta reconciliação final de Session e /turns
    if (!turnId) {
      try {
        const [finalSessionRes, finalTurnsRes] = await Promise.all([
          fetchOpenAiBounded(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers }, 5_000),
          fetchOpenAiBounded(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns?limit=10&order=desc`, { headers }, 5_000),
        ]);
        if (finalSessionRes.ok) {
          latestSessionData = await finalSessionRes.json();
          if (typeof latestSessionData?.status === "string") sessionStatus = latestSessionData.status;
        }
        if (finalTurnsRes.ok) {
          const finalTurnsData = await finalTurnsRes.json();
          const turnsList: any[] = Array.isArray(finalTurnsData?.data) ? finalTurnsData.data : [];
          const matchedTurn = findEligibleExecutionTurn(turnsList, sessionId, executionStartTimeMs);
          if (matchedTurn) {
            turnId = matchedTurn.id;
            turnData = matchedTurn;
            turnStatus = typeof matchedTurn?.status === "string" ? matchedTurn.status : "in_progress";
            telemetry.turnId = turnId;
            telemetry.turnStatus = turnStatus;
            telemetry.completionSource = "turn";
            console.log(`[OpenAI Agent] agent_turn_identified: sessionId=${sessionId} turnId=${turnId} sessionStatus=${sessionStatus} turnStatus=${turnStatus} identifyAttempt=${identifyAttempt + 1} elapsedMs=${Date.now() - executionStartTimeMs} remainingWaitMs=0 completionSource=turn (final_reconciliation)`);
          }
        }
      } catch (finalReconcileErr) {
        console.warn(`[OpenAI Agent] Reconciliação final sem resposta para sessão ${sessionId}:`, finalReconcileErr);
      }
    }

    // Se turnId foi identificado (ou resgatado na reconciliação final) mas ainda não concluiu,
    // faz a leitura final autoritativa direta do Turn
    if (turnId && !["completed", "failed", "cancelled", "expired"].includes(turnStatus)) {
      try {
        const finalTurnRes = await fetchOpenAiBounded(
          `https://api.openai.com/v1/agents/sessions/${sessionId}/turns/${turnId}`,
          { headers },
          5_000,
        );
        if (finalTurnRes.ok) {
          const finalTurnData = await finalTurnRes.json();
          turnData = finalTurnData;
          if (typeof finalTurnData?.status === "string") {
            turnStatus = finalTurnData.status;
          }
        }
      } catch (finalTurnErr) {
        console.warn(`[OpenAI Agent] Leitura final do turn ${turnId} falhou:`, finalTurnErr);
      }
    }

    // 4. Coleta de tokens direto do Turn se presente
    if (turnData?.usage && typeof turnData.usage === "object") {
      const u = turnData.usage;
      telemetry.inputTokens = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
      telemetry.outputTokens = Number(u.output_tokens ?? u.completion_tokens ?? 0);
      telemetry.totalTokens = Number(u.total_tokens ?? (telemetry.inputTokens + telemetry.outputTokens));
    }

    // Coleta usage da sessão e traces (sem dupla contagem de tokens)
    await collectSessionUsage();
    if (typeof latestSessionData?.status === "string") {
      sessionStatus = latestSessionData.status;
    }

    telemetry.sessionStatus = sessionStatus;
    telemetry.turnStatus = turnStatus;

    if (turnData?.completed_at) {
      telemetry.turnCompletedAt = typeof turnData.completed_at === "number" ? new Date(turnData.completed_at * 1000).toISOString() : String(turnData.completed_at);
    }

    // 5. TRATAMENTO FAIL-CLOSED DE TERMINAL STATUS OU AUSÊNCIA DE TURN
    if (turnStatus === "requires_action" || sessionStatus === "requires_action") {
      telemetry.status = "requires_action";
      throw new Error("agent_requires_action_unhandled: sessão permaneceu em requires_action após esgotamento do deadline");
    }

    if (turnStatus === "failed" || sessionStatus === "failed") {
      telemetry.status = "failed";
      const errorDetail = turnData?.error ? JSON.stringify(turnData.error) : latestSessionData?.error ? JSON.stringify(latestSessionData.error) : "Erro desconhecido";
      throw new Error(`agent_terminal_failure: status=failed detail=${errorDetail}`);
    }

    if (turnStatus === "cancelled" || turnStatus === "expired" || sessionStatus === "cancelled") {
      telemetry.status = turnStatus;
      throw new Error(`agent_terminal_failure: status=${turnStatus} detail=Turn ${turnStatus}`);
    }

    // Se após toda a janela de espera e reconciliação final o Turn NUNCA foi identificado:
    if (!turnId) {
      if (!params.allowSessionStatusFallback) {
        telemetry.localWaitDeadlineReached = true;
        telemetry.status = "agent_turn_identification_timeout";
        telemetry.turnStatus = "unidentified";
        telemetry.sessionStatus = sessionStatus;
        telemetry.completionSource = "session";
        const elapsedMs = Date.now() - executionStartTimeMs;
        console.warn(`[OpenAI Agent] agent_turn_identification_timeout: sessionId=${sessionId} sessionStatus=${sessionStatus} elapsedMs=${elapsedMs}`);
        throw new Error(`agent_turn_identification_timeout: sessão ${sessionId} sem turn identificável após timeout de espera`);
      }
      console.warn(`[OpenAI Agent] Fallback simulado legado: sessão ${sessionId} sem turn isolado. Utilizando sessionStatus=${sessionStatus}`);
      turnStatus = sessionStatus;
      telemetry.completionSource = "session";
    }

    // DECISÃO DE CONCLUSÃO: A autoridade final é o TURN!
    // Se o Turn foi completed, é SUCESSO mesmo se a sessão ainda estiver in_progress!
    if (turnStatus !== "completed" && turnStatus !== "idle") {
      telemetry.localWaitDeadlineReached = true;
      telemetry.status = "local_wait_timeout";
      console.warn(`[OpenAI Agent] agent_wait_timeout sessionId=${sessionId} turnId=${turnId || "null"} turnStatus=${turnStatus} sessionStatus=${sessionStatus}`);
      throw new Error(`local_wait_timeout: OpenAI Agent session ainda ${sessionStatus}`);
    }

    telemetry.status = "completed";
    if (turnId) {
      console.log(`[OpenAI Agent] agent_turn_completed: sessionId=${sessionId} turnId=${turnId} status=${turnStatus}`);
    }
    console.log(`[OpenAI Agent] turn_completed: status=${turnStatus}`);

    // 5. Busca e Reconciliação dos Items com bounded retry
    let items: any[] = [];
    for (let itemsAttempt = 0; itemsAttempt < 3; itemsAttempt++) {
      const itemsRes = await fetchOpenAiBounded(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers }, 10_000);
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        items = Array.isArray(itemsData?.data) ? itemsData.data : [];
        const hasAssistantOutput = items.some((it: any) =>
          it?.type === "message" || it?.role === "assistant" || it?.type === "tool_call" || it?.type === "mcp_call"
        );
        if (hasAssistantOutput || items.length > 1) {
          break;
        }
      } else if (itemsAttempt === 2) {
        throw new Error(`Falha ao buscar itens da sessão ${sessionId}: ${itemsRes.status}`);
      }
      if (itemsAttempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

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
        if (validation.error?.startsWith("invalid_array_contract:")) {
          telemetry.finalPlanParsed = false;
          telemetry.status = "failed";
          return { success: false, plan: null, error: validation.error, telemetry };
        }
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
        if (!["cancelled", "expired", "requires_action", "local_wait_timeout", "agent_turn_identification_timeout"].includes(telemetry.status || "")) {
      telemetry.status = err?.message?.includes("agent_turn_identification_timeout")
        ? "agent_turn_identification_timeout"
        : err?.message?.includes("local_wait_timeout")
        ? "local_wait_timeout"
        : err?.message?.includes("requires_action")
        ? "requires_action"
        : "failed";
    }
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
