import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ matchId: "default" }];
}

interface RouteParams {
  params: Promise<{ matchId: string }>;
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const { matchId } = await context.params;
    if (!matchId) {
      return NextResponse.json({ error: "ID do match é obrigatório" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const isRestricted = body?.isRestricted !== undefined ? Boolean(body.isRestricted) : true;
    const status = isRestricted ? "restricted" : "Conversando";

    const supabase = getSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase
        .from("tinder_conversations")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("match_id", matchId);

      if (error) {
        console.warn("Aviso ao atualizar status de restrição no Supabase Tinder:", error);
      }
    }

    return NextResponse.json({ success: true, matchId, isRestricted, status });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
