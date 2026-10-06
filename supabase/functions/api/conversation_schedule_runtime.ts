import { computeScheduleElapsedPercent, loadConnectionWindowArsenal, resolveFinalActionRuntime, resolveTemporalPhase, type ConnectionWindowArsenalCandidate, type ConnectionWindowFinalActionRuntime, type ConnectionWindowTemporalPhase } from "./connection_window_runtime.ts";

export interface ConversationScheduleRuntime {
  runId: string;
  scheduleId: string;
  scheduleName: string;
  scheduleDescription?: string | null;
  scheduleCategory: string;
  executionMode: "goal_driven" | "connection_window";
  connectionIntent?: string | null;
  temporalPhases?: ConnectionWindowTemporalPhase[];
  elapsedPercent?: number;
  remainingMinutes?: number | null;
  temporalPhase?: ConnectionWindowTemporalPhase | null;
  arsenalCandidates?: ConnectionWindowArsenalCandidate[];
  finalAction?: ConnectionWindowFinalActionRuntime | null;
  manualActionNote?: string | null;
  scheduleOrder: number;
  durationMinutes?: number | null;
  startedAt: string;
  expiresAt?: string | null;
  responseDelayMode: "fixed" | "range";
  responseDelayFixedSeconds?: number | null;
  responseDelayMinSeconds?: number | null;
  responseDelayMaxSeconds?: number | null;
  brainModel?: string | null;
  currentStageId: string;
  currentStageRequired: boolean;
  nextScheduleId?: string | null;
  nextScheduleName?: string | null;
  nextScheduleFirstStageId?: string | null;
}

async function enrichScheduleRuntime(
  supabase: any,
  conversationId: string,
  base: Omit<ConversationScheduleRuntime, "executionMode"> & { executionMode?: ConversationScheduleRuntime["executionMode"] },
): Promise<ConversationScheduleRuntime> {
  const { data: scheduleRow, error: scheduleError } = await supabase
    .from("conversation_schedules")
    .select("execution_mode, connection_intent, temporal_phases, final_action")
    .eq("id", base.scheduleId)
    .maybeSingle();
  if (scheduleError) throw new Error("conversation_schedule_runtime_unavailable:" + scheduleError.message);

  const executionMode = scheduleRow?.execution_mode === "connection_window"
    ? "connection_window"
    : "goal_driven";
  if (executionMode !== "connection_window") {
    return {
      ...base,
      executionMode,
      currentStageRequired: base.currentStageRequired !== false,
      arsenalCandidates: [],
      finalAction: null,
      temporalPhase: null,
    };
  }

  const { data: runRow, error: runError } = await supabase
    .from("conversation_schedule_runs")
    .select("final_action_status, final_action_delivered_at, final_action_provider_message_id, manual_action_note")
    .eq("id", base.runId)
    .maybeSingle();
  if (runError) throw new Error("conversation_schedule_runtime_unavailable:" + runError.message);

  const now = new Date();
  const elapsedPercent = computeScheduleElapsedPercent({
    startedAt: base.startedAt,
    expiresAt: base.expiresAt,
    durationMinutes: base.durationMinutes,
    now,
  });
  const remainingMinutes = base.expiresAt
    ? Math.max(0, Math.ceil((new Date(base.expiresAt).getTime() - now.getTime()) / 60_000))
    : null;
  const temporalPhase = resolveTemporalPhase(scheduleRow?.temporal_phases, elapsedPercent);
  const arsenalCandidates = base.runId
    ? await loadConnectionWindowArsenal({
        supabase,
        conversationId,
        runId: base.runId,
        scheduleId: base.scheduleId,
        now,
      })
    : [];
  const finalAction = resolveFinalActionRuntime({
    rawFinalAction: scheduleRow?.final_action,
    elapsedPercent,
    persistedStatus: runRow?.final_action_status || null,
    deliveredAt: runRow?.final_action_delivered_at || null,
    providerMessageId: runRow?.final_action_provider_message_id || null,
  });
  if (finalAction?.assetId) {
    const { data: finalAudio } = await supabase
      .from("persona_audios")
      .select("title, transcript, usage_instruction")
      .eq("id", finalAction.assetId)
      .eq("enabled", true)
      .maybeSingle();
    if (finalAudio) {
      finalAction.title = finalAction.title || finalAudio.title || finalAction.assetId;
      finalAction.transcript = finalAudio.transcript || null;
      finalAction.usageInstruction = finalAudio.usage_instruction || null;
    }
  }

  return {
    ...base,
    executionMode,
    connectionIntent: scheduleRow?.connection_intent || base.scheduleDescription || null,
    temporalPhases: Array.isArray(scheduleRow?.temporal_phases) ? scheduleRow.temporal_phases : undefined,
    elapsedPercent,
    remainingMinutes,
    temporalPhase,
    arsenalCandidates,
    finalAction,
    manualActionNote: runRow?.manual_action_note || null,
    currentStageRequired: false,
  };
}

