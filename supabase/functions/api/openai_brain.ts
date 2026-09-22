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
      "Pesquisa a Contact Memory do pretendente (fatos duráveis, entidades citadas e frases marcantes) no Supabase. Permite consultar detalhes já revelados sobre ele (onde mora, profissão, idade, pets, gostos, rotina, planos). REQUER o parâmetro 'scope' (o capability scope do turno).",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Capability Scope efêmero do turno atual (ex: 'scope_...')",
        },
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
      required: ["scope", "query"],
    },
  },
};

export const CONVERSATION_MEMORY_TOOL_DEFINITION: OpenAiBrainToolDefinition = {
  type: "function",
  function: {
    name: "conversation_memory_search",
    description:
      "Pesquisa marcos, episódios passados, atos de fala, combinados/promessas pendentes (open loops) e histórico da conversa no Supabase. Use para evitar perguntas repetidas, honrar combinados e recuperar contexto de turnos anteriores. REQUER o parâmetro 'scope'.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Capability Scope efêmero do turno atual (ex: 'scope_...')",
        },
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
      required: ["scope", "query"],
    },
  },
};

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

export function buildFallbackBrainPlan(
  rawResponseText: string
): any {
  const defaultText = (rawResponseText || "oi, tudo bem?").trim();
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
    reasoning: defaultText.slice(0, 300),
    liveStatePatch: {},
    responses: [defaultText || "oi, tudo bem?"],
    turnContract: defaultContract,
    missionPackage: {
      objectiveDirective: "none",
      draftResponse: defaultText,
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
  currentInboundMessages?: Array<{ id: string; text: string }>;
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
    actualMemoryToolCalled: boolean;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sourcesUsed: string[];
    finalPlanParsed?: boolean;
    interactionDnaApplied?: boolean;
    interactionDnaVersion?: string;
    interactionDnaHash?: string;
    recentStyleStateApplied?: boolean;
  };
}

