import { NextRequest, NextResponse } from "next/server";
import {
  BRAIN_OPERATOR_COOKIE,
  brainOperatorCookieOptions,
  createBrainOperatorSession,
  isBrainOperatorAuthConfigured,
  isSameOriginRequest,
  verifyBrainOperatorPassword,
  verifyBrainOperatorSession,
} from "@/infrastructure/security/brainOperatorSession";
import { clearOperatorLoginAttempts, consumeOperatorLoginAttempt } from "@/infrastructure/security/brainOperatorRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isBrainOperatorAuthConfigured()) {
    return NextResponse.json({ enabled: false, authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const token = request.cookies.get(BRAIN_OPERATOR_COOKIE)?.value;
  return NextResponse.json(
    { enabled: true, authenticated: verifyBrainOperatorSession(token) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  if (!isBrainOperatorAuthConfigured()) {
    return NextResponse.json({ error: "Acesso de operador não foi configurado no servidor." }, { status: 503 });
  }
  let rateLimit;
  try {
    rateLimit = await consumeOperatorLoginAttempt(request);
  } catch {
    rateLimit = { allowed: false, retryAfterSeconds: 0 };
  }
  if (!rateLimit.allowed) {
    const blocked = rateLimit.retryAfterSeconds > 0;
    return NextResponse.json(
      { error: blocked ? "Muitas tentativas de acesso. Aguarde e tente novamente." : "Autenticação temporariamente indisponível." },
      { status: blocked ? 429 : 503, headers: blocked ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined },
    );
  }
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 1024 || !verifyBrainOperatorPassword(password)) {
    return NextResponse.json({ error: "Senha de operador inválida." }, { status: 401 });
  }
  try {
    await clearOperatorLoginAttempts(request);
  } catch { /* Um limite não limpo ainda expira pela janela persistida. */ }

  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(BRAIN_OPERATOR_COOKIE, createBrainOperatorSession(), brainOperatorCookieOptions());
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(BRAIN_OPERATOR_COOKIE, "", { ...brainOperatorCookieOptions(), maxAge: 0 });
  return response;
}
