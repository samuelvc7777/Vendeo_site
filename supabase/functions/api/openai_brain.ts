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
import { normalizeOpenAiUsage, type AgentSessionUsageTelemetry } from "./openai_usage.ts";
import { MEMORY_SCOPE_HEADER, prepareMemoryToolCall } from "../_shared/memory_tool_context.ts";
import { AGENT_LOCAL_WAIT_MS } from "./autopilot_cycle_safety.ts";
import { buildCanonicalAgentInstructions } from "./openai_agent_instructions.ts";

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

export interface OpenAiAgentFunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, any>;
  defer_loading?: boolean;
}

/**
 * Definição canônica de tool para a OpenAI Agents API (sessions e agents).
 * No schema da Agents API, o parâmetro 'name' é obrigatório no topo do objeto da tool,
 * diferentemente da Chat Completions API legada que envelopava dentro de 'function'.
 */
export const COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION: OpenAiAgentFunctionToolDefinition = {
  type: "function",
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
  defer_loading: false,
};

/**
 * Normaliza qualquer definição de ferramenta de função para o schema real da OpenAI Agents API.
 * Garante que 'name', 'description' e 'parameters' fiquem na raiz do objeto.
 */
export function normalizeToAgentToolDefinition(tool: any): any {
  if (!tool || typeof tool !== "object") return tool;
  if (tool.type === "function") {
    if (typeof tool.name === "string" && tool.name) {
      return {
        type: "function",
        name: tool.name,
        description: tool.description || "",
        parameters: tool.parameters || { type: "object", properties: {} },
        defer_loading: Boolean(tool.defer_loading),
      };
    }
    if (tool.function && typeof tool.function.name === "string") {
      return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description || "",
        parameters: tool.function.parameters || { type: "object", properties: {} },
        defer_loading: false,
      };
    }
  }
  return tool;
}

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

  // Enriquecimento com mensagens de áudio anteriores
  try {
    const { data: msgRows } = await supabase
      .from("instagram_messages")
      .select("metadata")
      .eq("conversation_id", conversationId)
      .limit(100);

    if (msgRows && Array.isArray(msgRows)) {
      for (const m of msgRows) {
        const meta = m.metadata;
        if (meta && typeof meta === "object") {
          const aId = meta.audio_id || meta.audioId || meta.vault_audio_id;
          if (aId) sentAudioIds.add(String(aId));
        }
      }
    }
  } catch {}

  // Enriquecimento com jobs do outbox da conversa
  try {
    const { data: jobRows } = await supabase
      .from("outbox_jobs")
      .select("payload, action")
      .eq("conversation_id", conversationId)
      .limit(50);

    if (jobRows && Array.isArray(jobRows)) {
      for (const j of jobRows) {
        const pAudio = j.payload?.audioId || j.payload?.audio_id || j.action?.audioId || j.action?.audio_id;
        if (pAudio) sentAudioIds.add(String(pAudio));
      }
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
  callId?: string;
  supabase: any;
  conversationId: string;
  searchCofreAudios?: (params: { supabase: any; conversationId: string; query: string; limit?: number }) => Promise<any[]>;
  telemetry: OpenAiBrainTurnResult["telemetry"];
  seenToolCallIds?: Set<string>;
}

export interface AppToolExecutionResult {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  unsupportedTool?: string;
}

export async function executeOpenAiAppTool(params: ExecuteOpenAiAppToolParams): Promise<AppToolExecutionResult> {
  const { toolName, toolArgs, callId, supabase, conversationId, searchCofreAudios, telemetry, seenToolCallIds } = params;

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

  // Deduplicação estrita de tool calls por callId
  if (callId && seenToolCallIds) {
    if (!seenToolCallIds.has(callId)) {
      seenToolCallIds.add(callId);
      telemetry.toolsRequested.push(toolName);
      telemetry.toolExecutionsCount++;
    }
  } else {
    telemetry.toolsRequested.push(toolName);
    telemetry.toolExecutionsCount++;
  }
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
  if (turnContract.mustAnswerFirst === undefined) turnContract.mustAnswerFirst = true;
  if (turnContract.responseShape === undefined) turnContract.responseShape = "natural";
  if (!Array.isArray(turnContract.directQuestions)) turnContract.directQuestions = [];
  if (turnContract.newQuestionBudget === undefined) turnContract.newQuestionBudget = 1;
  if (!Number.isInteger(turnContract.maxBalloons)) turnContract.maxBalloons = 2;
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
  sessionId?: string | null;
  persistentSessionEnabled?: boolean;
  replyTargets?: Record<string, { id: string; sender: string; text: string }>;
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
  sessionEvictionRetried?: boolean;
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
    turnInputTokens?: number | null;
    turnCachedInputTokens?: number | null;
    turnUncachedInputTokens?: number | null;
    turnOutputTokens?: number | null;
    turnReasoningTokens?: number | null;
    turnTotalTokens?: number | null;
    turnCacheWriteTokens?: number | null;
    sessionUsageTotal?: number | null;
    tokenMeasurement?: "turn" | "unavailable";
    agentUsageSessions: AgentSessionUsageTelemetry[];
    sourcesUsed: string[];
    finalPlanParsed?: boolean;
    interactionDnaApplied?: boolean;
    interactionDnaVersion?: string;
    interactionDnaHash?: string;
    recentStyleStateApplied?: boolean;
    contextWindow?: OpenAiContextWindowTelemetry;
    persistentAgentSessionEnabled?: boolean;
    agentSessionReused?: boolean;
    agentSessionCreated?: boolean;
    agentSessionConfigChecked?: boolean;
    agentSessionConfigUpdated?: boolean;
    agentSessionModelRequested?: string | null;
    agentSessionModelActual?: string | null;
    agentSessionReasoningRequested?: string | null;
    agentSessionReasoningActual?: string | null;
    sessionFallbackUsed?: boolean;
    sessionFallbackTriggered?: boolean;
    agentSessionRecoveryTriggered?: boolean;
    agentSessionBootstrapInjected?: boolean;
    agentSessionBootstrapMessageCount?: number;
    agentSessionBootstrapQueryFailed?: boolean;
    agentSessionBootstrapError?: string | null;
    manualRecentHistoryInjected?: boolean;
    contactMemoryInjected?: boolean;
    episodicMemoryInjected?: boolean;
    personaMemoryToolEnabled?: boolean;
    contactMemoryToolEnabled?: boolean;
    conversationMemoryToolEnabled?: boolean;
    audioSearchToolEnabled?: boolean;
    agentInstructionChars?: number;
    agentInstructionEstimatedTokens?: number;
    turnContextChars?: number;
    turnContextEstimatedTokens?: number;
    toolSchemaEstimatedTokens?: number;
    modelGenerationCount?: number;
    agentToolCallCount?: number;
    toolNamesUsed?: string[];
  };
}

