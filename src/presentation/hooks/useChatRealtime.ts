import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { AutoPilotChatState } from "@/domain/entities/AutoPilot";
import {
  RaffleCommercialStatus,
  normalizeRaffleCommercialStatus,
} from "@/domain/entities/RaffleStatus";

export interface RealtimeMessagePayload {
  id: string;
  oldId?: string;
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
  mediaType?: "image" | "audio" | "video" | "sticker";
  audio_transcript?: string;
  audioTranscript?: string;
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
  };
}

export interface RealtimeConversationUpdatePayload {
  id: string;
  channel?: "instagram" | "whatsapp2" | "tinder";
  lastMessage?: string;
  lastMessageAt?: string;
  lastDirection?: "in" | "out" | "inbound" | "outbound";
  lastStatus?: string;
  seenAt?: string;
  unread?: boolean;
  fullName?: string;
  username?: string;
  avatar?: string;
  currentStageId?: string | null;
  isConverted?: boolean;
  raffleStatus?: RaffleCommercialStatus;
  aiAutoRespond?: boolean;
}

export interface RealtimeSeenPayload {
  conversationId: string;
  watermark: number;
  seenAt: string;
}

export interface RealtimeInstagramReactionPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  action: "react" | "unreact";
  emoji?: string | null;
  reactedAt: string;
}

interface UseChatRealtimeProps {
  onInstagramMessage?: (msg: RealtimeMessagePayload) => void;
  onInstagramConversationUpdate?: (conv: RealtimeConversationUpdatePayload) => void;
  onInstagramConversationInsert?: (conv: RealtimeConversationUpdatePayload) => void;
  onWhatsApp2ConversationUpdate?: (conv: RealtimeConversationUpdatePayload) => void;
  onWhatsApp2ConversationInsert?: (conv: RealtimeConversationUpdatePayload) => void;
  onTinderMessage?: (msg: RealtimeMessagePayload) => void;
  onTinderConversationUpdate?: (conv: RealtimeConversationUpdatePayload) => void;
  tinderUserId?: string;
  onInstagramSeen?: (payload: RealtimeSeenPayload) => void;
  onInstagramReaction?: (payload: RealtimeInstagramReactionPayload) => void;
  onAutoPilotStateUpdate?: (
    payload: Partial<AutoPilotChatState> & { conversationId: string; timestamp?: string }
  ) => void;
}

export function notifyLocalTabs(
  type:
    | "instagram_message"
    | "instagram_conversation_update"
    | "instagram_seen"
    | "instagram_reaction"
    | "tinder_message"
    | "tinder_conversation_update",
  payload: any
) {
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const channel = new BroadcastChannel("vendeo_chat_channel");
      channel.postMessage({ type, payload });
      channel.close();
    } catch {
      // Canal local indisponível.
    }
  }
}

