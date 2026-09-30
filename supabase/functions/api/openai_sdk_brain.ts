import { Agent, getDefaultOpenAIClient, run, setDefaultOpenAIKey, system, tool, webSearchTool } from "npm:@openai/agents@0.18.0";
import { z } from "npm:zod@4.6.5";
import { buildCanonicalAgentInstructions } from "./openai_agent_instructions.ts";
import {
  executeOpenAiAppTool,
  extractJsonFromText,
  recoverSafeBrainPlan,
  validateConversationBrainPlan,
  validateObjectiveProgressionInvariant,
  validateQuestionIntentsInvariant,
  validateResponseGenerationInvariant,
  validateStageProgressionInvariant,
  type OpenAiBrainTurnResult,
  type RunOpenAiBrainParams,
} from "./openai_brain.ts";
import {
  bootstrapOpenAiConversationHistory,
  persistInboundToOpenAiConversation,
  resolveOpenAiConversationId,
} from "./openai_conversation_runtime.ts";

const AudioSearchArgs = z.object({
  objective_id: z.string().min(1),
  query: z.string().max(200).optional(),
});

function env(name: string): string | undefined {
  return typeof Deno !== "undefined" ? Deno.env.get(name) : process.env[name];
}

function buildOperationalTurnState(params: RunOpenAiBrainParams): string {
  const lines: string[] = [
    "## ESTADO OPERACIONAL AUTORITATIVO DESTE TURNO",
    "Este bloco é estado interno do Vendeo, não é mensagem do pretendente.",
    "A Conversation da OpenAI é a fonte do histórico conversacional vivo. Não peça ao backend o histórico bruto.",
    `ETAPA_ATUAL=${params.currentStageId || "identificacao"}`,
    `PROXIMA_ETAPA_CONFIGURADA=${params.nextStageId || "nenhuma"}${params.nextStageName ? ` ("${params.nextStageName}")` : ""}`,
    `ETAPA_FINAL=${params.isFinalStage === true}`,
    `OBJETIVO_ATIVO=${params.currentObjectiveId || "nenhum"}`,
    `OBJETIVO_ATIVO_OBRIGATORIO=${params.currentObjectiveId ? params.currentObjectiveRequired !== false : false}`,
    `OBJETIVO_ATIVO_TIPO=${params.currentObjectiveKind || "desconhecido"}`,
  ];

  if (params.currentObjectiveLabel) lines.push(`OBJETIVO_LABEL=${params.currentObjectiveLabel}`);
  if (params.currentObjectiveDescription) lines.push(`OBJETIVO_DESCRICAO=${params.currentObjectiveDescription}`);

  if (params.stageObjectives?.length) {
    lines.push("OBJETIVOS_DA_ETAPA:");
    for (const objective of params.stageObjectives) {
      const value = objective.value == null ? "" : ` value=${JSON.stringify(objective.value)}`;
      const evidence = objective.evidenceMessageId ? ` evidence=${objective.evidenceMessageId}` : "";
      lines.push(`- ${objective.id}: ${objective.status} required=${objective.required !== false}${value}${evidence}${objective.description ? ` | ${objective.description}` : ""}`);
    }
  }

  if (params.nextObjectives?.length) {
    lines.push("PROXIMOS_OBJETIVOS:");
    for (const objective of params.nextObjectives) {
      lines.push(`- ${objective.id}: ${objective.label}${objective.description ? ` | ${objective.description}` : ""}`);
    }
  }

  if (params.temporalContext) lines.push(params.temporalContext.trim());
  if (params.pendingOutboundActions?.length) {
    lines.push("ACOES_PENDENTES_NAO_ENVIADAS:");
    for (const action of params.pendingOutboundActions) {
      lines.push(`- id=${action.actionId} index=${action.actionIndex} type=${action.type} preview=${action.preview.slice(0, 220)}`);
    }
  }

  if (params.candidateEvidence?.length) {
    lines.push("EVIDENCIAS_CANDIDATAS:");
    for (const evidence of params.candidateEvidence) {
      lines.push(`- objective=${evidence.objectiveId} message=${evidence.evidenceMessageId} summary=${evidence.summary}`);
    }
  }

  const repliedInbounds = (params.currentInboundMessages || []).filter((message) =>
    Boolean(message.replyToMessageId)
  );
  if (repliedInbounds.length > 0) {
    lines.push("REPLY_CONTEXT_DESTE_TURNO:");
    for (const message of repliedInbounds) {
      const replyToMessageId = String(message.replyToMessageId || "");
      const target = params.replyTargets?.[replyToMessageId];
      const targetSender = target?.sender === "pretendente"
        ? "PRETENDENTE"
        : target?.sender === "larissa"
        ? "LARISSA"
        : "DESCONHECIDO";
      const targetText = target?.text
        ? String(target.text).replace(/\s+/g, " ").trim().slice(0, 700)
        : "[mensagem citada não resolvida]";
      lines.push(
        `- inbound_id=${message.id} RESPONDE_ESPECIFICAMENTE_A id=${replyToMessageId} autor=${targetSender} texto=${JSON.stringify(targetText)}`
      );
    }
    lines.push(
      "REPLY_SEMANTICS: cada vínculo acima pertence àquele inbound_id específico. Interprete respostas curtas como 'sim', 'não', 'kkk', 'pois é' em relação à mensagem citada, nunca como resposta genérica ao último balão."
    );
  }

  if (params.manualResolutionAnswer) {
    lines.push("RESOLUCAO_MANUAL_CONFIRMADA:");
    lines.push(`question=${params.manualResolutionAnswer.question}`);
    lines.push(`answer=${params.manualResolutionAnswer.answer}`);
    if (params.manualResolutionAnswer.context) lines.push(`context=${params.manualResolutionAnswer.context}`);
    lines.push("Não retorne manual_resolution novamente para este mesmo fato.");
  }

  if (params.manualSessionFacts?.length) {
    lines.push("FATOS_MANUAIS_DA_SESSAO:");
    for (const fact of params.manualSessionFacts) lines.push(`- ${fact.id}: ${fact.fact}`);
  }

  if (params.recentStyleStateSnippet) lines.push(params.recentStyleStateSnippet.trim());
  if (params.greetingRepeatFeedback) lines.push(`GREETING_REPEAT_GUARD: ${params.greetingRepeatFeedback}`);
  if (params.schemaFeedback) lines.push(`SCHEMA_RETRY: ${params.schemaFeedback}`);
  lines.push(
    "O backend continua autoridade de objetivos, etapas, outbox e idempotência. Você decide semanticamente a resposta.",
    "OBJETIVO_ATIVO é uma missão persistente da etapa: enquanto estiver presente e obrigatório, ele continua pendente até existir evidência real de conclusão. Ter perguntado antes SEM resposta não significa concluído.",
    "Com OBJETIVO_ATIVO obrigatório, objectiveDecision='none' é inválido. Escolha pursue quando houver ponte semântica OU uma transição natural de assunto; escolha defer somente quando realmente não houver espaço naquele turno e informe objectiveDeferralReason.",
    "Quando a resposta ao assunto atual terminaria em mera reação/comentário e deixaria a conversa sem direção, isso é uma natural_transition: use o objetivo ativo para abrir o próximo assunto de forma humana.",
    "Ao usar pursue em objetivo factual, faça a pergunta do objetivo no mesmo turno e anote questionIntents[].objectiveId com o ID exato do OBJETIVO_ATIVO.",
    "Não repita a mesma frase de pergunta em sequência, mas um objetivo obrigatório ainda sem resposta pode e deve ser retomado depois com formulação natural; anti-repetição nunca transforma pergunta ignorada em objetivo concluído.",
    "OBJETIVO_ATIVO controla o próximo dado ainda pendente sobre o pretendente; ele NÃO limita a categoria temática do Cofre.",
    "Objetivo completed significa somente não perguntar esse dado novamente ao pretendente; NÃO desabilita áudio vinculado ao mesmo objective_id.",
    "TRANSIÇÃO DE ETAPA É OBRIGATÓRIA: se todos os objetivos required=true da ETAPA_ATUAL já estiverem completed, inclusive quando o último for concluído neste próprio turno, e PROXIMA_ETAPA_CONFIGURADA não for 'nenhuma', declare stageTransition={stageId: PROXIMA_ETAPA_CONFIGURADA, reason: 'all_required_objectives_completed'}.",
    "Nunca avance de etapa enquanto existir objetivo obrigatório pendente. Nunca pule uma etapa configurada. Na ETAPA_FINAL não declare avanço; a finalização é aplicada após a conclusão dos objetivos.",
    "Se a mensagem atual perguntar algo sobre Larissa relacionado a qualquer objective_id configurado da etapa — inclusive um objetivo completed, como uma devolução 'e vc?' após ele responder — consulte cofre_audio_search com o objective_id desse assunto. Outro objetivo estar ativo não bloqueia essa consulta.",
    "Não repita cofre_audio_search para o mesmo objective_id no mesmo turno.",
  );
  return lines.join("\n");
}

