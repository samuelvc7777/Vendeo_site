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
