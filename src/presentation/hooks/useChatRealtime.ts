import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { AutoPilotChatState } from "@/domain/entities/AutoPilot";

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

export interface RealtimeSeenPayload {
  conversationId: string;
  watermark: number;
  seenAt: string;
}

interface UseChatRealtimeProps {
  onInstagramMessage?: (msg: RealtimeMessagePayload) => void;
  onInstagramConversationUpdate?: (conv: RealtimeConversationUpdatePayload) => void;
  onInstagramSeen?: (payload: RealtimeSeenPayload) => void;
  onTinderMessage?: (msg: RealtimeMessagePayload) => void;
  onTinderConversationUpdate?: (conv: RealtimeConversationUpdatePayload) => void;
  onAutoPilotStateUpdate?: (payload: Partial<AutoPilotChatState> & { conversationId: string; timestamp?: string }) => void;
  tinderUserId?: string;
}

// Utilitário client-side para notificar instantaneamente outras abas no mesmo navegador
export function notifyLocalTabs(
  type:
    | "instagram_message"
    | "instagram_conversation_update"
    | "instagram_seen"
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
      // Ignora silenciosamente se o canal local não estiver disponível
    }
  }
}

export function useChatRealtime({
  onInstagramMessage,
  onInstagramConversationUpdate,
  onInstagramSeen,
  onTinderMessage,
  onTinderConversationUpdate,
  onAutoPilotStateUpdate,
  tinderUserId,
}: UseChatRealtimeProps) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const callbacksRef = useRef({
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramSeen,
    onTinderMessage,
    onTinderConversationUpdate,
    onAutoPilotStateUpdate,
  });

  const tinderUserIdRef = useRef<string | null>(tinderUserId || null);
  useEffect(() => {
    if (tinderUserId) {
      tinderUserIdRef.current = tinderUserId;
    }
  }, [tinderUserId]);

  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    callbacksRef.current = {
      onInstagramMessage,
      onInstagramConversationUpdate,
      onInstagramSeen,
      onTinderMessage,
      onTinderConversationUpdate,
      onAutoPilotStateUpdate,
    };
  }, [
    onInstagramMessage,
    onInstagramConversationUpdate,
    onInstagramSeen,
    onTinderMessage,
    onTinderConversationUpdate,
    onAutoPilotStateUpdate,
  ]);

  const markMessageProcessed = (id: string) => {
    processedMessageIdsRef.current.add(id);
    if (processedMessageIdsRef.current.size > 200) {
      const arr = Array.from(processedMessageIdsRef.current);
      processedMessageIdsRef.current = new Set(arr.slice(-100));
    }
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    // Busca antecipada do user_id do Tinder para identificação atômica de mensagens próprias
    supabase
      .from("tinder_config")
      .select("user_id")
      .eq("id", "default")
      .maybeSingle()
      .then((res: any) => {
        if (res?.data?.user_id) {
          tinderUserIdRef.current = res.data.user_id;
        }
      })
      .catch(() => {});

    // 1. CANAL DE BROADCAST LOCAL (Mesmo navegador, abas diferentes)
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
          } else if (type === "tinder_message" && payload.id) {
            if (processedMessageIdsRef.current.has(payload.id)) return;
            markMessageProcessed(payload.id);
            callbacksRef.current.onTinderMessage?.(payload);
          } else if (type === "tinder_conversation_update" && payload.id) {
            callbacksRef.current.onTinderConversationUpdate?.(payload);
          }
        };
      } catch {
        // BroadcastChannel não suportado ou bloqueado
      }
    }

    // 2. CANAL WEBSOCKET SUPABASE REALTIME (BROADCAST + POSTGRES CHANGES)
    const channel = supabase
      .channel("vendeo_realtime_chat", {
        config: {
          broadcast: { self: true },
        },
      })
      // A. SUPABASE BROADCAST (Latência sub-20ms garantida)
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
        { event: "autopilot_state_update" },
        ({ payload }: { payload: any }) => {
          if (!payload || !payload.conversationId) return;
          callbacksRef.current.onAutoPilotStateUpdate?.(payload);
        }
      )
      // B. POSTGRES CHANGES (Camada de contingência caso disponível)
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
          event: "*",
          schema: "public",
          table: "instagram_conversations",
        },
        (payload: any) => {
          const row = payload?.new;
          if (!row || !row.id || String(row.id).startsWith("__") || row.status === "system" || row.status === "vault") return;

          callbacksRef.current.onInstagramConversationUpdate?.({
            id: String(row.id),
            lastMessage: row.last_message || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
            unread: Boolean(row.unread),
            fullName: row.full_name || undefined,
            username: row.username || undefined,
            avatar: row.avatar || undefined,
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
            lastMessage: row.last_message_preview || undefined,
            lastMessageAt: row.last_message_at || undefined,
            lastDirection: row.last_direction || undefined,
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
          // Ignora
        }
      }
      supabase.removeChannel(channel);
    };
  }, []);

  return { isRealtimeConnected: isConnected };
}
