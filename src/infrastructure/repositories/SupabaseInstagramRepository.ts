import {
  InstagramConfig,
  InstagramConversation,
  InstagramMessage,
} from "@/domain/entities/Instagram";
import { IInstagramRepository } from "@/domain/repositories/IInstagramRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabaseInstagramRepository implements IInstagramRepository {
  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  async getConfig(): Promise<InstagramConfig | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("instagram_config")
        .select("*")
        .eq("id", "default")
        .single();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        accessToken: data.access_token || "",
        instagramAccountId: data.instagram_account_id || "",
        pageId: data.page_id,
        appSecret: data.app_secret,
        verifyToken: data.verify_token || "vendeo_ig_secret_token",
        username: data.username,
        name: data.name,
        profilePictureUrl: data.profile_picture_url,
        isConnected: Boolean(data.is_connected),
        updatedAt: data.updated_at,
      };
    } catch {
      return null;
    }
  }

  async saveConfig(config: Partial<InstagramConfig>): Promise<InstagramConfig> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase indisponível");

    const payload: Record<string, any> = {
      id: "default",
      updated_at: new Date().toISOString(),
    };

    if (config.accessToken !== undefined) payload.access_token = config.accessToken;
    if (config.instagramAccountId !== undefined) payload.instagram_account_id = config.instagramAccountId;
    if (config.pageId !== undefined) payload.page_id = config.pageId;
    if (config.appSecret !== undefined) payload.app_secret = config.appSecret;
    if (config.verifyToken !== undefined) payload.verify_token = config.verifyToken;
    if (config.username !== undefined) payload.username = config.username;
    if (config.name !== undefined) payload.name = config.name;
    if (config.profilePictureUrl !== undefined) payload.profile_picture_url = config.profilePictureUrl;
    if (config.isConnected !== undefined) payload.is_connected = config.isConnected;

    const { data, error } = await client
      .from("instagram_config")
      .upsert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao salvar configuração do Instagram: ${error?.message || "Desconhecido"}`);
    }

    return {
      id: data.id,
      accessToken: data.access_token || "",
      instagramAccountId: data.instagram_account_id || "",
      pageId: data.page_id,
      appSecret: data.app_secret,
      verifyToken: data.verify_token || "vendeo_ig_secret_token",
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      isConnected: Boolean(data.is_connected),
      updatedAt: data.updated_at,
    };
  }

  async disconnect(): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    await client
      .from("instagram_config")
      .update({
        access_token: null,
        is_connected: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");
  }

  async getConversations(limit = 300): Promise<InstagramConversation[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("instagram_conversations")
        .select(
          "id, username, full_name, avatar, last_message, last_message_at, last_direction, last_status, seen_at, unread, status, is_restricted, created_at, updated_at"
        )
        .neq("id", "__vault_data__")
        .neq("status", "vault")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      const validItems = data.filter(
        (item: any) => !item.id?.startsWith("__") && item.status !== "system" && item.status !== "vault"
      );

      return validItems.map((item: any) => ({
        id: item.id,
        username: item.username,
        fullName: item.full_name || undefined,
        avatar: item.avatar || undefined,
        lastMessage: item.last_message || undefined,
        lastMessageAt: item.last_message_at || undefined,
        lastDirection: item.last_direction || "in",
        lastStatus: item.last_status || undefined,
        seenAt: item.seen_at || undefined,
        unread: Boolean(item.unread),
        status: item.status || "active",
        isRestricted: Boolean(item.is_restricted),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
    } catch {
      return [];
    }
  }

  async saveConversation(conv: Partial<InstagramConversation> & { id: string }): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (conv.username !== undefined) updatePayload.username = conv.username;
    if (conv.fullName !== undefined) updatePayload.full_name = conv.fullName;
    if (conv.avatar !== undefined) updatePayload.avatar = conv.avatar;
    if (conv.lastMessage !== undefined) updatePayload.last_message = conv.lastMessage;
    if (conv.lastMessageAt !== undefined) updatePayload.last_message_at = conv.lastMessageAt;
    if (conv.lastDirection !== undefined) updatePayload.last_direction = conv.lastDirection;
    if (conv.lastStatus !== undefined) updatePayload.last_status = conv.lastStatus;
    if (conv.seenAt !== undefined) updatePayload.seen_at = conv.seenAt;
    if (conv.unread !== undefined) updatePayload.unread = conv.unread;
    if (conv.status !== undefined) updatePayload.status = conv.status;
    if (conv.isRestricted !== undefined) updatePayload.is_restricted = conv.isRestricted;

    // 1. Tenta atualizar a conversa caso ela já exista no banco
    const { data, error: updateError } = await client
      .from("instagram_conversations")
      .update(updatePayload)
      .eq("id", conv.id)
      .select("id");

    // 2. Se a conversa ainda não existia no banco, faz upsert garantindo os campos NOT NULL
    if (!data || data.length === 0) {
      const fullPayload = {
        id: conv.id,
        username: conv.username || `ig_${conv.id.slice(-6)}`,
        full_name: conv.fullName || conv.username || "Usuário Instagram",
        avatar: conv.avatar || "/images/default-avatar.svg",
        last_message: conv.lastMessage || null,
        last_message_at: conv.lastMessageAt || new Date().toISOString(),
        last_direction: conv.lastDirection || "in",
        unread: conv.unread ?? false,
        status: conv.status || "active",
        is_restricted: conv.isRestricted ?? false,
        ...updatePayload,
      };

      const { error: upsertError } = await client
        .from("instagram_conversations")
        .upsert(fullPayload, { onConflict: "id" });

      if (upsertError) {
        console.error("Erro ao fazer upsert em instagram_conversations:", upsertError);
      }
    } else if (updateError) {
      console.error("Erro ao atualizar instagram_conversations:", updateError);
    }
  }

  async getMessages(conversationId: string, limit = 500): Promise<InstagramMessage[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("instagram_messages")
        .select("*")
        .or(`conversation_id.eq.${conversationId},contact_id.eq.${conversationId}`)
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      const chronData = [...data].reverse();
      return chronData.map((item: any) => ({
        id: item.id,
        conversationId: item.conversation_id,
        senderId: item.sender_id,
        text: item.text,
        timestamp: item.timestamp,
        isMine: Boolean(item.is_mine),
        status: item.status || "sent",
        seenAt: item.seen_at ? item.seen_at : undefined,
        deliverAt: item.deliver_at ? new Date(item.deliver_at).getTime() : undefined,
        replyToMessageId: item.reply_to_message_id || null,
      }));
    } catch {
      return [];
    }
  }

  async saveMessage(msg: InstagramMessage): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    const payload: Record<string, any> = {
      id: msg.id,
      conversation_id: msg.conversationId,
      sender_id: msg.senderId,
      text: msg.text,
      timestamp: msg.timestamp || new Date().toISOString(),
      is_mine: msg.isMine,
      status: msg.status || "sent",
      reply_to_message_id: msg.replyToMessageId || null,
    };

    if (msg.seenAt) {
      payload.seen_at = msg.seenAt;
    }

    if (msg.deliverAt) {
      payload.deliver_at = new Date(msg.deliverAt).toISOString();
    }

    await client.from("instagram_messages").upsert(payload);
  }
}
