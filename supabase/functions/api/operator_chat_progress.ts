import { getCriticalWebPushPublicConfig, registerCriticalWebPushSubscription, disableCriticalWebPushSubscription } from "./web_push.ts";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...jsonHeaders } });
}

export async function handleOperatorChatProgress(
  request: Request,
  supabase: any,
  authorized: boolean,
  corsHeaders: Record<string, string>,
) {
  if (!authorized) return jsonResponse({ error: "Sessão de operador inválida ou expirada." }, 401, corsHeaders);

  const body = await request.json().catch(() => ({}));

  if (body?.operation === "push_config") {
    const config = await getCriticalWebPushPublicConfig(supabase);
    return jsonResponse(config, 200, corsHeaders);
  }

  if (body?.operation === "register_device") {
    try {
      const result = await registerCriticalWebPushSubscription(
        supabase,
        body?.payload,
        request.headers.get("user-agent"),
      );
      return jsonResponse(result, 200, corsHeaders);
    } catch (error: any) {
      return jsonResponse({ error: error?.message || "Falha ao registrar o dispositivo." }, 400, corsHeaders);
    }
  }

  if (body?.operation === "push_unregister") {
    try {
      const result = await disableCriticalWebPushSubscription(supabase, String(body?.endpoint || ""));
      return jsonResponse(result, 200, corsHeaders);
    } catch (error: any) {
      return jsonResponse({ error: error?.message || "Falha ao remover o dispositivo." }, 400, corsHeaders);
    }
  }

  if (body?.operation === "raffle_report") {
    const startAtRaw = typeof body?.startAt === "string" ? body.startAt.trim() : "";
    const endAtRaw = typeof body?.endAt === "string" ? body.endAt.trim() : "";
    const startMs = Date.parse(startAtRaw);
    const endMs = Date.parse(endAtRaw);
    const maxRangeMs = 10 * 366 * 24 * 60 * 60 * 1000;

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs ||
      endMs - startMs > maxRangeMs
    ) {
      return jsonResponse({ error: "Intervalo do relatório inválido." }, 400, corsHeaders);
    }

    const startAt = new Date(startMs).toISOString();
    const endAt = new Date(endMs).toISOString();

    const [peopleResult, eventsResult] = await Promise.all([
      supabase
        .from("instagram_conversations")
        .select("id, username, full_name, avatar, status, raffle_status, raffle_status_updated_at, workflow_finalized_at")
        .eq("is_converted", true)
        .gte("workflow_finalized_at", startAt)
        .lt("workflow_finalized_at", endAt)
        .order("workflow_finalized_at", { ascending: false })
        .limit(5000),
      supabase
        .from("raffle_commercial_events")
        .select("id, conversation_id, previous_status, status, changed_at")
        .gte("changed_at", startAt)
        .lt("changed_at", endAt)
        .order("changed_at", { ascending: true })
        .limit(10000),
    ]);

    if (peopleResult.error || eventsResult.error) {
      console.error("[Raffle Report] Falha ao carregar relatório.", {
        peopleError: peopleResult.error?.message,
        eventsError: eventsResult.error?.message,
      });
      return jsonResponse({ error: "Não foi possível carregar o relatório da rifa." }, 503, corsHeaders);
    }

    const people = (peopleResult.data || [])
      .filter((row: any) =>
        row?.id &&
        !String(row.id).startsWith("__") &&
        row.status !== "system" &&
        row.status !== "vault"
      )
      .map((row: any) => ({
        id: String(row.id),
        username: row.username ? String(row.username) : "",
        fullName: row.full_name ? String(row.full_name) : "",
        avatar: row.avatar ? String(row.avatar) : null,
        raffleStatus: row.raffle_status ?? null,
        raffleStatusUpdatedAt: row.raffle_status_updated_at ?? null,
        finalizedAt: row.workflow_finalized_at ?? null,
      }));

    const events = (eventsResult.data || []).map((row: any) => ({
      id: String(row.id),
      conversationId: String(row.conversation_id || ""),
      previousStatus: row.previous_status ?? null,
      status: row.status ?? null,
      changedAt: row.changed_at,
    }));

    return jsonResponse({
      success: true,
      startAt,
      endAt,
      people,
      events,
    }, 200, corsHeaders);
  }

  if (body?.operation === "raffle_purchase_confirmed") {
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId || conversationId.length > 256) {
      return jsonResponse({ error: "Conversa vinculada à compra é inválida." }, 400, corsHeaders);
    }

    const { data: updated, error: updateError } = await supabase
      .from("instagram_conversations")
      .update({
        raffle_status: "bought",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .select("id, raffle_status, raffle_status_updated_at")
      .maybeSingle();

    if (updateError) {
      return jsonResponse({ error: updateError.message || "Falha ao sincronizar a compra com o chat." }, 500, corsHeaders);
    }
    if (!updated) return jsonResponse({ error: "Conversa vinculada à compra não encontrada." }, 404, corsHeaders);

    return jsonResponse({
      success: true,
      conversationId: updated.id,
      raffleStatus: updated.raffle_status ?? null,
      raffleStatusUpdatedAt: updated.raffle_status_updated_at ?? null,
    }, 200, corsHeaders);
  }

  if (body?.operation === "raffle_status") {
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    const requestedStatus = body?.raffleStatus;
    const raffleStatus = requestedStatus === null || requestedStatus === undefined || requestedStatus === ""
      ? null
      : typeof requestedStatus === "string"
      ? requestedStatus.trim()
      : "__invalid__";
    const allowedStatuses = new Set(["offered", "bought", "not_bought"]);

    if (!conversationId || conversationId.length > 256 || (raffleStatus !== null && !allowedStatuses.has(raffleStatus))) {
      return jsonResponse({ error: "Conversa ou status da rifa inválido." }, 400, corsHeaders);
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("instagram_conversations")
      .select("id, is_converted")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) {
      return jsonResponse({ error: "Não foi possível validar a conversa." }, 503, corsHeaders);
    }
    if (!conversation) return jsonResponse({ error: "Conversa não encontrada." }, 404, corsHeaders);
    if (conversation.is_converted !== true) {
      return jsonResponse({ error: "O status da rifa só pode ser alterado em chats finalizados." }, 409, corsHeaders);
    }

    const { data: updated, error: updateError } = await supabase
      .from("instagram_conversations")
      .update({
        raffle_status: raffleStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .select("id, raffle_status, raffle_status_updated_at")
      .maybeSingle();

    if (updateError || !updated) {
      return jsonResponse({ error: updateError?.message || "Falha ao atualizar o status da rifa." }, 500, corsHeaders);
    }

    return jsonResponse({
      success: true,
      conversationId: updated.id,
      raffleStatus: updated.raffle_status ?? null,
      raffleStatusUpdatedAt: updated.raffle_status_updated_at ?? null,
    }, 200, corsHeaders);
  }

  const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
  const patch = body?.progressPatch;
  if (!conversationId || conversationId.length > 256 || !patch || typeof patch !== "object" || Array.isArray(patch)) {
    return jsonResponse({ error: "Identificador da conversa ou progresso inválido." }, 400, corsHeaders);
  }

  const currentStageId = typeof patch.currentStageId === "string" ? patch.currentStageId.trim() : "";
  const completedGoalIds = Array.isArray(patch.completedGoalIds) ? patch.completedGoalIds : [];
  const completedItemIds = Array.isArray(patch.completedItemIds) ? patch.completedItemIds : [];
  const objectiveProgress = patch.objectiveProgress && typeof patch.objectiveProgress === "object" && !Array.isArray(patch.objectiveProgress)
    ? patch.objectiveProgress
    : {};
  if (!currentStageId || completedGoalIds.length > 200 || completedItemIds.length > 500 || Object.keys(objectiveProgress).length > 200
    || !completedGoalIds.every((id: unknown) => typeof id === "string" && id.length <= 256)
    || !completedItemIds.every((id: unknown) => typeof id === "string" && id.length <= 256)) {
    return jsonResponse({ error: "O conteúdo do progresso está fora do formato permitido." }, 400, corsHeaders);
  }

  const [{ data: stages, error: stagesError }, { data: conversation, error: conversationError }] = await Promise.all([
    supabase.from("chat_stages").select("id, goals"),
    supabase.from("instagram_conversations").select("stage_completed_rules").eq("id", conversationId).maybeSingle(),
  ]);
  if (stagesError || conversationError) {
    return jsonResponse({ error: "Não foi possível validar o progresso contra o catálogo e a conversa." }, 503, corsHeaders);
  }
  if (!conversation) return jsonResponse({ error: "Conversa não encontrada." }, 404, corsHeaders);

  const configuredStages = Array.isArray(stages) ? stages : [];
  const configuredStage = configuredStages.find((stage: any) => stage.id === currentStageId);
  if (!configuredStage) return jsonResponse({ error: "A etapa solicitada não existe em chat_stages." }, 400, corsHeaders);

  const configuredGoalIds = new Set(configuredStages.flatMap((stage: any) =>
    (Array.isArray(stage.goals) ? stage.goals : Array.isArray(stage.objectives) ? stage.objectives : [])
      .filter((goal: any) => goal && typeof goal.id === "string")
      .map((goal: any) => goal.id),
  ));
  const existingRules = conversation.stage_completed_rules && typeof conversation.stage_completed_rules === "object"
    ? conversation.stage_completed_rules
    : {};
  const existingOrchestration = existingRules.orchestration && typeof existingRules.orchestration === "object"
    ? existingRules.orchestration
    : {};
  const existingChatProgress = existingRules.chat_progress && typeof existingRules.chat_progress === "object"
    ? existingRules.chat_progress
    : {};
  const existingGoalIds = new Set([
    ...(Array.isArray(existingRules.completed_goals) ? existingRules.completed_goals : []),
    ...(Array.isArray(existingOrchestration.completedGoalIds) ? existingOrchestration.completedGoalIds : []),
    ...(Array.isArray(existingChatProgress.completedGoalIds) ? existingChatProgress.completedGoalIds : []),
    ...Object.keys(existingRules.objective_progress || {}),
    ...Object.keys(existingOrchestration.objectiveProgress || {}),
    ...Object.keys(existingChatProgress.objectiveProgress || {}),
  ]);
  if (completedGoalIds.some((id: string) => !configuredGoalIds.has(id) && !existingGoalIds.has(id))
    || Object.keys(objectiveProgress).some((id) => !configuredGoalIds.has(id) && !existingGoalIds.has(id))) {
    return jsonResponse({ error: "O progresso contém um objetivo que não existe no catálogo nem no histórico desta conversa." }, 400, corsHeaders);
  }

  const patchPayload = {
    currentStageId,
    completedGoalIds: [...new Set(completedGoalIds)],
    completedItemIds: [...new Set(completedItemIds)],
    objectiveProgress,
    isConverted: patch.isConverted === true,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : new Date().toISOString(),
  };
  const { data: rpcResult, error: rpcError } = await supabase.rpc("patch_chat_progress_atomic", {
    p_conversation_id: conversationId,
    p_progress_patch: patchPayload,
  });
  if (rpcError || !rpcResult?.success) {
    return jsonResponse({ error: rpcError?.message || rpcResult?.reason || "Falha ao salvar o progresso." }, 500, corsHeaders);
  }
  return jsonResponse(rpcResult, 200, corsHeaders);
}
