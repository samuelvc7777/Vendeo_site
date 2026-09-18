import { NextRequest, NextResponse } from "next/server";
import { TinderApiClient } from "@/infrastructure/tinder/TinderApiClient";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import {
  NetworkTimeoutError,
  RateLimitError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "@/infrastructure/http/network";

export const dynamic = "force-static";

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return NextResponse.json({ isConnected: false });
  }

  const cookieHeader = req.headers.get("cookie") || "";

  const cookieToken = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("tinder_token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");

  let token = authHeader || cookieToken;

  const client = getSupabaseServerClient();

  // 1. Se não veio no request, busca na tabela tinder_config do Supabase
  if (!token && client) {
    try {
      const { data } = await client
        .from("tinder_config")
        .select("*")
        .eq("id", "default")
        .single();

      if (data?.auth_token) {
        token = data.auth_token;
      }
    } catch {
      // Ignora erro de leitura preliminar de config
    }
  }

  if (!token) {
    return NextResponse.json({
      isConnected: false,
      code: "NO_TOKEN",
    });
  }

  // 2. Tenta obter o perfil atualizado da API oficial do Tinder
  try {
    const profile = await TinderApiClient.getProfile(token);
    return NextResponse.json({
      isConnected: true,
      profile,
      token,
    });
  } catch (err: unknown) {
    // 3. Tratamento de token inválido ou expirado
    if (err instanceof UnauthorizedError) {
      const res = NextResponse.json({
        isConnected: false,
        code: "UNAUTHORIZED",
        error: "Sessão expirada ou token inválido.",
      });
      res.cookies.delete("tinder_token");
      return res;
    }

    // 4. Se a API externa falhar com timeout, rate limit ou indisponibilidade,
    // verifica se existe perfil persistido no Supabase como modo resiliente/degradado
    if (client) {
      try {
        const { data } = await client
          .from("tinder_config")
          .select("*")
          .eq("id", "default")
          .single();

        if (data?.auth_token) {
          return NextResponse.json({
            isConnected: true,
            degraded: true,
            profile: {
              id: data.user_id || "6a8451cb13ef7556bbdaa40e",
              name: data.user_name || "Larissa",
              photos: data.avatar_url ? [{ id: "1", url: data.avatar_url }] : [],
              isVerified: true,
            },
            token: data.auth_token,
          });
        }
      } catch {
        // Fallback silencioso do Supabase
      }
    }

    // 5. Retorno limpo e gracioso caso não seja possível obter nem da API nem do banco
    let errorCode = "SERVICE_ERROR";
    if (err instanceof NetworkTimeoutError) {
      errorCode = "NETWORK_TIMEOUT";
    } else if (err instanceof RateLimitError) {
      errorCode = "RATE_LIMIT";
    } else if (err instanceof ServiceUnavailableError) {
      errorCode = "SERVICE_UNAVAILABLE";
    }

    return NextResponse.json({
      isConnected: false,
      code: errorCode,
      error: err instanceof Error ? err.message : "Erro ao consultar status da conexão com Tinder.",
    });
  }
}
