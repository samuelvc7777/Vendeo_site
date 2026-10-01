import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrainOperation = "events" | "manual-resolution" | "retry-failed-action" | "retry-once";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function serviceConfiguration() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return supabaseUrl && serviceRoleKey ? { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey } : null;
}

async function callBrainEdge(operation: BrainOperation, request: NextRequest, body?: Record<string, unknown>) {
  const configuration = serviceConfiguration();
  if (!configuration) {
    return NextResponse.json({ error: "Operações do Brain não estão configuradas no servidor." }, { status: 503 });
  }

  const upstreamUrl = new URL(`${configuration.supabaseUrl}/functions/v1/api/autopilot/${operation}`);
  if (operation === "events") {
    const conversationId = request.nextUrl.searchParams.get("conversationId") || "";
    if (!conversationId || conversationId.length > 160 || /[\u0000-\u001f]/.test(conversationId)) {
      return NextResponse.json({ error: "conversationId inválido." }, { status: 400 });
    }
    upstreamUrl.searchParams.set("conversationId", conversationId);
  }

  const upstream = await fetch(upstreamUrl, {
    method: operation === "events" ? "GET" : "POST",
    headers: {
      apikey: configuration.serviceRoleKey,
      authorization: `Bearer ${configuration.serviceRoleKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) return NextResponse.json({ error: "Não foi possível alcançar o serviço do Brain." }, { status: 503 });
  const result = await upstream.json().catch(() => ({ error: "Resposta inválida do serviço do Brain." }));
  return NextResponse.json(result, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  if (operation !== "events") return NextResponse.json({ error: "Operação inválida." }, { status: 404 });
  return callBrainEdge(operation, request);
}

export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });

  const { operation: rawOperation } = await context.params;
  if (!["manual-resolution", "retry-failed-action", "retry-once"].includes(rawOperation)) {
    return NextResponse.json({ error: "Operação inválida." }, { status: 404 });
  }
  const operation = rawOperation as Exclude<BrainOperation, "events">;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  if (!conversationId || conversationId.length > 160 || /[\u0000-\u001f]/.test(conversationId)) {
    return NextResponse.json({ error: "conversationId inválido." }, { status: 400 });
  }

  if (operation === "manual-resolution") {
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer || answer.length > 1000 || typeof body.saveForFuture !== "boolean") {
      return NextResponse.json({ error: "Resposta manual inválida." }, { status: 400 });
    }
    return callBrainEdge(operation, request, { conversationId, answer, saveForFuture: body.saveForFuture });
  }

  if (operation === "retry-failed-action") {
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    if (!actionId || actionId.length > 160) return NextResponse.json({ error: "actionId inválido." }, { status: 400 });
    return callBrainEdge(operation, request, { conversationId, actionId });
  }

  return callBrainEdge(operation, request, { conversationId });
}
