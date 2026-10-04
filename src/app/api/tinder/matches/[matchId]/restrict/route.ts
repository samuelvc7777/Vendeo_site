import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/infrastructure/supabase/server";

interface RouteParams {
  params: Promise<{
    matchId: string;
  }>;
}

export async function POST(req: NextRequest, context: RouteParams) {
  const { matchId } = await context.params;

  if (!matchId) {
    return NextResponse.json(
      { error: "Identificador de match inválido." },
      { status: 400 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const shouldRestrict = body.restricted !== false;

    const client = getSupabaseAdminClient() || getSupabaseServerClient();
    if (client) {
      await client
        .from("tinder_conversations")
        .update({
          status: shouldRestrict ? "restricted" : "active",
          updated_at: new Date().toISOString(),
        })
        .eq("match_id", matchId);

      await client
        .from("instagram_conversations")
        .update({
          is_restricted: shouldRestrict,
          status: shouldRestrict ? "restricted" : "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", matchId);
    }

    return NextResponse.json({
      success: true,
      matchId,
      restricted: shouldRestrict,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao atualizar restrição do match." },
      { status: 500 }
    );
  }
}
