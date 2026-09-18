import { getSupabaseAdminClient } from "./server";
import { RealtimeChannel } from "@supabase/supabase-js";

let serverChannel: RealtimeChannel | null = null;
let isChannelSubscribed = false;

function getServerBroadcastChannel(): Promise<RealtimeChannel | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return Promise.resolve(null);

  if (serverChannel && isChannelSubscribed) {
    return Promise.resolve(serverChannel);
  }

  return new Promise((resolve) => {
    serverChannel = supabase.channel("vendeo_realtime_chat");
    serverChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        isChannelSubscribed = true;
        resolve(serverChannel);
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        isChannelSubscribed = false;
        resolve(null);
      }
    });

    // Timeout de segurança para não bloquear o ciclo de resposta HTTP
    setTimeout(() => {
      resolve(serverChannel);
    }, 1200);
  });
}

export interface BroadcastInstagramMessagePayload {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp: string;
  isMine: boolean;
  status: "sent" | "sending" | "seen" | "failed";
  seenAt?: string;
  deliverAt?: number;
  delaySeconds?: number;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video";
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
  };
}

export interface BroadcastInstagramConversationPayload {
  id: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastDirection?: "in" | "out" | "inbound" | "outbound";
  lastStatus?: string;
  seenAt?: string;
  unread?: boolean;
  fullName?: string;
  username?: string;
  avatar?: string;
}

export interface BroadcastInstagramSeenPayload {
  conversationId: string;
  watermark: number;
  seenAt: string;
}

export interface BroadcastTinderMessagePayload {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp: string;
  isMine: boolean;
  status: "sent" | "sending" | "failed";
  deliverAt?: number;
  delaySeconds?: number;
}

export interface BroadcastTinderConversationPayload {
  id: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastDirection?: string;
  lastStatus?: string;
  seenAt?: string;
}

export class RealtimeBroadcaster {
  static async broadcastInstagramMessage(payload: BroadcastInstagramMessagePayload): Promise<void> {
    try {
      const channel = await getServerBroadcastChannel();
      if (channel) {
        await channel.send({
          type: "broadcast",
          event: "instagram_message",
          payload,
        });
      }
    } catch (err) {
      console.warn("Aviso ao disparar broadcast de mensagem do Instagram:", err);
    }
  }

  static async broadcastInstagramSeen(payload: BroadcastInstagramSeenPayload): Promise<void> {
    try {
      const channel = await getServerBroadcastChannel();
      if (channel) {
        await channel.send({
          type: "broadcast",
          event: "instagram_seen",
          payload,
        });
      }
    } catch (err) {
      console.warn("Aviso ao disparar broadcast de visto do Instagram:", err);
    }
  }

  static async broadcastInstagramConversation(payload: BroadcastInstagramConversationPayload): Promise<void> {
    try {
      const channel = await getServerBroadcastChannel();
      if (channel) {
        await channel.send({
          type: "broadcast",
          event: "instagram_conversation_update",
          payload,
        });
      }
    } catch (err) {
      console.warn("Aviso ao disparar broadcast de conversa do Instagram:", err);
    }
  }

  static async broadcastTinderMessage(payload: BroadcastTinderMessagePayload): Promise<void> {
    try {
      const channel = await getServerBroadcastChannel();
      if (channel) {
        await channel.send({
          type: "broadcast",
          event: "tinder_message",
          payload,
        });
      }
    } catch (err) {
      console.warn("Aviso ao disparar broadcast de mensagem do Tinder:", err);
    }
  }

  static async broadcastTinderConversation(payload: BroadcastTinderConversationPayload): Promise<void> {
    try {
      const channel = await getServerBroadcastChannel();
      if (channel) {
        await channel.send({
          type: "broadcast",
          event: "tinder_conversation_update",
          payload,
        });
      }
    } catch (err) {
      console.warn("Aviso ao disparar broadcast de conversa do Tinder:", err);
    }
  }
}
