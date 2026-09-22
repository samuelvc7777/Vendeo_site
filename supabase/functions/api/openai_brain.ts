// ============================================================================
// OPENAI AGENT BRAIN CLIENT (Fase 1 - Migração Arquitetural)
// Integração desacoplada com o OpenAI Agent Brain e suporte a Function Tools reais.
// ============================================================================

import {
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
  type PersonaMemoryCompactToolOutput,
} from "./persona_memory.ts";

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
  plan: any,
  availableSubagents?: Array<{ id: string; name?: string; mission?: string }>
): PlanValidationResult {
  if (!plan || typeof plan !== "object") {
    return { valid: false, error: "Plano retornado não é um objeto JSON válido" };
  }
  if (plan.action !== "delegate_mission") {
    return { valid: false, error: `Ação do plano deve ser 'delegate_mission', recebido: '${plan.action}'` };
  }
  if (!plan.responsibleSubagent || typeof plan.responsibleSubagent !== "string") {
    return { valid: false, error: "responsibleSubagent ausente ou não é string" };
  }
  if (availableSubagents && availableSubagents.length > 0) {
    const validIds = availableSubagents.map((s) => s.id);
    if (!validIds.includes(plan.responsibleSubagent)) {
      return {
        valid: false,
        error: `responsibleSubagent '${plan.responsibleSubagent}' não pertence aos subagentes disponíveis: [${validIds.join(", ")}]`,
      };
    }
  }
  if (!plan.missionPackage || typeof plan.missionPackage !== "object") {
    return { valid: false, error: "missionPackage ausente ou inválido no plano" };
  }
  const turnContract = plan.missionPackage.turnContract;
  if (!turnContract || typeof turnContract !== "object") {
    return { valid: false, error: "turnContract ausente ou inválido em missionPackage" };
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

export function buildFallbackBrainPlan(
  rawResponseText: string,
  availableSubagents?: Array<{ id: string }>
): any {
  const targetSubagent = availableSubagents?.[0]?.id || "subagent_conexao_inicial";
  return {
    action: "delegate_mission",
    responsibleSubagent: targetSubagent,
    objectiveDecision: "none",
    reasoning: (rawResponseText || "").slice(0, 300),
    liveStatePatch: {},
    missionPackage: {
      subagentId: targetSubagent,
      objectiveDirective: "none",
      draftResponse: rawResponseText || "",
      turnContract: {
        directQuestions: [],
        mustAnswerFirst: true,
        newQuestionBudget: 1,
        responseShape: "answer_and_reciprocate",
        preferNoEmoji: false,
        maxBalloons: 2,
      },
    },
  };
}

export interface RunOpenAiBrainParams {
  supabase: any;
  conversationId: string;
  currentStageId: string;
  currentObjectiveId?: string | null;
  currentObjectiveLabel?: string | null;
  inboundMessages: string[];
  recentMessages: Array<{ sender: "user" | "larissa"; text: string; createdAt?: string }>;
  contactMemorySummary?: string;
  landmarksSummary?: string;
  liveStateContext?: string;
  availableSubagents: Array<{ id: string; name: string; mission: string }>;
  agentId?: string;
  apiKey?: string;
  signal?: AbortSignal;
  runtime?: any;
  strictOpenAiPilot?: boolean;
  vaultIds?: string[];
  candidateEvidence?: Array<{ objectiveId: string; evidenceMessageId: string; summary: string }>;
  schemaRetryCount?: number;
  schemaFeedback?: string;
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
  };
}

export function buildOpenAiBrainContextMessage(params: RunOpenAiBrainParams): string {
  const {
    conversationId,
    currentStageId,
    currentObjectiveId,
    currentObjectiveLabel,
    inboundMessages,
    recentMessages,
    contactMemorySummary,
    landmarksSummary,
    liveStateContext,
    availableSubagents,
  } = params;

  const sections: string[] = [
    `# TURNO DA CONVERSA: ${conversationId}`,
    `ETAPA ATUAL: ${currentStageId}`,
    `OBJETIVO DA ETAPA: ${currentObjectiveId ? `${currentObjectiveId} (${currentObjectiveLabel || "em aberto"})` : "Nenhum objetivo pendente"}`,
  ];

  if (liveStateContext) {
    sections.push(`\n## ESTADO VIVO\n${liveStateContext}`);
  }
  if (params.candidateEvidence?.length) {
    sections.push(`\n## EVIDÊNCIAS CANDIDATAS DE OBJETIVO (NÃO CONCLUEM NADA SOZINHAS)\n${params.candidateEvidence.map((e) => `- objetivo=${e.objectiveId}; mensagem=${e.evidenceMessageId}; evidência=${e.summary}`).join("\n")}`);
  }

  if (contactMemorySummary) {
    sections.push(`\n## FATOS CONHECIDOS DO PRETENDENTE\n${contactMemorySummary}`);
  }

  if (landmarksSummary) {
    sections.push(`\n## MARCOS HISTÓRICOS DA CONVERSA\n${landmarksSummary}`);
  }

  const historyLines = recentMessages.slice(-6).map((m) => {
    const role = m.sender === "user" ? "Pretendente" : "Larissa";
    return `[${role}]: ${m.text}`;
  });
  if (historyLines.length > 0) {
    sections.push(`\n## HISTÓRICO RECENTE\n${historyLines.join("\n")}`);
  }

  const inbounds = inboundMessages.map((msg, i) => `[Mensagem ${i + 1}]: "${msg}"`).join("\n");
  sections.push(`\n## NOVAS MENSAGENS RECEBIDAS NESTE TURNO\n${inbounds || "[Nenhuma mensagem nova]"}`);

  const subagentCards = availableSubagents.map(
    (s) => `- ID: "${s.id}" | Nome: "${s.name}" | Missão: ${s.mission}`
  );
  sections.push(`\n## SUBAGENTES DISPONÍVEIS\n${subagentCards.join("\n")}`);

  sections.push(
    `\n## INSTRUÇÃO DE DECISÃO E REGRAS MANDATÓRIAS
Você é o Conversation Brain da Larissa. Sua função é:
1. Avaliar a intenção do pretendente nas novas mensagens.
2. AFFINITY CHECK (OBRIGATÓRIO): Você não conhece toda a PersonaMemory carregada de antemão. Portanto, ausência de um fato no contexto atual não prova que tal fato não existe na memória. Quando o pretendente revelar um fato pessoal substantivo sobre profissão, formação/estudo, hobby, viagem, rotina, gosto, preferência, comida, música, filmes, família, valores, religião, relacionamento, lugar, experiência marcante, plano futuro ou hábito, e o contexto não tiver informação suficiente da Larissa sobre o tema, faça UMA busca breve em persona_memory_search ANTES de concluir que não existe afinidade ou conexão pessoal relevante. Se houver mais de um gancho, pesquise o assunto principal em uma única query abrangente; máximo recomendado: 1 busca PersonaMemory por turno. Não use a ferramenta para saudações triviais, mensagens operacionais, nem quando emoção ou urgência exigir apenas acolhimento e a busca não agregar valor.
3. TOOL EXECUTION INVARIANT: quando decidir que uma ferramenta é necessária para produzir o BrainPlan, EXECUTE a ferramenta antes de emitir o plano final. Nunca descreva uma chamada futura como texto. A sequência obrigatória é DECIDIR BUSCAR → EXECUTAR TOOL → RECEBER RESULTADO → ANALISAR → SELECIONAR FATOS → EMITIR BRAINPLAN FINAL. personaMemoryQuery é apenas telemetria de uma query já executada, nunca uma proposta futura. Se memoryConsulted=true ou personaMemoryQuery estiver preenchido, persona_memory_search já deve ter acontecido. O executor/subagente nunca consulta PersonaMemory: receba somente relevantPersonaFacts já resolvidos. Se não era necessário consultar, use memoryConsulted=false e dê uma memoryRationale concreta; nunca alegue que não existe fato da Larissa sem pesquisa.
4. REGRA DE GROUNDING RIGOROSA (CRÍTICA):
   - NUNCA declare nem deduza que a Larissa NÃO faz algo, NÃO gosta, NUNCA foi ou NÃO pratica uma atividade apenas pela ausência de fatos na PersonaMemory.
   - Ausência de evidência NÃO é fato negativo!
   - Se não houver fato, trate como desconhecido e não atribua experiência, gosto, medo ou opinião à Larissa.
   - JAMAIS declare categoricamente negações falsas como 'nunca andei de moto', 'não gosto disso' ou 'não pratico nada disso'.
5. Priorize perguntas diretas e desabafos. Objetivos são intenções de longo prazo: adie-os quando o momento humano pedir acolhimento; marque already_satisfied apenas se a mensagem atual realmente trouxer a evidência. Pergunte somente quando houver gancho específico e curiosidade genuína — nunca para preencher checklist.
6. Escolha responsibleSubagent somente entre os SUBAGENTES DISPONÍVEIS. Sua escolha será validada sem substituição automática.
7. Ao concluir a estratégia, emita a decisão final delegando a missão para um subagente em JSON estruturado com o formato:
{
  "action": "delegate_mission",
  "responsibleSubagent": "id_do_subagente",
  "objectiveDecision": "pursue" | "defer" | "already_satisfied" | "none",
  "satisfiedObjectiveId": "id_se_cumprido",
  "liveStatePatch": { "lastUserEmotionalTone": "...", "currentTopic": "..." },
  "reasoning": "sua justificativa",
  "missionPackage": {
    "subagentId": "id_do_subagente",
    "objectiveDirective": "pursue" | "defer" | "already_satisfied" | "none",
    "conversationIntent": "...",
    "emotionalTone": "...",
    "currentTopic": "...",
    "bestHook": "...",
    "curiosityOpportunity": "...",
    "questionRecommendation": "none | pergunta específica e natural",
    "relevantPersonaFacts": [{ "fact": "...", "memoryId": "quando disponível", "origin": "persona_memory", "reason": "por que é relevante" }],
    "memoryConsulted": true | false,
    "memoryRationale": "se false em fato pessoal substantivo, explique uma prioridade concreta do turno; nunca alegue ausência de fato da Larissa sem ter pesquisado",
    "turnContract": {
      "directQuestions": [],
      "mustAnswerFirst": true,
      "newQuestionBudget": 1,
      "responseShape": "answer_and_reciprocate",
      "preferNoEmoji": false,
      "maxBalloons": 2
    }
  }
}`
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
  };

  const contextMessage = buildOpenAiBrainContextMessage(params);

  // 1. Suporte a runtime de teste injetado (Zero dependência de rede em testes unitários)
  if (params.runtime && typeof params.runtime.callOpenAiAgent === "function") {
    try {
      const mockResult = await params.runtime.callOpenAiAgent({
        agentId,
        context: contextMessage,
        tools: [PERSONA_MEMORY_TOOL_DEFINITION],
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
          throw new Error(`Tool não suportada: ${toolName}`);
        },
      });

      console.log("[Brain] turn_completed");
      telemetry.durationMs = Date.now() - startTime;
      telemetry.totalTokens = mockResult.tokens || 100;
      telemetry.sessionId = mockResult.sessionId || `sess_runtime_${Date.now()}`;

      const basicValidation = validateConversationBrainPlan(mockResult.plan, params.availableSubagents);
      const invariantValidation = validatePersonaMemoryExecutionInvariant(mockResult.plan, telemetry.actualMemoryToolCalled);
      const validation = !basicValidation.valid ? basicValidation : invariantValidation;
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
          mockResult.plan = buildFallbackBrainPlan(typeof mockResult.plan === "string" ? mockResult.plan : "", params.availableSubagents);
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

    // Busca itens da sessão para identificar resposta do assistente e uso de MCP
    const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
    if (!itemsRes.ok) {
      throw new Error(`Falha ao buscar itens da sessão ${sessionId}: ${itemsRes.status}`);
    }

    const itemsData = await itemsRes.json();
    const items: any[] = itemsData.data || [];

    for (const item of items) {
      if (
        item.type === "tool_call" ||
        item.type === "mcp_call" ||
        item.name === "persona_memory_search" ||
        item.name?.includes("persona_memory_search")
      ) {
        const toolName = item.name || "persona_memory_search";
        console.log(`[MCP] tool_called ${toolName}`);
        telemetry.toolsRequested.push(toolName);
        telemetry.toolExecutionsCount++;
        telemetry.actualMemoryToolCalled = true;
        if (!telemetry.sourcesUsed.includes("persona_memory")) {
          telemetry.sourcesUsed.push("persona_memory");
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
    const basicValidation = validateConversationBrainPlan(parsedPlan, params.availableSubagents);
    const invariantValidation = validatePersonaMemoryExecutionInvariant(parsedPlan, telemetry.actualMemoryToolCalled);
    const validation = !basicValidation.valid ? basicValidation : invariantValidation;

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
      console.log(`[OpenAI Agent] plan_validated: responsibleSubagent=${parsedPlan.responsibleSubagent}`);
    } else {
      if (!parsedPlan || !validation.valid) {
        telemetry.finalPlanParsed = false;
        console.warn(`[OpenAI Agent] Recuperação defensiva ativada (openai_agent_plan_recovery_used): ${validation.error}`);
        parsedPlan = buildFallbackBrainPlan(rawResponseText, params.availableSubagents);
      } else {
        telemetry.finalPlanParsed = true;
        console.log(`[OpenAI Agent] plan_validated: responsibleSubagent=${parsedPlan.responsibleSubagent}`);
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
