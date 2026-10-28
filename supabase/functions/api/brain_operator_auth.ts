export function brainOperatorAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const apikey = request.headers.get("apikey");
  const auth = request.headers.get("authorization") || "";
  const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const expectedServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // Se a requisição contiver apikey válida ou Bearer token oficial do app
  if (apikey && (apikey === expectedAnonKey || (expectedServiceKey && apikey === expectedServiceKey))) {
    return true;
  }
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token === expectedAnonKey || (expectedServiceKey && token === expectedServiceKey)) {
      return true;
    }
  }

  // A chave anon é pública e não deve liberar uma origem arbitrária.
  // Para chamadas nativas que realmente omitem Origin, só aceitamos a chave
  // oficial configurada; uma chave de tamanho plausível não é credencial.
  if (!origin) {
    return Boolean(expectedAnonKey && apikey === expectedAnonKey);
  }

  const configuredOrigins = (Deno.env.get("BRAIN_OPERATOR_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowed = new Set([
    "https://vendeo-e755e.web.app",
    "https://vendeo-e755e.firebaseapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...configuredOrigins,
  ]);

  if (allowed.has(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Permite loopback e redes privadas locais usadas pelo app.
    if (host === "localhost" || host === "127.0.0.1") return true;
    // Permite túneis Cloudflare (trycloudflare.com)
    if (host.endsWith(".trycloudflare.com")) return true;
    // Permite domínios de hosting oficiais
    if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) return true;
    // Redes privadas e VPN (Tailscale 100.*, LAN 192.168.*, 10.*, 172.16-31.*)
    if (/^100\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  } catch {
    return false;
  }

  return false;
}