export async function ensureConversationScheduleRuntime(
  supabase: any,
  conversationId: string,
): Promise<ConversationScheduleRuntime> {
  const { data, error } = await supabase.rpc(
    "ensure_conversation_schedule_run_atomic",
    { p_conversation_id: conversationId },
  );

  if (error || data?.success !== true) {
    throw new Error(
      "conversation_schedule_runtime_unavailable:" +
      (error?.message || data?.reason || "unknown"),
    );
  }

  return enrichScheduleRuntime(supabase, conversationId, {
    runId: String(data.run_id || ""),
    scheduleId: String(data.schedule_id || ""),
    scheduleName: String(data.schedule_name || ""),
    scheduleDescription: data.schedule_description ?? null,
    scheduleCategory: String(data.schedule_category || "custom"),
    scheduleOrder: Number(data.schedule_order || 0),
    durationMinutes: data.duration_minutes == null ? null : Number(data.duration_minutes),
    startedAt: String(data.started_at || ""),
    expiresAt: data.expires_at ? String(data.expires_at) : null,
    responseDelayMode: data.response_delay_mode === "range" ? "range" : "fixed",
    responseDelayFixedSeconds: data.response_delay_fixed_seconds == null ? null : Number(data.response_delay_fixed_seconds),
    responseDelayMinSeconds: data.response_delay_min_seconds == null ? null : Number(data.response_delay_min_seconds),
    responseDelayMaxSeconds: data.response_delay_max_seconds == null ? null : Number(data.response_delay_max_seconds),
    brainModel: data.brain_model ? String(data.brain_model) : null,
    currentStageId: String(data.current_stage_id || ""),
    currentStageRequired: data.current_stage_required !== false,
    nextScheduleId: data.next_schedule_id ? String(data.next_schedule_id) : null,
    nextScheduleName: data.next_schedule_name ? String(data.next_schedule_name) : null,
    nextScheduleFirstStageId: data.next_schedule_first_stage_id ? String(data.next_schedule_first_stage_id) : null,
  });
}

export function formatConversationScheduleRuntimeForBrain(
  schedule: ConversationScheduleRuntime,
): string {
  const lines = [
    "## CRONOGRAMA CONVERSACIONAL ATUAL",
    `CRONOGRAMA_ID=${schedule.scheduleId}`,
    `CRONOGRAMA_NOME=${schedule.scheduleName}`,
    `CRONOGRAMA_CATEGORIA=${schedule.scheduleCategory}`,
    `MODO_EXECUCAO=${schedule.executionMode}`,
    `CRONOGRAMA_INICIADO_EM=${schedule.startedAt || "desconhecido"}`,
    `CRONOGRAMA_EXPIRA_EM=${schedule.expiresAt || "sem_limite"}`,
    `PROXIMO_CRONOGRAMA=${schedule.nextScheduleName || "nenhum"}`,
  ];
  if (schedule.scheduleDescription) lines.push(`CRONOGRAMA_DESCRICAO=${schedule.scheduleDescription}`);

  if (schedule.executionMode === "connection_window") {
    lines.push(
      `INTENCAO_CONEXAO=${schedule.connectionIntent || schedule.scheduleDescription || "manter conexão natural"}`,
      `TEMPO_DECORRIDO_PERCENTUAL=${Math.round(schedule.elapsedPercent || 0)}`,
      `TEMPO_RESTANTE_MINUTOS=${schedule.remainingMinutes ?? "sem_limite"}`,
      `FASE_TEMPORAL=${schedule.temporalPhase?.label || "não definida"}`,
      `FASE_ORIENTACAO=${schedule.temporalPhase?.guidance || "manter naturalidade"}`,
      "ARSENAL_REGRA: arsenal é caixa de ferramentas opcional, nunca checklist. Não force recurso e não tente consumir tudo.",
    );
  } else {
    lines.push(
      `ETAPA_ATUAL_OBRIGATORIA=${schedule.currentStageRequired}`,
      "A obrigatoriedade é regra de produto. Você não pode redefini-la.",
      "Objetivos opcionais são possibilidades; não tente consumir todos.",
    );
  }
  return lines.join("\n");
}


export interface ConversationScheduleRuntimeSnapshot extends ConversationScheduleRuntime {
  initialized: boolean;
  runStatus?: string | null;
}