function technicalSystemMessage(text: string): any {
  return {
    type: "message",
    role: "system",
    content: [{ type: "input_text", text }],
  };
}

function buildTurnInput(params: RunOpenAiBrainParams): any[] | string {
  const items: any[] = [
    technicalSystemMessage(buildOperationalTurnState(params)),
  ];

  if (params.greetingRepeatFeedback || params.schemaFeedback) {
    items.push(technicalSystemMessage(
      "[EVENTO INTERNO VENDEO] Regere a decisão anterior conforme a correção descrita no estado operacional. Não trate isto como nova mensagem do pretendente."
    ));
    return items;
  }
  if (params.manualResolutionAnswer) {
    items.push(technicalSystemMessage(
      "[EVENTO INTERNO VENDEO] O operador respondeu a resolução manual. Continue o turno usando o estado operacional."
    ));
    return items;
  }
  if (params.currentInboundMessages?.length) {
    items.push(technicalSystemMessage(
      "[EVENTO INTERNO VENDEO] Há novas mensagens reais do Instagram já persistidas nesta Conversation. Analise apenas o novo delta ainda não respondido e produza a decisão do turno."
    ));
    return items;
  }
  if (params.inboundMessages?.length) {
    items.push(...params.inboundMessages.map((text) => ({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    })));
    return items;
  }

  items.push(technicalSystemMessage(
    "[EVENTO INTERNO VENDEO] Reavalie o turno atual usando o estado operacional."
  ));
  return items;
}

function detailSum(details: Array<Record<string, number>> | undefined, key: string): number {
  return (details || []).reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
}

const SDK_EXECUTION_MARKER_PREFIX = "[VENDEO_BRAIN_EXECUTION]";

type SdkExecutionRow = {
  id: string;
  conversation_id: string;
  session_id: string;
  status: string;
  inbound_message_ids?: string[] | null;
  runtime_metadata?: Record<string, any> | null;
  updated_at?: string | null;
};

function sdkProviderSessionId(openAiConversationId: string): string {
  return `conversation:${openAiConversationId}`;
}

function sdkBrainSessionRowId(openAiConversationId: string): string {
  return `bs_${sdkProviderSessionId(openAiConversationId)}`;
}

