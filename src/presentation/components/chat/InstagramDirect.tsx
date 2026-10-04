"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useDeferredValue } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import {
  Search,
  Camera,
  ArrowLeft,
  Paperclip,
  Sparkles,
  Heart,
  Loader2,
  AlertCircle,
  User,
  SlidersHorizontal,
  Zap,
  Play,
  Pause,
  Maximize2,
  X,
  Volume2,
  Mic,
  Square,
  Trash2,
  Image as ImageIcon,
  MessageSquareText,
  Bell,
  BellRing,
  ShieldAlert,
  ShieldCheck,
  Reply,
  Check,
  CheckCheck,
  Layers,
  Trophy,
  Clock,
  Bot,
  BotOff,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Copy,
  BookmarkPlus,
  Sticker,
  Ban,
  Lock,
  Unlock,
  Flame,
} from "lucide-react";
import {
  ConversationSkeletonList,
  ChatMessageSkeletonList,
} from "@/presentation/components/ui/LoadingState";
import {
  InstagramProfileModal,
  type InstagramProfileData,
} from "@/presentation/components/instagram/InstagramProfileModal";
import { InstagramConnectModal } from "@/presentation/components/instagram/InstagramConnectModal";
import {
  TinderProfileModal,
  type TinderProfileData,
} from "@/presentation/components/tinder/TinderProfileModal";
import { TinderConnectModal } from "@/presentation/components/tinder/TinderConnectModal";
import type { TinderFilter, TinderSession, TinderProfile } from "@/domain/entities/Tinder";
import { ChatFilterModal, SortOrder } from "./ChatFilterModal";
import { resolveContactAvatar } from "@/domain/services/AvatarResolverService";
import {
  useChatRealtime,
  notifyLocalTabs,
  RealtimeMessagePayload,
  RealtimeConversationUpdatePayload,
  RealtimeInstagramReactionPayload,
} from "@/presentation/hooks/useChatRealtime";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { InstagramAudioMessage } from "./InstagramAudioMessage";
import {
  ensureInstagramCompatibleAudio,
  ensureCompatibleAudioUrl,
} from "./audio-converter";
import { PersonaAudioVaultModal } from "../vault/PersonaAudioVaultModal";
import { AutoPilotActivationModal } from "./AutoPilotActivationModal";
import { InstagramChatComposer, InstagramChatComposerRef } from "./InstagramChatComposer";
import { InstagramReplyGesture } from "./InstagramReplyGesture";
import { WhatsAppContactInfo } from "./WhatsAppContactInfo";
import { WhatsAppDocumentMessage } from "./WhatsAppDocumentMessage";
import { WhatsAppForwardedLabel, WhatsAppNativeMessage } from "./WhatsAppNativeMessage";
import { WhatsAppStickerTray, type WhatsAppSavedSticker } from "./WhatsAppStickerTray";
import { VaultItem } from "@/domain/entities/Vault";
import { toast } from "sonner";
import {
  formatMessageTime,
  getMessageTimestampMs,
  getMessageDayKey,
  formatChatDateDivider,
  formatInboxDateDivider,
  getMessageCadenceSeconds,
} from "@/lib/utils";
import { ChatStageBar } from "./ChatStageBar";
import { useChatStages } from "@/presentation/hooks/useChatStages";
import { StageChecklistItem } from "@/domain/entities/ChatStage";
import {
  RaffleCommercialStatus,
  normalizeRaffleCommercialStatus,
  raffleCommercialStatusLabel,
} from "@/domain/entities/RaffleStatus";
import { useAutoPilot } from "@/presentation/hooks/useAutoPilot";
import { AutoPilotApprovalCard } from "./AutoPilotApprovalCard";
import {
  AutoPilotActivityIndicator,
  isAutoPilotActivelyWorking,
} from "./AutoPilotActivityIndicator";
import { useMobileNotifications } from "@/presentation/hooks/useMobileNotifications";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
import { hasNewConversationMessage, runDeduplicatedConversationFetch } from "./instagram-message-loading";
import {
  getWhatsApp2Chats,
  getWhatsApp2ChatState,
  getWhatsApp2MediaUrl,
  getWhatsApp2Messages,
  getWhatsApp2Presence,
  getWhatsApp2Status,
  normalizeWhatsApp2Attachment,
  IS_WHATSAPP2_REMOTE_BUILD,
  openWhatsApp2EventStream,
  sendWhatsApp2Media,
  sendWhatsApp2Text,
  setWhatsApp2ChatBlocked,
  setWhatsApp2ChatLocked,
  subscribeWhatsApp2Presence,
  unsubscribeWhatsApp2Presence,
  type WhatsApp2GatewayChat,
  type WhatsApp2Attachment,
  type WhatsApp2MessageMetadata,
  type WhatsApp2GatewayEvent,
  type WhatsApp2GatewayMessage,
  type WhatsApp2PresencePayload,
} from "./whatsapp2-client";

function parseMediaObservationPauseReason(reason?: string | null): { kind: "video" | "image"; messageId: string } | null {
  const match = /^media_observation_required\|(video|image)\|(.+)$/.exec(String(reason || ""));
  if (!match) return null;
  return { kind: match[1] as "video" | "image", messageId: match[2] };
}

function WhatsAppIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.52 3.48A11.88 11.88 0 0 0 12.06 0C5.47 0 .1 5.36.1 11.95c0 2.1.55 4.16 1.6 5.97L0 24l6.24-1.64a11.93 11.93 0 0 0 5.81 1.48h.01C18.65 23.84 24 18.48 24 11.9c0-3.18-1.24-6.17-3.48-8.42Zm-8.46 18.35h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.7.97.99-3.61-.23-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.45-9.92 9.93-9.92 2.65 0 5.14 1.03 7.01 2.91a9.85 9.85 0 0 1 2.9 7c-.01 5.47-4.46 9.89-9.96 9.89Zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35Z" />
    </svg>
  );
}

function InstagramIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function isDifferentDay(
  current: DirectMessage,
  prev: DirectMessage | null
): boolean {
  const currentKey = getMessageDayKey(current.timestamp || current.sentDate || current.createdAt);
  if (!currentKey) return false;
  if (!prev) return true;
  const prevKey = getMessageDayKey(prev.timestamp || prev.sentDate || prev.createdAt);
  if (!prevKey) return true;
  return currentKey !== prevKey;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | "sticker" | "document" | "file" | "unsupported";
  attachment?: WhatsApp2Attachment;
  nativeMetadata?: WhatsApp2MessageMetadata;
  audioTranscript?: string;
  reactionEmoji?: string;
  reactionAt?: string;
  createdAt: string;
  timestamp?: number;
  sentDate?: string;
  isMine: boolean;
  liked?: boolean;
  status?: "sending" | "sent" | "delivered" | "seen" | "failed";
  seenAt?: string;
  errorReason?: "outside_24h_window" | "generic";
  deliverAt?: number;
  delaySeconds?: number;
  deliveryQueueStatus?: "pending" | "sending";
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
  };
}

export interface DirectConversation {
  id: string;
  username: string;
  fullName: string;
  avatar: string;
  isOnline: boolean;
  lastActive: string;
  lastMessage: string;
  unread: boolean;
  type: "instagram" | "whatsapp2" | "tinder";
  providerId?: string;
  lastSender: "me" | "them";
  lastStatus?: string;
  seenAt?: string;
  isNewMatch?: boolean;
  photos?: string[];
  bio?: string;
  city?: string;
  lastMessageAt?: string;
  isRestricted?: boolean;
  currentStageId?: string | null;
  isConverted?: boolean;
  raffleStatus?: RaffleCommercialStatus;
  aiAutoRespond?: boolean;
  status?: "active" | "archived" | "blocked" | "restricted" | "pending" | "system" | "vault";
  archived?: boolean;
  isLocked?: boolean;
  isBlocked?: boolean;
}

function toInstagramProfileData(
  conversation: DirectConversation | null,
): InstagramProfileData | null {
  if (!conversation || conversation.type !== "instagram") return null;
  return {
    id: conversation.id,
    fullName: conversation.fullName,
    username: conversation.username,
    avatar: conversation.avatar,
    photos: conversation.photos,
    bio: conversation.bio,
    city: conversation.city,
    lastActive: conversation.lastActive,
    type: "instagram",
  };
}

function toTinderProfileData(
  conversation: DirectConversation | null,
): TinderProfileData | null {
  if (!conversation || conversation.type !== "tinder") return null;
  return {
    id: conversation.id,
    fullName: conversation.fullName,
    username: conversation.username,
    avatar: conversation.avatar,
    photos: conversation.photos,
    bio: conversation.bio,
    city: conversation.city,
    lastActive: conversation.lastActive,
    type: "tinder",
  };
}

type InstagramFilter = "todos" | "nao_respondidos" | "respondidos" | "pedidos";
type WhatsAppResponseFilter = "todos" | "nao_respondidos" | "respondidos" | "arquivados" | "trancadas";
type WhatsAppQuickFilter = "todas" | "nao_lidas" | "com_ia" | "sem_ia";
type InboxChannel = "instagram" | "whatsapp2" | "tinder";

function isWhatsAppLikeType(type?: DirectConversation["type"] | null): boolean {
  return type === "whatsapp2";
}

function formatWhatsApp2Preview(message: WhatsApp2GatewayMessage | null): string {
  if (!message) return "";
  const metadata = message.messageMetadata;
  if (metadata?.nativeKind === "contact") {
    const contacts = metadata.contacts || [];
    return contacts.length > 1
      ? `👥 ${contacts.length} contatos`
      : `👤 Contato: ${contacts[0]?.name || "Contato"}`;
  }
  if (metadata?.nativeKind === "location") {
    return `📍 ${metadata.location?.name || metadata.location?.address || "Localização"}`;
  }
  if (metadata?.nativeKind === "poll") {
    return `📊 Enquete: ${metadata.poll?.question || "Enquete"}`;
  }
  if (metadata?.nativeKind === "album") return "🖼️ Álbum";
  if (metadata?.nativeKind === "call") return "📞 Chamada";
  if (metadata?.nativeKind === "group_invite") {
    return `👥 Convite: ${metadata.groupInvite?.groupName || "grupo"}`;
  }
  if (metadata?.nativeKind === "revoked") return "Mensagem apagada";

  const body = String(message.body || "").trim();
  if (body) return body;
  switch (message.type) {
    case "ptt":
    case "audio":
      return "🎙️ Mensagem de voz";
    case "image":
      return "📷 Foto";
    case "video":
      return "🎥 Vídeo";
    case "sticker":
      return "Figurinha";
    case "document":
      return "Documento";
    case "call_log":
      return "Chamada";
    default:
      if (message.hasMedia) {
        return message.attachment?.fileName || "Arquivo";
      }
      return message.type ? `[${message.type}]` : "";
  }
}

function isSameLocalCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatWhatsApp2PresenceLabel(
  presence: WhatsApp2PresencePayload | null,
  now = new Date(),
): string | null {
  if (!presence?.available) return null;
  if (presence.isRecording) return "gravando áudio…";
  if (presence.isTyping) return "digitando…";
  if (presence.isOnline) return "online";
  if (!presence.lastSeenAt) return null;

  const lastSeen = new Date(presence.lastSeenAt);
  if (Number.isNaN(lastSeen.getTime())) return null;

  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(lastSeen);

  if (isSameLocalCalendarDay(lastSeen, now)) {
    return `visto por último hoje às ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalCalendarDay(lastSeen, yesterday)) {
    return `visto por último ontem às ${time}`;
  }

  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(lastSeen);
  return `visto por último em ${date} às ${time}`;
}

function mapWhatsApp2Chat(chat: WhatsApp2GatewayChat): DirectConversation {
  const timestampMs = Number(chat.lastMessage?.timestamp || chat.timestamp || 0) * 1000;
  const name = String(chat.name || chat.id || "Contato");
  const preview = formatWhatsApp2Preview(chat.lastMessage);
  return {
    id: `wa2:${chat.id}`,
    providerId: chat.id,
    username: chat.id.replace(/@.*$/, ""),
    fullName: name,
    avatar: chat.avatarUrl || "/images/default-avatar.svg",
    isOnline: false,
    lastActive: timestampMs ? formatMessageTime(timestampMs) : "",
    lastMessage: chat.lastMessage?.fromMe && preview ? `Você: ${preview}` : preview,
    unread: Number(chat.unreadCount || 0) > 0,
    type: "whatsapp2",
    lastSender: chat.lastMessage?.fromMe ? "me" : "them",
    lastStatus:
      chat.lastMessage?.ack != null && chat.lastMessage.ack >= 3
        ? "seen"
        : chat.lastMessage?.ack != null && chat.lastMessage.ack >= 2
        ? "delivered"
        : "sent",
    lastMessageAt: timestampMs ? new Date(timestampMs).toISOString() : undefined,
    aiAutoRespond: false,
    status: "active",
    archived: Boolean(chat.archived),
    isLocked: Boolean(chat.isLocked),
    isBlocked: Boolean(chat.isBlocked),
  };
}

function mapWhatsApp2Message(message: WhatsApp2GatewayMessage): DirectMessage {
  const timestampMs = Number(message.timestamp || 0) * 1000;
  const text = String(message.body || "").trim() || formatWhatsApp2Preview(message);
  const messageId = String(
    message.id || `wa2-msg-${timestampMs || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );

  const fallbackKind =
    message.type === "ptt" || message.type === "audio"
      ? "audio"
      : message.type === "image"
      ? "image"
      : message.type === "video"
      ? "video"
      : message.type === "sticker"
      ? "sticker"
      : message.type === "document"
      ? "document"
      : message.hasMedia
      ? "unsupported"
      : undefined;

  const attachment = normalizeWhatsApp2Attachment(message.attachment, fallbackKind
    ? {
        kind: fallbackKind,
        providerType: message.type,
        mediaUrl: message.hasMedia ? getWhatsApp2MediaUrl(messageId) : null,
        downloadable: Boolean(message.hasMedia),
        previewable: ["audio", "image", "video", "sticker"].includes(fallbackKind),
      }
    : undefined,
  );

  const mediaType = attachment?.kind;
  const mediaUrl =
    attachment?.mediaUrl ||
    (message.hasMedia && mediaType ? getWhatsApp2MediaUrl(messageId) : undefined);

  return {
    id: messageId,
    senderId: message.fromMe ? "me" : String(message.from || ""),
    text,
    mediaType,
    mediaUrl: mediaUrl || undefined,
    attachment: attachment
      ? { ...attachment, mediaUrl: mediaUrl || attachment.mediaUrl || null }
      : undefined,
    nativeMetadata: message.messageMetadata || undefined,
    createdAt: formatMessageTime(timestampMs || Date.now()),
    timestamp: timestampMs || Date.now(),
    sentDate: timestampMs ? new Date(timestampMs).toISOString() : new Date().toISOString(),
    isMine: Boolean(message.fromMe),
    status:
      message.fromMe && Number(message.ack || 0) >= 4
        ? "seen"
        : message.fromMe && Number(message.ack || 0) >= 2
        ? "delivered"
        : "sent",
  };
}

const avatarRefreshRequests = new Set<string>();

function isMetaCdnAvatarUrl(value: unknown): boolean {
  const source = String(value || "");
  return source.includes("cdninstagram.com") || source.includes("fbcdn.net");
}

function isExpiredMetaCdnAvatar(value: unknown, nowMs = Date.now()): boolean {
  const source = String(value || "");
  if (!isMetaCdnAvatarUrl(source)) return false;
  try {
    const url = new URL(source);
    const expiryHex = url.searchParams.get("oe");
    if (!expiryHex || !/^[0-9a-f]+$/i.test(expiryHex)) return false;
    const expiryMs = Number.parseInt(expiryHex, 16) * 1000;
    return Number.isFinite(expiryMs) && expiryMs <= nowMs;
  } catch {
    return false;
  }
}

function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port === "3000";

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
}