export function useChatRealtime({
  onInstagramMessage,
  onInstagramConversationUpdate,
  onInstagramConversationInsert,
  onWhatsApp2ConversationUpdate,
  onWhatsApp2ConversationInsert,
  onTinderMessage,
  onTinderConversationUpdate,
  tinderUserId,
  onInstagramSeen,
  onInstagramReaction,
  onAutoPilotStateUpdate,
}: UseChatRealtimeProps) {
  const [isConnected, setIsConnected] = useState(false);
  const tinderUserIdRef = useRef<string | null>(tinderUserId || null);
  useEffect(() => {
    if (tinderUserId) {
      tinderUserIdRef.current = tinderUserId;
    }
  }, [tinderUserId]);

  const callbacksRef = useRef({
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramConversationInsert,
    onWhatsApp2ConversationUpdate,
    onWhatsApp2ConversationInsert,
    onTinderMessage,
    onTinderConversationUpdate,
    onInstagramSeen,
    onInstagramReaction,
    onAutoPilotStateUpdate,
  });
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    callbacksRef.current = {
      onInstagramMessage,
      onInstagramConversationUpdate,
      onInstagramConversationInsert,
      onWhatsApp2ConversationUpdate,
      onWhatsApp2ConversationInsert,
      onTinderMessage,
      onTinderConversationUpdate,
      onInstagramSeen,
      onInstagramReaction,
      onAutoPilotStateUpdate,
    };
  }, [
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramConversationInsert,
    onWhatsApp2ConversationUpdate,
    onWhatsApp2ConversationInsert,
    onTinderMessage,
    onTinderConversationUpdate,
    onInstagramSeen,
    onInstagramReaction,
    onAutoPilotStateUpdate,
  ]);

  const markMessageProcessed = (id: string) => {
    processedMessageIdsRef.current.add(id);
    if (processedMessageIdsRef.current.size > 200) {
      const items = Array.from(processedMessageIdsRef.current);
      processedMessageIdsRef.current = new Set(items.slice(-100));
    }
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let localChannel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        localChannel = new BroadcastChannel("vendeo_chat_channel");
        localChannel.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (!payload) return;

          if (type === "instagram_message" && payload.id) {
            if (
              String(payload.conversationId || "").startsWith("wa2:") ||
              String(payload.conversationId || "").startsWith("wa:")
            ) return;
            if (processedMessageIdsRef.current.has(payload.id)) return;
            markMessageProcessed(payload.id);
            callbacksRef.current.onInstagramMessage?.(payload);
          } else if (type === "tinder_message" && payload.id) {
            if (processedMessageIdsRef.current.has(payload.id)) return;
            markMessageProcessed(payload.id);
            callbacksRef.current.onTinderMessage?.(payload);
          } else if (type === "tinder_conversation_update" && payload.id) {
            callbacksRef.current.onTinderConversationUpdate?.(payload);
          } else if (type === "instagram_conversation_update" && payload.id) {
            if (payload.channel === "whatsapp2" || String(payload.id).startsWith("wa2:")) {
              callbacksRef.current.onWhatsApp2ConversationUpdate?.(payload);
            } else if (payload.channel === "tinder" || String(payload.id).startsWith("tinder:")) {
              callbacksRef.current.onTinderConversationUpdate?.(payload);
            } else if ((payload as any).channel !== "whatsapp" && !String(payload.id).startsWith("wa:")) {
              callbacksRef.current.onInstagramConversationUpdate?.(payload);
            }
          } else if (type === "instagram_seen" && payload.conversationId) {
            callbacksRef.current.onInstagramSeen?.(payload);
          } else if (
            type === "instagram_reaction" &&
            payload.conversationId &&
            payload.messageId
          ) {
            callbacksRef.current.onInstagramReaction?.(payload);
          }
        };
      } catch {
        // BroadcastChannel não suportado ou bloqueado.
      }
    }

    const channel = supabase
      .channel("vendeo_realtime_chat", {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        "broadcast",
        { event: "instagram_message" },
        ({ payload }: { payload: RealtimeMessagePayload }) => {
          if (!payload || !payload.id || !payload.conversationId) return;
          if (
            String(payload.conversationId).startsWith("wa2:") ||
            String(payload.conversationId).startsWith("wa:")
          ) return;
          if (processedMessageIdsRef.current.has(payload.id)) return;
          markMessageProcessed(payload.id);
          callbacksRef.current.onInstagramMessage?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "tinder_message" },
        ({ payload }: { payload: RealtimeMessagePayload }) => {
          if (!payload || !payload.id || !payload.conversationId) return;
          if (processedMessageIdsRef.current.has(payload.id)) return;
          markMessageProcessed(payload.id);
          callbacksRef.current.onTinderMessage?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "tinder_conversation_update" },
        ({ payload }: { payload: RealtimeConversationUpdatePayload }) => {
          if (!payload || !payload.id) return;
          callbacksRef.current.onTinderConversationUpdate?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "instagram_conversation_update" },
        ({ payload }: { payload: RealtimeConversationUpdatePayload }) => {
          if (!payload || !payload.id) return;
          if (payload.channel === "whatsapp2" || String(payload.id).startsWith("wa2:")) {
            callbacksRef.current.onWhatsApp2ConversationUpdate?.(payload);
          } else if (payload.channel === "tinder" || String(payload.id).startsWith("tinder:")) {
            callbacksRef.current.onTinderConversationUpdate?.(payload);
          } else if ((payload as any).channel !== "whatsapp" && !String(payload.id).startsWith("wa:")) {
            callbacksRef.current.onInstagramConversationUpdate?.(payload);
          }
        }
      )
      .on(
        "broadcast",
        { event: "instagram_seen" },
        ({ payload }: { payload: RealtimeSeenPayload }) => {
          if (!payload || !payload.conversationId) return;
          callbacksRef.current.onInstagramSeen?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "instagram_reaction" },
        ({ payload }: { payload: RealtimeInstagramReactionPayload }) => {
          if (!payload || !payload.conversationId || !payload.messageId) return;
          callbacksRef.current.onInstagramReaction?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "autopilot_state_update" },
        ({ payload }: { payload: any }) => {
          if (!payload || !payload.conversationId) return;
          callbacksRef.current.onAutoPilotStateUpdate?.(payload);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autopilot_chat_states" },
        (payload: any) => {
          const row = payload?.new;
          if (!row?.conversation_id || !row?.state) return;
          callbacksRef.current.onAutoPilotStateUpdate?.({
            ...row.state,
            conversationId: String(row.conversation_id),
            isEnabled: Boolean(row.is_enabled),
            status: row.status || row.state.status,
            stateUpdatedAt: row.state_updated_at || row.state.stateUpdatedAt,
            stateRevision: Number(row.state_revision || row.state.stateRevision || 0),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instagram_messages",
        },
        (payload: any) => {
          const row = payload?.new;
          if (!row || !row.id || !row.conversation_id) return;
          if (
            row.channel === "whatsapp2" ||
            row.channel === "whatsapp" ||
            String(row.conversation_id).startsWith("wa2:") ||
            String(row.conversation_id).startsWith("wa:")
          ) {
            return;
          }
          if (processedMessageIdsRef.current.has(String(row.id))) return;
          markMessageProcessed(String(row.id));

          if (row.channel === "tinder" || String(row.conversation_id).startsWith("tinder:")) {
            callbacksRef.current.onTinderMessage?.({
              id: String(row.id),
              conversationId: String(row.conversation_id),
              senderId: String(row.sender_id || ""),
              text: String(row.text || ""),
              timestamp: row.timestamp || new Date().toISOString(),
              isMine: Boolean(row.is_mine),
              status: "sent",
              mediaUrl: row.media_url || undefined,
              mediaType: row.media_type || undefined,
              replyToMessageId: row.reply_to_message_id || null,
            });
            return;
          }

          callbacksRef.current.onInstagramMessage?.({
            id: String(row.id),
            conversationId: String(row.conversation_id),
            senderId: String(row.sender_id || ""),
            text: String(row.text || ""),
            timestamp: row.timestamp || new Date().toISOString(),
            isMine: Boolean(row.is_mine),
            status: "sent",
            mediaUrl: row.media_url || undefined,
            mediaType: row.media_type || undefined,
            replyToMessageId: row.reply_to_message_id || null,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tinder_messages",
        },
        (payload: any) => {
          const row = payload?.new;
          if (!row || !row.id || !row.match_id) return;
          if (processedMessageIdsRef.current.has(String(row.id))) return;
          markMessageProcessed(String(row.id));

          const isMine =
            row.sender_id === "me" ||
            Boolean(tinderUserIdRef.current && row.sender_id === tinderUserIdRef.current);

          callbacksRef.current.onTinderMessage?.({
            id: String(row.id),
            conversationId: String(row.match_id),
            senderId: isMine ? "me" : String(row.sender_id || ""),
            text: String(row.message || ""),
            timestamp: row.sent_date || row.created_at || new Date().toISOString(),
            isMine,
            status: "sent",
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tinder_conversations",
        },
        (payload: any) => {
          const row = payload?.new;
          if (!row || !row.match_id) return;

          callbacksRef.current.onTinderConversationUpdate?.({
            id: String(row.match_id),
            channel: "tinder",
            lastMessage: row.last_message_preview || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            fullName: row.name || undefined,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "instagram_conversations",
        },
        (payload: any) => {
          const row = payload?.new;
          if (
            !row ||
            !row.id ||
            String(row.id).startsWith("__") ||
            row.status === "system" ||
            row.status === "vault"
          ) {
            return;
          }

          if (row.channel === "whatsapp" || String(row.id).startsWith("wa:")) return;
          const normalizedChannel: "instagram" | "whatsapp2" | "tinder" =
            row.channel === "whatsapp2"
              ? "whatsapp2"
              : row.channel === "tinder"
              ? "tinder"
              : "instagram";
          const conversationPayload: RealtimeConversationUpdatePayload = {
            id: String(row.id),
            channel: normalizedChannel,
            lastMessage: row.last_message || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            lastStatus: row.last_status || undefined,
            seenAt: row.seen_at || undefined,
            unread: Boolean(row.unread),
            fullName: row.full_name || undefined,
            username: row.username || undefined,
            avatar: row.avatar_url || row.avatar || undefined,
            currentStageId: row.current_stage_id || null,
            isConverted: Boolean(row.is_converted),
            raffleStatus: normalizeRaffleCommercialStatus(row.raffle_status),
            aiAutoRespond: Boolean(row.ai_auto_respond),
          };

          if (normalizedChannel === "whatsapp2" || String(row.id).startsWith("wa2:")) {
            callbacksRef.current.onWhatsApp2ConversationUpdate?.(conversationPayload);
          } else if (normalizedChannel === "tinder" || String(row.id).startsWith("tinder:")) {
            callbacksRef.current.onTinderConversationUpdate?.(conversationPayload);
          } else {
            callbacksRef.current.onInstagramConversationUpdate?.(conversationPayload);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instagram_conversations",
        },
        (payload: any) => {
          const row = payload?.new;
          if (
            !row ||
            !row.id ||
            String(row.id).startsWith("__") ||
            row.status === "system" ||
            row.status === "vault"
          ) {
            return;
          }

          if (row.channel === "whatsapp" || String(row.id).startsWith("wa:")) return;
          const normalizedChannel: "instagram" | "whatsapp2" | "tinder" =
            row.channel === "whatsapp2"
              ? "whatsapp2"
              : row.channel === "tinder"
              ? "tinder"
              : "instagram";
          const conversationPayload: RealtimeConversationUpdatePayload = {
            id: String(row.id),
            channel: normalizedChannel,
            lastMessage: row.last_message || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            lastStatus: row.last_status || undefined,
            seenAt: row.seen_at || undefined,
            unread: Boolean(row.unread),
            fullName: row.full_name || undefined,
            username: row.username || undefined,
            avatar: row.avatar_url || row.avatar || undefined,
            currentStageId: row.current_stage_id || null,
            isConverted: Boolean(row.is_converted),
            raffleStatus: normalizeRaffleCommercialStatus(row.raffle_status),
            aiAutoRespond: Boolean(row.ai_auto_respond),
          };

          if (normalizedChannel === "whatsapp2" || String(row.id).startsWith("wa2:")) {
            callbacksRef.current.onWhatsApp2ConversationInsert?.(conversationPayload);
          } else if (normalizedChannel === "tinder" || String(row.id).startsWith("tinder:")) {
            callbacksRef.current.onTinderConversationUpdate?.(conversationPayload);
          } else {
            callbacksRef.current.onInstagramConversationInsert?.(conversationPayload);
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          setIsConnected(true);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setIsConnected(false);
        }
      });

    return () => {
      if (localChannel) {
        try {
          localChannel.close();
        } catch {
          // Ignora.
        }
      }
      supabase.removeChannel(channel);
    };
  }, []);

  return { isRealtimeConnected: isConnected };
}
