// Isolated swipe-left integration. All actions require the same Match session
// used by the existing Tinder API; service-role and Tinder token never reach browsers.
const allowedOrigins = new Set([
  "https://vendeo-e755e.web.app",
  "https://vendeo-e755e.firebaseapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function answer(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("Origin") || "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(allowedOrigins.has(origin) ? {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      } : {}),
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type,apikey,authorization,x-match-session",
    },
  });
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function stableUuid(tokenHash: string, offset: number) {
  const hex = (tokenHash + tokenHash).slice(offset, offset + 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigins.has(origin)) {
    return answer(request, { success: false, error: "Origem não autorizada." }, 403);
  }
  if (request.method === "OPTIONS") return answer(request, { success: true });
  if (request.method !== "POST") {
    return answer(request, { success: false, error: "Método não permitido." }, 405);
  }

  const session = (request.headers.get("X-Match-Session") || "").trim();
  if (session.length < 32 || session.length > 200) {
    return answer(request, {
      success: false, error: "Sessão do Match ausente. Reconecte o Tinder.",
      code: "MATCH_SESSION_REQUIRED",
    }, 401);
  }

  const raw = await request.text();
  if (raw.length > 600) {
    return answer(request, { success: false, error: "Requisição inválida." }, 400);
  }
  let body: { userId?: unknown };
  try { body = JSON.parse(raw); } catch {
    return answer(request, { success: false, error: "Requisição inválida." }, 400);
  }
  const userId = String(body?.userId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(userId)) {
    return answer(request, {
      success: false, error: "Identificador de perfil inválido.",
      code: "TINDER_PROFILE_ID_INVALID",
    }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) {
    return answer(request, {
      success: false, error: "Integração indisponível.",
      code: "TINDER_CONFIG_UNAVAILABLE",
    }, 503);
  }

  try {
    const configResponse = await fetch(
      `${url}/rest/v1/match_tinder_config?select=auth_token,session_hash&id=eq.default&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!configResponse.ok) {
      return answer(request, {
        success: false, error: "Falha ao validar a sessão do Match.",
        code: "MATCH_SESSION_CHECK_FAILED",
      }, 503);
    }
    const [config] = await configResponse.json();
    if (!config?.auth_token || !config?.session_hash) {
      return answer(request, {
        success: false, error: "Tinder não está conectado.",
        code: "MATCH_TINDER_NOT_CONNECTED",
      }, 401);
    }
    const sessionHash = await sha256Hex(session);
    if (sessionHash !== String(config.session_hash)) {
      return answer(request, {
        success: false, error: "Sessão do Match inválida. Reconecte o Tinder.",
        code: "MATCH_SESSION_INVALID",
      }, 401);
    }

    // Unlike liking (/like), the classic /pass endpoint accepts GET with no JSON
    // body nor Content-Type. GET happens only server-side AFTER session auth.
    const token = String(config.auth_token);
    const tokenHash = await sha256Hex(token);
    const response = await fetch(
      `https://api.gotinder.com/pass/${encodeURIComponent(userId)}`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          platform: "web",
          "app-version": "1073604",
          "tinder-version": "7.36.4",
          "x-supported-image-formats": "webp,jpeg",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          Origin: "https://tinder.com",
          Referer: "https://tinder.com/",
          "persistent-device-id": stableUuid(tokenHash, 0),
          "app-session-id": stableUuid(tokenHash, 16),
          "X-Auth-Token": token,
        },
      },
    );

    if (!response.ok) {
      const upstreamStatus = response.status;
      console.warn("[Tinder Pass] Upstream rejected pass", upstreamStatus);
      return answer(request, {
        success: false,
        error: upstreamStatus === 401
          ? "Tinder rejeitou especificamente a recusa (401); sua sessão pode continuar válida."
          : upstreamStatus === 429
          ? "Tinder limitou as ações temporariamente. Tente mais tarde."
          : `Tinder não confirmou a recusa (HTTP ${upstreamStatus}).`,
        code: upstreamStatus === 401 ? "TINDER_PASS_UPSTREAM_401"
          : upstreamStatus === 429 ? "TINDER_RATE_LIMIT" : "TINDER_PASS_UPSTREAM_ERROR",
      }, [400, 401, 403, 404, 429, 502, 503, 504].includes(upstreamStatus)
        ? upstreamStatus : 502);
    }

    // A resposta 2xx do Tinder confirma o processamento. Não gerar match falso.
    return answer(request, { success: true, matched: false, likesRemaining: null });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("[Tinder Pass] Transport failure", timeout ? "timeout" : "network");
    return answer(request, {
      success: false,
      error: timeout ? "O Tinder demorou demais para responder." : "Não foi possível confirmar a recusa junto ao Tinder.",
      code: timeout ? "TINDER_PASS_TIMEOUT" : "TINDER_PASS_NETWORK",
    }, timeout ? 504 : 502);
  }
});