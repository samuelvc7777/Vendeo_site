"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react";
import Image from "next/image";
import {
  Search,
  Camera,
  ArrowLeft,
  Flame,
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
  Layers,
  Trophy,
  Clock,
  Bot,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { TinderSession } from "@/domain/entities/Tinder";
import {
  ConversationSkeletonList,
  ChatMessageSkeletonList,
} from "@/presentation/components/ui/LoadingState";
import { AiAssistantModal } from "./AiAssistantModal";
import { TinderProfileModal } from "@/presentation/components/tinder/TinderProfileModal";
import { InstagramConnectModal } from "@/presentation/components/instagram/InstagramConnectModal";
import { ChatFilterModal, SortOrder } from "./ChatFilterModal";
import { resolveContactAvatar } from "@/domain/services/AvatarResolverService";
import { useChatRealtime, notifyLocalTabs, RealtimeMessagePayload } from "@/presentation/hooks/useChatRealtime";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { InstagramAudioMessage } from "./InstagramAudioMessage";
import {
  ensureInstagramCompatibleAudio,
  ensureCompatibleAudioUrl,
} from "./audio-converter";
import { FloatingVaultModal } from "./FloatingVaultModal";
import { PersonaAudioVaultModal } from "../vault/PersonaAudioVaultModal";
import { AutoPilotActivationModal } from "./AutoPilotActivationModal";
import { InstagramChatComposer, InstagramChatComposerRef } from "./InstagramChatComposer";
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
import { useAutoPilot } from "@/presentation/hooks/useAutoPilot";
import { AutoPilotApprovalCard } from "./AutoPilotApprovalCard";
import {
  AutoPilotActivityIndicator,
  isAutoPilotActivelyWorking,
  isAutoPilotWorking,
} from "./AutoPilotActivityIndicator";
import { useMobileNotifications } from "@/presentation/hooks/useMobileNotifications";

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
  mediaType?: "image" | "audio" | "video";
  audioTranscript?: string;
  createdAt: string;
  timestamp?: number;
  sentDate?: string;
  isMine: boolean;
  liked?: boolean;
  status?: "sending" | "sent" | "seen" | "failed";
  seenAt?: string;
  errorReason?: "outside_24h_window" | "generic";
  deliverAt?: number;
  delaySeconds?: number;
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
  type: "instagram" | "tinder";
  lastSender: "me" | "them";
  lastStatus?: string;
  seenAt?: string;
  isNewMatch?: boolean;
  photos?: string[];
  bio?: string;
  city?: string;
  lastMessageAt?: string;
  isRestricted?: boolean;
  status?: "active" | "archived" | "blocked" | "restricted" | "pending" | "system" | "vault";
}

type InstagramFilter = "todos" | "nao_respondidos" | "respondidos" | "pedidos";
type TinderFilter = "todos" | "novos" | "sua_vez" | "vez_deles" | "restritos";

function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
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
  sizeClassName?: string;
  ringClassName?: string;
}

