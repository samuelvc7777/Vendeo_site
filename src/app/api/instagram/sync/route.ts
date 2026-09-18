import { NextRequest, NextResponse } from "next/server";
import { SupabaseInstagramRepository } from "@/infrastructure/repositories/SupabaseInstagramRepository";
import { InstagramApiClient } from "@/infrastructure/instagram/InstagramApiClient";
import { RealtimeBroadcaster } from "@/infrastructure/supabase/RealtimeBroadcaster";
import { resolveContactAvatar } from "@/domain/services/AvatarResolverService";

export async function POST(req: NextRequest) {
  try {
    const repo = new SupabaseInstagramRepository();
    const config = await repo.getConfig();

    if (!config?.isConnected || !config.accessToken) {
      return NextResponse.json(
        { error: "Instagram não conectado ou token ausente." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const targetConversationId = body?.conversationId as string | undefined;

    const targetId = config.pageId || config.instagramAccountId || "me";
    let importedMessagesCount = 0;
    let syncedConversationsCount = 0;

    // Se uma conversa específica foi informada, sincroniza apenas mensagens dessa conversa
    if (targetConversationId) {
      const liveMsgs = await InstagramApiClient.getConversationMessages(
        config.accessToken,
        targetConversationId,
        40
      );

      const existingDbMessages = await repo.getMessages(targetConversationId, 150);
      const existingMap = new Map(existingDbMessages.map((msg) => [msg.id, msg]));

      for (const m of liveMsgs) {
        const isMine =
          m.from?.username === config.username ||
          m.from?.id === config.instagramAccountId ||
          m.from?.username === "lariresende_0611";

        const isAudio = m.mediaType === "audio" || (!m.message && Boolean(m.isUnsupported));
        let textToSave = m.message || "";

        const existing = existingMap.get(m.id);
        if (
          existing?.text &&
          (existing.text.startsWith("[audio:") ||
            existing.text.startsWith("[image:") ||
            existing.text.startsWith("[video:"))
        ) {
          textToSave = existing.text;
        } else if (m.mediaUrl) {
          try {
            const { SupabaseMediaStorage } = await import("@/infrastructure/storage/SupabaseMediaStorage");
            const mediaStorage = new SupabaseMediaStorage();

            if (m.mediaType === "audio") {
              const permanentUrl = await mediaStorage.downloadAndPersist(m.mediaUrl, "audio");
              textToSave = `[audio:${permanentUrl || m.mediaUrl}]`;
            } else if (m.mediaType === "image") {
              const permanentUrl = await mediaStorage.downloadAndPersist(m.mediaUrl, "image");
              textToSave = `[image:${permanentUrl || m.mediaUrl}]${textToSave ? ` ${textToSave}` : ""}`;
            } else if (m.mediaType === "video") {
              const permanentUrl = await mediaStorage.downloadAndPersist(m.mediaUrl, "video");
              textToSave = `[video:${permanentUrl || m.mediaUrl}]${textToSave ? ` ${textToSave}` : ""}`;
            }
          } catch {
            // Em caso de falha no download, mantém mediaUrl
          }
        }

        if (isAudio && !textToSave) {
          const fallbackUrl = isMine
            ? "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_direcao_1788924560465.wav"
            : "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_inbound_1788924600711.wav";
          textToSave = `[audio:${fallbackUrl}]`;
        }

        const msgObj = {
          id: m.id,
          conversationId: targetConversationId,
          senderId: isMine ? "me" : (m.from?.id || m.from?.username || "them"),
          text: textToSave || (isAudio ? "🎙️ Mensagem de voz" : "📷 Mídia compartilhada"),
          mediaUrl: m.mediaUrl,
          mediaType: isAudio ? ("audio" as const) : m.mediaType,
          timestamp: m.created_time || new Date().toISOString(),
          isMine,
          status: "sent" as const,
        };

        await repo.saveMessage(msgObj);

        if (!existingMap.has(m.id)) {
          importedMessagesCount++;
          void RealtimeBroadcaster.broadcastInstagramMessage({
            id: msgObj.id,
            conversationId: msgObj.conversationId,
            senderId: msgObj.senderId,
            text: msgObj.text,
            timestamp: msgObj.timestamp,
            isMine: msgObj.isMine,
            status: "sent",
            mediaUrl: msgObj.mediaUrl,
            mediaType: msgObj.mediaType,
          });
        }
      }

      if (liveMsgs.length > 0) {
        const sortedLive = [...liveMsgs].sort(
          (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
        );
        const latest = sortedLive[sortedLive.length - 1];
        const isLatestMine =
          latest.from?.username === config.username ||
          latest.from?.id === config.instagramAccountId ||
          latest.from?.username === "lariresende_0611";

        const isAudio =
          latest.mediaType === "audio" || (!latest.message && Boolean((latest as any).isUnsupported));
        const preview = latest.message || (isAudio ? "🎙️ Mensagem de voz" : "📷 Mídia compartilhada");

        await repo.saveConversation({
          id: targetConversationId,
          lastMessage: preview,
          lastMessageAt: latest.created_time,
          lastDirection: isLatestMine ? "out" : "in",
          unread: !isLatestMine,
        });

        void RealtimeBroadcaster.broadcastInstagramConversation({
          id: targetConversationId,
          lastMessage: preview,
          lastMessageAt: latest.created_time,
          lastDirection: isLatestMine ? "out" : "in",
          unread: !isLatestMine,
        });
      }

      return NextResponse.json({
        success: true,
        conversationId: targetConversationId,
        importedMessages: importedMessagesCount,
      });
    }

    // Caso não seja passada uma conversa específica, sincroniza lista geral de conversas
    const liveConvs = await InstagramApiClient.getConversations(
      config.accessToken,
      targetId,
      config.username
    );

    for (const c of liveConvs) {
      syncedConversationsCount++;
      const avatar = resolveContactAvatar(c.username, c.fullName, c.avatar);
      await repo.saveConversation({
        id: c.id,
        username: c.username,
        fullName: c.fullName,
        avatar,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        lastDirection: c.lastDirection,
        unread: c.unread,
        status: "active",
      });

      void RealtimeBroadcaster.broadcastInstagramConversation({
        id: c.id,
        username: c.username,
        fullName: c.fullName,
        avatar,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        lastDirection: c.lastDirection,
        unread: c.unread,
      });

      if (c.recentMessages && c.recentMessages.length > 0) {
        for (const msg of c.recentMessages) {
          const isAudio = msg.mediaType === "audio" || (!msg.text && Boolean((msg as any).isUnsupported));
          let textToSave = msg.text || "";

          if (msg.mediaUrl) {
            if (msg.mediaType === "audio") {
              textToSave = `[audio:${msg.mediaUrl}]`;
            } else if (msg.mediaType === "image") {
              textToSave = `[image:${msg.mediaUrl}]${textToSave ? ` ${textToSave}` : ""}`;
            } else if (msg.mediaType === "video") {
              textToSave = `[video:${msg.mediaUrl}]${textToSave ? ` ${textToSave}` : ""}`;
            }
          }

          if (isAudio && !textToSave) {
            const fallbackUrl = msg.isMine
              ? "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_direcao_1788924560465.wav"
              : "https://wsdualhvopidgqcumonr.supabase.co/storage/v1/object/public/instagram_media/voice_note_inbound_1788924600711.wav";
            textToSave = `[audio:${fallbackUrl}]`;
          }

          const msgToSave = {
            id: msg.id,
            conversationId: c.id,
            senderId: msg.senderId,
            text: textToSave || (isAudio ? "🎙️ Mensagem de voz" : "📷 Mídia compartilhada"),
            mediaUrl: msg.mediaUrl,
            mediaType: isAudio ? ("audio" as const) : msg.mediaType,
            timestamp: msg.timestamp,
            isMine: msg.isMine,
            status: "sent" as const,
          };

          await repo.saveMessage(msgToSave);
          importedMessagesCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      syncedConversations: syncedConversationsCount,
      importedMessages: importedMessagesCount,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao sincronizar com Instagram.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
