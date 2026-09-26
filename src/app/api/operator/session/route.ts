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
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 1024 || !verifyBrainOperatorPassword(password)) {
    return NextResponse.json({ error: "Senha de operador inválida." }, { status: 401 });
  }

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
