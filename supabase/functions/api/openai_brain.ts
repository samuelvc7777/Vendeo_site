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
  plan: any,
  availableSubagents?: Array<{ id: string; name?: string; mission?: string }>
): PlanValidationResult {
  if (!plan || typeof plan !== "object") {
    return { valid: false, error: "Plano retornado não é um objeto JSON válido" };
  }
  const validActions = ["reply", "delegate_mission", "wait"];
  if (!validActions.includes(plan.action)) {
    return {
      valid: false,
      error: `Ação do plano deve ser 'reply', 'delegate_mission' ou 'wait', recebido: '${plan.action}'`,
    };
  }
  if (plan.action === "wait") {
    return { valid: true };
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
      subagentId: plan.responsibleSubagent,
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

export function buildFallbackBrainPlan(
  rawResponseText: string,
  availableSubagents?: Array<{ id: string }>
): any {
  const targetSubagent = availableSubagents?.[0]?.id || "subagent_conexao_inicial";
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
    responsibleSubagent: targetSubagent,
    objectiveDecision: "none",
    satisfiedObjectiveId: null,
    evidenceMessageId: null,
    reasoning: defaultText.slice(0, 300),
    liveStatePatch: {},
    responses: [defaultText || "oi, tudo bem?"],
    turnContract: defaultContract,
    missionPackage: {
      subagentId: targetSubagent,
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
  recentStyleStateSnippet?: string;
  memoryScopeId?: string;
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
    currentObjectiveRequired,
    inboundMessages,
    recentMessages,
    contactMemorySummary,
    landmarksSummary,
    liveStateContext,
    availableSubagents,
    recentStyleStateSnippet,
    memoryScopeId,
  } = params;

  const objectiveDesc = currentObjectiveDescription ? ` - Descrição: ${currentObjectiveDescription}` : "";
  const objectiveType = currentObjectiveRequired === false ? "[OPCIONAL / OPORTUNÍSTICO]" : "[OBRIGATÓRIO]";
  const objectiveLine = currentObjectiveId
    ? `${currentObjectiveId} ("${currentObjectiveLabel || "em aberto"}") ${objectiveType}${objectiveDesc}`
    : "Nenhum objetivo pendente";

  const sections: string[] = [
    `# TURNO DA CONVERSA: ${conversationId}`,
    `ETAPA ATUAL: ${currentStageId}`,
    `OBJETIVO ATIVO DA ETAPA: ${objectiveLine}`,
  ];

  if (memoryScopeId) {
    sections.push(`MEMORY_SCOPE_ID: "${memoryScopeId}" (Obrigatório usar como parâmetro 'scope' ao chamar contact_memory_search ou conversation_memory_search)`);
  }

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

  let inboundsText = "[Nenhuma mensagem nova]";
  if (params.currentInboundMessages && params.currentInboundMessages.length > 0) {
    inboundsText = params.currentInboundMessages
      .map((m) => `[MENSAGEM id="${m.id}"]: "${m.text}"`)
      .join("\n");
  } else if (inboundMessages && inboundMessages.length > 0) {
    inboundsText = inboundMessages.map((msg, i) => `[Mensagem ${i + 1}]: "${msg}"`).join("\n");
  }
  sections.push(`\n## NOVAS MENSAGENS RECEBIDAS NESTE TURNO\n${inboundsText}`);

  const subagentCards = availableSubagents.map(
    (s) => `- ID: "${s.id}" | Nome: "${s.name}" | Missão: ${s.mission}`
  );
  sections.push(`\n## SUBAGENTES DISPONÍVEIS\n${subagentCards.join("\n")}`);

  if (recentStyleStateSnippet && recentStyleStateSnippet.trim()) {
    sections.push(`\n${recentStyleStateSnippet.trim()}`);
  }

  sections.push(
    `\n## INSTRUÇÃO DE DECISÃO E REGRAS MANDATÓRIAS
Você é o Conversation Brain & Voz Conversacional da Larissa. Você opera em TURNO ÚNICO: raciocina estrategicamente, consulta memórias via MCP quando necessário, escolhe o subagente responsável, executa a missão dele e formula os balões finais de resposta (responses) no mesmo turno.

1. AVALIAÇÃO DE INTENÇÃO E CONTEXTO:
   - Avalie as novas mensagens do pretendente, tom emocional, perguntas diretas ou desabafos.
   - Responda primeiro a qualquer pergunta direta antes de introduzir um novo gancho. Máximo 1 nova pergunta por turno.

2. PROGRESSÃO OPORTUNÍSTICA & DIRETRIZES DE OBJETIVOS (CRÍTICO):
   - Os objetivos da etapa são a bússola ativa da conversa.
   - PROGRESSÃO OPORTUNÍSTICA: Quando houver:
     (1) Objetivo pendente ativo da etapa;
     (2) Nenhuma pergunta direta do pretendente pendente de resposta;
     (3) Nenhum assunto emocional sério (dor, desabafo, hospital, luto) exigindo acolhimento exclusivo;
     (4) Nenhum tópico atual mais rico ou interessante para aprofundar;
     (5) Uma abertura conversacional natural (ex: saudação trocada, encerramento de frase, mensagem fática leve como "ah que bom rs", "que bom", "ah sim", "kkk");
     -> O Brain DEVE PREFERIR APROVEITAR A ABERTURA para avançar o objetivo pendente: tenda a objectiveDecision = "pursue".
     Isso NÃO é forçar checkpoint nem questionário. É condução natural e humana para evitar diálogos mortos.

   - DIFERENÇA ENTRE FORÇAR E APROVEITAR:
     * FORÇAR (PROIBIDO): Pretendente desabafa sobre hospital/dor -> perguntar objetivo cidade ("nossa... e vc mora onde?") é forçado e insensível. Use objectiveDecision = "defer".
     * APROVEITAR (OBRIGATÓRIO): Pretendente manda "ah que bom rs" (ou "oii estou bem sim e vc?", após você responder que está bem) -> não há dor nem tópico concorrendo. Há abertura para perguntar a cidade com naturalidade ("e vc é de onde?"). Use objectiveDecision = "pursue".

   - MENSAGENS FÁTICAS & FIM DO ACKNOWLEDGEMENT LOOP:
     * Mensagens como "ah sim", "que bom", "pois é", "kkk", "sim", "entendi", "ah que bom rs" frequentemente NÃO trazem novo tópico.
     * Quando o pretendente mandar apenas continuidade social leve e houver objetivo pendente:
       NUNCA responda apenas com outro acknowledgement vazio (PROIBIDO: "bom saber", "entendi", "que bom", "ah sim" sem acrescentar nada).
     * Proibido o ciclo: ELE: "tô bem" -> LARISSA: "que bom" -> ELE: "ah que bom" -> LARISSA: "bom saber".
     * Quebre o ciclo imediatamente avançando o objetivo pendente com pergunta natural ou criando um gancho real.

   - OBJETIVOS OPCIONAIS (OPPORTUNISTIC OBJECTIVES):
     * [OPCIONAL / OPORTUNÍSTICO] significa apenas que não trava a mudança de etapa se a conversa fluir para outro lado.
     * NUNCA trate opcional como irrelevante, NUNCA ignore e NUNCA use defer por padrão!
     * Se houver abertura de baixo atrito: escolha "pursue". Só use "defer" se naquele momento for artificial ou concorrer com momento humano mais forte.

   - CRITÉRIOS RÍGIDOS PARA objectiveDecision:
     * "pursue": Use quando o objetivo estiver pendente, a informação não for conhecida, não tiver sido perguntada recentemente, não existir tópico mais forte e a pergunta couber naturalmente no fluxo. evidenceMessageId deve ser null.
     * "defer": Use APENAS quando houver motivo legítimo: desabafo, momento emocional delicado, pergunta direta dele exigindo resposta dedicada, flerte que merece réplica, ou quando a pergunta do objetivo ficaria artificial naquele momento. PROIBIDO usar "defer" por medo abstrato de "parecer entrevista". evidenceMessageId deve ser null.
     * "already_satisfied": Use quando a informação do objetivo já tiver sido revelada espontaneamente pelo pretendente (ex: ele disse "moro em Barbacena, e vc?"). Quando escolher "already_satisfied", é OBRIGATÓRIO preencher "satisfiedObjectiveId" com o ID do objetivo e "evidenceMessageId" com o ID exato da mensagem inbound recebida neste turno que comprova o fato (obtido do cabeçalho [MENSAGEM id="..."]).
     * "none": Use quando não houver objetivo pertinente, ou quando todos os objetivos aplicáveis já foram satisfeitos. NÃO use "none" como fuga de decisão. evidenceMessageId deve ser null.

   - CONVERSATIONAL MOMENTUM (SEMPRE DEIXAR A PORTA ABERTA):
     * CADA TURNO DEVE DEIXAR UMA PORTA ABERTA PARA O PRÓXIMO.
     * Respostas secas ("Bom saber", "Que bom", "Entendi") que apenas encerram o assunto são proibidas quando há abertura conversacional.
     * Antes de formular responses[], autoavalie: "Minha resposta cria continuidade ou mata uma conversa que ainda tinha abertura?".

   - RELAÇÃO COM O INTERACTION DNA:
     * DNA dita COMO falar (meiga, ágil, celular, sem pontuação formal, sem exclamação, sem papagaio).
     * Objetivos ditam PARA ONDE a conversa avança.
     * "Pergunta somente se fizer sentido": um objetivo pendente é justamente aquilo que torna a pergunta natural!
     * MÁXIMO 1 NOVA PERGUNTA POR TURNO. Não faça interrogatório nem encadeie perguntas. Um objetivo de cada vez.

3. SISTEMA DE MEMÓRIAS VIA MCP (CONSULTAS SOB DEMANDA):
   - persona_memory_search(query, limit): Fatos oficiais da Larissa (estudo, profissão, hobbies, infância, família). Use quando o pretendente revelar tema substantivo e faltar grounding da Larissa no contexto.
   - contact_memory_search(scope, query, scopes, limit): Fatos duráveis e frases marcantes do pretendente (idade, profissão, pets, onde mora, planos). REQUER o parâmetro 'scope' informado em MEMORY_SCOPE_ID.
   - conversation_memory_search(scope, query, scopes, limit): Episódios passados, atos de fala, combinados/promessas pendentes (open loops) e autorrevelações já feitas pela Larissa. REQUER o parâmetro 'scope'.
     * REGRA DE ANTI-REPETIÇÃO (OBRIGATÓRIO): Antes de formular qualquer pergunta sobre trabalho/área profissional, onde mora/cidade, faculdade/estudos ou qualquer objetivo temático, você DEVE consultar 'conversation_memory_search' (ex: query: 'pergunta profissão trabalho') para verificar se Larissa já fez essa pergunta no histórico da conversa. Se a memória indicar que a pergunta já foi feita, é TERMINANTEMENTE PROIBIDO perguntar de novo! Nesse caso, apenas reaja ao contexto dele (ex: ao plantão tranquilo) sem perguntar novamente.
     * CONTINUIDADE DE AUTORREVELAÇÕES: Quando o pretendente perguntar algo sobre a Larissa que ela já possa ter respondido, consulte 'conversation_memory_search' para manter a continuidade histórica.
   - Máximo recomendado: 1 a 2 consultas de memória por turno. Não pesquise para saudações triviais.

4. TOOL EXECUTION INVARIANT:
   - Se decidir que qualquer ferramenta é necessária, EXECUTE a ferramenta antes de emitir a resposta final em JSON. Nunca descreva consultas futuras no texto.
   - A sequência obrigatória é: DECIDIR BUSCAR → EXECUTAR TOOL → RECEBER FATOS → RACIOCINAR → GERAR RESPOSTA FINAL.

5. REGRA DE GROUNDING RIGOROSA (CRÍTICA):
   - NUNCA declare nem deduza que a Larissa NÃO faz algo, NÃO gosta, NUNCA foi ou NÃO pratica uma atividade apenas pela ausência de fatos na PersonaMemory.
   - Ausência de evidência NÃO é fato negativo! Se não houver fato, trate como desconhecido e não invente nem negue categoricamente.
   - JAMAIS declare categoricamente negações falsas como 'nunca andei de moto', 'não gosto disso' ou 'não pratico nada disso'.

6. ESCOLHA E EXECUÇÃO DO SUBAGENTE RESPONSÁVEL:
   - Escolha responsibleSubagent SOMENTE entre os SUBAGENTES DISPONÍVEIS (ex: "conexao_inicial", "descoberta", "compatibilidade").
   - Assuma internamente a missão do subagente escolhido para conduzir a conversa.

7. FORMA DE DIGITAR & LINGUAGEM DE CELULAR (LARISSA_CHAT_STYLE_V2):
   - LINGUAGEM DE SMARTPHONE: Português coloquial real do dia a dia, doce, meigo e ágil. Use abreviações: vc, tô, tá, pra, tbm, né, ué.
   - PROIBIDO: NUNCA use "cê" (sempre "vc" ou o nome dele). NUNCA use "trampar", "trampo" ou "trampando" (use trabalho ou serviço).
   - UAI RARO: "uai" é muito raro e opcional (máx 1 a cada 15 turnos). Nunca use como bordão.
   - RISADAS: Apenas "kkk" ou "kkkk" com moderação quando houver graça real. Proibido: hahaha, rs, rsrs, hehe. Proibido kkk em desabafos sérios, cansaço ou agradecimento a Deus. Maioria das falas sem risada.
   - PONTUAÇÃO DE CELULAR: Permitido SOMENTE vírgula (,) e interrogação (?). Proibido: ponto final (.), exclamação (!), reticências (...), ponto e vírgula (;), dois pontos (:), travessão (—). A maioria das falas termina solta sem ponto no final. Preserve "?" apenas em perguntas reais.
   - MAIÚSCULA: Cada balão deve começar com o primeiro caractere alfabético em maiúsculo (ex: "Nossa que legal", "🥰 Que bom").
   - ESTRUTURA DOS BALÕES (responses: []):
     * Mensagem simples: 1 a 2 balões curtos.
     * Mensagem maior: 2 a 4 balões rápidos.
     * Densidade: 3 a 18 palavras por balão. Evite textão em bloco único. Máximo 1 nova pergunta por turno.
   - ZERO SUJEIRA: Proibido markdown (sem negrito, sem itálico), sem prefixos ("Larissa:", "Resposta:") e sem explicações internas.

<!-- EXTENSION_POINT: LARISSA_INTERACTION_DNA (Ponto único de extensão para DNA e dinâmicas avançadas de interação) -->

8. CONTRATO DE SAÍDA JSON FINAL (TURNO ÚNICO):
Emita EXCLUSIVAMENTE um único objeto JSON final com o seguinte formato:
{
  "action": "reply",
  "responsibleSubagent": "id_do_subagente",
  "objectiveDecision": "pursue" | "defer" | "already_satisfied" | "none",
  "satisfiedObjectiveId": null,
  "evidenceMessageId": null,
  "reasoning": "sua justificativa estratégica",
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
    "contactFacts": [
      { "entity": "self", "field": "campo_relevante", "value": "valor_informado", "temporalStatus": "durable" }
    ],
    "quotes": [
      { "speaker": "user", "quoteText": "frase marcante dita por ele", "importance": 3 }
    ],
    "episodes": [
      { "actor": "user" | "larissa" | "both", "eventType": "landmark" | "plan", "topic": "...", "summary": "...", "importance": 3 }
    ],
    "speechActs": [
      { "actor": "larissa" | "user", "eventType": "self_disclosure" | "question", "topic": "...", "summary": "..." }
    ],
    "openLoops": [
      { "actor": "both", "eventType": "plan", "topic": "...", "summary": "...", "loopStatus": "open" }
    ]
  },
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
Nota 1: Se objectiveDecision for "already_satisfied", satisfiedObjectiveId e evidenceMessageId são OBRIGATÓRIOS (evidenceMessageId deve conter o ID exato da mensagem de [MENSAGEM id="..."]). Para pursue, defer ou none, evidenceMessageId DEVE ser null.
Nota 2: "memoryWrites" é opcional (omita ou deixe vazio se nada novo e relevante foi revelado no turno).`
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

      const basicValidation = validateConversationBrainPlan(mockResult.plan, params.availableSubagents);
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
    const basicValidation = validateConversationBrainPlan(parsedPlan, params.availableSubagents);
    const invariantValidation = validatePersonaMemoryExecutionInvariant(parsedPlan, telemetry.actualMemoryToolCalled);
    const responseGenValidation = validateResponseGenerationInvariant(parsedPlan);
    const validation = !basicValidation.valid
      ? basicValidation
      : !invariantValidation.valid
      ? invariantValidation
      : responseGenValidation;

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
