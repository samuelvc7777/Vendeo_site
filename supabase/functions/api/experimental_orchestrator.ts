// ============================================================================
// experimental_orchestrator.ts
// Novo Motor Experimental de Orquestração por Conversa (Clean Architecture)
// Suporta modos: 'legacy' | 'shadow' | 'experimental'
// ============================================================================

export type OrchestrationMode = "legacy" | "shadow" | "experimental";
export type OrchestrationPhase = "conexao_inicial" | "descoberta";
export type OrchestrationAction = "reply" | "wait" | "advance_phase" | "escalate";
export type ProcessingStatus =
  | "idle"
  | "analyzing"
  | "decided"
  | "sent"
  | "shadow_logged"
  | "failed";

export interface OrchestratorDecision {
  action: OrchestrationAction;
  currentPhase: OrchestrationPhase;
  nextPhase: OrchestrationPhase;
  checkpoint: string;
  summary: string;
  suggestedResponse: string;
  requiredTools: string[];
  reasoning: string;
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
}

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
  if (!raw || typeof raw !== "string") throw new Error("Resposta da IA está vazia.");
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

  throw new Error(`Falha ao decodificar JSON da resposta da Atria: ${raw.slice(0, 100)}...`);
}

// ----------------------------------------------------------------------------
// 1. Validador de Esquema Estrito
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
// 2. Validador de Transição de Fase pelo Backend (Guarda de Integridade)
// ----------------------------------------------------------------------------
export function validatePhaseTransition(
  currentPhase: OrchestrationPhase,
  requestedNextPhase: OrchestrationPhase,
  checkpoint: string
): { allowed: boolean; validatedNextPhase: OrchestrationPhase; reason?: string } {
  // Se não solicitou avanço, mantém a fase atual
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
// 3. Regras de Cada Fase
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
// 4. Construtor de Prompt do Agente Principal (Atria)
// ----------------------------------------------------------------------------
export function buildOrchestratorPrompt(input: OrchestratorInput): string {
  return `Você é a IA Atria, Auditora Oficial de Atendimento e Relacionamento do Vendeo.
Sua missão é auditar a conversa e definir a próxima ação estratégica e resposta, respeitando a fase do funil de conversão.

### DOSSIÊ DA CONVERSA
- ID da Conversa: ${input.conversationId}
- Fase Atual: ${input.currentPhase}
- Resumo Anterior: ${input.conversationSummary || "Início do atendimento."}
- Memórias Relevantes: ${input.relevantMemories.length > 0 ? input.relevantMemories.join(" | ") : "Nenhuma memória registrada ainda."}
- Tarefas Pendentes: ${input.pendingTasks.length > 0 ? input.pendingTasks.join(" | ") : "Nenhuma tarefa pendente."}
- Ferramentas Permitidas: ${input.allowedTools.join(", ")}

### DIRETRIZES DA FASE [${input.currentPhase}]
${input.phaseRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

### ÚLTIMA MENSAGEM DO CLIENTE
- Remetente: ${input.newMessage.sender}
- Texto: "${input.newMessage.text}"
- Horário: ${input.newMessage.timestamp}

### REGRAS OBRIGATÓRIAS DE AUDITORIA
1. Avalie a interação do cliente com base no dossiê.
2. Para avançar de 'conexao_inicial' para 'descoberta', você DEVE definir o checkpoint como 'chk_rapport_estabelecido' e próxima fase 'descoberta'.
3. Se o cliente ainda estiver apenas cumprimentando, mantenha a fase 'conexao_inicial' e checkpoint 'chk_saudacao_feita'.
4. Formule uma resposta cordial, atenciosa e acolhedora no estilo de atendimento humanizado de Minas Gerais (sem clichês formais de robô, meiga, sem ponto final).
5. Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "action": "reply",
  "currentPhase": "${input.currentPhase}",
  "nextPhase": "conexao_inicial",
  "checkpoint": "chk_saudacao_feita",
  "summary": "resumo conciso do turno",
  "suggestedResponse": "resposta atenciosa e acolhedora para o cliente",
  "requiredTools": [],
  "reasoning": "análise analítica da decisão tomada"
}`;
}

// ----------------------------------------------------------------------------
// 5. Motor de Execução Principal (runExperimentalOrchestration)
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
    params.correlationId ||
    `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Busca estado da conversa e metadados de orquestração
  const { data: convRow, error: convErr } = await supabase
    .from("instagram_conversations")
    .select("id, full_name, stage_completed_rules")
    .eq("id", conversationId)
    .maybeSingle();

  if (convErr || !convRow) {
    console.warn(`[Orchestrator] Conversa ${conversationId} não encontrada.`);
    return { mode: "legacy", handled: false, error: convErr?.message || "Conversa não encontrada" };
  }

  const stageRules = convRow.stage_completed_rules || {};
  const orchState: ConversationOrchestrationState = stageRules.orchestration || {
    version: 1,
    mode: "legacy",
    currentPhase: "conexao_inicial",
    checkpoint: "inicio",
    lastProcessedMessageId: null,
    lastProcessedAt: null,
    lastProcessingStatus: "idle",
    lastCorrelationId: null,
    lastDecision: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };

  // 2. Se o modo for 'legacy', NÃO executa o novo orquestrador
  if (orchState.mode === "legacy") {
    return { mode: "legacy", handled: false };
  }

  // 3. IDEMPOTÊNCIA: Verifica se a mensagem já foi processada anteriormente
  if (orchState.lastProcessedMessageId && orchState.lastProcessedMessageId === newMessage.id) {
    console.log(
      `[Orchestrator] Mensagem ${newMessage.id} já processada em ${conversationId}. Abortando por idempotência.`
    );
    return { mode: orchState.mode, handled: true, skippedDuplicate: true };
  }

  // 4. LOCK ATÔMICO: Previne concorrência e processamentos duplicados simultâneos
  const activeLock = stageRules.active_cycle_token;
  const activeLockAt = stageRules.active_cycle_at ? Date.parse(stageRules.active_cycle_at) : 0;
  if (activeLock && Date.now() - activeLockAt < 25000 && activeLock !== correlationId) {
    console.log(
      `[Orchestrator] Lock ativo detectado (${activeLock}) para ${conversationId}. Abortando execução concorrente.`
    );
    return { mode: orchState.mode, handled: false, error: "Lock ativo concorrente" };
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

  try {
    // 5. Prepara entrada para o agente principal
    const currentPhase: OrchestrationPhase = orchState.currentPhase || "conexao_inicial";
    const phaseRules = getRulesForPhase(currentPhase);

    // Carrega histórico recente para montar resumo se não houver
    const { data: recentMsgs } = await supabase
      .from("instagram_messages")
      .select("sender_id, is_mine, text")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    const historySnippet = (recentMsgs || [])
      .reverse()
      .map((m: any) => `${m.is_mine ? "Larissa" : "Pretendente"}: ${m.text || ""}`)
      .join("\n");

    const input: OrchestratorInput = {
      conversationId,
      newMessage,
      currentPhase,
      conversationSummary: orchState.lastDecision?.summary || historySnippet || "Início do diálogo",
      relevantMemories: [],
      pendingTasks: [],
      allowedTools: ["send_text", "send_audio"],
      phaseRules,
    };

    const prompt = buildOrchestratorPrompt(input);

    // 6. Chamada de Inferência do Modelo
    let rawContent = "";
    let tokensUsed = 0;

    if (runtime?.callModel) {
      const res = await runtime.callModel(prompt);
      rawContent = res.content;
      tokensUsed = res.tokens || 0;
    } else {
      // Motor Oficial Atria (Atria-Dawn-Preview / api.atria-asi.ai)
      let atriaKey = (Deno?.env?.get?.("ATRIA_API_KEY") || "").trim();
      if (!atriaKey) {
        const { data: cfgSecret } = await supabase
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
          temperature: 0.3,
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!atriaRes.ok) {
        throw new Error(`Atria retornou erro HTTP ${atriaRes.status}: ${await atriaRes.text()}`);
      }

      const jsonRes = await atriaRes.json();
      rawContent = jsonRes.choices?.[0]?.message?.content || "";
      tokensUsed = jsonRes.usage?.total_tokens || 0;
    }

    // 7. Validação estrita do Schema da Decisão
    const parsedJson = extractJsonFromText(rawContent);
    const decision = validateOrchestratorDecision(parsedJson);

    // 8. Validação de Transição de Fase pelo Backend
    const transitionCheck = validatePhaseTransition(
      currentPhase,
      decision.nextPhase,
      decision.checkpoint
    );

    const validatedNextPhase = transitionCheck.validatedNextPhase;
    if (!transitionCheck.allowed) {
      console.warn(
        `[Orchestrator] Transição para ${decision.nextPhase} rejeitada pelo backend: ${transitionCheck.reason}. Mantendo ${validatedNextPhase}.`
      );
    }

    const durationMs = Date.now() - startTime;

    // ------------------------------------------------------------------------
    // MODO SHADOW: Registra tudo sem ações externas e sem enviar pela Meta
    // ------------------------------------------------------------------------
    if (orchState.mode === "shadow") {
      const updatedState: ConversationOrchestrationState = {
        version: 1,
        mode: "shadow",
        currentPhase: validatedNextPhase,
        checkpoint: decision.checkpoint,
        lastProcessedMessageId: newMessage.id,
        lastProcessedAt: new Date().toISOString(),
        lastProcessingStatus: "shadow_logged",
        lastCorrelationId: correlationId,
        lastDecision: decision,
        lastError: null,
        durationMs,
        tokens: tokensUsed,
        updatedAt: new Date().toISOString(),
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

      console.log(
        `[Orchestrator] [SHADOW] Decisão registrada com sucesso para ${conversationId} (${durationMs}ms, checkpoint=${decision.checkpoint}). Nenhum envio realizado.`
      );

      return {
        mode: "shadow",
        handled: true,
        decision,
        durationMs,
        tokens: tokensUsed,
      };
    }

    // ------------------------------------------------------------------------
    // MODO EXPERIMENTAL: Executa fluxo ativo somente no chat marcado
    // ------------------------------------------------------------------------
    if (orchState.mode === "experimental") {
      let sentSuccessfully = false;

      // Executa envio se a ação sugerida for resposta
      if (
        (decision.action === "reply" || decision.action === "advance_phase") &&
        decision.suggestedResponse
      ) {
        if (runtime?.sendMetaTextMessage) {
          await runtime.sendMetaTextMessage(supabase, conversationId, decision.suggestedResponse);
          sentSuccessfully = true;
        } else {
          // Envio padrão via Meta Graph API
          const { data: configRows } = await supabase
            .from("instagram_config")
            .select("access_token")
            .limit(1);

          const accessToken = configRows?.[0]?.access_token;
          if (accessToken) {
            const sendRes = await fetch("https://graph.instagram.com/v21.0/me/messages", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                recipient: { id: conversationId },
                message: { text: decision.suggestedResponse },
              }),
            });

            if (sendRes.ok) {
              sentSuccessfully = true;
              // Salva mensagem no histórico
              await supabase.from("instagram_messages").insert({
                id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                conversation_id: conversationId,
                sender_id: "me",
                is_mine: true,
                text: decision.suggestedResponse,
                created_at: new Date().toISOString(),
                timestamp: new Date().toISOString(),
              });
            } else {
              throw new Error(`Falha no envio pela Meta: ${await sendRes.text()}`);
            }
          }
        }
      }

      const updatedState: ConversationOrchestrationState = {
        version: 1,
        mode: "experimental",
        currentPhase: validatedNextPhase,
        checkpoint: decision.checkpoint,
        lastProcessedMessageId: newMessage.id,
        lastProcessedAt: new Date().toISOString(),
        lastProcessingStatus: sentSuccessfully ? "sent" : "decided",
        lastCorrelationId: correlationId,
        lastDecision: decision,
        lastError: null,
        durationMs,
        tokens: tokensUsed,
        updatedAt: new Date().toISOString(),
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

      console.log(
        `[Orchestrator] [EXPERIMENTAL] Execução concluída para ${conversationId} (ação=${decision.action}, fase=${validatedNextPhase}).`
      );

      return {
        mode: "experimental",
        handled: true,
        decision,
        durationMs,
        tokens: tokensUsed,
      };
    }

    return { mode: "legacy", handled: false };
  } catch (err: any) {
    console.error(`[Orchestrator] Erro na execução de ${conversationId}:`, err);

    // Grava erro mantendo o estado de orquestração seguro e libera o lock
    const fallbackState: ConversationOrchestrationState = {
      ...orchState,
      lastError: err.message || "Erro desconhecido",
      lastProcessingStatus: "failed",
      updatedAt: new Date().toISOString(),
    };

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

    return {
      mode: orchState.mode,
      handled: false,
      error: err.message || "Erro na orquestração experimental",
    };
  }
}
