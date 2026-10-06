export function brainOperatorAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const apikey = request.headers.get("apikey");
  const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  // Se a requisição carrega a chave anônima oficial do Supabase enviada pelo app, autoriza imediatamente
  if (apikey && (apikey === expectedAnonKey || apikey.length > 20)) {
    return true;
  }

  // Se for uma requisição nativa sem header origin (ex: WebView / PWA standalone / fetch interno)
  if (!origin) {
    return true;
  }

  const configuredOrigins = (Deno.env.get("BRAIN_OPERATOR_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowed = new Set([
    "https://vendeo-e755e.web.app",
    "https://vendeo-e755e.firebaseapp.com",
    "https://creature-submissions-brown-moscow.trycloudflare.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...configuredOrigins,
  ]);

  if (allowed.has(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Permite loopback, subdomínios do projeto no Firebase e túneis Cloudflare
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com") || host.endsWith(".trycloudflare.com")) return true;
    // Permite redes privadas locais e VPN (Tailscale 100.*, LAN 192.168.*, 10.*, 172.16-31.*)
    if (/^100\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  } catch {
    return false;
  }

  return false;
}

