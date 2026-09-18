import { NextRequest, NextResponse } from "next/server";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ conversationId: "default" }];
}

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const isRestricted = body?.isRestricted !== undefined ? Boolean(body.isRestricted) : true;
    const status = isRestricted ? ("restricted" as const) : ("active" as const);

    const repo = new SupabaseInstagramRepository();
    await repo.saveConversation({
      id: conversationId,
      isRestricted,
      status,
    });

    return NextResponse.json({ success: true, conversationId, isRestricted, status });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}