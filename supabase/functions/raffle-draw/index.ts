// Sorteio separado do backend Brain, sem publicar alterações não relacionadas.
const origins = new Set([
  "https://vendeo-e755e.web.app",
  "https://vendeo-e755e.firebaseapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(Deno.env.get("BRAIN_OPERATOR_ALLOWED_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean),
]);

function json(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("Origin") || "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      ...(origins.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type,apikey,authorization",
    },
  });
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") || "";
  if (!origins.has(origin)) return json(request, { error: "Origem não autorizada." }, 403);
  if (request.method === "OPTIONS") return json(request, { success: true });
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!projectUrl || !key) return json(request, { error: "Servidor indisponível." }, 503);
  const headers = {
    "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}`,
  };
  try {
    if (request.method === "GET") {
      const id = new URL(request.url).searchParams.get("raffleId") || "";
      if (!/^[a-zA-Z0-9_-]{5,100}$/.test(id)) return json(request, { error: "Rifa inválida." }, 400);
      const response = await fetch(`${projectUrl}/rest/v1/raffle_draw_results?raffle_id=eq.${encodeURIComponent(id)}&select=*`, {
        headers, cache: "no-store",
      });
      if (!response.ok) return json(request, { error: "Falha ao consultar o sorteio." }, 503);
      const data = await response.json();
      return json(request, { success: true, result: data?.[0] || null });
    }
    if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);
    const raw = await request.text();
    if (raw.length > 1000) return json(request, { error: "Requisição inválida." }, 400);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); }
    catch { return json(request, { error: "Requisição inválida." }, 400); }
    const raffleId = String(body?.raffleId || "");
    const drawCode = String(body?.drawCode || "");
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(raffleId) || drawCode.length < 8 || drawCode.length > 128) {
      return json(request, { error: "Rifa ou código inválido." }, 400);
    }
    const response = await fetch(`${projectUrl}/rest/v1/rpc/commit_raffle_draw`, {
      method: "POST", headers,
      body: JSON.stringify({ p_raffle_id: raffleId, p_draw_code: drawCode }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = String(data?.message || "");
      const known = [
        "Código de autorização do sorteio inválido.",
        "Rifa selecionada não encontrada.",
        "Esta rifa já foi sorteada ou não está apta ao sorteio.",
        "Não há cotas pagas para sortear.",
        "Existem cotas pagas com número ou comprador inválido. Corrija antes de sortear.",
        "Há números pagos duplicados. Corrija antes do sorteio.",
        "Bilhetes inválidos.",
      ];
      console.warn("[Raffle Draw] Sorteio recusado", data?.code || response.status);
      return json(request, {
        error: known.find(item => message.includes(item)) ||
          "Não foi possível confirmar o sorteio. Confira o resultado antes de tentar novamente.",
      }, 409);
    }
    return json(request, { success: true, result: data });
  } catch (err) {
    console.error("[Raffle Draw] Erro de transporte:", err instanceof Error ? err.name : "unknown");
    return json(request, { error: "Falha de conexão. Confira o resultado antes de tentar novamente." }, 503);
  }
});