export async function readConversationScheduleRuntimeSnapshot(
  supabase: any,
  conversationId: string,
): Promise<ConversationScheduleRuntimeSnapshot> {
  const { data: conversation, error: conversationError } = await supabase
    .from("instagram_conversations")
    .select("id, contact_id, current_stage_id")
    .or(`id.eq.${conversationId},contact_id.eq.${conversationId}`)
    .limit(1)
    .maybeSingle();

  if (conversationError || !conversation?.id) {
    throw new Error(
      "conversation_schedule_snapshot_unavailable:" +
      (conversationError?.message || "conversation_not_found"),
    );
  }

  const canonicalConversationId = String(conversation.id);
  const { data: activeRun, error: runError } = await supabase
    .from("conversation_schedule_runs")
    .select("id, schedule_id, status, started_at, expires_at, current_stage_id")
    .eq("conversation_id", canonicalConversationId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    throw new Error("conversation_schedule_snapshot_unavailable:" + runError.message);
  }

  // A leitura do operador nunca inicia um run. Quando a janela já terminou por
  // falta de oportunidade, porém, preservamos o último terminal manual para que
  // a observação operacional continue visível no chat.
  let runtimeRun: any = activeRun || null;
  if (!runtimeRun?.id) {
    const { data: manualRun, error: manualRunError } = await supabase
      .from("conversation_schedule_runs")
      .select("id, schedule_id, status, started_at, expires_at, current_stage_id")
      .eq("conversation_id", canonicalConversationId)
      .eq("status", "completed_with_manual_action")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (manualRunError) {
      throw new Error("conversation_schedule_snapshot_unavailable:" + manualRunError.message);
    }
    runtimeRun = manualRun || null;
  }

  const currentStageId = String(runtimeRun?.current_stage_id || conversation.current_stage_id || "");
  let stage: any = null;
  if (currentStageId) {
    const { data: stageRow, error: stageError } = await supabase
      .from("chat_stages")
      .select("id, name, schedule_id, is_required, stage_order")
      .eq("id", currentStageId)
      .maybeSingle();
    if (stageError) {
      throw new Error("conversation_schedule_snapshot_unavailable:" + stageError.message);
    }
    stage = stageRow;
  }

  let scheduleId = String(runtimeRun?.schedule_id || stage?.schedule_id || "");
  if (!scheduleId) {
    const { data: fallbackStage, error: fallbackError } = await supabase
      .from("chat_stages")
      .select("id, name, schedule_id, is_required, stage_order")
      .order("stage_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallbackError || !fallbackStage?.schedule_id) {
      throw new Error(
        "conversation_schedule_snapshot_unavailable:" +
        (fallbackError?.message || "schedule_not_found"),
      );
    }
    stage = fallbackStage;
    scheduleId = String(fallbackStage.schedule_id);
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("conversation_schedules")
    .select("id, name, description, category, schedule_order, duration_minutes, response_delay_mode, response_delay_fixed_seconds, response_delay_min_seconds, response_delay_max_seconds, brain_model, is_active")
    .eq("id", scheduleId)
    .maybeSingle();

  if (scheduleError || !schedule?.id) {
    throw new Error(
      "conversation_schedule_snapshot_unavailable:" +
      (scheduleError?.message || "schedule_not_found"),
    );
  }

  const { data: laterSchedules, error: nextError } = await supabase
    .from("conversation_schedules")
    .select("id, name, schedule_order")
    .eq("is_active", true)
    .gt("schedule_order", Number(schedule.schedule_order || 0))
    .order("schedule_order", { ascending: true });

  if (nextError) {
    throw new Error("conversation_schedule_snapshot_unavailable:" + nextError.message);
  }

  let nextSchedule: any = null;
  for (const candidate of Array.isArray(laterSchedules) ? laterSchedules : []) {
    const { data: nextStage } = await supabase
      .from("chat_stages")
      .select("id")
      .eq("schedule_id", candidate.id)
      .order("stage_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (nextStage?.id) {
      nextSchedule = { ...candidate, firstStageId: nextStage.id };
      break;
    }
  }

  const enriched = await enrichScheduleRuntime(supabase, canonicalConversationId, {
    runId: runtimeRun?.id ? String(runtimeRun.id) : "",
    scheduleId: String(schedule.id),
    scheduleName: String(schedule.name || schedule.id),
    scheduleDescription: schedule.description ?? null,
    scheduleCategory: String(schedule.category || "custom"),
    scheduleOrder: Number(schedule.schedule_order || 0),
    durationMinutes: schedule.duration_minutes == null ? null : Number(schedule.duration_minutes),
    startedAt: runtimeRun?.started_at ? String(runtimeRun.started_at) : "",
    expiresAt: runtimeRun?.expires_at ? String(runtimeRun.expires_at) : null,
    responseDelayMode: schedule.response_delay_mode === "range" ? "range" : "fixed",
    responseDelayFixedSeconds: schedule.response_delay_fixed_seconds == null ? null : Number(schedule.response_delay_fixed_seconds),
    responseDelayMinSeconds: schedule.response_delay_min_seconds == null ? null : Number(schedule.response_delay_min_seconds),
    responseDelayMaxSeconds: schedule.response_delay_max_seconds == null ? null : Number(schedule.response_delay_max_seconds),
    brainModel: schedule.brain_model ? String(schedule.brain_model) : null,
    currentStageId: String(stage?.id || currentStageId || ""),
    currentStageRequired: stage?.is_required !== false,
    nextScheduleId: nextSchedule?.id ? String(nextSchedule.id) : null,
    nextScheduleName: nextSchedule?.name ? String(nextSchedule.name) : null,
    nextScheduleFirstStageId: nextSchedule?.firstStageId ? String(nextSchedule.firstStageId) : null,
  });
  return {
    ...enriched,
    initialized: Boolean(runtimeRun?.id),
    runStatus: runtimeRun?.status ? String(runtimeRun.status) : null,
  };
}
