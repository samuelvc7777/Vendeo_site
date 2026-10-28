export async function readTinderRecipientSelection(
  supabase: any,
  accountId: string,
) {
  const { data, error } = await supabase.rpc("get_tinder_approach_recipients", {
    p_account_id: accountId,
  });
  if (error) throw error;
  if (
    !data?.success ||
    !Array.isArray(data.selectedMatchIds) ||
    !Array.isArray(data.completedMatchIds) ||
    !Number.isSafeInteger(data.selectionRevision)
  ) {
    throw new Error("Não foi possível confirmar a seleção de matches.");
  }
  return data;
}

export async function handleTinderRecipientSelection(params: {
  request: Request;
  supabase: any;
  accountId: string;
  corsHeaders: Record<string, string>;
  listAccountMatches: () => Promise<Array<{ id: string }>>;
}): Promise<Response> {
  const { request, supabase, accountId, corsHeaders, listAccountMatches } =
    params;
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (!accountId)
    return json({ success: false, error: "Reconecte a conta Tinder." }, 401);
  if (!["GET", "PUT"].includes(request.method))
    return json({ success: false, error: "Operação não permitida." }, 405);
  const current = await readTinderRecipientSelection(supabase, accountId);
  if (request.method === "GET") return json(current);
  const body = await request.json().catch(() => null);
  const ids = body?.matchIds;
  if (
    !Array.isArray(ids) ||
    ids.length > 1000 ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !id.trim() ||
        id !== id.trim() ||
        id.length > 200,
    ) ||
    new Set(ids).size !== ids.length ||
    !Number.isSafeInteger(body?.selectionRevision) ||
    body.selectionRevision < 0
  ) {
    return json(
      {
        success: false,
        error: "Seleção inválida. Selecione até 1000 matches, sem repetições.",
      },
      400,
    );
  }
  const stale = () =>
    json(
      {
        success: false,
        code: "TINDER_SELECTION_STALE",
        error:
          "A seleção foi alterada em outra aba. Atualize a seleção antes de confirmar.",
      },
      409,
    );
  if (body.selectionRevision !== current.selectionRevision) return stale();
  const additions = ids.filter((id) => !current.selectedMatchIds.includes(id));
  if (additions.length) {
    const allowed = new Set(
      (await listAccountMatches()).map((match) => match.id),
    );
    if (additions.some((id) => !allowed.has(id)))
      return json(
        {
          success: false,
          code: "TINDER_SELECTION_MATCH_UNAVAILABLE",
          error:
            "Um dos matches não está mais na lista desta conta. Atualize a caixa de entrada.",
        },
        409,
      );
  }
  const { data, error } = await supabase.rpc("set_tinder_approach_recipients", {
    p_account_id: accountId,
    p_match_ids: ids,
    p_expected_revision: body.selectionRevision,
  });
  if (error) throw error;
  if (data?.code === "TINDER_SELECTION_STALE") return stale();
  if (!data?.success) throw new Error("O servidor não confirmou a seleção.");
  return json(data);
}
