// Sanitizacao deterministica de telemetria MCP
// Garante que NUNCA sejam persistidos tokens, secrets, searchParams ou headers brutos

export interface SanitizedMcpTelemetry {
  at: string;
  method: string;
  pathname: string;
  rpcMethod?: string;
  rpcId?: string | number | null;
  userAgent?: string;
  hasAuthorization: boolean;
  hasMcpSessionId: boolean;
}

export function sanitizeMcpTelemetry(
  req: { url: string; method: string; headers: { get: (name: string) => string | null } },
  rpcBody?: any
): SanitizedMcpTelemetry {
  let pathname = "/";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    pathname = "/";
  }

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const sessionId = req.headers.get("mcp-session-id") || req.headers.get("Mcp-Session-Id") || "";

  return {
    at: new Date().toISOString(),
    method: req.method,
    pathname,
    rpcMethod: typeof rpcBody?.method === "string" ? rpcBody.method : undefined,
    rpcId: rpcBody?.id ?? null,
    userAgent: req.headers.get("user-agent") || undefined,
    hasAuthorization: authHeader.startsWith("Bearer ") && authHeader.length > 10,
    hasMcpSessionId: Boolean(sessionId),
  };
}