export function buildOpenAiBrainContextMessage(params: RunOpenAiBrainParams): string {
  const {
    conversationId,
    currentStageId,
    currentObjectiveId,
    currentObjectiveLabel,
    currentObjectiveDescription,
    inboundMessages,
    recentMessages,
    contactMemorySummary,
    landmarksSummary,
    liveStateContext,
    recentStyleStateSnippet,
    memoryScopeId,
    recentQuestionIntentsSnippet,
  } = params;

  const objectiveDesc = currentObjectiveDescription ? ` - Descrição: ${currentObjectiveDescription}` : "";
  const objectiveType = "[OBRIGATÓRIO]";
  const objectiveLine = currentObjectiveId
    ? `${currentObjectiveId} ("${currentObjectiveLabel || "em aberto"}") ${objectiveType}${objectiveDesc}`
    : "Nenhum objetivo pendente";

  const sections: string[] = [
    `# TURNO DA CONVERSA: ${conversationId}`,
    `ETAPA ATUAL: ${currentStageId}`,
    `OBJETIVO ATIVO DA ETAPA: ${objectiveLine}`,
  ];

  if (params.nextObjectives && params.nextObjectives.length > 0) {
    sections.push(
      `PRÓXIMOS OBJETIVOS PENDENTES DA ETAPA (usar como gancho natural de continuidade SE o objetivo atual for satisfeito neste turno e não houver assunto mais rico):\n` +
        params.nextObjectives.map((o) => `• ${o.id} ("${o.label}")${o.description ? ` - ${o.description}` : ""}`).join("\n")
    );
  }

  if (memoryScopeId) {
    sections.push(`MEMORY_SCOPE_ID: "${memoryScopeId}" (Obrigatório usar como parâmetro 'scope' ao chamar contact_memory_search ou conversation_memory_search)`);
  }

  if (liveStateContext) {
    sections.push(`\n## ESTADO VIVO\n${liveStateContext}`);
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

  // ------------------------------------------------------------------------
  // JANELA CONVERSACIONAL RECENTE (Últimas 20 mensagens reais Pretendente + Larissa)
  // ------------------------------------------------------------------------
  const inboundIdSet = new Set<string>();
  if (params.currentInboundMessages && params.currentInboundMessages.length > 0) {
    for (const m of params.currentInboundMessages) {
      if (m.id) inboundIdSet.add(String(m.id));
    }
  }

  // Filtra mensagens que pertencem ao lote atual de inbounds para evitar duplicação
  const priorMessages = recentMessages.filter((m) => {
    if (m.id && inboundIdSet.has(String(m.id))) return false;
    return true;
  });

  // Seleciona as últimas 20 mensagens totais (Pretendente + Larissa somados)
  const last20Messages = priorMessages.slice(-20);

  if (last20Messages.length > 0) {
    // Formata cada mensagem preservando autor, id e texto real (com proteção simples contra mensagens gigantes)
    const windowLines = last20Messages.map((m) => {
      const role = m.sender === "user" ? "Pretendente" : "Larissa";
      const idSnippet = m.id ? ` | id="${m.id}"` : "";
      let cleanText = String(m.text || "").trim();
      if (cleanText.length > 600) {
        cleanText = cleanText.slice(0, 600) + " [...]";
      }
      return `[${role}${idSnippet}]:\n${cleanText}`;
    });

    // Controle de tamanho: preserva prioritariamente as mais recentes se exceder 9000 caracteres
    const MAX_WINDOW_CHARS = 9000;
    while (windowLines.length > 5 && windowLines.join("\n\n").length > MAX_WINDOW_CHARS) {
      windowLines.shift();
    }

    sections.push(`\n## JANELA CONVERSACIONAL RECENTE\n${windowLines.join("\n\n")}`);
  }

  let inboundsText = "[Nenhuma mensagem nova]";
  if (params.currentInboundMessages && params.currentInboundMessages.length > 0) {
    inboundsText = params.currentInboundMessages
      .map((m) => `[MENSAGEM id="${m.id}"]: "${m.text}"`)
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

PRIORIDADE CONVERSACIONAL DE CONTINUIDADE (INBOUND COVERAGE GATE):
Para decidir a resposta e a condução, considere prioritariamente nesta ordem:
1. PERGUNTAS DIRETAS DO PRETENDENTE (responder obrigatoriamente a todas as perguntas diretas presentes no lote das novas mensagens);
2. EMOÇÃO / ASSUNTO IMPORTANTE (desabafo, dor, hospital, família - acolher com carinho antes de tudo);
3. CONTEÚDO SUBSTANTIVO DO LOTE ATUAL (reconhecer e reagir a elogios, comentários relevantes, provocações ou informações novas das novas mensagens);
4. TÓPICO VIVO & JANELA CONVERSACIONAL RECENTE (acompanhar o ritmo, assunto vivo, brincadeiras e manter momentum sem dead-end fático);
5. RECIPROCIDADE (compartilhar fato verdadeiro fundamentado da Larissa na PersonaMemory quando houver gancho);
6. OBJETIVOS DA ETAPA (orientam a direção, mas NUNCA devem apagar um assunto vivo ou ignorar o lote atual);
7. FERRAMENTAS MCP sob demanda se houver dúvida factual ou gancho de afinidade.

CHECAGEM PRÉ-FINALIZAÇÃO:
Antes de emitir responses[], confirme: "Existe alguma pergunta, elogio, informação nova, provocação, plano ou comentário relevante nas NOVAS MENSAGENS que minha resposta ignorou?" Se sim, cubra com afeto e naturalidade.

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
Nota: "maxBalloons" varia de 1-2 (turno simples) a 2-4 (lote composto com múltiplos atos: elogio + comentário + pergunta). "directQuestions" lista as perguntas diretas do pretendente. "resolvedQuestionIntentIds" e "questionIntents" são campos canônicos de continuidade (use [] se nenhuma pergunta for resolvida ou feita). "memoryWrites" é opcional (omita ou deixe vazio se nada novo e durável foi revelado).`
  );

  if (params.schemaFeedback) sections.push(`\n## RETRY ESTRUTURAL\nO plano anterior falhou somente no schema: ${params.schemaFeedback}. Reenvie JSON válido sem alterar a estratégia por esse feedback.`);
  return sections.join("\n");
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
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    sourcesUsed: [],
    actualMemoryToolCalled: false,
    interactionDnaApplied: true,
    interactionDnaVersion: LARISSA_INTERACTION_DNA_VERSION,
    interactionDnaHash: LARISSA_INTERACTION_DNA_HASH,
    recentStyleStateApplied: Boolean(params.recentStyleStateSnippet),
  };

  const contextMessage = buildOpenAiBrainContextMessage(params);

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
            const output = await executePersonaMemoryTool(toolArgs, params.supabase);
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
            const output = await searchContactMemory({
              supabase: params.supabase,
              conversationId: params.conversationId,
              query: toolArgs?.query || "",
              scopes: toolArgs?.scopes,
              limit: toolArgs?.limit,
            });
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
            const output = await searchUnifiedConversationMemory({
              supabase: params.supabase,
              conversationId: params.conversationId,
              query: toolArgs?.query || "",
              scopes: toolArgs?.scopes,
              limit: toolArgs?.limit,
            });
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
            return runOpenAiBrainTurn({ ...params, schemaRetryCount: 1, schemaFeedback: validation.error || "plan_null" });
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

  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "agents=v1",
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
      finalStatus = pollData.status;

      if (finalStatus === "failed") {
        const errorDetail = pollData.error ? JSON.stringify(pollData.error) : "Erro desconhecido";
        throw new Error(`OpenAI Agent session falhou: ${errorDetail}`);
      }
    }

    telemetry.status = finalStatus || "timeout";

    if (finalStatus !== "completed" && finalStatus !== "idle") {
      throw new Error(`OpenAI Agent session não concluiu a tempo (status: ${finalStatus})`);
    }

    console.log(`[OpenAI Agent] turn_completed: status=${finalStatus}`);

    // Busca turnos para métricas de tokens
    try {
      const turnsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`, { headers });
      if (turnsRes.ok) {
        const turnsData = await turnsRes.json();
        const turns = turnsData.data || [];
        for (const t of turns) {
          if (t.id) telemetry.turnId = t.id;
          if (t.usage) {
            telemetry.inputTokens += t.usage.input_tokens || t.usage.prompt_tokens || 0;
            telemetry.outputTokens += t.usage.output_tokens || t.usage.completion_tokens || 0;
            telemetry.totalTokens += t.usage.total_tokens || 0;
          }
        }
      }
    } catch (turnsErr) {
      console.warn(`[OpenAI Agent] Aviso ao coletar métricas de turns:`, turnsErr);
    }

    if (telemetry.inputTokens === 0) {
      try {
        const finalSessionRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
        if (finalSessionRes.ok) {
          const finalSessionData = await finalSessionRes.json();
          if (finalSessionData?.usage) {
            telemetry.inputTokens = finalSessionData.usage.input_tokens || 0;
            telemetry.outputTokens = finalSessionData.usage.output_tokens || 0;
            telemetry.totalTokens = finalSessionData.usage.total_tokens || 0;
          }
        }
      } catch (_sessErr) {}
    }

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
          return runOpenAiBrainTurn({ ...params, schemaRetryCount: 1, schemaFeedback: validation.error || "JSON estruturado não encontrado" });
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
        parsedPlan = buildFallbackBrainPlan(rawResponseText);
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
