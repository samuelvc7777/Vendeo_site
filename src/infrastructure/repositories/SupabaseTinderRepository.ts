import {
  ITinderRepository,
  TinderMatchItem,
  TinderMessageItem,
} from "@/domain/repositories/ITinderRepository";
import { TinderSession } from "@/domain/entities/Tinder";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";
import { formatMessageTime } from "@/lib/utils";


export class SupabaseTinderRepository implements ITinderRepository {
  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  async getSession(): Promise<TinderSession | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("tinder_config")
        .select("*")
        .eq("id", "default")
        .single();

      if (error || !data || !(data as any).auth_token) {
        return null;
      }

      const row = data as any;
      return {
        token: row.auth_token,
        isConnected: true,
        profile: {
          id: row.user_id || "default_user",
          name: row.user_name || "Larissa",
          photos: row.avatar_url ? [{ id: "1", url: row.avatar_url }] : [],
          isVerified: true,
        },
        connectedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  async connect(token: string): Promise<TinderSession> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase indisponível");

    const nowIso = new Date().toISOString();
    await client.from("tinder_config").upsert({
      id: "default",
      auth_token: token,
      updated_at: nowIso,
    });

    return {
      token,
      isConnected: true,
      profile: {
        id: "user_connected",
        name: "Larissa",
        photos: [],
        isVerified: true,
      },
      connectedAt: nowIso,
    };
  }

  async disconnect(): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    await client
      .from("tinder_config")
      .update({ auth_token: null, updated_at: new Date().toISOString() })
      .eq("id", "default");
  }

  async getMatches(): Promise<TinderMatchItem[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("tinder_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (error || !data) {
        console.error("Erro ao buscar matches no Supabase:", error);
        return [];
      }

      return (data as any[]).map((m) => {
        let ageStr = "";
        if (m.birth_date) {
          const birthYear = new Date(m.birth_date).getFullYear();
          if (!isNaN(birthYear)) {
            const age = new Date().getFullYear() - birthYear;
            ageStr = `, ${age}`;
          }
        }

        let avatarUrl = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80";
        if (Array.isArray(m.photos) && m.photos.length > 0) {
          const firstPhoto = m.photos[0];
          if (typeof firstPhoto === "string") {
            avatarUrl = firstPhoto;
          } else if (typeof firstPhoto === "object" && firstPhoto !== null) {
            avatarUrl = firstPhoto.url || avatarUrl;
          }
        }

        let lastActive = "";
        if (m.last_message_at || m.created_at) {
          const d = new Date(m.last_message_at || m.created_at);
          if (!isNaN(d.getTime())) {
            const now = new Date();
            const isToday =
              d.getDate() === now.getDate() &&
              d.getMonth() === now.getMonth() &&
              d.getFullYear() === now.getFullYear();

            lastActive = isToday
              ? formatMessageTime(d)
              : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
          }

        }

        const isSentByMe = m.last_direction === "outbound";
        const hasPreview = Boolean(m.last_message_preview);
        const isNewMatch = !hasPreview && m.status === "Novo";

        let displayLastMessage = "Novo Match";
        if (hasPreview && m.last_message_preview) {
          displayLastMessage = isSentByMe
            ? `Você: ${m.last_message_preview}`
            : m.last_message_preview;
        }

        return {
          id: m.match_id,
          username: (m.name || "match").toLowerCase().replace(/\s+/g, "_"),
          fullName: `${m.name || "Match"}${ageStr}`,
          avatar: avatarUrl,
          isOnline: false,
          lastActive: lastActive || "Recente",
          lastMessage: displayLastMessage,
          unread: !isSentByMe && hasPreview,
          type: "tinder" as const,
          lastSender: (isSentByMe ? "me" : "them") as "me" | "them",
          isNewMatch,
          lastMessageAt: m.last_message_at || m.created_at || undefined,
        };
      });
    } catch (err) {
      console.error("Erro ao carregar matches:", err);
      return [];
    }
  }

  async getMessages(matchId: string): Promise<TinderMessageItem[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("tinder_messages")
        .select("*")
        .eq("match_id", matchId)
        .order("sent_date", { ascending: true })
        .limit(200);

      if (error || !data) {
        return [];
      }

      const session = await this.getSession();
      const myUserId = session?.profile?.id || "6a8451cb13ef7556bbdaa40e";

      return (data as any[]).map((m) => {
        const timeStr = m.sent_date ? formatMessageTime(m.sent_date) : "Agora";
        const isMine = m.sender_id === myUserId || m.sender_id === "me";

        return {
          id: m.id,
          senderId: m.sender_id,
          text: m.message,
          createdAt: timeStr,
          isMine,
        };
      });

    } catch (err) {
      console.error("Erro ao carregar mensagens do Tinder:", err);
      return [];
    }
  }

  async sendMessage(matchId: string, text: string): Promise<TinderMessageItem> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase indisponível");

    const nowIso = new Date().toISOString();
    const newId = `msg_tinder_${Date.now()}`;
    const session = await this.getSession();
    const myUserId = session?.profile?.id || "6a8451cb13ef7556bbdaa40e";

    await client.from("tinder_messages").insert({
      id: newId,
      match_id: matchId,
      sender_id: myUserId,
      message: text,
      sent_date: nowIso,
      created_at: nowIso,
    });

    await client
      .from("tinder_conversations")
      .update({
        last_message_preview: text,
        last_message_at: nowIso,
        last_direction: "outbound",
        updated_at: nowIso,
      })
      .eq("match_id", matchId);

    return {
      id: newId,
      senderId: myUserId,
      text,
      createdAt: formatMessageTime(new Date()),
      isMine: true,

    };
  }
}
