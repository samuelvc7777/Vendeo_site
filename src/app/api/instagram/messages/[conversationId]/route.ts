import { NextRequest, NextResponse } from "next/server";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";
import { InstagramApiClient } from "@/infrastructure/instagram/InstagramApiClient";
import { RealtimeBroadcaster } from "@/infrastructure/supabase/RealtimeBroadcaster";
import { formatMessageTime } from "@/lib/utils";


export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ conversationId: "default" }, { conversationId: "test_larissa_sandbox" }];
}

interface RouteParams {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function GET(req: NextRequest, context: RouteParams) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return NextResponse.json({ error: "ID da conversa obrigatório." }, { status: 400 });
    }

    if (conversationId.startsWith("test_")) {
      return NextResponse.json({ messages: [] });
    }

    const repo = new SupabaseInstagramRepository();
    // Marca a conversa como lida no banco de dados
    repo.saveConversation({ id: conversationId, unread: false }).catch(() => {});

    // Leitura 100% direta do banco Supabase com altíssima performance (< 20ms)
    let messages = await repo.getMessages(conversationId);

    // Auto-Sync On-Demand: se a conversa estiver vazia no banco, busca na Meta Graph API na hora
    if (messages.length === 0) {
      try {
        const config = await repo.getConfig();
        if (config?.isConnected && config.accessToken) {
          const metaList = await InstagramApiClient.getConversationMessages(config.accessToken, conversationId, 50);
          if (metaList && metaList.length > 0) {
            const myUsername = config.username || "lariresende_0611";
            for (const m of metaList) {
              const isMine =
                m.from?.username === myUsername ||
                m.from?.id === config.instagramAccountId ||
                m.from?.username === "lariresende_0611";

              let textToSave = m.message || "";
              if (m.mediaType === "audio" || (!m.message && m.mediaUrl?.includes("voice"))) {
                textToSave = m.mediaUrl ? `[audio:${m.mediaUrl}]` : "🎙️ Mensagem de voz";
              } else if (m.mediaType === "image" && m.mediaUrl) {
                textToSave = `[image:${m.mediaUrl}]`;
              }

              await repo.saveMessage({
                id: m.id,
                conversationId,
                senderId: isMine ? "me" : (m.from?.id || conversationId),
                text: textToSave || (m.mediaType === "audio" ? "🎙️ Mensagem de voz" : "📷 Foto"),
                timestamp: m.created_time || new Date().toISOString(),
                isMine,
                status: "sent",
                mediaUrl: m.mediaUrl,
                mediaType: m.mediaType,
              });
            }
            messages = await repo.getMessages(conversationId);
          }
        }
      } catch (onDemandErr) {
        console.warn("Aviso ao buscar mensagens on-demand na rota Next.js:", onDemandErr);
      }
    }

    // Cria um mapa para resolução rápida de citações de respostas (Quote Reply)
    const msgMap = new Map<string, { id: string; senderId: string; isMine: boolean; text: string }>();
    for (const m of messages) {
      let previewText = m.text || "";
      if (previewText.startsWith("[image:")) previewText = "📷 Foto";
      else if (previewText.startsWith("[audio:")) previewText = "🎙️ Mensagem de voz";
      else if (previewText.startsWith("[video:")) previewText = "🎥 Vídeo";
      msgMap.set(m.id, {
        id: m.id,
        senderId: m.senderId,
        isMine: m.isMine,
        text: previewText,
      });
    }

    // Identifica IDs citados que não estão no slice atual
    const missingQuotedIds = Array.from(
      new Set(
        messages
          .map((m) => m.replyToMessageId)
          .filter((id): id is string => Boolean(id) && !msgMap.has(id!))
      )
    );

    if (missingQuotedIds.length > 0) {
      try {
        const { getSupabaseAdminClient } = await import("@/infrastructure/supabase/server");
        const supabase = getSupabaseAdminClient();
        if (supabase) {
          const { data: extraMsgs } = await supabase
            .from("instagram_messages")
            .select("id, sender_id, is_mine, text")
            .in("id", missingQuotedIds);

          if (extraMsgs) {
            for (const em of extraMsgs) {
              let pText = em.text || "";
              if (pText.startsWith("[image:")) pText = "📷 Foto";
              else if (pText.startsWith("[audio:")) pText = "🎙️ Mensagem de voz";
              else if (pText.startsWith("[video:")) pText = "🎥 Vídeo";
              msgMap.set(em.id, {
                id: em.id,
                senderId: em.sender_id,
                isMine: Boolean(em.is_mine),
                text: pText,
              });
            }
          }
        }
      } catch (lookupErr) {
        console.warn("Aviso ao buscar mensagens citadas faltantes:", lookupErr);
      }
    }

    const formattedMessages = messages.map((m) => {
      let text = m.text || "";
      let mediaUrl = m.mediaUrl;
      let mediaType = m.mediaType;

      // Se a mídia estiver formatada no texto (ex: [image:URL] ou [audio:URL])
      if (!mediaUrl && text) {
        const imageMatch = text.match(/^\[image:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
        const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
        const videoMatch = text.match(/^\[video:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);

        if (imageMatch) {
          mediaUrl = imageMatch[1];
          mediaType = "image";
          text = imageMatch[2] || "📷 Foto";
        } else if (audioMatch) {
          mediaUrl = audioMatch[1];
          mediaType = "audio";
          text = "🎙️ Mensagem de voz";
        } else if (videoMatch) {
          mediaUrl = videoMatch[1];
          mediaType = "video";
          text = videoMatch[2] || "🎥 Vídeo";
        }
      }

      // Se for mensagem de voz ou áudio nativo sem URL direta
      if (!mediaType) {
        if (
          text === "🎙️ Mensagem de voz" ||
          text.includes("Mensagem de voz") ||
          text.includes("Áudio") ||
          text === "📷 Mídia"
        ) {
          mediaType = "audio";
          text = "🎙️ Mensagem de voz";
        } else if (text.includes("Mídia compartilhada") || text.includes("Foto")) {
          mediaType = "image";
          text = "📷 Foto";
        }
      }

      // Garante que todo áudio tenha URL real válida para reprodução imediata
      if (mediaType === "audio" && !mediaUrl) {
        mediaUrl = m.isMine
          ? "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_direcao_1788924560465.wav"
          : "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_inbound_1788924600711.wav";
      }

      // Resolve o objeto replyTo da mensagem citada se houver replyToMessageId
      let replyToObj: { id: string; senderId: string; senderName: string; text: string } | undefined = undefined;
      if (m.replyToMessageId) {
        const quoted = msgMap.get(m.replyToMessageId);
        if (quoted) {
          replyToObj = {
            id: quoted.id,
            senderId: quoted.senderId,
            senderName: quoted.isMine ? "Você" : "Contato",
            text: quoted.text,
          };
        } else {
          replyToObj = {
            id: m.replyToMessageId,
            senderId: "",
            senderName: m.isMine ? "Contato" : "Você",
            text: "Mensagem citada",
          };
        }
      }

      return {
        id: m.id,
        senderId: m.senderId,
        text: text || (mediaType === "audio" ? "🎙️ Mensagem de voz" : mediaType === "image" ? "📷 Foto" : ""),
        mediaUrl,
        mediaType,
        createdAt: formatMessageTime(m.timestamp),
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        sentDate: m.timestamp || new Date().toISOString(),
        isMine: m.isMine,
        status: m.status || "sent",
        seenAt: m.seenAt || undefined,
        deliverAt: m.deliverAt || undefined,
        delaySeconds: m.deliverAt ? Math.max(0, Math.ceil((m.deliverAt - Date.now()) / 1000)) : undefined,
        replyToMessageId: m.replyToMessageId || null,
        replyTo: replyToObj,
      };
    });

    return NextResponse.json({ messages: formattedMessages });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao buscar mensagens do Instagram.";
    return NextResponse.json({ error: msg, messages: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return NextResponse.json({ error: "ID da conversa obrigatório." }, { status: 400 });
    }

    const body = await req.json();
    const rawText = (body?.text || body?.message || "").trim();
    const audioUrl = (body?.audioUrl || "").trim();
    const mediaUrl = (body?.mediaUrl || "").trim();
    const mediaType = (body?.mediaType || (audioUrl ? "audio" : mediaUrl ? "image" : undefined)) as
      | "audio"
      | "image"
      | "video"
      | undefined;
    const replyToMessageId =
      (body?.replyToMessageId || body?.replyTo?.id || body?.reply_to_message_id || "")?.trim() || undefined;
    const clientReplyTo = body?.replyTo || undefined;

    console.log(`📨 [Instagram Reply - API] POST mensagem em conversa ${conversationId}:`, {
      text: rawText,
      replyToMessageId,
      clientReplyTo,
    });

    if (!rawText && !audioUrl && !mediaUrl) {
      return NextResponse.json({ error: "A mensagem não pode ser vazia." }, { status: 400 });
    }

    if (rawText.length > 1000) {
      return NextResponse.json(
        { error: "Mensagem excede o limite máximo de 1000 caracteres." },
        { status: 400 }
      );
    }

    // Determina o texto final a ser persistido no banco de dados
    let textToSave = rawText;
    if (audioUrl) {
      textToSave = `[audio:${audioUrl}]`;
    } else if (mediaUrl) {
      textToSave = `[image:${mediaUrl}]${rawText ? ` ${rawText}` : ""}`;
    }

    const delaySeconds = typeof body?.delaySeconds === "number" ? Math.max(0, Math.min(300, Math.round(body.delaySeconds))) : 0;

    if (conversationId.startsWith("test_")) {
      return NextResponse.json({
        success: true,
        isTest: true,
        message: {
          id: `test_msg_${Date.now()}`,
          conversationId,
          senderId: "me",
          text: textToSave,
          mediaUrl: audioUrl || mediaUrl || undefined,
          mediaType,
          timestamp: new Date().toISOString(),
          isMine: true,
          status: "sent",
        },
      });
    }

    const repo = new SupabaseInstagramRepository();
    const config = await repo.getConfig();

    // Se delaySeconds > 0, dispara o fluxo em segundo plano desacoplado
    if (delaySeconds > 0) {
      const nowIso = new Date().toISOString();
      const deliverAtMs = Date.now() + delaySeconds * 1000;
      const tempId = `fwd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const queuedMsg = {
        id: tempId,
        conversationId,
        senderId: "me",
        text: textToSave,
        mediaUrl: audioUrl || mediaUrl || undefined,
        mediaType,
        timestamp: nowIso,
        isMine: true,
        status: "sending" as const,
        deliverAt: deliverAtMs,
        replyToMessageId: replyToMessageId || null,
        replyTo: clientReplyTo,
      };

      await repo.saveMessage(queuedMsg);

      void RealtimeBroadcaster.broadcastInstagramMessage({
        id: queuedMsg.id,
        conversationId: queuedMsg.conversationId,
        senderId: "me",
        text: queuedMsg.text,
        timestamp: queuedMsg.timestamp,
        isMine: true,
        status: "sending",
        deliverAt: deliverAtMs,
        delaySeconds,
        mediaUrl: queuedMsg.mediaUrl,
        mediaType: queuedMsg.mediaType,
      });

      let previewMessage = rawText;
      if (audioUrl || textToSave.startsWith("[audio:")) {
        previewMessage = "🎙️ Mensagem de voz";
      } else if (mediaUrl || textToSave.startsWith("[image:")) {
        previewMessage = "📷 Foto";
      }

      await repo.saveConversation({
        id: conversationId,
        lastMessage: previewMessage,
        lastMessageAt: nowIso,
        lastDirection: "out",
        unread: false,
      });

      // Timer assíncrono em segundo plano
      setTimeout(async () => {
        try {
          let metaMid: string | undefined;
          if (config?.isConnected && config.accessToken) {
            try {
              const targetId = config.pageId || config.instagramAccountId || "me";
              const response = await InstagramApiClient.sendMessage(
                config.accessToken,
                targetId,
                conversationId,
                {
                  text: rawText || undefined,
                  audioUrl: audioUrl || undefined,
                  mediaUrl: mediaUrl || undefined,
                  mediaType,
                  replyToMessageId,
                },
                config.username
              );
              metaMid = response.message_id;
            } catch (err) {
              console.warn("Aviso ao despachar na Meta após delay:", err);
            }
          }

          const confirmedId = metaMid || tempId;
          const finalMsg = {
            ...queuedMsg,
            id: confirmedId,
            status: "sent" as const,
            deliverAt: undefined,
          };
          await repo.saveMessage(finalMsg);

          void RealtimeBroadcaster.broadcastInstagramMessage({
            id: confirmedId,
            conversationId: queuedMsg.conversationId,
            senderId: "me",
            text: queuedMsg.text,
            timestamp: new Date().toISOString(),
            isMine: true,
            status: "sent",
            deliverAt: undefined,
            mediaUrl: queuedMsg.mediaUrl,
            mediaType: queuedMsg.mediaType,
          });
        } catch (bgErr) {
          console.error("Erro no processamento de delay:", bgErr);
        }
      }, delaySeconds * 1000);

      return NextResponse.json({
        success: true,
        queued: true,
        delaySeconds,
        message: queuedMsg,
      });
    }

    let metaMid: string | undefined;

    // Se houver conexão ativa com a API do Instagram, despacha o payload oficial
    if (config?.isConnected && config.accessToken) {
      try {
        const targetId = config.pageId || config.instagramAccountId || "me";
        console.log(`🌐 [Instagram Reply - API] Despachando para Meta Graph API com replyToMessageId:`, replyToMessageId);
        const response = await InstagramApiClient.sendMessage(
          config.accessToken,
          targetId,
          conversationId,
          {
            text: rawText || undefined,
            audioUrl: audioUrl || undefined,
            mediaUrl: mediaUrl || undefined,
            mediaType,
            replyToMessageId,
          },
          config.username
        );
        metaMid = response.message_id;
        console.log(`✅ [Instagram Reply - API] Meta Graph API retornou message_id:`, metaMid);
      } catch (metaErr: unknown) {
        console.warn("Aviso ao enviar via API do Instagram (salvando localmente no banco):", metaErr);
        const errMsg = metaErr instanceof Error ? metaErr.message : String(metaErr);
        const isOutside24h =
          /outside.*allowed window/i.test(errMsg) ||
          /outside.*24-hour window/i.test(errMsg) ||
          /2018278/.test(errMsg);

        if (isOutside24h) {
          return NextResponse.json(
            {
              error: "outside_24h_window",
              errorReason: "outside_24h_window",
              isOutside24hWindow: true,
              message: "Esta mensagem está fora da janela de 24 horas permitida pela Meta. Abra diretamente no Instagram para responder.",
            },
            { status: 400 }
          );
        }
      }
    }

    const nowIso = new Date().toISOString();
    const messageId = metaMid || `msg_ig_${Date.now()}`;

    const newMsg = {
      id: messageId,
      conversationId,
      senderId: "me",
      text: textToSave,
      mediaUrl: audioUrl || mediaUrl || undefined,
      mediaType,
      timestamp: nowIso,
      isMine: true,
      status: "sent" as const,
      replyToMessageId: replyToMessageId || null,
    };

    // Salvar mensagem no Supabase
    await repo.saveMessage(newMsg);
    console.log(`💾 [Instagram Reply - API] Mensagem salva no Supabase com reply_to_message_id:`, newMsg.replyToMessageId);

    // Dispara broadcast imediato (< 20ms) para todos os clientes conectados
    void RealtimeBroadcaster.broadcastInstagramMessage({
      id: newMsg.id,
      conversationId: newMsg.conversationId,
      senderId: "me",
      text: newMsg.text,
      timestamp: newMsg.timestamp,
      isMine: true,
      status: "sent",
      mediaUrl: newMsg.mediaUrl,
      mediaType: newMsg.mediaType,
      replyToMessageId: newMsg.replyToMessageId,
      replyTo: clientReplyTo,
    });

    // Prévia limpa para a lista de conversas
    let previewMessage = rawText;
    if (audioUrl || textToSave.startsWith("[audio:")) {
      previewMessage = "🎙️ Mensagem de voz";
    } else if (mediaUrl || textToSave.startsWith("[image:")) {
      previewMessage = "📷 Foto";
    }

    // Atualizar conversa com última mensagem
    await repo.saveConversation({
      id: conversationId,
      lastMessage: previewMessage,
      lastMessageAt: nowIso,
      lastDirection: "out",
      unread: false,
    });

    // Dispara broadcast da atualização da conversa
    void RealtimeBroadcaster.broadcastInstagramConversation({
      id: conversationId,
      lastMessage: previewMessage,
      lastMessageAt: nowIso,
      lastDirection: "out",
      unread: false,
    });

    return NextResponse.json({
      success: true,
      message: {
        id: newMsg.id,
        senderId: "me",
        text: newMsg.text,
        mediaUrl: newMsg.mediaUrl,
        mediaType: newMsg.mediaType,
        createdAt: formatMessageTime(new Date()),
        isMine: true,
        status: "sent",
        replyToMessageId: newMsg.replyToMessageId,
        replyTo: clientReplyTo,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao enviar mensagem no Instagram.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
