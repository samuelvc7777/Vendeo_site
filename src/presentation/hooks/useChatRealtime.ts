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
  mediaType?: "image" | "audio" | "video";
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
  channel?: "instagram" | "whatsapp";
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
    | "instagram_reaction",
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
  onInstagramSeen,
  onInstagramReaction,
  onAutoPilotStateUpdate,
}: UseChatRealtimeProps) {
  const [isConnected, setIsConnected] = useState(false);
  const callbacksRef = useRef({
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramConversationInsert,
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
      onInstagramSeen,
      onInstagramReaction,
      onAutoPilotStateUpdate,
    };
  }, [
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramConversationInsert,
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
            if (processedMessageIdsRef.current.has(payload.id)) return;
            markMessageProcessed(payload.id);
            callbacksRef.current.onInstagramMessage?.(payload);
          } else if (type === "instagram_conversation_update" && payload.id) {
            callbacksRef.current.onInstagramConversationUpdate?.(payload);
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
          if (processedMessageIdsRef.current.has(payload.id)) return;
          markMessageProcessed(payload.id);
          callbacksRef.current.onInstagramMessage?.(payload);
        }
      )
      .on(
        "broadcast",
        { event: "instagram_conversation_update" },
        ({ payload }: { payload: RealtimeConversationUpdatePayload }) => {
          if (!payload || !payload.id) return;
          callbacksRef.current.onInstagramConversationUpdate?.(payload);
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
          if (processedMessageIdsRef.current.has(String(row.id))) return;
          markMessageProcessed(String(row.id));

          callbacksRef.current.onInstagramMessage?.({
            id: String(row.id),
            conversationId: String(row.conversation_id),
            senderId: String(row.sender_id || ""),
            text: String(row.text || ""),
            timestamp: row.timestamp || new Date().toISOString(),
            isMine: Boolean(row.is_mine),
            status: "sent",
            replyToMessageId: row.reply_to_message_id || null,
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

          callbacksRef.current.onInstagramConversationUpdate?.({
            id: String(row.id),
            channel: row.channel === "whatsapp" ? "whatsapp" : "instagram",
            lastMessage: row.last_message || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            unread: Boolean(row.unread),
            fullName: row.full_name || undefined,
            username: row.username || undefined,
            avatar: row.avatar || undefined,
            currentStageId: row.current_stage_id || null,
            isConverted: Boolean(row.is_converted),
            raffleStatus: normalizeRaffleCommercialStatus(row.raffle_status),
            aiAutoRespond: Boolean(row.ai_auto_respond),
          });
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

          callbacksRef.current.onInstagramConversationInsert?.({
            id: String(row.id),
            channel: row.channel === "whatsapp" ? "whatsapp" : "instagram",
            lastMessage: row.last_message || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            unread: Boolean(row.unread),
            fullName: row.full_name || undefined,
            username: row.username || undefined,
            avatar: row.avatar || undefined,
            currentStageId: row.current_stage_id || null,
            isConverted: Boolean(row.is_converted),
            raffleStatus: normalizeRaffleCommercialStatus(row.raffle_status),
            aiAutoRespond: Boolean(row.ai_auto_respond),
          });
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
