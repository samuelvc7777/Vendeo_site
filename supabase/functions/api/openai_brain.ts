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
      "Pesquisa a PersonaMemory oficial da Larissa no Supabase para encontrar fatos, preferências, hábitos, experiências, gostos, opiniões e informações relevantes ao contexto atual. Use quando precisar descobrir algo verdadeiro sobre Larissa. Não invente fatos que podem ser consultados nesta ferramenta.",
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
    `\n## INSTRUÇÃO DE DECISÃO
Você é o Conversation Brain da Larissa. Sua função é:
1. Avaliar a intenção do pretendente nas novas mensagens.
2. Se precisar de fatos sobre a vida, rotina, gostos, memórias ou opiniões da Larissa para reagir com autenticidade, USE A FERRAMENTA persona_memory_search. NÃO invente fatos.
3. Ao concluir a estratégia, emita a decisão final delegando a missão para um subagente em JSON estruturado com o formato:
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

  return sections.join("\n");
}

/**
 * Executa um turno com o OpenAI Agent Brain.
 * Suporta a execução via OpenAI Agents API oficial ou simulação controlada para testes.
 */
export async function runOpenAiBrainTurn(params: RunOpenAiBrainParams): Promise<OpenAiBrainTurnResult> {
  const startTime = Date.now();
  console.log("[Brain] turn_started");

  const apiKey =
    params.apiKey ||
    (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_API_KEY") : process.env.OPENAI_API_KEY);

  const agentId =
    params.agentId ||
    (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_BRAIN_AGENT_ID") : process.env.OPENAI_BRAIN_AGENT_ID) ||
    "agent_brain_default";

  const telemetry: OpenAiBrainTurnResult["telemetry"] = {
    agentId,
    toolsRequested: [],
    toolExecutionsCount: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    sourcesUsed: [],
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
      telemetry.finalPlanParsed = true;

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

    // Cria a sessão com o contexto compacto do turno
    const sessionPayload = {
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
        if (!telemetry.sourcesUsed.includes("persona_memory")) {
          telemetry.sourcesUsed.push("persona_memory");
        }
      }
    }

    // Identifica mensagem final do assistente
    const assistantMsg = items.find(
      (it) => it.type === "message" && it.role === "assistant" && (it.phase === "final_answer" || !it.phase)
    );

    const rawResponseText = assistantMsg?.content?.[0]?.text || "";
    if (!rawResponseText) {
      throw new Error(`Nenhuma mensagem final do assistente encontrada na sessão ${sessionId}. Total itens: ${items.length}`);
    }

    let parsedPlan = extractJsonFromText(rawResponseText);
    if (!parsedPlan || typeof parsedPlan !== "object" || !parsedPlan.action) {
      // Se o Agent retornou texto conversacional autêntico em vez de JSON estruturado,
      // sintetiza defensivamente o plano de delegação mantendo a resposta gerada
      const targetSubagent =
        params.availableSubagents?.[0]?.id || "subagent_conexao_inicial";
      console.log(
        `[OpenAI Agent] Resposta textual direta do Brain; sintetizando plano para subagente '${targetSubagent}'`
      );
      parsedPlan = {
        action: "delegate_mission",
        responsibleSubagent: targetSubagent,
        objectiveDecision: "none",
        reasoning: rawResponseText.slice(0, 300),
        liveStatePatch: {},
        missionPackage: {
          subagentId: targetSubagent,
          objectiveDirective: "none",
          draftResponse: rawResponseText,
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

    telemetry.finalPlanParsed = true;
    console.log(`[OpenAI Agent] plan_validated: responsibleSubagent=${parsedPlan.responsibleSubagent || "indefinido"}`);
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