function requestAvatarRefresh(conversationId?: string) {
  if (!conversationId || avatarRefreshRequests.has(conversationId)) return;
  avatarRefreshRequests.add(conversationId);
  void fetch(getApiUrl("/instagram/profile/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  })
    .then((response) => {
      if (!response.ok) avatarRefreshRequests.delete(conversationId);
    })
    .catch(() => {
      avatarRefreshRequests.delete(conversationId);
    });
}

interface InstagramDirectProps {
  onChatOpenChange?: (isOpen: boolean) => void;
}

/**
 * Componente de Avatar com Fallback Elegante
 * Exibe imagem via Next/Image e, caso a URL falhe ou seja inexistente,
 * renderiza um fallback sofisticado com as iniciais ou ícone padrão.
 */
interface AvatarWithFallbackProps {
  src?: string;
  alt: string;
  conversationId?: string;
  sizeClassName?: string;
  ringClassName?: string;
}

function AvatarWithFallback({
  src,
  alt,
  conversationId,
  sizeClassName = "w-10 h-10",
  ringClassName = "",
}: AvatarWithFallbackProps) {
  const [hasError, setHasError] = useState(false);
  const expiredMetaAvatar = isExpiredMetaCdnAvatar(src);
  const isWhatsApp = Boolean(conversationId?.startsWith("wa:") || conversationId?.startsWith("wa2:"));
  const cleanName = String(alt || "").trim();
  const nameParts = cleanName
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = nameParts.length >= 2
    ? `${nameParts[0][0] || ""}${nameParts[nameParts.length - 1][0] || ""}`.toUpperCase()
    : (nameParts[0]?.slice(0, 2) || "").toUpperCase();
  const numericOnlyName = /^\+?\d[\d\s()+-]*$/.test(cleanName);
  const rawSrc = String(src || "").trim();
  const hasRealPhoto =
    !hasError &&
    !expiredMetaAvatar &&
    /^https?:\/\//i.test(rawSrc) &&
    !rawSrc.includes("images.unsplash.com");

  useEffect(() => {
    setHasError(false);
    if (!isWhatsApp && expiredMetaAvatar) requestAvatarRefresh(conversationId);
  }, [src, conversationId, expiredMetaAvatar, isWhatsApp]);

  if (isWhatsApp && !hasRealPhoto) {
    return (
      <div
        className={`relative rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-[#667781] text-white select-none shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.18)] ${sizeClassName} ${ringClassName}`}
        aria-label={cleanName || "Contato do WhatsApp"}
        title={cleanName || "Contato do WhatsApp"}
      >
        {initials && !numericOnlyName ? (
          <span className="text-[0.92em] font-semibold tracking-[-0.03em] leading-none">
            {initials}
          </span>
        ) : (
          <User className="h-[52%] w-[52%] stroke-[1.8] text-white/90" />
        )}
      </div>
    );
  }

  const photoToDisplay = hasRealPhoto
    ? rawSrc
    : resolveContactAvatar(alt, alt);

  return (
    <div
      className={`relative rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-zinc-100 dark:bg-[#1c1c1e] select-none ${sizeClassName} ${ringClassName}`}
    >
      <Image
        src={photoToDisplay}
        alt={alt || "Avatar"}
        fill
        unoptimized
        className="object-cover"
        onError={() => {
          setHasError(true);
          if (!isWhatsApp && isMetaCdnAvatarUrl(src)) requestAvatarRefresh(conversationId);
        }}
      />
    </div>
  );
}

/**
 * Visualizador de Imagem do Instagram Direct
 * Renderiza a foto em alta qualidade com prévia responsiva e suporte a zoom.
 */
function DirectImage({
  src,
  alt,
  onExpand,
}: {
  src: string;
  alt: string;
  onExpand: (url: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-400" />
        <span>Foto indisponível</span>
      </div>
    );
  }

  return (
    <div
      onClick={() => onExpand(src)}
      className="relative rounded-xl overflow-hidden cursor-pointer group bg-zinc-100 dark:bg-zinc-900 my-1 max-w-[260px] max-h-[340px]"
    >
      {!loaded && (
        <div className="w-[220px] h-[220px] flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 animate-pulse">
          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full max-h-[340px] object-cover transition-transform duration-200 group-hover:scale-102 ${
          loaded ? "block" : "hidden"
        }`}
      />
      <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-zinc-950 dark:text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <Maximize2 className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

function isInstagramSharedMediaText(value?: string | null): boolean {
  const text = String(value || "").trim();
  return text.startsWith("[share:") || text.startsWith("🎞️ Reel");
}

function extractInstagramSharedMediaUrl(value?: string | null): string | undefined {
  const match = String(value || "").match(/^\[share:(https?:\/\/[^\]]+)\]/);
  return match?.[1];
}

function canPreviewSharedMediaAsVideo(url?: string): boolean {
  if (!url) return false;
  return (
    url.includes("cdninstagram.com") ||
    url.includes("fbcdn.net") ||
    url.includes("lookaside.fbsbx.com") ||
    /\.mp4(?:$|\?)/i.test(url)
  );
}

/**
 * Card visual de Reel/publicação compartilhada.
 * Quando a Meta entrega mídia direta, reproduz no próprio chat; caso contrário,
 * mantém um card clicável para abrir o compartilhamento.
 */
function InstagramSharedReelCard({
  url,
  isMine,
  instagramUsername,
}: {
  url?: string;
  isMine: boolean;
  instagramUsername?: string | null;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const canPreview = canPreviewSharedMediaAsVideo(url) && !previewFailed;
  const cleanUsername = String(instagramUsername || "").replace(/^@/, "").replace(/^ig_/, "").trim();
  const fallbackUrl = cleanUsername ? `https://ig.me/m/${cleanUsername}` : undefined;
  const openUrl = url && /^https?:\/\//i.test(url) ? url : fallbackUrl;

  const openSharedMedia = () => {
    if (!openUrl) return;
    window.open(openUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-w-[220px] max-w-[320px] overflow-hidden rounded-xl">
      {canPreview ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            onError={() => setPreviewFailed(true)}
            className="block max-h-[420px] w-full object-contain"
          >
            Seu navegador não conseguiu reproduzir esta mídia.
          </video>
          <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">
            Reel compartilhado
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openSharedMedia}
          disabled={!openUrl}
          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${openUrl ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99]" : "cursor-default"}`}
          title={url ? "Abrir Reel ou publicação compartilhada" : openUrl ? "Abrir conversa no Instagram" : "Mídia compartilhada indisponível"}
        >
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] via-[#dc2743] to-[#bc1888] shadow-sm">
            <Play className="h-5 w-5 fill-white text-white" />
            <InstagramIcon className="absolute -bottom-1 -right-1 h-4 w-4 rounded-md bg-black/70 p-0.5 text-white" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <span className={`block text-xs font-semibold ${isMine ? "text-white" : "text-zinc-950 dark:text-white"}`}>
              Reel compartilhado
            </span>
            <span className={`mt-1 block text-[10px] ${isMine ? "text-white/75" : "text-zinc-600 dark:text-zinc-400"}`}>
              {url ? "Toque para abrir no Instagram" : openUrl ? "Abrir conversa no Instagram" : "Prévia indisponível"}
            </span>
          </div>
        </button>
      )}
    </div>
  );
}

function InstagramSharedMediaCard({ isMine }: { isMine: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-1 min-w-[210px] max-w-[260px] select-none">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] via-[#dc2743] via-[#cc2366] to-[#bc1888] flex items-center justify-center shrink-0 shadow-md">
        <Camera className="w-5 h-5 text-white stroke-[2.2]" />
      </div>
      <div className="leading-tight flex-1">
        <span className={`text-xs font-semibold block tracking-tight ${isMine ? "text-white" : "text-zinc-950 dark:text-white"}`}>
          Foto do Instagram
        </span>
        <span className={`text-[10px] block mt-0.5 ${isMine ? "text-white/75" : "text-zinc-600 dark:text-zinc-400"}`}>
          Mídia compartilhada
        </span>
      </div>
    </div>
  );
}

/**
 * Calcula o intervalo de polling adaptativo e resiliente:
 * - < 3 falhas: 3s
 * - 3 falhas consecutivas: 6s
 * - >= 4 falhas consecutivas: 12s
 */
function getResilientInterval(failures: number, baseInterval: number = 3000): number {
  if (failures < 3) return baseInterval;
  if (failures === 3) return 6000;
  return 12000;
}

/**
 * Mini-componente de contagem regressiva em tempo real para mensagens com envio programado.
 * Exibe contagem decrescente até o instante mínimo de envio.
 * Depois disso, mostra o estado real da fila ("Aguardando…" ou "Enviando…").
 */
function MessageCountdown({
  deliverAt,
  queueStatus,
}: {
  deliverAt: number;
  queueStatus?: "pending" | "sending";
}) {
  const [remaining, setRemaining] = useState<number>(() => {
    return Math.max(0, Math.ceil((deliverAt - Date.now()) / 1000));
  });

  useEffect(() => {
    const update = () => {
      const diff = Math.ceil((deliverAt - Date.now()) / 1000);
      setRemaining(Math.max(0, diff));
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [deliverAt]);

  const waitingForEligibility = remaining === 0 && queueStatus === "pending";
  const sendingNow = remaining === 0 && queueStatus !== "pending";
  const label = remaining > 0
    ? String(remaining).padStart(2, "0") + "s"
    : waitingForEligibility
    ? "Aguardando…"
    : "Enviando…";

  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px] text-white/95 bg-white/20 px-1.5 py-0.5 rounded-full font-semibold tabular-nums select-none"
      title={remaining > 0 ? `Envio elegível em ${label}` : waitingForEligibility ? "Aguardando liberação do dispatcher" : "Envio em andamento"}
    >
      {sendingNow ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-700 dark:text-amber-300 shrink-0" />
      ) : (
        <Clock className="w-2.5 h-2.5 animate-pulse text-amber-700 dark:text-amber-300 shrink-0" />
      )}
      <span>{label}</span>
    </span>
  );
}

type BrainInboxOverviewItem = {
  status: "idle" | "waiting_delay" | "queued" | "processing" | "sending" | "waiting_human" | "failed" | "uncertain" | "completed" | "disabled";
  label: string;
  detail: string;
  active: boolean;
  updatedAt?: string | null;
  scheduledResponseAt?: string | null;
  isEnabled: boolean;
  objectiveLabel?: string | null;
  sentCount?: number;
  totalCount?: number;
  actionTypes?: string[];
};

function InboxAiStatusLabel({ ai }: { ai: BrainInboxOverviewItem }) {
  const scheduledAtMs = ai.scheduledResponseAt ? Date.parse(ai.scheduledResponseAt) : 0;
  const isWaiting = ai.status === "waiting_delay" && scheduledAtMs > 0;
  const calcRemaining = () => isWaiting
    ? Math.max(0, Math.ceil((scheduledAtMs - Date.now()) / 1000))
    : 0;
  const [remainingSeconds, setRemainingSeconds] = useState(calcRemaining);

  useEffect(() => {
    const nextRemaining = isWaiting
      ? Math.max(0, Math.ceil((scheduledAtMs - Date.now()) / 1000))
      : 0;
    setRemainingSeconds(nextRemaining);
    if (!isWaiting) return;
    const interval = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((scheduledAtMs - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isWaiting, scheduledAtMs]);

  if (!isWaiting) return <>{ai.label}</>;
  if (remainingSeconds <= 0) return <>IA iniciando...</>;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const countdown = minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;

  return <>Responde em {countdown}</>;
}

/**
 * Identifica com precisão se uma mensagem é temporária, pendente ou está em processo de envio.
 * Cobre prefixos gerados localmente (fwd-, temp-) e pelo backend em Edge Function (fwd_, temp_).
 */
function isTemporaryOrSendingMessage(m?: DirectMessage | null): boolean {
  if (!m) return false;
  if (m.status === "sending") return true;
  const id = m.id || "";
  return (
    id.startsWith("temp-") ||
    id.startsWith("temp_") ||
    id.startsWith("fwd-") ||
    id.startsWith("fwd_") ||
    id.startsWith("sent-") ||
    id.startsWith("sent_") ||
    id.startsWith("msg_local_") ||
    id.startsWith("local-") ||
    id.startsWith("local_")
  );
}

/**
 * Deduplica mensagens preservando integridade:
 * 1. Elimina duplicatas de mesmo ID.
 * 2. Suporta mensagens com texto e/ou anexos de mídia (áudios e fotos sem texto complementar).
 * 3. Para mensagens enviadas ('isMine'): substitui mensagem temporária/sending pela oficial da Meta
 *    quando comprovada a mesma URL de mídia ou o mesmo texto exato, sem depender de igualdade estrita de horário.
 */
function deduplicateMessages(msgs: DirectMessage[]): DirectMessage[] {
  const result: DirectMessage[] = [];
  const seenIds = new Set<string>();

  for (const m of msgs) {
    if (!m) continue;
    const hasText = Boolean(m.text && m.text.trim().length > 0);
    const hasMedia = Boolean(m.mediaUrl && m.mediaUrl.trim().length > 0);
    // Mensagem válida deve ter texto OU mídia
    if (!hasText && !hasMedia) continue;

    if (seenIds.has(m.id)) {
      const existingIdx = result.findIndex((r) => r.id === m.id);
      if (existingIdx !== -1) {
        const existing = result[existingIdx];
        result[existingIdx] = {
          ...existing,
          ...m,
          timestamp: m.timestamp || existing.timestamp,
          sentDate: m.sentDate || existing.sentDate,
          errorReason: m.errorReason || existing.errorReason,
          status: m.status || existing.status,
          deliverAt: m.deliverAt || existing.deliverAt,
          delaySeconds: m.delaySeconds || existing.delaySeconds,
          replyTo: m.replyTo || existing.replyTo,
          replyToMessageId: m.replyToMessageId || existing.replyToMessageId,
          audioTranscript: m.audioTranscript || existing.audioTranscript,
        };
      }
      continue;
    }

    const mIsTemp = isTemporaryOrSendingMessage(m);

    // Se a mensagem que está entrando for oficial (não-temporária e sent), verifica se substitui uma temporária pendente enviada por mim
    if (!mIsTemp && m.isMine) {
      const tempIdx = result.findIndex((r) => {
        if (!r.isMine || !isTemporaryOrSendingMessage(r)) return false;

        // Se ambas têm mídia, compara a URL
        if (r.mediaUrl && m.mediaUrl) {
          return r.mediaUrl === m.mediaUrl;
        }
        if (m.mediaUrl && r.text && r.text.includes(m.mediaUrl)) {
          return true;
        }
        if (r.mediaUrl && m.text && m.text.includes(r.mediaUrl)) {
          return true;
        }

        // Se texto puro, compara o conteúdo
        if (!r.mediaUrl && !m.mediaUrl && hasText && r.text) {
          return r.text.trim() === m.text.trim();
        }

        return false;
      });

      if (tempIdx !== -1) {
        const tempMsg = result[tempIdx];
        seenIds.delete(tempMsg.id);
        result[tempIdx] = {
          ...tempMsg,
          ...m,
          isMine: true,
          timestamp: m.timestamp || tempMsg.timestamp,
          sentDate: m.sentDate || tempMsg.sentDate,
          errorReason: m.errorReason || tempMsg.errorReason,
          status: m.status || "sent",
          deliverAt: undefined, // Envio concluído, limpa countdown
          delaySeconds: undefined,
          mediaUrl: m.mediaUrl || tempMsg.mediaUrl,
          mediaType: m.mediaType || tempMsg.mediaType,
          audioTranscript: m.audioTranscript || tempMsg.audioTranscript,
          replyTo: m.replyTo || tempMsg.replyTo,
          replyToMessageId: m.replyToMessageId || tempMsg.replyToMessageId,
        };
        seenIds.add(m.id);
        continue;
      }
    }

    // Se a mensagem que está entrando for temporária (ex: queued ID fwd_... substituindo fwd-...)
    if (mIsTemp && m.isMine) {
      const existingTempIdx = result.findIndex((r) => {
        if (!r.isMine || !isTemporaryOrSendingMessage(r)) return false;
        if (r.mediaUrl && m.mediaUrl) return r.mediaUrl === m.mediaUrl;
        if (!r.mediaUrl && !m.mediaUrl && hasText && r.text && m.text) {
          return r.text.trim() === m.text.trim();
        }
        return false;
      });

      if (existingTempIdx !== -1) {
        const prevTemp = result[existingTempIdx];
        seenIds.delete(prevTemp.id);
        result[existingTempIdx] = {
          ...prevTemp,
          ...m,
          deliverAt: m.deliverAt || prevTemp.deliverAt,
          delaySeconds: m.delaySeconds || prevTemp.delaySeconds,
          replyTo: m.replyTo || prevTemp.replyTo,
          replyToMessageId: m.replyToMessageId || prevTemp.replyToMessageId,
          audioTranscript: m.audioTranscript || prevTemp.audioTranscript,
        };
        seenIds.add(m.id);
        continue;
      }
    }

    // Prevenção contra mensagens duplicadas idênticas
    const duplicateIdx = result.findIndex((r) => {
      if (r.isMine !== m.isMine) return false;
      if (!r.text || !m.text) return false;
      if (r.text.trim() !== m.text.trim()) return false;
      if ((r.mediaUrl || null) !== (m.mediaUrl || null)) return false;

      // Se uma delas é temporária ou sending, unifica
      if (isTemporaryOrSendingMessage(r) || mIsTemp) {
        return true;
      }

      // Se ambas tiverem o mesmo minuto de envio
      if (r.createdAt === m.createdAt) {
        return true;
      }

      return false;
    });

    if (duplicateIdx !== -1) {
      const existing = result[duplicateIdx];
      const preferIncoming = !mIsTemp && isTemporaryOrSendingMessage(existing);
      seenIds.delete(existing.id);
      result[duplicateIdx] = {
        ...(preferIncoming ? existing : m),
        ...(preferIncoming ? m : existing),
        status:
          m.status === "sent" || existing.status === "sent"
            ? "sent"
            : m.status || existing.status,
        deliverAt: preferIncoming ? undefined : m.deliverAt || existing.deliverAt,
        delaySeconds: preferIncoming ? undefined : m.delaySeconds || existing.delaySeconds,
        replyTo: m.replyTo || existing.replyTo,
        replyToMessageId: m.replyToMessageId || existing.replyToMessageId,
      };
      seenIds.add(result[duplicateIdx].id);
      continue;
    }

    seenIds.add(m.id);
    result.push(m);
  }

  return result;
}

/**
 * Lê de forma síncrona os timestamps de chats já lidos/abertos salvos no localStorage.
 * Permite comparar com o timestamp da última mensagem: se o contato mandar mensagem nova,
 * a conversa volta a ter bolinha azul automaticamente.
 */
function getStoredReadChatTimestamps(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem("vendeo_read_chat_timestamps");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    }
    // Migração suave do array antigo
    const oldSaved = localStorage.getItem("vendeo_read_chats");
    if (oldSaved) {
      const parsedOld = JSON.parse(oldSaved);
      if (Array.isArray(parsedOld)) {
        const initialMap: Record<string, number> = {};
        for (const id of parsedOld) {
          initialMap[id] = 1;
        }
        return initialMap;
      }
    }
  } catch {}
  return {};
}

/**
 * Lê de forma síncrona os IDs de chats restringidos salvos no localStorage.
 * Garante persistência imediata e proteção contra sobrescrita de polling em background.
 */
function getStoredRestrictedChatIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const saved = localStorage.getItem("vendeo_restricted_chats");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch {}
  return new Set();
}

export function InstagramDirect({ onChatOpenChange }: InstagramDirectProps) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [whatsapp2Conversations, setWhatsApp2Conversations] = useState<DirectConversation[]>([]);
  const [whatsapp2GatewayStatus, setWhatsapp2GatewayStatus] = useState("idle");
  const [whatsapp2GatewayError, setWhatsapp2GatewayError] = useState<string | null>(null);
  const whatsapp2InboxLastReconcileAtRef = useRef(0);
  const isRealtimeConnectedRef = useRef<boolean>(true);

  const loadWhatsApp2Conversations = useCallback(async () => {
    setWhatsapp2GatewayStatus("loading");

    const supabase = getSupabaseBrowserClient();
    const oneWeekAgoIso = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    let gatewayRows: DirectConversation[] = [];
    let gatewayError: Error | null = null;

    try {
      const gatewayStatus = await getWhatsApp2Status();
      setWhatsapp2GatewayStatus(gatewayStatus.status || "idle");
      setWhatsapp2GatewayError(null);

      if (gatewayStatus.status === "ready") {
        const rows = await getWhatsApp2Chats(500);
        gatewayRows = rows.map(mapWhatsApp2Chat);
      }
    } catch (error) {
      gatewayError = error as Error;
      setWhatsapp2GatewayStatus("offline");
      setWhatsapp2GatewayError(gatewayError.message || "Gateway indisponível");
    }

    let canonicalRows: any[] = [];
    if (supabase) {
      const { data, error } = await supabase
        .from("instagram_conversations")
        .select(
          "id, contact_id, username, full_name, avatar, avatar_url, last_message, last_message_at, last_direction, last_status, seen_at, unread, unread_count, status, current_stage_id, is_converted, raffle_status, ai_auto_respond"
        )
        .eq("channel", "whatsapp2")
        .neq("status", "vault")
        .neq("status", "system")
        .gte("last_message_at", oneWeekAgoIso)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(500);

      if (error) {
        console.warn("[WhatsApp 2] Falha ao carregar projeção canônica:", error.message);
      } else {
        canonicalRows = data || [];
      }
    }

    const canonicalById = new Map<string, any>(
      canonicalRows.map((row: any) => [String(row.id), row])
    );
    const gatewayById = new Map<string, DirectConversation>(
      gatewayRows.map((row) => [row.id, row])
    );
    const allIds = new Set<string>([
      ...canonicalRows.map((row: any) => String(row.id)),
      ...gatewayRows.map((row) => row.id),
    ]);

    const merged = Array.from(allIds).map((id) => {
      const canonical = canonicalById.get(id);
      const gateway = gatewayById.get(id);
      const canonicalMessageAt = canonical?.last_message_at
        ? getMessageTimestampMs(canonical.last_message_at)
        : 0;
      const gatewayMessageAt = gateway?.lastMessageAt
        ? getMessageTimestampMs(gateway.lastMessageAt)
        : 0;
      const useCanonicalMessage =
        Boolean(canonical) && canonicalMessageAt >= gatewayMessageAt;
      const lastDirection = useCanonicalMessage
        ? String(canonical?.last_direction || "")
        : (gateway?.lastSender === "me" ? "out" : "in");
      const lastStatus = useCanonicalMessage
        ? (canonical?.last_status ? String(canonical.last_status) : undefined)
        : gateway?.lastStatus;
      const gatewayAvatar =
        gateway?.avatar && /^https?:\/\//i.test(String(gateway.avatar))
          ? gateway.avatar
          : null;
      const canonicalAvatarUrl =
        canonical?.avatar_url &&
        /^https?:\/\//i.test(String(canonical.avatar_url)) &&
        !String(canonical.avatar_url).includes("default-avatar.svg")
          ? canonical.avatar_url
          : null;
      const canonicalAvatar =
        canonical?.avatar &&
        /^https?:\/\//i.test(String(canonical.avatar)) &&
        !String(canonical.avatar).includes("default-avatar.svg")
          ? canonical.avatar
          : null;
      const avatar =
        gatewayAvatar ||
        canonicalAvatarUrl ||
        canonicalAvatar ||
        "/images/default-avatar.svg";
      const contactId =
        canonical?.contact_id ||
        gateway?.providerId ||
        id.replace(/^wa2:/, "");
      const fullName =
        canonical?.full_name ||
        gateway?.fullName ||
        canonical?.username ||
        gateway?.username ||
        contactId;
      const username =
        canonical?.username ||
        gateway?.username ||
        contactId;
      const lastMessageAt = useCanonicalMessage
        ? (canonical?.last_message_at || gateway?.lastMessageAt || null)
        : (gateway?.lastMessageAt || canonical?.last_message_at || null);
      const rawLastMessage = useCanonicalMessage
        ? (canonical?.last_message ?? gateway?.lastMessage ?? "")
        : (gateway?.lastMessage ?? canonical?.last_message ?? "");
      const isOutbound =
        lastDirection === "out" || lastDirection === "outbound";

      const conversation: DirectConversation = {
        ...(gateway || {
          id,
          username,
          fullName,
          avatar,
          isOnline: false,
          lastActive: lastMessageAt ? formatMessageTime(lastMessageAt) : "",
          lastMessage: rawLastMessage,
          lastSender: isOutbound ? "me" : "them",
          unread: false,
          type: "whatsapp2" as const,
        }),
        id,
        providerId: contactId,
        username,
        fullName,
        avatar,
        type: "whatsapp2",
        lastMessage: isOutbound && rawLastMessage && !String(rawLastMessage).startsWith("Você: ")
          ? `Você: ${rawLastMessage}`
          : String(rawLastMessage || ""),
        lastMessageAt: lastMessageAt || undefined,
        lastActive: lastMessageAt ? formatMessageTime(lastMessageAt) : (gateway?.lastActive || ""),
        lastSender: isOutbound ? "me" : "them",
        lastStatus: isOutbound
          ? ((lastStatus as DirectMessage["status"] | undefined) || "sent")
          : undefined,
        seenAt: canonical?.seen_at || gateway?.seenAt,
        unread: canonical ? Boolean(canonical.unread) : Boolean(gateway?.unread),
        status: canonical?.status || gateway?.status || "active",
        currentStageId: canonical?.current_stage_id || null,
        isConverted: Boolean(canonical?.is_converted),
        raffleStatus: normalizeRaffleCommercialStatus(canonical?.raffle_status),
        aiAutoRespond: Boolean(canonical?.ai_auto_respond),
        archived: Boolean(gateway?.archived),
        isLocked: Boolean(gateway?.isLocked),
        isBlocked: Boolean(gateway?.isBlocked),
      };
      return conversation;
    });

    merged.sort(
      (a, b) =>
        getMessageTimestampMs(b.lastMessageAt || b.lastActive) -
        getMessageTimestampMs(a.lastMessageAt || a.lastActive)
    );
    setWhatsApp2Conversations((currentRows) => {
      const reconciledById = new Map(merged.map((conversation) => [conversation.id, conversation]));

      for (const current of currentRows) {
        const reconciled = reconciledById.get(current.id);
        if (!reconciled) {
          const currentAt = getMessageTimestampMs(current.lastMessageAt || current.lastActive);
          const oneWeekAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
          if (currentAt >= oneWeekAgoMs) reconciledById.set(current.id, current);
          continue;
        }

        const currentAt = getMessageTimestampMs(current.lastMessageAt || current.lastActive);
        const reconciledAt = getMessageTimestampMs(
          reconciled.lastMessageAt || reconciled.lastActive
        );
        if (currentAt > reconciledAt) {
          reconciledById.set(current.id, {
            ...current,
            archived: reconciled.archived,
            isLocked: reconciled.isLocked,
            isBlocked: reconciled.isBlocked,
          });
        }
      }

      return Array.from(reconciledById.values()).sort(
        (a, b) =>
          getMessageTimestampMs(b.lastMessageAt || b.lastActive) -
          getMessageTimestampMs(a.lastMessageAt || a.lastActive)
      );
    });
    setActiveChat((current) => {
      if (!current || current.type !== "whatsapp2") return current;
      const reconciled = merged.find((conversation) => conversation.id === current.id);
      if (!reconciled) return current;
      const currentAt = getMessageTimestampMs(current.lastMessageAt || current.lastActive);
      const reconciledAt = getMessageTimestampMs(
        reconciled.lastMessageAt || reconciled.lastActive
      );
      return reconciledAt >= currentAt
        ? reconciled
        : {
            ...current,
            archived: reconciled.archived,
            isLocked: reconciled.isLocked,
            isBlocked: reconciled.isBlocked,
          };
    });

    if (!gatewayRows.length && gatewayError && !canonicalRows.length) {
      setWhatsapp2GatewayStatus("offline");
    }
  }, []);

  const checkTinderStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/tinder/status"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTinderSession({
        token: data.token || "",
        isConnected: Boolean(data.connected),
        profile: data.profile || undefined,
      });
      return data;
    } catch (err) {
      console.warn("[Tinder] Erro ao verificar status:", err);
      return null;
    }
  }, []);

  const loadTinderConversations = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/tinder/matches"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const matches: any[] = Array.isArray(data.matches) ? data.matches : [];
      
      const tinderRows: DirectConversation[] = matches.map((m: any) => {
        const lastMsg = m.messages && m.messages.length > 0 ? m.messages[m.messages.length - 1] : null;
        const isOutbound = lastMsg ? (lastMsg.from === data.profileId || lastMsg.is_mine) : false;
        const rawLastMessage = lastMsg ? lastMsg.message : "Novo match!";
        const lastMessageText = isOutbound && !rawLastMessage.startsWith("Você: ")
          ? `Você: ${rawLastMessage}`
          : rawLastMessage;

        const photos: string[] = Array.isArray(m.person?.photos)
          ? m.person.photos.map((p: any) => p.url)
          : [];
        const avatarUrl = photos[0] || "/images/default-avatar.svg";
        const isRestr = Boolean(m.isRestricted || m.following === false);

        return {
          id: String(m.id),
          username: m.person?.name || "Match Tinder",
          fullName: m.person?.name || "Match Tinder",
          avatar: avatarUrl,
          isOnline: false,
          lastActive: m.last_activity_date ? formatMessageTime(m.last_activity_date) : "",
          lastMessage: lastMessageText,
          unread: Boolean(m.unread_count && m.unread_count > 0),
          type: "tinder" as const,
          lastSender: isOutbound ? "me" as const : "them" as const,
          lastStatus: isOutbound ? "sent" : undefined,
          isNewMatch: Boolean(m.is_new_match),
          photos,
          bio: m.person?.bio,
          city: m.person?.city?.name || "",
          lastMessageAt: m.last_activity_date,
          isRestricted: isRestr,
          status: isRestr ? "restricted" : "active",
        };
      });

      setConversations((prev) => {
        const nonTinder = prev.filter((c) => c.type !== "tinder");
        return [...nonTinder, ...tinderRows];
      });

      setActiveChat((current) => {
        if (!current || current.type !== "tinder") return current;
        const updated = tinderRows.find((c) => c.id === current.id);
        return updated ? { ...current, ...updated } : current;
      });
    } catch (err) {
      console.warn("[Tinder] Erro ao carregar conversas:", err);
    }
  }, []);

  const handleTinderConnect = useCallback(async (token: string) => {
    const res = await fetch(getApiUrl("/api/tinder/auth"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha ao conectar no Tinder");
    }
    await checkTinderStatus();
    await loadTinderConversations();
  }, [checkTinderStatus, loadTinderConversations]);

  const handleTinderDisconnect = useCallback(async () => {
    await fetch(getApiUrl("/api/tinder/disconnect"), { method: "POST" });
    setTinderSession(null);
    setConversations((prev) => prev.filter((c) => c.type !== "tinder"));
  }, []);

  const handleTinderSync = useCallback(async () => {
    await loadTinderConversations();
  }, [loadTinderConversations]);

  const conversationsRef = useRef<DirectConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const prefersReducedMotion = useReducedMotion();
  const [activeChat, setActiveChat] = useState<DirectConversation | null>(null);
  const [whatsapp2Presence, setWhatsApp2Presence] = useState<WhatsApp2PresencePayload | null>(null);
  const whatsapp2PresenceClientIdRef = useRef(
    `wa2-ui-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [whatsappMessageMenu, setWhatsappMessageMenu] = useState<DirectMessage | null>(null);
  const [isWhatsAppContactInfoOpen, setIsWhatsAppContactInfoOpen] = useState(false);
  const [isWhatsAppStickerTrayOpen, setIsWhatsAppStickerTrayOpen] = useState(false);
  const [whatsappStickers, setWhatsappStickers] = useState<WhatsAppSavedSticker[]>([]);
  const [isLoadingWhatsAppStickers, setIsLoadingWhatsAppStickers] = useState(false);
  const [sendingStickerId, setSendingStickerId] = useState<string | null>(null);
  const [brainConsoleRequest, setBrainConsoleRequest] = useState<{ conversationId: string; requestId: number } | null>(null);
  const brainConsoleRequestIdRef = useRef(0);
  const handleBrainConsoleOpenRequestHandled = useCallback((requestId: number) => {
    setBrainConsoleRequest((current) => current?.requestId === requestId ? null : current);
  }, []);
  const handleOpenBrainConsole = useCallback((conversationId: string) => {
    brainConsoleRequestIdRef.current += 1;
    setBrainConsoleRequest({
      conversationId,
      requestId: brainConsoleRequestIdRef.current,
    });
  }, []);
  const [messages, setMessages] = useState<Record<string, DirectMessage[]>>({});
  const messagesRef = useRef<Record<string, DirectMessage[]>>({});
  const whatsapp2OpenChatEventHandlerRef = useRef<(event: WhatsApp2GatewayEvent) => void>(() => {});
  const whatsapp2EventStreamHealthyRef = useRef(false);
  const messageFetchesRef = useRef(new Map<string, Promise<void>>());
  const latestRealtimeMessageAtRef = useRef(new Map<string, number>());
  const latestFetchedMessageAtRef = useRef(new Map<string, number>());
  const chatLoadStartedAtRef = useRef(new Map<string, number>());
  useEffect(() => {
    messagesRef.current = messages;
    const activeId = activeChat?.id;
    if (!activeId || !messages[activeId]?.length) return;
    const startedAt = chatLoadStartedAtRef.current.get(activeId);
    if (startedAt === undefined) return;
    if (process.env.NODE_ENV !== "production") {
      console.debug("chat_load_rendered", {
        conversationId: activeId,
        messageCount: messages[activeId].length,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
    chatLoadStartedAtRef.current.delete(activeId);
  }, [messages, activeChat?.id]);
  const composerRef = useRef<InstagramChatComposerRef>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [hasCanonicalInstagramSnapshot, setHasCanonicalInstagramSnapshot] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const isLoadingMessages = loadingConversationId === activeChat?.id;
  const [isPersonaAudioModalOpen, setIsPersonaAudioModalOpen] = useState(false);
  const [isAutoPilotActivationModalOpen, setIsAutoPilotActivationModalOpen] = useState(false);
  const [isGlobalAutoPilotDisabledModalOpen, setIsGlobalAutoPilotDisabledModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [selectedProfileForModal, setSelectedProfileForModal] = useState<DirectConversation | null>(null);

  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);
  const [isInstagramConnected, setIsInstagramConnected] = useState<boolean | null>(null);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("recentes");
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [mediaObservationText, setMediaObservationText] = useState("");
  const [isSubmittingMediaObservation, setIsSubmittingMediaObservation] = useState(false);
  const [isUpdatingRaffleStatus, setIsUpdatingRaffleStatus] = useState(false);

  const loadWhatsAppStickers = useCallback(async () => {
    setIsLoadingWhatsAppStickers(true);
    try {
      const response = await fetch(getApiUrl("/api/whatsapp/stickers"), { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || "Não foi possível carregar as figurinhas.");
      }
      const list: WhatsAppSavedSticker[] = (result?.stickers || []).map((row: any) => ({
        id: String(row.id),
        stickerUrl: String(row.sticker_url || ""),
        sourceMessageId: row.source_message_id || null,
        title: row.title || null,
        usageCount: Number(row.usage_count || 0),
        lastUsedAt: row.last_used_at || null,
        createdAt: row.created_at || null,
      })).filter((item: WhatsAppSavedSticker) => Boolean(item.stickerUrl));
      setWhatsappStickers(list);
    } catch (error: any) {
      console.error("[WhatsApp Stickers] Falha ao carregar:", error);
      toast.error(error?.message || "Não foi possível carregar as figurinhas.");
    } finally {
      setIsLoadingWhatsAppStickers(false);
    }
  }, []);

  const openWhatsAppStickerTray = useCallback(() => {
    setIsWhatsAppStickerTrayOpen(true);
    void loadWhatsAppStickers();
  }, [loadWhatsAppStickers]);

  const saveWhatsAppSticker = useCallback(async (message: DirectMessage) => {
    const stickerUrl =
      message.mediaUrl ||
      message.text.match(/^\[sticker:(https?:\/\/[^\]]+)\]/)?.[1] ||
      "";
    if (!stickerUrl) {
      toast.error("Essa figurinha não possui arquivo disponível para salvar.");
      return;
    }
    try {
      const response = await fetch(getApiUrl("/api/whatsapp/stickers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stickerUrl,
          sourceMessageId: message.id,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true || !result?.sticker) {
        throw new Error(result?.error || "Não foi possível salvar a figurinha.");
      }
      const saved: WhatsAppSavedSticker = {
        id: String(result.sticker.id),
        stickerUrl: String(result.sticker.sticker_url),
        sourceMessageId: result.sticker.source_message_id || null,
        title: result.sticker.title || null,
        usageCount: Number(result.sticker.usage_count || 0),
        lastUsedAt: result.sticker.last_used_at || null,
        createdAt: result.sticker.created_at || null,
      };
      setWhatsappStickers((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id && item.stickerUrl !== saved.stickerUrl),
      ]);
      toast.success("Figurinha salva.");
    } catch (error: any) {
      console.error("[WhatsApp Stickers] Falha ao salvar:", error);
      toast.error(error?.message || "Não foi possível salvar a figurinha.");
    }
  }, []);

  const deleteWhatsAppSticker = useCallback(async (sticker: WhatsAppSavedSticker) => {
    try {
      const response = await fetch(getApiUrl(`/api/whatsapp/stickers/${encodeURIComponent(sticker.id)}`), {
        method: "DELETE",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || "Não foi possível excluir a figurinha.");
      }
      setWhatsappStickers((current) => current.filter((item) => item.id !== sticker.id));
    } catch (error: any) {
      console.error("[WhatsApp Stickers] Falha ao excluir:", error);
      toast.error(error?.message || "Não foi possível excluir a figurinha.");
    }
  }, []);

  const sendWhatsAppSticker = useCallback(async (sticker: WhatsAppSavedSticker) => {
    if (!activeChat || !isWhatsAppLikeType(activeChat.type) || sendingStickerId) return;
    const conversationId = activeChat.id;
    const tempId = `temp_sticker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const optimistic: DirectMessage = {
      id: tempId,
      senderId: "me",
      text: `[sticker:${sticker.stickerUrl}]`,
      mediaUrl: sticker.stickerUrl,
      mediaType: "sticker",
      createdAt: formatMessageTime(nowIso),
      timestamp: Date.now(),
      sentDate: nowIso,
      isMine: true,
      status: "sending",
    };

    setSendingStickerId(sticker.id);
    setMessages((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), optimistic],
    }));
    const applyStickerConversationPreview = (prev: DirectConversation[]) => {
      const target = prev.find((item) => item.id === conversationId);
      if (!target) return prev;
      const updated: DirectConversation = {
        ...target,
        lastMessage: "Você: Figurinha",
        lastActive: formatMessageTime(nowIso),
        lastMessageAt: nowIso,
        lastSender: "me",
        lastStatus: "sent",
        unread: false,
        seenAt: undefined,
      };
      return [updated, ...prev.filter((item) => item.id !== conversationId)];
    };
    if (activeChat.type === "whatsapp2") {
      setWhatsApp2Conversations(applyStickerConversationPreview);
    } else {
      setConversations(applyStickerConversationPreview);
    }
    setActiveChat((prev) =>
      prev && prev.id === conversationId
        ? {
            ...prev,
            lastMessage: "Você: Figurinha",
            lastActive: formatMessageTime(nowIso),
            lastMessageAt: nowIso,
            lastSender: "me",
            lastStatus: "sent",
            unread: false,
            seenAt: undefined,
          }
        : prev
    );

    try {
      const response = await fetch(getApiUrl(`/api/instagram/messages/${conversationId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: optimistic.text,
          message: optimistic.text,
          stickerUrl: sticker.stickerUrl,
          mediaType: "sticker",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || result?.message || "Falha ao enviar figurinha.");
      }
      const confirmedId = String(result?.message?.id || tempId);
      setMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((message) =>
          message.id === tempId ? { ...message, id: confirmedId, status: "sent" } : message
        ),
      }));
      setWhatsappStickers((current) => current.map((item) =>
        item.id === sticker.id
          ? { ...item, usageCount: (item.usageCount || 0) + 1, lastUsedAt: new Date().toISOString() }
          : item
      ));
    } catch (error: any) {
      console.error("[WhatsApp Stickers] Falha no envio:", error);
      setMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((message) =>
          message.id === tempId ? { ...message, status: "failed" } : message
        ),
      }));
      toast.error(error?.message || "Falha ao enviar figurinha.");
    } finally {
      setSendingStickerId(null);
    }
  }, [activeChat, sendingStickerId]);

  useEffect(() => {
    setMediaObservationText("");
    setIsSubmittingMediaObservation(false);
    setWhatsappMessageMenu(null);
    setIsWhatsAppContactInfoOpen(false);
    setIsWhatsAppStickerTrayOpen(false);
  }, [activeChat?.id]);

  // Estados do Funil de Etapas e Checklists (Check-ups)
  const [stageFilter, setStageFilter] = useState<string>("todas"); // "todas" | "concluidos" | stageId
  const [isStageFilterOpen, setIsStageFilterOpen] = useState(false);
  const stageFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const [aiFilter, setAiFilter] = useState<"todas" | "com_ia" | "sem_ia">("todas");

  useEffect(() => {
    if (!isStageFilterOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!stageFilterMenuRef.current?.contains(event.target as Node)) {
        setIsStageFilterOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isStageFilterOpen]);

  const chatStages = useChatStages(activeChat?.id, { loadAllProgresses: false });
  const {
    stages,
    chatDetail,
    chatDetailResolvedConversationId,
    toggleItem,
    toggleObjective,
    advanceStage,
    setStage,
    toggleConverted,
    markItemCompletedByVaultItem,
    markItemCompletedByExactText,
  } = chatStages;

  // Envio de mensagem automática disparado pelo Piloto Automático
  const handleSendAutoPilotMessage = async (conversationId: string, text: string) => {
    const endpoint = getApiUrl(`/api/instagram/messages/${conversationId}`);

    const isAudioMsg = text.startsWith("[audio:");
    const audioUrl = isAudioMsg ? text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;
    const tempId = `temp_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const timeFormatted = formatMessageTime(new Date());

    void markItemCompletedByExactText(text.trim());

    const optimisticMsg: DirectMessage = {
      id: tempId,
      senderId: "me",
      text,
      audioTranscript: isAudioMsg ? "🎙️ Mensagem de voz" : undefined,
      mediaType: isAudioMsg ? "audio" : undefined,
      mediaUrl: audioUrl,
      timestamp: Date.now(),
      sentDate: nowIso,
      createdAt: timeFormatted,
      isMine: true,
      status: "sending",
    };

    setMessages((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), optimisticMsg],
    }));

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessage: `Você: ${isAudioMsg ? "🎙️ Mensagem de voz" : text}`,
              lastActive: timeFormatted,
              lastMessageAt: nowIso,
              unread: false,
              lastSender: "me",
              lastStatus: "sent",
              seenAt: undefined,
            }
          : c
      )
    );

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          text,
          audioUrl,
          mediaType: isAudioMsg ? "audio" : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Falha no envio do piloto automático: status ${res.status}`);
      }

      const data = await res.json();
      const confirmedMid = data?.message?.id || data?.id || tempId;

      setMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m.id === tempId ? { ...m, id: confirmedMid, status: "sent" } : m
        ),
      }));
    } catch (err) {
      console.error(`[AutoPilot] Erro ao enviar para ${conversationId}:`, err);
      setMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m.id === tempId ? { ...m, status: "failed" } : m
        ),
      }));
      throw err;
    }
  };

  const loadInstagramMessagesDirect = useCallback(async (conversationId: string): Promise<DirectMessage[] | null> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from("instagram_messages")
      .select("id, sender_id, text, timestamp, is_mine, status, seen_at, deliver_at, reply_to_message_id, media_url, media_type, provider_type, attachment_metadata, message_metadata, audio_transcript, reaction_emoji, reaction_at")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(150);

    if (error) {
      console.warn(`[Chat] Leitura direta do Supabase falhou para ${conversationId}:`, error.message);
      return null;
    }

    const rows = [...(data || [])]
      .reverse()
      .filter((row: any) => !(
        String(conversationId).startsWith("wa:")
        && String(row.text || "").trim().toLowerCase() === "[whatsapp:reaction]"
      ));
    const rawById = new Map(rows.map((row: any) => [String(row.id), row]));

    const formatted = rows.map((row: any): DirectMessage => {
      let text = String(row.text || "");
      let mediaUrl = row.media_url || undefined;
      let mediaType = row.media_type as DirectMessage["mediaType"];
      let attachment = normalizeWhatsApp2Attachment(row.attachment_metadata, mediaType
        ? {
            kind: mediaType,
            providerType: row.provider_type || null,
            mediaUrl: mediaUrl || null,
            downloadable: Boolean(mediaUrl),
            previewable: ["audio", "image", "video", "sticker"].includes(mediaType),
          }
        : undefined,
      );
      const isSharedMedia = isInstagramSharedMediaText(text);

      if (!mediaUrl && text) {
        const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
        const imageMatch = text.match(/^\[image:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
        const videoMatch = text.match(/^\[video:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
        const stickerMatch = text.match(/^\[sticker:(https?:\/\/[^\]]+)\]$/);
        const shareMatch = text.match(/^\[share:(https?:\/\/[^\]]+)\]$/);
        if (audioMatch) {
          mediaUrl = audioMatch[1];
          mediaType = "audio";
          text = "🎙️ Mensagem de voz";
        } else if (imageMatch) {
          mediaUrl = imageMatch[1];
          mediaType = "image";
          text = imageMatch[2] || "📷 Foto";
        } else if (videoMatch) {
          mediaUrl = videoMatch[1];
          mediaType = "video";
          text = videoMatch[2] || "🎥 Vídeo";
        } else if (stickerMatch) {
          mediaUrl = stickerMatch[1];
          mediaType = "sticker";
          text = "Figurinha";
        } else if (shareMatch) {
          mediaUrl = shareMatch[1];
          mediaType = "video";
        }
      }

      if (isSharedMedia) {
        mediaType = "video";
        text = "🎞️ Reel ou publicação compartilhada";
      } else if (mediaType === "audio" && (!text || text.startsWith("[audio:"))) {
        text = "🎙️ Mensagem de voz";
      } else if (mediaType === "image" && (!text || text.startsWith("[image:"))) {
        text = "📷 Foto";
      } else if (mediaType === "video" && (!text || text.startsWith("[video:"))) {
        text = "🎥 Vídeo";
      } else if (mediaType === "sticker" && (!text || text.startsWith("[sticker:"))) {
        text = "Figurinha";
      }

      const replyToMessageId = row.reply_to_message_id || null;
      let replyTo: DirectMessage["replyTo"] = undefined;
      if (replyToMessageId) {
        const quoted: any = rawById.get(String(replyToMessageId));
        if (quoted) {
          let quotedText = String(quoted.text || "");
          if (quotedText.startsWith("[share:")) quotedText = "🎞️ Reel compartilhado";
          else if (quotedText.startsWith("[image:")) quotedText = "📷 Foto";
          else if (quotedText.startsWith("[audio:")) quotedText = "🎙️ Mensagem de voz";
          else if (quotedText.startsWith("[video:")) quotedText = "🎥 Vídeo";
          else if (quotedText.startsWith("[sticker:")) quotedText = "Figurinha";
          replyTo = {
            id: String(quoted.id),
            senderId: quoted.is_mine ? "me" : String(quoted.sender_id || ""),
            senderName: quoted.is_mine ? "Você" : "Contato",
            text: quotedText || "Mensagem",
          };
        } else {
          replyTo = {
            id: String(replyToMessageId),
            senderId: "",
            senderName: row.is_mine ? "Contato" : "Você",
            text: "Mensagem citada",
          };
        }
      }

      if (mediaType) {
        attachment = normalizeWhatsApp2Attachment(attachment, {
          kind: mediaType,
          providerType: row.provider_type || null,
          mediaUrl: mediaUrl || null,
          downloadable: Boolean(mediaUrl),
          previewable: ["audio", "image", "video", "sticker"].includes(mediaType),
        });
        if (attachment && mediaUrl && attachment.mediaUrl !== mediaUrl) {
          attachment = { ...attachment, mediaUrl };
        }
      }

      const timestampMs = row.timestamp ? getMessageTimestampMs(row.timestamp) : Date.now();
      const deliverAtMs = row.deliver_at ? new Date(row.deliver_at).getTime() : undefined;

      return {
        id: String(row.id),
        senderId: row.is_mine ? "me" : String(row.sender_id || ""),
        text,
        mediaUrl,
        mediaType,
        attachment,
        nativeMetadata:
          row.message_metadata && typeof row.message_metadata === "object"
            ? (row.message_metadata as WhatsApp2MessageMetadata)
            : undefined,
        audioTranscript: row.audio_transcript || undefined,
        reactionEmoji: row.reaction_emoji || undefined,
        reactionAt: row.reaction_at || undefined,
        createdAt: formatMessageTime(row.timestamp),
        timestamp: timestampMs,
        sentDate: row.timestamp || new Date(timestampMs).toISOString(),
        isMine: Boolean(row.is_mine),
        status: row.status || "sent",
        seenAt: row.seen_at || undefined,
        deliverAt: deliverAtMs,
        delaySeconds: deliverAtMs ? Math.max(0, Math.ceil((deliverAtMs - Date.now()) / 1000)) : undefined,
        replyToMessageId,
        replyTo,
      };
    });

    return deduplicateMessages(formatted);
  }, []);

  // Busca e sincroniza mensagens de uma conversa em segundo plano (sem exigir visualização na tela)
  const fetchConversationMessages = useCallback(async (conversationId: string) => {
    await runDeduplicatedConversationFetch(
      messageFetchesRef.current,
      conversationId,
      async () => {
        let incoming = await loadInstagramMessagesDirect(conversationId);

        if (incoming === null) {
          const res = await fetch(getApiUrl(`/api/instagram/messages/${conversationId}`), { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          incoming = Array.isArray(data?.messages) ? data.messages : [];
        }

        const resolvedIncoming = incoming ?? [];
        const newestIncoming = resolvedIncoming.reduce((latest, message) => Math.max(
          latest,
          getMessageTimestampMs(message.timestamp || message.sentDate || message.createdAt),
        ), 0);
        if (newestIncoming > 0) latestFetchedMessageAtRef.current.set(conversationId, newestIncoming);
        setMessages((prev) => ({
          ...prev,
          [conversationId]: deduplicateMessages([...(prev[conversationId] || []), ...resolvedIncoming]),
        }));
      },
      () => {
        if (process.env.NODE_ENV !== "production") console.debug("chat_fetch_deduped", { conversationId });
      },
    ).catch((err) => {
      console.warn(`[AutoPilot] Erro ao sincronizar mensagens de ${conversationId} em segundo plano:`, err);
    });
  }, [conversations, activeChat, loadInstagramMessagesDirect]);

  // Sincronização manual sob demanda com a Meta Graph API
  const handleManualSyncChat = useCallback(async () => {
    if (!activeChat || isManualSyncing) return;
    setIsManualSyncing(true);
    try {
      if (activeChat.type === "instagram") {
        const conversationId = activeChat.id;
        await messageFetchesRef.current.get(conversationId)?.catch(() => undefined);
        await runDeduplicatedConversationFetch(messageFetchesRef.current, conversationId, async () => {
          const res = await fetch(getApiUrl(`/api/instagram/messages/${conversationId}?sync=true`));
          if (!res.ok) return;
          const data = await res.json();
          if (!data?.messages) return;
          setMessages((prev) => ({
            ...prev,
            [conversationId]: deduplicateMessages(data.messages),
          }));
        });
      } else {
        await fetchConversationMessages(activeChat.id);
      }
    } catch (err) {
      console.warn("Erro ao sincronizar manualmente o chat:", err);
    } finally {
      setTimeout(() => setIsManualSyncing(false), 600);
    }
  }, [activeChat, isManualSyncing, fetchConversationMessages]);

  // isRealtimeHealthy: sincronizado com isRealtimeConnected via useEffect abaixo.
  // O setInterval de 30s lê o ref dinamicamente, portanto a atualização posterior funciona.
  const [isRealtimeHealthyForAutopilot, setIsRealtimeHealthyForAutopilot] = useState(true);
  const autoPilotConversations = useMemo(
    () => [...conversations, ...whatsapp2Conversations],
    [conversations, whatsapp2Conversations]
  );
  // Instância do Piloto Automático Inteligente com Fila Sequencial e Debounce
  const autoPilot = useAutoPilot({
    conversations: autoPilotConversations,
    messages,
    onSendMessage: handleSendAutoPilotMessage,
    onRefreshMessages: fetchConversationMessages,
    onStageChange: async (convId) => {
      await chatStages.refresh();
    },
    isRealtimeHealthy: isRealtimeHealthyForAutopilot,
  });
  const autoPilotRef = useRef(autoPilot);
  useEffect(() => {
    autoPilotRef.current = autoPilot;
  }, [autoPilot]);

  const handleToggleActiveChatAi = useCallback(async () => {
    if (!activeChat) return;
    const globalEnabled = autoPilot.config?.isEnabledGlobally === false
      ? false
      : await autoPilot.isGlobalAutoPilotEnabled();
    if (!globalEnabled) {
      setIsGlobalAutoPilotDisabledModalOpen(true);
      return;
    }
    if (autoPilot.chatStates[activeChat.id]?.isEnabled) {
      await autoPilot.toggleAutoPilotForChat(activeChat.id, false);
    } else {
      setIsAutoPilotActivationModalOpen(true);
    }
  }, [activeChat, autoPilot]);

  const submitMediaObservation = useCallback(async (
    media: { kind: "video" | "image"; messageId: string },
  ) => {
    if (!activeChat?.id || !mediaObservationText.trim() || isSubmittingMediaObservation) return;
    setIsSubmittingMediaObservation(true);
    try {
      const response = await brainOperatorFetch("/operator/brain/media-observation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeChat.id,
          messageId: media.messageId,
          observation: mediaObservationText.trim(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Não foi possível registrar a observação.");
      }
      setMediaObservationText("");
      toast.success("Observação registrada. O Brain vai retomar a conversa.");
      await autoPilot.refreshState(true);
      await fetchConversationMessages(activeChat.id).catch(() => undefined);
    } catch (error: any) {
      console.error("[Media Observation] Falha:", error);
      toast.error(error?.message || "Não foi possível registrar a observação.");
    } finally {
      setIsSubmittingMediaObservation(false);
    }
  }, [
    activeChat?.id,
    autoPilot,
    fetchConversationMessages,
    isSubmittingMediaObservation,
    mediaObservationText,
  ]);

  const handleSetRaffleStatus = useCallback(async (nextStatus: RaffleCommercialStatus) => {
    const conversationId = activeChat?.id;
    if (!conversationId || chatDetail?.isConverted !== true || isUpdatingRaffleStatus) return;

    const previousStatus = normalizeRaffleCommercialStatus(activeChat?.raffleStatus);
    const applyLocalStatus = (status: RaffleCommercialStatus) => {
      setActiveChat((prev) =>
        prev && prev.id === conversationId ? { ...prev, raffleStatus: status } : prev
      );
      const apply = (prev: DirectConversation[]) =>
        prev.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, raffleStatus: status } : conversation
        );
      setConversations(apply);
      setWhatsApp2Conversations(apply);
    };

    setIsUpdatingRaffleStatus(true);
    applyLocalStatus(nextStatus);
    try {
      const response = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "raffle_status",
          conversationId,
          raffleStatus: nextStatus,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Não foi possível atualizar o status da rifa.");
      }
      const confirmedStatus = normalizeRaffleCommercialStatus(result?.raffleStatus);
      applyLocalStatus(confirmedStatus);
      toast.success(`Rifa: ${raffleCommercialStatusLabel(confirmedStatus)}`);
    } catch (error: any) {
      applyLocalStatus(previousStatus);
      console.error("[Raffle Status] Falha:", error);
      toast.error(error?.message || "Não foi possível atualizar o status da rifa.");
    } finally {
      setIsUpdatingRaffleStatus(false);
    }
  }, [
    activeChat?.id,
    activeChat?.raffleStatus,
    chatDetail?.isConverted,
    isUpdatingRaffleStatus,
  ]);

  // Push remoto crítico: o frontend apenas registra este dispositivo.
  // Os alertas são enviados pelo backend mesmo com o Vendeo fechado.
  const mobileNotifications = useMobileNotifications();
  const mobileNotificationsRef = useRef(mobileNotifications);
  useEffect(() => {
    mobileNotificationsRef.current = mobileNotifications;
  }, [mobileNotifications]);
  const sendCriticalNotificationOnce = useCallback(async (
    _eventKey: string,
    send: () => Promise<boolean>,
  ) => send(), []);

  // Menu de Opções ao Clicar e Segurar (Long Press)
  const [selectedChatForActionSheet, setSelectedChatForActionSheet] = useState<DirectConversation | null>(null);
  const [whatsapp2ControlBusy, setWhatsapp2ControlBusy] = useState<"loading" | "block" | "lock" | null>(null);
  const whatsapp2ControlRequestIdRef = useRef(0);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressActiveRef = useRef<boolean>(false);
  const touchStartCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Estados de Gravação e Upload de Áudio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Estados de Foto/Imagem com Prévia antes do Envio
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Preservação de Histórico, Navegação e Scroll da Lista
  const conversationsScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef<number>(0);
  const isPushedToHistoryRef = useRef<boolean>(false);

  // Registro atômico e persistente do timestamp de leitura/abertura de cada conversa
  const readChatTimestampsRef = useRef<Record<string, number>>(getStoredReadChatTimestamps());

  // Registro persistente e síncrono de conversas restringidas para proteção contra polling
  const restrictedChatIdsRef = useRef<Set<string>>(getStoredRestrictedChatIds());

  // Estado da mensagem sendo respondida (Quote Reply do Instagram)
  const [replyingToMessage, setReplyingToMessage] = useState<DirectMessage | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const messageElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const replyHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedReplyTargetId, setHighlightedReplyTargetId] = useState<string | null>(null);

  // Sub-filtro da aba Pedidos no Instagram: todos os pedidos ou contas restringidas
  const [pedidosSubFilter, setPedidosSubFilter] = useState<"todos_pedidos" | "restringidos">("todos_pedidos");

  // Referência atômica para o ID do chat ativo para evitar stale closures em eventos WebSocket
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChat?.id || null;

  // Rastreamento síncrono da data/hora (ms) do último envio agendado por conversa
  const latestScheduledDeliverAtRef = useRef<Record<string, number>>({});

  // Helper central de conferência da fila de agendamento por conversa
  const getScheduledQueueInfo = (convId: string) => {
    const chatMsgs = messages[convId] || [];
    const now = Date.now();
    const scheduledMsgs = chatMsgs.filter(
      (m) => m.isMine && m.status === "sending" && typeof m.deliverAt === "number" && m.deliverAt > now
    );
    const maxState = scheduledMsgs.length > 0 ? Math.max(...scheduledMsgs.map((m) => m.deliverAt!)) : 0;
    const maxRef = latestScheduledDeliverAtRef.current[convId] || 0;
    const lastDeliverAt = Math.max(maxState, maxRef > now ? maxRef : 0);
    const hasScheduled = lastDeliverAt > now;
    const remainingSeconds = hasScheduled ? Math.max(0, Math.ceil((lastDeliverAt - now) / 1000)) : 0;

    return {
      hasScheduled,
      lastDeliverAt: hasScheduled ? lastDeliverAt : now,
      remainingSeconds,
      count: scheduledMsgs.length,
    };
  };

  // Função sênior unificada para verificar se uma conversa está restrita
  const isChatRestricted = useCallback((c: DirectConversation) => {
    // O estado da conversa/banco é canônico. localStorage não pode esconder chats
    // por carregar IDs antigos de uma sessão anterior.
    return Boolean(c.isRestricted || c.status === "restricted");
  }, []);

  // Função sênior unificada para verificação de não lida
  // Regra:
  // - Se respondeu (lastSender === "me"): nunca exibe bolinha nem sininho
  // - Se o chat está ativo/aberto na tela agora: não exibe bolinha
  // - Se o contato mandou mensagem nova após a última leitura: BOLINHA AZUL!
  // - Se já foi lida e ainda não foi respondida: SININHO!
  const isConversationUnread = useCallback((c: DirectConversation) => {
    if (c.lastSender === "me") return false;
    if (activeChatIdRef.current === c.id) return false;

    const lastMsgTime = getMessageTimestampMs(c.lastMessageAt || c.lastActive);
    const readTime = readChatTimestampsRef.current[c.id];

    if (readTime && lastMsgTime > 0) {
      // Se a última mensagem do contato chegou depois do momento que o usuário abriu/leu o chat: NÃO LIDA (Bolinha Azul)
      if (lastMsgTime > readTime + 1000) {
        return true;
      }
      // Se a mensagem foi recebida antes ou no momento da leitura: lida (Sininho)
      return false;
    }

    return Boolean(c.unread);
  }, []);

  // Handlers do Gesto de Clicar e Segurar (Long Press)
  const startLongPress = useCallback((conv: DirectConversation, clientX: number, clientY: number) => {
    isLongPressActiveRef.current = false;
    touchStartCoordsRef.current = { x: clientX, y: clientY };

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(isWhatsAppLikeType(conv.type) ? 12 : 40); } catch {}
      }
      setSelectedChatForActionSheet(conv);
    }, isWhatsAppLikeType(conv.type) ? 390 : 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartCoordsRef.current = null;
  }, []);

  const handleTouchMoveItem = useCallback((e: React.TouchEvent) => {
    if (!touchStartCoordsRef.current) return;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartCoordsRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartCoordsRef.current.y);
    if (deltaX > 8 || deltaY > 8) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const patchWhatsApp2ControlState = useCallback((
    conversationId: string,
    patch: Pick<DirectConversation, "archived" | "isLocked" | "isBlocked">,
  ) => {
    const apply = (conversation: DirectConversation) =>
      conversation.id === conversationId
        ? { ...conversation, ...patch }
        : conversation;

    setWhatsApp2Conversations((current) => current.map(apply));
    setConversations((current) => current.map(apply));
    setActiveChat((current) =>
      current?.id === conversationId ? { ...current, ...patch } : current
    );
    setSelectedChatForActionSheet((current) =>
      current?.id === conversationId ? { ...current, ...patch } : current
    );
  }, []);

  const selectedWhatsApp2ControlChatId =
    selectedChatForActionSheet?.type === "whatsapp2"
      ? selectedChatForActionSheet.id
      : null;

  useEffect(() => {
    if (!selectedWhatsApp2ControlChatId) {
      setWhatsapp2ControlBusy(null);
      return;
    }

    const requestId = ++whatsapp2ControlRequestIdRef.current;
    const providerId = selectedWhatsApp2ControlChatId.replace(/^wa2:/, "");
    setWhatsapp2ControlBusy("loading");

    void getWhatsApp2ChatState(providerId)
      .then((state) => {
        if (whatsapp2ControlRequestIdRef.current !== requestId) return;
        patchWhatsApp2ControlState(selectedWhatsApp2ControlChatId, {
          archived: Boolean(state.archived),
          isLocked: Boolean(state.isLocked),
          isBlocked: Boolean(state.isBlocked),
        });
      })
      .catch((error) => {
        if (whatsapp2ControlRequestIdRef.current !== requestId) return;
        console.error("[WhatsApp 2] Falha ao carregar estado real da conversa:", error);
        toast.error(error?.message || "Não foi possível consultar o estado da conversa no WhatsApp.");
      })
      .finally(() => {
        if (whatsapp2ControlRequestIdRef.current === requestId) {
          setWhatsapp2ControlBusy(null);
        }
      });

    return () => {
      if (whatsapp2ControlRequestIdRef.current === requestId) {
        whatsapp2ControlRequestIdRef.current += 1;
      }
    };
  }, [selectedWhatsApp2ControlChatId, patchWhatsApp2ControlState]);

  const handleToggleWhatsApp2Block = useCallback(async (chat: DirectConversation) => {
    if (chat.type !== "whatsapp2" || whatsapp2ControlBusy) return;

    const providerId = chat.providerId || chat.id.replace(/^wa2:/, "");
    const nextBlocked = !Boolean(chat.isBlocked);
    setWhatsapp2ControlBusy("block");

    try {
      const result = await setWhatsApp2ChatBlocked(providerId, nextBlocked);
      patchWhatsApp2ControlState(chat.id, {
        archived: Boolean(chat.archived),
        isLocked: Boolean(chat.isLocked),
        isBlocked: Boolean(result.isBlocked),
      });
      toast.success(result.isBlocked ? "Contato bloqueado no WhatsApp." : "Contato desbloqueado no WhatsApp.");
      setSelectedChatForActionSheet(null);
    } catch (error: any) {
      console.error("[WhatsApp 2] Falha ao alterar bloqueio:", error);
      toast.error(error?.message || "Não foi possível alterar o bloqueio no WhatsApp.");
    } finally {
      setWhatsapp2ControlBusy(null);
    }
  }, [patchWhatsApp2ControlState, whatsapp2ControlBusy]);

  const handleToggleWhatsApp2Lock = useCallback(async (chat: DirectConversation) => {
    if (chat.type !== "whatsapp2" || whatsapp2ControlBusy) return;

    const providerId = chat.providerId || chat.id.replace(/^wa2:/, "");
    const nextLocked = !Boolean(chat.isLocked);
    setWhatsapp2ControlBusy("lock");

    try {
      const result = await setWhatsApp2ChatLocked(providerId, nextLocked);
      patchWhatsApp2ControlState(chat.id, {
        archived: Boolean(chat.archived),
        isLocked: Boolean(result.isLocked),
        isBlocked: Boolean(chat.isBlocked),
      });
      toast.success(result.isLocked ? "Conversa trancada no WhatsApp." : "Conversa destrancada no WhatsApp.");
      setSelectedChatForActionSheet(null);
    } catch (error: any) {
      console.error("[WhatsApp 2] Falha ao alterar Chat Lock:", error);
      toast.error(error?.message || "Não foi possível alterar o Chat Lock no WhatsApp.");
    } finally {
      setWhatsapp2ControlBusy(null);
    }
  }, [patchWhatsApp2ControlState, whatsapp2ControlBusy]);

  const handleToggleUnreadStatus = useCallback((conv: DirectConversation) => {
    const isCurrentlyUnread = isConversationUnread(conv);
    const nextUnread = !isCurrentlyUnread;

    if (nextUnread) {
      delete readChatTimestampsRef.current[conv.id];
    } else {
      readChatTimestampsRef.current[conv.id] = Date.now();
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          "vendeo_read_chat_timestamps",
          JSON.stringify(readChatTimestampsRef.current)
        );
      } catch {}
    }

    const applyUnread = (prev: DirectConversation[]) =>
      prev.map((c) =>
        c.id === conv.id
          ? { ...c, unread: nextUnread, lastSender: nextUnread ? "them" : c.lastSender }
          : c
      );
    setConversations(applyUnread);
    setWhatsApp2Conversations(applyUnread);

    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      supabase
        .from("instagram_conversations")
        .update({ unread: nextUnread, updated_at: new Date().toISOString() })
        .eq("id", conv.id)
        .then(() => {});
    }

    toast.success(nextUnread ? "Conversa marcada como não lida." : "Conversa marcada como lida.");
    setSelectedChatForActionSheet(null);
  }, [isConversationUnread]);

  const markConversationAsReadLocally = useCallback((chatId: string) => {
    if (!chatId) return;
    readChatTimestampsRef.current[chatId] = Date.now();
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          "vendeo_read_chat_timestamps",
          JSON.stringify(readChatTimestampsRef.current)
        );
      } catch {}
    }
  }, []);

  const handleToggleRestricted = useCallback(async (chat: DirectConversation) => {
    const currentlyRestricted = isChatRestricted(chat);
    const nextRestricted = !currentlyRestricted;
    const nextStatus = nextRestricted ? ("restricted" as const) : ("active" as const);

    // 1. Atualiza Set em memória e localStorage de forma síncrona
    if (nextRestricted) {
      restrictedChatIdsRef.current.add(chat.id);
    } else {
      restrictedChatIdsRef.current.delete(chat.id);
    }
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          "vendeo_restricted_chats",
          JSON.stringify(Array.from(restrictedChatIdsRef.current))
        );
      } catch {}
    }

    // 2. Atualização imediata no estado local do React
    setConversations((prev) =>
      prev.map((c) =>
        c.id === chat.id
          ? { ...c, isRestricted: nextRestricted, status: nextStatus }
          : c
      )
    );

    setActiveChat((prev) =>
      prev && prev.id === chat.id
        ? { ...prev, isRestricted: nextRestricted, status: nextStatus }
        : prev
    );

    if (nextRestricted) {
      toast.success(`Conta @${chat.username} movida para Pedidos (Restringidos).`);
    } else {
      toast.success(`Restrição de @${chat.username} removida.`);
    }

    // 3. Grava no banco Supabase em tempo real (< 50ms)
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      supabase
        .from("instagram_conversations")
        .update({
          is_restricted: nextRestricted,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", chat.id)
        .then(() => {});
    }

    // 4. Notifica a API backend em background
    const restrictEndpoint = chat.type === "tinder"
      ? getApiUrl(`/api/tinder/matches/${chat.id}/restrict`)
      : getApiUrl(`/api/instagram/conversations/${chat.id}/restrict`);
    fetch(restrictEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRestricted: nextRestricted, restrict: nextRestricted }),
    }).catch(() => {});
  }, [isChatRestricted]);

  const cancelPendingImage = useCallback(() => {
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  }, [pendingImage]);

  const checkInstagramStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/instagram/config"), { cache: "no-store" });
      if (!res.ok) {
        console.warn("[Instagram] Falha temporária ao verificar conexão; mantendo último estado.", res.status);
        return;
      }
      const data = await res.json();
      if (typeof data?.isConnected === "boolean") {
        setIsInstagramConnected(data.isConnected);
      }
    } catch (error) {
      console.warn("[Instagram] Status indisponível temporariamente; mantendo último estado.", error);
    }
  }, []);

  // Scroll do histórico: a abertura do chat é atômica e nunca anima.
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [chatViewportReadyId, setChatViewportReadyId] = useState<string | null>(null);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesScrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Filtros
  const [activeChannel, setActiveChannel] = useState<InboxChannel>(
    IS_WHATSAPP2_REMOTE_BUILD ? "whatsapp2" : "instagram"
  );
  const isWhatsAppInboxChannel = activeChannel === "whatsapp2";
  const isTinderInboxChannel = activeChannel === "tinder";
  const [tinderFilter, setTinderFilter] = useState<TinderFilter>("todos");
  const [tinderSession, setTinderSession] = useState<TinderSession | null>(null);
  const [isTinderProfileOpen, setIsTinderProfileOpen] = useState(false);
  const [isTinderConnectOpen, setIsTinderConnectOpen] = useState(false);
  const [selectedTinderProfile, setSelectedTinderProfile] = useState<TinderProfileData | null>(null);
  const [instaFilter, setInstaFilter] = useState<InstagramFilter>("todos");
  const [whatsappResponseFilter, setWhatsappResponseFilter] = useState<WhatsAppResponseFilter>("todos");
  const [whatsappQuickFilter, setWhatsappQuickFilter] = useState<WhatsAppQuickFilter>("todas");
  const [whatsappStageFilter, setWhatsappStageFilter] = useState<string>("todas");
  const [showWhatsAppStages, setShowWhatsAppStages] = useState(false);

  useEffect(() => {
    if (activeChannel !== "whatsapp2") return;

    let cancelled = false;
    let timerId: number | null = null;

    const reconcileInbox = async (force = false) => {
      const now = Date.now();
      if (!force && now - whatsapp2InboxLastReconcileAtRef.current < 30_000) return;
      whatsapp2InboxLastReconcileAtRef.current = now;
      await loadWhatsApp2Conversations();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const delayMs = isRealtimeConnectedRef.current ? 120_000 : 30_000;
      timerId = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await reconcileInbox();
        }
        scheduleNext();
      }, delayMs);
    };

    // No build remoto a carga inicial já acontece no efeito de inicialização.
    // Ao alternar para WhatsApp 2 em outro build, reconcilia imediatamente.
    if (!IS_WHATSAPP2_REMOTE_BUILD) {
      void reconcileInbox(true);
    }

    const handleVisible = () => {
      if (document.visibilityState !== "visible") return;
      void reconcileInbox();
    };
    const handleFocus = () => void reconcileInbox();

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    scheduleNext();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
    };
  }, [activeChannel, loadWhatsApp2Conversations]);

  useEffect(() => {
    if (activeChannel !== "tinder") return;

    let cancelled = false;
    let timerId: number | null = null;

    const reconcileTinder = async () => {
      await Promise.all([checkTinderStatus(), loadTinderConversations()]);
    };

    void reconcileTinder();

    const scheduleNext = () => {
      if (cancelled) return;
      timerId = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await reconcileTinder();
        }
        scheduleNext();
      }, 45_000);
    };

    const handleVisible = () => {
      if (document.visibilityState !== "visible") return;
      void reconcileTinder();
    };
    const handleFocus = () => void reconcileTinder();

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    scheduleNext();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
    };
  }, [activeChannel, checkTinderStatus, loadTinderConversations]);

  useEffect(() => {
    if (activeChat?.type !== "whatsapp2") {
      setWhatsApp2Presence(null);
      return;
    }

    const providerId = activeChat.providerId || activeChat.id.replace(/^wa2:/, "");
    const subscriptionId = whatsapp2PresenceClientIdRef.current;
    const ACTIVITY_SHOW_DEBOUNCE_MS = 120;
    const ACTIVITY_CLEAR_DEBOUNCE_MS = 320;
    const ACTIVITY_SAFETY_TIMEOUT_MS = 8_000;
    const PRESENCE_RENEW_MS = 60_000;
    const RECOVERY_BACKOFF_MS = [1_000, 2_500, 5_000, 10_000, 20_000, 30_000];

    let cancelled = false;
    let realtimeRevision = 0;
    let activityVisible = false;
    let recoveryAttempt = 0;
    let recoveryInFlight = false;
    let recoveryBlocked = false;
    let latestPresence: WhatsApp2PresencePayload | null = null;
    let activityShowTimer: number | null = null;
    let activityClearTimer: number | null = null;
    let activitySafetyTimer: number | null = null;
    let recoveryTimer: number | null = null;

    const clearTimer = (timer: number | null) => {
      if (timer !== null) window.clearTimeout(timer);
    };

    const clearActivityTimers = () => {
      clearTimer(activityShowTimer);
      clearTimer(activityClearTimer);
      clearTimer(activitySafetyTimer);
      activityShowTimer = null;
      activityClearTimer = null;
      activitySafetyTimer = null;
    };

    const clearRecoveryTimer = () => {
      clearTimer(recoveryTimer);
      recoveryTimer = null;
    };

    const normalizePresence = (
      payload: Partial<WhatsApp2PresencePayload>,
    ): WhatsApp2PresencePayload => ({
      subscriptionId,
      chatId: providerId,
      sourceChatId: typeof payload.sourceChatId === "string" ? payload.sourceChatId : undefined,
      available: Boolean(payload.available),
      isOnline: Boolean(payload.isOnline),
      lastSeenAt: typeof payload.lastSeenAt === "string" ? payload.lastSeenAt : null,
      state: typeof payload.state === "string" ? payload.state : null,
      isTyping: Boolean(payload.isTyping),
      isRecording: Boolean(payload.isRecording),
      reason: typeof payload.reason === "string" ? payload.reason : null,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : undefined,
    });

    const applyPresence = (
      nextPresence: WhatsApp2PresencePayload,
      options?: { realtime?: boolean },
    ) => {
      if (cancelled) return;
      if (options?.realtime) realtimeRevision += 1;

      latestPresence = nextPresence;
      const hasActivity = Boolean(nextPresence.isTyping || nextPresence.isRecording);

      clearTimer(activityClearTimer);
      activityClearTimer = null;

      if (hasActivity) {
        clearTimer(activityShowTimer);
        clearTimer(activitySafetyTimer);

        activityShowTimer = window.setTimeout(() => {
          if (cancelled || latestPresence !== nextPresence) return;
          activityVisible = true;
          setWhatsApp2Presence(nextPresence);
          activityShowTimer = null;
        }, ACTIVITY_SHOW_DEBOUNCE_MS);

        activitySafetyTimer = window.setTimeout(() => {
          if (cancelled || latestPresence !== nextPresence) return;

          const safePresence: WhatsApp2PresencePayload = {
            ...nextPresence,
            state: null,
            isTyping: false,
            isRecording: false,
          };
          latestPresence = safePresence;
          activityVisible = false;
          activitySafetyTimer = null;
          setWhatsApp2Presence(safePresence);
        }, ACTIVITY_SAFETY_TIMEOUT_MS);
        return;
      }

      clearTimer(activityShowTimer);
      activityShowTimer = null;
      clearTimer(activitySafetyTimer);
      activitySafetyTimer = null;

      if (activityVisible) {
        activityClearTimer = window.setTimeout(() => {
          if (cancelled || latestPresence !== nextPresence) return;
          activityVisible = false;
          activityClearTimer = null;
          setWhatsApp2Presence(nextPresence);
        }, ACTIVITY_CLEAR_DEBOUNCE_MS);
        return;
      }

      setWhatsApp2Presence(nextPresence);
    };

    const clearEphemeralPresence = () => {
      if (cancelled) return;
      clearActivityTimers();
      activityVisible = false;

      setWhatsApp2Presence((current) => {
        if (!current || current.chatId !== providerId) return null;
        const safePresence: WhatsApp2PresencePayload = {
          ...current,
          available: Boolean(current.lastSeenAt),
          isOnline: false,
          state: null,
          isTyping: false,
          isRecording: false,
        };
        latestPresence = safePresence;
        return safePresence;
      });
    };

    const scheduleRecovery = (
      options: { immediate?: boolean; refresh?: boolean } = {},
    ) => {
      if (cancelled || recoveryBlocked || recoveryTimer !== null || recoveryInFlight) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      const immediate = options.immediate === true;
      const refresh = options.refresh !== false;
      const index = Math.min(recoveryAttempt, RECOVERY_BACKOFF_MS.length - 1);
      const delayMs = immediate ? 0 : RECOVERY_BACKOFF_MS[index];
      if (!immediate) {
        recoveryAttempt = Math.min(recoveryAttempt + 1, RECOVERY_BACKOFF_MS.length - 1);
      }

      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null;
        void recoverPresence(refresh);
      }, delayMs);
    };

    const recoverPresence = async (refresh: boolean) => {
      if (cancelled || recoveryBlocked || recoveryInFlight) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      recoveryInFlight = true;
      let shouldRetry = false;
      try {
        const subscription = await subscribeWhatsApp2Presence({
          subscriptionId,
          chatId: providerId,
          refresh,
        });
        if (cancelled || subscription.stale) return;

        const revisionBeforeSnapshot = realtimeRevision;
        const snapshot = await getWhatsApp2Presence(providerId);
        if (cancelled) return;

        recoveryAttempt = 0;
        if (realtimeRevision === revisionBeforeSnapshot) {
          applyPresence(normalizePresence(snapshot));
        }
      } catch (error) {
        if (!cancelled) {
          shouldRetry = true;
          clearEphemeralPresence();
          console.warn("[WhatsApp 2] Recuperação de presença pendente:", error);
        }
      } finally {
        recoveryInFlight = false;
        if (shouldRetry && !cancelled) {
          scheduleRecovery({ refresh: true });
        }
      }
    };

    setWhatsApp2Presence(null);

    const closeEventStream = openWhatsApp2EventStream(
      (event) => {
        whatsapp2OpenChatEventHandlerRef.current(event);
        if (cancelled || event.type !== "presence") return;
        const payload = event.payload as Partial<WhatsApp2PresencePayload> | undefined;
        if (!payload) return;
        if (payload.subscriptionId !== subscriptionId || payload.chatId !== providerId) return;

        applyPresence(normalizePresence(payload), { realtime: true });
      },
      {
        onOpen: () => {
          whatsapp2EventStreamHealthyRef.current = true;
          recoveryBlocked = false;
          scheduleRecovery({ immediate: true, refresh: true });
        },
        onError: () => {
          whatsapp2EventStreamHealthyRef.current = false;
          clearEphemeralPresence();
          scheduleRecovery({ refresh: true });
        },
        onStatus: (gatewayStatus) => {
          const status = String(gatewayStatus.status || "");
          if (status === "ready") {
            whatsapp2EventStreamHealthyRef.current = true;
            recoveryBlocked = false;
            recoveryAttempt = 0;
            scheduleRecovery({ immediate: true, refresh: true });
            return;
          }

          if (
            status === "auth_failure" ||
            status === "awaiting_pairing" ||
            status === "pairing_code"
          ) {
            whatsapp2EventStreamHealthyRef.current = false;
            recoveryBlocked = true;
            clearRecoveryTimer();
            clearEphemeralPresence();
            return;
          }

          if (
            status === "disconnected" ||
            status === "reconnecting" ||
            status === "starting" ||
            status === "error"
          ) {
            whatsapp2EventStreamHealthyRef.current = false;
            clearEphemeralPresence();
          }
        },
      },
    );

    const handleBrowserOnline = () => {
      recoveryBlocked = false;
      recoveryAttempt = 0;
      scheduleRecovery({ immediate: true, refresh: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      recoveryAttempt = 0;
      scheduleRecovery({ immediate: true, refresh: true });
    };

    window.addEventListener("online", handleBrowserOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const renewalTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      scheduleRecovery({ immediate: true, refresh: true });
    }, PRESENCE_RENEW_MS);

    void recoverPresence(false);

    return () => {
      cancelled = true;
      whatsapp2EventStreamHealthyRef.current = false;
      clearActivityTimers();
      clearRecoveryTimer();
      window.clearInterval(renewalTimer);
      window.removeEventListener("online", handleBrowserOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeEventStream();
      void unsubscribeWhatsApp2Presence(subscriptionId, providerId).catch(() => {});
    };
  }, [
    activeChat?.id,
    activeChat?.providerId,
    activeChat?.type,
  ]);

  useEffect(() => {
    if (activeChat?.type !== "whatsapp2") return;

    const conversationId = activeChat.id;
    const providerId = activeChat.providerId || activeChat.id.replace(/^wa2:/, "");
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    let canonicalRealtimeHealthy = false;
    let reconcileFailures = 0;
    let lastFullReconcileAt = Date.now();
    let reconcileTimer: number | null = null;
    let canonicalRefreshTimer: number | null = null;
    let canonicalRefreshInFlight: Promise<void> | null = null;
    let canonicalRefreshQueued = false;
    let fullReconcileInFlight: Promise<void> | null = null;
    const processedEventKeys = new Set<string>();

    const messageTimestamp = (message: DirectMessage) =>
      getMessageTimestampMs(message.timestamp || message.sentDate || message.createdAt);

    const mergeConversationMessages = (incoming: DirectMessage[]) => {
      if (cancelled || incoming.length === 0) return;

      const newestIncoming = incoming.reduce(
        (latest, message) => Math.max(latest, messageTimestamp(message)),
        0,
      );
      if (newestIncoming > 0) {
        latestRealtimeMessageAtRef.current.set(
          conversationId,
          Math.max(
            latestRealtimeMessageAtRef.current.get(conversationId) || 0,
            newestIncoming,
          ),
        );
      }

      setMessages((previous) => ({
        ...previous,
        [conversationId]: deduplicateMessages([
          ...(previous[conversationId] || []),
          ...incoming,
        ]).sort((left, right) => messageTimestamp(left) - messageTimestamp(right)),
      }));
    };

    const rememberEvent = (key: string) => {
      if (processedEventKeys.has(key)) return false;
      processedEventKeys.add(key);
      if (processedEventKeys.size > 300) {
        const items = Array.from(processedEventKeys);
        processedEventKeys.clear();
        for (const item of items.slice(-150)) processedEventKeys.add(item);
      }
      return true;
    };

    const extractSerializedId = (value: any): string | null => {
      if (!value) return null;
      if (typeof value === "string") return value;
      return value._serialized || value.$1 || null;
    };

    const belongsToOpenChat = (message?: WhatsApp2GatewayMessage | null) => {
      if (!message) return false;
      const chatId = message.fromMe ? message.to : message.from;
      return String(chatId || "") === providerId;
    };

    const refreshCanonical = () => {
      if (canonicalRefreshInFlight) {
        canonicalRefreshQueued = true;
        return canonicalRefreshInFlight;
      }

      canonicalRefreshInFlight = (async () => {
        const canonicalRows = await loadInstagramMessagesDirect(conversationId);
        if (cancelled || canonicalRows === null) return;
        mergeConversationMessages(canonicalRows);
      })()
        .catch((error) => {
          if (!cancelled) {
            console.warn("[WhatsApp 2] Falha na confirmação canônica do chat:", error);
          }
        })
        .finally(() => {
          canonicalRefreshInFlight = null;
          if (canonicalRefreshQueued && !cancelled) {
            canonicalRefreshQueued = false;
            canonicalRefreshTimer = window.setTimeout(() => {
              canonicalRefreshTimer = null;
              void refreshCanonical();
            }, 80);
          }
        });

      return canonicalRefreshInFlight;
    };

    const scheduleCanonicalRefresh = (delayMs = 80) => {
      if (cancelled) return;
      if (canonicalRefreshTimer !== null) window.clearTimeout(canonicalRefreshTimer);
      canonicalRefreshTimer = window.setTimeout(() => {
        canonicalRefreshTimer = null;
        void refreshCanonical();
      }, delayMs);
    };

    const fullReconcile = () => {
      if (fullReconcileInFlight) return fullReconcileInFlight;

      fullReconcileInFlight = (async () => {
        const [gatewayRows, canonicalRows] = await Promise.all([
          getWhatsApp2Messages(providerId, 140),
          loadInstagramMessagesDirect(conversationId),
        ]);
        if (cancelled) return;

        mergeConversationMessages([
          ...gatewayRows.map(mapWhatsApp2Message),
          ...(canonicalRows || []),
        ]);
        lastFullReconcileAt = Date.now();
        reconcileFailures = 0;
      })()
        .catch((error) => {
          reconcileFailures += 1;
          if (!cancelled) {
            console.warn("[WhatsApp 2] Reconciliação do chat falhou:", error);
          }
        })
        .finally(() => {
          fullReconcileInFlight = null;
        });

      return fullReconcileInFlight;
    };

    const nextReconcileDelay = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return 300_000;
      }
      const realtimeHealthy =
        whatsapp2EventStreamHealthyRef.current && canonicalRealtimeHealthy;
      const baseMs = realtimeHealthy ? 120_000 : 30_000;
      return Math.min(baseMs * Math.pow(2, Math.min(reconcileFailures, 3)), 300_000);
    };

    const scheduleReconcile = (overrideDelayMs?: number) => {
      if (cancelled) return;
      if (reconcileTimer !== null) window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(async () => {
        reconcileTimer = null;
        if (document.visibilityState === "visible") {
          await fullReconcile();
        }
        scheduleReconcile();
      }, overrideDelayMs ?? nextReconcileDelay());
    };

    const handleGatewayEvent = (event: WhatsApp2GatewayEvent) => {
      if (cancelled) return;

      if (event.type === "message" || event.type === "message_create") {
        const message = event.payload as WhatsApp2GatewayMessage | null;
        if (!belongsToOpenChat(message) || !message?.id) return;
        if (!rememberEvent(`${event.type}:${message.id}`)) return;
        mergeConversationMessages([mapWhatsApp2Message(message)]);
        return;
      }

      if (event.type === "message_ack") {
        const payload = event.payload as {
          message?: WhatsApp2GatewayMessage | null;
          ack?: number;
        };
        const message = payload?.message;
        if (!belongsToOpenChat(message) || !message?.id) return;
        const ack = Number(payload?.ack ?? message.ack ?? 0);
        if (!rememberEvent(`ack:${message.id}:${ack}`)) return;

        const mapped = mapWhatsApp2Message({ ...message, ack });
        setMessages((previous) => ({
          ...previous,
          [conversationId]: (previous[conversationId] || []).map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  status: mapped.status,
                  seenAt: mapped.status === "seen" ? new Date().toISOString() : item.seenAt,
                }
              : item
          ),
        }));
        return;
      }

      if (event.type === "message_reaction") {
        const reaction = event.payload as any;
        const targetId = extractSerializedId(reaction?.msgId);
        if (!targetId) return;
        const emoji = String(reaction?.reaction || "").trim();
        const reactedAt = reaction?.timestamp
          ? new Date(Number(reaction.timestamp) * 1000).toISOString()
          : new Date().toISOString();
        if (!rememberEvent(`reaction:${targetId}:${emoji}:${reactedAt}`)) return;

        setMessages((previous) => ({
          ...previous,
          [conversationId]: (previous[conversationId] || []).map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  reactionEmoji: emoji || undefined,
                  reactionAt: emoji ? reactedAt : undefined,
                }
              : item
          ),
        }));
        return;
      }

      if (event.type === "vote_update") {
        const vote = event.payload as {
          parentMessageId?: string | null;
          voter?: string;
          selectedOptions?: Array<{ id?: number | null; name?: string | null }>;
          interactedAt?: string;
        } | null;
        const targetId = String(vote?.parentMessageId || "").trim();
        const voter = String(vote?.voter || "").trim();
        if (!targetId || !voter) return;
        const voteKey = `vote:${targetId}:${voter}:${vote?.interactedAt || ""}`;
        if (!rememberEvent(voteKey)) return;

        setMessages((previous) => ({
          ...previous,
          [conversationId]: (previous[conversationId] || []).map((item) => {
            if (item.id !== targetId) return item;
            const currentMetadata = item.nativeMetadata || {};
            const currentPoll = currentMetadata.poll || {
              question: null,
              options: [],
              allowMultipleAnswers: false,
              invalidated: false,
            };
            return {
              ...item,
              nativeMetadata: {
                ...currentMetadata,
                nativeKind: "poll",
                poll: {
                  ...currentPoll,
                  votesByVoter: {
                    ...(currentPoll.votesByVoter || {}),
                    [voter]: {
                      selectedOptions: vote?.selectedOptions || [],
                      interactedAt: vote?.interactedAt || new Date().toISOString(),
                    },
                  },
                },
              },
            };
          }),
        }));
        return;
      }

      if (event.type === "message_revoke_everyone") {
        const payload = event.payload as any;
        const targetId =
          String(payload?.before?.id || payload?.after?.id || "").trim() || null;
        if (!targetId || !rememberEvent(`revoke:${targetId}`)) return;

        setMessages((previous) => ({
          ...previous,
          [conversationId]: (previous[conversationId] || []).map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  text: "Mensagem apagada",
                  mediaUrl: undefined,
                  mediaType: undefined,
                  attachment: undefined,
                  nativeMetadata: { nativeKind: "revoked", providerType: "revoked" },
                  audioTranscript: undefined,
                }
              : item
          ),
        }));
      }
    };

    whatsapp2OpenChatEventHandlerRef.current = handleGatewayEvent;

    const realtimeChannel = supabase
      ?.channel(`wa2-open-chat-${conversationId.replace(/[^a-zA-Z0-9_-]/g, "_")}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          scheduleCanonicalRefresh();
        },
      )
      .subscribe((status: string) => {
        canonicalRealtimeHealthy = status === "SUBSCRIBED";
        if (status === "SUBSCRIBED") {
          scheduleCanonicalRefresh(0);
          scheduleReconcile();
        } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
          scheduleReconcile(1_000);
        }
      });

    const reconcileIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFullReconcileAt < 30_000) return;
      void fullReconcile();
      scheduleReconcile();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileIfStale();
      else scheduleReconcile();
    };
    const handleFocus = () => reconcileIfStale();
    const handleOnline = () => {
      scheduleCanonicalRefresh(0);
      scheduleReconcile(1_000);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);

    // O histórico bruto já foi carregado por handleOpenConversation.
    // Aqui só enriquecemos com a versão canônica e armamos o fallback lento.
    scheduleCanonicalRefresh(0);
    scheduleReconcile();

    return () => {
      cancelled = true;
      whatsapp2OpenChatEventHandlerRef.current = () => {};
      if (reconcileTimer !== null) window.clearTimeout(reconcileTimer);
      if (canonicalRefreshTimer !== null) window.clearTimeout(canonicalRefreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      if (supabase && realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [
    activeChat?.id,
    activeChat?.providerId,
    activeChat?.type,
    loadInstagramMessagesDirect,
  ]);

  // Carrega conversas reais do Instagram do Supabase (com in-flight dedup e colunas explícitas sem stage_completed_rules)
  const isDirectLoadingConvsRef = useRef<boolean>(false);
  const loadInstagramConversations = useCallback(async () => {
    if (IS_WHATSAPP2_REMOTE_BUILD) return;
    if (isDirectLoadingConvsRef.current) return;
    isDirectLoadingConvsRef.current = true;
    try {
      const supabase = getSupabaseBrowserClient();
      let rawConversations: any[] = [];
      let directFetchComplete = false;

      const normalizeInstagramRows = (rows: any[]) =>
        rows
          .filter(
            (c: any) =>
              c.channel !== "whatsapp2" &&
              c.channel !== "whatsapp" &&
              !c.id?.startsWith("__") &&
              c.status !== "system" &&
              c.status !== "vault"
          )
          .map((c: any) => {
            const lastMsgTime = getMessageTimestampMs(c.last_message_at);
            const readTime = readChatTimestampsRef.current[c.id];
            const isRead = c.last_direction === "out" || (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);
            const isRestricted = Boolean(c.is_restricted || c.status === "restricted");
            const isValidSeen =
              c.last_direction === "out" &&
              c.last_status === "seen" &&
              Boolean(c.seen_at) &&
              new Date(c.seen_at).getTime() >= new Date(c.last_message_at || 0).getTime();

            return {
              id: c.id,
              username: c.username || `ig_${c.id.slice(-6)}`,
              fullName: c.full_name || c.username || "Usuário Instagram",
              avatar: c.avatar || "/images/default-avatar.svg",
              isOnline: false,
              lastActive: formatMessageTime(c.last_message_at),
              lastMessage: c.last_direction === "out" ? `Você: ${c.last_message || ""}` : (c.last_message || ""),
              lastSender: c.last_direction === "out" ? "me" : "them",
              lastStatus: isValidSeen ? "seen" : (c.last_direction === "out" ? "sent" : undefined),
              seenAt: isValidSeen ? c.seen_at : undefined,
              unread: isRead ? false : Boolean(c.unread),
              type: "instagram" as const,
              lastMessageAt: c.last_message_at,
              isRestricted,
              currentStageId: c.current_stage_id || c.currentStageId || null,
              isConverted: Boolean(c.is_converted ?? c.isConverted),
              raffleStatus: normalizeRaffleCommercialStatus(c.raffle_status ?? c.raffleStatus),
              aiAutoRespond: Boolean(c.ai_auto_respond ?? c.aiAutoRespond),
              status: isRestricted ? "restricted" : (c.status || "active"),
            };
          });

      const publishInstagramRows = (rows: any[]) => {
        const incoming = normalizeInstagramRows(rows);
        setConversations((prev) => {
          const currentInstagram = prev.filter(
            (conversation) => conversation.type === "instagram"
          );
          const currentById = new Map<string, any>(currentInstagram.map((c) => [c.id, c]));
          const nextById = new Map<string, any>(currentInstagram.map((c) => [c.id, c]));

          for (const next of incoming) {
            const current = currentById.get(next.id);
            const currentTime = getMessageTimestampMs(current?.lastMessageAt || current?.lastActive);
            const nextTime = getMessageTimestampMs(next.lastMessageAt || next.lastActive);
            nextById.set(
              next.id,
              current && currentTime > nextTime
                ? {
                    ...current,
                    // Metadados de etapa são canônicos e não dependem do timestamp da última mensagem.
                    currentStageId: next.currentStageId,
                    isConverted: next.isConverted,
                    raffleStatus: next.raffleStatus,
                    aiAutoRespond: next.aiAutoRespond,
                  }
                : next
            );
          }

          return Array.from(nextById.values());
        });
      };

      // 1. Fonte canônica: primeiro mostra os chats recentes; depois hidrata
      // a lista completa com cursor estável por ID. Não usamos OFFSET em
      // last_message_at porque chats ativos mudam de posição enquanto a carga roda.
      if (supabase) {
        const selectColumns =
          "id, channel, contact_id, username, full_name, avatar, last_message, last_message_at, last_direction, last_status, seen_at, unread, status, is_restricted, current_stage_id, is_converted, raffle_status, ai_auto_respond, created_at, updated_at";

        const { data: recentRows, error: recentError } = await supabase
          .from("instagram_conversations")
          .select(selectColumns)
          .neq("status", "vault")
          .neq("status", "system")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(200);

        if (recentError) {
          console.warn("[Inbox] Falha ao carregar chats recentes; mantendo lista atual:", recentError.message);
        } else if (recentRows?.length) {
          publishInstagramRows(recentRows);
          setIsInstagramConnected((current) => current === false ? current : true);
        }

        const pageSize = 500;
        const fetchedRows: any[] = [];
        let cursorId: string | null = null;

        for (;;) {
          let pageQuery = supabase
            .from("instagram_conversations")
            .select(selectColumns)
            .neq("status", "vault")
            .neq("status", "system")
            .order("id", { ascending: true })
            .limit(pageSize);

          if (cursorId) {
            pageQuery = pageQuery.gt("id", cursorId);
          }

          const { data, error } = await pageQuery;
          if (error) {
            console.warn("[Inbox] Hidratação completa interrompida; mantendo chats já visíveis:", error.message);
            break;
          }

          const pageRows = data || [];
          fetchedRows.push(...pageRows);

          if (pageRows.length > 0) {
            publishInstagramRows(pageRows);
            cursorId = String(pageRows[pageRows.length - 1].id);
          }

          if (pageRows.length < pageSize) {
            directFetchComplete = true;
            break;
          }
        }

        if (!directFetchComplete) {
          return;
        }

        rawConversations = normalizeInstagramRows(fetchedRows);
        publishInstagramRows(fetchedRows);
        setHasCanonicalInstagramSnapshot(true);

        // Auto-cura do cache local de restrições somente quando o snapshot terminou.
        const canonicalRestrictedIds = new Set<string>(
          fetchedRows
            .filter((c: any) => Boolean(c.is_restricted) || c.status === "restricted")
            .map((c: any) => String(c.id))
        );
        restrictedChatIdsRef.current = canonicalRestrictedIds;
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(
              "vendeo_restricted_chats",
              JSON.stringify(Array.from(canonicalRestrictedIds))
            );
          } catch {}
        }
      }

      // 2. Fallback via API apenas se o client Supabase não estiver disponível.
      // Um snapshot vazio/parcial nunca deve apagar a lista que já está visível.
      if (!supabase && rawConversations.length === 0) {
        const res = await fetch(getApiUrl("/api/instagram/conversations"));
        if (res.ok) {
          const data = await res.json();
          if (data.conversations) {
            rawConversations = data.conversations.filter(
              (c: any) => !c.id?.startsWith("__") && c.status !== "system" && c.status !== "vault"
            );
          }
        }
      }

      if (rawConversations.length === 0) {
        return;
      }

      // 3. O client Supabase já publicou progressivamente acima.
      // O fallback HTTP ainda precisa normalizar e publicar o snapshot recebido.
      if (!supabase) {
        setConversations((prev) => {
          const updatedInsta = rawConversations.map((c: any) => {
            const lastMsgTime = getMessageTimestampMs(c.lastMessageAt || c.lastActive);
            const readTime = readChatTimestampsRef.current[c.id];
            const isRead = c.lastSender === "me" || (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);
            const isRestr = Boolean(c.isRestricted || c.is_restricted || c.status === "restricted");
            const rawSeenAt = c.seenAt || c.seen_at;
            const rawStatus = c.lastStatus || c.last_status;
            const isValidSeen =
              c.lastSender === "me" &&
              rawStatus === "seen" &&
              Boolean(rawSeenAt) &&
              new Date(rawSeenAt).getTime() >= new Date(c.lastMessageAt || c.lastActive || 0).getTime();

            return {
              ...c,
              lastStatus: isValidSeen ? "seen" : (c.lastSender === "me" ? "sent" : undefined),
              seenAt: isValidSeen ? rawSeenAt : undefined,
              unread: isRead ? false : Boolean(c.unread),
              isRestricted: isRestr,
              currentStageId: c.currentStageId ?? c.current_stage_id ?? null,
              isConverted: Boolean(c.isConverted ?? c.is_converted),
              raffleStatus: normalizeRaffleCommercialStatus(c.raffleStatus ?? c.raffle_status),
              aiAutoRespond: Boolean(c.aiAutoRespond ?? c.ai_auto_respond),
              status: isRestr ? "restricted" : (c.status === "restricted" ? "active" : (c.status || "active")),
            };
          });
          return updatedInsta;
        });
      }
    } catch (err) {
      console.error("Erro ao carregar conversas do Instagram:", err);
    } finally {
      isDirectLoadingConvsRef.current = false;
    }
  }, []);

  // Enquanto a hidratação completa não terminou, tenta novamente em cadência curta.
  // As páginas já carregadas e os eventos realtime continuam visíveis; uma falha
  // parcial nunca zera a lista atual.
  useEffect(() => {
    if (hasCanonicalInstagramSnapshot) return;
    const retryId = window.setInterval(() => {
      void loadInstagramConversations();
    }, 5000);
    return () => window.clearInterval(retryId);
  }, [hasCanonicalInstagramSnapshot, loadInstagramConversations]);

  // Atualiza referência atômica para o ID do chat ativo
  activeChatIdRef.current = activeChat?.id || null;

  const handleRealtimeWhatsApp2Conversation = useCallback(
    (conv: RealtimeConversationUpdatePayload) => {
      const id = String(conv.id || "");
      if (!id || (conv.channel !== "whatsapp2" && !id.startsWith("wa2:"))) return;

      const incomingAtMs = conv.lastMessageAt
        ? getMessageTimestampMs(conv.lastMessageAt)
        : 0;
      const oneWeekAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);

      setWhatsApp2Conversations((previous) => {
        const index = previous.findIndex((item) => item.id === id);

        if (incomingAtMs > 0 && incomingAtMs < oneWeekAgoMs) {
          return index === -1
            ? previous
            : previous.filter((item) => item.id !== id);
        }

        const current = index >= 0 ? previous[index] : undefined;
        const providerId = current?.providerId || id.replace(/^wa2:/, "");
        const hasDirection =
          conv.lastDirection === "out" ||
          conv.lastDirection === "outbound" ||
          conv.lastDirection === "in" ||
          conv.lastDirection === "inbound";
        const nextLastSender = hasDirection
          ? (conv.lastDirection === "out" || conv.lastDirection === "outbound" ? "me" : "them")
          : (current?.lastSender || "them");
        const rawPreview =
          conv.lastMessage !== undefined
            ? String(conv.lastMessage || "")
            : (current?.lastMessage || "");
        const cleanPreview = rawPreview.replace(/^Você:\s*/, "");
        const nextPreview =
          conv.lastMessage !== undefined
            ? (nextLastSender === "me" && cleanPreview ? `Você: ${cleanPreview}` : cleanPreview)
            : rawPreview;
        const lastMessageAt = conv.lastMessageAt || current?.lastMessageAt;
        const isCurrentActive = activeChatIdRef.current === id;

        const next: DirectConversation = {
          ...(current || {
            id,
            username: conv.username || providerId.replace(/@.*$/, ""),
            fullName: conv.fullName || conv.username || providerId,
            avatar: conv.avatar || "/images/default-avatar.svg",
            isOnline: false,
            lastActive: lastMessageAt ? formatMessageTime(lastMessageAt) : "",
            lastMessage: nextPreview,
            unread: false,
            type: "whatsapp2" as const,
            lastSender: nextLastSender,
            status: "active" as const,
          }),
          id,
          providerId,
          type: "whatsapp2",
          username: conv.username || current?.username || providerId.replace(/@.*$/, ""),
          fullName: conv.fullName || current?.fullName || conv.username || providerId,
          avatar: conv.avatar || current?.avatar || "/images/default-avatar.svg",
          lastMessage: nextPreview,
          lastMessageAt,
          lastActive: lastMessageAt
            ? formatMessageTime(lastMessageAt)
            : (current?.lastActive || ""),
          lastSender: nextLastSender,
          lastStatus:
            nextLastSender === "me"
              ? (conv.lastStatus || current?.lastStatus || "sent")
              : undefined,
          seenAt: conv.seenAt !== undefined ? conv.seenAt : current?.seenAt,
          unread: isCurrentActive
            ? false
            : (conv.unread !== undefined ? Boolean(conv.unread) : Boolean(current?.unread)),
          currentStageId:
            conv.currentStageId !== undefined ? conv.currentStageId : current?.currentStageId,
          isConverted:
            conv.isConverted !== undefined ? conv.isConverted : Boolean(current?.isConverted),
          raffleStatus:
            conv.raffleStatus !== undefined ? conv.raffleStatus : current?.raffleStatus,
          aiAutoRespond:
            conv.aiAutoRespond !== undefined ? conv.aiAutoRespond : Boolean(current?.aiAutoRespond),
          status: current?.status || "active",
        };

        const nextList = index >= 0
          ? previous.map((item, itemIndex) => itemIndex === index ? next : item)
          : [next, ...previous];

        nextList.sort(
          (a, b) =>
            getMessageTimestampMs(b.lastMessageAt || b.lastActive) -
            getMessageTimestampMs(a.lastMessageAt || a.lastActive)
        );
        return nextList;
      });
    },
    []
  );

  // -------------------------------------------------------------
  // SUPABASE REALTIME (WEBSOCKET): Latência Zero (< 50ms)
  // -------------------------------------------------------------
  const handleRealtimeInstagramMessage = useCallback((msg: RealtimeMessagePayload & { media_url?: string; media_type?: string }) => {
    if (
      String(msg.conversationId || "").startsWith("wa:")
      && String(msg.text || "").trim().toLowerCase() === "[whatsapp:reaction]"
    ) {
      return;
    }

    let text = msg.text || "";
    let mediaUrl = msg.mediaUrl || msg.media_url;
    let mediaType = (msg.mediaType || msg.media_type) as DirectMessage["mediaType"];
    let attachment = normalizeWhatsApp2Attachment(
      (msg as any).attachment_metadata || (msg as any).attachment,
      mediaType
        ? {
            kind: mediaType,
            providerType: (msg as any).provider_type || (msg as any).providerType || null,
            mediaUrl: mediaUrl || null,
            downloadable: Boolean(mediaUrl),
            previewable: ["audio", "image", "video", "sticker"].includes(mediaType),
          }
        : undefined,
    );
    const isSharedMedia = isInstagramSharedMediaText(text);

    if (!mediaUrl && text) {
      const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
      const imageMatch = text.match(/^\[image:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
      const stickerMatch = text.match(/^\[sticker:(https?:\/\/[^\]]+)\]$/);
      const shareMatch = text.match(/^\[share:(https?:\/\/[^\]]+)\]$/);
      if (audioMatch) {
        mediaUrl = audioMatch[1];
        mediaType = "audio";
        text = "🎙️ Mensagem de voz";
      } else if (imageMatch) {
        mediaUrl = imageMatch[1];
        mediaType = "image";
        text = imageMatch[2] || "📷 Foto";
      } else if (stickerMatch) {
        mediaUrl = stickerMatch[1];
        mediaType = "sticker";
        text = "Figurinha";
      } else if (shareMatch) {
        mediaUrl = shareMatch[1];
        mediaType = "video";
      }
    }

    if (isSharedMedia) {
      mediaType = "video";
      text = "🎞️ Reel ou publicação compartilhada";
    }

    if (mediaType) {
      attachment = normalizeWhatsApp2Attachment(attachment, {
        kind: mediaType,
        providerType: (msg as any).provider_type || (msg as any).providerType || null,
        mediaUrl: mediaUrl || null,
        downloadable: Boolean(mediaUrl),
        previewable: ["audio", "image", "video", "sticker"].includes(mediaType),
      });
      if (attachment && mediaUrl && attachment.mediaUrl !== mediaUrl) {
        attachment = { ...attachment, mediaUrl };
      }
    }

    const realtimeReplyToMid = msg.replyToMessageId || (msg as any).reply_to_message_id || null;
    const realtimeReplyTo = msg.replyTo || (msg as any).reply_to || undefined;

    console.log("⚡ [Instagram Reply - UI] Mensagem recebida em tempo real:", {
      id: msg.id,
      oldId: msg.oldId,
      conversationId: msg.conversationId,
      text,
      isMine: msg.isMine,
      replyToMessageId: realtimeReplyToMid,
      replyTo: realtimeReplyTo,
    });

    const formatted: DirectMessage = {
      id: msg.id,
      senderId: msg.isMine ? "me" : msg.senderId,
      text: text || (
        mediaType === "audio"
          ? "🎙️ Mensagem de voz"
          : mediaType === "image"
          ? "📷 Foto"
          : mediaType === "sticker"
          ? "Figurinha"
          : ""
      ),
      mediaUrl,
      mediaType,
      attachment,
      nativeMetadata:
        ((msg as any).message_metadata || (msg as any).messageMetadata || undefined) as WhatsApp2MessageMetadata | undefined,
      audioTranscript: msg.audio_transcript || msg.audioTranscript,
      createdAt: formatMessageTime(msg.timestamp),
      timestamp: msg.timestamp ? getMessageTimestampMs(msg.timestamp) : Date.now(),
      sentDate: msg.timestamp
        ? typeof msg.timestamp === "string"
          ? msg.timestamp
          : new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      isMine: msg.isMine,
      status: msg.status || "sent",
      deliverAt: msg.status === "sent" ? undefined : (msg.deliverAt || undefined),
      delaySeconds: msg.status === "sent" ? undefined : (msg.delaySeconds || undefined),
      errorReason: (msg as any).errorReason,
      replyToMessageId: realtimeReplyToMid,
      replyTo: realtimeReplyTo,
    };

    setMessages((prev) => {
      const current = prev[msg.conversationId] || [];
      let baseList = current;
      const rawMsg = msg as any;
      if (rawMsg.oldId) {
        baseList = current.map((c) =>
          c.id === rawMsg.oldId
            ? {
                ...c,
                id: msg.id,
                status: (msg.status as any) || "sent",
                deliverAt: msg.status === "sent" ? undefined : c.deliverAt,
                delaySeconds: msg.status === "sent" ? undefined : c.delaySeconds,
              }
            : c
        );
      }
      const existing = baseList.find((c) => c.id === msg.id);
      const safeFormatted: DirectMessage = {
        ...formatted,
        audioTranscript: formatted.audioTranscript || existing?.audioTranscript,
        replyTo: formatted.replyTo || existing?.replyTo,
        replyToMessageId: formatted.replyToMessageId || existing?.replyToMessageId,
        deliverAt: (msg.status === "sent" || formatted.status === "sent") ? undefined : (formatted.deliverAt || existing?.deliverAt),
      };
      const merged = deduplicateMessages([...baseList, safeFormatted]);
      return {
        ...prev,
        [msg.conversationId]: merged,
      };
    });

    // Se a nova mensagem for do contato e o chat não estiver aberto na tela, remove qualquer marcação antiga de lido para ativar a bolinha azul
    const isCurrentActive = activeChatIdRef.current === msg.conversationId;
    const realtimeTimestamp = getMessageTimestampMs(msg.timestamp);
    if (realtimeTimestamp > 0) {
      latestRealtimeMessageAtRef.current.set(
        msg.conversationId,
        Math.max(latestRealtimeMessageAtRef.current.get(msg.conversationId) || 0, realtimeTimestamp),
      );
      if (latestRealtimeMessageAtRef.current.size > 200) {
        const oldestConversationId = latestRealtimeMessageAtRef.current.keys().next().value;
        if (oldestConversationId) latestRealtimeMessageAtRef.current.delete(oldestConversationId);
      }
    }
    if (!msg.isMine) {
      autoPilotRef.current?.registerClientMessage(msg.conversationId, msg.timestamp);
      if (!isCurrentActive) {
        delete readChatTimestampsRef.current[msg.conversationId];
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(
              "vendeo_read_chat_timestamps",
              JSON.stringify(readChatTimestampsRef.current)
            );
          } catch {}
        }

        // Notificações de mensagem nova foram desativadas.
        // O sistema móvel alerta somente quando o Brain precisa do operador
        // ou quando a conversa é finalizada.
      }
    }

    setConversations((prevConvs) => {
      const found = prevConvs.find((c) => c.id === msg.conversationId);
      const timeFormatted = formatMessageTime(msg.timestamp);
      const updated: DirectConversation = found
        ? {
            ...found,
            lastMessage: msg.isMine ? `Você: ${msg.text}` : msg.text,
            lastSender: msg.isMine ? "me" : "them",
            lastStatus: msg.isMine ? "sent" : undefined,
            seenAt: undefined,
            lastActive: timeFormatted,
            lastMessageAt: msg.timestamp,
            unread: isCurrentActive ? false : !msg.isMine,
          }
        : {
            id: msg.conversationId,
            username: `ig_${msg.conversationId.slice(-6)}`,
            fullName: "Usuário Instagram",
            avatar: "/images/default-avatar.svg",
            isOnline: true,
            lastActive: timeFormatted,
            lastMessage: msg.isMine ? `Você: ${msg.text}` : msg.text,
            lastSender: msg.isMine ? "me" : "them",
            lastStatus: msg.isMine ? "sent" : undefined,
            seenAt: undefined,
            lastMessageAt: msg.timestamp,
            unread: !msg.isMine,
            type: "instagram",
          };

      const others = prevConvs.filter((c) => c.id !== msg.conversationId);
      return [updated, ...others];
    });

    if (activeChatIdRef.current === msg.conversationId) {
      if (msg.isMine) {
        setActiveChat((prev) =>
          prev && prev.id === msg.conversationId
            ? { ...prev, lastStatus: "sent", seenAt: undefined, lastSender: "me" }
            : prev
        );
      }
      setTimeout(() => scrollToBottom("auto"), 50);
    }
  }, []);

  const handleRealtimeInstagramConversationUpdate = useCallback((conv: RealtimeConversationUpdatePayload) => {
    if (
      !conv.id ||
      conv.id.startsWith("__") ||
      conv.channel === "whatsapp2" ||
      (conv as any).channel === "whatsapp" ||
      conv.id.startsWith("wa2:") ||
      conv.id.startsWith("wa:")
    ) return;

    const isSentByMe = conv.lastDirection === "out" || conv.lastDirection === "outbound";
    const isCurrentActive = activeChatIdRef.current === conv.id;
    const previousConversation = conversationsRef.current.find((item) => item.id === conv.id);
    const incomingConversationTimestamp = conv.lastMessageAt
      ? getMessageTimestampMs(conv.lastMessageAt)
      : 0;
    const previousConversationTimestamp = previousConversation?.lastMessageAt
      ? getMessageTimestampMs(previousConversation.lastMessageAt)
      : 0;
    const hasNewMessageActivity = Boolean(
      conv.lastMessageAt &&
      incomingConversationTimestamp > previousConversationTimestamp
    );

    // O evento da conversa pode chegar mesmo quando o broadcast da mensagem
    // foi perdido durante uma troca de conexão. Revalida o histórico ativo
    // somente quando o timestamp recebido é mais novo que o que a tela conhece.
    if (isCurrentActive && conv.lastMessageAt) {
      const incomingTimestamp = getMessageTimestampMs(conv.lastMessageAt);
      const knownMessages = messagesRef.current[conv.id] || [];
      const latestKnownTimestamp = knownMessages.reduce((latest, message) => {
        return Math.max(
          latest,
          getMessageTimestampMs(message.timestamp || message.sentDate || message.createdAt)
        );
      }, 0);

      const latestRealtimeTimestamp = latestRealtimeMessageAtRef.current.get(conv.id) || 0;
      const latestFetchedTimestamp = latestFetchedMessageAtRef.current.get(conv.id) || 0;
      if (hasNewConversationMessage(
        incomingTimestamp,
        latestKnownTimestamp,
        Math.max(latestRealtimeTimestamp, latestFetchedTimestamp),
      )) {
        void fetchConversationMessages(conv.id);
      }
    }

    if (hasNewMessageActivity && !isSentByMe && !isCurrentActive) {
      delete readChatTimestampsRef.current[conv.id];
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(
            "vendeo_read_chat_timestamps",
            JSON.stringify(readChatTimestampsRef.current)
          );
        } catch {}
      }
    }

    if (
      conv.isConverted === true &&
      previousConversation &&
      previousConversation.isConverted !== true &&
      mobileNotificationsRef.current.permission === "granted"
    ) {
      const contactName =
        conv.fullName ||
        previousConversation.fullName ||
        conv.username ||
        previousConversation.username ||
        "Conversa do Instagram";

      void sendCriticalNotificationOnce(
        `workflow_finalized:${conv.id}`,
        () => mobileNotificationsRef.current.notifyConversationFinalized(contactName, conv.id),
      );
    }

    setConversations((prevConvs) => {
      const idx = prevConvs.findIndex((c) => c.id === conv.id);
      if (idx === -1) return prevConvs;
      const target = prevConvs[idx];
      const rawPreview = conv.lastMessage || target.lastMessage || "";
      const cleanPreview = rawPreview.startsWith("Você: ") ? rawPreview.replace(/^Você:s*/, "") : rawPreview;
      const formattedPreview = isSentByMe ? `Você: ${cleanPreview}` : cleanPreview;
      const timeFormatted = formatMessageTime(conv.lastMessageAt || target.lastActive);

      const isRead = isSentByMe || isCurrentActive;
      const updatedUnread = isRead
        ? false
        : hasNewMessageActivity
          ? (conv.unread !== undefined ? Boolean(conv.unread) : true)
          : target.unread;

      const updated: DirectConversation = {
        ...target,
        type: conv.channel || target.type,
        fullName: conv.fullName || target.fullName,
        username: conv.username || target.username,
        avatar: conv.avatar || target.avatar,
        currentStageId: conv.currentStageId !== undefined ? conv.currentStageId : target.currentStageId,
        isConverted: conv.isConverted !== undefined ? conv.isConverted : target.isConverted,
        raffleStatus: conv.raffleStatus !== undefined ? conv.raffleStatus : target.raffleStatus,
        aiAutoRespond: conv.aiAutoRespond !== undefined ? conv.aiAutoRespond : target.aiAutoRespond,
        lastMessage: formattedPreview,
        lastMessageAt: conv.lastMessageAt || target.lastMessageAt,
        lastSender: hasNewMessageActivity
          ? (isSentByMe ? "me" : "them")
          : target.lastSender,
        lastStatus: conv.lastStatus !== undefined
          ? conv.lastStatus
          : (isSentByMe ? "sent" : target.lastStatus),
        seenAt: conv.seenAt !== undefined
          ? conv.seenAt
          : (isSentByMe ? undefined : target.seenAt),
        lastActive: hasNewMessageActivity ? timeFormatted : target.lastActive,
        unread: updatedUnread,
      };

      const unchanged =
        updated.fullName === target.fullName &&
        updated.username === target.username &&
        updated.avatar === target.avatar &&
        updated.currentStageId === target.currentStageId &&
        updated.isConverted === target.isConverted &&
        updated.raffleStatus === target.raffleStatus &&
        updated.aiAutoRespond === target.aiAutoRespond &&
        updated.lastMessage === target.lastMessage &&
        updated.lastMessageAt === target.lastMessageAt &&
        updated.lastSender === target.lastSender &&
        updated.lastStatus === target.lastStatus &&
        updated.seenAt === target.seenAt &&
        updated.lastActive === target.lastActive &&
        updated.unread === target.unread;

      if (unchanged) return prevConvs;

      if (hasNewMessageActivity) {
        const others = prevConvs.slice();
        others.splice(idx, 1);
        return [updated, ...others];
      }

      const next = prevConvs.slice();
      next[idx] = updated;
      return next;
    });

    if (isCurrentActive && (conv.raffleStatus !== undefined || conv.isConverted !== undefined)) {
      setActiveChat((prev) =>
        prev && prev.id === conv.id
          ? {
              ...prev,
              isConverted: conv.isConverted !== undefined ? conv.isConverted : prev.isConverted,
              raffleStatus: conv.raffleStatus !== undefined ? conv.raffleStatus : prev.raffleStatus,
            }
          : prev
      );
    }
  }, [fetchConversationMessages, sendCriticalNotificationOnce]);

  // Handler de INSERT de nova conversa via Realtime — adiciona incrementalmente à lista sem full fetch
  const handleRealtimeInstagramConversationInsert = useCallback((conv: RealtimeConversationUpdatePayload) => {
    if (
      !conv.id ||
      conv.id.startsWith("__") ||
      conv.channel === "whatsapp2" ||
      (conv as any).channel === "whatsapp" ||
      conv.id.startsWith("wa2:") ||
      conv.id.startsWith("wa:")
    ) return;

    setConversations((prevConvs) => {
      // Se a conversa já existe (pode ter sido adicionada via handler de mensagem), não duplicar
      if (prevConvs.some((c) => c.id === conv.id)) return prevConvs;

      const isSentByMe = conv.lastDirection === "out" || conv.lastDirection === "outbound";
      const newConv: DirectConversation = {
        id: conv.id,
        username: conv.username || `ig_${conv.id.slice(-6)}`,
        fullName: conv.fullName || "Usuário Instagram",
        avatar: conv.avatar || "/images/default-avatar.svg",
        isOnline: false,
        lastActive: conv.lastMessageAt ? formatMessageTime(conv.lastMessageAt) : "agora",
        lastMessage: isSentByMe
          ? `Você: ${conv.lastMessage || ""}`
          : (conv.lastMessage || ""),
        lastSender: isSentByMe ? "me" : "them",
        lastStatus: isSentByMe ? "sent" : undefined,
        seenAt: undefined,
        lastMessageAt: conv.lastMessageAt,
        unread: isSentByMe ? false : Boolean(conv.unread),
        type: "instagram",
        isRestricted: false,
        currentStageId: conv.currentStageId || null,
        isConverted: Boolean(conv.isConverted),
        raffleStatus: normalizeRaffleCommercialStatus(conv.raffleStatus),
        aiAutoRespond: Boolean(conv.aiAutoRespond),
        status: "active",
      };
      return [newConv, ...prevConvs];
    });
  }, []);

  const handleRealtimeInstagramSeen = useCallback(
    (payload: { conversationId: string; watermark: number; seenAt: string }) => {
      if (!payload.conversationId) return;

      // 1. Atualiza mensagens da conversa ativa no estado do React
      setMessages((prev) => {
        const current = prev[payload.conversationId];
        if (!current || current.length === 0) return prev;
        const updated = current.map((m) => {
          const msgTime = m.timestamp || (m.sentDate ? new Date(m.sentDate).getTime() : 0);
          if (m.isMine && (msgTime <= payload.watermark || !msgTime)) {
            return {
              ...m,
              status: "seen" as const,
              seenAt: payload.seenAt,
            };
          }
          return m;
        });
        return {
          ...prev,
          [payload.conversationId]: updated,
        };
      });

      // 2. Atualiza a conversa na lista de conversas
      setConversations((prevConvs) => {
        return prevConvs.map((c) => {
          if (c.id === payload.conversationId) {
            return {
              ...c,
              lastStatus: "seen",
              seenAt: payload.seenAt,
            };
          }
          return c;
        });
      });

      // 3. Atualiza activeChat caso a conversa esteja aberta na tela
      setActiveChat((prev) => {
        if (prev && prev.id === payload.conversationId) {
          return {
            ...prev,
            lastStatus: "seen",
            seenAt: payload.seenAt,
          };
        }
        return prev;
      });
    },
    []
  );

  const handleRealtimeInstagramReaction = useCallback(
    (payload: RealtimeInstagramReactionPayload) => {
      if (!payload.conversationId || !payload.messageId) return;
      setMessages((prev) => {
        const current = prev[payload.conversationId];
        if (!current || current.length === 0) return prev;
        let changed = false;
        const updated = current.map((message) => {
          if (message.id !== payload.messageId) return message;
          changed = true;
          return {
            ...message,
            reactionEmoji: payload.action === "react" ? (payload.emoji || undefined) : undefined,
            reactionAt: payload.reactedAt || undefined,
          };
        });
        return changed
          ? { ...prev, [payload.conversationId]: updated }
          : prev;
      });
    },
    []
  );

  const { isRealtimeConnected } = useChatRealtime({
    onInstagramMessage: handleRealtimeInstagramMessage,
    onInstagramConversationUpdate: handleRealtimeInstagramConversationUpdate,
    onInstagramConversationInsert: handleRealtimeInstagramConversationInsert,
    onWhatsApp2ConversationUpdate: handleRealtimeWhatsApp2Conversation,
    onWhatsApp2ConversationInsert: handleRealtimeWhatsApp2Conversation,
    onInstagramSeen: handleRealtimeInstagramSeen,
    onInstagramReaction: handleRealtimeInstagramReaction,
    onAutoPilotStateUpdate: autoPilot.applyRemoteStateUpdate,
    tinderUserId: tinderSession?.profile?.id,
    onTinderMessage: (payload) => {
      const matchId = payload.conversationId;
      if (!matchId) return;
      const isMe = Boolean(payload.isMine || (tinderSession?.profile?.id && payload.senderId === tinderSession.profile.id));
      const formatted: DirectMessage = {
        id: payload.id,
        senderId: isMe ? "me" : payload.senderId,
        text: payload.text,
        createdAt: formatMessageTime(payload.timestamp),
        timestamp: typeof payload.timestamp === "number" ? payload.timestamp : new Date(payload.timestamp).getTime(),
        sentDate: typeof payload.timestamp === "string" ? payload.timestamp : new Date(payload.timestamp).toISOString(),
        isMine: isMe,
        status: "sent",
      };

      setMessages((prev) => {
        const current = prev[matchId] || [];
        if (current.some((existing) => existing.id === formatted.id)) return prev;
        return {
          ...prev,
          [matchId]: [...current, formatted],
        };
      });

      setConversations((prev) => {
        return prev.map((c) => {
          if (c.id === matchId) {
            return {
              ...c,
              lastMessage: isMe ? `Você: ${formatted.text}` : formatted.text,
              lastActive: formatted.createdAt,
              lastMessageAt: formatted.sentDate,
              lastSender: isMe ? "me" : "them",
              unread: !isMe && activeChat?.id !== matchId,
            };
          }
          return c;
        });
      });
    },
    onTinderConversationUpdate: (payload) => {
      if (payload.id) {
        void loadTinderConversations();
      }
    },
  });

  // Sincroniza saúde do Realtime para suprimir polling de fallback do AutoPilot
  useEffect(() => {
    setIsRealtimeHealthyForAutopilot(isRealtimeConnected);
  }, [isRealtimeConnected]);

  // Refs de controle de presença de Realtime e in-flight dedup para os pollings
  useEffect(() => {
    isRealtimeConnectedRef.current = isRealtimeConnected;
  }, [isRealtimeConnected]);
  const isFetchingConversationsRef = useRef<boolean>(false);
  const isFetchingMessagesRef = useRef<boolean>(false);
  const lastConvFetchAtRef = useRef<number>(0);
  const lastMsgFetchAtRef = useRef<number>(0);

  // Inicialização
  useEffect(() => {
    setIsLoadingList(true);
    const initialLoad = IS_WHATSAPP2_REMOTE_BUILD
      ? loadWhatsApp2Conversations()
      : Promise.all([loadInstagramConversations(), checkInstagramStatus(), checkTinderStatus(), loadTinderConversations()]);
    Promise.resolve(initialLoad)
      .catch((e) => console.error("Erro na carga inicial do chat:", e))
      .finally(() => setIsLoadingList(false));
  }, [loadInstagramConversations, loadWhatsApp2Conversations, checkInstagramStatus, checkTinderStatus, loadTinderConversations]);

  // Abertura atômica: enquanto o histórico inicial ainda está carregando,
  // ele pode montar fora da visão. Só revelamos depois de duas frames já no fundo.
  useLayoutEffect(() => {
    if (!activeChat || isLoadingMessages) return;
    if (chatDetailResolvedConversationId !== activeChat.id) return;
    if (chatViewportReadyId === activeChat.id) return;

    const conversationId = activeChat.id;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      if (activeChatIdRef.current !== conversationId) return;
      scrollToBottom("auto");
      secondFrame = window.requestAnimationFrame(() => {
        if (activeChatIdRef.current !== conversationId) return;
        scrollToBottom("auto");
        setChatViewportReadyId(conversationId);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [
    activeChat?.id,
    isLoadingMessages,
    chatDetailResolvedConversationId,
    chatViewportReadyId,
    messages[activeChat?.id || ""]?.length,
    scrollToBottom,
  ]);

  // Depois de aberto, só acompanha mensagens novas se o usuário já estiver perto do fim.
  // Nunca força a conversa para baixo se ele estiver lendo mensagens antigas.
  useEffect(() => {
    if (!activeChat || chatViewportReadyId !== activeChat.id) return;
    const container = messagesScrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.clientHeight - container.scrollTop;
    if (distanceFromBottom <= 180) {
      shouldStickToBottomRef.current = true;
      scrollToBottom("auto");
    }
  }, [
    activeChat?.id,
    chatViewportReadyId,
    messages[activeChat?.id || ""]?.length,
    scrollToBottom,
  ]);

  // Mantém o fundo estável quando mídia, áudio ou a barra de etapa mudam de altura.
  // ResizeObserver roda antes do paint; assim não existe "pulo" visível.
  useLayoutEffect(() => {
    if (!activeChat || typeof ResizeObserver === "undefined") return;
    const container = messagesScrollRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) return;

    const pinToBottom = () => {
      if (!shouldStickToBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
    };

    const observer = new ResizeObserver(pinToBottom);
    observer.observe(container);
    observer.observe(content);
    pinToBottom();

    return () => observer.disconnect();
  }, [activeChat?.id, chatViewportReadyId]);

  // POLLING RESILIENTE 1 (fallback de reconciliação da conversa ativa)
  // - Realtime saudável: reconciliação curta para cobrir perda de eventos
  // - Realtime degradado: fallback a cada 60s (visível) / 120s (oculto)
  // - In-flight dedup: não inicia nova chamada se já há request em curso
  // - Focus/visibilitychange: respeitam janela mínima de 30s desde o último fetch
  const consecutiveChatFailuresRef = useRef<number>(0);

  useEffect(() => {
    if (!activeChat) return;

    let isSubscribed = true;
    let timerId: NodeJS.Timeout | null = null;
    consecutiveChatFailuresRef.current = 0;

    const scheduleNext = (ms: number) => {
      if (isSubscribed) timerId = setTimeout(pollChatMessages, ms);
    };

    const pollChatMessages = async () => {
      // In-flight dedup: aborta se já há fetch em curso
      if (isFetchingMessagesRef.current) {
        scheduleNext(5000);
        return;
      }

      // Realtime saudável ainda pode perder eventos quando a aba dorme ou
      // troca de rede; mantenha o histórico ativo atualizado em até 30s.
      if (isRealtimeConnectedRef.current) {
        const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";
        const minReconciliationMs = isVisible ? 30000 : 120000;
        const sinceLastMs = Date.now() - lastMsgFetchAtRef.current;
        if (sinceLastMs < minReconciliationMs) {
          scheduleNext(minReconciliationMs - sinceLastMs);
          return;
        }
      }

      isFetchingMessagesRef.current = true;
      lastMsgFetchAtRef.current = Date.now();

      try {
        let incomingMessages = await loadInstagramMessagesDirect(activeChat.id);

        // API é fallback quando o client Supabase não está disponível.
        if (incomingMessages === null) {
          const res = await fetch(getApiUrl(`/api/instagram/messages/${activeChat.id}`), { cache: "no-store" });
          if (!res.ok) {
            consecutiveChatFailuresRef.current += 1;
            return;
          }
          const data = await res.json();
          incomingMessages = Array.isArray(data?.messages) ? data.messages : [];
        }

        consecutiveChatFailuresRef.current = 0;
        if (!isSubscribed) return;
        const resolvedIncomingMessages = incomingMessages ?? [];

        setMessages((prev) => {
            const current = prev[activeChat.id] || [];

            const pendingMessages = current.filter(
              (m) => m.status === "sending" || m.status === "failed"
            );

            const serverMessages: DirectMessage[] = resolvedIncomingMessages.map((m) => ({
              ...m,
              status: m.status || "sent",
            }));

            const mergedMap = new Map<string, DirectMessage>();
            for (const m of current) {
              mergedMap.set(m.id, m);
            }
            for (const m of serverMessages) {
              const existing = mergedMap.get(m.id);
              mergedMap.set(m.id, {
                ...m,
                mediaUrl: m.mediaUrl || existing?.mediaUrl,
                mediaType: m.mediaType || existing?.mediaType,
                audioTranscript: m.audioTranscript || existing?.audioTranscript,
                replyTo: m.replyTo || existing?.replyTo,
                replyToMessageId: m.replyToMessageId || existing?.replyToMessageId,
                deliverAt: m.status === "sent" ? undefined : (m.deliverAt || existing?.deliverAt),
                delaySeconds: m.status === "sent" ? undefined : (m.delaySeconds || existing?.delaySeconds),
              });
            }
            for (const p of pendingMessages) {
              if (!mergedMap.has(p.id)) {
                mergedMap.set(p.id, p);
              }
            }
            const combinedList = deduplicateMessages(Array.from(mergedMap.values()));
            combinedList.sort((a, b) => {
              const tA = getMessageTimestampMs((a as any).timestamp || a.createdAt || a.sentDate);
              const tB = getMessageTimestampMs((b as any).timestamp || b.createdAt || b.sentDate);
              return tA - tB;
            });

            const isChanged =
              combinedList.length !== current.length ||
              combinedList.some((m, idx) => {
                const c = current[idx];
                if (!c) return true;
                return (
                  m.id !== c.id ||
                  m.text !== c.text ||
                  m.mediaUrl !== c.mediaUrl ||
                  m.replyToMessageId !== c.replyToMessageId ||
                  Boolean(m.replyTo) !== Boolean(c.replyTo) ||
                  m.status !== c.status
                );
              });

            if (isChanged) {
              if (combinedList.length > 0) {
                const latest = combinedList[combinedList.length - 1];
                if (!latest.isMine) {
                  autoPilotRef.current?.registerClientMessage(
                    activeChat.id,
                    (latest as any).timestamp || latest.sentDate || latest.createdAt
                  );
                }
                setConversations((prevConvs) =>
                  prevConvs.map((c) =>
                    c.id === activeChat.id
                      ? {
                          ...c,
                          lastMessage: latest.isMine ? `Você: ${latest.text}` : latest.text,
                          lastSender: latest.isMine ? "me" : "them",
                          lastActive: latest.createdAt || c.lastActive,
                          unread: false,
                        }
                      : c
                  )
                );
              }

              return {
                ...prev,
                [activeChat.id]: combinedList,
              };
            }

            return prev;
          });
      } catch {
        consecutiveChatFailuresRef.current += 1;
      } finally {
        isFetchingMessagesRef.current = false;
        if (isSubscribed) {
          const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";
          let nextInterval: number;
          if (isRealtimeConnectedRef.current) {
            // Realtime ok: reconciliação curta para recuperar eventos perdidos.
            nextInterval = isVisible ? 30000 : 120000;
          } else {
            // Realtime degradado: fallback com backoff
            const base = isVisible ? 60000 : 120000;
            nextInterval = getResilientInterval(consecutiveChatFailuresRef.current, base);
          }
          timerId = setTimeout(pollChatMessages, nextInterval);
        }
      }
    };

    // Revalidação imediata ao ganhar foco — respeita janela mínima de 30s
    const handleImmediateChatRevalidate = () => {
      if (!isSubscribed) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        const sinceLastMs = Date.now() - lastMsgFetchAtRef.current;
        if (sinceLastMs < 30000) return; // já buscou recentemente
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(pollChatMessages, 0);
      }
    };

    window.addEventListener("focus", handleImmediateChatRevalidate);
    document.addEventListener("visibilitychange", handleImmediateChatRevalidate);

    // Inicia com delay inicial de 5s (Realtime lida com atualizações imediatas)
    timerId = setTimeout(pollChatMessages, 5000);

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener("focus", handleImmediateChatRevalidate);
      document.removeEventListener("visibilitychange", handleImmediateChatRevalidate);
    };
  }, [activeChat, loadInstagramMessagesDirect]);
  // POLLING RESILIENTE 2 (fallback de reconciliação da lista de conversas)
  // - Realtime saudável: reconciliação apenas a cada 2 minutos
  // - Realtime degradado: fallback a cada 120s (visível) / 300s (oculto)
  // - In-flight dedup: não inicia nova chamada se já há request em curso
  // - Focus/visibilitychange: respeitam janela mínima de 60s desde o último fetch
  const consecutiveListFailuresRef = useRef<number>(0);

  useEffect(() => {
    let isSubscribed = true;
    let timerId: NodeJS.Timeout | null = null;
    consecutiveListFailuresRef.current = 0;

    const scheduleNext = (ms: number) => {
      if (isSubscribed) timerId = setTimeout(pollConversations, ms);
    };

    const pollConversations = async () => {
      // In-flight dedup: aborta se já há fetch em curso
      if (isFetchingConversationsRef.current) {
        scheduleNext(5000);
        return;
      }

      // Realtime saudável: reconciliação apenas a cada 2 minutos
      if (isRealtimeConnectedRef.current) {
        const sinceLastMs = Date.now() - lastConvFetchAtRef.current;
        if (sinceLastMs < 120000) {
          scheduleNext(120000 - sinceLastMs);
          return;
        }
      }

      isFetchingConversationsRef.current = true;
      lastConvFetchAtRef.current = Date.now();

      try {
        // A inbox usa somente a fonte canônica do Instagram.
        await loadInstagramConversations();
        consecutiveListFailuresRef.current = 0;
      } catch {
        consecutiveListFailuresRef.current += 1;
      } finally {
        isFetchingConversationsRef.current = false;
        if (isSubscribed) {
          const isVisible = typeof document !== "undefined" && document.visibilityState === "visible";
          let nextInterval: number;
          if (isRealtimeConnectedRef.current) {
            // Realtime ok: reconciliação a cada 2 minutos
            nextInterval = 120000;
          } else {
            // Realtime degradado: fallback com backoff
            const base = isVisible ? 120000 : 300000;
            nextInterval = getResilientInterval(consecutiveListFailuresRef.current, base);
          }
          timerId = setTimeout(pollConversations, nextInterval);
        }
      }
    };

    // Revalidação imediata ao ganhar foco — respeita janela mínima de 60s
    const handleImmediateListRevalidate = () => {
      if (!isSubscribed) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        const sinceLastMs = Date.now() - lastConvFetchAtRef.current;
        if (sinceLastMs < 60000) return; // já buscou recentemente
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(pollConversations, 0);
      }
    };

    window.addEventListener("focus", handleImmediateListRevalidate);
    document.addEventListener("visibilitychange", handleImmediateListRevalidate);

    // Inicia com delay de 10s — Realtime cobre atualizações imediatas
    timerId = setTimeout(pollConversations, 10000);

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener("focus", handleImmediateListRevalidate);
      document.removeEventListener("visibilitychange", handleImmediateListRevalidate);
    };
  }, [activeChat, loadInstagramConversations]);
  // Iniciar Gravação de Áudio via Microfone
  const handleStartRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Gravação de áudio não suportada neste navegador.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn("Aviso ao acessar microfone:", err);
      if (err?.name === "NotAllowedError") {
        alert("O acesso ao microfone foi cancelado ou bloqueado. Para gravar notas de voz, permita o microfone no ícone de permissões ao lado da URL no navegador.");
      } else {
        alert("Microfone indisponível ou não detectado neste dispositivo.");
      }
    }
  };

  // Parar Gravação e Opcionalmente Enviar
  const handleStopRecording = (shouldSend: boolean) => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      setRecordingSeconds(0);
      return;
    }

    if (!shouldSend) {
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((track) => track.stop());
      };
      recorder.stop();
      setIsRecording(false);
      setRecordingSeconds(0);
      return;
    }

    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      recorder.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setRecordingSeconds(0);

      if (audioBlob.size > 0) {
        await handleUploadAndSendAudio(audioBlob, "nota_voz.webm");
      }
    };

    recorder.stop();
  };

  // Upload para Supabase Storage e Envio de Áudio com conversão WAV nativa
  const handleUploadAndSendAudio = async (blobOrFile: Blob | File, filename = "nota_voz.wav") => {
    if (!activeChat) return;

    setIsUploadingMedia(true);
    try {
      const originalFile =
        blobOrFile instanceof File
          ? blobOrFile
          : new File([blobOrFile], filename, { type: blobOrFile.type || "audio/webm" });

      // Garante conversão PCM/WAV nativa para 100% de compatibilidade na Meta Graph API e navegadores
      const compatibleAudio = await ensureInstagramCompatibleAudio(originalFile);

      const formData = new FormData();
      formData.append("file", compatibleAudio, compatibleAudio.name);
      formData.append("type", "audio");

      const res = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Falha no upload do áudio para o servidor");
      }

      const data = await res.json();
      if (data.url) {
        await sendMessageWithText(`[audio:${data.url}]`);
      }
    } catch (err) {
      console.error("Erro ao enviar áudio gravado:", err);
      alert("Erro ao enviar nota de voz.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Upload para Supabase Storage e Envio de Foto/Vídeo (com suporte a legenda opcional)
  const handleUploadAndSendMedia = async (file: File, caption?: string) => {
    if (!activeChat) return;

    setIsUploadingMedia(true);
    try {
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/");
      const mediaType = isAudio ? "audio" : isVideo ? "video" : "image";

      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", mediaType);

      const res = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Falha no upload do arquivo");
      }

      const data = await res.json();
      if (data.url) {
        const cleanCaption = (caption || "").trim();
        if (isAudio) {
          await sendMessageWithText(`[audio:${data.url}]`);
        } else if (isVideo) {
          await sendMessageWithText(`[video:${data.url}]${cleanCaption ? ` ${cleanCaption}` : ""}`);
        } else {
          await sendMessageWithText(`[image:${data.url}]${cleanCaption ? ` ${cleanCaption}` : ""}`);
        }
      }
    } catch (err) {
      console.error("Erro ao enviar arquivo:", err);
      alert("Erro ao enviar anexo.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Disparo Rápido com 1 Toque a partir da Barra de Etapas do Chat
  const handleQuickSendChecklistItem = async (checkItem: StageChecklistItem) => {
    if (!activeChat) {
      toast.error("Abra uma conversa para disparar este item.");
      return;
    }

    const vaultItem: VaultItem = {
      id: checkItem.id,
      folderId: checkItem.folderId,
      type: checkItem.type,
      title: checkItem.title,
      content: checkItem.content,
      mediaUrl: checkItem.mediaUrl,
      duration: checkItem.duration,
      createdAt: new Date().toISOString(),
    };

    const isAudio = checkItem.type === "audio";
    // 1º item demora a sua cadência (áudio = duração do áudio, texto = 10s)
    const firstDelay = isAudio && checkItem.duration
      ? Math.min(Math.max(Math.round(checkItem.duration), 2), 60)
      : 10;
    await handleForwardVaultItem(vaultItem, firstDelay);
    void markItemCompletedByVaultItem(checkItem.id);

    // Se estiver vinculado a outro item, dispara também o segundo item em sequência somando a cadência ("e assim vai")
    if (checkItem.linkedItemId && chatDetail?.checklist) {
      const linkedCheckItem = chatDetail.checklist.find((i) => i.id === checkItem.linkedItemId);
      if (linkedCheckItem) {
        const linkedVaultItem: VaultItem = {
          id: linkedCheckItem.id,
          folderId: linkedCheckItem.folderId,
          type: linkedCheckItem.type,
          title: linkedCheckItem.title,
          content: linkedCheckItem.content,
          mediaUrl: linkedCheckItem.mediaUrl,
          duration: linkedCheckItem.duration,
          createdAt: new Date().toISOString(),
        };
        const secondDuration = linkedCheckItem.type === "audio" && linkedCheckItem.duration
          ? Math.min(Math.max(Math.round(linkedCheckItem.duration), 2), 60)
          : 10;
        await handleForwardVaultItem(linkedVaultItem, secondDuration);
        void markItemCompletedByVaultItem(linkedCheckItem.id);
      }
    }
  };

  // Encaminhamento inteligente de item do cofre para a conversa aberta (com delay assíncrono no backend)
  const handleForwardVaultItem = async (item: VaultItem, delaySeconds: number) => {
    if (!activeChat) {
      toast.error("Abra uma conversa para encaminhar este item.");
      return;
    }

    // Auto-check do item na barra de etapas se pertencer à etapa ativa.
    void markItemCompletedByVaultItem(item.id);

    const now = new Date();
    const nowIso = now.toISOString();
    const timeFormatted = formatMessageTime(now);

    let messageText = "";
    let mediaUrl: string | undefined = item.mediaUrl;
    const isAudio = item.type === "audio";
    const isImage = item.type === "image";

    // Se for áudio, garante formato 100% compatível com a Meta Graph API (WAV PCM 16-bit / M4A)
    if (isAudio) {
      if (mediaUrl) {
        // Se a URL remota for MP3 ou formato incompatível com a Meta, converte automaticamente para WAV
        mediaUrl = await ensureCompatibleAudioUrl(mediaUrl, getApiUrl("/api/instagram/upload"));
      } else if (item.mediaBlob) {
        try {
          const rawFile = new File([item.mediaBlob], item.fileName || "audio.wav", {
            type: item.mimeType || "audio/wav",
          });
          const compatibleAudio = await ensureInstagramCompatibleAudio(rawFile);
          const formData = new FormData();
          formData.append("file", compatibleAudio, compatibleAudio.name);
          formData.append("type", "audio");

          const upRes = await fetch(getApiUrl("/api/instagram/upload"), {
            method: "POST",
            body: formData,
          });
          if (upRes.ok) {
            const upData = await upRes.json();
            if (upData?.url) mediaUrl = upData.url;
          }
        } catch (err) {
          console.warn("Aviso no upload de áudio:", err);
        }
      }
    } else if (isImage && !mediaUrl && item.mediaBlob) {
      try {
        const formData = new FormData();
        const imgFile = new File([item.mediaBlob], item.fileName || "image.jpg", {
          type: item.mimeType || "image/jpeg",
        });
        formData.append("file", imgFile);
        formData.append("type", "image");

        const upRes = await fetch(getApiUrl("/api/instagram/upload"), {
          method: "POST",
          body: formData,
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          if (upData?.url) mediaUrl = upData.url;
        }
      } catch (err) {
        console.warn("Aviso no upload de foto:", err);
      }
    }

    if (isAudio) {
      messageText = mediaUrl ? `[audio:${mediaUrl}]` : "🎙️ Mensagem de voz";
    } else if (isImage) {
      messageText = mediaUrl ? `[image:${mediaUrl}]` : "📷 Foto";
    } else {
      messageText = item.content || item.title;
    }

    const previewText = isAudio
      ? "🎙️ Mensagem de voz"
      : isImage
      ? "📷 Foto"
      : messageText;

    // Conferência inteligente de fila de mensagens agendadas prévias
    const queue = getScheduledQueueInfo(activeChat.id);
    const itemCadence = Math.max(1, delaySeconds || 10);
    const effectiveDelaySeconds = queue.hasScheduled
      ? queue.remainingSeconds + itemCadence
      : delaySeconds;
    const deliverAt = effectiveDelaySeconds > 0 ? Date.now() + effectiveDelaySeconds * 1000 : undefined;

    if (deliverAt) {
      latestScheduledDeliverAtRef.current[activeChat.id] = deliverAt;
    }

    const scheduledTime = deliverAt ? new Date(deliverAt) : now;
    const tempId = `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newMsg: DirectMessage = {
      id: tempId,
      senderId: "me",
      text: messageText,
      mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
      mediaUrl,
      createdAt: formatMessageTime(scheduledTime),
      timestamp: scheduledTime.getTime(),
      sentDate: scheduledTime.toISOString(),
      isMine: true,
      status: "sending",
      deliverAt,
      delaySeconds: effectiveDelaySeconds,
    };

    // 1. Atualização otimista imediata na UI
    setMessages((prev) => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMsg],
    }));

    // 2. Atualiza a conversa e sobe para o topo
    setConversations((prev) => {
      const others = prev.filter((c) => c.id !== activeChat.id);
      const updated: DirectConversation = {
        ...activeChat,
        lastMessage: `Você: ${previewText}`,
        lastActive: formatMessageTime(scheduledTime),
        lastMessageAt: scheduledTime.toISOString(),
        unread: false,
        lastSender: "me",
        lastStatus: "sent",
        seenAt: undefined,
        isNewMatch: false,
      };
      return [updated, ...others];
    });

    setActiveChat((prev) =>
      prev
        ? {
            ...prev,
            lastMessage: `Você: ${previewText}`,
            lastActive: formatMessageTime(scheduledTime),
            lastMessageAt: scheduledTime.toISOString(),
            unread: false,
            lastSender: "me",
            lastStatus: "sent",
            seenAt: undefined,
            isNewMatch: false,
          }
        : null
    );

    setTimeout(() => scrollToBottom("auto"), 40);

    // Feedback com Toast da Sonner
    if (queue.hasScheduled) {
      toast.success(
        `Item adicionado à fila! Aguardará as mensagens anteriores e será entregue em ${effectiveDelaySeconds}s.`,
        { duration: 4500 }
      );
    } else if (effectiveDelaySeconds > 0) {
      toast.success(
        isAudio
          ? `Áudio agendado! O servidor aguardará ${effectiveDelaySeconds}s (duração) antes de entregar.`
          : `Texto agendado! O servidor aguardará 10s antes de entregar.`,
        { duration: 4500 }
      );
    } else {
      toast.success("Item encaminhado com sucesso!");
    }

    // 3. Dispara no endpoint com effectiveDelaySeconds para execução assíncrona no backend
    try {
      const endpoint = getApiUrl(`/api/instagram/messages/${activeChat.id}`);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          text: messageText,
          audioUrl: isAudio ? mediaUrl : undefined,
          mediaUrl: isImage ? mediaUrl : undefined,
          mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
          delaySeconds: effectiveDelaySeconds,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || `Falha no encaminhamento: status ${res.status}`);
      }

      const data = await res.json();
      const confirmedId = data?.message?.id || data?.id || tempId;
      const confirmedStatus = data?.queued ? "sending" : "sent";
      const targetChatId = activeChat.id;

      setMessages((prev) => ({
        ...prev,
        [targetChatId]: (prev[targetChatId] || []).map((m) =>
          m.id === tempId || m.id === confirmedId
            ? {
                ...m,
                id: confirmedId,
                status: confirmedStatus,
                deliverAt: m.deliverAt || deliverAt,
                delaySeconds: m.delaySeconds || effectiveDelaySeconds,
              }
            : m
        ),
      }));

      // Transição suave de segurança no client quando o delay expirar
      if (effectiveDelaySeconds > 0) {
        const safetyTimeoutMs = effectiveDelaySeconds * 1000 + 800;
        setTimeout(() => {
          setMessages((prev) => {
            const list = prev[targetChatId];
            if (!list) return prev;
            let changed = false;
            const updated = list.map((m) => {
              if ((m.id === tempId || m.id === confirmedId) && m.status === "sending") {
                changed = true;
                return {
                  ...m,
                  status: "sent" as const,
                  deliverAt: undefined,
                  delaySeconds: undefined,
                };
              }
              return m;
            });
            return changed ? { ...prev, [targetChatId]: updated } : prev;
          });
        }, safetyTimeoutMs);
      }

      notifyLocalTabs("instagram_message", {
        id: confirmedId,
        conversationId: activeChat.id,
        senderId: "me",
        text: messageText,
        timestamp: nowIso,
        isMine: true,
        status: confirmedStatus,
        mediaUrl,
        mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
      });
    } catch (err) {
      console.error("Erro ao encaminhar item do cofre:", err);
      toast.error((err as Error).message || "Erro ao encaminhar mensagem.");
      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
          m.id === tempId ? { ...m, status: "failed" } : m
        ),
      }));
    }
  };

  // Envio central de mensagem com rastreamento de status e suporte completo a mídias
  const sendMessageWithText = async (textToSend: string): Promise<boolean> => {
    if (!textToSend.trim() || !activeChat) return false;

    const messageText = textToSend.trim();
    void markItemCompletedByExactText(messageText);
    const now = new Date();
    const nowIso = now.toISOString();
    const timeFormatted = formatMessageTime(now);


    const isAudioMsg = messageText.startsWith("[audio:");
    const isImageMsg = messageText.startsWith("[image:");
    const audioUrl = isAudioMsg ? messageText.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;
    const imageUrl = isImageMsg ? messageText.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;
    const previewText = isAudioMsg
      ? "🎙️ Mensagem de voz"
      : isImageMsg
      ? "📷 Foto"
      : messageText;

    const currentReply = replyingToMessage
      ? {
          id: replyingToMessage.id,
          senderId: replyingToMessage.senderId,
          senderName: replyingToMessage.isMine ? "Você" : activeChat.fullName || activeChat.username,
          text: isInstagramSharedMediaText(replyingToMessage.text)
            ? "🎞️ Reel compartilhado"
            : replyingToMessage.text || (replyingToMessage.mediaType === "audio" ? "🎙️ Mensagem de voz" : replyingToMessage.mediaType === "image" ? "📷 Foto" : replyingToMessage.mediaType === "video" ? "🎥 Vídeo" : "Mensagem"),
        }
      : undefined;

    setReplyingToMessage(null);

    if (activeChat.type === "tinder") {
      const tempId = `temp-tinder-${Date.now()}`;
      const optimistic: DirectMessage = {
        id: tempId,
        senderId: "me",
        text: previewText,
        mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
        mediaUrl: audioUrl || imageUrl,
        createdAt: timeFormatted,
        timestamp: now.getTime(),
        sentDate: nowIso,
        isMine: true,
        status: "sending",
        replyTo: currentReply,
        replyToMessageId: currentReply?.id || null,
      };

      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] || []), optimistic],
      }));
      setTimeout(() => scrollToBottom("auto"), 40);

      try {
        const response = await fetch(getApiUrl(`/api/tinder/messages/${activeChat.id}`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Falha ao enviar mensagem no Tinder");
        }

        const data = await response.json();
        const confirmedId = data.message?._id || data.message?.id || tempId;

        setMessages((prev) => ({
          ...prev,
          [activeChat.id]: (prev[activeChat.id] || []).map((message) =>
            message.id === tempId
              ? { ...message, id: confirmedId, status: "sent" }
              : message
          ),
        }));

        setConversations((prev) => {
          return prev.map((c) => {
            if (c.id === activeChat.id) {
              return {
                ...c,
                lastMessage: `Você: ${previewText}`,
                lastActive: timeFormatted,
                lastMessageAt: nowIso,
                lastSender: "me" as const,
                lastStatus: "sent",
                unread: false,
              };
            }
            return c;
          });
        });

        setActiveChat((prev) =>
          prev ? { ...prev, lastMessage: `Você: ${previewText}`, lastActive: timeFormatted, lastMessageAt: nowIso, lastSender: "me", lastStatus: "sent", unread: false } : null
        );
        return true;
      } catch (error) {
        console.error("Erro ao enviar mensagem no Tinder:", error);
        setMessages((prev) => ({
          ...prev,
          [activeChat.id]: (prev[activeChat.id] || []).map((message) =>
            message.id === tempId ? { ...message, status: "failed" } : message
          ),
        }));
        toast.error((error as Error).message || "Falha ao enviar no Tinder.");
        return false;
      }
    }

    if (activeChat.type === "whatsapp2") {
      const tempId = `temp-wa2-${Date.now()}`;
      const optimistic: DirectMessage = {
        id: tempId,
        senderId: "me",
        text: previewText,
        mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
        mediaUrl: audioUrl || imageUrl,
        createdAt: timeFormatted,
        timestamp: now.getTime(),
        sentDate: nowIso,
        isMine: true,
        status: "sending",
        replyTo: currentReply,
        replyToMessageId: currentReply?.id || null,
      };

      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] || []), optimistic],
      }));
      setTimeout(() => scrollToBottom("auto"), 40);

      try {
        const providerId = activeChat.providerId || activeChat.id.replace(/^wa2:/, "");
        let whatsapp2AudioUrl = audioUrl;

        if (audioUrl) {
          try {
            const supabase = getSupabaseBrowserClient();
            if (supabase) {
              const { data: audioVariant } = await supabase
                .from("persona_audios")
                .select("whatsapp_audio_url")
                .eq("audio_url", audioUrl)
                .maybeSingle();
              const nativeVoiceUrl = String(audioVariant?.whatsapp_audio_url || "").trim();
              if (nativeVoiceUrl) whatsapp2AudioUrl = nativeVoiceUrl;
            }
          } catch (error) {
            console.warn("[WhatsApp 2] Variante OGG/Opus indisponível; usando áudio original.", error);
          }
        }

        const response = whatsapp2AudioUrl
          ? await sendWhatsApp2Media({
              to: providerId,
              mediaUrl: whatsapp2AudioUrl,
              asVoice: true,
              replyToMessageId: currentReply?.id || null,
            })
          : imageUrl
          ? await sendWhatsApp2Media({
              to: providerId,
              mediaUrl: imageUrl,
              replyToMessageId: currentReply?.id || null,
            })
          : await sendWhatsApp2Text({
              to: providerId,
              text: messageText,
              replyToMessageId: currentReply?.id || null,
            });

        const confirmedId = response.message?.id || tempId;
        setMessages((prev) => ({
          ...prev,
          [activeChat.id]: (prev[activeChat.id] || []).map((message) =>
            message.id === tempId
              ? { ...message, id: confirmedId, status: "sent" }
              : message
          ),
        }));
        setWhatsApp2Conversations((prev) => {
          const updated = {
            ...activeChat,
            lastMessage: `Você: ${previewText}`,
            lastActive: timeFormatted,
            lastMessageAt: nowIso,
            lastSender: "me" as const,
            lastStatus: "sent",
            unread: false,
          };
          return [updated, ...prev.filter((conversation) => conversation.id !== activeChat.id)];
        });
        setActiveChat((prev) =>
          prev ? { ...prev, lastMessage: `Você: ${previewText}`, lastActive: timeFormatted, lastMessageAt: nowIso, lastSender: "me", lastStatus: "sent", unread: false } : null
        );
        return true;
      } catch (error) {
        console.error("Erro ao enviar pelo WhatsApp 2:", error);
        setMessages((prev) => ({
          ...prev,
          [activeChat.id]: (prev[activeChat.id] || []).map((message) =>
            message.id === tempId ? { ...message, status: "failed" } : message
          ),
        }));
        toast.error((error as Error).message || "Falha ao enviar pelo WhatsApp 2.");
        return false;
      }
    }

    // Conferência inteligente de mensagens agendadas prévias
    const queue = getScheduledQueueInfo(activeChat.id);
    let effectiveDelay = 0;
    let deliverAt: number | undefined = undefined;

    if (queue.hasScheduled) {
      const cadence = await getMessageCadenceSeconds(messageText);
      effectiveDelay = queue.remainingSeconds + cadence;
      deliverAt = Date.now() + effectiveDelay * 1000;
      latestScheduledDeliverAtRef.current[activeChat.id] = deliverAt;
    }

    const scheduledTime = deliverAt ? new Date(deliverAt) : now;
    const tempId = `temp-${Date.now()}`;
    const newMsg: DirectMessage = {
      id: tempId,
      senderId: "me",
      text: messageText,
      mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
      mediaUrl: audioUrl || imageUrl,
      createdAt: formatMessageTime(scheduledTime),
      timestamp: scheduledTime.getTime(),
      sentDate: scheduledTime.toISOString(),
      isMine: true,
      status: "sending",
      deliverAt: queue.hasScheduled ? deliverAt : undefined,
      delaySeconds: queue.hasScheduled ? effectiveDelay : undefined,
      replyTo: currentReply,
      replyToMessageId: currentReply?.id || null,
    };

    // 1. Atualização otimista imediata na UI com status 'sending'
    setMessages((prev) => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMsg],
    }));

    // 2. Atualiza a conversa e a coloca no topo da lista imediatamente
    setConversations((prev) => {
      const others = prev.filter((c) => c.id !== activeChat.id);
      const updated: DirectConversation = {
        ...activeChat,
        lastMessage: `Você: ${previewText}`,
        lastActive: formatMessageTime(scheduledTime),
        lastMessageAt: scheduledTime.toISOString(),
        unread: false,
        lastSender: "me",
        lastStatus: "sent",
        seenAt: undefined,
        isNewMatch: false,
      };
      return [updated, ...others];
    });

    // Mantém activeChat sincronizado com os mesmos metadados atualizados
    setActiveChat((prev) =>
      prev
        ? {
            ...prev,
            lastMessage: `Você: ${previewText}`,
            lastActive: formatMessageTime(scheduledTime),
            lastMessageAt: scheduledTime.toISOString(),
            unread: false,
            lastSender: "me",
            lastStatus: "sent",
            seenAt: undefined,
            isNewMatch: false,
          }
        : null
    );

    // Rola instantaneamente para a nova mensagem
    setTimeout(() => scrollToBottom("auto"), 40);

    // 3. Dispara no endpoint do Instagram com payload estruturado de mídia
    try {
      const endpoint = getApiUrl(`/api/instagram/messages/${activeChat.id}`);

      console.log("🚀 [Instagram Reply - UI] Disparando envio de mensagem:", {
        text: messageText,
        replyTo: currentReply,
        replyToMessageId: currentReply?.id,
        delaySeconds: queue.hasScheduled ? effectiveDelay : undefined,
      });

      if (queue.hasScheduled) {
        toast.success(
          `Mensagem adicionada à fila! Enviando em ${effectiveDelay}s após as mensagens agendadas.`,
          { duration: 4000 }
        );
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          text: messageText,
          audioUrl,
          mediaUrl: imageUrl,
          mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
          replyTo: currentReply,
          replyToMessageId: currentReply?.id,
          delaySeconds: queue.hasScheduled ? effectiveDelay : undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const err: any = new Error(errJson?.message || errJson?.error || `Falha no envio da mensagem: status ${res.status}`);
        if (
          errJson?.error === "outside_24h_window" ||
          errJson?.errorReason === "outside_24h_window" ||
          errJson?.isOutside24hWindow ||
          /outside.*allowed window/i.test(errJson?.error || "") ||
          /outside.*24-hour window/i.test(errJson?.error || "") ||
          /outside.*allowed window/i.test(errJson?.message || "") ||
          /outside.*24-hour window/i.test(errJson?.message || "") ||
          /2018278/.test(errJson?.error || "") ||
          /2018278/.test(errJson?.message || "")
        ) {
          err.errorReason = "outside_24h_window";
        }
        throw err;
      }

      const data = await res.json();
      console.log("✅ [Chat Reply - UI] Mensagem confirmada pela API:", data);
      const confirmedMid = data?.message?.id || data?.id || tempId;
      const confirmedStatus = (queue.hasScheduled || data?.queued) ? "sending" : "sent";

      // O backend é a fonte canônica da relação reply_to_message_id.
      // O client mantém apenas a projeção otimista para resposta instantânea na interface.

      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
          m.id === tempId || m.id === confirmedMid
            ? {
                ...m,
                id: confirmedMid,
                status: confirmedStatus,
                deliverAt: queue.hasScheduled ? (m.deliverAt || deliverAt) : undefined,
                delaySeconds: queue.hasScheduled ? (m.delaySeconds || effectiveDelay) : undefined,
                replyTo: currentReply || m.replyTo,
                replyToMessageId: currentReply?.id || m.replyToMessageId,
              }
            : m
        ),
      }));

      // Transição suave de segurança no client quando o delay agendado expirar
      if (queue.hasScheduled && effectiveDelay > 0) {
        const safetyTimeoutMs = effectiveDelay * 1000 + 800;
        const targetChatId = activeChat.id;
        setTimeout(() => {
          setMessages((prev) => {
            const list = prev[targetChatId];
            if (!list) return prev;
            let changed = false;
            const updated = list.map((m) => {
              if ((m.id === tempId || m.id === confirmedMid) && m.status === "sending") {
                changed = true;
                return {
                  ...m,
                  status: "sent" as const,
                  deliverAt: undefined,
                  delaySeconds: undefined,
                };
              }
              return m;
            });
            return changed ? { ...prev, [targetChatId]: updated } : prev;
          });
        }, safetyTimeoutMs);
      }

      // Notifica abas irmãs no mesmo navegador instantaneamente
      notifyLocalTabs("instagram_message", {
        id: confirmedMid,
        conversationId: activeChat.id,
        senderId: "me",
        text: messageText,
        timestamp: nowIso,
        isMine: true,
        status: "sent",
        mediaUrl: audioUrl || imageUrl || undefined,
        mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
        replyTo: currentReply,
        replyToMessageId: currentReply?.id,
      });
      return true;
    } catch (err: any) {
      console.error("Erro ao enviar mensagem:", err);
      const is24h =
        err?.errorReason === "outside_24h_window" ||
        /outside.*allowed window/i.test(err?.message || "") ||
        /outside.*24-hour window/i.test(err?.message || "") ||
        /2018278/.test(err?.message || "");

      if (is24h) {
        toast.error("Janela de 24h da Meta expirada. Abra no Instagram para responder.", { duration: 5000 });
      } else {
        toast.error((err as Error).message || "Falha no envio da mensagem.");
      }

      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
          m.id === tempId
            ? { ...m, status: "failed", errorReason: is24h ? "outside_24h_window" : "generic" }
            : m
        ),
      }));
      return false;
    }
  };

  // Envio de mensagem pelo formulário tradicional (com suporte a foto pendente com legenda)
  const handleSendMessage = async (textToSend: string) => {
    if ((!textToSend.trim() && !pendingImage) || !activeChat) return;

    if (pendingImage) {
      const fileToSend = pendingImage.file;
      const captionText = textToSend.trim();
      cancelPendingImage();
      await handleUploadAndSendMedia(fileToSend, captionText);
      return;
    }

    const messageText = textToSend.trim();
    await sendMessageWithText(messageText);
  };

  // Reenvio de mensagem com falha (retry)
  const handleRetryMessage = async (failedMsg: DirectMessage) => {
    if (!activeChat) return;

    // Atualiza status local para 'sending'
    setMessages((prev) => ({
      ...prev,
      [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
        m.id === failedMsg.id ? { ...m, status: "sending" } : m
      ),
    }));

    try {
      let textToSend = failedMsg.text;
      let audioUrlToSend = failedMsg.mediaUrl;

      // Se for áudio, verifica se a URL é incompatível com a Meta (ex: .mp3) e converte automaticamente
      const audioMatch = textToSend.match(/^\[audio:(https?:\/\/[^\]]+)\]/);
      if (audioMatch || failedMsg.mediaType === "audio") {
        const rawAudioUrl = audioMatch ? audioMatch[1] : failedMsg.mediaUrl;
        if (rawAudioUrl) {
          const compatibleUrl = await ensureCompatibleAudioUrl(
            rawAudioUrl,
            getApiUrl("/api/instagram/upload")
          );
          if (compatibleUrl && compatibleUrl !== rawAudioUrl) {
            audioUrlToSend = compatibleUrl;
            textToSend = `[audio:${compatibleUrl}]`;
          }
        }
      }

      const endpoint = getApiUrl(`/api/instagram/messages/${activeChat.id}`);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          text: textToSend,
          audioUrl: audioUrlToSend,
          mediaUrl: failedMsg.mediaType === "image" ? failedMsg.mediaUrl : undefined,
          stickerUrl: failedMsg.mediaType === "sticker" ? failedMsg.mediaUrl : undefined,
          mediaType: failedMsg.mediaType,
          replyTo: failedMsg.replyTo,
          replyToMessageId: failedMsg.replyToMessageId,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const err: any = new Error(errJson?.message || errJson?.error || `Falha na retentativa: status ${res.status}`);
        if (
          errJson?.error === "outside_24h_window" ||
          errJson?.errorReason === "outside_24h_window" ||
          errJson?.isOutside24hWindow ||
          /outside.*allowed window/i.test(errJson?.error || "") ||
          /outside.*24-hour window/i.test(errJson?.error || "") ||
          /outside.*allowed window/i.test(errJson?.message || "") ||
          /outside.*24-hour window/i.test(errJson?.message || "") ||
          /2018278/.test(errJson?.error || "") ||
          /2018278/.test(errJson?.message || "")
        ) {
          err.errorReason = "outside_24h_window";
        }
        throw err;
      }

      const data = await res.json();
      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
          m.id === failedMsg.id
            ? {
                ...m,
                id: data?.message?.id || failedMsg.id,
                status: "sent",
                errorReason: undefined,
              }
            : m
        ),
      }));
    } catch (err: any) {
      console.error("Erro ao reenviar mensagem:", err);
      const is24h =
        err?.errorReason === "outside_24h_window" ||
        /outside.*allowed window/i.test(err?.message || "") ||
        /outside.*24-hour window/i.test(err?.message || "") ||
        /2018278/.test(err?.message || "");

      if (is24h) {
        toast.error("Janela de 24h da Meta expirada. Abra no aplicativo do Instagram para responder.", { duration: 5000 });
      }

      setMessages((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
          m.id === failedMsg.id
            ? { ...m, status: "failed", errorReason: is24h ? "outside_24h_window" : "generic" }
            : m
        ),
      }));
    }
  };

  const handleOpenInInstagram = (username?: string) => {
    if (!username) return;
    const clean = username.replace(/^@/, "").replace(/^ig_/, "").trim();
    if (!clean) return;
    window.open(`https://ig.me/m/${clean}`, "_blank");
  };

  const handleToggleLike = (msgId: string) => {
    if (!activeChat) return;
    setMessages((prev) => ({
      ...prev,
      [activeChat.id]: (prev[activeChat.id] || []).map((m) =>
        m.id === msgId ? { ...m, liked: !m.liked } : m
      ),
    }));
  };

  const closeChatDirectly = useCallback(() => {
    if (activeChatIdRef.current) {
      markConversationAsReadLocally(activeChatIdRef.current);
    }
    activeChatIdRef.current = null;
    setLoadingConversationId(null);
    setChatViewportReadyId(null);
    setActiveChat(null);
    setReplyingToMessage(null);
    onChatOpenChange?.(false);

    loadInstagramConversations();

    // Restaura a posição exata de rolagem da lista
    requestAnimationFrame(() => {
      if (conversationsScrollRef.current && savedScrollTopRef.current > 0) {
        conversationsScrollRef.current.scrollTop = savedScrollTopRef.current;
      }
    });
  }, [loadInstagramConversations, markConversationAsReadLocally, onChatOpenChange]);

  // Intercepta o botão voltar físico/gesto do dispositivo (Android/iOS/Navegador)
  useEffect(() => {
    const handlePopState = () => {
      // Se havia uma conversa aberta, fecha o chat sem sair da aplicação
      if (activeChatIdRef.current) {
        isPushedToHistoryRef.current = false;
        closeChatDirectly();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [closeChatDirectly]);

  const handleCloseChat = useCallback(() => {
    if (isPushedToHistoryRef.current) {
      isPushedToHistoryRef.current = false;
      if (typeof window !== "undefined" && window.history.length > 1) {
        window.history.back();
      }
    }
    closeChatDirectly();
  }, [closeChatDirectly]);

  const handleOpenConversation = async (conv: DirectConversation) => {
    const loadStartedAt = performance.now();
    chatLoadStartedAtRef.current.set(conv.id, loadStartedAt);
    if (conversationsScrollRef.current) savedScrollTopRef.current = conversationsScrollRef.current.scrollTop;

    markConversationAsReadLocally(conv.id);
    activeChatIdRef.current = conv.id;
    shouldStickToBottomRef.current = true;
    setChatViewportReadyId(null);
    setActiveChannel(conv.type);
    setActiveChat(conv);
    setReplyingToMessage(null);
    onChatOpenChange?.(true);

    if (typeof window !== "undefined") {
      if (!isPushedToHistoryRef.current) {
        window.history.pushState({ vendeoChatOpen: true, chatId: conv.id }, "");
        isPushedToHistoryRef.current = true;
      } else {
        window.history.replaceState({ vendeoChatOpen: true, chatId: conv.id }, "");
      }
    }

    setConversations((prev) => prev.map((item) => item.id === conv.id ? { ...item, unread: false } : item));
    if (conv.type === "whatsapp2") {
      setWhatsApp2Conversations((prev) => prev.map((item) => item.id === conv.id ? { ...item, unread: false } : item));
      setLoadingConversationId(conv.id);
      try {
        const providerId = conv.providerId || conv.id.replace(/^wa2:/, "");
        const rows = await getWhatsApp2Messages(providerId, 140);
        const formatted = rows.map(mapWhatsApp2Message);
        setMessages((previous) => ({ ...previous, [conv.id]: formatted }));
      } catch (error) {
        console.error("Erro ao carregar mensagens do WhatsApp 2:", error);
        toast.error("Não consegui carregar o histórico do WhatsApp 2.");
      } finally {
        setLoadingConversationId((current) => current === conv.id ? null : current);
      }
      return;
    }
    if (conv.type === "tinder") {
      setLoadingConversationId(conv.id);
      try {
        const res = await fetch(getApiUrl(`/api/tinder/messages/${conv.id}`), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const msgs: DirectMessage[] = (data.messages || []).map((m: any) => ({
            id: m._id || m.id,
            senderId: m.from === tinderSession?.profile?.id || m.is_mine ? "me" : m.from,
            text: m.message,
            createdAt: formatMessageTime(m.sent_date || m.timestamp),
            timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
            sentDate: m.sent_date,
            isMine: m.from === tinderSession?.profile?.id || m.is_mine,
            status: "sent",
          }));
          setMessages((previous) => ({ ...previous, [conv.id]: msgs }));
        }
      } catch (error) {
        console.error("Erro ao carregar mensagens do Tinder:", error);
      } finally {
        setLoadingConversationId((current) => current === conv.id ? null : current);
      }
      return;
    }
    if (conv.type === "instagram") {
      fetch(getApiUrl(`/api/instagram/conversations/${conv.id}/read`), { method: "POST" }).catch(() => {});
    }

    const cached = messages[conv.id];
    const hasCache = Boolean(cached?.length);
    setLoadingConversationId(hasCache ? null : conv.id);
    if (process.env.NODE_ENV !== "production") {
      console.debug(hasCache ? "chat_load_cache_hit" : "chat_load_start", {
        conversationId: conv.id,
        elapsedMs: Math.round(performance.now() - loadStartedAt),
      });
    }

    const endpoint = getApiUrl(`/api/instagram/messages/${conv.id}`);

    try {
      await runDeduplicatedConversationFetch(messageFetchesRef.current, conv.id, async () => {
        let formatted: DirectMessage[] | null = null;

        // Abre direto do Supabase no browser. Evita a volta
        // browser -> Next API -> Supabase -> browser no caminho crítico.
        formatted = await loadInstagramMessagesDirect(conv.id);

        // Falha/indisponibilidade do Supabase browser: mantém API como fallback.
        if (formatted === null) {
          const response = await fetch(endpoint, { cache: "no-store" });
          if (!response.ok) throw new Error(`Falha ao carregar mensagens: ${response.status}`);
          const data = await response.json();
          formatted = Array.isArray(data.messages)
            ? data.messages.map((message: DirectMessage) => ({ ...message, status: message.status || "sent" }))
            : [];
        }

        const resolvedFormatted = formatted ?? [];
        resolvedFormatted.sort((left, right) =>
          getMessageTimestampMs(left.timestamp || left.createdAt || left.sentDate)
          - getMessageTimestampMs(right.timestamp || right.createdAt || right.sentDate),
        );

        const newestIncoming = resolvedFormatted.reduce((latest, message) => Math.max(
          latest,
          getMessageTimestampMs(message.timestamp || message.sentDate || message.createdAt),
        ), 0);
        if (newestIncoming > 0) latestFetchedMessageAtRef.current.set(conv.id, newestIncoming);
        setMessages((previous) => ({ ...previous, [conv.id]: resolvedFormatted }));
        if (process.env.NODE_ENV !== "production") {
          console.debug("chat_load_db_complete", {
            conversationId: conv.id,
            messageCount: resolvedFormatted.length,
            elapsedMs: Math.round(performance.now() - loadStartedAt),
          });
        }

        if (resolvedFormatted.length === 0 && conv.type === "instagram") {
          if (process.env.NODE_ENV !== "production") console.debug("chat_background_sync_started", { conversationId: conv.id });
          void fetch(getApiUrl("/api/instagram/sync"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: conv.id }),
          })
            .then(async (syncResponse) => {
              const syncResult = await syncResponse.json();
              if (!syncResponse.ok || !syncResult.success) throw new Error("Sincronização em segundo plano falhou");
              await fetchConversationMessages(conv.id);
              if (process.env.NODE_ENV !== "production") {
                console.debug("chat_background_sync_complete", { conversationId: conv.id });
              }
            })
            .catch((error) => console.warn("Erro na sincronização em segundo plano do Instagram:", error));
        }
      }, () => {
        if (process.env.NODE_ENV !== "production") console.debug("chat_fetch_deduped", { conversationId: conv.id });
      });
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);
    } finally {
      setLoadingConversationId((current) => current === conv.id ? null : current);
    }
  };

  // Navegação automática para o chat ao clicar em uma notificação móvel (#chat=conversationId)
  useEffect(() => {
    const handleHashCheck = () => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      if (hash.startsWith("#chat=")) {
        const convId = hash.replace("#chat=", "");
        const target = conversations.find((c) => c.id === convId);
        if (target) {
          handleOpenConversation(target);
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      }
    };

    handleHashCheck();
    window.addEventListener("hashchange", handleHashCheck);
    return () => window.removeEventListener("hashchange", handleHashCheck);
  }, [conversations, handleOpenConversation]);

  // FILTRAGEM DE CONVERSAS DO INSTAGRAM
  const isFilterActive =
    sortOrder !== "recentes" ||
    instaFilter !== "todos" ||
    stageFilter !== "todas" ||
    aiFilter !== "todas";

  const visiblePlatformConversations = conversations.filter(
    (c) =>
      !c.id?.startsWith("__") &&
      c.status !== "system" &&
      c.status !== "vault"
  );

  const instagramConversationCount = visiblePlatformConversations.filter((c) => c.type === "instagram").length;
  const whatsappConversationCount = whatsapp2Conversations.length;
  const tinderConversations = visiblePlatformConversations.filter((c) => c.type === "tinder");
  const tinderConversationCount = tinderConversations.length;
  const instagramUnreadCount = visiblePlatformConversations.filter(
    (c) => c.type === "instagram" && isConversationUnread(c)
  ).length;
  const whatsappUnreadCount = whatsapp2Conversations.filter((c) => isConversationUnread(c)).length;
  const tinderUnreadCount = tinderConversations.filter((c) => isConversationUnread(c)).length;

  const platformConversations = activeChannel === "whatsapp2"
    ? whatsapp2Conversations
    : activeChannel === "tinder"
    ? tinderConversations
    : visiblePlatformConversations.filter((c) => c.type === "instagram");

  // Contadores para badges e sub-filtros de Pedidos e Restringidos
  const pedidosCount = platformConversations.filter(
    (c) => isChatRestricted(c) || c.status === "pending"
  ).length;

  const restringidosCount = platformConversations.filter(
    (c) => isChatRestricted(c)
  ).length;

  const aiEnabledCount = platformConversations.filter((c) => c.aiAutoRespond === true).length;
  const aiDisabledCount = platformConversations.filter((c) => c.aiAutoRespond !== true).length;
  const whatsappArchivedCount = platformConversations.filter(
    (c) => c.archived === true && (activeChannel !== "whatsapp2" || c.isLocked !== true)
  ).length;
  const whatsappLockedCount = activeChannel === "whatsapp2"
    ? platformConversations.filter((c) => c.isLocked === true).length
    : 0;
  const effectiveWhatsAppResponseFilter = whatsappResponseFilter;
  const whatsappInboxPrimaryConversations = platformConversations.filter(
    (c) =>
      !isChatRestricted(c) &&
      c.status !== "pending" &&
      c.archived !== true &&
      (activeChannel !== "whatsapp2" || c.isLocked !== true)
  );
  const whatsappNotAnsweredCount = whatsappInboxPrimaryConversations.filter(
    (c) => c.lastSender === "them" || isConversationUnread(c)
  ).length;
  const whatsappAnsweredCount = whatsappInboxPrimaryConversations.filter(
    (c) => c.lastSender === "me"
  ).length;

  const effectiveStageFilter = isWhatsAppInboxChannel ? whatsappStageFilter : stageFilter;

  const filteredConversations = platformConversations
    .filter((c) => {
      const isRestr = isChatRestricted(c);
      const isRestrictedOrPending = Boolean(isRestr || c.status === "pending");

      if (isWhatsAppInboxChannel) {
        if (effectiveWhatsAppResponseFilter === "trancadas") {
          return activeChannel === "whatsapp2" && c.isLocked === true;
        }

        if (effectiveWhatsAppResponseFilter === "arquivados") {
          return c.archived === true && (activeChannel !== "whatsapp2" || c.isLocked !== true);
        }

        // Conversas arquivadas e trancadas ficam fora da caixa principal.
        if (c.archived === true) return false;
        if (activeChannel === "whatsapp2" && c.isLocked === true) return false;

        if (isRestrictedOrPending) return false;

        if (effectiveWhatsAppResponseFilter === "respondidos" && c.lastSender !== "me") return false;
        if (
          effectiveWhatsAppResponseFilter === "nao_respondidos" &&
          !(c.lastSender === "them" || isConversationUnread(c))
        ) {
          return false;
        }

        if (whatsappQuickFilter === "nao_lidas") return isConversationUnread(c);
        if (whatsappQuickFilter === "com_ia") return c.aiAutoRespond === true;
        if (whatsappQuickFilter === "sem_ia") return c.aiAutoRespond !== true;
        return true;
      }

      if (isTinderInboxChannel) {
        if (tinderFilter === "restritos") return isRestr;
        if (isRestr) return false;
        if (tinderFilter === "novos") return Boolean(c.isNewMatch);
        if (tinderFilter === "sua_vez") return c.lastSender === "them" || isConversationUnread(c);
        if (tinderFilter === "vez_deles") return c.lastSender === "me";
        return true;
      }

      // Aba PEDIDOS: reúne pedidos de novas mensagens e contas restringidas no Instagram.
      if (instaFilter === "pedidos") {
        if (pedidosSubFilter === "restringidos") {
          return isRestr;
        }
        return isRestrictedOrPending;
      }

      // Contas restringidas e pedidos pendentes não aparecem na caixa principal.
      if (isRestrictedOrPending) return false;

      if (instaFilter === "respondidos") return c.lastSender === "me";
      if (instaFilter === "nao_respondidos") return c.lastSender === "them" || isConversationUnread(c);
      return true;
    })
    .filter((c) => {
      if (effectiveStageFilter === "concluidos") {
        return Boolean(c.isConverted);
      }
      if (effectiveStageFilter !== "todas") {
        const currentStageId = c.currentStageId || (stages.length > 0 ? stages[0].id : "");
        return currentStageId === effectiveStageFilter && !c.isConverted;
      }
      return true;
    })
    .filter((c) => {
      if (isWhatsAppInboxChannel || isTinderInboxChannel) return true;
      if (aiFilter === "todas") return true;
      if (aiFilter === "com_ia") return c.aiAutoRespond === true;
      return c.aiAutoRespond !== true;
    })
    .filter((c) => {
      if (!deferredSearchQuery.trim()) return true;
      const q = deferredSearchQuery.toLowerCase();
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
      );
    });

  // Ordenação Temporal: Mais Recentes Primeiro (padrão) ou Mais Antigas Primeiro
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;

    if (activeChannel === "instagram" && sortOrder === "antigas") {
      return timeA - timeB;
    }
    return timeB - timeA;
  });
  const brainInboxOverview = useMemo<Record<string, BrainInboxOverviewItem>>(() => {
    const result: Record<string, BrainInboxOverviewItem> = {};
    for (const conversation of sortedConversations) {
      const state = autoPilot.chatStates[conversation.id];
      if (!state) continue;
      const rawStatus = state.isSending ? "sending" : state.status;
      const status: BrainInboxOverviewItem["status"] =
        rawStatus === "activation_wait" || rawStatus === "waiting_delay" || rawStatus === "waiting_debounce" || rawStatus === "scheduled"
          ? "waiting_delay"
          : rawStatus === "in_queue"
          ? "queued"
          : rawStatus === "paused_handoff" || rawStatus === "paused_guardrail" || rawStatus === "waiting_human"
          ? "waiting_human"
          : rawStatus === "processing"
          ? "processing"
          : rawStatus === "failed"
          ? "failed"
          : rawStatus === "disabled"
          ? "disabled"
          : rawStatus === "sending"
          ? "sending"
          : "idle";
      const runtimeState = state as typeof state & { currentObjectiveLabel?: string | null };
      const actionTypes = Array.from(new Set((state.pendingOutboundMessages || []).map((item) => item.messageType)));
      result[conversation.id] = {
        status,
        label: state.activity?.label || (state.isEnabled ? "IA pronta" : "IA desligada"),
        detail: state.activity?.detail || (state.isEnabled ? "Aguardando nova mensagem." : "O AutoPilot n?o est? ativo nesta conversa."),
        active: isAutoPilotActivelyWorking(state),
        updatedAt: state.stateUpdatedAt || state.activity?.updatedAt || null,
        scheduledResponseAt: state.scheduledResponseAt || null,
        isEnabled: state.isEnabled,
        objectiveLabel: runtimeState.currentObjectiveLabel || null,
        actionTypes,
      };
    }
    return result;
  }, [sortedConversations, autoPilot.chatStates]);
  const brainInboxOverviewAvailable = true;

  // 1. RENDERIZADOR DA TELA DE CONVERSA ABERTA (CHAT THREAD EM CAMADA SOBREPOSTA)
  const activeChatMessagesRaw = activeChat ? messages[activeChat.id] : undefined;
  const activeAutoPilotState = activeChat ? autoPilot.chatStates[activeChat.id] : null;
  const chatMessages = useMemo(() => {
    if (!activeChat) return [];
    const pendingPreviews: DirectMessage[] = (activeAutoPilotState?.pendingOutboundMessages || []).map((preview) => {
      const audioMatch = preview.content.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
      const audioUrl = preview.mediaUrl || audioMatch?.[1];
      return {
        id: `autopilot-preview:${preview.id}`,
        senderId: "me",
        text: audioUrl ? "🎙️ Mensagem de voz" : preview.content,
        mediaUrl: audioUrl,
        mediaType: audioUrl ? "audio" : undefined,
        audioTranscript: audioUrl ? "🎙️ Mensagem de voz" : undefined,
        createdAt: formatMessageTime(preview.createdAt),
        timestamp: Date.parse(preview.createdAt) || 0,
        sentDate: preview.createdAt,
        isMine: true,
        status: "sending",
        deliverAt: Date.parse(preview.deliverAt) || 0,
        deliveryQueueStatus: preview.status,
        replyToMessageId: preview.replyToMessageId || undefined,
      };
    });
    const rawChatMessages = deduplicateMessages([...(activeChatMessagesRaw || []), ...pendingPreviews]);
    const msgMap = new Map<string, DirectMessage>();
    for (const m of rawChatMessages) {
      msgMap.set(m.id, m);
    }
    const activeContactName = activeChat.fullName || activeChat.username || "Contato";
    return rawChatMessages.map((msg) => {
      if (msg.replyTo) {
        const expectedSenderName = msg.isMine
          ? (msg.replyTo.senderName === "Você" ? activeContactName : (msg.replyTo.senderName || activeContactName))
          : "Você";
        return {
          ...msg,
          replyTo: {
            ...msg.replyTo,
            senderName: expectedSenderName,
            text: msg.replyTo.text || "Mensagem citada",
          },
        };
      }
      const rId = msg.replyToMessageId || (msg as any).reply_to_message_id;
      if (rId) {
        const quoted = msgMap.get(rId);
        return {
          ...msg,
          replyTo: {
            id: rId,
            senderId: quoted ? quoted.senderId : "",
            senderName: msg.isMine ? activeContactName : "Você",
            text: quoted
              ? (isInstagramSharedMediaText(quoted.text)
                  ? "🎞️ Reel compartilhado"
                  : quoted.text || (quoted.mediaType === "audio" ? "🎙️ Mensagem de voz" : quoted.mediaType === "video" ? "🎥 Vídeo" : "📷 Foto"))
              : "Mensagem respondida",
          },
        };
      }
      return msg;
    });
  }, [activeChat, activeChatMessagesRaw, activeAutoPilotState?.pendingOutboundMessages]);

  const beginReplyToMessage = useCallback((message: DirectMessage) => {
    setReplyingToMessage(message);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const jumpToRepliedMessage = useCallback((messageId: string) => {
    const target = messageElementRefs.current.get(messageId);
    if (!target) {
      toast.info("A mensagem original não está carregada neste trecho do histórico.");
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });

    if (replyHighlightTimerRef.current) {
      clearTimeout(replyHighlightTimerRef.current);
    }

    setHighlightedReplyTargetId(messageId);
    replyHighlightTimerRef.current = setTimeout(() => {
      setHighlightedReplyTargetId((current) => current === messageId ? null : current);
      replyHighlightTimerRef.current = null;
    }, 1250);
  }, []);

  useEffect(() => {
    return () => {
      if (replyHighlightTimerRef.current) {
        clearTimeout(replyHighlightTimerRef.current);
      }
    };
  }, []);

  const renderChatThread = () => {
    if (!activeChat) return null;

    return (
      <div
        key={activeChat.id}
        className={`absolute inset-0 z-30 flex h-full w-full flex-col overflow-hidden text-zinc-950 dark:text-white ${
          isWhatsAppLikeType(activeChat.type)
            ? "whatsapp-ios whatsapp-chat-wallpaper"
            : "bg-white dark:bg-black"
        }`}
      >
          {/* Header do Chat */}
        <div
          className={`border-b flex items-center justify-between shrink-0 z-10 ${
            isWhatsAppLikeType(activeChat.type)
              ? "h-[58px] px-2.5 border-black/[0.08] bg-white/62 backdrop-blur-3xl shadow-[0_1px_0_rgba(0,0,0,0.035)] dark:border-white/[0.06] dark:bg-[#1c1c1e]/62"
              : "h-14 px-3.5 border-zinc-200 bg-white dark:border-[#262626] dark:bg-black"
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={handleCloseChat}
              className={`cursor-pointer p-1 transition-all active:scale-90 ${
                isWhatsAppLikeType(activeChat.type)
                  ? "text-[#007aff] hover:opacity-75"
                  : "text-zinc-950 dark:text-white hover:opacity-70"
              }`}
              aria-label="Voltar para lista de conversas"
            >
              {isWhatsAppLikeType(activeChat.type) ? (
                <ChevronLeft className="w-7 h-7 stroke-[2.1]" />
              ) : (
                <ArrowLeft className="w-6 h-6 stroke-[2.2]" />
              )}
            </button>

            {/* Clique no avatar ou nome para abrir o perfil completo */}
            <div
              onClick={() => {
                if (activeChat.type === "tinder") {
                  setSelectedTinderProfile(toTinderProfileData(activeChat));
                  setIsTinderProfileOpen(true);
                  return;
                }
                if (isWhatsAppLikeType(activeChat.type)) {
                  setIsWhatsAppContactInfoOpen(true);
                  return;
                }
                setSelectedProfileForModal(activeChat);
                setIsProfileModalOpen(true);
              }}
              className="flex items-center gap-3 group select-none transition-all cursor-pointer hover:opacity-90 active:scale-[0.98]"
              title={
                activeChat.type === "instagram"
                  ? "Toque para ver o perfil completo"
                  : activeChat.type === "tinder"
                  ? "Ver perfil do match no Tinder"
                  : "Ver dados do contato"
              }
            >
              <AvatarWithFallback
                src={activeChat.avatar}
                alt={activeChat.fullName || activeChat.username}
                conversationId={activeChat.id}
                sizeClassName="w-9 h-9 group-hover:scale-105 transition-transform"
              />

              <div className="leading-tight">
                <div className="flex items-center gap-1">
                  <span className={`tracking-tight text-zinc-950 dark:text-white ${
                    isWhatsAppLikeType(activeChat.type)
                      ? "text-[16px] font-semibold"
                      : "text-sm font-semibold group-hover:underline"
                  }`}>
                    {activeChat.fullName}
                  </span>
                </div>
                {activeChat.type === "whatsapp2" ? (
                  formatWhatsApp2PresenceLabel(whatsapp2Presence) ? (
                    <span className="block max-w-[220px] truncate text-[11px] font-normal text-[#8e8e93] dark:text-[#98989d]">
                      {formatWhatsApp2PresenceLabel(whatsapp2Presence)}
                    </span>
                  ) : null
                ) : (
                  <span className="block text-[11px] text-zinc-600 dark:text-[#a8a8a8]">
                    @{activeChat.username}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Botão de Restringir / Remover Restrição */}
            {activeChat.type === "instagram" && (
            <button
              type="button"
              onClick={() => handleToggleRestricted(activeChat)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95 ${
                activeChat.isRestricted
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-zinc-100 dark:bg-[#1c1c1e] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white border border-zinc-200 dark:border-[#2e2e30]"
              }`}
              title={activeChat.isRestricted ? "Remover restrição desta conta" : "Restringir conta no Instagram"}
            >
              <ShieldAlert
                className={`w-3.5 h-3.5 ${
                  activeChat.isRestricted ? "text-amber-400" : "text-zinc-600 dark:text-[#a8a8a8]"
                }`}
              />
              <span className="hidden sm:inline">
                {activeChat.isRestricted ? "Restrita" : "Restringir"}
              </span>
            </button>
            )}

            {/* Botão Sincronizar com Instagram oficial */}
            {activeChat.type === "instagram" && (
              <button
                type="button"
                onClick={handleManualSyncChat}
                disabled={isManualSyncing}
                className="px-2.5 py-1.5 rounded-full bg-zinc-100 dark:bg-[#1c1c1e] hover:bg-zinc-200 dark:hover:bg-[#2c2c2e] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white border border-zinc-200 dark:border-[#2e2e30] text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                title="Sincronizar mensagens recentes com o Instagram oficial"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? "animate-spin text-purple-400" : ""}`} />
                <span className="hidden md:inline">
                  {isManualSyncing ? "Sincronizando..." : "Sincronizar"}
                </span>
              </button>
            )}

            {(activeChat.type === "instagram" || isWhatsAppLikeType(activeChat.type)) && (
              <button
                type="button"
                onClick={() => void handleToggleActiveChatAi()}
                className={`relative flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-all active:scale-90 ${
                  isWhatsAppLikeType(activeChat.type)
                    ? `wa-ios-glass h-9 w-9 rounded-full ${
                        autoPilot.config?.isEnabledGlobally === false
                          ? "text-[#ff9500]"
                          : autoPilot.chatStates[activeChat.id]?.isEnabled
                          ? "text-[#34c759]"
                          : "text-[#007aff]"
                      }`
                    : `px-2.5 py-1.5 rounded-full border text-xs font-semibold active:scale-95 ${
                        autoPilot.config?.isEnabledGlobally === false
                          ? "bg-zinc-100 dark:bg-[#171719] text-zinc-500 dark:text-zinc-500 border-zinc-200 dark:border-[#2e2e30] hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-500/30"
                          : autoPilot.chatStates[activeChat.id]?.isEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25"
                          : "bg-zinc-100 dark:bg-[#1c1c1e] text-zinc-600 dark:text-[#a8a8a8] border-zinc-200 dark:border-[#2e2e30] hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-[#2c2c2e]"
                      }`
                }`}
                title={
                  autoPilot.config?.isEnabledGlobally === false
                    ? "IA desativada globalmente"
                    : autoPilot.chatStates[activeChat.id]?.isEnabled
                    ? "Desativar IA nesta conversa"
                    : "Ativar IA nesta conversa"
                }
                aria-label={
                  autoPilot.config?.isEnabledGlobally === false
                    ? "IA desativada globalmente"
                    : autoPilot.chatStates[activeChat.id]?.isEnabled
                    ? "IA ativa nesta conversa"
                    : "Ativar IA nesta conversa"
                }
              >
                {autoPilot.config?.isEnabledGlobally === false ? (
                  <BotOff className={isWhatsAppLikeType(activeChat.type) ? "h-[18px] w-[18px]" : "w-3.5 h-3.5"} />
                ) : (
                  <Bot className={isWhatsAppLikeType(activeChat.type) ? "h-[18px] w-[18px]" : "w-3.5 h-3.5"} />
                )}

                {isWhatsAppLikeType(activeChat.type) && autoPilot.config?.isEnabledGlobally !== false && (
                  <span
                    className={`absolute bottom-[5px] right-[5px] h-2 w-2 rounded-full ring-2 ring-white/80 dark:ring-[#2c2c2e]/90 ${
                      autoPilot.chatStates[activeChat.id]?.isEnabled
                        ? "bg-[#34c759]"
                        : "bg-[#8e8e93]"
                    }`}
                  />
                )}

                {activeChat.type === "instagram" && (
                  <span className="hidden md:inline">
                    {autoPilot.config?.isEnabledGlobally === false
                      ? "IA global off"
                      : autoPilot.chatStates[activeChat.id]?.isEnabled
                      ? "IA ativa"
                      : "Ativar IA"}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Checklist/Etapa: skin nativa por canal, mesma lógica e mesmos dados */}
        {(activeChat.type === "instagram" || isWhatsAppLikeType(activeChat.type)) && (
          <ChatStageBar
            variant={isWhatsAppLikeType(activeChat.type) ? "whatsapp-ios" : "default"}
            detail={chatDetail}
            onToggleItem={toggleItem}
            onToggleObjective={toggleObjective}
            onAdvanceStage={advanceStage}
            onSetStage={setStage}
            onToggleConverted={toggleConverted}
            raffleStatus={normalizeRaffleCommercialStatus(activeChat.raffleStatus)}
            onSetRaffleStatus={handleSetRaffleStatus}
            isUpdatingRaffleStatus={isUpdatingRaffleStatus}
            onQuickSendItem={handleQuickSendChecklistItem}
          />
        )}

        {/* Área de Mensagens */}
        <div
          ref={messagesScrollRef}
          onScroll={() => {
            const container = messagesScrollRef.current;
            if (!container) return;
            const distanceFromBottom =
              container.scrollHeight - container.clientHeight - container.scrollTop;
            shouldStickToBottomRef.current = distanceFromBottom <= 180;
          }}
          className={`flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full px-4 pt-3 pb-6 scrollbar-none overscroll-contain [overflow-anchor:none] ${
            chatViewportReadyId === activeChat.id ? "" : "invisible pointer-events-none"
          } ${
            isWhatsAppLikeType(activeChat.type) ? "whatsapp-chat-wallpaper" : ""
          }`}
        >
          <div
            ref={messagesContentRef}
            className={isWhatsAppLikeType(activeChat.type) ? "space-y-0" : "space-y-2.5"}
          >
          {/* Banner de Conversa Restrita */}
          {activeChat.isRestricted && (
            <div className="mx-1 mb-2 px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs animate-in fade-in duration-150 select-none bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
                <span>Esta conta está restrita. Fica na aba Pedidos.</span>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRestricted(activeChat)}
                className="text-[11px] font-bold underline cursor-pointer shrink-0 text-amber-400 hover:text-zinc-950 dark:hover:text-white"
              >
                Desrestringir
              </button>
            </div>
          )}

          {/* Banners do Piloto Automático Inteligente */}
          {(() => {
            const currentChatState = autoPilot.chatStates[activeChat.id];
            if (!currentChatState) return null;

            if (currentChatState.status === "waiting_human") {
              const mediaObservation = parseMediaObservationPauseReason(currentChatState.pauseReason);
              if (mediaObservation) {
                const observedMessage = chatMessages.find((message) => message.id === mediaObservation.messageId);
                const isSharedObservation =
                  mediaObservation.kind === "video" &&
                  isInstagramSharedMediaText(observedMessage?.text);
                return (
                  <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-violet-500/10 border-violet-500/35 text-violet-950 dark:text-violet-100 shadow-lg shadow-violet-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4 h-4 text-violet-500 dark:text-violet-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h5 className="text-xs font-bold text-violet-800 dark:text-violet-200">Precisa de observação</h5>
                        <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5 leading-snug">
                          {isSharedObservation
                            ? "Reel ou publicação recebida. Abra a mídia e descreva abaixo o que é relevante para a conversa."
                            : mediaObservation.kind === "video"
                            ? "Vídeo recebido. Assista à mensagem e descreva abaixo o que é relevante para a conversa."
                            : "Não consegui interpretar a foto automaticamente. Descreva abaixo o que aparece nela."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <textarea
                        value={mediaObservationText}
                        onChange={(event) => setMediaObservationText(event.target.value)}
                        placeholder={isSharedObservation
                          ? "Ex: é um Reel de casal viajando e a legenda fala sobre construir uma vida juntos..."
                          : mediaObservation.kind === "video"
                          ? "Ex: ele mostrou o carro novo e falou que acabou de comprar..."
                          : "Ex: selfie dele numa trilha, sorrindo..."}
                        rows={2}
                        maxLength={3000}
                        className="min-h-[58px] flex-1 resize-y rounded-lg border border-violet-500/25 bg-white/70 dark:bg-zinc-950/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-violet-500/60"
                      />
                      <button
                        type="button"
                        disabled={!mediaObservationText.trim() || isSubmittingMediaObservation}
                        onClick={() => void submitMediaObservation(mediaObservation)}
                        className="self-stretch sm:self-end rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSubmittingMediaObservation ? "Salvando..." : "Enviar observação e retomar"}
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-amber-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-amber-800 dark:text-amber-200">A IA precisa da sua resposta</h5>
                      <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5 leading-snug">
                        {currentChatState.pauseReason || "O Brain aguarda esta informação. O mesmo turno será retomado depois da sua resposta."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      brainConsoleRequestIdRef.current += 1;
                      setBrainConsoleRequest({
                        conversationId: activeChat.id,
                        requestId: brainConsoleRequestIdRef.current,
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs shrink-0 cursor-pointer active:scale-95 transition-all shadow-sm self-end sm:self-auto"
                  >
                    Abrir resolução do Brain
                  </button>
                </div>
              );
            }

            // 1. Banner de Hand-off da Rifa atingida (Alerta de Assunção de Venda)
            if (currentChatState.status === "paused_handoff") {
              return (
                <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-purple-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-amber-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <Trophy className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                        🎯 Etapa da Rifa Atingida! Assuma a conversa
                      </h5>
                      <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5 leading-snug">
                        A IA enviou os 2 áudios da Larissa sobre si mesma e pausou o piloto automaticamente. Agora é sua vez de fechar a venda da rifa!
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => autoPilot.toggleAutoPilotForChat(activeChat.id, true)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shrink-0 cursor-pointer active:scale-95 transition-all shadow-sm self-end sm:self-auto"
                  >
                    Reativar Piloto
                  </button>
                </div>
              );
            }

            // 2. Banner de Guardrail de Segurança (Foto/Mídia ou conteúdo sensível)
            if (currentChatState.status === "paused_guardrail") {
              return (
                <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-rose-500/15 border-rose-500/40 text-rose-900 dark:text-rose-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-rose-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center gap-1.5">
                        ⚠️ Piloto Automático Pausado por Segurança
                      </h5>
                      <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5 leading-snug">
                        {currentChatState.pauseReason || "O cliente enviou uma foto ou mídia não tratável automaticamente. Responda manualmente ou autorize o piloto."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => autoPilot.resumeChatFromPause(activeChat.id)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs shrink-0 cursor-pointer active:scale-95 transition-all shadow-sm self-end sm:self-auto"
                  >
                    Retomar Piloto
                  </button>
                </div>
              );
            }

            // 3. Aprovação pendente (caso exista)
            if (currentChatState.isEnabled && (currentChatState.status as string) === "waiting_approval") {
              return (
                <div className="mx-1 mb-2 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/35 text-purple-800 dark:text-purple-200 text-[11px] flex items-center gap-2 animate-pulse">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>🤖 <strong>Aprovação Pendente:</strong> a IA preparou uma resposta com áudios/textos. Revise e aprove ou edite antes do envio.</span>
                </div>
              );
            }

            return null;
          })()}

          {/* Perfil no topo é comportamento do Direct; o WhatsApp entra direto no histórico */}
          {activeChat.type === "instagram" && (
            <div
              onClick={() => {
                setSelectedProfileForModal(activeChat);
                setIsProfileModalOpen(true);
              }}
              className="flex flex-col items-center justify-center py-6 text-center space-y-2 cursor-pointer group hover:opacity-90 active:scale-98 transition-all select-none"
              title="Toque para ver o perfil completo"
            >
              <AvatarWithFallback
                src={activeChat.avatar}
                alt={activeChat.fullName || activeChat.username}
                conversationId={activeChat.id}
                sizeClassName="w-20 h-20 group-hover:scale-105 group-active:scale-95 transition-transform"
              />
              <div>
                <h3 className="text-base font-bold text-zinc-950 dark:text-white flex items-center justify-center gap-1.5 group-hover:underline">
                  {activeChat.fullName}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-[#8e8e8e] font-medium">
                  @{activeChat.username}
                </p>
              </div>
            </div>
          )}

          {/* Mensagens do Histórico / Skeleton de Carregamento */}
          {isLoadingMessages && chatMessages.length === 0 ? (
            <ChatMessageSkeletonList count={6} />
          ) : (
            chatMessages.map((msg, index) => {
              const prevMsg = index > 0 ? chatMessages[index - 1] : null;
              const nextMsg = index < chatMessages.length - 1 ? chatMessages[index + 1] : null;
              const showDateDivider = isDifferentDay(msg, prevMsg);
              const dateLabel = showDateDivider
                ? formatChatDateDivider(msg.timestamp || msg.sentDate || msg.createdAt)
                : null;
              const whatsappMessageUi = isWhatsAppLikeType(activeChat.type);
              const whatsappSameSenderBefore =
                whatsappMessageUi &&
                Boolean(prevMsg) &&
                prevMsg!.isMine === msg.isMine &&
                !showDateDivider;
              const whatsappSameSenderAfter =
                whatsappMessageUi &&
                Boolean(nextMsg) &&
                nextMsg!.isMine === msg.isMine &&
                !isDifferentDay(nextMsg!, msg);
              const whatsappEndsGroup = whatsappMessageUi && !whatsappSameSenderAfter;
              const whatsappSticker =
                whatsappMessageUi &&
                (
                  msg.mediaType === "sticker" ||
                  msg.text.startsWith("[sticker:")
                );
              const whatsappVisualMedia =
                whatsappMessageUi &&
                (
                  whatsappSticker ||
                  msg.mediaType === "image" ||
                  msg.mediaType === "video" ||
                  msg.text.startsWith("[image:") ||
                  msg.text.startsWith("[video:")
                );

              return (
                <React.Fragment key={msg.id}>
                  {/* Divisor de Data Estilo Instagram (Exibido na troca de dia ou início do chat) */}
                  {showDateDivider && dateLabel && (
                    <div className="flex items-center justify-center my-3.5 w-full select-none">
                      <span
                        className={`text-[11px] font-medium tracking-tight ${
                          whatsappMessageUi
                            ? "rounded-lg bg-white/90 px-2.5 py-1 text-[#54656f] shadow-sm dark:bg-[#182229]/95 dark:text-[#8696a0]"
                            : "text-zinc-500 dark:text-[#8e8e8e]"
                        }`}
                      >
                        {dateLabel}
                      </span>
                    </div>
                  )}

                  <div
                    ref={(node) => {
                      if (node) {
                        messageElementRefs.current.set(msg.id, node);
                      } else {
                        messageElementRefs.current.delete(msg.id);
                      }
                    }}
                    data-message-id={msg.id}
                    className={`flex flex-col ${msg.isMine ? "items-end" : "items-start"} group/msg relative w-full min-w-0 max-w-full scroll-mt-20 ${
                      whatsappMessageUi
                        ? whatsappSameSenderBefore
                          ? "mt-[2px]"
                          : "mt-2.5"
                        : ""
                    }`}
                  >
                    <InstagramReplyGesture
                      enabled
                      variant={activeChat.type === "whatsapp2" ? "whatsapp" : "instagram"}
                      isMine={msg.isMine}
                      onReply={() => beginReplyToMessage(msg)}
                      onLongPress={isWhatsAppLikeType(activeChat.type) ? () => setWhatsappMessageMenu(msg) : undefined}
                    >
                      <div
                        className={`flex items-end gap-1.5 max-w-full min-w-0 ${
                          msg.isMine ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {/* Desktop: ação aparece no hover. Mobile: gesto de arrastar ativa a resposta. */}
                        <button
                          type="button"
                          onClick={() => beginReplyToMessage(msg)}
                          className={`${isWhatsAppLikeType(activeChat.type) ? "hidden" : "hidden sm:inline-flex"} self-center opacity-0 group-hover/msg:opacity-100 hover:opacity-100 p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 active:bg-zinc-200 dark:active:bg-white/20 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-all cursor-pointer active:scale-90 shrink-0`}
                          title="Responder a esta mensagem"
                          aria-label="Responder a mensagem"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>

                      {/* Ícone de falha com clique para retry OU abrir no Instagram se janela 24h expirada */}
                      {msg.isMine && msg.status === "failed" && (
                        msg.errorReason === "outside_24h_window" ? (
                          <button
                            type="button"
                            onClick={() => handleOpenInInstagram(activeChat?.username)}
                            className="p-1 text-amber-500 hover:text-amber-400 active:scale-90 transition-transform cursor-pointer shrink-0"
                            title="Janela de 24h expirada. Clique para abrir no Instagram."
                            aria-label="Abrir conversa no Instagram"
                          >
                            <InstagramIcon className="w-4 h-4 text-amber-400" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRetryMessage(msg)}
                            className="p-1 text-red-500 hover:text-red-400 active:scale-90 transition-transform cursor-pointer shrink-0"
                            title="Falha no envio. Clique para reenviar."
                            aria-label="Reenviar mensagem que falhou"
                          >
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          </button>
                        )
                      )}

                      <div
                        className={`relative transition-all min-w-0 max-w-full break-words [word-break:break-word] [overflow-wrap:anywhere] ${
                          whatsappMessageUi
                            ? `wa-ios-bubble whatsapp-bubble-in text-[15.5px] leading-[20px] ${
                                whatsappSticker
                                  ? "wa-ios-sticker-message"
                                  : whatsappVisualMedia
                                  ? "wa-ios-media-bubble"
                                  : msg.isMine
                                  ? "wa-ios-bubble-out"
                                  : "wa-ios-bubble-in"
                              } ${whatsappEndsGroup && !whatsappVisualMedia ? "wa-ios-tail" : ""} ${
                                whatsappSameSenderBefore ? "wa-ios-grouped-middle" : "wa-ios-grouped-top"
                              } ${
                                whatsappSameSenderAfter && !whatsappVisualMedia
                                  ? msg.isMine
                                    ? "wa-ios-continues-out"
                                    : "wa-ios-continues-in"
                                  : ""
                              }`
                            : "rounded-2xl text-sm leading-relaxed"
                        } ${
                          whatsappSticker
                            ? "p-0"
                            : msg.mediaType === "audio" ||
                          msg.mediaType === "video" ||
                          msg.text.startsWith("[audio:") ||
                          msg.text.startsWith("[video:") ||
                          msg.text.includes("Mensagem de voz") ||
                          msg.text.includes("Áudio") ||
                          msg.text === "📷 Mídia"
                            ? "p-2"
                            : msg.mediaType === "image" ||
                              msg.text.startsWith("[image:") ||
                              msg.text.includes("Mídia compartilhada") ||
                              msg.text.includes("Mídia ou Story") ||
                              msg.text.includes("Foto")
                            ? whatsappMessageUi
                              ? "p-0"
                              : "p-1.5"
                            : whatsappMessageUi
                            ? "px-2.5 pt-1.5 pb-1"
                            : "px-4 py-2.5"
                        } ${
                          whatsappMessageUi
                            ? ""
                            : msg.isMine
                            ? "bg-[#0095f6] text-white rounded-br-[4px]"
                            : "bg-zinc-100 dark:bg-[#262626] text-zinc-950 dark:text-white rounded-bl-[4px]"
                        } ${msg.status === "failed" ? "border border-red-500/50 bg-red-950/30" : ""} ${
                          highlightedReplyTargetId === msg.id
                            ? whatsappMessageUi
                              ? "ring-2 ring-[#00a884]/70 shadow-[0_0_0_5px_rgba(0,168,132,0.10)] scale-[1.015]"
                              : "ring-2 ring-[#0095f6]/70 shadow-[0_0_0_5px_rgba(0,149,246,0.12)] scale-[1.015]"
                            : ""
                        }`}
                      >
                        {/* Bloco de Mensagem Respondida (Quote Reply estilo Instagram) */}
                        {msg.replyTo && (
                          <button
                            type="button"
                            onClick={() => jumpToRepliedMessage(msg.replyTo!.id)}
                            title="Ir para a mensagem original"
                            className={`group/replyquote mb-2 w-full px-2.5 py-2 rounded-md text-left min-w-0 max-w-full overflow-hidden transition-all cursor-pointer active:scale-[0.985] ${
                              whatsappMessageUi
                                ? msg.isMine
                                  ? "border-l-[3px] border-l-[#00a884] bg-[#c7f3c1] text-[#111b21] hover:bg-[#bfeeb9] dark:bg-[#045445] dark:text-[#e9edef] dark:hover:bg-[#075d4d]"
                                  : "border-l-[3px] border-l-[#00a884] bg-[#f0f2f5] text-[#111b21] hover:bg-[#e7e9eb] dark:bg-[#111b21] dark:text-[#e9edef] dark:hover:bg-[#17242c]"
                                : msg.isMine
                                ? "rounded-xl bg-black/20 hover:bg-black/30 ring-1 ring-white/15 text-white/95"
                                : "rounded-xl bg-black/[0.045] dark:bg-white/[0.08] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] ring-1 ring-black/[0.06] dark:ring-white/[0.09] text-zinc-800 dark:text-zinc-200"
                            }`}
                          >
                            <div className={`flex items-center gap-1.5 text-[10px] font-semibold min-w-0 ${
                              whatsappMessageUi
                                ? "text-[#007aff] dark:text-[#5ac8fa]"
                                : msg.isMine
                                ? "text-white/85"
                                : "text-zinc-600 dark:text-zinc-300"
                            }`}>
                              <Reply className={`w-3 h-3 shrink-0 transition-transform group-hover/replyquote:-translate-x-0.5 ${
                                whatsappMessageUi
                                  ? "text-[#007aff] dark:text-[#5ac8fa]"
                                  : msg.isMine
                                  ? "text-white/70"
                                  : "text-zinc-500 dark:text-zinc-400"
                              }`} />
                              <span className="truncate block">
                                {msg.isMine
                                  ? (msg.replyTo.senderName &&
                                      msg.replyTo.senderName !== "Você" &&
                                      msg.replyTo.senderName !== "Contato"
                                      ? msg.replyTo.senderName
                                      : activeChat.fullName || activeChat.username || "Contato")
                                  : "Você"}
                              </span>
                            </div>
                            <p className="text-[11px] truncate block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap opacity-85 mt-0.5 font-normal">
                              {isInstagramSharedMediaText(msg.replyTo.text)
                                ? "🎞️ Reel compartilhado"
                                : (msg.replyTo.text || "").startsWith("[audio:")
                                ? "🎙️ Mensagem de voz"
                                : (msg.replyTo.text || "").startsWith("[image:")
                                ? "📷 Foto"
                                : (msg.replyTo.text || "").startsWith("[video:")
                                ? "🎥 Vídeo"
                                : msg.replyTo.text || "Mensagem citada"}
                            </p>
                          </button>
                        )}

                        {whatsappMessageUi &&
                        msg.nativeMetadata?.isForwarded &&
                        !msg.nativeMetadata?.nativeKind ? (
                          <WhatsAppForwardedLabel
                            metadata={msg.nativeMetadata}
                            isMine={msg.isMine}
                          />
                        ) : null}

                        {/* 1. Mídia do tipo Áudio com Player Oficial do Instagram */}
                        {msg.mediaType === "audio" || msg.text.startsWith("[audio:") ? (
                          (() => {
                            const audioSrc =
                              msg.mediaUrl ||
                              msg.text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] ||
                              "";
                            return audioSrc ? (
                              <InstagramAudioMessage
                                audioUrl={audioSrc}
                                isMine={msg.isMine}
                                variant={activeChat.type === "whatsapp2" ? "whatsapp" : "instagram"}
                                transcript={msg.audioTranscript}
                                messageId={msg.id}
                                onTranscribed={(newTranscript) => {
                                  setMessages((prev) => {
                                    const current = prev[activeChat.id] || [];
                                    return {
                                      ...prev,
                                      [activeChat.id]: current.map((m) =>
                                        m.id === msg.id ? { ...m, audioTranscript: newTranscript } : m
                                      ),
                                    };
                                  });
                                }}
                              />
                            ) : (
                              <div className="flex items-center gap-2 py-1 px-2 text-xs text-zinc-700 dark:text-zinc-300 select-none">
                                <Mic className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                                <span>🎙️ Mensagem de voz</span>
                              </div>
                            );
                          })()
                        ) : /* 2. Documento/arquivo com ações de abrir/download */
                        (msg.mediaType === "document" ||
                          msg.mediaType === "file" ||
                          msg.mediaType === "unsupported") &&
                        msg.attachment ? (
                          <WhatsAppDocumentMessage
                            attachment={msg.attachment}
                            mediaUrl={msg.mediaUrl}
                            isMine={msg.isMine}
                          />
                        ) : /* 3. Tipos nativos do WhatsApp */
                        activeChat.type === "whatsapp2" &&
                        msg.nativeMetadata?.nativeKind ? (
                          <WhatsAppNativeMessage
                            metadata={msg.nativeMetadata}
                            text={msg.text}
                            isMine={msg.isMine}
                          />
                        ) : /* 4. Reel/publicação compartilhada */
                        isInstagramSharedMediaText(msg.text) ? (
                          <InstagramSharedReelCard
                            isMine={msg.isMine}
                            url={msg.mediaUrl || extractInstagramSharedMediaUrl(msg.text)}
                            instagramUsername={activeChat.username}
                          />
                        ) : /* 3. Figurinha nativa do WhatsApp (sem balão) */
                        (msg.mediaType === "sticker" || msg.text.startsWith("[sticker:")) &&
                        (msg.mediaUrl || msg.text.match(/^\[sticker:(https?:\/\/[^\]]+)\]/)?.[1]) ? (
                          <img
                            src={
                              msg.mediaUrl ||
                              msg.text.match(/^\[sticker:(https?:\/\/[^\]]+)\]/)?.[1] ||
                              ""
                            }
                            alt="Figurinha"
                            draggable={false}
                            className="block h-auto max-h-[180px] w-auto max-w-[180px] select-none object-contain drop-shadow-sm"
                          />
                        ) : /* 4. Mídia do tipo Vídeo com player nativo */
                        (msg.mediaType === "video" || msg.text.startsWith("[video:")) &&
                        (msg.mediaUrl || msg.text.match(/^\[video:(https?:\/\/[^\]]+)\]/)?.[1]) ? (
                          <video
                            src={
                              msg.mediaUrl ||
                              msg.text.match(/^\[video:(https?:\/\/[^\]]+)\]/)?.[1] ||
                              ""
                            }
                            controls={!msg.attachment?.isGif}
                            autoPlay={Boolean(msg.attachment?.isGif)}
                            loop={Boolean(msg.attachment?.isGif)}
                            muted={Boolean(msg.attachment?.isGif)}
                            playsInline
                            preload={msg.attachment?.isGif ? "auto" : "metadata"}
                            aria-label={msg.attachment?.isGif ? "GIF" : "Vídeo"}
                            className="block max-h-[420px] w-full max-w-[320px] rounded-xl bg-black object-contain"
                          >
                            Seu navegador não conseguiu reproduzir este vídeo.
                          </video>
                        ) : /* 4. Mídia do tipo Imagem / Foto com URL */
                        (msg.mediaType === "image" || msg.text.startsWith("[image:")) &&
                        (msg.mediaUrl || msg.text.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1]) ? (
                          <div>
                            <DirectImage
                              src={
                                msg.mediaUrl ||
                                msg.text.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1] ||
                                ""
                              }
                              alt="Foto compartilhada"
                              onExpand={(url) => setExpandedImageUrl(url)}
                            />
                            {msg.text.replace(/^\[image:[^\]]+\]\s*/, "") && (
                              <p className={`px-2 py-1 text-xs ${msg.isMine ? "text-white/95" : "text-zinc-800 dark:text-white/95"}`}>
                                {msg.text.replace(/^\[image:[^\]]+\]\s*/, "")}
                              </p>
                            )}
                          </div>
                        ) : /* 5. Mídia compartilhada ou temporária da Meta (Foto/Story) */
                        (msg.text === "📷 Mídia compartilhada" ||
                          msg.text === "📷 Mídia ou Story" ||
                          msg.text === "📷 Mídia" ||
                          (msg.mediaType === "image" && !msg.mediaUrl)) ? (
                          <InstagramSharedMediaCard isMine={msg.isMine} />
                        ) : (
                          /* 6. Mensagem de texto tradicional */
                          <p className="whitespace-pre-wrap break-words [word-break:break-word] [overflow-wrap:anywhere] min-w-0 max-w-full">{msg.text}</p>
                        )}

                        {/* Horário da Mensagem (Timestamp estilo Instagram com contador regressivo) */}
                        <div
                          className={`flex items-center gap-1 select-none text-[10px] leading-none ${
                            whatsappMessageUi && whatsappSticker
                              ? "mt-0.5 justify-end pr-1 text-[#667781] dark:text-[#8696a0]"
                              : whatsappMessageUi && whatsappVisualMedia
                              ? "absolute bottom-1.5 right-1.5 rounded-full bg-black/45 px-1.5 py-1 text-white shadow-sm backdrop-blur-md"
                              : msg.isMine
                              ? whatsappMessageUi
                                ? "mt-1 justify-end text-[#667781] dark:text-[#aebac1]"
                                : "mt-1 justify-end font-mono text-white/75"
                              : whatsappMessageUi
                              ? "mt-1 justify-end text-[#667781] dark:text-[#8696a0]"
                              : "mt-1 justify-start font-mono text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          <span>
                            {formatMessageTime(msg.timestamp || msg.sentDate || msg.createdAt) || "Agora"}
                          </span>
                          {msg.isMine && (
                            <span className="ml-0.5 flex items-center gap-1">
                              {msg.status === "sending" ? (
                                msg.deliverAt ? (
                                  <MessageCountdown deliverAt={msg.deliverAt} queueStatus={msg.deliveryQueueStatus} />
                                ) : (
                                  <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
                                )
                              ) : msg.status === "failed" ? (
                                <AlertCircle className="w-2.5 h-2.5 text-red-400 inline" />
                              ) : whatsappMessageUi ? (
                                msg.status === "delivered" || msg.status === "seen" ? (
                                  <CheckCheck
                                    className={`w-4 h-4 inline ${
                                      msg.status === "seen"
                                        ? "text-[#34b7f1]"
                                        : whatsappVisualMedia
                                        ? "text-white/85"
                                        : "text-[#8e8e93] dark:text-[#aebac1]"
                                    }`}
                                  />
                                ) : (
                                  <Check className="w-3.5 h-3.5 inline text-[#8e8e93] dark:text-[#aebac1]" />
                                )
                              ) : (
                                <Check className="w-3 h-3 text-white/85 inline" />
                              )}
                            </span>
                          )}
                        </div>

                        {msg.reactionEmoji ? (
                          <span
                            className={`absolute -bottom-2 ${msg.isMine ? "-left-1" : "-right-1"} bg-white dark:bg-[#262626] rounded-full px-1.5 py-0.5 border border-zinc-200 dark:border-black shadow-md text-[13px] leading-none select-none`}
                            title={isWhatsAppLikeType(activeChat.type) ? "Reação no WhatsApp" : "Reação no Instagram"}
                          >
                            {msg.reactionEmoji}
                          </span>
                        ) : msg.liked ? (
                          <span className="absolute -bottom-2 -right-1 bg-white dark:bg-[#262626] rounded-full p-1 border border-zinc-200 dark:border-black shadow-md">
                            <Heart className="w-3 h-3 text-red-500 fill-red-500" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                    </InstagramReplyGesture>

                    {/* Dica de clique para reenviar quando a mensagem falha OU botão para abrir no Instagram se janela de 24h expirada */}
                    {msg.isMine && msg.status === "failed" && (
                      msg.errorReason === "outside_24h_window" ? (
                        <div className="flex flex-col items-end gap-1.5 mt-1.5 mr-1 select-none animate-in fade-in duration-200">
                          <span className="text-[11px] text-amber-400 font-medium">
                            Janela de 24h da Meta expirada. Responda pelo app do Instagram.
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenInInstagram(activeChat?.username)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] text-white text-[11px] font-semibold hover:opacity-95 active:scale-95 transition-all shadow-md cursor-pointer"
                          >
                            <InstagramIcon className="w-3.5 h-3.5" />
                            <span>Abrir no Instagram</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRetryMessage(msg)}
                          className="text-[10px] text-red-400 hover:text-red-300 mt-1 mr-1 flex items-center gap-1 cursor-pointer active:scale-95 transition-transform"
                        >
                          <span>Não foi possível enviar. Toque para tentar de novo.</span>
                        </button>
                      )
                    )}

                    {/* Indicador Oficial de 'Visto' no Chat Aberto (Exibido logo abaixo do último balão enviado por nós quando visualizado pelo contato) */}
                    {(() => {
                      if (isWhatsAppLikeType(activeChat.type)) return null;
                      // No Instagram, o 'Visto' SÓ APARECE na ÚLTIMA MENSAGEM DO CHAT INTEIRO e enviada por nós
                      const isLastMessageOfChat = index === chatMessages.length - 1;
                      if (!isLastMessageOfChat || !msg.isMine) return null;

                      // Se a mensagem está pendente de envio
                      if (msg.status === "sending") {
                        return null;
                      }

                      const msgTime = new Date(msg.timestamp || msg.sentDate || msg.createdAt || 0).getTime();
                      const chatSeenTime = activeChat?.seenAt ? new Date(activeChat.seenAt).getTime() : 0;

                      // A mensagem só foi vista se o status for 'seen' OU se o visto da conversa for posterior ou igual ao envio da mensagem
                      const isSeen =
                        msg.status === "seen" ||
                        (activeChat?.lastStatus === "seen" &&
                          activeChat?.lastSender === "me" &&
                          chatSeenTime >= msgTime &&
                          chatSeenTime > 0);

                      if (!isSeen) return null;

                      const seenTimestamp = msg.seenAt || (chatSeenTime >= msgTime ? activeChat?.seenAt : null);
                      const seenTimeText = seenTimestamp ? formatMessageTime(seenTimestamp) : "";

                      return (
                        <div className="flex items-center justify-end gap-1 mt-1 mr-1 select-none animate-in fade-in duration-200">
                          <span className="text-[11px] font-normal text-zinc-500 dark:text-[#8e8e8e]">
                            {seenTimeText ? `Visto às ${seenTimeText}` : "Visto"}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div className="h-4 shrink-0" />
          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* HUD Flutuante do Piloto Automático (Desacoplado da rolagem: zero tremor e zero piscar) */}
        {(() => {
          const currentChatState = autoPilot.chatStates[activeChat.id];
          if (!currentChatState) {
            return null;
          }

          if (isWhatsAppLikeType(activeChat.type)) {
            return (
              <AutoPilotActivityIndicator
                state={currentChatState}
                variant="console-only"
                conversationId={activeChat.id}
                openConsoleRequestId={brainConsoleRequest?.conversationId === activeChat.id ? brainConsoleRequest.requestId : undefined}
                onConsoleOpenRequestDismissed={handleBrainConsoleOpenRequestHandled}
              />
            );
          }
          const isActivelyWorking = Boolean(
            currentChatState.activity ||
            currentChatState.status === "waiting_delay" ||
            currentChatState.status === "waiting_debounce" ||
            currentChatState.status === "processing" ||
            currentChatState.status === "in_queue" ||
            currentChatState.status === "paused_guardrail" ||
            currentChatState.status === "paused_handoff" ||
            currentChatState.status === "waiting_human"
          );
          if (!currentChatState.isEnabled && !isActivelyWorking) {
            return null;
          }
          return (
            <div className="px-3 pb-2 w-full z-30 shrink-0">
              <AutoPilotActivityIndicator
                state={currentChatState}
                variant="floating"
                conversationId={activeChat.id}
                openConsoleRequestId={brainConsoleRequest?.conversationId === activeChat.id ? brainConsoleRequest.requestId : undefined}
                onConsoleOpenRequestDismissed={handleBrainConsoleOpenRequestHandled}
              />
            </div>
          );
        })()}

        {/* Input Fixo no Rodapé: Idêntico em ambos os chats, com suporte a Gravação de Áudio */}
        {isRecording ? (
          <div
            className={`p-3 border-t flex items-center justify-between gap-3 shrink-0 z-10 animate-in fade-in duration-200 ${
              isWhatsAppLikeType(activeChat.type)
                ? "bg-[#f0f2f5] dark:bg-[#202c33] border-black/[0.06] dark:border-[#222d34]"
                : "bg-white dark:bg-black border-zinc-200 dark:border-[#262626]"
            }`}
          >
            {/* Botão Cancelar (Lixeira) */}
            <button
              type="button"
              onClick={() => handleStopRecording(false)}
              className={`w-9 h-9 rounded-full active:scale-90 flex items-center justify-center transition-all cursor-pointer ${
                isWhatsAppLikeType(activeChat.type)
                  ? "bg-transparent text-[#ff3b30] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-400"
              }`}
              title="Cancelar gravação"
              aria-label="Cancelar gravação de áudio"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Visualizador de Gravação Ativa com Timer */}
            <div className={`flex-1 rounded-[18px] px-4 py-2 flex items-center gap-3 ${
              isWhatsAppLikeType(activeChat.type)
                ? "border border-[#d1d1d6] bg-white shadow-[0_0.5px_0_rgba(0,0,0,0.04)] dark:border-[#3a3a3c] dark:bg-[#2c2c2e]"
                : "bg-zinc-100 dark:bg-[#1c1c1e] border border-red-500/40 shadow-inner"
            }`}>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-xs font-medium text-zinc-800 dark:text-white/90">Gravando áudio...</span>
              <span className="ml-auto font-mono text-xs text-red-400 font-bold tracking-wider">
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>
            </div>

            {/* Botão Concluir e Enviar */}
            <button
              type="button"
              onClick={() => handleStopRecording(true)}
              className={`w-9 h-9 rounded-full text-white active:scale-90 flex items-center justify-center transition-transform shadow-md cursor-pointer hover:opacity-95 ${
                isWhatsAppLikeType(activeChat.type)
                  ? "bg-[#007aff]"
                  : "bg-gradient-to-tr from-[#0095f6] to-[#0081d6]"
              }`}
              title="Concluir e enviar áudio"
              aria-label="Enviar nota de voz"
            >
              <Mic className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div
            className={`border-t shrink-0 z-10 ${
              isWhatsAppLikeType(activeChat.type)
                ? "bg-[#f0f2f5] dark:bg-[#202c33] border-black/[0.06] dark:border-[#222d34]"
                : "bg-white dark:bg-black border-zinc-200 dark:border-[#262626]"
            }`}
          >
            {/* Prévia de Foto Pendente para envio */}
            {pendingImage && (
              <div className={`mx-3 mt-2.5 p-2 rounded-xl flex items-center gap-3 animate-in fade-in duration-150 ${
                isWhatsAppLikeType(activeChat.type)
                  ? "whatsapp-ios wa-ios-glass"
                  : "bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626]"
              }`}>
                <img
                  src={pendingImage.previewUrl}
                  alt="Prévia da foto selecionada"
                  className="w-12 h-12 rounded-lg object-cover border border-zinc-200 dark:border-[#333] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-950 dark:text-white truncate">
                    {pendingImage.file.name}
                  </p>
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-400">
                    Foto pronta para enviar · {(pendingImage.file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelPendingImage}
                  className="p-1.5 rounded-full text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-white/10 active:scale-95 transition-colors cursor-pointer"
                  title="Remover foto selecionada"
                  aria-label="Cancelar foto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Card de Resposta a Mensagem Específica (Instagram Reply Bar) */}
            {replyingToMessage && (
              <div
                className={`mx-3 mt-2 px-3.5 py-2 border border-l-[3px] rounded-xl flex items-center justify-between gap-3 shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-150 select-none ${
                  isWhatsAppLikeType(activeChat.type)
                    ? "whatsapp-ios wa-ios-glass border-l-[#00a884]"
                    : "bg-zinc-100 dark:bg-[#1c1c1e] border-zinc-200 dark:border-[#2f2f2f] border-l-[#0095f6]"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${
                    isWhatsAppLikeType(activeChat.type) ? "text-[#00a884] dark:text-[#25d366]" : "text-[#0095f6]"
                  }`}>
                    <Reply className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      Respondendo a {replyingToMessage.isMine ? "você" : activeChat.fullName || activeChat.username}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate mt-0.5 font-normal">
                    {isInstagramSharedMediaText(replyingToMessage.text)
                      ? "🎞️ Reel compartilhado"
                      : (replyingToMessage.text || "").startsWith("[audio:") || replyingToMessage.mediaType === "audio"
                      ? "🎙️ Mensagem de voz"
                      : (replyingToMessage.text || "").startsWith("[image:") || replyingToMessage.mediaType === "image"
                      ? "📷 Foto"
                      : (replyingToMessage.text || "").startsWith("[video:") || replyingToMessage.mediaType === "video"
                      ? "🎥 Vídeo"
                      : (replyingToMessage.text || "").startsWith("[sticker:") || replyingToMessage.mediaType === "sticker"
                      ? "Figurinha"
                      : replyingToMessage.text || "Mensagem"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplyingToMessage(null);
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  className="p-1.5 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                  title="Cancelar resposta"
                  aria-label="Cancelar resposta"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* CARD DE APROVAÇÃO DA IA (MODO SEMIAUTOMÁTICO / HUMAN-IN-THE-LOOP) */}
            {(() => {
              const currentChatState = autoPilot.chatStates[activeChat.id];
              if (
                currentChatState &&
                (currentChatState.status as string) === "waiting_approval" &&
                currentChatState.pendingAction
              ) {
                return (
                  <AutoPilotApprovalCard
                    pendingAction={currentChatState.pendingAction}
                    onApprove={(customResponses) =>
                      autoPilot.approvePendingAction(activeChat.id, customResponses)
                    }
                    onReject={() => autoPilot.rejectPendingAction(activeChat.id)}
                    onUpdateResponses={(updated) =>
                      autoPilot.updatePendingResponses(activeChat.id, updated)
                    }
                    isSending={autoPilot.currentProcessingId === activeChat.id}
                  />
                );
              }
              return null;
            })()}

            {isWhatsAppLikeType(activeChat.type) && (
              <WhatsAppStickerTray
                open={isWhatsAppStickerTrayOpen}
                stickers={whatsappStickers}
                loading={isLoadingWhatsAppStickers}
                sendingStickerId={sendingStickerId}
                onClose={() => setIsWhatsAppStickerTrayOpen(false)}
                onSend={sendWhatsAppSticker}
                onDelete={deleteWhatsAppSticker}
              />
            )}

            {/* Barra de Digitação Isolada (Zero Lag / 60 FPS com State Colocation) */}
            <InstagramChatComposer
              ref={composerRef}
              variant={activeChat.type === "whatsapp2" ? "whatsapp" : "instagram"}
              isUploadingMedia={isUploadingMedia}
              hasPendingImage={Boolean(pendingImage)}
              replyingToName={
                replyingToMessage
                  ? replyingToMessage.isMine
                    ? "você"
                    : activeChat.fullName || activeChat.username
                  : null
              }
              onSendMessage={handleSendMessage}
              onSelectImage={(file) => {
                const previewUrl = URL.createObjectURL(file);
                setPendingImage({ file, previewUrl });
              }}
              onSelectMediaFile={(file) => {
                void handleUploadAndSendMedia(file);
              }}
              onStartRecording={handleStartRecording}
              onOpenVault={() => setIsPersonaAudioModalOpen(true)}
              onOpenConsole={
                isWhatsAppLikeType(activeChat.type)
                  ? () => {
                      setIsWhatsAppStickerTrayOpen(false);
                      handleOpenBrainConsole(activeChat.id);
                    }
                  : undefined
              }
              onOpenStickers={
                isWhatsAppLikeType(activeChat.type)
                  ? () => {
                      setWhatsappMessageMenu(null);
                      openWhatsAppStickerTray();
                    }
                  : undefined
              }
            />
          </div>
        )}

        {/* Modal Canônico: Cofre de Áudios da Larissa */}
        <PersonaAudioVaultModal
          isOpen={isPersonaAudioModalOpen}
          onClose={() => setIsPersonaAudioModalOpen(false)}
          activeChat={
            activeChat
              ? {
                  id: activeChat.id,
                  fullName: activeChat.fullName,
                  username: activeChat.username,
                }
              : null
          }
          onSendAudioToChat={async (audio) => {
            if (!activeChat) return;
            const audioUrl = activeChat.type === "whatsapp2"
              ? (audio.whatsappAudioUrl || audio.audioUrl)
              : audio.audioUrl;
            await sendMessageWithText(`[audio:${audioUrl}]`);
            toast.success(`Áudio "${audio.title}" enviado com sucesso.`);
          }}
        />

        <AutoPilotActivationModal
          isOpen={isAutoPilotActivationModalOpen}
          onClose={() => setIsAutoPilotActivationModalOpen(false)}
          chatName={activeChat.fullName || activeChat.username}
          onConfirm={async (mode) => {
            await autoPilot.activateAutoPilotWithChoice(activeChat.id, mode);
          }}
        />

        {isGlobalAutoPilotDisabledModalOpen && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-ai-disabled-title"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsGlobalAutoPilotDisabledModalOpen(false);
            }}
          >
            <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 dark:border-[#2a2a2d] bg-white dark:bg-[#121214] shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-[#262629] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
                    <BotOff className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 id="global-ai-disabled-title" className="text-sm font-bold text-zinc-950 dark:text-white">
                      IA global desativada
                    </h3>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Não é possível ativar a IA só neste chat.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Fechar"
                  onClick={() => setIsGlobalAutoPilotDisabledModalOpen(false)}
                  className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 py-4">
                <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                  O Piloto Automático está desligado nas configurações gerais. Para usar a IA nesta conversa, primeiro ative a chave global em <strong>Config</strong>.
                </p>
              </div>

              <div className="flex justify-end border-t border-zinc-200 dark:border-[#262629] bg-zinc-50 dark:bg-[#161618] px-5 py-3">
                <button
                  type="button"
                  onClick={() => setIsGlobalAutoPilotDisabledModalOpen(false)}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {isWhatsAppContactInfoOpen && isWhatsAppLikeType(activeChat.type) && (
            <WhatsAppContactInfo
              conversation={{ ...activeChat, type: "whatsapp" as const }}
              messages={messages[activeChat.id] || []}
              stages={stages}
              chatDetail={chatDetail}
              aiEnabled={Boolean(autoPilot.chatStates[activeChat.id]?.isEnabled)}
              globalAiEnabled={autoPilot.config?.isEnabledGlobally !== false}
              onClose={() => setIsWhatsAppContactInfoOpen(false)}
              onToggleAi={handleToggleActiveChatAi}
            />
          )}
        </AnimatePresence>

        {/* Modal de Perfil Completo */}
        <InstagramProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => {
            setIsProfileModalOpen(false);
            setSelectedProfileForModal(null);
          }}
          profile={toInstagramProfileData(selectedProfileForModal || activeChat)}
        />

        {/* Modal de Foto Expandida (Lightbox) */}
        {expandedImageUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setExpandedImageUrl(null)}
          >
            <button
              type="button"
              onClick={() => setExpandedImageUrl(null)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center cursor-pointer transition-all z-10"
              aria-label="Fechar foto"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={expandedImageUrl}
              alt="Foto expandida"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl select-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-white dark:bg-black text-zinc-950 dark:text-white overflow-hidden">
      {/* 1. LISTA DE CONVERSAS (OCULTA QUANDO O CHAT ESTIVER ABERTO PARA GARANTIR RIGOROSAMENTE UM ÚNICO SCROLL) */}
      <div className={`flex flex-col h-full w-full overflow-hidden ${activeChat ? "hidden" : ""}`}>
        {/* Cabeçalho da caixa de entrada: WhatsApp segue a hierarquia visual do iOS */}
        <div
          className={`shrink-0 px-4 backdrop-blur-2xl ${
            isWhatsAppInboxChannel
              ? "whatsapp-ios border-b-0 bg-white/[0.94] pt-4 pb-1.5 dark:bg-black/[0.94]"
              : "border-b border-zinc-100 dark:border-[#1f1f1f] bg-white/95 dark:bg-black/95 pt-4 pb-3"
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {activeChannel === "instagram" ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-[#666]">
                    Caixa de entrada
                  </p>
                  <h2 className="mt-0.5 text-[19px] leading-tight font-semibold tracking-tight text-zinc-950 dark:text-white">
                    Conversas
                  </h2>
                </>
              ) : (
                <h2 className="text-[34px] leading-[41px] font-bold tracking-[-0.03em] text-[#000000] dark:text-white">
                  Conversas
                </h2>
              )}
            </div>

            <div className={`items-center gap-1.5 shrink-0 ${isWhatsAppInboxChannel ? "hidden" : "flex"}`}>
              <button
                type="button"
                onClick={() => {
                  if (!mobileNotifications.remoteRegistered) {
                    void mobileNotifications.requestPermission();
                  }
                }}
                disabled={mobileNotifications.remoteRegistered || mobileNotifications.isLoading}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  mobileNotifications.remoteRegistered
                    ? "bg-zinc-100 dark:bg-[#171717] text-emerald-500 cursor-default"
                    : "bg-zinc-100 dark:bg-[#171717] text-zinc-500 dark:text-[#8e8e8e] hover:text-zinc-950 dark:hover:text-white cursor-pointer"
                }`}
                title={
                  mobileNotifications.remoteRegistered
                    ? "Notificações móveis ativas"
                    : "Ativar notificações móveis"
                }
              >
                {mobileNotifications.remoteRegistered ? (
                  <BellRing className="w-4 h-4" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
              </button>

              <div
                className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-[#171717] flex items-center justify-center"
                title={isRealtimeConnected ? "Sincronização em tempo real ativa" : "Sincronizando conversas"}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRealtimeConnected ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
                  }`}
                />
              </div>
            </div>
          </div>

        </div>

        {/* Canais da caixa de entrada: Instagram + WhatsApp (gateway atual do antigo WhatsApp 2). */}
        {!IS_WHATSAPP2_REMOTE_BUILD && (
        <div className={`mt-[10px] mb-[8px] shrink-0 border-b px-3 pb-2 ${
          isWhatsAppInboxChannel
            ? "whatsapp-ios border-black/[0.07] bg-white/66 backdrop-blur-3xl dark:border-white/[0.06] dark:bg-[#1c1c1e]/68"
            : "border-zinc-100 bg-white dark:border-[#1f1f1f] dark:bg-black"
        }`}>
          <div className={`grid ${IS_WHATSAPP2_REMOTE_BUILD ? "grid-cols-1" : "grid-cols-3"} gap-0.5 ${
            isWhatsAppInboxChannel
              ? "whatsapp-ios rounded-[10px] bg-[#e9e9eb] p-0.5 dark:bg-[#2c2c2e]"
              : "rounded-2xl bg-zinc-100 p-1 dark:bg-[#171717]"
          }`}>
            {!IS_WHATSAPP2_REMOTE_BUILD ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveChannel("instagram");
                    setInstaFilter("todos");
                    setShowFilterBar(false);
                  }}
                  className={`relative flex items-center justify-center gap-2 px-3 font-semibold transition-all active:scale-[0.985] ${
                    isWhatsAppInboxChannel ? "h-9 rounded-[8px] text-[13px]" : "h-11 rounded-xl text-xs"
                  } ${
                    activeChannel === "instagram"
                      ? "bg-white text-zinc-950 shadow-sm ring-1 ring-black/[0.04] dark:bg-[#3a3a3c] dark:text-white dark:ring-white/[0.05]"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  <InstagramIcon className="h-4 w-4" />
                  <span>Instagram</span>
                  <span className="text-[10px] tabular-nums opacity-55">{instagramConversationCount}</span>
                  {instagramUnreadCount > 0 && (
                    <span className="absolute right-2 top-2 flex min-w-4 h-4 items-center justify-center rounded-full bg-[#0095f6] px-1 text-[9px] font-bold leading-none text-white">
                      {instagramUnreadCount > 99 ? "99+" : instagramUnreadCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveChannel("whatsapp2");
                    setInstaFilter("todos");
                    setShowFilterBar(false);
                  }}
                  className={`relative flex items-center justify-center gap-2 px-3 font-semibold transition-all active:scale-[0.985] ${
                    isWhatsAppInboxChannel ? "h-9 rounded-[8px] text-[13px]" : "h-11 rounded-xl text-xs"
                  } ${
                    activeChannel === "whatsapp2"
                      ? "bg-white text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:bg-[#636366] dark:text-white"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  <WhatsAppIcon className={`h-4 w-4 ${activeChannel === "whatsapp2" ? "text-[#25d366]" : ""}`} />
                  <span>WhatsApp</span>
                  <span className="text-[10px] tabular-nums opacity-55">{whatsappConversationCount}</span>
                  {whatsappUnreadCount > 0 && (
                    <span className="absolute right-2 top-2 flex min-w-4 h-4 items-center justify-center rounded-full bg-[#25d366] px-1 text-[9px] font-bold leading-none text-white">
                      {whatsappUnreadCount > 99 ? "99+" : whatsappUnreadCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveChannel("tinder");
                    setTinderFilter("todos");
                    setShowFilterBar(false);
                  }}
                  className={`relative flex items-center justify-center gap-2 px-3 font-semibold transition-all active:scale-[0.985] ${
                    isWhatsAppInboxChannel ? "h-9 rounded-[8px] text-[13px]" : "h-11 rounded-xl text-xs"
                  } ${
                    activeChannel === "tinder"
                      ? "bg-gradient-to-r from-[#fd5068] to-[#ff6036] text-white shadow-sm ring-1 ring-[#fd5068]/30"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  <Flame className={`h-4 w-4 ${activeChannel === "tinder" ? "fill-white text-white" : "text-[#fd5068]"}`} />
                  <span>Tinder</span>
                  <span className="text-[10px] tabular-nums opacity-75">{tinderConversationCount}</span>
                  {tinderUnreadCount > 0 && (
                    <span className="absolute right-2 top-2 flex min-w-4 h-4 items-center justify-center rounded-full bg-[#fd5068] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white">
                      {tinderUnreadCount > 99 ? "99+" : tinderUnreadCount}
                    </span>
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setActiveChannel("whatsapp2");
                  setInstaFilter("todos");
                  setShowFilterBar(false);
                }}
                className="relative flex h-9 items-center justify-center gap-2 rounded-[8px] bg-white px-3 text-[13px] font-semibold text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] active:scale-[0.985] dark:bg-[#636366] dark:text-white dark:ring-white/[0.05]"
                title="WhatsApp espelhado por dispositivo vinculado"
              >
                <WhatsAppIcon className="h-4 w-4 text-[#25d366]" />
                <span>WhatsApp</span>
                <span className="text-[10px] tabular-nums opacity-55">{whatsappConversationCount}</span>
                {whatsappUnreadCount > 0 && (
                  <span className="absolute right-2 top-2 flex min-w-4 h-4 items-center justify-center rounded-full bg-[#25d366] px-1 text-[9px] font-bold leading-none text-white">
                    {whatsappUnreadCount > 99 ? "99+" : whatsappUnreadCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        )}

        {/* BANNER DE NOTIFICAÇÃO: PROPOSTAS DA IA AGUARDANDO APROVAÇÃO */}
        {(() => {
          const pendingChats = Object.entries(autoPilot.chatStates).filter(
            ([conversationId, s]) =>
              s.isEnabled &&
              (s.status as string) === "waiting_approval" &&
              s.pendingAction &&
              conversations.find((conversation) => conversation.id === conversationId)?.type === activeChannel
          );
          if (pendingChats.length === 0) return null;

          return (
            <div className="border-b border-zinc-100 dark:border-[#1f1f1f] bg-violet-50/60 dark:bg-violet-500/[0.06] px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 truncate">
                <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                <span className="truncate">
                  <strong className="font-semibold">{pendingChats.length} {pendingChats.length === 1 ? "revisão pendente" : "revisões pendentes"}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const targetId = pendingChats[0][0];
                  const targetConv = conversations.find((c) => c.id === targetId);
                  if (targetConv) handleOpenConversation(targetConv);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1c] border border-zinc-200 dark:border-[#303030] text-zinc-800 dark:text-zinc-200 font-semibold text-[11px] shrink-0 cursor-pointer active:scale-95 transition-all"
              >
                Revisar
              </button>
            </div>
          );
        })()}

        {/* Conteúdo com scroll isolado e rastreamento de posição */}
        <div
          ref={conversationsScrollRef}
          className={`flex-1 ${activeChat ? "overflow-hidden" : "overflow-y-auto"} scrollbar-none overscroll-contain ${
            isWhatsAppInboxChannel ? "whatsapp-ios px-0 py-2 space-y-0" : "px-3.5 py-3 space-y-2"
          }`}
        >
        {/* Pesquisa + acesso compacto aos filtros */}
        <div className={`flex items-center gap-2 select-none ${isWhatsAppInboxChannel ? "px-4 pb-2" : ""}`}>
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isWhatsAppInboxChannel ? "Buscar" : "Pesquisar conversas"}
              className={`w-full border border-transparent text-sm focus:outline-none transition-colors ${
                isWhatsAppInboxChannel
                  ? "h-9 rounded-[10px] bg-[#f2f2f7] pl-9 pr-4 text-[#111b21] placeholder-[#8e8e93] shadow-none dark:bg-[#1c1c1e] dark:text-white dark:placeholder-[#8e8e93]"
                  : "rounded-2xl bg-zinc-100/80 dark:bg-[#171717] text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] pl-10 pr-4 py-2.5 focus:border-zinc-300 dark:focus:border-[#343434] focus:bg-white dark:focus:bg-[#1d1d1d]"
              }`}
            />
            <Search className={`w-4 h-4 absolute left-3.5 ${
              isWhatsAppInboxChannel
                ? "top-2.5 text-[#8e8e93]"
                : "top-3 text-zinc-400 dark:text-[#737373]"
            }`} />
          </div>

          {activeChannel === "instagram" && (
          <button
            type="button"
            onClick={() => setShowFilterBar((current) => !current)}
            className={`relative h-10 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 border ${
              showFilterBar || isFilterActive
                ? "bg-zinc-950 text-white border-zinc-950 dark:bg-white dark:text-black dark:border-white"
                : "bg-zinc-100/80 dark:bg-[#171717] text-zinc-500 dark:text-[#8e8e8e] border-transparent hover:text-zinc-950 dark:hover:text-white"
            }`}
            title="Mostrar filtros"
            aria-label="Mostrar filtros"
            aria-expanded={showFilterBar}
          >
            <SlidersHorizontal className="w-4 h-4 stroke-[1.9]" />
            <span className="text-xs font-semibold hidden sm:inline">Filtros</span>
            {isFilterActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#0095f6]" />
            )}
          </button>
          )}
        </div>

        {isWhatsAppInboxChannel && (
          <div className="whatsapp-ios px-4 pt-0.5 pb-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
              {([
                { id: "todos", label: "Todos", count: whatsappInboxPrimaryConversations.length, dotClass: "bg-[#34c759]" },
                { id: "nao_respondidos", label: "Não respondidos", count: whatsappNotAnsweredCount, dotClass: "bg-[#0a84ff]" },
                { id: "respondidos", label: "Respondidos", count: whatsappAnsweredCount, dotClass: "bg-[#8e8e93]" },
                { id: "arquivados", label: "Arquivados", count: whatsappArchivedCount, dotClass: "bg-[#ff9f0a]" },
                ...(activeChannel === "whatsapp2"
                  ? [{ id: "trancadas" as WhatsAppResponseFilter, label: "Trancadas", count: whatsappLockedCount, dotClass: "bg-[#af52de]" }]
                  : []),
              ] as Array<{ id: WhatsAppResponseFilter; label: string; count: number; dotClass: string }>).map((filter) => {
                const active = effectiveWhatsAppResponseFilter === filter.id;
                return (
                  <motion.button
                    layout
                    key={filter.id}
                    type="button"
                    onClick={() => {
                      setWhatsappResponseFilter(filter.id);
                      if (
                        activeChannel === "whatsapp2" &&
                        (filter.id === "arquivados" || filter.id === "trancadas")
                      ) {
                        void loadWhatsApp2Conversations();
                      }
                    }}
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.12 }}
                    className={`flex h-[27px] shrink-0 items-center gap-1.5 rounded-full px-[10px] text-[12px] font-medium tracking-[-0.01em] transition-colors ${
                      active
                        ? "bg-[#ffffff] text-[#111111] shadow-[0_0.5px_1px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.035] dark:bg-[#2c2c2e] dark:text-white dark:ring-white/[0.05]"
                        : "bg-transparent text-[#6e6e73] hover:bg-black/[0.03] dark:text-[#aeaeb2] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${filter.dotClass}`} />
                    <span>{filter.label}</span>
                    {(filter.id === "arquivados" || filter.id === "trancadas") && filter.count > 0 && (
                      <span className="text-[12px] font-normal tabular-nums opacity-55">
                        {filter.count > 99 ? "99+" : filter.count}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pt-0.5 pb-0.5 scrollbar-none select-none">
              {([
                { id: "nao_lidas", label: "Não lidas", count: activeChannel === "whatsapp2" ? whatsappUnreadCount : whatsappUnreadCount },
                { id: "com_ia", label: "Com IA", count: aiEnabledCount },
                { id: "sem_ia", label: "Sem IA", count: aiDisabledCount },
              ] as Array<{ id: Exclude<WhatsAppQuickFilter, "todas">; label: string; count: number }>).map((filter) => {
                const active = whatsappQuickFilter === filter.id;
                return (
                  <motion.button
                    layout
                    key={filter.id}
                    type="button"
                    onClick={() => setWhatsappQuickFilter(active ? "todas" : filter.id)}
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.12 }}
                    className={`flex h-[27px] shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium tracking-[-0.01em] transition-colors ${
                      active
                        ? "bg-[#d8fdd2] text-[#176b42] dark:bg-[#173d2b] dark:text-[#5fda91]"
                        : "bg-[#f2f2f7] text-[#3c3c43] dark:bg-[#2c2c2e] dark:text-[#ebebf5]"
                    }`}
                  >
                    <span>{filter.label}</span>
                    {filter.count > 0 && (
                      <span className="text-[11px] font-normal tabular-nums opacity-50">
                        {filter.count > 99 ? "99+" : filter.count}
                      </span>
                    )}
                  </motion.button>
                );
              })}

              <motion.button
                layout
                type="button"
                onClick={() => setShowWhatsAppStages((current) => !current)}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.12 }}
                className={`flex h-[27px] shrink-0 items-center rounded-full px-3 text-[12px] font-medium tracking-[-0.01em] transition-colors ${
                  showWhatsAppStages || whatsappStageFilter !== "todas"
                    ? "bg-[#d8fdd2] text-[#176b42] dark:bg-[#173d2b] dark:text-[#5fda91]"
                    : "bg-[#f2f2f7] text-[#3c3c43] dark:bg-[#2c2c2e] dark:text-[#ebebf5]"
                }`}
              >
                <span>
                  {whatsappStageFilter === "concluidos"
                    ? "Finalizados"
                    : whatsappStageFilter !== "todas"
                    ? stages.find((stage) => stage.id === whatsappStageFilter)?.name || "Etapas"
                    : "Etapas"}
                </span>
              </motion.button>
            </div>

            <AnimatePresence initial={false}>
              {showWhatsAppStages && (
                <motion.div
                  initial={prefersReducedMotion ? false : { height: 0, opacity: 0, y: -4 }}
                  animate={{ height: "auto", opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 overflow-x-auto pt-1.5 pb-0.5 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => {
                        setWhatsappStageFilter("todas");
                        setShowWhatsAppStages(false);
                      }}
                      className={`h-[28px] shrink-0 rounded-full px-[13px] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                        whatsappStageFilter === "todas"
                          ? "bg-[#d8fdd2] text-[#176b42] dark:bg-[#173d2b] dark:text-[#5fda91]"
                          : "bg-[#f2f2f7] text-[#3c3c43] dark:bg-[#2c2c2e] dark:text-[#ebebf5]"
                      }`}
                    >
                      Todas as etapas
                    </button>

                    {stages.map((stage) => {
                      const count = platformConversations.filter((conversation) => {
                        if (isChatRestricted(conversation) || conversation.isConverted) return false;
                        const currentStageId = conversation.currentStageId || stages[0]?.id;
                        return currentStageId === stage.id;
                      }).length;
                      const active = whatsappStageFilter === stage.id;

                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => {
                            setWhatsappStageFilter(stage.id);
                            setShowWhatsAppStages(false);
                          }}
                          className={`flex h-[28px] shrink-0 items-center gap-1 rounded-full px-[13px] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                            active
                              ? "bg-[#d8fdd2] text-[#176b42] dark:bg-[#173d2b] dark:text-[#5fda91]"
                              : "bg-[#f2f2f7] text-[#3c3c43] dark:bg-[#2c2c2e] dark:text-[#ebebf5]"
                          }`}
                        >
                          <span>{stage.name}</span>
                          {count > 0 && <span className="text-[12px] font-normal tabular-nums opacity-55">{count > 99 ? "99+" : count}</span>}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setWhatsappStageFilter("concluidos");
                        setShowWhatsAppStages(false);
                      }}
                      className={`h-[28px] shrink-0 rounded-full px-[13px] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                        whatsappStageFilter === "concluidos"
                          ? "bg-[#d8fdd2] text-[#176b42] dark:bg-[#173d2b] dark:text-[#5fda91]"
                          : "bg-[#f2f2f7] text-[#3c3c43] dark:bg-[#2c2c2e] dark:text-[#ebebf5]"
                      }`}
                    >
                      Finalizados
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeChannel === "instagram" && showFilterBar && (
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-[#666]">
              Filtros rápidos
            </span>
            <button
              type="button"
              onClick={() => setIsFilterModalOpen(true)}
              className="text-[11px] font-semibold text-zinc-500 dark:text-[#8e8e8e] hover:text-zinc-950 dark:hover:text-white transition-colors"
            >
              Ordenar
            </button>
          </div>
        )}

        {/* PÍLULAS OFICIAIS DO INSTAGRAM (DESIGN IDÊNTICO AO APP OFICIAL) */}
        {activeChannel === "instagram" && showFilterBar && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-zinc-200/80 bg-zinc-100/70 p-1 scrollbar-none select-none animate-in fade-in duration-150 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <button
                onClick={() => setInstaFilter("todos")}
                className={`min-h-9 px-4 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-[0.98] ${
                  instaFilter === "todos"
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-100 dark:text-black"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setInstaFilter("nao_respondidos")}
                className={`min-h-9 px-4 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-[0.98] ${
                  instaFilter === "nao_respondidos"
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-100 dark:text-black"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
                }`}
              >
                Não respondidos
              </button>
              <button
                onClick={() => setInstaFilter("respondidos")}
                className={`min-h-9 px-4 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-[0.98] ${
                  instaFilter === "respondidos"
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-100 dark:text-black"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
                }`}
              >
                Respondidos
              </button>
              <button
                onClick={() => setInstaFilter("pedidos")}
                className={`min-h-9 px-4 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-[0.98] flex items-center gap-1.5 ${
                  instaFilter === "pedidos"
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-black/[0.04] dark:bg-zinc-100 dark:text-black"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
                }`}
              >
                <span>Pedidos</span>
                {pedidosCount > 0 && (
                  <span className="text-[10px] font-bold tabular-nums opacity-55">
                    {pedidosCount}
                  </span>
                )}
              </button>
            </div>

            {/* SUB-FILTRO DA PASTA DE PEDIDOS E CONTAS RESTRINGIDAS (ESTILO INSTAGRAM) */}
            {instaFilter === "pedidos" && (
              <div className="p-3 rounded-2xl bg-zinc-100 dark:bg-[#141414] border border-zinc-200 dark:border-[#262626] space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPedidosSubFilter("todos_pedidos")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      pedidosSubFilter === "todos_pedidos"
                        ? "bg-zinc-200 dark:bg-[#2c2c2e] text-zinc-950 dark:text-white border border-zinc-300 dark:border-[#444]"
                        : "text-zinc-500 dark:text-[#8e8e8e] hover:text-zinc-950 dark:hover:text-white"
                    }`}
                  >
                    Todos os pedidos {pedidosCount > 0 ? `(${pedidosCount})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPedidosSubFilter("restringidos")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      pedidosSubFilter === "restringidos"
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40"
                        : "text-zinc-500 dark:text-[#8e8e8e] hover:text-zinc-950 dark:hover:text-white"
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Restringidos {restringidosCount > 0 ? `(${restringidosCount})` : ""}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e] leading-relaxed">
                  {pedidosSubFilter === "restringidos"
                    ? "Contas que você restringiu. As mensagens delas não aparecem na caixa de entrada principal e elas não saberão quando você estiver online ou ler as mensagens."
                    : "Mensagens de pessoas que não estão conectadas com você. A pessoa só saberá que você visualizou quando você aceitar ou responder."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* FILTROS SECUNDÁRIOS: IA + ETAPA */}
        {showFilterBar && hasCanonicalInstagramSnapshot && (
          <div className="grid grid-cols-1 items-center gap-2 overflow-visible py-0.5 select-none min-[500px]:grid-cols-[minmax(0,1fr)_176px]">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
                <Bot className="h-3.5 w-3.5 text-emerald-400" />
                <span>IA</span>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl bg-zinc-100/70 p-1 dark:bg-white/[0.035]">
                <button
                  type="button"
                  onClick={() => setAiFilter("todas")}
                  className={`min-h-8 min-w-0 flex-1 rounded-lg px-1.5 text-[11px] font-semibold transition-all active:scale-[0.98] ${
                    aiFilter === "todas"
                      ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-100 dark:text-black"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  Todas <span className="ml-1 text-[10px] tabular-nums opacity-50">{platformConversations.length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAiFilter("com_ia")}
                  className={`min-h-8 min-w-0 flex-1 rounded-lg px-1.5 text-[11px] font-semibold transition-all active:scale-[0.98] ${
                    aiFilter === "com_ia"
                      ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  Com IA <span className="ml-1 text-[10px] tabular-nums opacity-55">{aiEnabledCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAiFilter("sem_ia")}
                  className={`min-h-8 min-w-0 flex-1 rounded-lg px-1.5 text-[11px] font-semibold transition-all active:scale-[0.98] ${
                    aiFilter === "sem_ia"
                      ? "bg-zinc-800 text-white shadow-sm dark:bg-zinc-700"
                      : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  Sem IA <span className="ml-1 text-[10px] tabular-nums opacity-55">{aiDisabledCount}</span>
                </button>
              </div>
            </div>

            {stages.length > 0 && (() => {
              const convertedCount = platformConversations.filter(
                (c) => !isChatRestricted(c) && Boolean(c.isConverted)
              ).length;
              const selectedStageIndex = stages.findIndex((stage) => stage.id === stageFilter);
              const selectedStage = selectedStageIndex >= 0 ? stages[selectedStageIndex] : null;
              const selectedStageCount = selectedStage
                ? platformConversations.filter((c) => {
                    if (isChatRestricted(c)) return false;
                    const currentStageId = c.currentStageId || stages[0]?.id;
                    return currentStageId === selectedStage.id && !c.isConverted;
                  }).length
                : 0;

              const selectedLabel =
                stageFilter === "concluidos"
                  ? `Finalizados · ${convertedCount}`
                  : selectedStage
                    ? `${selectedStageIndex + 1}. ${selectedStage.name} · ${selectedStageCount}`
                    : "Todas as etapas";

              const selectStage = (value: string) => {
                setStageFilter(value);
                setIsStageFilterOpen(false);
              };

              return (
                <div ref={stageFilterMenuRef} className="relative w-full min-[500px]:w-[176px]">
                  <button
                    type="button"
                    onClick={() => setIsStageFilterOpen((current) => !current)}
                    aria-haspopup="menu"
                    aria-expanded={isStageFilterOpen}
                    className={`flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-[11px] font-semibold transition-all active:scale-[0.99] ${
                      isStageFilterOpen || stageFilter !== "todas"
                        ? "border-zinc-300 bg-white text-zinc-950 shadow-sm dark:border-white/[0.12] dark:bg-white/[0.07] dark:text-white"
                        : "border-zinc-200/80 bg-white text-zinc-700 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-zinc-300"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${isStageFilterOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isStageFilterOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+6px)] z-50 w-[230px] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-2xl shadow-black/10 dark:border-white/[0.08] dark:bg-[#151515] dark:shadow-black/50"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => selectStage("todas")}
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                          stageFilter === "todas"
                            ? "bg-zinc-100 font-semibold text-zinc-950 dark:bg-white/[0.08] dark:text-white"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.05]"
                        }`}
                      >
                        <span className="flex-1">Todas as etapas</span>
                        {stageFilter === "todas" && <Check className="h-3.5 w-3.5" />}
                      </button>

                      <div className="my-1 h-px bg-zinc-100 dark:bg-white/[0.06]" />

                      {stages.map((stg, idx) => {
                        const countInStage = platformConversations.filter((c) => {
                          if (isChatRestricted(c)) return false;
                          const currentStageId = c.currentStageId || stages[0]?.id;
                          return currentStageId === stg.id && !c.isConverted;
                        }).length;
                        const isSelected = stageFilter === stg.id;

                        return (
                          <button
                            key={stg.id}
                            type="button"
                            role="menuitem"
                            onClick={() => selectStage(stg.id)}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                              isSelected
                                ? "bg-zinc-100 font-semibold text-zinc-950 dark:bg-white/[0.08] dark:text-white"
                                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.05]"
                            }`}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: stg.color || "#3b82f6" }}
                            />
                            <span className="min-w-0 flex-1 truncate">{idx + 1}. {stg.name}</span>
                            <span className="text-[10px] tabular-nums text-zinc-400">{countInStage}</span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}

                      <div className="my-1 h-px bg-zinc-100 dark:bg-white/[0.06]" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => selectStage("concluidos")}
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                          stageFilter === "concluidos"
                            ? "bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.05]"
                        }`}
                      >
                        <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="flex-1">Finalizados</span>
                        <span className="text-[10px] tabular-nums text-zinc-400">{convertedCount}</span>
                        {stageFilter === "concluidos" && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Lista de Conversas Filtradas e Ordenadas */}
        <div className="space-y-0.5 pt-1">
          {activeChannel === "instagram" && !hasCanonicalInstagramSnapshot && sortedConversations.length === 0 ? (
            <div className="py-3 space-y-3">
              <p className="text-center text-[11px] text-zinc-500">Carregando conversas...</p>
              <ConversationSkeletonList count={6} />
            </div>
          ) : isLoadingList && activeChannel !== "whatsapp2" && sortedConversations.length === 0 ? (
            <div className="py-1">
              <ConversationSkeletonList count={6} />
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="py-16 text-center space-y-2.5">
              {isTinderInboxChannel ? (
                <div className="py-14 text-center space-y-3 px-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-tr from-[#fd5068] to-[#ff6036] text-white shadow-lg shadow-[#fd5068]/20">
                    <Flame className="h-6 w-6 fill-white" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-zinc-950 dark:text-white">
                      {tinderSession?.isConnected
                        ? "Nenhum match ativo encontrado"
                        : "Conecte sua conta do Tinder"}
                    </p>
                    <p className="mx-auto max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-[#a8a8a8]">
                      {tinderSession?.isConnected
                        ? "Seus novos matches e mensagens aparecerão aqui em tempo real."
                        : "Vincule seu token do Tinder para gerenciar matches e conversar diretamente."}
                    </p>
                  </div>
                  {!tinderSession?.isConnected && (
                    <button
                      type="button"
                      onClick={() => setIsTinderConnectOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#fd5068] to-[#ff6036] hover:opacity-95 shadow-md active:scale-95 transition-all cursor-pointer"
                    >
                      <Flame className="w-3.5 h-3.5 fill-white" />
                      Conectar Tinder
                    </button>
                  )}
                </div>
              ) : isWhatsAppInboxChannel ? (
                <div className="py-14 text-center space-y-3 px-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#25d366] text-white shadow-lg shadow-[#25d366]/20">
                    <WhatsAppIcon className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-zinc-950 dark:text-white">
                      {activeChannel === "whatsapp2"
                        ? whatsapp2GatewayStatus === "offline"
                          ? "WhatsApp 2 indisponível"
                          : whatsapp2GatewayStatus === "loading"
                          ? "Carregando WhatsApp 2..."
                          : "WhatsApp 2 conectado"
                        : "Nenhuma conversa no WhatsApp"}
                    </p>
                    <p className="mx-auto max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-[#8696a0]">
                      {activeChannel === "whatsapp2"
                        ? whatsapp2GatewayStatus === "offline"
                          ? whatsapp2GatewayError || "Abra o gateway local do WhatsApp 2 neste computador."
                          : "Sessão espelhada ativa e separada da Cloud API oficial."
                        : "As novas mensagens recebidas pelo seu número aparecem aqui em tempo real."}
                    </p>
                  </div>
                </div>
              ) : isInstagramConnected === false ? (
                <div className="py-14 text-center space-y-3 px-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] flex items-center justify-center mx-auto text-white shadow-lg">
                    <Camera className="w-6 h-6 stroke-[2]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-zinc-950 dark:text-white">Conecte seu Instagram Direct</p>
                    <p className="text-xs text-zinc-500 dark:text-[#737373] max-w-xs mx-auto leading-relaxed">
                      Vincule sua conta oficial da Meta para receber e responder conversas reais do Direct de forma segura e profissional.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsInstagramModalOpen(true)}
                    className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] text-white text-xs font-bold hover:opacity-95 active:scale-95 transition-all shadow-md cursor-pointer inline-flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Conectar Instagram Oficial
                  </button>
                </div>
              ) : isInstagramConnected === null ? (
                <div className="py-10 text-center space-y-2">
                  <div className="w-7 h-7 mx-auto rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-300 animate-spin" />
                  <p className="text-xs text-zinc-500 dark:text-[#737373]">Verificando conexão do Instagram...</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-[#737373]">Nenhuma conversa encontrada neste filtro.</p>
              )}
            </div>
          ) : (
            sortedConversations.map((conv, index) => {
              const prevConv = index > 0 ? sortedConversations[index - 1] : null;
              const currentDayKey = getMessageDayKey(conv.lastMessageAt || conv.lastActive);
              const prevDayKey = prevConv ? getMessageDayKey(prevConv.lastMessageAt || prevConv.lastActive) : null;
              const showDateDivider = activeChannel === "instagram" && (index === 0 ? Boolean(currentDayKey) : currentDayKey !== prevDayKey);
              const dateLabel = showDateDivider ? formatInboxDateDivider(conv.lastMessageAt || conv.lastActive) : null;

              return (
                <React.Fragment key={conv.id}>
                  {showDateDivider && dateLabel && (
                    <div className="pt-4 pb-1 px-2.5 select-none">
                      <span className="text-[10px] font-medium text-zinc-400 dark:text-[#666]">
                        {dateLabel}
                      </span>
                    </div>
                  )}

                  <div
                    onClick={() => {
                  if (isLongPressActiveRef.current) {
                    isLongPressActiveRef.current = false;
                    return;
                  }
                  handleOpenConversation(conv);
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  startLongPress(conv, touch.clientX, touch.clientY);
                }}
                onTouchEnd={cancelLongPress}
                onTouchMove={handleTouchMoveItem}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    startLongPress(conv, e.clientX, e.clientY);
                  }
                }}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  cancelLongPress();
                  setSelectedChatForActionSheet(conv);
                }}
                className={`flex items-center justify-between cursor-pointer select-none transition-all ${
                  isWhatsAppLikeType(conv.type)
                    ? "wa-ios-chat-row px-4 py-2.5 rounded-none hover:bg-black/[0.025] active:bg-black/[0.055] dark:hover:bg-white/[0.035] dark:active:bg-white/[0.065]"
                    : "py-3 px-2.5 rounded-2xl hover:bg-zinc-100/70 dark:hover:bg-[#121212] active:scale-[0.995]"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (conv.type === "tinder") {
                        setSelectedTinderProfile(toTinderProfileData(conv));
                        setIsTinderProfileOpen(true);
                        return;
                      }
                      if (conv.type !== "instagram") return;
                      setSelectedProfileForModal(conv);
                      setIsProfileModalOpen(true);
                    }}
                    title={
                      conv.type === "instagram"
                        ? "Toque para ver perfil completo"
                        : conv.type === "tinder"
                        ? "Ver perfil no Tinder"
                        : "Contato do WhatsApp"
                    }
                    className={`transition-all shrink-0 ${
                      conv.type === "instagram" || conv.type === "tinder"
                        ? "cursor-pointer hover:opacity-85 active:scale-95"
                        : "cursor-default"
                    }`}
                  >
                    <AvatarWithFallback
                      src={conv.avatar}
                      alt={conv.fullName || conv.username}
                      conversationId={conv.id}
                      sizeClassName={isWhatsAppLikeType(conv.type) ? "w-[52px] h-[52px]" : "w-12 h-12"}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 ${
                      isWhatsAppLikeType(conv.type) ? "flex-nowrap" : "flex-wrap"
                    }`}>
                      <h4
                        className={`min-w-0 flex-1 truncate tracking-tight ${
                          isWhatsAppLikeType(conv.type) ? "text-[16px]" : "text-sm"
                        } ${
                          isConversationUnread(conv) ? "font-bold text-zinc-950 dark:text-white" : "font-semibold text-zinc-900 dark:text-zinc-100"
                        }`}
                      >
                        {conv.fullName}
                      </h4>

                      {isWhatsAppLikeType(conv.type) && (conv.lastMessageAt || conv.lastActive) && (
                        <span
                          className={`shrink-0 text-[11px] ${
                            isConversationUnread(conv)
                              ? "font-semibold text-[#00a884] dark:text-[#25d366]"
                              : "font-normal text-[#8e8e93]"
                          }`}
                        >
                          {formatMessageTime(conv.lastMessageAt || conv.lastActive)}
                        </span>
                      )}

                      {/* Badges operacionais da conversa */}
                      {conv.type === "instagram" && isChatRestricted(conv) && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1">
                          <ShieldAlert className="w-2.5 h-2.5" />
                          Restrito
                        </span>
                      )}
                      {conv.type === "tinder" && conv.isNewMatch && (
                        <span className="text-[9px] bg-gradient-to-r from-[#fd5068] to-[#ff6036] text-white font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1 shadow-xs">
                          <Flame className="w-2.5 h-2.5 fill-white" />
                          Match
                        </span>
                      )}
                      {conv.type === "tinder" && isChatRestricted(conv) && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1">
                          <ShieldAlert className="w-2.5 h-2.5" />
                          Pausado
                        </span>
                      )}

                    </div>
                    <div className="flex items-center text-xs text-zinc-500 dark:text-[#8e8e8e] mt-0.5 min-w-0">
                      {(() => {
                        const isLastMessageSeen =
                          conv.lastSender === "me" &&
                          conv.lastStatus === "seen" &&
                          Boolean(conv.seenAt) &&
                          new Date(conv.seenAt!).getTime() >= new Date(conv.lastMessageAt || conv.lastActive || 0).getTime();
                        const timestamp = isLastMessageSeen
                          ? conv.seenAt
                          : conv.lastMessageAt || conv.lastActive;

                        if (isWhatsAppLikeType(conv.type)) {
                          return (
                            <span className="flex min-w-0 flex-1 items-center gap-1">
                              {conv.lastSender === "me" && (
                                conv.lastStatus === "delivered" || conv.lastStatus === "seen" ? (
                                  <CheckCheck
                                    className={`h-4 w-4 shrink-0 ${
                                      conv.lastStatus === "seen"
                                        ? "text-[#34b7f1]"
                                        : "text-[#8e8e93]"
                                    }`}
                                  />
                                ) : (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-[#8e8e93]" />
                                )
                              )}
                              <span
                                className={isConversationUnread(conv)
                                  ? "truncate font-medium text-[#111b21] dark:text-[#e9edef]"
                                  : "truncate text-[#8e8e93] dark:text-[#98989d]"}
                              >
                                {conv.lastMessage}
                              </span>
                            </span>
                          );
                        }

                        return (
                          <>
                            <span className="flex min-w-0 flex-1 items-center">
                              {isLastMessageSeen ? (
                                <span className="text-zinc-500 dark:text-[#8e8e8e] font-normal truncate">Visto</span>
                              ) : (
                                <span
                                  className={isConversationUnread(conv) ? "truncate text-zinc-800 dark:text-zinc-200 font-medium" : "truncate text-zinc-500 dark:text-[#8e8e8e]"}
                                >
                                  {conv.lastMessage}
                                </span>
                              )}
                            </span>
                            {timestamp && (
                              <span className="text-zinc-500 dark:text-[#737373] shrink-0 text-xs ml-1 font-normal">
                                {"\u2022"} {formatMessageTime(timestamp)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {isWhatsAppLikeType(conv.type) && (() => {
                      const currentStageId = conv.currentStageId || stages[0]?.id;
                      const currentStage = stages.find((stage) => stage.id === currentStageId);
                      const ai = brainInboxOverviewAvailable ? brainInboxOverview[conv.id] : null;
                      const raffleStatus = normalizeRaffleCommercialStatus(conv.raffleStatus);
                      const showAiState = Boolean(ai || conv.aiAutoRespond);

                      if (!conv.isConverted && !currentStage && !showAiState) return null;

                      const aiVisual = !ai
                        ? {
                            dot: "bg-[#34c759]",
                            chip: "bg-[#34c759]/10 text-[#248a3d] dark:bg-[#30d158]/12 dark:text-[#30d158]",
                          }
                        : ai.status === "failed"
                        ? {
                            dot: "bg-[#ff3b30]",
                            chip: "bg-[#ff3b30]/9 text-[#d70015] dark:bg-[#ff453a]/12 dark:text-[#ff6961]",
                          }
                        : ai.status === "waiting_human"
                        ? {
                            dot: "bg-[#af52de]",
                            chip: "bg-[#af52de]/9 text-[#8944ab] dark:bg-[#bf5af2]/12 dark:text-[#bf5af2]",
                          }
                        : ai.status === "waiting_delay" || ai.status === "queued"
                        ? {
                            dot: "bg-[#ff9500]",
                            chip: "bg-[#ff9500]/10 text-[#c93400] dark:bg-[#ff9f0a]/12 dark:text-[#ff9f0a]",
                          }
                        : ai.status === "processing"
                        ? {
                            dot: "bg-[#007aff]",
                            chip: "bg-[#007aff]/9 text-[#0066cc] dark:bg-[#0a84ff]/12 dark:text-[#0a84ff]",
                          }
                        : ai.status === "sending" || ai.status === "completed"
                        ? {
                            dot: "bg-[#34c759]",
                            chip: "bg-[#34c759]/10 text-[#248a3d] dark:bg-[#30d158]/12 dark:text-[#30d158]",
                          }
                        : {
                            dot: "bg-[#8e8e93]",
                            chip: "bg-black/[0.035] text-[#6e6e73] dark:bg-white/[0.055] dark:text-[#98989d]",
                          };

                      const detailsTitle = [
                        ai?.detail,
                        ai?.objectiveLabel ? `Objetivo: ${ai.objectiveLabel}` : null,
                        ai?.actionTypes?.length ? `Ações: ${ai.actionTypes.join(", ")}` : null,
                      ].filter(Boolean).join(" • ");

                      return (
                        <div
                          className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] leading-[15px]"
                          title={detailsTitle || undefined}
                        >
                          {showAiState && (
                            <span
                              className={`inline-flex max-w-[148px] shrink-0 items-center gap-1 rounded-[7px] px-1.5 py-[1px] font-semibold ${aiVisual.chip}`}
                            >
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${aiVisual.dot}`} />
                              <span className="truncate">
                                {ai ? <InboxAiStatusLabel ai={ai} /> : "Brain ativo"}
                              </span>
                            </span>
                          )}

                          {conv.isConverted ? (
                            <>
                              <span className="shrink-0 text-[#8e8e93]">Finalizado</span>
                              <span className="shrink-0 text-[#c7c7cc] dark:text-[#48484a]">·</span>
                              <span className="truncate text-[#8e8e93]">
                                Rifa: {raffleCommercialStatusLabel(raffleStatus)}
                              </span>
                            </>
                          ) : currentStage ? (
                            <>
                              {showAiState && <span className="shrink-0 text-[#c7c7cc] dark:text-[#48484a]">·</span>}
                              <span className="flex min-w-0 items-center gap-1 text-[#8e8e93]">
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: currentStage.color || "#8e8e93" }}
                                />
                                <span className="truncate">{currentStage.name}</span>
                              </span>
                            </>
                          ) : null}

                          {!conv.isConverted && ai?.objectiveLabel && (
                            <>
                              <span className="shrink-0 text-[#c7c7cc] dark:text-[#48484a]">·</span>
                              <span className="truncate text-[#8e8e93]">{ai.objectiveLabel}</span>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {conv.type === "instagram" && (() => {
                      const currentStageId = conv.currentStageId || stages[0]?.id;
                      const currentStage = stages.find((stage) => stage.id === currentStageId);
                      const ai = brainInboxOverviewAvailable ? brainInboxOverview[conv.id] : null;
                      const raffleStatus = normalizeRaffleCommercialStatus(conv.raffleStatus);
                      const showAiState = Boolean(ai || conv.aiAutoRespond);

                      if (!conv.isConverted && !currentStage && !showAiState) return null;

                      const aiDotClass = !ai
                        ? "bg-emerald-400"
                        : ai.status === "failed"
                        ? "bg-red-400"
                        : ai.status === "waiting_human"
                        ? "bg-violet-400"
                        : ai.status === "waiting_delay" || ai.status === "queued"
                        ? "bg-amber-400"
                        : ai.status === "processing"
                        ? "bg-sky-400"
                        : ai.status === "sending" || ai.status === "completed"
                        ? "bg-emerald-400"
                        : "bg-zinc-400";

                      return (
                        <div
                          className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] leading-4 text-zinc-400 dark:text-[#737373]"
                          title={ai?.detail || ai?.label}
                        >
                          {conv.isConverted ? (
                            <>
                              <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">Finalizado</span>
                              <span className="text-zinc-300 dark:text-[#383838]">·</span>
                              <span className="truncate">Rifa: {raffleCommercialStatusLabel(raffleStatus)}</span>
                            </>
                          ) : currentStage ? (
                            <>
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: currentStage.color || "#71717a" }}
                              />
                              <span className="truncate">{currentStage.name}</span>
                            </>
                          ) : null}

                          {showAiState && (
                            <>
                              {(conv.isConverted || currentStage) && <span className="text-zinc-300 dark:text-[#383838]">·</span>}
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${aiDotClass}`} />
                              <span className="shrink-0">
                                {ai ? <InboxAiStatusLabel ai={ai} /> : "IA ativa"}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Lado Direito: Mini avatar para mensagem visualizada pelo cliente, Sininho para recebida pendente de resposta ou Bolinha para não lida */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {(() => {
                    const isUnread = isConversationUnread(conv);
                    const isReplied = !isUnread && conv.lastSender !== "them";

                    if (isUnread) {
                      return (
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isWhatsAppLikeType(conv.type)
                              ? "bg-[#25d366] shadow-[0_0_0_3px_rgba(37,211,102,0.10)]"
                              : "bg-[#0095f6] shadow-[0_0_0_3px_rgba(0,149,246,0.08)]"
                          }`}
                          title="Não lida"
                        />
                      );
                    }

                    if (isWhatsAppLikeType(conv.type)) return null;

                    // Se a última mensagem foi enviada por nós e o cliente já visualizou
                    const isClientSeen =
                      conv.lastSender === "me" &&
                      conv.lastStatus === "seen" &&
                      Boolean(conv.seenAt) &&
                      new Date(conv.seenAt!).getTime() >= new Date(conv.lastMessageAt || conv.lastActive || 0).getTime();

                    if (isClientSeen) {
                      return (
                        <div
                          className="w-4 h-4 rounded-full overflow-hidden border border-white/20 shrink-0 opacity-85 shadow-sm"
                          title={`Visualizado pelo cliente ${conv.seenAt ? `às ${formatMessageTime(conv.seenAt)}` : ""}`}
                        >
                          <AvatarWithFallback
                            src={conv.avatar}
                            alt={conv.fullName || conv.username}
                            conversationId={conv.id}
                            sizeClassName="w-4 h-4"
                          />
                        </div>
                      );
                    }

                    if (!isReplied) {
                      return (
                        <span title="Visualizada (Pendente de resposta)" className="flex items-center justify-center shrink-0">
                          <Bell className="w-3.5 h-3.5 text-zinc-500 dark:text-[#737373] stroke-[1.8]" />
                        </span>
                      );
                    }

                    // Se a mensagem já foi respondida, o sininho não deve aparecer
                    return null;
                  })()}
                </div>
              </div>
            </React.Fragment>
          );
        })
          )}
        </div>
      </div>
    </div>

      {/* 2. CHAT ABERTO: sem transição para abrir já estabilizado na última mensagem */}
      {activeChat ? renderChatThread() : null}

      <AnimatePresence>
        {whatsappMessageMenu && isWhatsAppLikeType(activeChat?.type) && (
          <motion.div
            key="whatsapp-message-menu"
            className="fixed inset-0 z-[140] flex items-end justify-center bg-black/[0.045] px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:items-center sm:pb-0"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
            onClick={() => setWhatsappMessageMenu(null)}
          >
            <motion.div
              initial={prefersReducedMotion ? false : { y: 24, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { y: 16, scale: 0.98, opacity: 0 }}
              transition={prefersReducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 520, damping: 38, mass: 0.62 }}
              className="whatsapp-ios wa-ios-glass w-full max-w-[330px] overflow-hidden rounded-[22px] shadow-[0_20px_60px_rgba(0,0,0,0.20)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.07]">
                <p className="truncate text-[12px] text-[#8e8e93]">
                  {whatsappMessageMenu.mediaType === "audio"
                    ? "Mensagem de voz"
                    : whatsappMessageMenu.mediaType === "image"
                    ? "Foto"
                    : whatsappMessageMenu.mediaType === "sticker" || whatsappMessageMenu.text.startsWith("[sticker:")
                    ? "Figurinha"
                    : whatsappMessageMenu.text || "Mensagem"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const target = whatsappMessageMenu;
                  setWhatsappMessageMenu(null);
                  beginReplyToMessage(target);
                }}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px] text-[#111b21] transition-colors hover:bg-black/[0.04] active:bg-black/[0.08] dark:text-white dark:hover:bg-white/[0.05]"
              >
                <span>Responder</span>
                <Reply className="h-5 w-5 text-[#007aff]" />
              </button>
              {(whatsappMessageMenu.mediaType === "sticker" || whatsappMessageMenu.text.startsWith("[sticker:")) ? (
                <>
                  <div className="mx-4 h-px bg-black/[0.07] dark:bg-white/[0.07]" />
                  <button
                    type="button"
                    onClick={() => {
                      const target = whatsappMessageMenu;
                      setWhatsappMessageMenu(null);
                      void saveWhatsAppSticker(target);
                    }}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px] text-[#111b21] transition-colors hover:bg-black/[0.04] active:bg-black/[0.08] dark:text-white dark:hover:bg-white/[0.05]"
                  >
                    <span>Salvar figurinha</span>
                    <BookmarkPlus className="h-5 w-5 text-[#007aff]" />
                  </button>
                </>
              ) : (
                <>
                  <div className="mx-4 h-px bg-black/[0.07] dark:bg-white/[0.07]" />
                  <button
                    type="button"
                    onClick={async () => {
                      const textToCopy = whatsappMessageMenu.text || "";
                      try {
                        await navigator.clipboard.writeText(textToCopy);
                        toast.success("Mensagem copiada.");
                      } catch {
                        toast.error("Não foi possível copiar.");
                      }
                      setWhatsappMessageMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px] text-[#111b21] transition-colors hover:bg-black/[0.04] active:bg-black/[0.08] dark:text-white dark:hover:bg-white/[0.05]"
                  >
                    <span>Copiar</span>
                    <Copy className="h-5 w-5 text-[#007aff]" />
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Perfil Completo para acesso a partir da lista */}
      <InstagramProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedProfileForModal(null);
        }}
        profile={toInstagramProfileData(selectedProfileForModal)}
      />

      {/* Modal de Conexão com o Instagram Oficial */}
      <InstagramConnectModal
        isOpen={isInstagramModalOpen}
        onClose={() => {
          setIsInstagramModalOpen(false);
          checkInstagramStatus();
          loadInstagramConversations();
        }}
        onConnectionChange={() => {
          checkInstagramStatus();
          loadInstagramConversations();
        }}
      />

      {/* Modal de Conexão com o Tinder */}
      <TinderConnectModal
        isOpen={isTinderConnectOpen}
        onClose={() => {
          setIsTinderConnectOpen(false);
          checkTinderStatus();
          loadTinderConversations();
        }}
        session={tinderSession}
        onConnect={handleTinderConnect}
        onDisconnect={handleTinderDisconnect}
        onSyncMatches={handleTinderSync}
      />

      {/* Modal de Perfil do Match do Tinder */}
      <TinderProfileModal
        isOpen={isTinderProfileOpen}
        onClose={() => {
          setIsTinderProfileOpen(false);
          setSelectedTinderProfile(null);
        }}
        profile={selectedTinderProfile || toTinderProfileData(activeChat)}
      />

      {/* Modal de Filtros e Ordenação Temporal */}
      <ChatFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        instaFilter={instaFilter}
        onInstaFilterChange={setInstaFilter}
        isTinder={isTinderInboxChannel}
        tinderFilter={tinderFilter}
        onTinderFilterChange={setTinderFilter}
        onReset={() => {
          setSortOrder("recentes");
          setInstaFilter("todos");
          setTinderFilter("todos");
          setStageFilter("todas");
          setAiFilter("todas");
        }}
      />

      {/* Menu contextual da inbox do WhatsApp no padrão visual do iOS */}
      {selectedChatForActionSheet && isWhatsAppLikeType(selectedChatForActionSheet.type) && (
        <div
          className="whatsapp-ios fixed inset-0 z-[130] flex items-end justify-center bg-black/[0.045] px-2 pb-[calc(8px+env(safe-area-inset-bottom,0px))] sm:items-center sm:pb-0"
          onClick={() => setSelectedChatForActionSheet(null)}
        >
          <div
            className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-3 zoom-in-95 duration-150"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wa-ios-glass overflow-hidden rounded-[18px]">
              <div className="flex items-center gap-3 border-b border-black/[0.08] px-4 py-3 dark:border-white/[0.08]">
                <AvatarWithFallback
                  src={selectedChatForActionSheet.avatar}
                  alt={selectedChatForActionSheet.fullName || selectedChatForActionSheet.username}
                  conversationId={selectedChatForActionSheet.id}
                  sizeClassName="w-10 h-10"
                />
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#111b21] dark:text-white">
                  {selectedChatForActionSheet.fullName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggleUnreadStatus(selectedChatForActionSheet)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-[16px] text-[#007aff] transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.06]"
              >
                <span>
                  {isConversationUnread(selectedChatForActionSheet)
                    ? "Marcar como lida"
                    : "Marcar como não lida"}
                </span>
                <Bell className="h-5 w-5" />
              </button>

              {selectedChatForActionSheet.type === "whatsapp2" && (
                <>
                  <button
                    type="button"
                    disabled={whatsapp2ControlBusy !== null}
                    onClick={() => void handleToggleWhatsApp2Block(selectedChatForActionSheet)}
                    className={`flex w-full items-center justify-between border-t border-black/[0.08] px-4 py-3.5 text-[16px] transition-colors active:bg-black/[0.06] disabled:cursor-wait disabled:opacity-55 dark:border-white/[0.08] dark:active:bg-white/[0.06] ${
                      selectedChatForActionSheet.isBlocked ? "text-[#007aff]" : "text-[#ff3b30]"
                    }`}
                  >
                    <span>
                      {selectedChatForActionSheet.isBlocked
                        ? "Desbloquear contato"
                        : "Bloquear contato"}
                    </span>
                    {whatsapp2ControlBusy === "block" || whatsapp2ControlBusy === "loading" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : selectedChatForActionSheet.isBlocked ? (
                      <ShieldCheck className="h-5 w-5" />
                    ) : (
                      <Ban className="h-5 w-5" />
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={whatsapp2ControlBusy !== null}
                    onClick={() => void handleToggleWhatsApp2Lock(selectedChatForActionSheet)}
                    className="flex w-full items-center justify-between border-t border-black/[0.08] px-4 py-3.5 text-[16px] text-[#007aff] transition-colors active:bg-black/[0.06] disabled:cursor-wait disabled:opacity-55 dark:border-white/[0.08] dark:active:bg-white/[0.06]"
                  >
                    <span>
                      {selectedChatForActionSheet.isLocked
                        ? "Destrancar conversa"
                        : "Trancar conversa"}
                    </span>
                    {whatsapp2ControlBusy === "lock" || whatsapp2ControlBusy === "loading" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : selectedChatForActionSheet.isLocked ? (
                      <Unlock className="h-5 w-5" />
                    ) : (
                      <Lock className="h-5 w-5" />
                    )}
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedChatForActionSheet(null)}
              className="wa-ios-glass mt-2 w-full rounded-[18px] py-3.5 text-center text-[17px] font-semibold text-[#007aff] active:scale-[0.99]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ACTION SHEET DE OPÇÕES DA CONVERSA (Instagram) */}
      {selectedChatForActionSheet?.type === "instagram" && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedChatForActionSheet(null)}
        >
          <div
            className="w-full sm:max-w-sm bg-white dark:bg-[#161618] border border-zinc-200 dark:border-[#2a2a2c] rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl p-4 space-y-3 pb-[calc(1.2rem+env(safe-area-inset-bottom,0px))] animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do contato */}
            <div className="flex items-center gap-3 pb-3 border-b border-[#262628]">
              <AvatarWithFallback
                src={selectedChatForActionSheet.avatar}
                alt={selectedChatForActionSheet.fullName || selectedChatForActionSheet.username}
                conversationId={selectedChatForActionSheet.id}
                sizeClassName="w-11 h-11"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-zinc-950 dark:text-white truncate">
                  {selectedChatForActionSheet.fullName}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-[#8e8e8e] truncate">
                  @{selectedChatForActionSheet.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChatForActionSheet(null)}
                className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-[#242426] text-zinc-500 dark:text-[#8e8e8e] hover:text-zinc-950 dark:hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                aria-label="Fechar opções"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Lista de Ações do Chat */}
            <div className="space-y-1.5 pt-1">
              {/* Opção 1: Restringir / Remover Restrição */}
              <button
                type="button"
                onClick={() => {
                  const target = selectedChatForActionSheet;
                  setSelectedChatForActionSheet(null);
                  handleToggleRestricted(target);
                }}
                className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left ${
                  selectedChatForActionSheet.isRestricted
                    ? "bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/25"
                    : "bg-white dark:bg-[#202022] border border-zinc-200 dark:border-[#2c2c2e] text-zinc-950 dark:text-white hover:bg-zinc-100 dark:hover:bg-[#28282b]"
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-black/40 flex items-center justify-center shrink-0">
                  {selectedChatForActionSheet.isRestricted ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">
                    {selectedChatForActionSheet.isRestricted
                      ? "Remover restrição"
                      : "Restringir conta"}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e] truncate">
                    {selectedChatForActionSheet.isRestricted
                      ? "Mover de volta para a caixa de entrada principal"
                      : "Mover para aba Pedidos e ocultar presença online"}
                  </p>
                </div>
              </button>

              {/* Opção 2: Marcar como Não Lida / Lida */}
              <button
                type="button"
                onClick={() => handleToggleUnreadStatus(selectedChatForActionSheet)}
                className="w-full p-3 rounded-xl bg-white dark:bg-[#202022] border border-zinc-200 dark:border-[#2c2c2e] hover:bg-zinc-100 dark:hover:bg-[#28282b] text-zinc-950 dark:text-white flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-black/40 flex items-center justify-center shrink-0">
                  {isConversationUnread(selectedChatForActionSheet) ? (
                    <Bell className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-[#0095f6]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">
                    {isConversationUnread(selectedChatForActionSheet)
                      ? "Marcar como lida"
                      : "Marcar como não lida"}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e] truncate">
                    {isConversationUnread(selectedChatForActionSheet)
                      ? "Remover destaque de mensagem pendente"
                      : "Destacar com bolinha azul para responder depois"}
                  </p>
                </div>
              </button>

              {/* Opção 3: Ver perfil completo */}
              <button
                type="button"
                onClick={() => {
                  const target = selectedChatForActionSheet;
                  setSelectedChatForActionSheet(null);
                  setSelectedProfileForModal(target);
                  setIsProfileModalOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-white dark:bg-[#202022] border border-zinc-200 dark:border-[#2c2c2e] hover:bg-zinc-100 dark:hover:bg-[#28282b] text-zinc-950 dark:text-white flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-black/40 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-zinc-600 dark:text-[#a8a8a8]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">Ver perfil completo</p>
                  <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e] truncate">
                    Visualizar dados do usuário e fotos
                  </p>
                </div>
              </button>
            </div>

            {/* Botão Cancelar */}
            <button
              type="button"
              onClick={() => setSelectedChatForActionSheet(null)}
              className="w-full py-3 rounded-xl bg-zinc-100 dark:bg-[#222226] hover:bg-zinc-200 dark:hover:bg-[#2a2a2e] text-zinc-950 dark:text-white text-xs font-bold transition-all cursor-pointer active:scale-98 border border-zinc-200 dark:border-[#303034]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
