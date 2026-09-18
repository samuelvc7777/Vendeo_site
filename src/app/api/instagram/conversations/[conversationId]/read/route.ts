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

    const repo = new SupabaseInstagramRepository();
    await repo.saveConversation({
      id: conversationId,
      unread: false,
    });

    return NextResponse.json({ success: true, conversationId });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
