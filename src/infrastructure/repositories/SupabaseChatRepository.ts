import { IChatRepository } from "@/domain/repositories/IChatRepository";
import { Conversation, ChatMessage } from "@/domain/entities/Chat";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";
import { formatMessageTime } from "@/lib/utils";


const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80";

export class SupabaseChatRepository implements IChatRepository {
  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  async getConversations(): Promise<Conversation[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("instagram_conversations")
        .select("id, contact_id, display_name, full_name, username, last_message_at, last_direction, last_message_preview, last_message, avatar_url, avatar, is_restricted, unread_count, unread")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (error || !data) {
        console.error("Erro ao buscar conversas no Supabase:", error);
        return [];
      }

      return (data as any[]).map((c: any) => {
        const name = c.display_name || c.username || `Usuário ${c.contact_id.slice(-4)}`;

        let lastMessageTime = "";
        if (c.last_message_at) {
          const d = new Date(c.last_message_at);
          if (!isNaN(d.getTime())) {
            const now = new Date();
            const isToday =
              d.getDate() === now.getDate() &&
              d.getMonth() === now.getMonth() &&
              d.getFullYear() === now.getFullYear();

            lastMessageTime = isToday
              ? formatMessageTime(d)
              : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
          }

        }

        const isSentByMe = c.last_direction === "outbound";
        const preview = c.last_message_preview || "Conversa iniciada";
        const lastMessage = isSentByMe ? `Você: ${preview}` : preview;

        return {
          id: c.contact_id,
          participant: {
            id: c.contact_id,
            name,
            avatar: c.avatar_url || DEFAULT_AVATAR,
            verified: !c.is_restricted,
            isOnline: false,
          },
          lastMessage,
          lastMessageTime,
          unreadCount: c.unread_count || 0,
        };
      });
    } catch (err) {
      console.error("Erro ao carregar conversas do Instagram:", err);
      return [];
    }
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("instagram_messages")
        .select("id, contact_id, display_name, full_name, username, last_message_at, last_direction, last_message_preview, last_message, avatar_url, avatar, is_restricted, unread_count, unread")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error || !data) {
        console.error("Erro ao buscar mensagens no Supabase:", error);
        return [];
      }

      return (data as any[]).map((m: any) => {
        const isMine = m.direction === "outbound" || m.sender_id === "me";

        const timeStr = m.created_at ? formatMessageTime(m.created_at) : "Agora";


        return {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          senderName: isMine ? "Você" : "Cliente",
          text: m.text || (m.media_url ? "Mídia enviada" : ""),
          createdAt: timeStr || "Agora",
          isMine,
        };
      });
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
      return [];
    }
  }

  async sendMessage(conversationId: string, text: string): Promise<ChatMessage> {
    const client = this.getClient();
    if (!client) {
      throw new Error("Supabase indisponível");
    }

    const nowIso = new Date().toISOString();
    const newId = `msg_${Date.now()}`;

    await client.from("instagram_messages").insert({
      id: newId,
      conversation_id: conversationId,
      sender_id: "me",
      direction: "outbound",
      text,
      created_at: nowIso,
      received_at: nowIso,
      status: "sent",
    });

    await client
      .from("instagram_conversations")
      .update({
        last_message_preview: text,
        last_message_at: nowIso,
        last_direction: "outbound",
        updated_at: nowIso,
      })
      .eq("contact_id", conversationId);

    return {
      id: newId,
      conversationId,
      senderId: "me",
      senderName: "Você",
      text,
      createdAt: formatMessageTime(new Date()),
      isMine: true,

    };
  }

  async markAsRead(conversationId: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    await client
      .from("instagram_conversations")
      .update({ unread_count: 0 })
      .eq("contact_id", conversationId);
  }
}
