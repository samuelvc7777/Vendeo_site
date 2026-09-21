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
    toolsRequested: string[];
    toolExecutionsCount: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sourcesUsed: string[];
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

  // 2. Chamada real à API da OpenAI (Agents API ou Chat Completions com function calling)
  if (!apiKey) {
    const errMsg = "OPENAI_API_KEY ausente para execução do OpenAI Agent Brain.";
    console.error(`[Brain] ${errMsg}`);
    telemetry.durationMs = Date.now() - startTime;
    return {
      success: false,
      plan: null,
      error: errMsg,
      telemetry,
    };
  }

  try {
    let messages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: "user", content: contextMessage },
    ];

    let maxToolIterations = 3;
    let iteration = 0;
    let finalPlan: any = null;

    while (iteration < maxToolIterations && !finalPlan) {
      iteration++;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: agentId.startsWith("asst_") || agentId.startsWith("agent_") ? "gpt-4o" : agentId,
          messages,
          tools: [PERSONA_MEMORY_TOOL_DEFINITION],
          tool_choice: "auto",
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        throw new Error(`Falha HTTP na chamada da OpenAI: ${res.status} ${await res.text()}`);
      }

      const resData = await res.json();
      const choice = resData.choices?.[0];
      const message = choice?.message;

      if (resData.usage) {
        telemetry.inputTokens += resData.usage.prompt_tokens || 0;
        telemetry.outputTokens += resData.usage.completion_tokens || 0;
        telemetry.totalTokens += resData.usage.total_tokens || 0;
      }

      if (message?.tool_calls && message.tool_calls.length > 0) {
        messages.push(message);

        for (const tc of message.tool_calls) {
          const toolName = tc.function?.name;
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function?.arguments || "{}");
          } catch {}

          if (toolName === "persona_memory_search") {
            console.log(`[Brain] tool_requested ${toolName}`);
            telemetry.toolsRequested.push(toolName);
            telemetry.toolExecutionsCount++;
            if (!telemetry.sourcesUsed.includes("persona_memory")) {
              telemetry.sourcesUsed.push("persona_memory");
            }

            const toolOutput = await executePersonaMemoryTool(parsedArgs, params.supabase);
            console.log("[Brain] tool_output_submitted");

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(toolOutput),
            });
          } else {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: `Ferramenta desconhecida: ${toolName}` }),
            });
          }
        }
      } else if (message?.content) {
        try {
          finalPlan = JSON.parse(message.content);
        } catch {
          finalPlan = {
            action: "delegate_mission",
            responsibleSubagent: "conexao_inicial",
            objectiveDecision: "defer",
            reasoning: message.content,
          };
        }
      } else {
        break;
      }
    }

    console.log("[Brain] turn_completed");
    telemetry.durationMs = Date.now() - startTime;

    return {
      success: Boolean(finalPlan),
      plan: finalPlan,
      telemetry,
    };
  } catch (err: any) {
    console.error("[Brain] Erro durante turno do OpenAI Agent Brain:", err);
    telemetry.durationMs = Date.now() - startTime;
    return {
      success: false,
      plan: null,
      error: err?.message || String(err),
      telemetry,
    };
  }
}
