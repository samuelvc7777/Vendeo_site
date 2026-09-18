import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";
import { RealtimeBroadcaster } from "@/infrastructure/supabase/RealtimeBroadcaster";

/**
 * Rota Oficial do Webhook da Meta para Instagram Direct
 *
 * GET: Validação do webhook pelo painel Meta for Developers (hub.mode, hub.challenge, hub.verify_token)
 * POST: Recepção de eventos em tempo real com validação de assinatura HMAC-SHA256
 */

export const dynamic = "force-static";

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return new NextResponse("OK", { status: 200 });
  }

  const { searchParams } = new URL(req.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const repo = new SupabaseInstagramRepository();
  const config = await repo.getConfig();
  const expectedVerifyToken = config?.verifyToken || "vendeo_ig_secret_token";

  if (mode === "subscribe" && token === expectedVerifyToken) {
    // A Meta exige retorno em texto puro do valor do challenge com HTTP 200
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Token de verificação inválido", { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    const repo = new SupabaseInstagramRepository();
    const config = await repo.getConfig();

    // Se temos o App Secret configurado, validamos a assinatura HMAC-SHA256
    if (config?.appSecret && signature) {
      const hmac = crypto.createHmac("sha256", config.appSecret);
      const expectedSignature = `sha256=${hmac.update(rawBody).digest("hex")}`;

      if (signature !== expectedSignature) {
        console.warn("Assinatura do webhook inválida detectada.");
        return new NextResponse("Assinatura inválida", { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);

    // Verifica se o objeto recebido é do tipo instagram ou page
    if (payload.object === "instagram" || payload.object === "page") {
      const entries = payload.entry || [];

      for (const entry of entries) {
        const messaging = entry.messaging || [];

        for (const event of messaging) {
          const senderId = event.sender?.id;
          const recipientId = event.recipient?.id;
          const message = event.message;
          const readEvent = event.read;

          // 1. Tratamento de evento de LEITURA (Read Receipts / Mensagem Visualizada da Meta)
          if (readEvent && senderId) {
            const contactParticipantId = senderId;
            const watermark = readEvent.watermark || event.timestamp || Date.now();
            const seenAtIso = new Date(watermark).toISOString();

            let conversationId = contactParticipantId;
            const { getSupabaseAdminClient } = await import("@/infrastructure/supabase/server");
            const supabase = getSupabaseAdminClient();

            if (supabase && contactParticipantId) {
              try {
                // 1. Busca se há mensagens existentes desse participante
                const { data: matchedMsg } = await supabase
                  .from("instagram_messages")
                  .select("conversation_id")
                  .eq("sender_id", contactParticipantId)
                  .limit(1)
                  .maybeSingle();

                if (matchedMsg?.conversation_id) {
                  conversationId = matchedMsg.conversation_id;
                } else {
                  // 2. Busca na tabela de conversas
                  const { data: matchedConv } = await supabase
                    .from("instagram_conversations")
                    .select("id")
                    .or(`id.eq.${contactParticipantId},contact_id.eq.${contactParticipantId},username.eq.${contactParticipantId}`)
                    .limit(1)
                    .maybeSingle();

                  if (matchedConv?.id) {
                    conversationId = matchedConv.id;
                  }
                }

                // Atualiza a conversa para status 'seen' e grava seen_at
                await supabase
                  .from("instagram_conversations")
                  .update({
                    last_status: "seen",
                    seen_at: seenAtIso,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", conversationId);

                // Atualiza as mensagens enviadas por nós até o watermark para status 'seen'
                await supabase
                  .from("instagram_messages")
                  .update({
                    status: "seen",
                    seen_at: seenAtIso,
                  })
                  .eq("conversation_id", conversationId)
                  .eq("is_mine", true)
                  .lte("timestamp", seenAtIso);

                // Dispara broadcasts instantâneos via Supabase Realtime
                void RealtimeBroadcaster.broadcastInstagramSeen({
                  conversationId,
                  watermark,
                  seenAt: seenAtIso,
                });
                void RealtimeBroadcaster.broadcastInstagramConversation({
                  id: conversationId,
                  lastStatus: "seen",
                  seenAt: seenAtIso,
                  lastDirection: "out",
                });
              } catch (readErr) {
                console.warn("Aviso ao processar evento read no webhook:", readErr);
              }
            }
            continue;
          }

          // Se é uma mensagem recebida com texto ou anexos de mídia (foto, áudio, vídeo)
          if (message && (message.text || message.attachments?.length) && senderId) {
            const isSentByMe =
              Boolean(message.is_echo) ||
              config?.instagramAccountId === senderId ||
              config?.pageId === senderId ||
              senderId === "37339507545693317";

            const contactParticipantId = isSentByMe ? recipientId : senderId;
            const nowIso = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

            let conversationId = contactParticipantId;

            // Resolve o ID do contato para o ID da thread no Supabase
            const { getSupabaseAdminClient } = await import("@/infrastructure/supabase/server");
            const supabase = getSupabaseAdminClient();

            if (supabase && contactParticipantId) {
              try {
                // 1. Busca se há mensagens existentes desse participante
                const { data: matchedMsg } = await supabase
                  .from("instagram_messages")
                  .select("conversation_id")
                  .eq("sender_id", contactParticipantId)
                  .limit(1)
                  .maybeSingle();

                if (matchedMsg?.conversation_id) {
                  conversationId = matchedMsg.conversation_id;
                } else {
                  // 2. Busca na tabela de conversas
                  const { data: matchedConv } = await supabase
                    .from("instagram_conversations")
                    .select("id")
                    .or(`id.eq.${contactParticipantId},username.eq.${contactParticipantId}`)
                    .limit(1)
                    .maybeSingle();

                  if (matchedConv?.id) {
                    conversationId = matchedConv.id;
                  }
                }
              } catch (err) {
                console.warn("Aviso ao resolver conversa no webhook:", err);
              }
            }

            let textToSave = (message.text || "").trim();
            let previewText = textToSave;

            const firstAtt = message.attachments?.[0];
            if (firstAtt) {
              const attType = (firstAtt.type || "").toLowerCase();
              const attUrl = firstAtt.payload?.url || (firstAtt as any).audio_data?.url || (firstAtt as any).file_url;

              if (attUrl) {
                try {
                  const { SupabaseMediaStorage } = await import("@/infrastructure/storage/SupabaseMediaStorage");
                  const mediaStorage = new SupabaseMediaStorage();

                  if (attType === "image" || attType.includes("image")) {
                    const permanentUrl = await mediaStorage.downloadAndPersist(attUrl, "image");
                    const finalUrl = permanentUrl || attUrl;
                    textToSave = `[image:${finalUrl}]${textToSave ? ` ${textToSave}` : ""}`;
                    previewText = "📷 Foto";
                  } else if (attType === "audio" || attType.includes("audio") || attType.includes("voice")) {
                    const permanentUrl = await mediaStorage.downloadAndPersist(attUrl, "audio");
                    const finalUrl = permanentUrl || attUrl;
                    textToSave = `[audio:${finalUrl}]`;
                    previewText = "🎙️ Mensagem de voz";
                  } else if (attType === "video" || attType.includes("video")) {
                    const permanentUrl = await mediaStorage.downloadAndPersist(attUrl, "video");
                    const finalUrl = permanentUrl || attUrl;
                    textToSave = `[video:${finalUrl}]${textToSave ? ` ${textToSave}` : ""}`;
                    previewText = "📹 Vídeo";
                  } else {
                    textToSave = `[file:${attUrl}]`;
                    previewText = "📁 Arquivo";
                  }
                } catch {
                  // Se o download falhar, mantém a URL original
                }
              }
            }

            if (conversationId) {
              // 1. Salvar ou atualizar conversa com prévia
              await repo.saveConversation({
                id: conversationId,
                lastMessage: previewText || (isSentByMe ? "Mensagem enviada" : "Mensagem recebida"),
                lastMessageAt: nowIso,
                lastDirection: isSentByMe ? "out" : "in",
                unread: !isSentByMe,
              });

              // 2. Salvar mensagem no histórico do Supabase
              const replyToMid =
                message.reply_to?.mid ||
                message.reply_to?.id ||
                (typeof message.reply_to === "string" ? message.reply_to : null) ||
                (message as any).reply_to_mid ||
                null;

              console.log("📥 [Instagram Reply - Webhook] Evento de mensagem recebido da Meta:", {
                mid: message.mid,
                senderId,
                recipientId,
                isSentByMe,
                text: textToSave || previewText,
                reply_to: message.reply_to,
                replyToMid,
              });

              const newWebhookMsg = {
                id: message.mid || `mid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                conversationId,
                senderId: isSentByMe ? "me" : senderId,
                text: textToSave || previewText,
                timestamp: nowIso,
                isMine: isSentByMe,
                status: "sent" as const,
                replyToMessageId: replyToMid,
              };

              await repo.saveMessage(newWebhookMsg);
              console.log("💾 [Instagram Reply - Webhook] Mensagem salva com replyToMessageId:", replyToMid);

              // 3. Disparar broadcasts instantâneos via Supabase WebSocket (< 20ms)
              void RealtimeBroadcaster.broadcastInstagramMessage(newWebhookMsg);
              void RealtimeBroadcaster.broadcastInstagramConversation({
                id: conversationId,
                lastMessage: previewText || (isSentByMe ? "Mensagem enviada" : "Mensagem recebida"),
                lastMessageAt: nowIso,
                lastDirection: isSentByMe ? "out" : "in",
                unread: !isSentByMe,
              });
            }
          }
        }
      }

      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    return new NextResponse("Objeto não suportado", { status: 404 });
  } catch (error: unknown) {
    console.error("Erro no processamento do webhook do Instagram:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
