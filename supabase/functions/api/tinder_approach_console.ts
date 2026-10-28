export async function handleTinderApproachConsole(params: {
  request: Request; supabase: any; accountId: string; matchId: string; corsHeaders: Record<string, string>;
}) {
  const { request, supabase, accountId, matchId, corsHeaders } = params;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (!accountId) return json({ success: false, error: "Reconecte a conta Tinder." }, 401);
  if (request.method !== "GET") return json({ success: false, error: "Operação não permitida." }, 405);
  if (!matchId.trim() || matchId.length > 200) return json({ success: false, error: "Match inválido." }, 400);
  const { data, error } = await supabase.rpc("get_tinder_approach_console", { p_account_id: accountId, p_match_id: matchId });
  if (error) return json({ success: false, error: "Console indisponível. Não foi possível confirmar o estado de execução." }, 503);
  return json(data);
}
