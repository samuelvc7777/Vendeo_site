import { createHmac } from "node:crypto";

export interface OperatorLoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function operatorLoginKey(request: Request): string {
  const secret = process.env.BRAIN_OPERATOR_SESSION_SECRET || "";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-client";
  return createHmac("sha256", secret).update(address).digest("hex");
}

export async function consumeOperatorLoginAttempt(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<OperatorLoginRateLimitResult> {
  const secret = process.env.BRAIN_OPERATOR_SESSION_SECRET || "";
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (Buffer.byteLength(secret) < 32 || !url || !serviceKey) {
    return { allowed: false, retryAfterSeconds: 0 };
  }

  const response = await fetcher(`${url.replace(/\/$/, "")}/rest/v1/rpc/consume_brain_operator_login_attempt`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_key_hash: operatorLoginKey(request) }),
    cache: "no-store",
  });
  if (!response.ok) return { allowed: false, retryAfterSeconds: 0 };
  const result = await response.json().catch(() => null) as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  return {
    allowed: result?.allowed === true,
    retryAfterSeconds: Number.isFinite(Number(result?.retry_after_seconds))
      ? Math.max(0, Number(result?.retry_after_seconds))
      : 0,
  };
}

export async function clearOperatorLoginAttempts(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = process.env.BRAIN_OPERATOR_SESSION_SECRET || "";
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (Buffer.byteLength(secret) < 32 || !url || !serviceKey) return false;
  const response = await fetcher(`${url.replace(/\/$/, "")}/rest/v1/rpc/clear_brain_operator_login_attempts`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_key_hash: operatorLoginKey(request) }),
    cache: "no-store",
  });
  return response.ok;
}