/**
 * Recupera histórico recente de instagram_messages (15 a 20 mensagens) exclusivamente
 * para o bootstrap de uma nova sessão (recuperação de sessão perdida ou primeira sessão
 * de conversa pré-existente). Não utiliza nenhuma memória MCP.
 * Utiliza estritamente as colunas canônicas da tabela: id, sender_id, is_mine, text, created_at, timestamp.
 */
export async function fetchSessionRecoveryBootstrap(
  supabase: any,
  conversationId: string,
  excludeMessageIds: string[] = []
): Promise<{
  text: string;
  messageCount: number;
  queryFailed?: boolean;
  errorMessage?: string | null;
}> {
  if (!supabase || !conversationId) {
    return { text: "", messageCount: 0, queryFailed: false, errorMessage: null };
  }

  try {
    const { data: rows, error } = await supabase
      .from("instagram_messages")
      .select("id, sender_id, is_mine, text, created_at, timestamp")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(35);

    if (error) {
      const errMsg = error.message || error.details || String(error);
      console.error("[OpenAI Agent] agent_session_bootstrap_query_failed:", errMsg);
      return {
        text: "",
        messageCount: 0,
        queryFailed: true,
        errorMessage: errMsg.slice(0, 200),
      };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return { text: "", messageCount: 0, queryFailed: false, errorMessage: null };
    }

    const excludeSet = new Set(excludeMessageIds.map((id) => String(id)));
    const filteredRows = rows.filter((r: any) => {
      const idStr = String(r.id || "");
      if (idStr && excludeSet.has(idStr)) return false;
      const content = String(r.text || "").trim();
      return Boolean(content);
    });

    if (filteredRows.length === 0) {
      return { text: "", messageCount: 0, queryFailed: false, errorMessage: null };
    }

    // Recupera entre 15 e 20 mensagens mais recentes (limite de 20)
    const targetSlice = filteredRows.slice(0, 20);

    // Ordena cronologicamente (da mais antiga para a mais recente)
    targetSlice.sort((a: any, b: any) => {
      const tA = new Date(a.created_at || a.timestamp || 0).getTime();
      const tB = new Date(b.created_at || b.timestamp || 0).getTime();
      return tA - tB;
    });

    const lines: string[] = [
      "## RECUPERAÇÃO EXCEPCIONAL DE CONTEXTO",
      "",
      "Histórico recente real da conversa:",
    ];

    for (const msg of targetSlice) {
      const isLarissa = Boolean(
        msg.is_mine ||
        msg.sender_id === "me" ||
        msg.sender_id === "larissa"
      );
      const senderLabel = isLarissa ? "Larissa" : "Pretendente";
      const idPart = msg.id ? ` | id=${msg.id}` : "";
      const text = String(msg.text || "").trim();
      lines.push("");
      lines.push(`[${senderLabel}${idPart}]`);
      lines.push(text);
    }

    return {
      text: lines.join("\n"),
      messageCount: targetSlice.length,
      queryFailed: false,
      errorMessage: null,
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[OpenAI Agent] agent_session_bootstrap_exception:", errMsg);
    return {
      text: "",
      messageCount: 0,
      queryFailed: true,
      errorMessage: errMsg.slice(0, 200),
    };
  }
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
  currentTurnId?: string | null,
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
  return { sessionId, model, sessionUsage, turns, generationIds, currentTurnId };
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

/**
 * Constrói o contexto enxuto e operacional exclusivo para o modo Persistent Agent Session.
 * Não duplica regras conversacionais, DNA, diretrizes anti-papagaio ou instruções da Persona,
 * que já estão consolidadas nas instruções canônicas persistentes do Agent.
 * Reduz em ~90% o payload por turno.
 */
export function buildPersistentTurnContext(params: RunOpenAiBrainParams): string {
  const objectiveDesc = params.currentObjectiveDescription ? ` - Descrição: ${params.currentObjectiveDescription}` : "";
  const objectiveType = "[OBRIGATÓRIO]";
  const objectiveLine = params.currentObjectiveId
    ? `${params.currentObjectiveId} ("${params.currentObjectiveLabel || "em aberto"}") ${objectiveType}${objectiveDesc}`
    : "Nenhum objetivo pendente";

  const sections: string[] = [
    "# TURNO ATUAL DA CONVERSA",
    `ETAPA ATUAL: ${params.currentStageId || "identificacao"}`,
    `OBJETIVO ATIVO DA ETAPA: ${objectiveLine}`,
  ];

  if (params.nextObjectives && params.nextObjectives.length > 0) {
    sections.push(
      `PRÓXIMOS OBJETIVOS PENDENTES DA ETAPA:\n` +
        params.nextObjectives
          .map((o) => `• ${o.id} ("${o.label}")${o.description ? ` - ${o.description}` : ""}`)
          .join("\n")
    );
  }

  if (params.temporalContext) {
    sections.push(`\n${params.temporalContext.trim()}`);
  }

  if (params.candidateEvidence && params.candidateEvidence.length > 0) {
    sections.push(
      `\n## EVIDÊNCIAS CANDIDATAS DE OBJETIVO (NÃO CONCLUEM NADA SOZINHAS)\n${params.candidateEvidence
        .map((e) => `- objetivo=${e.objectiveId}; mensagem=${e.evidenceMessageId}; evidência=${e.summary}`)
        .join("\n")}`
    );
  }

  if (params.replyTargets && Object.keys(params.replyTargets).length > 0) {
    const replyLines = Object.values(params.replyTargets).map(
      (r) => `[RESPONDENDO A ${r.sender.toUpperCase()} id="${r.id}"]: "${r.text}"`
    );
    sections.push(`\n## MENSAGEM REFERENCIADA (REPLY TARGET)\n${replyLines.join("\n")}`);
  }

  let inboundsText = "[Nenhuma mensagem nova]";
  if (params.currentInboundMessages && params.currentInboundMessages.length > 0) {
    inboundsText = params.currentInboundMessages
      .map(
        (m) =>
          `[MENSAGEM id="${m.id}"${
            m.createdAt
              ? ` | ${new Intl.DateTimeFormat("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(m.createdAt))}`
              : ""
          }]: "${m.text}"`
      )
      .join("\n");
  } else if (params.inboundMessages && params.inboundMessages.length > 0) {
    inboundsText = params.inboundMessages.map((msg, i) => `[Mensagem ${i + 1}]: "${msg}"`).join("\n");
  }
  sections.push(
    `\n## NOVAS MENSAGENS RECEBIDAS NESTE TURNO\n${inboundsText}\n(Responda a perguntas diretas e reconheça conteúdos substantivos com naturalidade)`
  );

  if (params.recentStyleStateSnippet && params.recentStyleStateSnippet.trim()) {
    sections.push(`\n${params.recentStyleStateSnippet.trim()}`);
  }

  sections.push(
    `\n## FORMATO DE SAÍDA JSON
Emita EXCLUSIVAMENTE um único objeto JSON:
{
  "action": "reply",
  "objectiveDecision": "pursue" | "defer" | "already_satisfied" | "none",
  "satisfiedObjectiveId": null,
  "evidenceMessageId": null,
  "reasoning": "sua justificativa estratégica sucinta",
  "liveStatePatch": { "currentTopic": "..." },
  "turnContract": { "mustAnswerFirst": true, "newQuestionBudget": 1, "responseShape": "natural", "directQuestions": [], "maxBalloons": 2 },
  "outboundActions": [
    { "type": "text", "text": "..." }
  ],
  "responses": ["..."]
}
(Regras essenciais: se objectiveDecision="already_satisfied", satisfiedObjectiveId e evidenceMessageId devem ser o id exato de uma das mensagens deste turno; senão null. outboundActions aceita type "audio" com audioId válido de cofre_audio_search quando oportuno e natural.)`
  );

  if (params.schemaFeedback) {
    sections.push(`\n## RETRY ESTRUTURAL\nO plano anterior falhou no schema: ${params.schemaFeedback}. Reenvie JSON válido.`);
  }

  return sections.join("\n");
}

export function buildOpenAiBrainContextMessageWithObservability(params: RunOpenAiBrainParams): {
  contextMessage: string;
  contextWindow: OpenAiContextWindowTelemetry;
} {
  const persistentMode = Boolean(params.persistentSessionEnabled);

  if (persistentMode) {
    return {
      contextMessage: buildPersistentTurnContext(params),
      contextWindow: {
        candidateCount: 0,
        deduplicatedCount: 0,
        budgetedCount: 0,
        includedCount: 0,
        includedMessages: [],
        previews: [],
        lastLarissaOutboundId: null,
        finalMandatoryMessageIds: [],
        mandatoryCount: 0,
        lastLarissaOutboundRequired: false,
        lastLarissaOutboundIncluded: null,
        replyTargetRequiredCount: 0,
        replyTargetsIncludedCount: 0,
        currentInboundDuplicateCount: 0,
        droppedNonMandatoryCount: 0,
        mandatoryContextOverflow: false,
        cutByMessageLimit: false,
        cutByCharLimit: false,
        windowCharacterCount: 0,
        cuts: {
          messageLimit: false,
          tokenBudget: false,
          finalCharacters: false,
          messageTextLimit: false,
          mandatoryTokenOverflow: false,
        },
      },
    };
  }

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

  const recentWindow = persistentMode
    ? {
        text: "",
        includedRecentMessages: [],
        telemetry: {
          candidateCount: 0,
          deduplicatedCount: 0,
          budgetedCount: 0,
          includedCount: 0,
          includedMessages: [],
          previews: [],
          lastLarissaOutboundId: null,
          finalMandatoryMessageIds: [],
          mandatoryCount: 0,
          lastLarissaOutboundRequired: false,
          lastLarissaOutboundIncluded: null,
          replyTargetRequiredCount: 0,
          replyTargetsIncludedCount: 0,
          currentInboundDuplicateCount: 0,
          droppedNonMandatoryCount: 0,
          mandatoryContextOverflow: false,
          cutByMessageLimit: false,
          cutByCharLimit: false,
          windowCharacterCount: 0,
          cuts: {
            messageLimit: false,
            tokenBudget: false,
            finalCharacters: false,
            messageTextLimit: false,
            mandatoryTokenOverflow: false,
          },
        },
      }
    : buildAgentRecentWindow(params);

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

  // No modo persistente, liveStateContext conversacional redundante não é injetado
  if (!persistentMode && liveStateContext) {
    sections.push(`\n## ESTADO VIVO\n${liveStateContext}`);
  }
  if (params.temporalContext) {
    sections.push(`\n${params.temporalContext}`);
  }
  if (params.candidateEvidence?.length) {
    sections.push(`\n## EVIDÊNCIAS CANDIDATAS DE OBJETIVO (NÃO CONCLUEM NADA SOZINHAS)\n${params.candidateEvidence.map((e) => `- objetivo=${e.objectiveId}; mensagem=${e.evidenceMessageId}; evidência=${e.summary}`).join("\n")}`);
  }

  // No modo persistente, recentQuestionIntents não é injetado (a Session mantém o contexto natural)
  if (!persistentMode && recentQuestionIntentsSnippet && recentQuestionIntentsSnippet.trim()) {
    sections.push(`\n## PERGUNTAS RECENTES (SEMANTIC QUESTION INTENTS)\n${recentQuestionIntentsSnippet.trim()}`);
  }

  // No modo persistente, ContactMemory e Landmarks não são injetados (a Session é a memória primária)
  if (!persistentMode && contactMemorySummary) {
    sections.push(`\n## FATOS CONHECIDOS DO PRETENDENTE\n${contactMemorySummary}`);
  }

  if (!persistentMode && landmarksSummary) {
    sections.push(`\n## MARCOS HISTÓRICOS DA CONVERSA\n${landmarksSummary}`);
  }

  // Se houver mensagem respondida explicitamente (reply/quote), injeta o reply target
  if (params.replyTargets && Object.keys(params.replyTargets).length > 0) {
    const replyLines = Object.values(params.replyTargets).map(
      (r) => `[RESPONDENDO A ${r.sender.toUpperCase()} id="${r.id}"]: "${r.text}"`
    );
    sections.push(`\n## MENSAGEM REFERENCIADA (REPLY TARGET)\n${replyLines.join("\n")}`);
  }

  // A janela final mantém mensagens obrigatórias no modo legado; no modo persistente, a Session retém o histórico
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
  const persistentMode = Boolean(params.persistentSessionEnabled);

  const telemetry: OpenAiBrainTurnResult["telemetry"] = {
    agentId,
    toolsRequested: [],
    toolExecutionsCount: 0,
    memoryToolResults: [],
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turnInputTokens: null,
    turnCachedInputTokens: null,
    turnUncachedInputTokens: null,
    turnOutputTokens: null,
    turnReasoningTokens: null,
    turnTotalTokens: null,
    turnCacheWriteTokens: null,
    sessionUsageTotal: null,
    tokenMeasurement: "turn",
    agentSessionConfigChecked: false,
    agentSessionConfigUpdated: false,
    agentSessionModelRequested: params.model || null,
    agentSessionModelActual: null,
    agentSessionReasoningRequested: params.reasoningEffort || null,
    agentSessionReasoningActual: null,
    agentUsageSessions: [],
    sourcesUsed: [],
    actualMemoryToolCalled: false,
    interactionDnaApplied: true,
    interactionDnaVersion: LARISSA_INTERACTION_DNA_VERSION,
    interactionDnaHash: LARISSA_INTERACTION_DNA_HASH,
    recentStyleStateApplied: Boolean(params.recentStyleStateSnippet),
    persistentAgentSessionEnabled: persistentMode,
    personaMemoryToolEnabled: !persistentMode,
    contactMemoryToolEnabled: !persistentMode,
    conversationMemoryToolEnabled: !persistentMode,
    audioSearchToolEnabled: true,
    agentSessionRecoveryTriggered: false,
    agentSessionBootstrapInjected: false,
    agentSessionBootstrapMessageCount: 0,
    agentSessionBootstrapQueryFailed: false,
    agentSessionBootstrapError: null,
    agentInstructionChars: undefined,
    agentInstructionEstimatedTokens: undefined,
    turnContextChars: undefined,
    turnContextEstimatedTokens: undefined,
    toolSchemaEstimatedTokens: undefined,
    modelGenerationCount: 1,
    agentToolCallCount: 0,
    toolNamesUsed: [],
  };

  const instructions = buildCanonicalAgentInstructions({ persistentMode });
  const activeToolsForEstimates = persistentMode
    ? [COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION]
    : [
        PERSONA_MEMORY_TOOL_DEFINITION,
        CONTACT_MEMORY_TOOL_DEFINITION,
        CONVERSATION_MEMORY_TOOL_DEFINITION,
        COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
      ];

  telemetry.agentInstructionChars = instructions.length;
  telemetry.agentInstructionEstimatedTokens = Math.ceil(instructions.length / 4);
  telemetry.toolSchemaEstimatedTokens = Math.ceil(JSON.stringify(activeToolsForEstimates).length / 4);

  const builtContext = buildOpenAiBrainContextMessageWithObservability(params);
  telemetry.contextWindow = builtContext.contextWindow;
  telemetry.manualRecentHistoryInjected = !persistentMode && Boolean(builtContext.contextWindow?.includedCount && builtContext.contextWindow.includedCount > 0);
  telemetry.contactMemoryInjected = !persistentMode && Boolean(params.contactMemorySummary);
  telemetry.episodicMemoryInjected = !persistentMode && Boolean(params.landmarksSummary);
  const contextMessage = builtContext.contextMessage;

  telemetry.turnContextChars = contextMessage.length;
  telemetry.turnContextEstimatedTokens = Math.ceil(contextMessage.length / 4);

  // 1. Suporte a runtime de teste injetado (Zero dependência de rede em testes unitários)
  if (params.runtime && typeof params.runtime.callOpenAiAgent === "function") {
    try {
      const activeTools = persistentMode
        ? [COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION]
        : [
            PERSONA_MEMORY_TOOL_DEFINITION,
            CONTACT_MEMORY_TOOL_DEFINITION,
            CONVERSATION_MEMORY_TOOL_DEFINITION,
            COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION,
          ];

      const mockResult = await params.runtime.callOpenAiAgent({
        agentId,
        sessionId: params.sessionId || null,
        context: contextMessage,
        tools: activeTools,
        executeTool: async (toolName: string, toolArgs: any) => {
          if (persistentMode && (toolName === "persona_memory_search" || toolName === "contact_memory_search" || toolName === "conversation_memory_search")) {
            throw new Error(`Tool de memória '${toolName}' desativada no modo de sessão persistente.`);
          }
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
      telemetry.agentToolCallCount = telemetry.toolsRequested.length;
      telemetry.modelGenerationCount = 1 + telemetry.toolsRequested.length;
      telemetry.toolNamesUsed = [...telemetry.toolsRequested];

      if (mockResult.tokenMeasurement === "unavailable" || mockResult.turnUsage === null) {
        telemetry.tokenMeasurement = "unavailable";
        telemetry.turnTotalTokens = null;
        telemetry.inputTokens = 0;
        telemetry.outputTokens = 0;
        telemetry.totalTokens = 0;
      } else if (mockResult.turnUsage || mockResult.usage) {
        const u = mockResult.turnUsage || mockResult.usage;
        const normalized = normalizeOpenAiUsage(u);
        if (normalized) {
          telemetry.turnInputTokens = normalized.inputTokens;
          telemetry.turnCachedInputTokens = normalized.cachedInputTokens;
          telemetry.turnUncachedInputTokens = normalized.uncachedInputTokens;
          telemetry.turnOutputTokens = normalized.outputTokens;
          telemetry.turnReasoningTokens = normalized.reasoningTokens;
          telemetry.turnTotalTokens = normalized.totalTokens;
          telemetry.turnCacheWriteTokens = normalized.cacheWriteTokens;
          telemetry.inputTokens = normalized.inputTokens ?? 0;
          telemetry.outputTokens = normalized.outputTokens ?? 0;
          telemetry.totalTokens = normalized.totalTokens ?? (telemetry.inputTokens + telemetry.outputTokens);
          telemetry.tokenMeasurement = "turn";
        }
      } else if (mockResult.tokens !== undefined) {
        telemetry.totalTokens = mockResult.tokens;
        telemetry.turnTotalTokens = mockResult.tokens;
        telemetry.tokenMeasurement = "turn";
      } else {
        telemetry.tokenMeasurement = "unavailable";
        telemetry.turnTotalTokens = null;
        telemetry.inputTokens = 0;
        telemetry.outputTokens = 0;
        telemetry.totalTokens = 0;
      }

      if (mockResult.sessionUsage) {
        const su = normalizeOpenAiUsage(mockResult.sessionUsage);
        telemetry.sessionUsageTotal = su?.totalTokens ?? null;
      }

      if (params.sessionId) {
        telemetry.sessionId = mockResult.sessionId || params.sessionId;
        telemetry.agentSessionReused = mockResult.sessionCreated ? false : true;
        telemetry.agentSessionCreated = Boolean(mockResult.sessionCreated);
        telemetry.sessionFallbackTriggered = Boolean(mockResult.sessionCreated);
        telemetry.agentSessionRecoveryTriggered = Boolean(mockResult.sessionCreated);
      } else {
        telemetry.sessionId = mockResult.sessionId || `sess_runtime_${Date.now()}`;
        telemetry.agentSessionReused = false;
        telemetry.agentSessionCreated = true;
        telemetry.agentSessionRecoveryTriggered = false;
      }

      const mockDesiredModel = params.model || "gpt-6-sol";
      const mockDesiredReasoning = params.reasoningEffort || "medium";
      telemetry.agentSessionConfigChecked = true;
      telemetry.agentSessionModelRequested = mockDesiredModel;
      telemetry.agentSessionReasoningRequested = mockDesiredReasoning;

      const mockCurrentModel = mockResult.existingSessionConfig?.model || mockResult.currentSessionModel || mockResult.sessionModel || (params.sessionId ? (mockResult.configuredModel || "gpt-6-luna") : mockDesiredModel);
      const mockCurrentReasoning = mockResult.existingSessionConfig?.reasoning?.effort || mockResult.currentSessionReasoning || mockResult.sessionReasoning || (params.sessionId ? (mockResult.configuredReasoning || "xhigh") : mockDesiredReasoning);
      const hasConfigDiff = params.sessionId && (mockCurrentModel !== mockDesiredModel || mockCurrentReasoning !== mockDesiredReasoning);

      telemetry.agentSessionConfigUpdated = Boolean(mockResult.sessionConfigUpdated ?? hasConfigDiff);
      telemetry.agentSessionModelActual = mockResult.executedModel || (telemetry.agentSessionConfigUpdated ? mockDesiredModel : mockCurrentModel);
      telemetry.agentSessionReasoningActual = mockResult.executedReasoning || (telemetry.agentSessionConfigUpdated ? mockDesiredReasoning : mockCurrentReasoning);

      const mockTurnId = mockResult.turnId || `turn_mock_${Date.now()}`;
      telemetry.turnId = mockTurnId;

      if (mockResult.agentUsageSessions) {
        telemetry.agentUsageSessions = mockResult.agentUsageSessions;
      } else {
        telemetry.agentUsageSessions = [
          {
            sessionId: telemetry.sessionId,
            model: telemetry.agentSessionModelActual || mockDesiredModel,
            currentTurnId: mockTurnId,
            turns: [
              {
                id: mockTurnId,
                usage: mockResult.turnUsage || mockResult.usage || {
                  input_tokens: telemetry.inputTokens || 50,
                  output_tokens: telemetry.outputTokens || 50,
                  total_tokens: telemetry.totalTokens || 100,
                },
              },
            ],
            sessionUsage: mockResult.sessionUsage || null,
            generationIds: null,
          },
        ];
      }

      if (persistentMode) {
        if (telemetry.agentSessionCreated) {
          if (mockResult.bootstrapInjected !== undefined) {
            telemetry.agentSessionBootstrapInjected = Boolean(mockResult.bootstrapInjected);
            telemetry.agentSessionBootstrapMessageCount = mockResult.bootstrapMessageCount || 0;
          } else if (params.supabase) {
            const currentInboundIds = (params.currentInboundMessages || []).map((m) => String(m.id)).filter(Boolean);
            const bootstrap = await fetchSessionRecoveryBootstrap(
              params.supabase,
              params.conversationId,
              currentInboundIds
            );
            telemetry.agentSessionBootstrapInjected = bootstrap.messageCount > 0;
            telemetry.agentSessionBootstrapMessageCount = bootstrap.messageCount;
            telemetry.agentSessionBootstrapQueryFailed = Boolean(bootstrap.queryFailed);
            telemetry.agentSessionBootstrapError = bootstrap.errorMessage || null;
          } else {
            telemetry.agentSessionBootstrapInjected = false;
            telemetry.agentSessionBootstrapMessageCount = 0;
            telemetry.agentSessionBootstrapQueryFailed = false;
            telemetry.agentSessionBootstrapError = null;
          }
        } else {
          telemetry.agentSessionBootstrapInjected = false;
          telemetry.agentSessionBootstrapMessageCount = 0;
          telemetry.agentSessionBootstrapQueryFailed = false;
          telemetry.agentSessionBootstrapError = null;
        }
      }

      if (mockResult.telemetry) {
        if (Array.isArray(mockResult.telemetry.authorizedCandidateAudios)) {
          telemetry.authorizedCandidateAudios = mockResult.telemetry.authorizedCandidateAudios;
        }
        if (Array.isArray(mockResult.telemetry.toolsRequested)) {
          telemetry.toolsRequested = [...new Set([...telemetry.toolsRequested, ...mockResult.telemetry.toolsRequested])];
        }
        if (Array.isArray(mockResult.telemetry.sourcesUsed)) {
          telemetry.sourcesUsed = [...new Set([...telemetry.sourcesUsed, ...mockResult.telemetry.sourcesUsed])];
        }
        if (mockResult.telemetry.actualMemoryToolCalled !== undefined) {
          telemetry.actualMemoryToolCalled = Boolean(mockResult.telemetry.actualMemoryToolCalled);
        }
      }

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
  let turnId: string | null = null;
  let turnData: any = null;
  const seenToolCallIds = new Set<string>();
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

      if (latestSessionData?.usage && typeof latestSessionData.usage === "object") {
        telemetry.sessionUsageTotal = Number(latestSessionData.usage.total_tokens ?? 0);
      }

      const sessionTelemetry = await fetchAgentSessionUsageTelemetry(
        activeSessionId,
        typeof latestSessionData?.agent?.model === "string" ? latestSessionData.agent.model : null,
        latestSessionData?.usage ?? null,
        headers,
        usageDeadlineMs,
        turnId,
      );
      telemetry.agentUsageSessions.push(sessionTelemetry);
      sessionUsageCollected = true;

      // ── AUTORIDADE DO TURN ATUAL ──
      // Nunca soma turnos passados nem usa o session.usage total da sessão para o ciclo!
      if (turnId) {
        const matchingTurn = sessionTelemetry.turns.find((turn) => turn.id === turnId);
        if (matchingTurn && matchingTurn.usage && typeof matchingTurn.usage === "object") {
          const u = normalizeOpenAiUsage(matchingTurn.usage);
          telemetry.inputTokens = u.inputTokens;
          telemetry.outputTokens = u.outputTokens;
          telemetry.totalTokens = u.totalTokens;
          telemetry.turnInputTokens = u.inputTokens;
          telemetry.turnCachedInputTokens = u.cachedInputTokens;
          telemetry.turnUncachedInputTokens = u.uncachedInputTokens;
          telemetry.turnOutputTokens = u.outputTokens;
          telemetry.turnReasoningTokens = u.reasoningTokens;
          telemetry.turnTotalTokens = u.totalTokens;
          telemetry.turnCacheWriteTokens = u.cacheWriteTokens;
          telemetry.tokenMeasurement = "turn";
        }
      }

      if (telemetry.turnTotalTokens === null && telemetry.totalTokens === 0) {
        telemetry.tokenMeasurement = "unavailable";
      }
    };

    let sessionId: string | null = params.sessionId || null;
    let sessionData: any = null;
    let sessionReused = false;

    // 1. Se sessionId foi fornecido, verifica sessão, sincroniza config idempotente e tenta reutilizar via POST /events
    if (sessionId) {
      console.log(`[OpenAI Agent] session_reuse_attempt: sessionId=${sessionId}`);

      // Inspeciona sessão existente para validar status e sincronizar modelo/reasoning
      try {
        const currentSessionRes = await fetchOpenAiBounded(
          `https://api.openai.com/v1/agents/sessions/${sessionId}`,
          { headers },
          5_000,
        );

        if (currentSessionRes.ok) {
          sessionData = await currentSessionRes.json();
          latestSessionData = sessionData;

          const sessionStatus = typeof sessionData?.status === "string" ? sessionData.status : null;
          if (sessionStatus && sessionStatus !== "idle") {
            console.warn(`[OpenAI Agent] session_reuse_unhealthy_status (status=${sessionStatus}): sessionId=${sessionId}. A sessão não está idle. Evicting e recriando sessão limpa (recovery)...`);
            sessionId = null;
            telemetry.sessionFallbackTriggered = true;
            telemetry.agentSessionRecoveryTriggered = true;
          }

          const actualModel = typeof sessionData?.agent?.model === "string" ? sessionData.agent.model : null;
          const actualReasoning = typeof sessionData?.agent?.reasoning?.effort === "string" ? sessionData.agent.reasoning.effort : null;
          const requestedModel = params.model || null;
          const requestedReasoning = params.reasoningEffort || null;

          telemetry.agentSessionConfigChecked = true;
          telemetry.agentSessionModelRequested = requestedModel;
          telemetry.agentSessionModelActual = actualModel;
          telemetry.agentSessionReasoningRequested = requestedReasoning;
          telemetry.agentSessionReasoningActual = actualReasoning;

          const modelMismatch = Boolean(sessionId && requestedModel && actualModel !== requestedModel);
          const reasoningMismatch = Boolean(sessionId && requestedReasoning && actualReasoning !== requestedReasoning);

          if (modelMismatch || reasoningMismatch) {
            console.log(`[OpenAI Agent] session_config_divergence_detected: sessionId=${sessionId} actualModel=${actualModel} requestedModel=${requestedModel} actualReasoning=${actualReasoning} requestedReasoning=${requestedReasoning}. Sincronizando...`);

            const updatePayload: Record<string, any> = {
              agent: {
                ...(requestedModel ? { model: requestedModel } : {}),
                ...(requestedReasoning ? { reasoning: { effort: requestedReasoning } } : {}),
              },
            };

            const updateRes = await fetchOpenAiBounded(
              `https://api.openai.com/v1/agents/sessions/${sessionId}`,
              {
                method: "POST",
                headers,
                body: JSON.stringify(updatePayload),
              },
              10_000,
            );

            if (updateRes.ok) {
              const updatedData = await updateRes.json().catch(() => null);
              if (updatedData) latestSessionData = updatedData;
              telemetry.agentSessionConfigUpdated = true;
              telemetry.agentSessionModelActual = requestedModel;
              telemetry.agentSessionReasoningActual = requestedReasoning;
              console.log(`[OpenAI Agent] session_config_updated_success: sessionId=${sessionId} model=${requestedModel} reasoningEffort=${requestedReasoning}`);
            } else {
              const errText = await updateRes.text().catch(() => "");
              console.warn(`[OpenAI Agent] session_config_update_failed (HTTP ${updateRes.status}): ${errText}. Recriando sessão limpa para garantir modelo/reasoning configurado...`);
              // Fail-closed: se a sessão existente não puder ser atualizada, recria limpa para nunca executar modelo divergente
              sessionId = null;
              telemetry.sessionFallbackTriggered = true;
              telemetry.agentSessionRecoveryTriggered = true;
            }
          } else {
            telemetry.agentSessionModelActual = actualModel || requestedModel;
            telemetry.agentSessionReasoningActual = actualReasoning || requestedReasoning;
          }
        } else if (currentSessionRes.status === 404 || currentSessionRes.status === 410) {
          console.warn(`[OpenAI Agent] session_reuse_session_not_found (HTTP ${currentSessionRes.status}): sessionId=${sessionId}. Recriando sessão (recovery)...`);
          sessionId = null;
          telemetry.sessionFallbackTriggered = true;
          telemetry.agentSessionRecoveryTriggered = true;
        }
      } catch (checkErr) {
        console.warn(`[OpenAI Agent] session_reuse_check_error: ${checkErr}`);
      }

      // Se a sessão continua válida após a inspeção, envia o novo evento conversacional
      if (sessionId) {
        const eventPayload = {
          events: [
            {
              type: "agent.session.input.message",
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
            },
          ],
        };

        try {
          const eventRes = await fetchOpenAiBounded(
            `https://api.openai.com/v1/agents/sessions/${sessionId}/events`,
            {
              method: "POST",
              headers,
              body: JSON.stringify(eventPayload),
            },
            15_000,
          );

          if (eventRes.ok || eventRes.status === 202) {
            activeSessionId = sessionId;
            sessionReused = true;
            telemetry.sessionId = sessionId;
            telemetry.agentSessionReused = true;
            telemetry.agentSessionCreated = false;
            telemetry.sessionFallbackTriggered = false;
            telemetry.agentSessionRecoveryTriggered = false;
            telemetry.agentSessionBootstrapInjected = false;
            telemetry.agentSessionBootstrapMessageCount = 0;
            console.log(`[OpenAI Agent] session_reused_success: sessionId=${sessionId}`);

            if (!sessionData) {
              const currentSessionRes = await fetchOpenAiBounded(
                `https://api.openai.com/v1/agents/sessions/${sessionId}`,
                { headers },
                5_000,
              );
              if (currentSessionRes.ok) {
                sessionData = await currentSessionRes.json();
                latestSessionData = sessionData;
              }
            }
          } else {
            const errText = await eventRes.text().catch(() => "");
            console.warn(`[OpenAI Agent] session_reuse_rejected (HTTP ${eventRes.status}): ${errText}. Recriando sessão (fallback)...`);
            sessionId = null;
            telemetry.sessionFallbackTriggered = true;
            telemetry.agentSessionRecoveryTriggered = true;
          }
        } catch (reuseErr) {
          console.warn(`[OpenAI Agent] session_reuse_network_error: ${reuseErr}. Recriando sessão (fallback)...`);
          sessionId = null;
          telemetry.sessionFallbackTriggered = true;
          telemetry.agentSessionRecoveryTriggered = true;
        }
      }
    }

    // 2. Se não havia sessionId ou se o reuso falhou (fallback), cria nova sessão
    if (!sessionId || !sessionReused) {
      console.log(`[OpenAI Agent] session_create_started: agentId=${agentId}`);

      let initialInputText = contextMessage;
      if (persistentMode) {
        const currentInboundIds = (params.currentInboundMessages || []).map((m) => String(m.id)).filter(Boolean);
        const bootstrapRes = await fetchSessionRecoveryBootstrap(
          params.supabase,
          params.conversationId,
          currentInboundIds
        );
        telemetry.agentSessionBootstrapQueryFailed = Boolean(bootstrapRes.queryFailed);
        telemetry.agentSessionBootstrapError = bootstrapRes.errorMessage || null;
        if (bootstrapRes.queryFailed) {
          console.warn(`[OpenAI Agent] agent_session_bootstrap_query_failed=true error=${bootstrapRes.errorMessage}`);
        }
        if (bootstrapRes.messageCount > 0) {
          initialInputText = `${bootstrapRes.text}\n\n---\n\n${contextMessage}`;
          telemetry.agentSessionBootstrapInjected = true;
          telemetry.agentSessionBootstrapMessageCount = bootstrapRes.messageCount;
          console.log(`[OpenAI Agent] session_bootstrap_injected: count=${bootstrapRes.messageCount}, recovery=${telemetry.agentSessionRecoveryTriggered}`);
        } else {
          telemetry.agentSessionBootstrapInjected = false;
          telemetry.agentSessionBootstrapMessageCount = 0;
        }
      }

      const defaultVaultId =
        (typeof Deno !== "undefined"
          ? Deno.env.get("OPENAI_MCP_VAULT_ID")
          : process.env.OPENAI_MCP_VAULT_ID) ||
        "vault_06e9b5cb8d2d4b0a9fb5bfcbd8700af3cfbe57dc729c4c4e8f";

      const sessionVaultIds =
        params.vaultIds && params.vaultIds.length > 0
          ? params.vaultIds
          : (defaultVaultId ? [defaultVaultId] : undefined);

      const sessionPayload: any = {
        agent_id: agentId,
        environment: { type: "none" },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: initialInputText,
              },
            ],
          },
        ],
      };

      if (params.model || params.reasoningEffort) {
        sessionPayload.agent = {
          ...(sessionPayload.agent || {}),
          ...(params.model ? { model: params.model } : {}),
          ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
        };
      }

      if (!persistentMode) {
        if (sessionVaultIds && sessionVaultIds.length > 0) {
          sessionPayload.vault_ids = sessionVaultIds;
        }

        if (params.memoryScopeId) {
          try {
            const agentConfigRes = await fetchOpenAiBounded(`https://api.openai.com/v1/agents/${agentId}`, { headers });
            if (!agentConfigRes.ok) throw new Error(`HTTP ${agentConfigRes.status}`);
            const agentConfig = await agentConfigRes.json();
            sessionPayload.agent = {
              ...(sessionPayload.agent || {}),
              tools: buildSessionAgentToolsWithMemoryScope(agentConfig?.tools, params.memoryScopeId),
            };
          } catch {
            telemetry.memoryToolResults.push({ toolName: "memory_scope_context", status: "tool_error", reasonCode: "memory_scope_context_unavailable" });
            console.warn("[OpenAI Agent] memory_scope_context_unavailable: sessão criada sem enriquecimento de contexto.");
          }
        }
      } else {
        // No modo persistente: utiliza as instruções enxutas persistentes (sem memory tools/gates)
        // e define estritamente [COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION] como tool (schema da Agents API com name na raiz)
        sessionPayload.agent = {
          ...(sessionPayload.agent || {}),
          instructions: buildCanonicalAgentInstructions({ persistentMode: true }),
          tools: [COFRE_AUDIO_SEARCH_AGENT_TOOL_DEFINITION],
        };
      }

      if (sessionPayload.agent?.tools && Array.isArray(sessionPayload.agent.tools)) {
        sessionPayload.agent.tools = sessionPayload.agent.tools.map(normalizeToAgentToolDefinition);
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

      sessionData = await sessionRes.json();
      sessionId = sessionData.id;
      activeSessionId = typeof sessionId === "string" ? sessionId : null;
      latestSessionData = sessionData;
      telemetry.sessionId = sessionId;
      telemetry.agentSessionCreated = true;
      telemetry.agentSessionReused = false;
      telemetry.agentSessionConfigChecked = true;
      telemetry.agentSessionModelRequested = params.model || null;
      telemetry.agentSessionModelActual = sessionData?.agent?.model || params.model || null;
      telemetry.agentSessionReasoningRequested = params.reasoningEffort || null;
      telemetry.agentSessionReasoningActual = sessionData?.agent?.reasoning?.effort || params.reasoningEffort || null;
      telemetry.agentSessionConfigUpdated = false;
      if (telemetry.agentSessionRecoveryTriggered === undefined) {
        telemetry.agentSessionRecoveryTriggered = false;
      }
      console.log(`[OpenAI Agent] session_created: sessionId=${sessionId}, recovery=${telemetry.agentSessionRecoveryTriggered}, bootstrap=${telemetry.agentSessionBootstrapInjected}, count=${telemetry.agentSessionBootstrapMessageCount}`);
    }

    // 1. Identificação inicial do Turn correspondente a esta execução
    const executionStartTimeMs = startTime;
    const pollIntervalMs = 2000;
    const maxPollAttempts = Math.ceil(AGENT_LOCAL_WAIT_MS / pollIntervalMs);
    const waitDeadlineMs = Date.now() + AGENT_LOCAL_WAIT_MS;

    turnId = null;
    turnData = null;
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
              callId,
              seenToolCallIds,
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
      const u = normalizeOpenAiUsage(turnData.usage);
      telemetry.inputTokens = u.inputTokens;
      telemetry.outputTokens = u.outputTokens;
      telemetry.totalTokens = u.totalTokens;
      telemetry.turnInputTokens = u.inputTokens;
      telemetry.turnCachedInputTokens = u.cachedInputTokens;
      telemetry.turnUncachedInputTokens = u.uncachedInputTokens;
      telemetry.turnOutputTokens = u.outputTokens;
      telemetry.turnReasoningTokens = u.reasoningTokens;
      telemetry.turnTotalTokens = u.totalTokens;
      telemetry.turnCacheWriteTokens = u.cacheWriteTokens;
      telemetry.tokenMeasurement = "turn";
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

    // No modo de múltiplos turnos (sessão persistente), isola itens pertencentes ao turnId atual
    const currentTurnItems = turnId ? items.filter((it: any) => it.turn_id === turnId) : items;
    const itemsToProcess = currentTurnItems.length > 0 ? currentTurnItems : items;

    for (const item of itemsToProcess) {
      const isToolCall = item.type === "tool_call" || item.type === "mcp_call";
      const rawName = String(item.name || "");
      if (isToolCall || rawName.includes("memory_search") || rawName === "cofre_audio_search") {
        const toolName = rawName || "tool_call";
        const itemCallId = String(item.call_id || item.id || "");
        if (itemCallId && seenToolCallIds.has(itemCallId)) {
          // Já registrado e processado na execução — deduplica para evitar duplicação em log/UI
          continue;
        }
        if (itemCallId) seenToolCallIds.add(itemCallId);
        console.log(`[Tool] tool_called ${toolName}`);
        telemetry.toolsRequested.push(toolName);
        telemetry.toolExecutionsCount++;
        if (toolName.includes("memory_search")) {
          telemetry.actualMemoryToolCalled = true;
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
        if (toolName === "cofre_audio_search" && !telemetry.sourcesUsed.includes("audio_vault")) {
          telemetry.sourcesUsed.push("audio_vault");
        }
      }
    }

    // Identifica mensagem final do assistente (priorizando o escopo do turno atual)
    let assistantMsg = [...itemsToProcess].reverse().find(
      (it) => it.type === "message" && it.role === "assistant" && (it.phase === "final_answer" || !it.phase)
    );
    if (!assistantMsg && itemsToProcess !== items) {
      assistantMsg = [...items].reverse().find(
        (it) => it.type === "message" && it.role === "assistant" && (it.phase === "final_answer" || !it.phase)
      );
    }

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
        if (sessionReused && !params.sessionEvictionRetried) {
          console.warn(`[OpenAI Agent Strict Mode] Sessão persistente ${sessionId} retornou plano inválido (${validation.error}). Executando Session Eviction e recriando sessão limpa...`);
          telemetry.sessionFallbackTriggered = true;
          telemetry.agentSessionRecoveryTriggered = true;
          const retryResult = await runOpenAiBrainTurn({
            ...params,
            sessionId: null,
            sessionEvictionRetried: true,
          });
          retryResult.telemetry.agentUsageSessions = [...telemetry.agentUsageSessions, ...retryResult.telemetry.agentUsageSessions];
          return retryResult;
        }
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
          if (sessionReused && !params.sessionEvictionRetried) {
            console.warn(`[OpenAI Agent] Sessão persistente ${sessionId} dessincronizada ou sem respostas seguras (${validation.error}). Executando Session Eviction e recriando sessão limpa a partir do banco...`);
            telemetry.sessionFallbackTriggered = true;
            telemetry.agentSessionRecoveryTriggered = true;
            const retryResult = await runOpenAiBrainTurn({
              ...params,
              sessionId: null,
              sessionEvictionRetried: true,
            });
            retryResult.telemetry.agentUsageSessions = [...telemetry.agentUsageSessions, ...retryResult.telemetry.agentUsageSessions];
            return retryResult;
          }
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
    telemetry.agentToolCallCount = telemetry.toolsRequested.length;
    telemetry.modelGenerationCount = 1 + appToolRound;
    telemetry.toolNamesUsed = [...telemetry.toolsRequested];
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
