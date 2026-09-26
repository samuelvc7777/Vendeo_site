import { NextRequest, NextResponse } from "next/server";
import { GenerateAiResponseUseCase } from "@/application/use-cases/GenerateAiResponseUseCase";
import {
  AiMessageItem,
  AiPretendenteInfo,
} from "@/domain/entities/AiPrompt";
import { getMessageTimestampMs } from "@/lib/utils";
import { GroqChatService } from "@/infrastructure/ai/GroqChatService";
import { KieChatService } from "@/infrastructure/ai/KieChatService";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

export async function GET() {
  return NextResponse.json({
    status: "online",
    service: "Vendeo AI Chat Generator",
    defaultModel: KieChatService.SOL_MODEL,
    deepModel: KieChatService.TERRA_MODEL,
  });
}

interface GenerateRequestBody {
  conversationId?: string;
  platform?: "tinder" | "instagram";
  conversationName?: string;
  contactUsername?: string;
  city?: string;
  bio?: string;
  currentMessages?: any[];
  model?: string;
  temperature?: number;
  targetMessageId?: string;
  messagesToRespond?: any[];
  stageContext?: any;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateRequestBody;
    const {
      conversationId = "default",
      platform = "instagram",
      conversationName = "Pretendente",
      contactUsername,
      city,
      bio,
      currentMessages = [],
      model = KieChatService.SOL_MODEL,
      temperature = 0.65,
      targetMessageId,
      messagesToRespond,
      stageContext,
    } = body;

    // Parsing de nome e idade (ex: "Volder, 36" ou "Volder")
    let parsedName = conversationName || "Pretendente";
    let parsedAge: number | undefined;

    const ageMatch = parsedName.match(/^(.*?)(?:,\s*(\d+))?$/);
    if (ageMatch) {
      if (ageMatch[1] && ageMatch[1].trim()) parsedName = ageMatch[1].trim();
      if (ageMatch[2]) parsedAge = parseInt(ageMatch[2], 10);
    }

    const pretendente: AiPretendenteInfo = {
      id: conversationId,
      name: parsedName,
      age: parsedAge,
      city: city || "não informada",
      bio: bio || "sem bio",
      platform: platform === "instagram" ? "instagram" : "tinder",
      username: contactUsername || parsedName.toLowerCase().replace(/\s+/g, "_"),
    };

    // Mapeamento e ordenação cronológica das mensagens recebidas
    const formattedHistory: AiMessageItem[] = (currentMessages || [])
      .map((m: any) => ({
        id: m.id || String(Date.now()),
        sender: (m.isMine || m.senderId === "me" || m.sender === "me" ? "me" : "them") as "me" | "them",
        text: m.text || "",
        timestamp: m.timestamp || m.sentDate || m.createdAt,
        audioTranscript: m.audioTranscript,
        mediaType: m.mediaType,
        mediaUrl: m.mediaUrl,
        replyToText: m.replyToText,
      }))
      .sort((a, b) => getMessageTimestampMs(a.timestamp) - getMessageTimestampMs(b.timestamp));

    let targetMessagesToRespond: AiMessageItem[] | undefined = undefined;
    if (Array.isArray(messagesToRespond) && messagesToRespond.length > 0) {
      targetMessagesToRespond = messagesToRespond;
    } else if (targetMessageId) {
      const target = formattedHistory.find((m) => String(m.id) === String(targetMessageId));
      if (target) {
        targetMessagesToRespond = [target];
      }
    }

    const useCase = new GenerateAiResponseUseCase();
    const result = await useCase.execute({
      pretendente,
      tinderHistory: platform === "tinder" ? formattedHistory : [],
      instagramHistory: platform === "instagram" ? formattedHistory : [],
      messagesToRespond: targetMessagesToRespond,
      stageContext,
      model,
      temperature,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Erro ao processar resposta com o modelo de IA.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      responses: result.responses,
      indices: result.indices,
      completedChecklistIds: result.completedChecklistIds,
      isRaffleStepReached: result.isRaffleStepReached,
      analise_do_pretendente: result.analise_do_pretendente,
      modelUsed: result.modelUsed,
      latencyMs: result.latencyMs,
    });
  } catch (error: any) {
    console.error("[API /api/ai/generate] Erro interno:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Falha interna ao gerar resposta com IA.",
      },
      { status: 500 }
    );
  }
}
