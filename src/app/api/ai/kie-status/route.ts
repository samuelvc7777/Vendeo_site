import { NextRequest, NextResponse } from "next/server";
import { KieChatService } from "@/infrastructure/ai/KieChatService";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

export async function GET() {
  try {
    const key = await KieChatService.getApiKey();
    const isConfigured = Boolean(key && key.trim().length >= 10);
    const maskedKey = isConfigured && key ? `${key.slice(0, 4)}...${key.slice(-4)}` : null;

    return NextResponse.json({
      configured: isConfigured,
      model: "gpt-5-6-sol",
      provider: "Kie.ai (Sol)",
      maskedKey,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: errorMsg, configured: false }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    if (!apiKey || apiKey.length < 10) {
      return NextResponse.json(
        { error: "Chave inválida. Informe a chave completa da Kie.ai." },
        { status: 400 }
      );
    }

    const success = await KieChatService.setApiKey(apiKey);
    if (!success) {
      return NextResponse.json(
        { error: "Falha ao salvar a chave no Supabase." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Chave Kie.ai (Sol) configurada com sucesso!",
      maskedKey: `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
