export function brainOperatorAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configuredOrigins = (Deno.env.get("BRAIN_OPERATOR_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([
    "https://vendeo-e755e.web.app",
    "https://vendeo-e755e.firebaseapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...configuredOrigins,
  ]);
  return allowed.has(origin);
}
