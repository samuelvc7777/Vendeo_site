import { readTinderRecipientSelection } from "./tinder_recipient_selection.ts";
import { tinderExecutorReady } from "./tinder_approach_runtime.ts";

const SETTINGS = "tinder_ai_settings";

export function tinderChatAiRemoved(
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "TINDER_CHAT_AI_REMOVED",
      error:
        "A IA do Tinder agora é configurada na caixa de entrada, para toda a conta.",
    }),
    {
      status: 410,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Preferência da conta. Não ativa o Brain compartilhado nem inicia envios. */
export async function handleTinderAccountAi(params: {
  request: Request;
  supabase: any;
  accountId: string;
  corsHeaders: Record<string, string>;
}): Promise<Response> {
  const { request, supabase, accountId, corsHeaders } = params;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (!accountId)
    return json({ success: false, error: "Reconecte sua conta Tinder." }, 401);
  if (!["GET", "PUT"].includes(request.method))
    return json({ success: false, error: "Operação não permitida." }, 405);

  const { data: row, error: readError } = await supabase
    .from(SETTINGS)
    .select("is_enabled,schedule_id,enabled_since")
    .eq("account_id", accountId)
    .maybeSingle();
  if (readError) throw readError;
  const selection = await readTinderRecipientSelection(supabase, accountId);
  const executionReady = await tinderExecutorReady(supabase);
  const { data: rows, error: schedulesError } = await supabase
    .from("tinder_conversation_schedules")
    .select("id,config,position")
    .eq("account_id", accountId)
    .order("position")
    .order("created_at");
  if (schedulesError) throw schedulesError;
  const schedules = (rows || [])
    .filter((item: any) => item.config?.isActive === true)
    .map((item: any) => ({ id: item.id, name: item.config.name }));
  let current = row;
  if (request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (typeof body?.isEnabled !== "boolean")
      return json(
        {
          success: false,
          error: "Informe se a IA deve ser ativada ou desativada.",
        },
        400,
      );
    const scheduleId = body.scheduleId ?? row?.schedule_id ?? null;
    if (body.isEnabled && !executionReady) return json({ success: false, error: "O executor Tinder ainda não está disponível. Tente novamente após a publicação." }, 503);
    if (body.isEnabled && selection.selectedMatchIds.length === 0) {
      return json({ success: false, code: "TINDER_RECIPIENTS_REQUIRED", error: "Selecione e confirme os matches autorizados antes de ativar a IA." }, 409);
    }
    if (
      body.isEnabled &&
      !schedules.some((item: any) => item.id === scheduleId)
    ) {
      return json(
        {
          success: false,
          code: "TINDER_ACTIVE_SCHEDULE_REQUIRED",
          error: "Selecione um cronograma Tinder ativo desta conta.",
        },
        409,
      );
    }
    // Desativar também funciona quando o cronograma foi excluído ou desativado.
    const validSchedule = schedules.some((item: any) => item.id === scheduleId)
      ? scheduleId
      : null;
    const payload = {
      account_id: accountId,
      is_enabled: body.isEnabled,
      schedule_id: validSchedule,
      enabled_since: body.isEnabled
        ? row?.is_enabled && row?.enabled_since
          ? row.enabled_since
          : new Date().toISOString()
        : (row?.enabled_since ?? null),
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from(SETTINGS)
      .upsert(payload, { onConflict: "account_id" })
      .select("is_enabled,schedule_id,enabled_since")
      .single();
    if (error) throw error;
    current = saved;
  }
  return json({
    success: true,
    isEnabled: current?.is_enabled === true,
    scheduleId: current?.schedule_id ?? null,
    enabledSince: current?.enabled_since ?? null,
    schedules,
    selectedMatchIds: selection.selectedMatchIds,
    completedMatchIds: selection.completedMatchIds,
    selectionRevision: selection.selectionRevision,
    executionReady,
  });
}
