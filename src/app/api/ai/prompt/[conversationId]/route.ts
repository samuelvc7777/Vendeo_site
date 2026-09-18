import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import { GenerateAiPromptUseCase } from "@/application/use-cases/GenerateAiPromptUseCase";
import { GroqCloudAudioTranscriber } from "@/infrastructure/ai/GroqCloudAudioTranscriber";
import {
  AiMessageItem,
  AiPretendenteInfo,
} from "@/domain/entities/AiPrompt";
import { formatMessageTime } from "@/lib/utils";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ conversationId: "default" }];
}

interface RouteParams {
  params: Promise<{
    conversationId: string;
  }>;
}

interface ClientMessagePayload {
  id?: string;
  text: string;
  isMine?: boolean;
  senderId?: string;
  createdAt?: string;
  timestamp?: string;
  audioUrl?: string | null;
  audioTranscript?: string | null;
  mediaType?: "text" | "audio" | "image" | null;
  mediaUrl?: string | null;
}

async function handleGeneratePrompt(
  conversationId: string,
  platformParam: string,
  clientData?: {
    conversationName?: string;
    bio?: string;
    city?: string;
    currentMessages?: ClientMessagePayload[];
    stageContext?: any;
  }
) {
  const platform = platformParam === "instagram" ? "instagram" : "tinder";
  const supabase = getSupabaseServerClient();

  // Parsing inteligente de nome e idade (ex: "Victor, 26" -> name: "Victor", age: 26)
  let parsedName = clientData?.conversationName || "Pretendente";
  let parsedAge: number | undefined;

  const ageMatch = parsedName.match(/^(.*?)(?:,\s*(\d+))?$/);
  if (ageMatch) {
    if (ageMatch[1] && ageMatch[1].trim()) {
      parsedName = ageMatch[1].trim();
    }
    if (ageMatch[2]) {
      parsedAge = parseInt(ageMatch[2], 10);
    }
  }

  let pretendente: AiPretendenteInfo = {
    id: conversationId,
    name: parsedName,
    age: parsedAge,
    city: clientData?.city || "não informada",
    bio: clientData?.bio || "sem bio",
    platform,
    username: parsedName.toLowerCase().replace(/\s+/g, "_"),
  };

  let tinderHistory: AiMessageItem[] = [];
  let instagramHistory: AiMessageItem[] = [];

  // 1. Tenta recuperar do Supabase se o cliente estiver disponível
  if (supabase) {
    try {
      if (platform === "tinder") {
        const { data: convData } = await supabase
          .from("tinder_conversations")
          .select("*")
          .eq("match_id", conversationId)
          .maybeSingle();

        if (convData) {
          if (convData.birth_date) {
            const birthYear = new Date(convData.birth_date).getFullYear();
            if (!isNaN(birthYear)) {
              pretendente.age = new Date().getFullYear() - birthYear;
            }
          }
          if (convData.name) {
            pretendente.name = convData.name;
            pretendente.username = convData.name.toLowerCase().replace(/\s+/g, "_");
          }
          if (convData.bio) {
            pretendente.bio = convData.bio;
          }

          // Busca até 500 mensagens mais recentes do Tinder no Supabase
          const { data: messagesData } = await supabase
            .from("tinder_messages")
            .select("*")
            .eq("match_id", conversationId)
            .order("sent_date", { ascending: false })
            .limit(500);

          const { data: configData } = await supabase
            .from("tinder_config")
            .select("user_id")
            .eq("id", "default")
            .maybeSingle();

          const myUserId = configData?.user_id || "6a8451cb13ef7556bbdaa40e";

          if (messagesData && messagesData.length > 0) {
            const chronTinder = [...messagesData].reverse();
            tinderHistory = chronTinder.map((m: any) => {
              const rawTinderTime = m.sent_date || m.created_at || new Date().toISOString();
              const isMine = m.sender_id === myUserId || m.sender_id === "me";
              return {
                id: m.id,
                sender: isMine ? ("me" as const) : ("them" as const),
                text: m.message,
                timestamp: rawTinderTime,
                sentDate: rawTinderTime,
              };
            });
          }

          // Se houver mensagens em clientData.currentMessages que ainda não estão no banco, anexa
          if (Array.isArray(clientData?.currentMessages) && clientData.currentMessages.length > 0) {
            const existingIds = new Set(tinderHistory.map((h) => h.id));
            const pending = clientData.currentMessages.filter((cm) => cm.id && !existingIds.has(cm.id));
            for (const cm of pending) {
              tinderHistory.push({
                id: cm.id || `client_${Date.now()}`,
                sender: (cm.isMine || cm.senderId === "me") ? ("me" as const) : ("them" as const),
                text: cm.text || "",
                timestamp: cm.timestamp || "Recente",
              });
            }
          }
        }
      } else {
        // Plataforma Instagram
        const { data: convData } = await supabase
          .from("instagram_conversations")
          .select("*")
          .eq("id", conversationId)
          .maybeSingle();

        if (convData) {
          if (convData.full_name) pretendente.name = convData.full_name;
          if (convData.username) pretendente.username = convData.username;
        }

        // Busca até 500 mensagens mais recentes do Instagram no Supabase
        const { data: igMessages } = await supabase
          .from("instagram_messages")
          .select("id, text, sender_id, is_mine, media_url, media_type, audio_transcript, reply_to_message_id, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(500);

        if (igMessages && igMessages.length > 0) {
          const chronIg = [...igMessages].reverse();
          // Enriquecimento de áudio com Groq Cloud em paralelo para as mensagens que precisarem
          instagramHistory = await Promise.all(
            chronIg.map(async (m: any) => {
              const isMine = m.is_mine || m.sender_id === "me";
              let textContent = m.text || "";
              let transcript = m.audio_transcript || "";

              const clientMsg = Array.isArray(clientData?.currentMessages)
                ? clientData?.currentMessages.find((cm: any) => cm.id === m.id)
                : null;

              if (!transcript && clientMsg?.audioTranscript) {
                transcript = clientMsg.audioTranscript;
              }

              const isAudio =
                m.media_type === "audio" ||
                clientMsg?.mediaType === "audio" ||
                (typeof m.text === "string" && m.text.includes("[audio:")) ||
                (typeof clientMsg?.text === "string" && clientMsg.text.includes("[audio:"));

              if (isAudio && !transcript) {
                const audioUrl =
                  m.media_url ||
                  clientMsg?.mediaUrl ||
                  clientMsg?.audioUrl ||
                  (m.text?.match(/\[audio:(.*?)\]/)?.[1]) ||
                  (clientMsg?.text?.match(/\[audio:(.*?)\]/)?.[1]);

                if (audioUrl) {
                  try {
                    const groqText = await GroqCloudAudioTranscriber.transcribeFromUrl(audioUrl);
                    if (groqText) {
                      transcript = groqText;
                      // Salva no banco de dados para caching permanente
                      await supabase
                        .from("instagram_messages")
                        .update({
                          audio_transcript: groqText,
                          audio_transcribed_at: new Date().toISOString(),
                        })
                        .eq("id", m.id);
                    }
                  } catch (tErr) {
                    console.warn("Aviso ao transcrever áudio com Groq Cloud:", tErr);
                  }
                }
              }

              if (transcript) {
                textContent = `[áudio transcrito: "${transcript}"]`;
              } else if (isAudio) {
                textContent = "[áudio recebido]";
              }

              return {
                id: m.id,
                sender: isMine ? ("me" as const) : ("them" as const),
                text: textContent,
                timestamp: m.timestamp || m.created_at || new Date().toISOString(),
                sentDate: m.timestamp || m.created_at || new Date().toISOString(),
                audioTranscript: transcript || undefined,
                mediaType: isAudio ? "audio" : undefined,
              };
            })
          );
        }

        // Se houver mensagens em clientData.currentMessages que ainda não estão no banco, anexa
        if (Array.isArray(clientData?.currentMessages) && clientData.currentMessages.length > 0) {
          const existingIds = new Set(instagramHistory.map((h) => h.id));
          const pending = clientData.currentMessages.filter((cm) => cm.id && !existingIds.has(cm.id));

          for (const cm of pending) {
            let textContent = cm.text || "";
            let transcript = cm.audioTranscript || "";
            const isAudio =
              cm.mediaType === "audio" ||
              (typeof cm.text === "string" && cm.text.includes("[audio:"));

            if (isAudio && !transcript) {
              const audioUrl = cm.mediaUrl || cm.audioUrl || (cm.text?.match(/\[audio:(.*?)\]/)?.[1]);
              if (audioUrl) {
                try {
                  const groqText = await GroqCloudAudioTranscriber.transcribeFromUrl(audioUrl);
                  if (groqText) transcript = groqText;
                } catch (tErr) {
                  console.warn("Aviso ao transcrever áudio pendente da tela:", tErr);
                }
              }
            }

            if (transcript) {
              textContent = `[áudio transcrito: "${transcript}"]`;
            } else if (isAudio) {
              textContent = "[áudio recebido]";
            }

            instagramHistory.push({
              id: cm.id || `client_${Date.now()}`,
              sender: (cm.isMine || cm.senderId === "me") ? ("me" as const) : ("them" as const),
              text: textContent,
              timestamp: cm.timestamp || "Recente",
            });
          }
        }
      }
    } catch (dbErr) {
      console.error("Aviso ao buscar dados no Supabase:", dbErr);
    }
  }

  // 2. Se o histórico do Supabase estiver vazio mas o cliente enviou as mensagens da tela, usa as mensagens da tela!
  const hasDbMessages = tinderHistory.length > 0 || instagramHistory.length > 0;
  if (!hasDbMessages && clientData?.currentMessages && clientData.currentMessages.length > 0) {
    const clientMapped: AiMessageItem[] = await Promise.all(
      clientData.currentMessages.map(async (m, idx) => {
        const isMine = m.isMine ?? (m.senderId === "me");
        let textContent = m.text || "";
        let transcript = m.audioTranscript || "";

        const isAudio =
          m.mediaType === "audio" ||
          (typeof m.text === "string" && m.text.includes("[audio:"));

        if (isAudio && !transcript) {
          const audioUrl =
            m.mediaUrl || m.audioUrl || (m.text?.match(/\[audio:(.*?)\]/)?.[1]);
          if (audioUrl) {
            try {
              const groqText = await GroqCloudAudioTranscriber.transcribeFromUrl(audioUrl);
              if (groqText) {
                transcript = groqText;
              }
            } catch (tErr) {
              console.warn("Aviso ao transcrever áudio recebido da tela:", tErr);
            }
          }
        }

        if (transcript) {
          textContent = `[áudio transcrito: "${transcript}"]`;
        } else if (isAudio) {
          textContent = "[áudio recebido]";
        }

        return {
          id: m.id || `msg_client_${idx}`,
          sender: isMine ? ("me" as const) : ("them" as const),
          text: textContent,
          timestamp: m.createdAt || m.timestamp || "Recente",
          audioTranscript: transcript || undefined,
          mediaType: isAudio ? "audio" : undefined,
        };
      })
    );

    if (platform === "tinder") {
      tinderHistory = clientMapped;
    } else {
      instagramHistory = clientMapped;
    }
  }

  // 3. Busca referências de persona ativas no Supabase se disponível
  let personaReferences: any[] = [];
  if (supabase) {
    try {
      const { data: pData } = await supabase
        .from("ai_persona_references")
        .select("category, them_message, larissa_response, notes")
        .eq("is_active", true)
        .limit(20);
      if (pData && Array.isArray(pData)) {
        personaReferences = pData;
      }
    } catch (pErr) {
      console.warn("Aviso ao buscar ai_persona_references no server route:", pErr);
    }
  }

  // 4. Executa o caso de uso gerador de prompt
  const useCase = new GenerateAiPromptUseCase();
  const result = useCase.execute({
    pretendente,
    tinderHistory,
    instagramHistory,
    personaReferences,
    stageContext: clientData?.stageContext,
  });

  return {
    success: true,
    ...result,
  };
}

export async function GET(req: NextRequest, context: RouteParams) {
  try {
    const { conversationId } = await context.params;
    const url = new URL(req.url);
    const platform = (url.searchParams.get("platform") || "tinder").toLowerCase();
    const name = url.searchParams.get("name") || undefined;

    const result = await handleGeneratePrompt(conversationId, platform, {
      conversationName: name,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Erro ao gerar prompt no GET:", error);
    return NextResponse.json(
      { error: "Falha ao gerar o prompt de IA.", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const { conversationId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const platform = (body?.platform || "tinder").toLowerCase();

    const result = await handleGeneratePrompt(conversationId, platform, {
      conversationName: body?.conversationName,
      bio: body?.bio,
      city: body?.city,
      currentMessages: body?.currentMessages,
      stageContext: body?.stageContext,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Erro ao gerar prompt no POST:", error);
    return NextResponse.json(
      { error: "Falha ao gerar o prompt de IA.", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}