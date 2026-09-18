import { NextRequest, NextResponse } from "next/server";
import { TinderApiClient } from "@/infrastructure/tinder/TinderApiClient";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = body?.token?.trim();

    if (!token) {
      return NextResponse.json(
        { error: "Token de autenticação do Tinder não informado." },
        { status: 400 }
      );
    }

    // Valida o token consumindo a API oficial do Tinder
    const profile = await TinderApiClient.getProfile(token);

    // Salva token e perfil no Supabase para persistência e autonomia do backend
    const client = getSupabaseServerClient();
    if (client) {
      try {
        await client.from("tinder_config").upsert({
          id: "default",
          auth_token: token,
          user_id: profile.id,
          user_name: profile.name,
          avatar_url: profile.photos?.[0]?.url,
          updated_at: new Date().toISOString(),
        });
      } catch (dbErr) {
        console.error("Aviso ao persistir tinder_config no Supabase:", dbErr);
      }
    }

    const response = NextResponse.json({
      success: true,
      profile,
      token,
    });

    // Armazena em cookie seguro
    response.cookies.set("tinder_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 dias
    });

    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao conectar com o Tinder." },
      { status: 401 }
    );
  }
}