function AvatarWithFallback({
  src,
  alt,
  sizeClassName = "w-10 h-10",
  ringClassName = "",
}: AvatarWithFallbackProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  // Se o src falhar ou for vazio, utiliza a foto oficial de 'sem foto'
  const photoToDisplay = (!hasError && src && src.trim().length > 0 && !src.includes("images.unsplash.com"))
    ? src.trim()
    : resolveContactAvatar(alt, alt);

  return (
    <div
      className={`relative rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-[#1c1c1e] select-none ${sizeClassName} ${ringClassName}`}
    >
      <Image
        src={photoToDisplay}
        alt={alt || "Avatar"}
        fill
        unoptimized
        className="object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

/**
 * Player de Áudio Estilo Instagram Direct
 * Suporta reprodução de notas de voz nativas (.m4a, .mp3, .wav)
 * com visualizador de onda sonora interativo e controle de progresso.
 */
function DirectAudioPlayer({
  src,
  isMine,
}: {
  src?: string;
  isMine: boolean;
}) {
  if (!src || src.trim().length === 0) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-zinc-400 select-none">
        <span>🎙️ Mensagem de voz</span>
      </div>
    );
  }

  return <InstagramAudioMessage audioUrl={src} isMine={isMine} />;
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
      <div className="p-3 rounded-xl bg-zinc-900 text-xs text-zinc-400 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-400" />
        <span>Foto indisponível</span>
      </div>
    );
  }

  return (
    <div
      onClick={() => onExpand(src)}
      className="relative rounded-xl overflow-hidden cursor-pointer group bg-zinc-900 my-1 max-w-[260px] max-h-[340px]"
    >
      {!loaded && (
        <div className="w-[220px] h-[220px] flex items-center justify-center bg-zinc-800 animate-pulse">
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
      <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <Maximize2 className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

/**
 * Card Visual de Mensagem de Voz (Áudio) do Instagram
 * Renderiza o reprodutor oficial de nota de voz com áudio persistido no Supabase
 */
function InstagramVoiceMessageCard({ isMine }: { isMine: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 text-xs text-zinc-400 select-none">
      <span>🎙️ Mensagem de voz</span>
    </div>
  );
}

/**
 * Card Visual de Mídia Compartilhada do Instagram
 * Apresenta fotos, stories e mídias efêmeras com a identidade visual oficial do Instagram
 */
function InstagramSharedMediaCard({ isMine }: { isMine: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-1 min-w-[210px] max-w-[260px] select-none">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] via-[#dc2743] via-[#cc2366] to-[#bc1888] flex items-center justify-center shrink-0 shadow-md">
        <Camera className="w-5 h-5 text-white stroke-[2.2]" />
      </div>
      <div className="leading-tight flex-1">
        <span className="text-xs font-semibold text-white block tracking-tight">
          Foto do Instagram
        </span>
        <span className="text-[10px] text-zinc-400 block mt-0.5">
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
 * Exibe contagem decrescente segundo a segundo (ex: 10s -> 09s -> ... -> 01s)
 * mantendo '01s' até a confirmação final da entrega.
 */
function MessageCountdown({ deliverAt }: { deliverAt: number }) {
  const [remaining, setRemaining] = useState<number>(() => {
    return Math.max(1, Math.ceil((deliverAt - Date.now()) / 1000));
  });

  useEffect(() => {
    const update = () => {
      const diff = Math.ceil((deliverAt - Date.now()) / 1000);
      setRemaining(Math.max(1, diff));
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [deliverAt]);

  const formatted = String(remaining).padStart(2, "0") + "s";

  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px] text-white/95 bg-white/20 px-1.5 py-0.5 rounded-full font-semibold tabular-nums select-none"
      title={`Enviando em ${formatted}`}
    >
      <Clock className="w-2.5 h-2.5 animate-pulse text-amber-300 shrink-0" />
      <span>{formatted}</span>
    </span>
  );
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
  const [activeChat, setActiveChat] = useState<DirectConversation | null>(null);
  const [messages, setMessages] = useState<Record<string, DirectMessage[]>>({});
  const messagesRef = useRef<Record<string, DirectMessage[]>>({});
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const composerRef = useRef<InstagramChatComposerRef>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [chatPlatform, setChatPlatform] = useState<"instagram" | "tinder">("instagram");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTargetMessageId, setAiTargetMessageId] = useState<string | null>(null);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [isPersonaAudioModalOpen, setIsPersonaAudioModalOpen] = useState(false);
  const [isAutoPilotActivationModalOpen, setIsAutoPilotActivationModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [selectedProfileForModal, setSelectedProfileForModal] = useState<DirectConversation | null>(null);

  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);
  const [isInstagramConnected, setIsInstagramConnected] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(true);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("recentes");
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  // Estados do Funil de Etapas e Checklists (Check-ups)
  const [stageFilter, setStageFilter] = useState<string>("todas"); // "todas" | "concluidos" | stageId
  const chatStages = useChatStages(activeChat?.id);
  const {
    stages,
    allProgresses,
    chatDetail,
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
    const targetConv =
      conversations.find((c) => c.id === conversationId) ||
      (activeChat?.id === conversationId ? activeChat : null);

    const convType = targetConv?.type || (conversationId.startsWith("tinder_") ? "tinder" : "instagram");

    const endpoint = getApiUrl(
      convType === "tinder"
        ? `/api/tinder/messages/${conversationId}`
        : `/api/instagram/messages/${conversationId}`
    );

    const isAudioMsg = text.startsWith("[audio:");
    const audioUrl = isAudioMsg ? text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;
    const tempId = `temp_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const timeFormatted = formatMessageTime(new Date());

    if (convType === "instagram") {
      void markItemCompletedByExactText(text.trim());
    }

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

  // Busca e sincroniza mensagens de uma conversa em segundo plano (sem exigir visualização na tela)
  const fetchConversationMessages = useCallback(async (conversationId: string) => {
    const targetConv =
      conversations.find((c) => c.id === conversationId) ||
      (activeChat?.id === conversationId ? activeChat : null);

    const convType = targetConv?.type || (conversationId.startsWith("tinder_") ? "tinder" : "instagram");
    const endpoint = getApiUrl(
      convType === "tinder"
        ? `/api/tinder/messages/${conversationId}`
        : `/api/instagram/messages/${conversationId}`
    );

    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        const incoming: DirectMessage[] = data?.messages || [];
        setMessages((prev) => ({
          ...prev,
          [conversationId]: deduplicateMessages([...(prev[conversationId] || []), ...incoming]),
        }));
      }
    } catch (err) {
      console.warn(`[AutoPilot] Erro ao sincronizar mensagens de ${conversationId} em segundo plano:`, err);
    }
  }, [conversations, activeChat]);

  // Sincronização manual sob demanda com a Meta Graph API
  const handleManualSyncChat = useCallback(async () => {
    if (!activeChat || isManualSyncing) return;
    setIsManualSyncing(true);
    try {
      if (activeChat.type === "instagram") {
        const res = await fetch(getApiUrl(`/api/instagram/messages/${activeChat.id}?sync=true`));
        if (res.ok) {
          const data = await res.json();
          if (data?.messages) {
            setMessages((prev) => ({
              ...prev,
              [activeChat.id]: deduplicateMessages(data.messages),
            }));
          }
        }
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
  // Instância do Piloto Automático Inteligente com Fila Sequencial e Debounce
  const autoPilot = useAutoPilot({
    conversations,
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

  // Instância do Gerenciador de Notificações Móveis e Push (FCM / Service Worker)
  const mobileNotifications = useMobileNotifications();
  const mobileNotificationsRef = useRef(mobileNotifications);
  useEffect(() => {
    mobileNotificationsRef.current = mobileNotifications;
  }, [mobileNotifications]);

  // Menu de Opções ao Clicar e Segurar (Long Press)
  const [selectedChatForActionSheet, setSelectedChatForActionSheet] = useState<DirectConversation | null>(null);
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
    return restrictedChatIdsRef.current.has(c.id) || Boolean(c.isRestricted || c.status === "restricted");
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
        try { navigator.vibrate(40); } catch {}
      }
      setSelectedChatForActionSheet(conv);
    }, 500);
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

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conv.id
          ? { ...c, unread: nextUnread, lastSender: nextUnread ? "them" : c.lastSender }
          : c
      )
    );

    const supabase = getSupabaseBrowserClient();
    if (supabase && conv.type === "instagram") {
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

    if (chat.type === "tinder") {
      if (nextRestricted) {
        toast.success(`Match ${chat.fullName || chat.username} movido para Restritos.`);
      } else {
        toast.success(`Restrição de ${chat.fullName || chat.username} removida.`);
      }
    } else {
      if (nextRestricted) {
        toast.success(`Conta @${chat.username} movida para Pedidos (Restringidos).`);
      } else {
        toast.success(`Restrição de @${chat.username} removida.`);
      }
    }

    // 3. Grava no banco Supabase em tempo real (< 50ms)
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      if (chat.type === "instagram") {
        supabase
          .from("instagram_conversations")
          .update({
            is_restricted: nextRestricted,
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", chat.id)
          .then(() => {});
      } else if (chat.type === "tinder") {
        supabase
          .from("tinder_conversations")
          .update({
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("match_id", chat.id)
          .then(() => {});
      }
    }

    // 4. Notifica a API backend em background
    if (chat.type === "instagram") {
      fetch(getApiUrl(`/api/instagram/conversations/${chat.id}/restrict`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRestricted: nextRestricted }),
      }).catch(() => {});
    } else if (chat.type === "tinder") {
      fetch(getApiUrl(`/api/tinder/matches/${chat.id}/restrict`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRestricted: nextRestricted }),
      }).catch(() => {});
    }
  }, [isChatRestricted]);

  const cancelPendingImage = useCallback(() => {
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  }, [pendingImage]);

  const checkInstagramStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/instagram/config"));
      if (res.ok) {
        const data = await res.json();
        setIsInstagramConnected(Boolean(data.isConnected));
      }
    } catch {
      setIsInstagramConnected(false);
    }
  }, []);

  // Referência para auto-scroll suave
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Estado da Conexão com o Tinder
  const [tinderSession, setTinderSession] = useState<TinderSession | null>(null);
  const tinderSessionRef = useRef<TinderSession | null>(tinderSession);
  useEffect(() => {
    tinderSessionRef.current = tinderSession;
  }, [tinderSession]);

  // Filtros
  const [instaFilter, setInstaFilter] = useState<InstagramFilter>("todos");
  const [tinderFilter, setTinderFilter] = useState<TinderFilter>("todos");

  // Carrega conversas reais do Instagram do Supabase (com in-flight dedup e colunas explícitas sem stage_completed_rules)
  const isDirectLoadingConvsRef = useRef<boolean>(false);
  const loadInstagramConversations = useCallback(async () => {
    if (isDirectLoadingConvsRef.current) return;
    isDirectLoadingConvsRef.current = true;
    try {
      const supabase = getSupabaseBrowserClient();
      let rawConversations: any[] = [];

      // 1. Tenta carregar diretamente do banco Supabase com colunas explícitas (elimina payload pesado de stage_completed_rules)
      if (supabase) {
        const { data, error } = await supabase
          .from("instagram_conversations")
          .select("id, username, full_name, avatar, last_message, last_message_at, last_direction, last_status, seen_at, unread, status, is_restricted, created_at, updated_at")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(300);

        if (!error && data && data.length > 0) {
          rawConversations = data
            .filter((c: any) => !c.id?.startsWith("__") && c.status !== "system" && c.status !== "vault")
            .map((c: any) => ({
            id: c.id,
            username: c.username || `ig_${c.id.slice(-6)}`,
            fullName: c.full_name || c.username || "Usuário Instagram",
            avatar: c.avatar || "/images/default-avatar.svg",
            isOnline: false,
            lastActive: formatMessageTime(c.last_message_at),
            lastMessage: c.last_direction === "out" ? `Você: ${c.last_message || ""}` : (c.last_message || ""),
            lastSender: c.last_direction === "out" ? "me" : "them",
            lastStatus: (c.last_direction === "out" && c.last_status === "seen" && c.seen_at && new Date(c.seen_at).getTime() >= new Date(c.last_message_at || 0).getTime())
              ? "seen"
              : (c.last_direction === "out" ? "sent" : undefined),
            seenAt: (c.last_direction === "out" && c.last_status === "seen" && c.seen_at && new Date(c.seen_at).getTime() >= new Date(c.last_message_at || 0).getTime())
              ? c.seen_at
              : undefined,
            unread: Boolean(c.unread),
            type: "instagram" as const,
            lastMessageAt: c.last_message_at,
            isRestricted: Boolean(c.is_restricted),
            status: c.status || (c.is_restricted ? "restricted" : "active"),
          }));
        }
      }

      // 2. Fallback via API
      if (rawConversations.length === 0) {
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

      // 3. Mescla com restrições locais e status de leitura
      setConversations((prev) => {
        const tinderOnly = prev.filter((c) => c.type === "tinder");
        const updatedInsta = rawConversations.map((c: any) => {
          const lastMsgTime = getMessageTimestampMs(c.lastMessageAt || c.lastActive);
          const readTime = readChatTimestampsRef.current[c.id];
          const isRead = c.lastSender === "me" || (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);
          const isRestr = restrictedChatIdsRef.current.has(c.id) || Boolean(c.isRestricted || c.is_restricted);
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
            status: isRestr ? "restricted" : (c.status === "restricted" ? "active" : (c.status || "active")),
          };
        });
        return [...updatedInsta, ...tinderOnly];
      });
    } catch (err) {
      console.error("Erro ao carregar conversas do Instagram:", err);
    } finally {
      isDirectLoadingConvsRef.current = false;
    }
  }, []);

  // Carrega matches reais do Tinder do Supabase / API
  const loadRealTinderMatches = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/tinder/matches"));
      if (res.ok) {
        const data = await res.json();
        if (data.matches) {
          setConversations((prev) => {
            const instagramOnly = prev.filter((c) => c.type === "instagram");
            const updatedTinder = data.matches.map((m: DirectConversation) => {
              const lastMsgTime = getMessageTimestampMs(m.lastMessageAt || m.lastActive);
              const readTime = readChatTimestampsRef.current[m.id];
              const isRead = m.lastSender === "me" || (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);
              const isRestr =
                restrictedChatIdsRef.current.has(m.id) ||
                Boolean(m.isRestricted || m.status === "restricted");
              return {
                ...m,
                isRestricted: isRestr,
                status: isRestr ? "restricted" : (m.status === "restricted" ? "active" : (m.status || "active")),
                unread: isRead ? false : Boolean(m.unread),
              };
            });
            return [...instagramOnly, ...updatedTinder];
          });
          setActiveChat((prev) => {
            if (!prev || prev.type !== "tinder") return prev;
            const fresh = data.matches.find((m: DirectConversation) => m.id === prev.id);
            if (!fresh) return prev;
            const lastMsgTime = getMessageTimestampMs(fresh.lastMessageAt || fresh.lastActive);
            const readTime = readChatTimestampsRef.current[fresh.id];
            const isRead = fresh.lastSender === "me" || (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);
            const isRestr =
              restrictedChatIdsRef.current.has(fresh.id) ||
              Boolean(fresh.isRestricted || fresh.status === "restricted");
            return {
              ...prev,
              ...fresh,
              isRestricted: isRestr,
              status: isRestr ? "restricted" : (fresh.status === "restricted" ? "active" : (fresh.status || "active")),
              unread: isRead ? false : Boolean(fresh.unread),
            };
          });
        }
      }
    } catch (err) {
      console.error("Erro ao carregar matches reais do Tinder:", err);
    }
  }, []);

  // Atualiza referência atômica para o ID do chat ativo
  activeChatIdRef.current = activeChat?.id || null;

  // -------------------------------------------------------------
  // SUPABASE REALTIME (WEBSOCKET): Latência Zero (< 50ms)
  // -------------------------------------------------------------
  const handleRealtimeInstagramMessage = useCallback((msg: RealtimeMessagePayload & { media_url?: string; media_type?: string }) => {
    let text = msg.text || "";
    let mediaUrl = msg.mediaUrl || msg.media_url;
    let mediaType = (msg.mediaType || msg.media_type) as "image" | "audio" | "video" | undefined;

    if (!mediaUrl && text) {
      const audioMatch = text.match(/^\[audio:(https?:\/\/[^\]]+)\]$/);
      const imageMatch = text.match(/^\[image:(https?:\/\/[^\]]+)\](?:\s*(.*))?$/);
      if (audioMatch) {
        mediaUrl = audioMatch[1];
        mediaType = "audio";
        text = "🎙️ Mensagem de voz";
      } else if (imageMatch) {
        mediaUrl = imageMatch[1];
        mediaType = "image";
        text = imageMatch[2] || "📷 Foto";
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
      text: text || (mediaType === "audio" ? "🎙️ Mensagem de voz" : mediaType === "image" ? "📷 Foto" : ""),
      mediaUrl,
      mediaType,
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

        // Dispara notificação móvel no celular ou computador
        const senderName =
          (msg as any).sender_name ||
          conversations.find((c) => c.id === msg.conversationId)?.fullName ||
          "Instagram Direct";
        mobileNotificationsRef.current?.notifyClientMessage(
          senderName,
          msg.text || (msg.mediaType === "audio" ? "🎙️ Mensagem de voz" : "Nova mensagem recebida"),
          msg.conversationId
        );
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
      setTimeout(() => scrollToBottom("smooth"), 50);
    }
  }, []);

  const handleRealtimeInstagramConversationUpdate = useCallback((conv: {
    id: string;
    lastMessage?: string;
    lastMessageAt?: string;
    lastDirection?: string;
    lastStatus?: string;
    seenAt?: string;
    unread?: boolean;
    fullName?: string;
    username?: string;
    avatar?: string;
  }) => {
    if (!conv.id || conv.id.startsWith("__")) return;

    const isSentByMe = conv.lastDirection === "out" || conv.lastDirection === "outbound";
    const isCurrentActive = activeChatIdRef.current === conv.id;

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

      if (incomingTimestamp > latestKnownTimestamp) {
        void fetchConversationMessages(conv.id);
      }
    }

    if (!isSentByMe && !isCurrentActive) {
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

    setConversations((prevConvs) => {
      const idx = prevConvs.findIndex((c) => c.id === conv.id);
      if (idx === -1) return prevConvs;
      const target = prevConvs[idx];
      const rawPreview = conv.lastMessage || target.lastMessage || "";
      const cleanPreview = rawPreview.startsWith("Você: ") ? rawPreview.replace(/^Você:s*/, "") : rawPreview;
      const formattedPreview = isSentByMe ? `Você: ${cleanPreview}` : cleanPreview;
      const timeFormatted = formatMessageTime(conv.lastMessageAt || target.lastActive);

      const isRead = isSentByMe || isCurrentActive;
      const updatedUnread = isRead ? false : (conv.unread !== undefined ? Boolean(conv.unread) : true);

      const updated: DirectConversation = {
        ...target,
        fullName: conv.fullName || target.fullName,
        username: conv.username || target.username,
        avatar: conv.avatar || target.avatar,
        lastMessage: formattedPreview,
        lastMessageAt: conv.lastMessageAt || target.lastMessageAt,
        lastSender: isSentByMe ? "me" : "them",
        lastStatus: conv.lastStatus !== undefined
          ? conv.lastStatus
          : (isSentByMe ? "sent" : target.lastStatus),
        seenAt: conv.seenAt !== undefined
          ? conv.seenAt
          : (isSentByMe ? undefined : target.seenAt),
        lastActive: timeFormatted,
        unread: updatedUnread,
      };

      const others = prevConvs.filter((c) => c.id !== conv.id);
      return [updated, ...others];
    });
  }, [fetchConversationMessages]);

  // Handler de INSERT de nova conversa via Realtime — adiciona incrementalmente à lista sem full fetch
  const handleRealtimeInstagramConversationInsert = useCallback((conv: {
    id: string;
    lastMessage?: string;
    lastMessageAt?: string;
    lastDirection?: string;
    unread?: boolean;
    fullName?: string;
    username?: string;
    avatar?: string;
  }) => {
    if (!conv.id || conv.id.startsWith("__")) return;

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

  const handleRealtimeTinderMessage = useCallback((msg: RealtimeMessagePayload) => {
    const isActuallyMine =
      msg.isMine ||
      msg.senderId === "me" ||
      Boolean(
        tinderSessionRef.current?.profile?.id &&
          msg.senderId === tinderSessionRef.current.profile.id
      );

    const formatted: DirectMessage = {
      id: msg.id,
      senderId: isActuallyMine ? "me" : msg.senderId,
      text: msg.text,
      createdAt: formatMessageTime(msg.timestamp),
      timestamp: msg.timestamp ? getMessageTimestampMs(msg.timestamp) : Date.now(),
      sentDate: msg.timestamp
        ? typeof msg.timestamp === "string"
          ? msg.timestamp
          : new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      isMine: isActuallyMine,
      status: (msg.status as any) || "sent",
      deliverAt: msg.status === "sent" ? undefined : (msg.deliverAt || undefined),
      delaySeconds: msg.status === "sent" ? undefined : (msg.delaySeconds || undefined),
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
      const merged = deduplicateMessages([...baseList, formatted]);
      return {
        ...prev,
        [msg.conversationId]: merged,
      };
    });

    setConversations((prevConvs) => {
      const found = prevConvs.find((c) => c.id === msg.conversationId);
      if (!found) return prevConvs;
      const timeFormatted = formatMessageTime(msg.timestamp);
      const updated: DirectConversation = {
        ...found,
        lastMessage: isActuallyMine ? `Você: ${msg.text}` : msg.text,
        lastSender: isActuallyMine ? "me" : "them",
        lastActive: timeFormatted,
        lastMessageAt: msg.timestamp,
        unread: activeChatIdRef.current === msg.conversationId ? false : !isActuallyMine,
      };
      const others = prevConvs.filter((c) => c.id !== msg.conversationId);
      return [updated, ...others];
    });

    if (!isActuallyMine) {
      autoPilotRef.current?.registerClientMessage(msg.conversationId, msg.timestamp);
      if (activeChatIdRef.current !== msg.conversationId) {
        const found = conversations.find((c) => c.id === msg.conversationId);
        mobileNotificationsRef.current?.notifyClientMessage(
          found?.fullName || "Match no Tinder",
          msg.text || "Nova mensagem recebida",
          msg.conversationId
        );
      }
    }

    if (activeChatIdRef.current === msg.conversationId) {
      setTimeout(() => scrollToBottom("smooth"), 50);
    }
  }, []);

  const handleRealtimeTinderConversationUpdate = useCallback((conv: {
    id: string;
    lastMessage?: string;
    lastMessageAt?: string;
    lastDirection?: string;
  }) => {
    setConversations((prevConvs) => {
      const idx = prevConvs.findIndex((c) => c.id === conv.id);
      if (idx === -1) return prevConvs;
      const target = prevConvs[idx];
      const isSentByMe = conv.lastDirection === "outbound" || conv.lastDirection === "out";
      const rawPreview = conv.lastMessage || target.lastMessage || "";
      const cleanPreview = rawPreview.startsWith("Você: ") ? rawPreview.replace(/^Você:\s*/, "") : rawPreview;
      const formattedPreview = isSentByMe ? `Você: ${cleanPreview}` : cleanPreview;
      const timeFormatted = formatMessageTime(conv.lastMessageAt || target.lastActive);


      const updated: DirectConversation = {
        ...target,
        lastMessage: formattedPreview,
        lastMessageAt: conv.lastMessageAt || target.lastMessageAt,
        lastSender: isSentByMe ? "me" : "them",
        lastActive: timeFormatted,
        unread: activeChatIdRef.current === conv.id ? false : target.unread,
      };

      const others = prevConvs.filter((c) => c.id !== conv.id);
      return [updated, ...others];
    });
  }, []);

  const { isRealtimeConnected } = useChatRealtime({
    onInstagramMessage: handleRealtimeInstagramMessage,
    onInstagramConversationUpdate: handleRealtimeInstagramConversationUpdate,
    onInstagramConversationInsert: handleRealtimeInstagramConversationInsert,
    onInstagramSeen: handleRealtimeInstagramSeen,
    onTinderMessage: handleRealtimeTinderMessage,
    onTinderConversationUpdate: handleRealtimeTinderConversationUpdate,
    onAutoPilotStateUpdate: autoPilot.applyRemoteStateUpdate,
    tinderUserId: tinderSession?.profile?.id,
  });

  // Sincroniza saúde do Realtime para suprimir polling de fallback do AutoPilot
  useEffect(() => {
    setIsRealtimeHealthyForAutopilot(isRealtimeConnected);
  }, [isRealtimeConnected]);

  // Refs de controle de presença de Realtime e in-flight dedup para os pollings
  const isRealtimeConnectedRef = useRef<boolean>(true);
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
    Promise.all([
      loadInstagramConversations(),
      checkInstagramStatus(),
      fetch(getApiUrl("/api/tinder/status"))
        .then((r) => r.json())
        .then((data) => {
          if (data.isConnected) {
            setTinderSession({
              token: data.token || "",
              isConnected: true,
              profile: data.profile,
            });
            return loadRealTinderMatches();
          } else {
            setTinderSession(null);
          }
        }),
    ])
      .catch((e) => console.error("Erro na carga inicial do chat:", e))
      .finally(() => setIsLoadingList(false));
  }, [loadInstagramConversations, loadRealTinderMatches, checkInstagramStatus]);

  // Sincroniza ao mudar de plataforma
  useEffect(() => {
    if (chatPlatform === "tinder") {
      loadRealTinderMatches();
    } else {
      loadInstagramConversations();
    }
  }, [chatPlatform, loadInstagramConversations, loadRealTinderMatches]);

  // Scroll automático ao abrir chat
  useEffect(() => {
    if (activeChat) {
      scrollToBottom("auto");
    }
  }, [activeChat?.id]);

  // Scroll suave quando o histórico de mensagens do chat ativo atualiza
  useEffect(() => {
    if (activeChat) {
      scrollToBottom("smooth");
    }
  }, [messages[activeChat?.id || ""]?.length]);

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
        const endpoint = getApiUrl(
          activeChat.type === "tinder"
            ? `/api/tinder/messages/${activeChat.id}`
            : `/api/instagram/messages/${activeChat.id}`
        );

        const res = await fetch(endpoint);

        if (!res.ok) {
          consecutiveChatFailuresRef.current += 1;
        } else {
          consecutiveChatFailuresRef.current = 0;

          if (!isSubscribed) return;
          const data = await res.json();
          const incomingMessages: DirectMessage[] = data?.messages || [];

          // Enriquecimento com vínculos e transcrições do Supabase — limitado às últimas 48h
          let enrichedIncoming = incomingMessages;
          try {
            const supabase = getSupabaseBrowserClient();
            if (supabase && activeChat.type !== "tinder") {
              const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
              const { data: dbRows } = await supabase
                .from("instagram_messages")
                .select("id, reply_to_message_id, audio_transcript, timestamp")
                .or(`conversation_id.eq.${activeChat.id},contact_id.eq.${activeChat.id}`)
                .gte("created_at", cutoff)
                .limit(150);

              if (dbRows && dbRows.length > 0) {
                const dbReplyMap = new Map<string, string>();
                const dbAudioMap = new Map<string, string>();
                const dbTimeMap = new Map<string, string>();
                for (const r of dbRows) {
                  if (r.reply_to_message_id) dbReplyMap.set(r.id, r.reply_to_message_id);
                  if (r.audio_transcript) dbAudioMap.set(r.id, r.audio_transcript);
                  if (r.timestamp) dbTimeMap.set(r.id, r.timestamp);
                }
                enrichedIncoming = incomingMessages.map((sm) => {
                  const rId = dbReplyMap.get(sm.id) || sm.replyToMessageId;
                  const aTranscript = dbAudioMap.get(sm.id) || sm.audioTranscript;
                  const dbTs = dbTimeMap.get(sm.id);
                  return {
                    ...sm,
                    timestamp: sm.timestamp || (dbTs ? getMessageTimestampMs(dbTs) : undefined),
                    sentDate: sm.sentDate || dbTs,
                    replyToMessageId: rId,
                    audioTranscript: aTranscript,
                  };
                });
              }
            }
          } catch {}

          setMessages((prev) => {
            const current = prev[activeChat.id] || [];

            const pendingMessages = current.filter(
              (m) => m.status === "sending" || m.status === "failed"
            );

            const serverMessages: DirectMessage[] = enrichedIncoming.map((m) => ({
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
        }
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
  }, [activeChat]);
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
        const endpoint = getApiUrl(
          chatPlatform === "tinder" ? "/api/tinder/matches" : "/api/instagram/conversations"
        );

        const res = await fetch(endpoint);

        if (!res.ok) {
          consecutiveListFailuresRef.current += 1;
        } else {
          consecutiveListFailuresRef.current = 0;
          if (!isSubscribed) return;
          const data = await res.json();

          if (chatPlatform === "tinder" && data?.matches && isSubscribed) {
            setConversations((prev) => {
              const instagramOnly = prev.filter((c) => c.type === "instagram");
              const mergedTinder = data.matches.map((remoteMatch: DirectConversation) => {
                const local = prev.find((c) => c.id === remoteMatch.id);
                const isRestr =
                  restrictedChatIdsRef.current.has(remoteMatch.id) ||
                  Boolean(local?.isRestricted || remoteMatch.isRestricted || remoteMatch.status === "restricted");
                const lastMsgTime = getMessageTimestampMs(remoteMatch.lastMessageAt || remoteMatch.lastActive);
                const readTime = readChatTimestampsRef.current[remoteMatch.id];
                const isRead =
                  remoteMatch.lastSender === "me" ||
                  (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);

                let merged: DirectConversation = {
                  ...remoteMatch,
                  isRestricted: isRestr,
                  status: isRestr ? "restricted" : (remoteMatch.status === "restricted" ? "active" : (remoteMatch.status || "active")),
                  unread: isRead ? false : Boolean(remoteMatch.unread),
                };

                if (local && local.lastSender === "me") {
                  const localTime = local.lastMessageAt ? new Date(local.lastMessageAt).getTime() : 0;
                  const remoteTime = remoteMatch.lastMessageAt ? new Date(remoteMatch.lastMessageAt).getTime() : 0;
                  if (localTime >= remoteTime) {
                    return { ...merged, ...local, isRestricted: isRestr, status: merged.status };
                  }
                }
                return merged;
              });
              return [...instagramOnly, ...mergedTinder];
            });
          } else if (chatPlatform === "instagram" && data?.conversations && isSubscribed) {
            setConversations((prev) => {
              const tinderOnly = prev.filter((c) => c.type === "tinder");
              const validRemoteConvs = (data.conversations as DirectConversation[]).filter(
                (c: any) => !c.id?.startsWith("__") && c.status !== "system" && c.status !== "vault"
              );
              const mergedInstagram = validRemoteConvs.map((remoteConv: DirectConversation) => {
                const local = prev.find((c) => c.id === remoteConv.id);
                const isRestr =
                  restrictedChatIdsRef.current.has(remoteConv.id) ||
                  Boolean(local?.isRestricted || remoteConv.isRestricted);
                const lastMsgTime = getMessageTimestampMs(remoteConv.lastMessageAt || remoteConv.lastActive);
                const readTime = readChatTimestampsRef.current[remoteConv.id];
                const isRead =
                  remoteConv.lastSender === "me" ||
                  (readTime && lastMsgTime > 0 && lastMsgTime <= readTime);

                let merged: DirectConversation = {
                  ...remoteConv,
                  isRestricted: isRestr,
                  status: isRestr ? "restricted" : (remoteConv.status === "restricted" ? "active" : (remoteConv.status || "active")),
                  unread: isRead ? false : Boolean(remoteConv.unread),
                };

                if (local && local.lastSender === "me") {
                  const localTime = local.lastMessageAt ? new Date(local.lastMessageAt).getTime() : 0;
                  const remoteTime = remoteConv.lastMessageAt ? new Date(remoteConv.lastMessageAt).getTime() : 0;
                  if (localTime >= remoteTime) {
                    const shouldKeepRemoteIdentity =
                      local.username.startsWith("ig_") && !remoteConv.username.startsWith("ig_");
                    merged = {
                      ...merged,
                      ...local,
                      username: shouldKeepRemoteIdentity ? remoteConv.username : (local.username || remoteConv.username),
                      fullName: shouldKeepRemoteIdentity ? remoteConv.fullName : (local.fullName || remoteConv.fullName),
                      avatar:
                        shouldKeepRemoteIdentity || !local.avatar || local.avatar.includes("default-avatar")
                          ? remoteConv.avatar
                          : local.avatar,
                      isRestricted: isRestr,
                    };
                  }
                }
                return merged;
              });
              return [...mergedInstagram, ...tinderOnly];
            });
          }
        }
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
  }, [activeChat, chatPlatform]);
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

    // Auto-check do item na barra de etapas se pertencer à etapa ativa (apenas Instagram)
    if (activeChat.type === "instagram") {
      void markItemCompletedByVaultItem(item.id);
    }

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

    setTimeout(() => scrollToBottom("smooth"), 40);

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
      const endpoint = getApiUrl(
        activeChat.type === "tinder"
          ? `/api/tinder/messages/${activeChat.id}`
          : `/api/instagram/messages/${activeChat.id}`
      );

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
  const sendMessageWithText = async (textToSend: string) => {
    if (!textToSend.trim() || !activeChat) return;

    const messageText = textToSend.trim();
    if (activeChat.type === "instagram") {
      void markItemCompletedByExactText(messageText);
    }
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
          text: replyingToMessage.text || (replyingToMessage.mediaType === "audio" ? "🎙️ Mensagem de voz" : replyingToMessage.mediaType === "image" ? "📷 Foto" : "Mensagem"),
        }
      : undefined;

    setReplyingToMessage(null);

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
    setTimeout(() => scrollToBottom("smooth"), 40);

    // 3. Dispara no endpoint correspondente (Instagram ou Tinder) com payload estruturado de mídia
    try {
      const endpoint = getApiUrl(
        activeChat.type === "tinder"
          ? `/api/tinder/messages/${activeChat.id}`
          : `/api/instagram/messages/${activeChat.id}`
      );

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

      // Persistência direta no Supabase para garantir salvamento do reply_to_message_id
      if (currentReply?.id) {
        try {
          const supabase = getSupabaseBrowserClient();
          if (supabase && activeChat.type !== "tinder") {
            console.log("💾 [Instagram Reply - UI] Gravando reply_to_message_id no Supabase:", {
              messageId: confirmedMid,
              replyToMessageId: currentReply.id,
            });
            await supabase
              .from("instagram_messages")
              .update({ reply_to_message_id: currentReply.id })
              .eq("id", confirmedMid);
          }
        } catch (dbUpdErr) {
          console.warn("⚠️ [Instagram Reply - UI] Falha ao persistir reply_to_message_id no Supabase:", dbUpdErr);
        }
      }

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

      const endpoint = getApiUrl(
        activeChat.type === "tinder"
          ? `/api/tinder/messages/${activeChat.id}`
          : `/api/instagram/messages/${activeChat.id}`
      );

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          text: textToSend,
          audioUrl: audioUrlToSend,
          mediaUrl: failedMsg.mediaType === "image" ? failedMsg.mediaUrl : undefined,
          mediaType: failedMsg.mediaType,
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

  // Disparo sequencial humanizado de mensagens geradas pela IA (com conferência de fila agendada prévia)
  const handleSendMultipleMessages = async (texts: string[]) => {
    if (!activeChat || texts.length === 0) return;

    const nowMs = Date.now();
    const queue = getScheduledQueueInfo(activeChat.id);
    const initialWaitSeconds = queue.hasScheduled ? queue.remainingSeconds : 0;
    let cumulativeDelay = initialWaitSeconds;
    const newMessages: DirectMessage[] = [];

    // Calcula a cadência de cada balão antecipadamente (áudio = duração do áudio, texto = 10s)
    const cadences: number[] = [];
    for (const t of texts) {
      cadences.push(await getMessageCadenceSeconds(t));
    }

    for (let i = 0; i < texts.length; i++) {
      const trimmed = texts[i].trim();
      if (!trimmed) continue;

      // O 1º balão soma sua cadência à fila anterior (se houver), e os seguintes somam as suas
      cumulativeDelay += cadences[i];
      const delaySeconds = cumulativeDelay;
      const deliverAt = nowMs + delaySeconds * 1000;
      const scheduledTime = new Date(deliverAt);
      const tempId = `temp-ai-${nowMs}-${i}`;

      const isAudioMsg = trimmed.startsWith("[audio:");
      const isImageMsg = trimmed.startsWith("[image:");
      const audioUrl = isAudioMsg ? trimmed.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;
      const imageUrl = isImageMsg ? trimmed.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1] : undefined;

      const newMsg: DirectMessage = {
        id: tempId,
        senderId: "me",
        text: trimmed,
        mediaType: isAudioMsg ? "audio" : isImageMsg ? "image" : undefined,
        mediaUrl: audioUrl || imageUrl,
        audioTranscript: isAudioMsg ? "🎙️ Mensagem de voz" : undefined,
        createdAt: formatMessageTime(scheduledTime),
        timestamp: scheduledTime.getTime(),
        sentDate: scheduledTime.toISOString(),
        isMine: true,
        status: "sending",
        deliverAt,
        delaySeconds,
      };

      newMessages.push(newMsg);
      latestScheduledDeliverAtRef.current[activeChat.id] = deliverAt;
    }

    if (newMessages.length === 0) return;

    // Atualiza o estado da conversa com todos os balões visíveis
    setMessages((prev) => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), ...newMessages],
    }));

    // Atualiza a prévia da última mensagem na lista de conversas
    const lastMsg = newMessages[newMessages.length - 1];
    const previewText =
      lastMsg.mediaType === "audio"
        ? "🎙️ Mensagem de voz"
        : lastMsg.mediaType === "image"
        ? "📷 Foto"
        : lastMsg.text;

    setConversations((prev) => {
      const others = prev.filter((c) => c.id !== activeChat.id);
      const updated: DirectConversation = {
        ...activeChat,
        lastMessage: `Você: ${previewText}`,
        lastActive: lastMsg.createdAt || "Agora",
        lastMessageAt: lastMsg.sentDate,
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
            lastActive: lastMsg.createdAt || "Agora",
            lastMessageAt: lastMsg.sentDate,
            unread: false,
            lastSender: "me",
            lastStatus: "sent",
            seenAt: undefined,
            isNewMatch: false,
          }
        : null
    );

    setTimeout(() => scrollToBottom("smooth"), 40);

    const firstDeliveryDelay = initialWaitSeconds + cadences[0];
    if (queue.hasScheduled) {
      toast.success(
        `${newMessages.length} mensagem(ns) da IA na fila! 1ª enviando em ${firstDeliveryDelay}s (após as mensagens agendadas).`,
        { duration: 4000 }
      );
    } else if (newMessages.length > 1) {
      toast.success(
        `${newMessages.length} mensagens no chat! 1ª enviando em ${cadences[0]}s e as seguintes em sequência.`,
        { duration: 4000 }
      );
    } else {
      toast.success(
        `Mensagem agendada! Enviando em ${cadences[0]}s com digitação humana.`,
        { duration: 4000 }
      );
    }

    // 2. Dispara IMEDIATAMENTE todos os balões para o Backend com seus respectivos delaySeconds calculados.
    // O Backend assume a custódia do envio em background (EdgeRuntime.waitUntil / servidor).
    // O usuário PODE FECHAR A ABA DO NAVEGADOR IMEDIATAMENTE e todas as mensagens serão enviadas rigorosamente no tempo previsto!
    const targetChatId = activeChat.id;
    const endpoint = getApiUrl(
      activeChat.type === "tinder"
        ? `/api/tinder/messages/${activeChat.id}`
        : `/api/instagram/messages/${activeChat.id}`
    );

    void Promise.all(
      newMessages.map(async (targetMsg) => {
        try {
          const isAudio = Boolean(targetMsg.mediaType === "audio" || targetMsg.text.startsWith("[audio:"));
          const isImage = Boolean(targetMsg.mediaType === "image" || targetMsg.text.startsWith("[image:"));
          const audioUrl = isAudio
            ? targetMsg.mediaUrl || targetMsg.text.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1]
            : undefined;
          const mediaUrl = isImage
            ? targetMsg.mediaUrl || targetMsg.text.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1]
            : undefined;

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: targetMsg.text,
              text: targetMsg.text,
              audioUrl,
              mediaUrl,
              mediaType: isAudio ? "audio" : isImage ? "image" : undefined,
              delaySeconds: targetMsg.delaySeconds,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const confirmedId = data?.message?.id || data?.id || targetMsg.id;
            const isQueued = Boolean(data?.queued || (targetMsg.delaySeconds && targetMsg.delaySeconds > 0));
            setMessages((prev) => ({
              ...prev,
              [targetChatId]: (prev[targetChatId] || []).map((m) =>
                m.id === targetMsg.id
                  ? {
                      ...m,
                      id: confirmedId,
                      status: isQueued ? "sending" : "sent",
                      deliverAt: isQueued ? targetMsg.deliverAt : undefined,
                    }
                  : m
              ),
            }));
          } else {
            const errJson = await res.json().catch(() => ({}));
            toast.error(errJson?.error || "Falha ao enviar mensagem.");
            setMessages((prev) => ({
              ...prev,
              [targetChatId]: (prev[targetChatId] || []).map((m) =>
                m.id === targetMsg.id ? { ...m, status: "failed", deliverAt: undefined } : m
              ),
            }));
          }
        } catch {
          setMessages((prev) => ({
            ...prev,
            [targetChatId]: (prev[targetChatId] || []).map((m) =>
              m.id === targetMsg.id ? { ...m, status: "failed", deliverAt: undefined } : m
            ),
          }));
        }
      })
    );
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
    setActiveChat(null);
    setReplyingToMessage(null);
    onChatOpenChange?.(false);

    if (chatPlatform === "instagram") {
      loadInstagramConversations();
    } else {
      loadRealTinderMatches();
    }

    // Restaura a posição exata de rolagem da lista
    requestAnimationFrame(() => {
      if (conversationsScrollRef.current && savedScrollTopRef.current > 0) {
        conversationsScrollRef.current.scrollTop = savedScrollTopRef.current;
      }
    });
  }, [chatPlatform, loadInstagramConversations, loadRealTinderMatches, markConversationAsReadLocally, onChatOpenChange]);

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
    // 1. Salva a posição atual de rolagem da lista de conversas
    if (conversationsScrollRef.current) {
      savedScrollTopRef.current = conversationsScrollRef.current.scrollTop;
    }

    // 2. Marca a conversa como lida e aberta imediatamente
    markConversationAsReadLocally(conv.id);

    setActiveChat(conv);
    setReplyingToMessage(null);
    onChatOpenChange?.(true);

    // 3. Registra no histórico do navegador para interceptar o botão/gesto voltar
    if (typeof window !== "undefined") {
      if (!isPushedToHistoryRef.current) {
        window.history.pushState({ vendeoChatOpen: true, chatId: conv.id }, "");
        isPushedToHistoryRef.current = true;
      } else {
        window.history.replaceState({ vendeoChatOpen: true, chatId: conv.id }, "");
      }
    }

    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread: false } : c))
    );

    // 4. Sincroniza marcação de leitura com o banco Supabase imediatamente (< 50ms)
    const supabase = getSupabaseBrowserClient();
    if (supabase && conv.type === "instagram") {
      supabase
        .from("instagram_conversations")
        .update({ unread: false, updated_at: new Date().toISOString() })
        .eq("id", conv.id)
        .then(() => {});
    }

    if (conv.type === "instagram") {
      fetch(getApiUrl(`/api/instagram/conversations/${conv.id}/read`), {
        method: "POST",
      }).catch(() => {});
    }

    // Ativa esqueleto de mensagens caso não haja cache local prévio
    const cached = messages[conv.id];
    if (!cached || cached.length === 0) {
      setIsLoadingMessages(true);
    }

    // Carrega mensagens do Supabase/API
    const endpoint = getApiUrl(
      conv.type === "tinder"
        ? `/api/tinder/messages/${conv.id}`
        : `/api/instagram/messages/${conv.id}?sync=true`
    );

    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          let formatted: DirectMessage[] = data.messages.map((m: DirectMessage) => ({
            ...m,
            status: m.status || "sent",
          }));

          // Enriquecimento direto via Supabase Client (blindagem contra backends remotos desatualizados)
          try {
            const supabase = getSupabaseBrowserClient();
            if (supabase && conv.type !== "tinder") {
              const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
              const { data: dbRows, error: dbErr } = await supabase
                .from("instagram_messages")
                .select("id, reply_to_message_id, audio_transcript, timestamp")
                .or(`conversation_id.eq.${conv.id},contact_id.eq.${conv.id}`)
                .gte("created_at", cutoff)
                .limit(150);

              if (dbRows && dbRows.length > 0) {
                const replyMap = new Map<string, string>();
                const audioMap = new Map<string, string>();
                const timeMap = new Map<string, string>();
                for (const r of dbRows) {
                  if (r.reply_to_message_id) {
                    replyMap.set(r.id, r.reply_to_message_id);
                  }
                  if (r.audio_transcript) {
                    audioMap.set(r.id, r.audio_transcript);
                  }
                  if (r.timestamp) {
                    timeMap.set(r.id, r.timestamp);
                  }
                }
                formatted = formatted.map((m) => {
                  const rId = replyMap.get(m.id) || m.replyToMessageId;
                  const aTranscript = audioMap.get(m.id) || m.audioTranscript;
                  const dbTs = timeMap.get(m.id);
                  return {
                    ...m,
                    timestamp: m.timestamp || (dbTs ? getMessageTimestampMs(dbTs) : undefined),
                    sentDate: m.sentDate || dbTs,
                    replyToMessageId: rId,
                    audioTranscript: aTranscript,
                  };
                });
              }
            }
          } catch (enrichErr) {
            console.warn("⚠️ [Instagram Reply - UI] Aviso ao enriquecer replies e transcrições do Supabase:", enrichErr);
          }

          formatted.sort((a, b) => {
            const tA = getMessageTimestampMs((a as any).timestamp || a.createdAt || a.sentDate);
            const tB = getMessageTimestampMs((b as any).timestamp || b.createdAt || b.sentDate);
            return tA - tB;
          });

          setMessages((prev) => ({
            ...prev,
            [conv.id]: formatted,
          }));

          // Se a lista de mensagens vier vazia no Instagram, aciona sync em background para garantir busca de mensagens pendentes/restringidas
          if (formatted.length === 0 && conv.type === "instagram") {
            fetch(getApiUrl("/api/instagram/sync"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: conv.id }),
            })
              .then((sRes) => sRes.json())
              .then(async (sData) => {
                if (sData.success) {
                  const retryRes = await fetch(endpoint);
                  if (retryRes.ok) {
                    const retryJson = await retryRes.json();
                    if (retryJson.messages && retryJson.messages.length > 0) {
                      setMessages((prev) => ({
                        ...prev,
                        [conv.id]: retryJson.messages,
                      }));
                    }
                  }
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
    } finally {
      setIsLoadingMessages(false);
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

  // FILTRAGEM DE CONVERSAS BASEADA NA ABA ATIVA E NO FILTRO ESCOLHIDO
  const isFilterActive =
    sortOrder !== "recentes" ||
    (chatPlatform === "instagram" && instaFilter !== "todos") ||
    (chatPlatform === "tinder" && tinderFilter !== "todos");

  const platformConversations = conversations.filter(
    (c) =>
      c.type === chatPlatform &&
      !c.id?.startsWith("__") &&
      c.status !== "system" &&
      c.status !== "vault"
  );

  // Contadores para badges e sub-filtros de Pedidos e Restringidos
  const pedidosCount = platformConversations.filter(
    (c) => isChatRestricted(c) || c.status === "pending"
  ).length;

  const restringidosCount = platformConversations.filter(
    (c) => isChatRestricted(c)
  ).length;

  const tinderRestritosCount = platformConversations.filter(
    (c) => isChatRestricted(c)
  ).length;

  const filteredConversations = platformConversations
    .filter((c) => {
      // Filtros do Instagram: Todos, Não respondidos, Respondidos e Pedidos
      if (chatPlatform === "instagram") {
        const isRestr = isChatRestricted(c);
        const isRestrictedOrPending = Boolean(
          isRestr || c.status === "pending"
        );

        // Aba PEDIDOS: reúne pedidos de novas mensagens e contas restringidas
        if (instaFilter === "pedidos") {
          if (pedidosSubFilter === "restringidos") {
            return isRestr;
          }
          // todos_pedidos
          return isRestrictedOrPending;
        }

        // Para abas principais (todos, respondidos, nao_respondidos):
        // Contas restringidas e pedidos pendentes NUNCA aparecem na caixa principal! (Oficial Instagram)
        if (isRestrictedOrPending) {
          return false;
        }

        if (instaFilter === "respondidos") return c.lastSender === "me";
        if (instaFilter === "nao_respondidos") return c.lastSender === "them" || isConversationUnread(c);
        return true; // todos
      }

      // Filtros do Tinder: matchs novos / sua vez / vez deles / restritos
      if (chatPlatform === "tinder") {
        const isRestr = isChatRestricted(c);

        if (tinderFilter === "restritos") {
          return isRestr;
        }

        // Matches restritos não aparecem nas abas comuns (todos, novos, sua_vez, vez_deles)
        if (isRestr) {
          return false;
        }

        if (tinderFilter === "novos") return c.isNewMatch;
        if (tinderFilter === "sua_vez") return c.lastSender === "them" && !c.isNewMatch;
        if (tinderFilter === "vez_deles") return c.lastSender === "me";
        return true; // todos
      }

      return true;
    })
    .filter((c) => {
      // Filtragem por etapa do funil (Check-ups) é exclusiva do Instagram Direct.
      if (chatPlatform !== "instagram") return true;

      if (stageFilter === "concluidos") {
        return Boolean(allProgresses[c.id]?.isConverted);
      }
      if (stageFilter !== "todas") {
        const progress = allProgresses[c.id];
        const currentStageId = progress?.currentStageId || (stages.length > 0 ? stages[0].id : "");
        return currentStageId === stageFilter && !progress?.isConverted;
      }
      return true;
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

    if (sortOrder === "antigas") {
      return timeA - timeB;
    }
    return timeB - timeA;
  });

  // 1. RENDERIZADOR DA TELA DE CONVERSA ABERTA (CHAT THREAD EM CAMADA SOBREPOSTA)
  const activeChatMessagesRaw = activeChat ? messages[activeChat.id] : undefined;
  const chatMessages = useMemo(() => {
    if (!activeChat || !activeChatMessagesRaw || activeChatMessagesRaw.length === 0) return [];
    const rawChatMessages = deduplicateMessages(activeChatMessagesRaw);
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
              ? (quoted.text || (quoted.mediaType === "audio" ? "🎙️ Mensagem de voz" : "📷 Foto"))
              : "Mensagem respondida",
          },
        };
      }
      return msg;
    });
  }, [activeChat, activeChatMessagesRaw]);
  const isTinderChat = activeChat?.type === "tinder";

  const renderChatThread = () => {
    if (!activeChat) return null;

    return (
      <div className="absolute inset-0 z-30 flex flex-col h-full w-full bg-black text-white overflow-hidden animate-in fade-in duration-150">
        {/* Header do Chat */}
        <div className="h-14 px-3.5 border-b border-[#262626] flex items-center justify-between bg-black shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCloseChat}
              className="text-white hover:opacity-70 active:scale-90 transition-all cursor-pointer p-1"
              aria-label="Voltar para lista de conversas"
            >
              <ArrowLeft className="w-6 h-6 stroke-[2.2]" />
            </button>

            {/* Clique no avatar ou nome para abrir o perfil completo estilo Tinder */}
            <div
              onClick={() => {
                setSelectedProfileForModal(activeChat);
                setIsProfileModalOpen(true);
              }}
              className="flex items-center gap-3 cursor-pointer group select-none hover:opacity-90 active:scale-98 transition-all"
              title="Toque para ver o perfil completo"
            >
              <AvatarWithFallback
                src={activeChat.avatar}
                alt={activeChat.fullName || activeChat.username}
                sizeClassName="w-9 h-9 group-hover:scale-105 transition-transform"
                ringClassName={isTinderChat ? "ring-2 ring-[#fe3c72]" : ""}
              />

              <div className="leading-tight">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold tracking-tight text-white group-hover:underline">
                    {activeChat.fullName}
                  </span>
                  {isTinderChat && (
                    <Flame className="w-3.5 h-3.5 text-[#fe3c72] fill-[#fe3c72]" />
                  )}
                </div>
                {!isTinderChat ? (
                  <span className="text-[11px] text-[#a8a8a8] block">
                    @{activeChat.username}
                  </span>
                ) : (
                  <span className="text-[10px] text-[#fe3c72]/90 block font-medium">
                    Toque para ver perfil
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Botão de Restringir / Remover Restrição (Instagram e Tinder) */}
            <button
              type="button"
              onClick={() => handleToggleRestricted(activeChat)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95 ${
                activeChat.isRestricted
                  ? isTinderChat
                    ? "bg-[#fe3c72]/20 text-[#fe3c72] border border-[#fe3c72]/40 hover:bg-[#fe3c72]/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-[#1c1c1e] text-[#a8a8a8] hover:text-white border border-[#2e2e30]"
              }`}
              title={
                activeChat.isRestricted
                  ? isTinderChat
                    ? "Remover restrição deste match"
                    : "Remover restrição desta conta"
                  : isTinderChat
                  ? "Restringir match no Tinder"
                  : "Restringir conta no Instagram"
              }
            >
              <ShieldAlert
                className={`w-3.5 h-3.5 ${
                  activeChat.isRestricted
                    ? isTinderChat
                      ? "text-[#fe3c72]"
                      : "text-amber-400"
                    : "text-[#a8a8a8]"
                }`}
              />
              <span className="hidden sm:inline">
                {activeChat.isRestricted
                  ? isTinderChat
                    ? "Restrito"
                    : "Restrita"
                  : "Restringir"}
              </span>
            </button>

            {/* Botão Sincronizar com Instagram oficial */}
            {activeChat.type === "instagram" && (
              <button
                type="button"
                onClick={handleManualSyncChat}
                disabled={isManualSyncing}
                className="px-2.5 py-1.5 rounded-full bg-[#1c1c1e] hover:bg-[#2c2c2e] text-[#a8a8a8] hover:text-white border border-[#2e2e30] text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                title="Sincronizar mensagens recentes com o Instagram oficial"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? "animate-spin text-purple-400" : ""}`} />
                <span className="hidden md:inline">
                  {isManualSyncing ? "Sincronizando..." : "Sincronizar"}
                </span>
              </button>
            )}

            {activeChat.type === "instagram" && (
              <button
                type="button"
                onClick={() => {
                  if (autoPilot.chatStates[activeChat.id]?.isEnabled) {
                    autoPilot.toggleAutoPilotForChat(activeChat.id, false);
                  } else {
                    setIsAutoPilotActivationModalOpen(true);
                  }
                }}
                className={`px-2.5 py-1.5 rounded-full border text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0 ${
                  autoPilot.chatStates[activeChat.id]?.isEnabled
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25"
                    : "bg-[#1c1c1e] text-[#a8a8a8] border-[#2e2e30] hover:text-white hover:bg-[#2c2c2e]"
                }`}
                title={autoPilot.chatStates[activeChat.id]?.isEnabled ? "Desativar IA nesta conversa" : "Ativar IA nesta conversa"}
              >
                <Bot className="w-3.5 h-3.5" />
                <span className="hidden md:inline">
                  {autoPilot.chatStates[activeChat.id]?.isEnabled ? "IA ativa" : "Ativar IA"}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Barra Superior Retrátil da Etapa & Checklist do Funil (Check-ups) - Exclusivo Instagram Direct */}
        {activeChat.type === "instagram" && (
          <ChatStageBar
            detail={chatDetail}
            onToggleItem={toggleItem}
            onToggleObjective={toggleObjective}
            onAdvanceStage={advanceStage}
            onSetStage={setStage}
            onToggleConverted={toggleConverted}
            onQuickSendItem={handleQuickSendChecklistItem}
          />
        )}

        {/* Área de Mensagens */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full px-4 pt-3 pb-6 space-y-2.5 scrollbar-none overscroll-contain">
          {/* Banner de Conversa Restrita (Instagram e Tinder) */}
          {activeChat.isRestricted && (
            <div
              className={`mx-1 mb-2 px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs animate-in fade-in duration-150 select-none ${
                isTinderChat
                  ? "bg-[#fe3c72]/10 border-[#fe3c72]/30 text-[#fe3c72]"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldAlert
                  className={`w-4 h-4 shrink-0 ${
                    isTinderChat ? "text-[#fe3c72]" : "text-amber-400"
                  }`}
                />
                <span>
                  {isTinderChat
                    ? "Este match está restrito. Fica na aba Restritos e não aparece no feed principal."
                    : "Esta conta está restrita. Fica na aba Pedidos."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRestricted(activeChat)}
                className={`text-[11px] font-bold underline cursor-pointer shrink-0 ${
                  isTinderChat
                    ? "text-[#fe3c72] hover:text-white"
                    : "text-amber-400 hover:text-white"
                }`}
              >
                Desrestringir
              </button>
            </div>
          )}

          {/* Banners do Piloto Automático Inteligente */}
          {(() => {
            const currentChatState = autoPilot.chatStates[activeChat.id];
            if (!currentChatState) return null;

            // 1. Banner de Hand-off da Rifa atingida (Alerta de Assunção de Venda)
            if (currentChatState.status === "paused_handoff") {
              return (
                <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-purple-500/15 border-amber-500/40 text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-amber-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <Trophy className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                        🎯 Etapa da Rifa Atingida! Assuma a conversa
                      </h5>
                      <p className="text-[11px] text-zinc-300 mt-0.5 leading-snug">
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
                <div className="mx-1 mb-2.5 p-3.5 rounded-xl border bg-rose-500/15 border-rose-500/40 text-rose-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-rose-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-rose-200 flex items-center gap-1.5">
                        ⚠️ Piloto Automático Pausado por Segurança
                      </h5>
                      <p className="text-[11px] text-zinc-300 mt-0.5 leading-snug">
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
                <div className="mx-1 mb-2 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/35 text-purple-200 text-[11px] flex items-center gap-2 animate-pulse">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>🤖 <strong>Aprovação Pendente:</strong> a IA preparou uma resposta com áudios/textos. Revise e aprove ou edite antes do envio.</span>
                </div>
              );
            }

            return null;
          })()}

          {/* Perfil no Topo */}
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
              sizeClassName="w-20 h-20 group-hover:scale-105 group-active:scale-95 transition-transform"
              ringClassName={isTinderChat ? "ring-3 ring-[#fe3c72]" : ""}
            />
            <div>
              <h3 className="text-base font-bold text-white flex items-center justify-center gap-1.5 group-hover:underline">
                {activeChat.fullName}
                {isTinderChat && (
                  <Flame className="w-4 h-4 text-[#fe3c72] fill-[#fe3c72]" />
                )}
              </h3>
              <p className="text-xs text-[#fe3c72] font-medium">
                {isTinderChat ? "Toque para ver perfil completo" : `@${activeChat.username}`}
              </p>
            </div>
          </div>

          {/* Mensagens do Histórico / Skeleton de Carregamento */}
          {isLoadingMessages && chatMessages.length === 0 ? (
            <ChatMessageSkeletonList count={6} />
          ) : (
            chatMessages.map((msg, index) => {
              const prevMsg = index > 0 ? chatMessages[index - 1] : null;
              const showDateDivider = isDifferentDay(msg, prevMsg);
              const dateLabel = showDateDivider
                ? formatChatDateDivider(msg.timestamp || msg.sentDate || msg.createdAt)
                : null;

              return (
                <React.Fragment key={msg.id}>
                  {/* Divisor de Data Estilo Instagram (Exibido na troca de dia ou início do chat) */}
                  {showDateDivider && dateLabel && (
                    <div className="flex items-center justify-center my-3.5 w-full select-none">
                      <span className="text-[11px] font-medium text-[#8e8e8e] tracking-tight">
                        {dateLabel}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex flex-col ${msg.isMine ? "items-end" : "items-start"} group/msg relative w-full min-w-0 max-w-full`}
                  >
                    <div
                      className={`flex items-end gap-1.5 max-w-[84%] sm:max-w-[75%] min-w-0 ${
                        msg.isMine ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {/* Botão de Responder à mensagem específica (Reply do Instagram - apenas para mensagens do cliente) */}
                      {!msg.isMine && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setAiTargetMessageId(msg.id);
                              setIsAiModalOpen(true);
                            }}
                            className="self-center opacity-75 sm:opacity-0 sm:group-hover/msg:opacity-100 hover:opacity-100 p-1.5 rounded-full hover:bg-amber-500/20 active:bg-amber-500/30 text-amber-400 hover:text-amber-300 transition-all cursor-pointer active:scale-90 shrink-0"
                            title="Gerar resposta com IA para este balão"
                            aria-label="Gerar resposta com IA para este balão"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setReplyingToMessage(msg);
                              setTimeout(() => composerRef.current?.focus(), 60);
                            }}
                            className="self-center opacity-70 sm:opacity-0 sm:group-hover/msg:opacity-100 hover:opacity-100 p-1.5 rounded-full hover:bg-white/10 active:bg-white/20 text-zinc-400 hover:text-white transition-all cursor-pointer active:scale-90 shrink-0"
                            title="Responder a esta mensagem"
                            aria-label="Responder a mensagem"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

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
                        onDoubleClick={() => handleToggleLike(msg.id)}
                        className={`relative rounded-2xl text-sm leading-relaxed transition-all min-w-0 max-w-full break-words [word-break:break-word] [overflow-wrap:anywhere] ${
                          msg.mediaType === "audio" ||
                          msg.text.startsWith("[audio:") ||
                          msg.text.includes("Mensagem de voz") ||
                          msg.text.includes("Áudio") ||
                          msg.text === "📷 Mídia"
                            ? "p-2"
                            : msg.mediaType === "image" ||
                              msg.text.startsWith("[image:") ||
                              msg.text.includes("Mídia compartilhada") ||
                              msg.text.includes("Mídia ou Story") ||
                              msg.text.includes("Foto")
                            ? "p-1.5"
                            : "px-4 py-2.5"
                        } ${
                          msg.isMine
                            ? isTinderChat
                              ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white rounded-br-[4px]"
                              : "bg-[#0095f6] text-white rounded-br-[4px]"
                            : "bg-[#262626] text-white rounded-bl-[4px]"
                        } ${msg.status === "failed" ? "border border-red-500/50 bg-red-950/30" : ""}`}
                      >
                        {/* Bloco de Mensagem Respondida (Quote Reply estilo Instagram) */}
                        {msg.replyTo && (
                          <div
                            className={`mb-2 px-2.5 py-1.5 rounded-lg border-l-2 text-xs flex flex-col text-left min-w-0 max-w-full overflow-hidden ${
                              msg.isMine
                                ? "bg-black/25 border-white/90 text-white/95"
                                : "bg-white/10 border-white/40 text-zinc-200"
                            }`}
                          >
                            <div className="flex items-center gap-1 text-[10px] font-bold text-white/90 min-w-0">
                              <Reply className="w-3 h-3 shrink-0 text-white/70" />
                              <span className="truncate block">
                                {msg.isMine
                                  ? (msg.replyTo.senderName && msg.replyTo.senderName !== "Você"
                                      ? msg.replyTo.senderName
                                      : activeChat.fullName || activeChat.username || "Contato")
                                  : "Você"}
                              </span>
                            </div>
                            <p className="text-[11px] truncate block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap opacity-90 mt-0.5 font-normal">
                              {(msg.replyTo.text || "").startsWith("[audio:")
                                ? "🎙️ Mensagem de voz"
                                : (msg.replyTo.text || "").startsWith("[image:")
                                ? "📷 Foto"
                                : msg.replyTo.text || "Mensagem citada"}
                            </p>
                          </div>
                        )}

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
                              <div className="flex items-center gap-2 py-1 px-2 text-xs text-zinc-300 select-none">
                                <Mic className="w-4 h-4 text-zinc-400" />
                                <span>🎙️ Mensagem de voz</span>
                              </div>
                            );
                          })()
                        ) : /* 3. Mídia do tipo Imagem / Foto com URL */
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
                              <p className="px-2 py-1 text-xs text-white/95">
                                {msg.text.replace(/^\[image:[^\]]+\]\s*/, "")}
                              </p>
                            )}
                          </div>
                        ) : /* 4. Mídia compartilhada ou temporária da Meta (Foto/Story) */
                        !isTinderChat &&
                        (msg.text === "📷 Mídia compartilhada" ||
                          msg.text === "📷 Mídia ou Story" ||
                          msg.text === "📷 Mídia" ||
                          (msg.mediaType === "image" && !msg.mediaUrl)) ? (
                          <InstagramSharedMediaCard isMine={msg.isMine} />
                        ) : (
                          /* 5. Mensagem de texto tradicional */
                          <p className="whitespace-pre-wrap break-words [word-break:break-word] [overflow-wrap:anywhere] min-w-0 max-w-full">{msg.text}</p>
                        )}

                        {/* Horário da Mensagem (Timestamp estilo Instagram com contador regressivo) */}
                        <div
                          className={`flex items-center gap-1.5 mt-1.5 select-none text-[10px] font-mono leading-none ${
                            msg.isMine ? "justify-end text-white/75" : "justify-start text-zinc-400"
                          }`}
                        >
                          <span>
                            {formatMessageTime(msg.timestamp || msg.sentDate || msg.createdAt) || "Agora"}
                          </span>
                          {msg.isMine && (
                            <span className="ml-0.5 flex items-center gap-1">
                              {msg.status === "sending" ? (
                                msg.deliverAt ? (
                                  <MessageCountdown deliverAt={msg.deliverAt} />
                                ) : (
                                  <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
                                )
                              ) : msg.status === "failed" ? (
                                <AlertCircle className="w-2.5 h-2.5 text-red-400 inline" />
                              ) : (
                                <Check className="w-3 h-3 text-white/85 inline" />
                              )}
                            </span>
                          )}
                        </div>

                        {msg.liked && (
                          <span className="absolute -bottom-2 -right-1 bg-[#262626] rounded-full p-1 border border-black shadow-md">
                            <Heart className="w-3 h-3 text-red-500 fill-red-500" />
                          </span>
                        )}
                      </div>
                    </div>

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
                          <span className="text-[11px] font-normal text-[#8e8e8e]">
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

        {/* HUD Flutuante do Piloto Automático (Desacoplado da rolagem: zero tremor e zero piscar) */}
        {(() => {
          const currentChatState = autoPilot.chatStates[activeChat.id];
          if (!currentChatState) {
            return null;
          }
          const isActivelyWorking = Boolean(
            currentChatState.activity ||
            currentChatState.status === "waiting_delay" ||
            currentChatState.status === "waiting_debounce" ||
            currentChatState.status === "processing" ||
            currentChatState.status === "in_queue" ||
            currentChatState.status === "paused_guardrail" ||
            currentChatState.status === "paused_handoff"
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
              />
            </div>
          );
        })()}

        {/* Input Fixo no Rodapé: Idêntico em ambos os chats, com suporte a Gravação de Áudio */}
        {isRecording ? (
          <div className="p-3 bg-black border-t border-[#262626] flex items-center justify-between gap-3 shrink-0 z-10 animate-in fade-in duration-200">
            {/* Botão Cancelar (Lixeira) */}
            <button
              type="button"
              onClick={() => handleStopRecording(false)}
              className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-400 hover:text-red-400 active:scale-90 flex items-center justify-center transition-all cursor-pointer"
              title="Cancelar gravação"
              aria-label="Cancelar gravação de áudio"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Visualizador de Gravação Ativa com Timer */}
            <div className="flex-1 bg-[#1c1c1e] border border-red-500/40 rounded-full px-4 py-2 flex items-center gap-3 shadow-inner">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-xs font-medium text-white/90">Gravando áudio...</span>
              <span className="ml-auto font-mono text-xs text-red-400 font-bold tracking-wider">
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>
            </div>

            {/* Botão Concluir e Enviar */}
            <button
              type="button"
              onClick={() => handleStopRecording(true)}
              className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0095f6] to-[#0081d6] text-white active:scale-90 flex items-center justify-center transition-transform shadow-md cursor-pointer hover:opacity-95"
              title="Concluir e enviar áudio"
              aria-label="Enviar nota de voz"
            >
              <Mic className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="bg-black border-t border-[#262626] shrink-0 z-10">
            {/* Prévia de Foto Pendente para envio */}
            {pendingImage && (
              <div className="mx-3 mt-2.5 p-2 bg-[#1c1c1e] border border-[#262626] rounded-xl flex items-center gap-3 animate-in fade-in duration-150">
                <img
                  src={pendingImage.previewUrl}
                  alt="Prévia da foto selecionada"
                  className="w-12 h-12 rounded-lg object-cover border border-[#333] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">
                    {pendingImage.file.name}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    Foto pronta para enviar · {(pendingImage.file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelPendingImage}
                  className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-colors cursor-pointer"
                  title="Remover foto selecionada"
                  aria-label="Cancelar foto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Card de Resposta a Mensagem Específica (Instagram Reply Bar) */}
            {replyingToMessage && (
              <div className="mx-3 mt-2 px-3.5 py-2 bg-[#1c1c1e] border-l-2 border-[#0095f6] rounded-r-xl flex items-center justify-between gap-3 animate-in fade-in duration-150 select-none">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#0095f6]">
                    <Reply className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Respondendo a {activeChat.fullName || activeChat.username}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 truncate mt-0.5 font-normal">
                    {(replyingToMessage.text || "").startsWith("[audio:") || replyingToMessage.mediaType === "audio"
                      ? "🎙️ Mensagem de voz"
                      : (replyingToMessage.text || "").startsWith("[image:") || replyingToMessage.mediaType === "image"
                      ? "📷 Foto"
                      : replyingToMessage.text || "Mensagem"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-colors cursor-pointer"
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

            {/* Barra de Digitação Isolada (Zero Lag / 60 FPS com State Colocation) */}
            <InstagramChatComposer
              ref={composerRef}
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
              onOpenAiAssistant={() => {
                setAiTargetMessageId(null);
                setIsAiModalOpen(true);
              }}
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
            await sendMessageWithText(`[audio:${audio.audioUrl}]`);
            toast.success(`Áudio "${audio.title}" enviado com sucesso.`);
          }}
          onOpenLegacyVault={() => {
            setIsPersonaAudioModalOpen(false);
            setIsVaultModalOpen(true);
          }}
        />

        {/* Modal de Cofre Legado de Pastas e Mídias Rápidas (Preservado) */}
        <FloatingVaultModal
          isOpen={isVaultModalOpen}
          onClose={() => setIsVaultModalOpen(false)}
          activeChat={
            activeChat
              ? {
                  id: activeChat.id,
                  fullName: activeChat.fullName,
                  username: activeChat.username,
                  avatar: activeChat.avatar,
                  type: activeChat.type,
                }
              : null
          }
          targetFolderId={chatDetail?.stage?.folderId}
          targetStageName={chatDetail?.stage?.name}
          onInsertText={(text) => {
            composerRef.current?.appendText(text);
          }}
          onForwardItem={handleForwardVaultItem}
          onSendText={async (text) => {
            await sendMessageWithText(text);
          }}
          onSendAudioFile={async (file) => {
            await handleUploadAndSendMedia(file);
          }}
          onSendImageFile={async (file) => {
            await handleUploadAndSendMedia(file);
          }}
        />

        {/* Modal de Assistente de IA Contextual */}
        <AiAssistantModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          conversationId={activeChat.id}
          conversationName={activeChat.fullName}
          contactUsername={activeChat.username}
          platform={activeChat.type}
          currentMessages={chatMessages}
          initialTargetMessageId={aiTargetMessageId}
          onSendMessages={handleSendMultipleMessages}
          onAudioTranscribed={(msgId, newTranscript) => {
            setMessages((prev) => {
              const current = prev[activeChat.id] || [];
              return {
                ...prev,
                [activeChat.id]: current.map((m) =>
                  m.id === msgId ? { ...m, audioTranscript: newTranscript } : m
                ),
              };
            });
          }}
        />


        {/* Modal de Escolha do Modo de Inicialização do Piloto Automático */}
        <AutoPilotActivationModal
          isOpen={isAutoPilotActivationModalOpen}
          onClose={() => setIsAutoPilotActivationModalOpen(false)}
          chatName={activeChat.fullName || activeChat.username}
          onConfirm={async (mode) => {
            await autoPilot.activateAutoPilotWithChoice(activeChat.id, mode);
          }}
        />

        {/* Modal de Perfil Completo estilo Tinder */}
        <TinderProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => {
            setIsProfileModalOpen(false);
            setSelectedProfileForModal(null);
          }}
          profile={selectedProfileForModal || activeChat}
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
    <div className="relative flex flex-col h-full w-full bg-black text-white overflow-hidden">
      {/* 1. LISTA DE CONVERSAS (OCULTA QUANDO O CHAT ESTIVER ABERTO PARA GARANTIR RIGOROSAMENTE UM ÚNICO SCROLL) */}
      <div className={`flex flex-col h-full w-full overflow-hidden ${activeChat ? "hidden" : ""}`}>
        {/* ABAS SUPERIORES: INSTAGRAM E TINDER */}
        <div className="shrink-0 flex items-center border-b border-[#262626] bg-black px-4">
          <button
            onClick={() => setChatPlatform("instagram")}
            className={`flex-1 py-3 text-xs font-bold tracking-wide flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
              chatPlatform === "instagram"
                ? "text-white border-white"
                : "text-[#737373] border-transparent hover:text-white"
            }`}
          >
            <Camera className="w-4 h-4" />
            Instagram
          </button>

          <button
            onClick={() => setChatPlatform("tinder")}
            className={`flex-1 py-3 text-xs font-bold tracking-wide flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
              chatPlatform === "tinder"
                ? "text-[#fe3c72] border-[#fe3c72]"
                : "text-[#737373] border-transparent hover:text-white"
            }`}
          >
            <Flame
              className={`w-4 h-4 ${
                chatPlatform === "tinder" ? "text-[#fe3c72] fill-[#fe3c72]" : ""
              }`}
            />
            Tinder
          </button>

          {/* Indicador de Realtime WebSocket */}
          {/* Ações Rápidas: Notificações Móveis e Realtime WebSocket */}
          <div className="ml-2 pl-2 border-l border-[#262626] flex items-center shrink-0 gap-2">
            {/* Botão Notificações Móveis Push */}
            <button
              type="button"
              onClick={() => {
                if (mobileNotifications.permission === "granted") {
                  mobileNotifications.sendTestNotification();
                } else {
                  mobileNotifications.requestPermission();
                }
              }}
              className={`px-2 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                mobileNotifications.permission === "granted"
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
                  : "bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25 animate-pulse"
              }`}
              title={
                mobileNotifications.permission === "granted"
                  ? "Notificações móveis ativas! Clique para testar no celular."
                  : "Ativar notificações móveis no celular / push"
              }
            >
              {mobileNotifications.permission === "granted" ? (
                <BellRing className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Bell className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span className="hidden sm:inline">
                {mobileNotifications.permission === "granted" ? "Notificações" : "Ativar Push"}
              </span>
            </button>

            <div
              className="flex items-center gap-1.5 py-1 text-[10px] text-[#a8a8a8] select-none"
              title={isRealtimeConnected ? "Supabase Realtime WebSocket conectado" : "Sincronizando..."}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRealtimeConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                }`}
              />
              <span className="font-mono text-[9px] font-semibold text-zinc-400 hidden xs:inline">
                {isRealtimeConnected ? "LIVE" : "SYNC"}
              </span>
            </div>
          </div>
        </div>

        {/* BANNER DE NOTIFICAÇÃO: PROPOSTAS DA IA AGUARDANDO APROVAÇÃO */}
        {(() => {
          const pendingChats = Object.entries(autoPilot.chatStates).filter(
            ([_, s]) => s.isEnabled && (s.status as string) === "waiting_approval" && s.pendingAction
          );
          if (pendingChats.length === 0) return null;

          return (
            <div className="bg-gradient-to-r from-purple-950/70 via-indigo-950/60 to-purple-950/70 border-b border-purple-500/30 px-3.5 py-2 text-xs text-purple-200 flex items-center justify-between gap-2 shrink-0 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 truncate">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 animate-pulse" />
                <span className="truncate">
                  <strong>{pendingChats.length} {pendingChats.length === 1 ? "proposta da IA" : "propostas da IA"}</strong> aguardando revisão e aprovação!
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const targetId = pendingChats[0][0];
                  const targetConv = conversations.find((c) => c.id === targetId);
                  if (targetConv) handleOpenConversation(targetConv);
                }}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] shrink-0 cursor-pointer active:scale-95 transition-all shadow-sm"
              >
                Revisar
              </button>
            </div>
          );
        })()}

        {/* Conteúdo com scroll isolado e rastreamento de posição */}
        <div
          ref={conversationsScrollRef}
          className={`flex-1 ${activeChat ? "overflow-hidden" : "overflow-y-auto"} px-4 py-3 space-y-3 scrollbar-none overscroll-contain`}
        >
        {/* Barra de Pesquisa e Botão de Filtro na Mesma Linha */}
        <div className="flex items-center gap-2 select-none">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Pesquisar no ${chatPlatform === "instagram" ? "Instagram" : "Tinder"}`}
              className="w-full bg-[#262626] text-white text-xs placeholder-[#8e8e8e] rounded-xl pl-9 pr-4 py-2 focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-[#8e8e8e] absolute left-3 top-2.5" />
          </div>

          <button
            type="button"
            onClick={() => setIsFilterModalOpen(true)}
            className={`relative min-w-[36px] h-8.5 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 border ${
              isFilterActive
                ? chatPlatform === "tinder"
                  ? "bg-[#fe3c72]/20 text-[#fe3c72] border-[#fe3c72]/50 shadow-sm"
                  : "bg-white/20 text-white border-white/40 shadow-sm"
                : "bg-[#262626] text-[#8e8e8e] hover:text-white border-[#383838]"
            }`}
            title="Filtros e ordenação"
            aria-label="Abrir filtros e ordenação"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 stroke-[2]" />
            <span className="text-[11px] font-semibold hidden xs:inline">
              {sortOrder === "antigas" ? "Mais antigas" : "Filtro"}
            </span>
            {isFilterActive && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  chatPlatform === "tinder" ? "bg-[#fe3c72]" : "bg-[#0095f6]"
                }`}
              />
            )}
          </button>
        </div>

        {/* PÍLULAS OFICIAIS DO INSTAGRAM (DESIGN IDÊNTICO AO APP OFICIAL) */}
        {showFilterBar && chatPlatform === "instagram" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none select-none animate-in fade-in duration-150">
              <button
                onClick={() => setInstaFilter("todos")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 ${
                  instaFilter === "todos"
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-[#262626] text-[#e0e0e0] hover:text-white"
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setInstaFilter("nao_respondidos")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 ${
                  instaFilter === "nao_respondidos"
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-[#262626] text-[#e0e0e0] hover:text-white"
                }`}
              >
                Não respondidos
              </button>
              <button
                onClick={() => setInstaFilter("respondidos")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 ${
                  instaFilter === "respondidos"
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-[#262626] text-[#e0e0e0] hover:text-white"
                }`}
              >
                Respondidos
              </button>
              <button
                onClick={() => setInstaFilter("pedidos")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 flex items-center gap-1.5 ${
                  instaFilter === "pedidos"
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-[#262626] text-[#e0e0e0] hover:text-white"
                }`}
              >
                <span>Pedidos</span>
                {pedidosCount > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                      instaFilter === "pedidos"
                        ? "bg-black text-white"
                        : "bg-[#383838] text-white"
                    }`}
                  >
                    {pedidosCount}
                  </span>
                )}
              </button>
            </div>

            {/* SUB-FILTRO DA PASTA DE PEDIDOS E CONTAS RESTRINGIDAS (ESTILO INSTAGRAM) */}
            {instaFilter === "pedidos" && (
              <div className="p-3 rounded-2xl bg-[#141414] border border-[#262626] space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPedidosSubFilter("todos_pedidos")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      pedidosSubFilter === "todos_pedidos"
                        ? "bg-[#2c2c2e] text-white border border-[#444]"
                        : "text-[#8e8e8e] hover:text-white"
                    }`}
                  >
                    Todos os pedidos {pedidosCount > 0 ? `(${pedidosCount})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPedidosSubFilter("restringidos")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      pedidosSubFilter === "restringidos"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "text-[#8e8e8e] hover:text-white"
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Restringidos {restringidosCount > 0 ? `(${restringidosCount})` : ""}
                  </button>
                </div>
                <p className="text-[11px] text-[#8e8e8e] leading-relaxed">
                  {pedidosSubFilter === "restringidos"
                    ? "Contas que você restringiu. As mensagens delas não aparecem na caixa de entrada principal e elas não saberão quando você estiver online ou ler as mensagens."
                    : "Mensagens de pessoas que não estão conectadas com você. A pessoa só saberá que você visualizou quando você aceitar ou responder."}
                </p>
              </div>
            )}
          </div>
        )}

        {showFilterBar && chatPlatform === "tinder" && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none select-none animate-in fade-in duration-150">
              <button
                onClick={() => setTinderFilter("todos")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  tinderFilter === "todos"
                    ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold shadow-sm"
                    : "bg-[#262626] text-[#a8a8a8] hover:text-white"
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setTinderFilter("novos")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  tinderFilter === "novos"
                    ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold shadow-sm"
                    : "bg-[#262626] text-[#a8a8a8] hover:text-white"
                }`}
              >
                Matchs novos
              </button>
              <button
                onClick={() => setTinderFilter("sua_vez")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  tinderFilter === "sua_vez"
                    ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold shadow-sm"
                    : "bg-[#262626] text-[#a8a8a8] hover:text-white"
                }`}
              >
                Sua vez
              </button>
              <button
                onClick={() => setTinderFilter("vez_deles")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  tinderFilter === "vez_deles"
                    ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold shadow-sm"
                    : "bg-[#262626] text-[#a8a8a8] hover:text-white"
                }`}
              >
                Vez deles
              </button>
              <button
                onClick={() => setTinderFilter("restritos")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  tinderFilter === "restritos"
                    ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold shadow-sm"
                    : "bg-[#262626] text-[#a8a8a8] hover:text-white"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Restritos</span>
                {tinderRestritosCount > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                      tinderFilter === "restritos"
                        ? "bg-black/40 text-white"
                        : "bg-[#383838] text-white"
                    }`}
                  >
                    {tinderRestritosCount}
                  </span>
                )}
              </button>
            </div>

            {/* BANNER EXPLICATIVO DE MATCHES RESTRINGIDOS (DO JEITO DO TINDER) */}
            {tinderFilter === "restritos" && (
              <div className="p-3 rounded-2xl bg-[#1c1417] border border-[#fe3c72]/30 space-y-1.5 animate-in fade-in duration-150">
                <div className="flex items-center gap-2 text-xs font-bold text-[#fe3c72]">
                  <ShieldAlert className="w-4 h-4 text-[#fe3c72]" />
                  <span>Matches Restritos</span>
                </div>
                <p className="text-[11px] text-[#a8a8a8] leading-relaxed">
                  Matches que você restringiu. As conversas não aparecem no seu feed principal do Tinder e ficam guardadas aqui com discrição.
                </p>
              </div>
            )}
          </div>
        )}

        {/* FILTRO DE ETAPAS DO FUNIL (CHECK-UPS) - Exclusivo Instagram Direct */}
        {chatPlatform === "instagram" && stages.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 scrollbar-none select-none border-t border-b border-[#202020] bg-zinc-950/40 -mx-4 px-4">
            <div className="flex items-center gap-1 text-[11px] font-bold text-zinc-400 shrink-0 mr-1">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Etapa:</span>
            </div>

            {stages.map((stg, idx) => {
              const countInStage = platformConversations.filter((c) => {
                const p = allProgresses[c.id];
                const currentStageId = p?.currentStageId || stages[0]?.id;
                return currentStageId === stg.id && !p?.isConverted;
              }).length;

              const isSelected = stageFilter === stg.id;
              const stgColor = stg.color || "#3b82f6";

              return (
                <button
                  key={stg.id}
                  type="button"
                  onClick={() => setStageFilter((prev) => (prev === stg.id ? "todas" : stg.id))}
                  style={{
                    backgroundColor: isSelected ? stgColor : "#222",
                    color: isSelected ? "#fff" : "#a1a1aa",
                    borderColor: isSelected ? stgColor : "transparent",
                  }}
                  className="px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 flex items-center gap-1.5 border shadow-sm"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: isSelected ? "#fff" : stgColor }}
                  />
                  <span>
                    {idx + 1}. {stg.name}
                  </span>
                  {countInStage > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold leading-none ${
                        isSelected ? "bg-black/30 text-white" : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {countInStage}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Filtro de Finalizados */}
            {(() => {
              const convertedCount = platformConversations.filter(
                (c) => allProgresses[c.id]?.isConverted
              ).length;
              const isSelected = stageFilter === "concluidos";

              return (
                <button
                  type="button"
                  onClick={() => setStageFilter((prev) => (prev === "concluidos" ? "todas" : "concluidos"))}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer active:scale-95 flex items-center gap-1.5 border ${
                    isSelected
                      ? "bg-amber-500 text-black font-bold border-amber-400 shadow-sm"
                      : "bg-[#222] text-[#8e8e8e] border-transparent hover:text-white"
                  }`}
                >
                  <Trophy className="w-3 h-3 text-amber-300" />
                  <span>Finalizados</span>
                  {convertedCount > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold leading-none ${
                        isSelected ? "bg-black/30 text-white" : "bg-zinc-800 text-amber-300"
                      }`}
                    >
                      {convertedCount}
                    </span>
                  )}
                </button>
              );
            })()}
          </div>
        )}

        {/* Lista de Conversas Filtradas e Ordenadas */}
        <div className="space-y-1 pt-1">
          {isLoadingList && sortedConversations.length === 0 ? (
            <div className="py-1">
              <ConversationSkeletonList count={6} isTinder={chatPlatform === "tinder"} />
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="py-16 text-center space-y-2.5">
              {chatPlatform === "tinder" ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-[#1c1c1e] flex items-center justify-center mx-auto text-[#fe3c72]">
                    <Flame className="w-6 h-6 stroke-[1.8]" />
                  </div>
                  <p className="text-sm font-semibold text-white">Nenhum match encontrado</p>
                  <p className="text-xs text-[#737373] max-w-xs mx-auto leading-relaxed">
                    {tinderSession?.isConnected
                      ? "Nenhum match corresponde ao filtro selecionado."
                      : "Conecte sua conta do Tinder na aba Config para carregar seus matches reais."}
                  </p>
                </>
              ) : chatPlatform === "instagram" && !isInstagramConnected ? (
                <div className="py-14 text-center space-y-3 px-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] flex items-center justify-center mx-auto text-white shadow-lg">
                    <Camera className="w-6 h-6 stroke-[2]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">Conecte seu Instagram Direct</p>
                    <p className="text-xs text-[#737373] max-w-xs mx-auto leading-relaxed">
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
              ) : (
                <p className="text-xs text-[#737373]">Nenhuma conversa encontrada neste filtro.</p>
              )}
            </div>
          ) : (
            sortedConversations.map((conv, index) => {
              const prevConv = index > 0 ? sortedConversations[index - 1] : null;
              const currentDayKey = getMessageDayKey(conv.lastMessageAt || conv.lastActive);
              const prevDayKey = prevConv ? getMessageDayKey(prevConv.lastMessageAt || prevConv.lastActive) : null;
              const showDateDivider = index === 0 ? Boolean(currentDayKey) : currentDayKey !== prevDayKey;
              const dateLabel = showDateDivider ? formatInboxDateDivider(conv.lastMessageAt || conv.lastActive) : null;

              return (
                <React.Fragment key={conv.id}>
                  {showDateDivider && dateLabel && (
                    <div className="pt-4 pb-1.5 px-2 flex items-center gap-3 select-none">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#8e8e8e]">
                        {dateLabel}
                      </span>
                      <div className="h-px bg-[#262626] flex-1" />
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
                className="flex items-center justify-between py-2.5 px-2 rounded-xl hover:bg-[#121212] transition-colors cursor-pointer active:scale-[0.99] select-none"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProfileForModal(conv);
                      setIsProfileModalOpen(true);
                    }}
                    title="Toque para ver perfil completo"
                    className="cursor-pointer hover:opacity-85 active:scale-95 transition-all shrink-0"
                  >
                    <AvatarWithFallback
                      src={conv.avatar}
                      alt={conv.fullName || conv.username}
                      sizeClassName="w-13 h-13"
                      ringClassName={conv.type === "tinder" ? "ring-2 ring-[#fe3c72]" : ""}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4
                        className={`text-sm tracking-tight truncate ${
                          isConversationUnread(conv) ? "font-bold text-white" : "font-normal text-white"
                        }`}
                      >
                        {conv.fullName}
                      </h4>

                      {/* BADGES DO TINDER */}
                      {conv.type === "tinder" && (
                        <>
                          {conv.isNewMatch ? (
                            <span className="text-[9px] bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white font-bold px-1.5 py-0.5 rounded-full shrink-0 shadow-sm flex items-center gap-0.5 leading-none">
                              <Flame className="w-2.5 h-2.5 fill-white" />
                              Match novo
                            </span>
                          ) : conv.lastSender === "them" ? (
                            <span className="text-[9px] bg-[#fe3c72]/15 text-[#ff7597] border border-[#fe3c72]/30 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none">
                              Sua vez
                            </span>
                          ) : (
                            <span className="text-[9px] bg-[#222] text-[#8e8e8e] border border-[#333] font-medium px-1.5 py-0.5 rounded-full shrink-0 leading-none">
                              Vez deles
                            </span>
                          )}
                        </>
                      )}

                      {/* BADGES DO INSTAGRAM */}
                      {conv.type === "instagram" && isChatRestricted(conv) && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1">
                          <ShieldAlert className="w-2.5 h-2.5" />
                          Restrito
                        </span>
                      )}

                      {/* BADGE DA ETAPA DO FUNIL (CHECK-UPS) - Exclusivo Instagram Direct */}
                      {conv.type === "instagram" && (() => {
                        const progress = allProgresses[conv.id];
                        if (progress?.isConverted) {
                          return (
                            <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1">
                              <Trophy className="w-2.5 h-2.5 text-amber-300" />
                              Finalizado
                            </span>
                          );
                        }
                        const currentStageId = progress?.currentStageId || stages[0]?.id;
                        const currentStage = stages.find((s) => s.id === currentStageId);
                        if (!currentStage) return null;
                        const color = currentStage.color || "#3b82f6";
                        return (
                          <span
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1 border"
                            style={{
                              backgroundColor: `${color}18`,
                              borderColor: `${color}40`,
                              color: color,
                            }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            {currentStage.name}
                          </span>
                        );
                      })()}

                      {/* BADGE DO PILOTO AUTOMÁTICO */}
                      {(() => {
                        const apState = autoPilot.chatStates[conv.id];
                        if (!apState) return null;

                        if (apState.status === "paused_guardrail") {
                          return (
                            <span
                              title={`Piloto pausado por segurança: ${apState.pauseReason || "Mídia ou conteúdo sensível"}`}
                              className="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1"
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                              Erro na IA
                            </span>
                          );
                        }

                        if ((apState.status as string) === "paused_handoff") {
                          return (
                            <span
                              title="Etapa da Rifa atingida! Assuma a conversa."
                              className="text-[9px] bg-amber-500/25 text-amber-300 border border-amber-500/50 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1 animate-pulse"
                            >
                              <Trophy className="w-2.5 h-2.5 text-amber-300" />
                              Assumir
                            </span>
                          );
                        }

                        if ((apState.status as string) === "waiting_approval") {
                          return (
                            <span
                              title="A IA gerou uma proposta de resposta para este chat! Toque para revisar e aprovar."
                              className="text-[9px] bg-purple-500/25 text-purple-300 border border-purple-500/50 font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1 animate-pulse shadow-sm shadow-purple-500/10"
                            >
                              <Sparkles className="w-2.5 h-2.5 text-purple-300" />
                              Aprovar
                            </span>
                          );
                        }

                        if (!apState.isEnabled) {
                          return (
                            <span title="Piloto Automático desativado neste chat" className="text-[9px] bg-zinc-800/70 text-zinc-500 border border-zinc-700 font-semibold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1">
                              <Bot className="w-2.5 h-2.5 text-zinc-500" /> Piloto desativado
                            </span>
                          );
                        }

                        return (
                          <span
                            title="Piloto Automático ativo neste chat"
                            className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold px-1.5 py-0.5 rounded-full shrink-0 leading-none flex items-center gap-1"
                          >
                            <Bot className="w-2.5 h-2.5 text-emerald-400" />
                            Piloto
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center text-xs text-[#a8a8a8] mt-0.5 min-w-0">
                      {isAutoPilotWorking(autoPilot.chatStates[conv.id]) ? (
                        <AutoPilotActivityIndicator state={autoPilot.chatStates[conv.id]} variant="inbox" />
                      ) : (() => {
                        const isLastMessageSeen =
                          conv.lastSender === "me" &&
                          conv.lastStatus === "seen" &&
                          Boolean(conv.seenAt) &&
                          new Date(conv.seenAt!).getTime() >= new Date(conv.lastMessageAt || conv.lastActive || 0).getTime();

                        return isLastMessageSeen ? (
                          <>
                            <span className="text-[#8e8e8e] font-normal truncate">
                              Visto
                            </span>
                            <span className="text-[#737373] shrink-0 text-xs ml-1 font-normal">
                              • {formatMessageTime(conv.seenAt)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span
                              className={`truncate ${
                                isConversationUnread(conv) ? "text-white font-semibold" : "text-[#a8a8a8]"
                              }`}
                            >
                              {conv.lastMessage}
                            </span>
                            {(conv.lastMessageAt || conv.lastActive) && (
                              <span className="text-[#737373] shrink-0 text-xs ml-1 font-normal">
                                • {formatMessageTime(conv.lastMessageAt || conv.lastActive)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
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
                            conv.type === "tinder" ? "bg-[#fe3c72]" : "bg-[#0095f6]"
                          }`}
                          title="Não lida"
                        />
                      );
                    }

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
                            sizeClassName="w-4 h-4"
                          />
                        </div>
                      );
                    }

                    if (!isReplied) {
                      return (
                        <span title="Visualizada (Pendente de resposta)" className="flex items-center justify-center shrink-0">
                          <Bell className="w-3.5 h-3.5 text-[#737373] stroke-[1.8]" />
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

      {/* 2. CHAT ABERTO (CAMADA SOBREPOSTA COM HISTÓRICO SINCRONIZADO) */}
      {renderChatThread()}

      {/* Modal de Perfil Completo estilo Tinder para acesso a partir da lista */}
      <TinderProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedProfileForModal(null);
        }}
        profile={selectedProfileForModal}
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

      {/* Modal de Filtros e Ordenação Temporal */}
      <ChatFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        platform={chatPlatform}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        instaFilter={instaFilter}
        onInstaFilterChange={setInstaFilter}
        tinderFilter={tinderFilter}
        onTinderFilterChange={setTinderFilter}
        onReset={() => {
          setSortOrder("recentes");
          setInstaFilter("todos");
          setTinderFilter("todos");
        }}
      />

      {/* ACTION SHEET DE OPÇÕES DA CONVERSA (AO CLICAR E SEGURAR) */}
      {selectedChatForActionSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedChatForActionSheet(null)}
        >
          <div
            className="w-full sm:max-w-sm bg-[#161618] border border-[#2a2a2c] rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl p-4 space-y-3 pb-[calc(1.2rem+env(safe-area-inset-bottom,0px))] animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do contato */}
            <div className="flex items-center gap-3 pb-3 border-b border-[#262628]">
              <AvatarWithFallback
                src={selectedChatForActionSheet.avatar}
                alt={selectedChatForActionSheet.fullName || selectedChatForActionSheet.username}
                sizeClassName="w-11 h-11"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-white truncate">
                  {selectedChatForActionSheet.fullName}
                </h3>
                <p className="text-xs text-[#8e8e8e] truncate">
                  @{selectedChatForActionSheet.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChatForActionSheet(null)}
                className="w-8 h-8 rounded-full bg-[#242426] text-[#8e8e8e] hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                aria-label="Fechar opções"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Lista de Ações do Chat */}
            <div className="space-y-1.5 pt-1">
              {/* Opção 1: Restringir / Remover Restrição (Instagram e Tinder) */}
              <button
                type="button"
                onClick={() => {
                  const target = selectedChatForActionSheet;
                  setSelectedChatForActionSheet(null);
                  handleToggleRestricted(target);
                }}
                className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left ${
                  selectedChatForActionSheet.isRestricted
                    ? selectedChatForActionSheet.type === "tinder"
                      ? "bg-[#fe3c72]/15 border border-[#fe3c72]/40 text-[#fe3c72] hover:bg-[#fe3c72]/25"
                      : "bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25"
                    : "bg-[#202022] border border-[#2c2c2e] text-white hover:bg-[#28282b]"
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-black/40 flex items-center justify-center shrink-0">
                  {selectedChatForActionSheet.isRestricted ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert
                      className={`w-5 h-5 ${
                        selectedChatForActionSheet.type === "tinder"
                          ? "text-[#fe3c72]"
                          : "text-amber-400"
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">
                    {selectedChatForActionSheet.isRestricted
                      ? selectedChatForActionSheet.type === "tinder"
                        ? "Remover restrição do match"
                        : "Remover restrição"
                      : selectedChatForActionSheet.type === "tinder"
                      ? "Restringir match"
                      : "Restringir conta"}
                  </p>
                  <p className="text-[11px] text-[#8e8e8e] truncate">
                    {selectedChatForActionSheet.isRestricted
                      ? selectedChatForActionSheet.type === "tinder"
                        ? "Mover de volta para os matches principais"
                        : "Mover de volta para a caixa de entrada principal"
                      : selectedChatForActionSheet.type === "tinder"
                      ? "Ocultar do feed principal e mover para aba Restritos"
                      : "Mover para aba Pedidos e ocultar presença online"}
                  </p>
                </div>
              </button>

              {/* Opção 2: Marcar como Não Lida / Lida */}
              <button
                type="button"
                onClick={() => handleToggleUnreadStatus(selectedChatForActionSheet)}
                className="w-full p-3 rounded-xl bg-[#202022] border border-[#2c2c2e] hover:bg-[#28282b] text-white flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-black/40 flex items-center justify-center shrink-0">
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
                  <p className="text-[11px] text-[#8e8e8e] truncate">
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
                className="w-full p-3 rounded-xl bg-[#202022] border border-[#2c2c2e] hover:bg-[#28282b] text-white flex items-center gap-3 transition-all cursor-pointer active:scale-98 text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-black/40 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-[#a8a8a8]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">Ver perfil completo</p>
                  <p className="text-[11px] text-[#8e8e8e] truncate">
                    Visualizar dados do usuário e fotos
                  </p>
                </div>
              </button>
            </div>

            {/* Botão Cancelar */}
            <button
              type="button"
              onClick={() => setSelectedChatForActionSheet(null)}
              className="w-full py-3 rounded-xl bg-[#222226] hover:bg-[#2a2a2e] text-white text-xs font-bold transition-all cursor-pointer active:scale-98 border border-[#303034]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
