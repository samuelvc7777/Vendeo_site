import { NextRequest, NextResponse } from "next/server";
import { GroqCloudAudioTranscriber } from "@/infrastructure/ai/GroqCloudAudioTranscriber";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

export async function GET() {
  try {
    const key = await GroqCloudAudioTranscriber.getApiKey();
    const isConfigured = Boolean(key && key.startsWith("gsk_"));
    const maskedKey = isConfigured && key ? `${key.slice(0, 7)}...${key.slice(-4)}` : null;

    return NextResponse.json({
      configured: isConfigured,
      model: "whisper-large-v3",
      provider: "Groq Cloud Audio",
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

    if (!apiKey || !apiKey.startsWith("gsk_")) {
      return NextResponse.json(
        { error: "Chave inválida. A chave da Groq deve iniciar com 'gsk_'." },
        { status: 400 }
      );
    }

    const success = await GroqCloudAudioTranscriber.setApiKey(apiKey);
    if (!success) {
      return NextResponse.json(
        { error: "Falha ao salvar a chave no Supabase." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Chave Groq API configurada com sucesso!",
      maskedKey: `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
    const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : undefined;

    if (!mediaUrl && !messageId) {
      return NextResponse.json(
        { error: "Informe 'mediaUrl' ou 'messageId' para transcrever o áudio." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

    // 1. Tenta recuperar transcrição em cache no banco de dados
    if (supabase && messageId) {
      try {
        const { data: existingMsg } = await supabase
          .from("instagram_messages")
          .select("audio_transcript")
          .eq("id", messageId)
          .maybeSingle();

        if (existingMsg?.audio_transcript) {
          return NextResponse.json({
            text: existingMsg.audio_transcript,
            cached: true,
            model: "whisper-large-v3",
          });
        }
      } catch (dbErr) {
        console.warn("Aviso ao consultar cache de áudio no Supabase:", dbErr);
      }
    }

    if (!mediaUrl) {
      return NextResponse.json(
        { error: "URL de mídia não fornecida e mensagem não encontrada no cache." },
        { status: 404 }
      );
    }

    // 2. Executa a transcrição na nuvem com a Groq
    const transcript = await GroqCloudAudioTranscriber.transcribeFromUrl(mediaUrl, apiKey);

    if (!transcript) {
      return NextResponse.json(
        { error: "Não foi possível transcrever o áudio agora. Verifique a chave GROQ_API_KEY ou a URL do áudio." },
        { status: 502 }
      );
    }

    // 3. Salva no banco de dados para evitar reprocessamento futuro
    if (supabase && messageId) {
      try {
        await supabase
          .from("instagram_messages")
          .update({
            audio_transcript: transcript,
            audio_transcribed_at: new Date().toISOString(),
            audio_transcription_error: null,
          })
          .eq("id", messageId);
      } catch (saveErr) {
        console.warn("Aviso ao salvar transcrição no Supabase:", saveErr);
      }
    }

    return NextResponse.json({
      text: transcript,
      cached: false,
      model: "whisper-large-v3",
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
