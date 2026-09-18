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

export interface ConversationAgentInput {
  conversationId: string;
  currentPhase: OrchestrationPhase;
  newMessage: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  recentHistory: string;
}

export interface SubagentInput {
  conversationId: string;
  currentPhase: OrchestrationPhase;
  newMessage: {
    id: string;
    text: string;
    timestamp: string;
    sender: string;
  };
  recentHistory: string;
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
// 6. Construtor de Prompt do Agente da Conversa (Camada 1 - Roteador Enxuto)
// ----------------------------------------------------------------------------
export function buildConversationAgentPrompt(input: ConversationAgentInput): string {
  return `Você é o Agente da Conversa da Larissa no Vendeo.
Sua missão é estritamente de roteamento: analisar o estágio do diálogo e decidir qual subagente especializado deve responder ao pretendente.

### SUBAGENTES DISPONÍVEIS:
1. "conexao_inicial": Atendimento inicial, troca de saudações ("oi", "tudo bem", "como foi seu dia"), acolhimento caloroso e estabelecimento de reciprocidade inicial.
2. "descoberta": Quando o contato inicial já foi correspondido e o diálogo deve aprofundar em quem ele é (profissão/trabalho, cidade onde mora, rotina, gostos).
3. "none": Mensagem não exige resposta imediata ou deve aguardar.

### DADOS ESSENCIAIS DA CONVERSA
- ID da Conversa: ${input.conversationId}
- Fase Atual Registrada: ${input.currentPhase}
- Remetente: ${input.newMessage.sender}
- Última Mensagem do Pretendente: "${input.newMessage.text}"
- Histórico Recente:
${input.recentHistory || "Início da interação"}

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
  return `Você é a subagente especialista em CONEXÃO INICIAL da Larissa (23 anos, moça meiga de Minas Gerais).
Seu objetivo é acolher com carinho, simpatia e validação de reciprocidade.

### DIRETRIZES DA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Tom: meigo, carinhoso, mineiro natural (usando 'uai', 'né', 'kkk' com moderação).
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Jamais chame o pretendente de Larissa.
- Responda ao que ele falou antes de fazer qualquer pergunta leve.
- Mantenha o balão curto e natural de celular.

### CONTEXTO
- Última Mensagem do Pretendente: "${input.newMessage.text}"
- Histórico Recente:
${input.recentHistory || "Início da conversa"}

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
  return `Você é a subagente especialista em DESCOBERTA da Larissa (23 anos, moça meiga de Minas Gerais).
Seu objetivo é descobrir suavemente o que o pretendente faz da vida, onde mora e sua rotina.

### DIRETRIZES DA LARISSA (.agents/LARISSA_LINGUISTIC_DNA.md)
- Aplique sempre a Regra da Reciprocidade: se perguntar sobre ele, conte algo breve sobre você (estuda enfermagem, mora em São João del Rei, trabalha com vendas em casa).
- Tom: meigo, carinhoso, mineiro natural (usando 'uai', 'né', 'kkk' com moderação).
- PROIBIDO terminar balão com ponto final (.)
- PROIBIDO usar ponto de exclamação (!)
- Uma pergunta leve por vez, sem interrogatório. Balão curto de celular.

### CONTEXTO
- Última Mensagem do Pretendente: "${input.newMessage.text}"
- Histórico Recente:
${input.recentHistory || "Início da conversa"}

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

  // 1. BACKEND DETERMINÍSTICO: Busca conversa e estado
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

  // 2. ISOLAMENTO TOTAL: Conversas no modo 'legacy' retornam imediatamente
  if (orchState.mode === "legacy") {
    return { mode: "legacy", handled: false };
  }

  // 3. BACKEND DETERMINÍSTICO: Idempotência estrita
  if (orchState.lastProcessedMessageId && orchState.lastProcessedMessageId === newMessage.id) {
    console.log(
      `[Orchestrator] Mensagem ${newMessage.id} já processada em ${conversationId}. Abortando por idempotência.`
    );
    return { mode: orchState.mode, handled: true, skippedDuplicate: true };
  }

  // 4. BACKEND DETERMINÍSTICO: Lock Atômico concorrente
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
    // 5. BACKEND DETERMINÍSTICO: Cancelamento e checagem de pausa pelo operador
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
      return { mode: orchState.mode, handled: false, error: "Cancelado pelo operador" };
    }

    const currentPhase: OrchestrationPhase = orchState.currentPhase || "conexao_inicial";

    // 6. BACKEND DETERMINÍSTICO: Extração Mínima de Contexto (máximo 5 mensagens)
    const { data: recentMsgs } = await supabase
      .from("instagram_messages")
      .select("sender_id, is_mine, text")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(5);

    const recentSnippet = (recentMsgs || [])
      .reverse()
      .map((m: any) => `${m.is_mine ? "Larissa" : "Pretendente"}: ${m.text || ""}`)
      .join("\n");

    let totalTokens = 0;

    // Publica estado visual imediato na tela
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
      newMessage,
      recentHistory: recentSnippet,
    });

    const routingRes = await callModelOrAtria(routingPrompt, { runtime, supabase });
    totalTokens += routingRes.tokens;
    const rawRoutingJson = extractJsonFromText(routingRes.content);
    const routingDecision = validateRoutingDecision(rawRoutingJson, currentPhase);

    console.log(
      `[Orchestrator] Agente da Conversa roteou ${conversationId} para "${routingDecision.targetSubagent}" (ação=${routingDecision.action}, motivo=${routingDecision.reason}).`
    );

    let finalSubDecision: SubagentDecision;

    // Se a decisão de roteamento for aguardar ou não acionar subagente
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
    } else {
      // ----------------------------------------------------------------------
      // CAMADA 2: SUBAGENTE ESPECIALIZADO (CONEXÃO INICIAL OU DESCOBERTA)
      // ----------------------------------------------------------------------
      const targetSubagent = routingDecision.targetSubagent;
      let subagentPrompt = "";

      if (targetSubagent === "descoberta") {
        subagentPrompt = buildDescobertaPrompt({
          conversationId,
          currentPhase: "descoberta",
          newMessage,
          recentHistory: recentSnippet,
        });
      } else {
        subagentPrompt = buildConexaoInicialPrompt({
          conversationId,
          currentPhase: "conexao_inicial",
          newMessage,
          recentHistory: recentSnippet,
        });
      }

      // Notifica visualmente a transição para o subagente
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

    const durationMs = Date.now() - startTime;

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

    // ------------------------------------------------------------------------
    // MODO SHADOW: Registra tudo sem ações externas, ZERO envio à Meta
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
        tokens: totalTokens,
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

      // Publica estado visual na tela com histórico preservado
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
    // MODO EXPERIMENTAL: Execução ativa no chat marcado
    // ------------------------------------------------------------------------
    if (orchState.mode === "experimental") {
      let sentSuccessfully = false;

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

        if (runtime?.sendMetaTextMessage) {
          await runtime.sendMetaTextMessage(supabase, conversationId, decision.suggestedResponse);
          sentSuccessfully = true;
        } else {
          // Despacho via Meta Graph API oficial
          const { data: configRow } = await supabase
            .from("instagram_config")
            .select("access_token")
            .eq("id", "default")
            .maybeSingle();

          const accessToken = configRow?.access_token;
          if (!accessToken) {
            throw new Error("Access token do Instagram (id: 'default') não configurado em instagram_config.");
          }

          let recipientIgsid = conversationId;
          if (!/^d+$/.test(conversationId)) {
            const { data: convMsgs } = await supabase
              .from("instagram_messages")
              .select("sender_id, is_mine")
              .eq("conversation_id", conversationId)
              .eq("is_mine", false)
              .limit(5);
            const foundNumeric = (convMsgs || []).find((m: any) => /^d+$/.test(m.sender_id));
            if (foundNumeric) recipientIgsid = foundNumeric.sender_id;
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
                recipient: { id: recipientIgsid },
                message: { text: decision.suggestedResponse },
              }),
            }
          );

          if (sendRes.ok) {
            sentSuccessfully = true;
            const metaJson = await sendRes.json().catch(() => ({}));
            const nowIso = new Date().toISOString();
            const messageId = metaJson.message_id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
          } else {
            throw new Error(`Falha no envio pela Meta: ${await sendRes.text()}`);
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
        tokens: totalTokens,
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

      return {
        mode: "experimental",
        handled: true,
        decision,
        durationMs,
        tokens: totalTokens,
      };
    }

    return { mode: "legacy", handled: false };
  } catch (err: any) {
    console.error(`[Orchestrator] Erro na execução de ${conversationId}:`, err);

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