function sdkBrainTurnId(executionKey: string): string {
  return `brain_turn_${executionKey}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildSdkExecutionKey(params: RunOpenAiBrainParams): Promise<string> {
  const inboundIds = (params.currentInboundMessages || [])
    .map((message) => String(message.id || "").trim())
    .filter(Boolean)
    .sort();

  const seed = JSON.stringify({
    version: 1,
    conversationId: params.conversationId,
    inboundIds,
    fallbackInbound: inboundIds.length === 0 ? (params.inboundMessages || []) : [],
    manualResolution: params.manualResolutionAnswer
      ? {
          factId: params.manualResolutionAnswer.factId || null,
          question: params.manualResolutionAnswer.question,
          answer: params.manualResolutionAnswer.answer,
        }
      : null,
  });

  return `sdkexec_${(await sha256Hex(seed)).slice(0, 48)}`;
}

function conversationMessageText(item: any): string {
  if (!item || item.type !== "message" || !Array.isArray(item.content)) return "";
  return item.content
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function restoreExecutionToolState(
  telemetry: OpenAiBrainTurnResult["telemetry"],
  toolState: Record<string, any> | null | undefined,
): void {
  if (!toolState || typeof toolState !== "object") return;
  if (Array.isArray(toolState.authorizedCandidateAudios)) {
    telemetry.authorizedCandidateAudios = toolState.authorizedCandidateAudios;
  }
  if (Array.isArray(toolState.authorizedCandidateAudiosByObjective)) {
    telemetry.authorizedCandidateAudiosByObjective = toolState.authorizedCandidateAudiosByObjective;
  }
}

function executionUsageSnapshot(
  telemetry: OpenAiBrainTurnResult["telemetry"],
): Record<string, any> {
  return {
    inputTokens: telemetry.inputTokens,
    outputTokens: telemetry.outputTokens,
    totalTokens: telemetry.totalTokens,
    turnInputTokens: telemetry.turnInputTokens ?? null,
    turnCachedInputTokens: telemetry.turnCachedInputTokens ?? null,
    turnUncachedInputTokens: telemetry.turnUncachedInputTokens ?? null,
    turnOutputTokens: telemetry.turnOutputTokens ?? null,
    turnReasoningTokens: telemetry.turnReasoningTokens ?? null,
    turnTotalTokens: telemetry.turnTotalTokens ?? null,
    modelGenerationCount: telemetry.modelGenerationCount ?? null,
    webSearchCallCount: telemetry.webSearchCallCount ?? 0,
    webSearchStatus: telemetry.webSearchStatus || "not_used",
    serviceTierRequested: telemetry.serviceTierRequested || null,
    serviceTierActual: telemetry.serviceTierActual || null,
    sourcesUsed: telemetry.sourcesUsed || [],
  };
}

function restoreExecutionUsage(
  telemetry: OpenAiBrainTurnResult["telemetry"],
  usage: Record<string, any> | null | undefined,
): void {
  if (!usage || typeof usage !== "object") return;
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "turnInputTokens",
    "turnCachedInputTokens",
    "turnUncachedInputTokens",
    "turnOutputTokens",
    "turnReasoningTokens",
    "turnTotalTokens",
    "modelGenerationCount",
    "webSearchCallCount",
  ] as const) {
    const value = usage[key];
    if (typeof value === "number") (telemetry as any)[key] = value;
  }
  if (typeof usage.webSearchStatus === "string") {
    telemetry.webSearchStatus = usage.webSearchStatus as any;
  }
  if (typeof usage.serviceTierRequested === "string") {
    telemetry.serviceTierRequested = usage.serviceTierRequested as "auto" | "default" | "flex";
  }
  if (typeof usage.serviceTierActual === "string") {
    telemetry.serviceTierActual = usage.serviceTierActual;
  }
  if (Array.isArray(usage.sourcesUsed)) {
    telemetry.sourcesUsed = usage.sourcesUsed.map(String);
  }
}

function validateAndNormalizeSdkPlan(
  params: RunOpenAiBrainParams,
  parsedPlan: any,
  telemetry: OpenAiBrainTurnResult["telemetry"],
): { plan: any | null; error: string | null } {
  const basic = validateConversationBrainPlan(
    parsedPlan,
    (params.pendingOutboundActions || []).map((action) => action.actionId),
  );
  const response = validateResponseGenerationInvariant(parsedPlan);
  const progression = validateObjectiveProgressionInvariant(parsedPlan, {
    currentObjectiveId: params.currentObjectiveId,
    currentObjectiveRequired: params.currentObjectiveRequired,
    currentObjectiveKind: params.currentObjectiveKind,
  });
  const stageProgression = validateStageProgressionInvariant(parsedPlan, {
    currentStageId: params.currentStageId,
    nextStageId: params.nextStageId,
    isFinalStage: params.isFinalStage,
    stageObjectives: params.stageObjectives,
  });
  const manualReask = Boolean(params.manualResolutionAnswer && parsedPlan?.action === "manual_resolution");

  const questionValidation = validateQuestionIntentsInvariant(parsedPlan);
  const isObjectivePursuit =
    Boolean(params.currentObjectiveId) &&
    String(parsedPlan?.objectiveDecision || parsedPlan?.missionPackage?.objectiveDirective || "") === "pursue";
  if (!questionValidation.valid && parsedPlan && typeof parsedPlan === "object" && !isObjectivePursuit) {
    telemetry.questionIntentsValidationWarning = questionValidation.error || "invalid_question_intents";
    parsedPlan.questionIntents = [];
    parsedPlan.resolvedQuestionIntentIds = [];
  }

  const selectedAudioId = Array.isArray(parsedPlan?.outboundActions)
    ? parsedPlan.outboundActions.find((action: any) => action?.type === "audio")?.audioId
    : parsedPlan?.selectedAudioId || parsedPlan?.audioId;
  const authorizedAudioIds = new Set([
    ...(telemetry.authorizedCandidateAudios || []).map((candidate) => candidate.audioId),
    ...(params.recoveredAudioToolState?.candidates || []).map((candidate) => candidate.audioId),
  ]);
  const audioAuthorized = !selectedAudioId || authorizedAudioIds.has(String(selectedAudioId));

  const validationError = !basic.valid
    ? basic.error || "invalid_brain_plan"
    : !response.valid
    ? response.error || "invalid_response_generation"
    : !progression.valid
    ? progression.error || "invalid_objective_progression"
    : !stageProgression.valid
    ? stageProgression.error || "invalid_stage_progression"
    : isObjectivePursuit && !questionValidation.valid
    ? questionValidation.error || "invalid_objective_question_intent"
    : manualReask
    ? "manual_resolution_reask_forbidden_after_operator_answer"
    : !audioAuthorized
    ? "audio_not_authorized_for_this_turn"
    : null;

  if (!parsedPlan || validationError) {
    const hardContractViolation =
      !progression.valid ||
      !stageProgression.valid ||
      (isObjectivePursuit && !questionValidation.valid) ||
      manualReask ||
      validationError === "audio_not_authorized_for_this_turn";
    if (!params.strictOpenAiPilot && !hardContractViolation) {
      parsedPlan = recoverSafeBrainPlan(parsedPlan);
    }
    if (!parsedPlan || hardContractViolation) {
      return {
        plan: null,
        error: validationError || "BRAIN_PLAN_INVALID_NO_SAFE_RESPONSES",
      };
    }
  }

  return { plan: parsedPlan, error: null };
}

async function readSdkExecution(
  supabase: any,
  executionKey: string,
  turnId = sdkBrainTurnId(executionKey),
): Promise<SdkExecutionRow | null> {
  const { data, error } = await supabase
    .from("brain_turns")
    .select("id, conversation_id, session_id, status, inbound_message_ids, runtime_metadata, updated_at")
    .eq("id", turnId)
    .maybeSingle();
  if (error) throw new Error(`openai_sdk_execution_read_failed: ${error.message}`);
  return data || null;
}

async function ensureSdkExecutionTurn(params: {
  supabase: any;
  executionKey: string;
  conversationId: string;
  openAiConversationId: string;
  inboundMessageIds: string[];
  turnId?: string | null;
}): Promise<SdkExecutionRow> {
  const nowIso = new Date().toISOString();
  const providerSessionId = sdkProviderSessionId(params.openAiConversationId);
  const sessionRowId = sdkBrainSessionRowId(params.openAiConversationId);
  const turnId = params.turnId || sdkBrainTurnId(params.executionKey);

  const { error: sessionError } = await params.supabase
    .from("brain_sessions")
    .upsert({
      id: sessionRowId,
      conversation_id: params.conversationId,
      provider: "openai_conversation",
      provider_session_id: providerSessionId,
      context_version: 1,
      status: "active",
      bootstrap_context: {},
      updated_at: nowIso,
    }, { onConflict: "id" });
  if (sessionError) {
    throw new Error(`openai_sdk_brain_session_upsert_failed: ${sessionError.message}`);
  }

  const existing = await readSdkExecution(params.supabase, params.executionKey, turnId);
  if (existing) return existing;

  const runtimeMetadata = {
    runtime: "agents_sdk_conversation",
    executionKey: params.executionKey,
    openAiConversationId: params.openAiConversationId,
    attemptCount: 0,
    toolState: {},
  };

  const { data, error } = await params.supabase
    .from("brain_turns")
    .insert({
      id: turnId,
      conversation_id: params.conversationId,
      session_id: sessionRowId,
      provider_turn_id: null,
      status: "brain_running",
      inbound_message_ids: params.inboundMessageIds,
      version: 1,
      lease_expires_at: null,
      runtime_metadata: runtimeMetadata,
      updated_at: nowIso,
    })
    .select("id, conversation_id, session_id, status, inbound_message_ids, runtime_metadata, updated_at")
    .maybeSingle();

  if (!error && data) return data;

  const concurrent = await readSdkExecution(params.supabase, params.executionKey, turnId);
  if (concurrent) return concurrent;

  throw new Error(`openai_sdk_brain_turn_create_failed: ${error?.message || "unknown"}`);
}

async function patchSdkExecutionMetadata(
  supabase: any,
  executionKey: string,
  patch: Record<string, any>,
  turnId = sdkBrainTurnId(executionKey),
): Promise<SdkExecutionRow> {
  const current = await readSdkExecution(supabase, executionKey, turnId);
  if (!current) throw new Error("openai_sdk_execution_turn_missing");

  const runtimeMetadata = {
    ...(current.runtime_metadata || {}),
    ...patch,
  };

  const { data, error } = await supabase
    .from("brain_turns")
    .update({
      runtime_metadata: runtimeMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .select("id, conversation_id, session_id, status, inbound_message_ids, runtime_metadata, updated_at")
    .maybeSingle();

  if (error || !data) {
    throw new Error(`openai_sdk_execution_metadata_persist_failed: ${error?.message || "unknown"}`);
  }
  return data;
}

async function ensureSdkExecutionMarker(params: {
  supabase: any;
  client: any;
  executionKey: string;
  conversationId: string;
  openAiConversationId: string;
  existingRow: SdkExecutionRow | null;
  turnId: string;
}): Promise<string> {
  const existingMarkerId = params.existingRow?.runtime_metadata?.markerItemId;
  if (existingMarkerId) return String(existingMarkerId);

  const markerText = [
    SDK_EXECUTION_MARKER_PREFIX,
    `execution_key=${params.executionKey}`,
    "Marcador técnico de execução do Brain. Não é mensagem do pretendente nem da Larissa.",
  ].join("\n");

  const created = await params.client.conversations.items.create(
    params.openAiConversationId,
    {
      items: [{
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: markerText }],
      }],
    },
    { idempotencyKey: `vendeo:brain-marker:${params.executionKey}` },
  );

  const markerItemId = String(created?.data?.[0]?.id || "");
  if (!markerItemId) throw new Error("openai_sdk_execution_marker_missing_id");

  await patchSdkExecutionMetadata(
    params.supabase,
    params.executionKey,
    { markerItemId },
    params.turnId,
  );

  return markerItemId;
}

async function recoverSdkExecutionPlan(params: {
  client: any;
  openAiConversationId: string;
  markerItemId: string;
  executionKey: string;
  brainParams: RunOpenAiBrainParams;
  telemetry: OpenAiBrainTurnResult["telemetry"];
}): Promise<{ plan: any; itemId: string } | null> {
  const iterator = await params.client.conversations.items.list(
    params.openAiConversationId,
    {
      after: params.markerItemId,
      order: "asc",
      limit: 100,
    },
  );

  let recovered: { plan: any; itemId: string } | null = null;
  for await (const item of iterator) {
    if (item?.type === "message" && item?.role === "system") {
      const systemText = conversationMessageText(item);
      if (
        systemText.startsWith(SDK_EXECUTION_MARKER_PREFIX) &&
        !systemText.includes(`execution_key=${params.executionKey}`)
      ) {
        break;
      }
      continue;
    }

    if (
      item?.type !== "message" ||
      item?.role !== "assistant" ||
      item?.status !== "completed"
    ) {
      continue;
    }

    const rawText = conversationMessageText(item);
    if (!rawText) continue;
    const parsed = extractJsonFromText(rawText);
    const normalized = validateAndNormalizeSdkPlan(params.brainParams, parsed, params.telemetry);
    if (!normalized.plan || normalized.error) continue;

    recovered = {
      plan: normalized.plan,
      itemId: String(item.id || ""),
    };
  }

  return recovered?.itemId ? recovered : null;
}

function looksLikeBrainDecisionMessage(item: any): boolean {
  if (item?.type !== "message" || item?.role !== "assistant") return false;
  const text = conversationMessageText(item);
  if (!text) return false;
  const parsed = extractJsonFromText(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

  return (
    typeof parsed.action === "string" ||
    Array.isArray(parsed.outboundActions) ||
    Array.isArray(parsed.responses) ||
    parsed.manualResolution != null ||
    parsed.stageTransition != null ||
    parsed.objectiveCompletion != null ||
    Array.isArray(parsed.objectiveUpdates)
  );
}

async function cleanupSdkConversationTechnicalItems(params: {
  supabase: any;
  client: any;
  executionKey: string;
  turnId: string;
  openAiConversationId: string;
  markerItemId: string | null | undefined;
  providerOutputItemIds?: string[];
}): Promise<void> {
  const markerItemId = String(params.markerItemId || "").trim();
  if (!markerItemId) return;

  const providerOutputIds = new Set(
    (params.providerOutputItemIds || []).map(String).filter(Boolean),
  );
  const deleteIds: string[] = [];

  try {
    const iterator = await params.client.conversations.items.list(
      params.openAiConversationId,
      {
        after: markerItemId,
        order: "asc",
        limit: 100,
      },
    );

    for await (const item of iterator) {
      const itemId = String(item?.id || "");
      if (!itemId) continue;

      if (item?.type === "message") {
        const text = conversationMessageText(item);

        // Outro marcador significa que outra execução começou; nunca atravessa
        // essa fronteira para limpar itens que não pertencem ao run atual.
        if (
          item?.role === "system" &&
          text.startsWith(SDK_EXECUTION_MARKER_PREFIX) &&
          !text.includes(`execution_key=${params.executionKey}`)
        ) {
          break;
        }

        if (item?.role === "system" || item?.role === "developer") {
          deleteIds.push(itemId);
          continue;
        }

        // A saída estruturada do Brain é assistant, mas não é uma fala da Larissa.
        // IDs retornados pelo provider têm prioridade; a heurística cobre recovery
        // após crash, quando o objeto rawResponses já não existe no novo processo.
        if (
          item?.role === "assistant" &&
          (providerOutputIds.has(itemId) || looksLikeBrainDecisionMessage(item))
        ) {
          deleteIds.push(itemId);
        }

        // user/assistant naturais ficam intactos, inclusive se chegaram enquanto
        // o Brain estava processando.
        continue;
      }

      // Tool calls, tool outputs, reasoning, web_search etc. são estado interno
      // do Agent e nunca fazem parte da conversa Instagram.
      deleteIds.push(itemId);
    }

    for (const itemId of deleteIds) {
      await params.client.conversations.items.delete(
        itemId,
        { conversation_id: params.openAiConversationId },
      );
    }

    // O marcador é removido por último: enquanto ele existir, ainda há uma
    // âncora segura para recuperação em caso de queda durante a limpeza.
    await params.client.conversations.items.delete(
      markerItemId,
      { conversation_id: params.openAiConversationId },
    );

    await patchSdkExecutionMetadata(
      params.supabase,
      params.executionKey,
      {
        markerItemId: null,
        technicalCleanupCompletedAt: new Date().toISOString(),
        technicalCleanupLastError: null,
      },
      params.turnId,
    );
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 1000);
    try {
      await patchSdkExecutionMetadata(
        params.supabase,
        params.executionKey,
        { technicalCleanupLastError: message },
        params.turnId,
      );
    } catch {}

    // Limpeza é pós-checkpoint. Nunca transforma uma decisão válida em falha
    // operacional; o metadata permite nova tentativa posterior.
    console.warn("[OpenAI SDK] technical conversation cleanup failed:", message);
  }
}

async function cleanupUnfinishedSdkConversationExecutions(params: {
  supabase: any;
  client: any;
  conversationId: string;
  openAiConversationId: string;
}): Promise<number> {
  const { data, error } = await params.supabase
    .from("brain_turns")
    .select("id, created_at, runtime_metadata")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.warn("[OpenAI SDK] stale technical execution lookup failed:", error.message || error);
    return 0;
  }

  const staleRows = (data || []).filter((row: any) => {
    const metadata = row?.runtime_metadata || {};
    return metadata.runtime === "agents_sdk_conversation"
      && String(metadata.openAiConversationId || "") === params.openAiConversationId
      && Boolean(metadata.markerItemId)
      && !metadata.technicalCleanupCompletedAt;
  });

  let cleanupAttempts = 0;
  for (const row of staleRows) {
    const metadata = row.runtime_metadata || {};
    const executionKey = String(metadata.executionKey || "").trim();
    const markerItemId = String(metadata.markerItemId || "").trim();
    if (!executionKey || !markerItemId) continue;

    cleanupAttempts++;
    await cleanupSdkConversationTechnicalItems({
      supabase: params.supabase,
      client: params.client,
      executionKey,
      turnId: String(row.id),
      openAiConversationId: params.openAiConversationId,
      markerItemId,
    });
  }

  return cleanupAttempts;
}

async function markSdkExecutionAttempt(
  supabase: any,
  executionKey: string,
  turnId: string,
): Promise<{ attempt: number; row: SdkExecutionRow }> {
  const current = await readSdkExecution(supabase, executionKey, turnId);
  if (!current) throw new Error("openai_sdk_execution_turn_missing");

  const nextAttempt = Number(current.runtime_metadata?.attemptCount || 0) + 1;
  const row = await patchSdkExecutionMetadata(supabase, executionKey, {
    attemptCount: nextAttempt,
    lastError: null,
    lastAttemptAt: new Date().toISOString(),
  }, turnId);

  return { attempt: nextAttempt, row };
}

async function persistSdkExecutionToolState(
  supabase: any,
  executionKey: string,
  turnId: string,
  telemetry: OpenAiBrainTurnResult["telemetry"],
): Promise<void> {
  const toolState = {
    authorizedCandidateAudios: telemetry.authorizedCandidateAudios || [],
    authorizedCandidateAudiosByObjective: telemetry.authorizedCandidateAudiosByObjective || [],
  };
  try {
    await patchSdkExecutionMetadata(supabase, executionKey, { toolState }, turnId);
  } catch (error) {
    console.warn("[OpenAI SDK] execution tool_state persist failed:", error);
  }
}

async function completeSdkExecution(params: {
  supabase: any;
  executionKey: string;
  turnId: string;
  plan: any;
  usage?: Record<string, any> | null;
  providerResponseId?: string | null;
  recoveredConversationItemId?: string | null;
}): Promise<void> {
  await patchSdkExecutionMetadata(params.supabase, params.executionKey, {
    acceptedPlan: params.plan,
    usage: params.usage || null,
    providerResponseId: params.providerResponseId || null,
    recoveredConversationItemId: params.recoveredConversationItemId || null,
    lastError: null,
    acceptedAt: new Date().toISOString(),
  }, params.turnId);
}

async function failSdkExecution(
  supabase: any,
  executionKey: string,
  turnId: string,
  error: unknown,
): Promise<void> {
  const message = String((error as Error)?.message || error).slice(0, 1000);
  await patchSdkExecutionMetadata(supabase, executionKey, {
    lastError: message,
    failedAt: new Date().toISOString(),
  }, turnId);
}

async function persistInboundMessagesInOpenAiConversation(
  params: RunOpenAiBrainParams,
): Promise<void> {
  if (
    params.greetingRepeatFeedback ||
    params.schemaFeedback ||
    params.manualResolutionAnswer ||
    !params.currentInboundMessages?.length
  ) {
    return;
  }

  for (const message of params.currentInboundMessages) {
    const replyToMessageId = String(message.replyToMessageId || "").trim();
    const replyTarget = replyToMessageId ? params.replyTargets?.[replyToMessageId] : null;
    await persistInboundToOpenAiConversation({
      supabase: params.supabase,
      conversationId: params.conversationId,
      providerMessageId: String(message.id),
      text: message.text,
      audioTranscript: message.audioTranscript || null,
      mediaType: message.mediaType || null,
      receivedAt: message.createdAt || null,
      replyContext: replyToMessageId && replyTarget
        ? {
            messageId: replyToMessageId,
            sender: replyTarget.sender === "pretendente" ? "pretendente" : "larissa",
            text: String(replyTarget.text || ""),
          }
        : null,
    });
  }
}
export async function runOpenAiSdkBrainTurn(
  params: RunOpenAiBrainParams,
): Promise<OpenAiBrainTurnResult> {
  const startedAt = Date.now();
  const apiKey = params.apiKey || env("OPENAI_API_KEY") || "";
  const model = params.model || env("OPENAI_BRAIN_MODEL") || "";
  if (!model) {
    throw new Error("OPENAI_BRAIN_MODEL_REQUIRED");
  }
  const agentId = params.agentId || "agents-sdk-conversation";

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
    agentUsageSessions: [],
    sourcesUsed: [],
    actualMemoryToolCalled: false,
    persistentAgentSessionEnabled: false,
    personaMemoryToolEnabled: false,
    contactMemoryToolEnabled: false,
    conversationMemoryToolEnabled: false,
    audioSearchToolEnabled: true,
    webSearchEnabled: true,
    webSearchCallCount: 0,
    webSearchDuplicateCallCount: 0,
    webSearchStatus: "not_used",
    webSearchSources: [],
    agentSessionModelRequested: model,
    agentSessionModelActual: model,
    agentSessionReasoningRequested: params.reasoningEffort || null,
    agentSessionReasoningActual: params.reasoningEffort || null,
  };

  if (!apiKey) {
    telemetry.status = "failed";
    return { success: false, plan: null, error: "OPENAI_API_KEY ausente", telemetry };
  }

  setDefaultOpenAIKey(apiKey);
  let link: Awaited<ReturnType<typeof resolveOpenAiConversationId>>;
  try {
    link = await resolveOpenAiConversationId({
      supabase: params.supabase,
      conversationId: params.conversationId,
      apiKey,
    });
  } catch (error) {
    telemetry.status = "failed";
    telemetry.durationMs = Date.now() - startedAt;
    return { success: false, plan: null, error: String((error as Error)?.message || error), telemetry };
  }
  telemetry.openAiConversationId = link.openAiConversationId;

  try {
    await bootstrapOpenAiConversationHistory({
      supabase: params.supabase,
      conversationId: params.conversationId,
      openAiConversationId: link.openAiConversationId,
    });
    await persistInboundMessagesInOpenAiConversation(params);
  } catch (error) {
    telemetry.status = "failed";
    telemetry.durationMs = Date.now() - startedAt;
    return {
      success: false,
      plan: null,
      error: String((error as Error)?.message || error),
      telemetry,
    };
  }

  const client = getDefaultOpenAIClient<any>();
  if (!client?.conversations?.items?.create || !client?.conversations?.items?.list) {
    telemetry.status = "failed";
    telemetry.durationMs = Date.now() - startedAt;
    return {
      success: false,
      plan: null,
      error: "openai_conversations_client_unavailable",
      telemetry,
    };
  }

  let executionKey = "";
  let executionTurnId = "";
  let executionMarkerItemId = "";
  let executionPrepared = false;
  try {
    executionKey = await buildSdkExecutionKey(params);
    executionTurnId = params.localTurnId || sdkBrainTurnId(executionKey);
    telemetry.executionKey = executionKey;

    let executionRow = await ensureSdkExecutionTurn({
      supabase: params.supabase,
      executionKey,
      conversationId: params.conversationId,
      openAiConversationId: link.openAiConversationId,
      inboundMessageIds: (params.currentInboundMessages || [])
        .map((message) => String(message.id || "").trim())
        .filter(Boolean),
      turnId: executionTurnId,
    });

    // Uma resolução manual pode reutilizar o mesmo brain_turn com uma nova
    // execução do modelo. Nesse caso, reseta apenas o metadata daquela execução.
    if (executionRow.runtime_metadata?.executionKey !== executionKey) {
      executionRow = await patchSdkExecutionMetadata(params.supabase, executionKey, {
        runtime: "agents_sdk_conversation",
        executionKey,
        openAiConversationId: link.openAiConversationId,
        attemptCount: 0,
        markerItemId: null,
        acceptedPlan: null,
        usage: null,
        toolState: {},
        providerResponseId: null,
        recoveredConversationItemId: null,
        lastError: null,
      }, executionTurnId);
    }

    const executionMeta = executionRow.runtime_metadata || {};
    restoreExecutionToolState(telemetry, executionMeta.toolState);

    // Se um processo anterior já checkpointou o plano aceito, reutiliza exatamente
    // esse resultado e não chama o modelo novamente.
    if (executionMeta.acceptedPlan) {
      telemetry.executionAttempt = Number(executionMeta.attemptCount || 0);
      telemetry.executionRecovered = true;
      telemetry.providerResponseId = executionMeta.providerResponseId || undefined;
      telemetry.recoveredConversationItemId = executionMeta.recoveredConversationItemId || undefined;
      restoreExecutionUsage(telemetry, executionMeta.usage);

      if (executionMeta.markerItemId && !executionMeta.technicalCleanupCompletedAt) {
        await cleanupSdkConversationTechnicalItems({
          supabase: params.supabase,
          client,
          executionKey,
          turnId: executionTurnId,
          openAiConversationId: link.openAiConversationId,
          markerItemId: executionMeta.markerItemId,
        });
      }

      telemetry.status = "completed";
      telemetry.finalPlanParsed = true;
      telemetry.durationMs = Date.now() - startedAt;
      return { success: true, plan: executionMeta.acceptedPlan, telemetry };
    }

    const markerItemId = await ensureSdkExecutionMarker({
      supabase: params.supabase,
      client,
      executionKey,
      conversationId: params.conversationId,
      openAiConversationId: link.openAiConversationId,
      existingRow: executionRow,
      turnId: executionTurnId,
    });
    executionMarkerItemId = markerItemId;

    // Fecha o gap mais perigoso: OpenAI concluiu, mas a Edge morreu antes do
    // checkpoint local. O resultado final já está na Conversation após o marcador.
    const recovered = await recoverSdkExecutionPlan({
      client,
      openAiConversationId: link.openAiConversationId,
      markerItemId,
      executionKey,
      brainParams: params,
      telemetry,
    });

    if (recovered) {
      await completeSdkExecution({
        supabase: params.supabase,
        executionKey,
        turnId: executionTurnId,
        plan: recovered.plan,
        providerResponseId: executionMeta.providerResponseId || null,
        recoveredConversationItemId: recovered.itemId,
      });
      telemetry.executionAttempt = Number(executionMeta.attemptCount || 0);
      telemetry.executionRecovered = true;
      telemetry.recoveredConversationItemId = recovered.itemId;

      await cleanupSdkConversationTechnicalItems({
        supabase: params.supabase,
        client,
        executionKey,
        turnId: executionTurnId,
        openAiConversationId: link.openAiConversationId,
        markerItemId,
      });

      telemetry.status = "completed";
      telemetry.finalPlanParsed = true;
      telemetry.durationMs = Date.now() - startedAt;
      return { success: true, plan: recovered.plan, telemetry };
    }

    // Concorrência/lease continuam sob responsabilidade do ciclo operacional já
    // existente. Aqui apenas registramos quantas vezes este run foi realmente tentado.
    const attempt = await markSdkExecutionAttempt(
      params.supabase,
      executionKey,
      executionTurnId,
    );
    telemetry.executionAttempt = attempt.attempt;
    executionPrepared = true;
    restoreExecutionToolState(telemetry, attempt.row.runtime_metadata?.toolState);
  } catch (error) {
    telemetry.status = "failed";
    telemetry.durationMs = Date.now() - startedAt;
    return {
      success: false,
      plan: null,
      error: String((error as Error)?.message || error),
      telemetry,
    };
  }

  const seenAudioObjectives = new Map<string, string>();
  const audioTool = tool({
    name: "cofre_audio_search",
    description: "Retorna candidatos autorizados do Cofre de Áudios para um objective_id. O Brain escolhe semanticamente se usa algum.",
    parameters: AudioSearchArgs,
    execute: async ({ objective_id, query }) => {
      const cacheKey = objective_id.trim();
      const cached = seenAudioObjectives.get(cacheKey);
      if (cached) return cached;

      const toolResult = await executeOpenAiAppTool({
        toolName: "cofre_audio_search",
        toolArgs: { objective_id: cacheKey, query: query || "" },
        supabase: params.supabase,
        conversationId: params.conversationId,
        searchCofreAudios: params.searchCofreAudios,
        telemetry,
      });
      await persistSdkExecutionToolState(
        params.supabase,
        executionKey,
        executionTurnId,
        telemetry,
      );
      const output = JSON.stringify(toolResult.output);
      seenAudioObjectives.set(cacheKey, output);
      return output;
    },
  });

  // Keep Agent instructions byte-for-byte stable across turns so the provider can
  // reuse the large canonical prefix through prompt caching. Turn-specific state
  // is sent separately by buildTurnInput().
  const instructions = buildCanonicalAgentInstructions({ persistentMode: true });

  const reasoningEffort = params.reasoningEffort as any;
  const serviceTier: "auto" | "default" | "flex" = params.serviceTier || "auto";
  telemetry.serviceTierRequested = serviceTier;
  const brain = new Agent({
    name: "Vendeo Brain",
    instructions,
    model,
    modelSettings: {
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      promptCacheOptions: {
        mode: "implicit",
        ttl: "30m",
      },
      providerData: {
        service_tier: serviceTier,
      },
    },
    tools: [audioTool, webSearchTool({ searchContextSize: "low", externalWebAccess: true })],
    resetToolChoice: true,
  });
  try {
    const result = await run(brain, buildTurnInput(params) as any, {
      conversationId: link.openAiConversationId,
      maxTurns: 8,
      signal: params.signal,
    });

    const usage = result.runContext.usage;
    telemetry.inputTokens = usage.inputTokens;
    telemetry.outputTokens = usage.outputTokens;
    telemetry.totalTokens = usage.totalTokens;
    telemetry.turnInputTokens = usage.inputTokens;
    telemetry.turnOutputTokens = usage.outputTokens;
    telemetry.turnTotalTokens = usage.totalTokens;
    telemetry.turnCachedInputTokens = detailSum(usage.inputTokensDetails, "cached_tokens");
    telemetry.turnUncachedInputTokens = Math.max(0, usage.inputTokens - (telemetry.turnCachedInputTokens || 0));
    telemetry.turnReasoningTokens = detailSum(usage.outputTokensDetails, "reasoning_tokens");
    telemetry.modelGenerationCount = usage.requests;
    telemetry.agentToolCallCount = telemetry.toolExecutionsCount;
    telemetry.toolNamesUsed = [...new Set(telemetry.toolsRequested)];

    const rawResponseText =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : JSON.stringify(result.finalOutput ?? "");

    const rawResponses = result.rawResponses || [];
    const providerOutputItemIds = rawResponses.flatMap((response: any) =>
      Array.isArray(response?.output)
        ? response.output.map((item: any) => String(item?.id || "")).filter(Boolean)
        : []
    );
    const lastProviderResponse = rawResponses.length > 0 ? rawResponses[rawResponses.length - 1] as any : null;
    const providerResponseId = String(lastProviderResponse?.id || lastProviderResponse?.responseId || "").trim();
    if (providerResponseId) telemetry.providerResponseId = providerResponseId;
    const serviceTierActual = String(
      lastProviderResponse?.service_tier || lastProviderResponse?.serviceTier || "",
    ).trim();
    telemetry.serviceTierActual = serviceTierActual || null;

    const webSearchCount = rawResponses.reduce((count, response) => {
      const output = Array.isArray(response.output) ? response.output : [];
      return count + output.filter((item: any) => String(item?.type || "").includes("web_search")).length;
    }, 0);
    telemetry.webSearchCallCount = webSearchCount;
    telemetry.webSearchStatus = webSearchCount > 0 ? "sources_found" : "not_used";
    if (webSearchCount > 0 && !telemetry.sourcesUsed.includes("web_search")) telemetry.sourcesUsed.push("web_search");

    const parsedPlan = extractJsonFromText(rawResponseText);
    const normalized = validateAndNormalizeSdkPlan(params, parsedPlan, telemetry);

    if (!normalized.plan || normalized.error) {
      const validationError = normalized.error || "BRAIN_PLAN_INVALID_NO_SAFE_RESPONSES";

      // Uma decisão semanticamente incompatível com o estado da etapa não deve
      // chegar ao outbox. Dá ao próprio Brain uma única chance de corrigir a
      // decisão, mantendo o mesmo turno, Conversation e marcador idempotente.
      if (!params.schemaRetryCount) {
        const firstAttemptTelemetry = { ...telemetry };
        const retryResult = await runOpenAiSdkBrainTurn({
          ...params,
          schemaRetryCount: 1,
          schemaFeedback: validationError,
        });

        const numericUsageKeys = [
          "inputTokens",
          "outputTokens",
          "totalTokens",
          "turnInputTokens",
          "turnCachedInputTokens",
          "turnUncachedInputTokens",
          "turnOutputTokens",
          "turnReasoningTokens",
          "turnTotalTokens",
          "modelGenerationCount",
        ] as const;
        for (const key of numericUsageKeys) {
          const first = Number((firstAttemptTelemetry as any)[key] || 0);
          const retried = Number((retryResult.telemetry as any)[key] || 0);
          (retryResult.telemetry as any)[key] = first + retried;
        }
        retryResult.telemetry.durationMs =
          Number(firstAttemptTelemetry.durationMs || 0) +
          Number(retryResult.telemetry.durationMs || 0);

        if (retryResult.success && executionKey && executionTurnId) {
          await patchSdkExecutionMetadata(
            params.supabase,
            executionKey,
            { usage: executionUsageSnapshot(retryResult.telemetry) },
            executionTurnId,
          );
        }
        return retryResult;
      }

      telemetry.status = "failed";
      telemetry.finalPlanParsed = false;
      telemetry.durationMs = Date.now() - startedAt;
      if (executionPrepared && executionKey && executionTurnId) {
        await failSdkExecution(
          params.supabase,
          executionKey,
          executionTurnId,
          validationError,
        );
        await cleanupSdkConversationTechnicalItems({
          supabase: params.supabase,
          client,
          executionKey,
          turnId: executionTurnId,
          openAiConversationId: link.openAiConversationId,
          markerItemId: executionMarkerItemId,
          providerOutputItemIds,
        });
      }
      return {
        success: false,
        plan: null,
        error: validationError,
        telemetry,
      };
    }

    // Este UPDATE é o checkpoint durável antes de devolver o resultado ao
    // orquestrador. Se o processo morrer depois daqui, o retry reutiliza este plano.
    await completeSdkExecution({
      supabase: params.supabase,
      executionKey,
      turnId: executionTurnId,
      plan: normalized.plan,
      usage: executionUsageSnapshot(telemetry),
      providerResponseId: providerResponseId || null,
    });

    await cleanupSdkConversationTechnicalItems({
      supabase: params.supabase,
      client,
      executionKey,
      turnId: executionTurnId,
      openAiConversationId: link.openAiConversationId,
      markerItemId: executionMarkerItemId,
      providerOutputItemIds,
    });

    telemetry.status = "completed";
    telemetry.finalPlanParsed = true;
    telemetry.durationMs = Date.now() - startedAt;
    return { success: true, plan: normalized.plan, telemetry };
  } catch (error) {
    const errorMessage = String((error as Error)?.message || error);
    const missingToolOutput = /No tool output found for function call/i.test(errorMessage);
    telemetry.status = "failed";
    telemetry.durationMs = Date.now() - startedAt;

    if (executionPrepared && executionKey && executionTurnId) {
      try {
        await failSdkExecution(params.supabase, executionKey, executionTurnId, error);
      } catch {}

      // Qualquer falha do provider pode acontecer depois de ele gravar tool calls,
      // reasoning ou outros itens t├®cnicos na Conversation. Se esses itens ficarem
      // sem o par de tool output, a Conversation inteira fica envenenada e todos
      // os ciclos seguintes falham com o mesmo call_id.
      try {
        if (missingToolOutput) {
          const cleanupAttempts = await cleanupUnfinishedSdkConversationExecutions({
            supabase: params.supabase,
            client,
            conversationId: params.conversationId,
            openAiConversationId: link.openAiConversationId,
          });
          console.warn(
            `[OpenAI SDK] missing_tool_output_repair cleanup_attempts=${cleanupAttempts} conversationId=${params.conversationId}`,
          );
        } else if (executionMarkerItemId) {
          await cleanupSdkConversationTechnicalItems({
            supabase: params.supabase,
            client,
            executionKey,
            turnId: executionTurnId,
            openAiConversationId: link.openAiConversationId,
            markerItemId: executionMarkerItemId,
          });
        }
      } catch (cleanupError) {
        console.warn(
          "[OpenAI SDK] failed run technical cleanup exception:",
          String((cleanupError as Error)?.message || cleanupError),
        );
      }
    }

    try {
      await params.supabase
        .from("openai_conversation_links")
        .update({
          last_error: errorMessage.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", params.conversationId);
    } catch {}

    // Recupera uma ├║nica vez depois de limpar TODOS os runs t├®cnicos incompletos
    // desta Conversation. O guard impede loop infinito se a causa externa persistir.
    if (missingToolOutput && (params.technicalRepairCount || 0) < 1) {
      console.warn(
        `[OpenAI SDK] retrying_after_missing_tool_output_repair conversationId=${params.conversationId}`,
      );
      const repaired = await runOpenAiSdkBrainTurn({
        ...params,
        technicalRepairCount: (params.technicalRepairCount || 0) + 1,
      });
      if (repaired.success) {
        repaired.telemetry.executionRecovered = true;
      }
      return repaired;
    }

    return {
      success: false,
      plan: null,
      error: errorMessage,
      telemetry,
    };
  }
}
