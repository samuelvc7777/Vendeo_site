"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import {
  X,
  Send,
  Image as ImageIcon,
  Type,
  Video as VideoIcon,
  Palette,
  History,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  RefreshCw,
  Users,
  UserCheck,
  UserX,
  Search,
  Check,
  ChevronRight,
  Shield,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  publishWhatsAppStatusText,
  publishWhatsAppStatusImage,
  publishWhatsAppStatusVideo,
  getWhatsApp2StatusPrivacy,
  setWhatsApp2StatusPrivacy,
  getWhatsApp2StatusContacts,
  getWhatsApp2EvergreenRecipients,
  recordWhatsApp2EvergreenRecipients,
  whatsappProviderIdFromConversationId,
  type WhatsAppStatusPrivacyType,
  type WhatsAppStatusPrivacyConfig,
  type WhatsAppStatusContact,
} from "./whatsapp2-client";
import { WhatsAppStatusRepository } from "@/infrastructure/repositories/WhatsAppStatusRepository";
import { WhatsAppStoryMediaRepository } from "@/infrastructure/repositories/WhatsAppStoryMediaRepository";
import type { WhatsAppStatusItem } from "@/domain/entities/WhatsAppStatus";
import type { WhatsAppStoryMedia } from "@/domain/entities/WhatsAppStoryMedia";

interface WhatsAppStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusPublished?: (item: WhatsAppStatusItem) => void;
}

type StatusTab = "text" | "image" | "video" | "library" | "history";


const WHATSAPP_BACKGROUND_COLORS = [
  "#075e54", // Verde WhatsApp Clássico
  "#128c7e", // Verde Teal
  "#25d366", // Verde Vibrante
  "#1f72b6", // Azul Oceano
  "#8c25d3", // Roxo Real
  "#e542a3", // Magenta
  "#d32f2f", // Vermelho
  "#ff9800", // Laranja
  "#546e7a", // Cinza Azulado
  "#212121", // Grafite Escuro
];

const WHATSAPP_FONTS = [
  { id: 0, name: "Padrão", className: "font-sans" },
  { id: 1, name: "Serif", className: "font-serif" },
  { id: 2, name: "Mono", className: "font-mono" },
  { id: 3, name: "Casual", className: "font-sans italic font-bold" },
];

function normalizeEvergreenContactAlias(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutPrefix = whatsappProviderIdFromConversationId(raw);
  const base = withoutPrefix.replace(/@.*$/, "");
  const digits = base.replace(/\D+/g, "");
  return digits || base.toLowerCase();
}

async function buildEvergreenStoryKey(story: WhatsAppStoryMedia): Promise<string> {
  const media = String(story.mediaUrl || "");
  const sampleSize = 64 * 1024;
  const sampledMedia =
    media.length <= sampleSize * 2
      ? media
      : `${media.slice(0, sampleSize)}::${media.slice(-sampleSize)}`;
  const payload = [
    String(story.type || ""),
    String(story.caption || "").trim(),
    String(media.length),
    sampledMedia,
  ].join("\n");

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload),
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `sha256:${hex}`;
  }

  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}:${media.length}`;
}

export function WhatsAppStatusModal({
  isOpen,
  onClose,
  onStatusPublished,
}: WhatsAppStatusModalProps) {
  const [activeTab, setActiveTab] = useState<StatusTab>("text");

  // Estado Texto
  const [textContent, setTextContent] = useState("");
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [selectedFontIndex, setSelectedFontIndex] = useState(0);

  // Estado Imagem
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageCaption, setImageCaption] = useState("");

  // Estado Vídeo
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoCaption, setVideoCaption] = useState("");
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  // Estado de Envio e Feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Histórico
  const [historyItems, setHistoryItems] = useState<WhatsAppStatusItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Privacidade de Status / Público
  const [privacyType, setPrivacyType] = useState<WhatsAppStatusPrivacyType>("contact");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [contactsList, setContactsList] = useState<WhatsAppStatusContact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [isLoadingPrivacy, setIsLoadingPrivacy] = useState(false);

  // Biblioteca de Stories Evergreen
  const [libraryStories, setLibraryStories] = useState<WhatsAppStoryMedia[]>([]);
  const [selectedLibraryStory, setSelectedLibraryStory] = useState<WhatsAppStoryMedia | null>(null);
  const [selectedStoryKey, setSelectedStoryKey] = useState<string | null>(null);
  const [persistedRecipientAliases, setPersistedRecipientAliases] = useState<string[]>([]);
  const [isLoadingEvergreenRecipients, setIsLoadingEvergreenRecipients] = useState(false);
  const [evergreenLedgerError, setEvergreenLedgerError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const isPendingRef = useRef(false);


  // Carregar histórico e privacidade atual ao abrir o modal
  useEffect(() => {
    if (!isOpen) {
      setSubmissionFeedback(null);
      setIsPrivacyModalOpen(false);
      return;
    }

    // Carrega a configuração atual de privacidade do WhatsApp
    const loadCurrentPrivacy = async () => {
      try {
        setIsLoadingPrivacy(true);
        const res = await getWhatsApp2StatusPrivacy();
        if (res?.ok && res.type) {
          if (selectedLibraryStory) {
            setPrivacyType("allow-list");
          } else {
            setPrivacyType(res.type);
            if (Array.isArray(res.list)) {
              setSelectedContactIds(res.list);
            }
          }
        }
      } catch (err) {
        console.warn("[WhatsApp Status] Não foi possível carregar privacidade prévia:", err);
      } finally {
        setIsLoadingPrivacy(false);
      }
    };

    void loadCurrentPrivacy();

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const items = await WhatsAppStatusRepository.loadHistory();
        setHistoryItems(items);
      } catch (err) {
        console.error("Erro ao carregar histórico de status:", err);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
    setLibraryStories(WhatsAppStoryMediaRepository.getAll());
  }, [isOpen, activeTab, selectedLibraryStory?.id]);


  // Carrega lista de contatos ao abrir o seletor de privacidade ou buscar
  useEffect(() => {
    if (!isPrivacyModalOpen) return;

    let isMounted = true;
    const loadContacts = async () => {
      try {
        setIsLoadingContacts(true);
        const res = await getWhatsApp2StatusContacts(contactSearchQuery, 200);
        if (isMounted && res?.ok && Array.isArray(res.contacts)) {
          setContactsList(res.contacts);
        }
      } catch (err) {
        console.warn("[WhatsApp Status] Falha ao carregar contatos:", err);
      } finally {
        if (isMounted) setIsLoadingContacts(false);
      }
    };

    const timer = setTimeout(loadContacts, contactSearchQuery ? 250 : 0);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isPrivacyModalOpen, contactSearchQuery]);

  const evergreenSeenAliases = new Set(
    [
      ...(selectedLibraryStory?.seenContactIds || []),
      ...persistedRecipientAliases,
    ]
      .map(normalizeEvergreenContactAlias)
      .filter(Boolean),
  );

  // Evergreen: quem já recebeu este conteúdo desaparece totalmente da seleção.
  // Compara número e ID para sobreviver a variações @lid / @c.us do WhatsApp.
  const eligibleContactsList = contactsList.filter((contact) => {
    if (!selectedLibraryStory) return true;
    const contactNumber = normalizeEvergreenContactAlias(contact.number);
    const contactId = normalizeEvergreenContactAlias(contact.id);
    return !evergreenSeenAliases.has(contactNumber) && !evergreenSeenAliases.has(contactId);
  });

  const hiddenContactsCount = selectedLibraryStory
    ? contactsList.length - eligibleContactsList.length
    : 0;

  const toggleContactSelection = (contactId: string) => {
    if (selectedLibraryStory && isLoadingEvergreenRecipients) return;
    setSelectedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId],
    );
  };

  const handleClearSelectedContacts = () => {
    setSelectedContactIds([]);
  };

  const handleSelectAllFilteredContacts = () => {
    if (selectedLibraryStory && isLoadingEvergreenRecipients) return;
    const idsToAdd = eligibleContactsList.map((c) => c.id);
    setSelectedContactIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
  };


  // Ciclar cores de fundo para texto
  const handleNextColor = () => {
    setSelectedColorIndex((prev) => (prev + 1) % WHATSAPP_BACKGROUND_COLORS.length);
  };

  // Ciclar fontes para texto
  const handleNextFont = () => {
    setSelectedFontIndex((prev) => (prev + 1) % WHATSAPP_FONTS.length);
  };

  // Selecionar Imagem (Modo Avulso Tradicional)
  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione um arquivo de imagem válido (JPEG, PNG ou WEBP).");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("A imagem selecionada ultrapassa o limite de 16MB.");
      return;
    }

    setSelectedLibraryStory(null);
    setSelectedStoryKey(null);
    setPersistedRecipientAliases([]);
    setEvergreenLedgerError(null);
    setIsLoadingEvergreenRecipients(false);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Selecionar Vídeo (Modo Avulso Tradicional)
  const handleVideoSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Por favor, selecione um arquivo de vídeo (MP4 ou WebM).");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("O vídeo selecionado ultrapassa o limite de 50MB.");
      return;
    }

    setSelectedLibraryStory(null);
    setSelectedStoryKey(null);
    setPersistedRecipientAliases([]);
    setEvergreenLedgerError(null);
    setIsLoadingEvergreenRecipients(false);
    setVideoFile(file);
    const videoUrl = URL.createObjectURL(file);
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    tempVideo.src = videoUrl;
    tempVideo.onloadedmetadata = () => {
      setVideoDuration(tempVideo.duration);
      URL.revokeObjectURL(videoUrl);
    };

    const reader = new FileReader();
    reader.onload = () => {
      setVideoBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Selecionar Story da Biblioteca Evergreen
  const handleSelectStoryFromLibrary = async (story: WhatsAppStoryMedia) => {
    setSelectedLibraryStory(story);
    setPrivacyType("allow-list");
    setSelectedContactIds([]);
    setSelectedStoryKey(null);
    setPersistedRecipientAliases([]);
    setEvergreenLedgerError(null);
    setIsLoadingEvergreenRecipients(true);

    if (story.type === "image") {
      setImageBase64(story.mediaUrl);
      setImageCaption(story.caption || "");
      setActiveTab("image");
    } else {
      setVideoBase64(story.mediaUrl);
      setVideoCaption(story.caption || "");
      setActiveTab("video");
    }

    try {
      const storyKey = await buildEvergreenStoryKey(story);
      setSelectedStoryKey(storyKey);

      // Migra automaticamente o histórico legado do localStorage para o ledger permanente.
      if ((story.seenContactIds || []).length > 0) {
        await recordWhatsApp2EvergreenRecipients({
          storyKey,
          recipients: (story.seenContactIds || []).map((id) => ({ id })),
        });
      }

      const result = await getWhatsApp2EvergreenRecipients(storyKey);
      const aliases = (result.recipients || []).flatMap((recipient) => [
        recipient.contactKey,
        recipient.contactId || "",
        recipient.contactNumber || "",
      ]);
      setPersistedRecipientAliases(aliases);
      toast.info(
        result.count > 0
          ? `Story "${story.title}" selecionado. ${result.count} contato(s) já receberam e foram ocultados.`
          : `Story "${story.title}" selecionado. Nenhum contato recebeu este Story ainda.`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Não foi possível consultar o histórico Evergreen.";
      setEvergreenLedgerError(message);
      toast.error("Não foi possível confirmar quem já recebeu este Story. Publicação bloqueada por segurança.");
    } finally {
      setIsLoadingEvergreenRecipients(false);
    }
  };

  // Desmarcar Story da Biblioteca e Voltar ao Modelo Tradicional
  const handleClearSelectedStory = () => {
    setSelectedLibraryStory(null);
    setSelectedStoryKey(null);
    setPersistedRecipientAliases([]);
    setEvergreenLedgerError(null);
    setIsLoadingEvergreenRecipients(false);
    setImageBase64(null);
    setVideoBase64(null);
    setImageFile(null);
    setVideoFile(null);
    setImageCaption("");
    setVideoCaption("");
    setPrivacyType("contact");
    setSelectedContactIds([]);
    toast.info("Modo tradicional ativado (todos os contatos visíveis).");
  };

  // Persiste imediatamente a privacidade real no WhatsApp.
  // O modal só fecha quando o gateway lê de volta e confirma a configuração.
  const handleApplyPrivacy = async () => {
    const effectivePrivacyType: WhatsAppStatusPrivacyType =
      selectedLibraryStory ? "allow-list" : privacyType;

    if (
      selectedLibraryStory &&
      (isLoadingEvergreenRecipients || evergreenLedgerError || !selectedStoryKey)
    ) {
      toast.error("Aguarde a confirmação do histórico Evergreen antes de publicar.");
      return;
    }

    if (
      (effectivePrivacyType === "deny-list" || effectivePrivacyType === "allow-list")
      && selectedContactIds.length === 0
    ) {
      toast.error("Selecione pelo menos um contato para esta lista.");
      return;
    }

    try {
      setIsLoadingPrivacy(true);
      if (selectedLibraryStory && privacyType !== "allow-list") {
        setPrivacyType("allow-list");
      }
      const result = await setWhatsApp2StatusPrivacy({
        type: effectivePrivacyType,
        list: selectedContactIds,
      });

      if (!result?.ok) {
        throw new Error("O WhatsApp não confirmou a configuração de privacidade.");
      }

      toast.success("Privacidade atualizada no WhatsApp.");
      setIsPrivacyModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível atualizar a privacidade.";
      toast.error(message);
    } finally {
      setIsLoadingPrivacy(false);
    }
  };

  const persistEvergreenDelivery = async (statusPostId?: string | null) => {
    if (!selectedLibraryStory) return;
    if (!selectedStoryKey) {
      throw new Error("Histórico Evergreen não confirmado.");
    }

    let allContacts = contactsList;
    try {
      const contactResult = await getWhatsApp2StatusContacts("", 1000);
      if (contactResult?.ok && Array.isArray(contactResult.contacts)) {
        allContacts = contactResult.contacts;
      }
    } catch {
      // Usa o snapshot já carregado se a consulta ampla falhar.
    }

    const contactsById = new Map(allContacts.map((contact) => [contact.id, contact] as const));
    const recipients = selectedContactIds.map((id) => {
      const contact = contactsById.get(id);
      return {
        id,
        number: contact?.number || null,
      };
    });

    WhatsAppStoryMediaRepository.recordContactsSeen(
      selectedLibraryStory.id,
      selectedContactIds,
    );
    setLibraryStories(WhatsAppStoryMediaRepository.getAll());

    let result;
    try {
      result = await recordWhatsApp2EvergreenRecipients({
        storyKey: selectedStoryKey,
        statusPostId: statusPostId || null,
        recipients,
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = await recordWhatsApp2EvergreenRecipients({
        storyKey: selectedStoryKey,
        statusPostId: statusPostId || null,
        recipients,
      });
    }

    const aliases = (result.recipients || []).flatMap((recipient) => [
      recipient.contactKey,
      recipient.contactId || "",
      recipient.contactNumber || "",
    ]);
    setPersistedRecipientAliases(aliases);
  };

  // Publicar Status

  const handlePublish = async () => {
    if (isSubmitting || isPendingRef.current) return;

    if (
      selectedLibraryStory &&
      (isLoadingEvergreenRecipients || evergreenLedgerError || !selectedStoryKey)
    ) {
      toast.error("Não foi possível confirmar o histórico deste Story. Publicação bloqueada para evitar repetição.");
      return;
    }

    if (selectedLibraryStory && selectedContactIds.length === 0) {
      toast.error("Selecione pelo menos um contato novo para este Story.");
      return;
    }

    if (selectedLibraryStory && privacyType !== "allow-list") {
      setPrivacyType("allow-list");
    }

    setSubmissionFeedback(null);
    isPendingRef.current = true;
    setIsSubmitting(true);

    const idempotencyKey = `vendeo_status_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      if (activeTab === "text") {
        const text = textContent.trim();
        if (!text) {
          toast.error("Digite algum texto para o status.");
          setIsSubmitting(false);
          isPendingRef.current = false;
          return;
        }

        const color = WHATSAPP_BACKGROUND_COLORS[selectedColorIndex];
        const privacyPayload: WhatsAppStatusPrivacyConfig = {
          type: privacyType,
          list: selectedContactIds,
        };

        const res = await publishWhatsAppStatusText({
          text,
          backgroundColor: color,
          font: selectedFontIndex,
          idempotencyKey,
          privacy: privacyPayload,
        });

        const statusItem: WhatsAppStatusItem = {
          id: res.id || idempotencyKey,
          whatsappStatusId: res.id,
          type: "text",
          textContent: text,
          backgroundColor: color,
          fontIndex: selectedFontIndex,
          status: "sent",
          idempotencyKey,
          privacyType,
          privacyCount: selectedContactIds.length,
          createdAt: new Date().toISOString(),
        };

        await WhatsAppStatusRepository.recordPost(statusItem);
        setHistoryItems((prev) => [statusItem, ...prev]);
        onStatusPublished?.(statusItem);

        setTextContent("");
        setSubmissionFeedback({
          type: "success",
          message: "Status de texto publicado com sucesso!",
        });
        toast.success("Status publicado no WhatsApp!");
      } else if (activeTab === "image") {
        if (!imageBase64) {
          toast.error("Selecione uma imagem para publicar.");
          setIsSubmitting(false);
          isPendingRef.current = false;
          return;
        }

        const privacyPayload: WhatsAppStatusPrivacyConfig = {
          type: selectedLibraryStory ? "allow-list" : privacyType,
          list: selectedContactIds,
        };

        const res = await publishWhatsAppStatusImage({
          mediaBase64: imageBase64,
          caption: imageCaption.trim() || undefined,
          idempotencyKey,
          filename: imageFile?.name || "status.jpg",
          privacy: privacyPayload,
        });

        const statusItem: WhatsAppStatusItem = {
          id: res.id || idempotencyKey,
          whatsappStatusId: res.id,
          type: "image",
          mediaBase64Preview: imageBase64,
          caption: imageCaption.trim() || null,
          mimeType: res.mimeType,
          fileSize: res.fileSize,
          status: "sent",
          idempotencyKey,
          privacyType: selectedLibraryStory ? "allow-list" : privacyType,
          privacyCount: selectedContactIds.length,
          createdAt: new Date().toISOString(),
        };

        await WhatsAppStatusRepository.recordPost(statusItem);
        if (selectedLibraryStory) {
          await persistEvergreenDelivery(res.id);
        }
        setHistoryItems((prev) => [statusItem, ...prev]);
        onStatusPublished?.(statusItem);

        setImageFile(null);
        setImageBase64(null);
        setImageCaption("");
        setSelectedLibraryStory(null);
        setSelectedStoryKey(null);
        setPersistedRecipientAliases([]);
        setEvergreenLedgerError(null);
        setIsLoadingEvergreenRecipients(false);
        setSubmissionFeedback({
          type: "success",
          message: "Status com foto publicado com sucesso!",
        });
        toast.success("Foto publicada no WhatsApp Status!");
      } else if (activeTab === "video") {
        if (!videoBase64) {
          toast.error("Selecione um vídeo para publicar.");
          setIsSubmitting(false);
          isPendingRef.current = false;
          return;
        }

        const privacyPayload: WhatsAppStatusPrivacyConfig = {
          type: selectedLibraryStory ? "allow-list" : privacyType,
          list: selectedContactIds,
        };

        const res = await publishWhatsAppStatusVideo({
          mediaBase64: videoBase64,
          caption: videoCaption.trim() || undefined,
          idempotencyKey,
          filename: videoFile?.name || "status.mp4",
          privacy: privacyPayload,
        });

        const statusItem: WhatsAppStatusItem = {
          id: res.id || idempotencyKey,
          whatsappStatusId: res.id,
          type: "video",
          caption: videoCaption.trim() || null,
          mimeType: res.mimeType,
          fileSize: res.fileSize,
          status: "sent",
          idempotencyKey,
          privacyType: selectedLibraryStory ? "allow-list" : privacyType,
          privacyCount: selectedContactIds.length,
          createdAt: new Date().toISOString(),
        };

        await WhatsAppStatusRepository.recordPost(statusItem);
        if (selectedLibraryStory) {
          await persistEvergreenDelivery(res.id);
        }
        setHistoryItems((prev) => [statusItem, ...prev]);
        onStatusPublished?.(statusItem);

        setVideoFile(null);
        setVideoBase64(null);
        setVideoCaption("");
        setSelectedLibraryStory(null);
        setSelectedStoryKey(null);
        setPersistedRecipientAliases([]);
        setEvergreenLedgerError(null);
        setIsLoadingEvergreenRecipients(false);
        setSubmissionFeedback({
          type: "success",
          message: "Status com vídeo publicado com sucesso!",
        });
        toast.success("Vídeo publicado no WhatsApp Status!");
      }

    } catch (err: any) {
      console.error("Erro ao publicar status:", err);
      const errorMsg =
        err?.message ||
        "Não foi possível publicar o status. Verifique se o WhatsApp está conectado.";
      setSubmissionFeedback({
        type: "error",
        message: errorMsg,
      });
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
      isPendingRef.current = false;
    }
  };

  const currentColor = WHATSAPP_BACKGROUND_COLORS[selectedColorIndex];
  const currentFont = WHATSAPP_FONTS[selectedFontIndex];

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publicar Status no WhatsApp"
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="relative flex flex-col w-full max-w-none h-[100dvh] max-h-none bg-[#111b21] rounded-none overflow-hidden shadow-2xl border-0 text-white sm:max-w-[480px] sm:h-[92vh] sm:max-h-[820px] sm:rounded-3xl sm:border sm:border-white/10">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:pt-3 bg-[#202c33] border-b border-white/5 shrink-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white">
              <span className="text-xs font-bold">WA</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
                Meu Status do WhatsApp
              </h3>
              <p className="text-[11px] text-zinc-400">
                Visível para seus contatos por 24 horas
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Abas */}
        <div className="flex items-center justify-around bg-[#111b21] px-2 py-2 border-b border-white/5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab("text");
              setSubmissionFeedback(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "text"
                ? "bg-[#00a884] text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <Type className="w-3.5 h-3.5" />
            <span>Texto</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("image");
              setSubmissionFeedback(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "image"
                ? "bg-[#00a884] text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Foto</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("video");
              setSubmissionFeedback(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "video"
                ? "bg-[#00a884] text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <VideoIcon className="w-3.5 h-3.5" />
            <span>Vídeo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("library");
              setSubmissionFeedback(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "library"
                ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-300" />
            <span>Biblioteca</span>
            {libraryStories.length > 0 && (
              <span className="ml-0.5 text-[9px] px-1.5 py-0.2 rounded-full bg-white/20 font-bold">
                {libraryStories.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("history");
              setSubmissionFeedback(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "history"
                ? "bg-[#00a884] text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico</span>
          </button>

        </div>

        {/* Feedback Banner */}
        {submissionFeedback && (
          <div
            className={`px-4 py-2.5 text-xs flex items-center justify-between gap-2 shrink-0 ${
              submissionFeedback.type === "success"
                ? "bg-emerald-950/80 text-emerald-200 border-b border-emerald-800/40"
                : "bg-red-950/80 text-red-200 border-b border-red-800/40"
            }`}
          >
            <div className="flex items-center gap-2">
              {submissionFeedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span className="font-medium">{submissionFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setSubmissionFeedback(null)}
              className="text-white/60 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Conteúdo Principal (Canvas / Preview) */}
        <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden bg-black">
          {/* ABA 1: STATUS DE TEXTO */}
          {activeTab === "text" && (
            <div
              className="relative flex-1 flex flex-col items-center justify-center p-6 transition-colors duration-300"
              style={{ backgroundColor: currentColor }}
            >
              {/* Controles Flutuantes Superiores */}
              <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
                <button
                  type="button"
                  onClick={handleNextFont}
                  title={`Fonte: ${currentFont.name}`}
                  className="w-9 h-9 rounded-full bg-black/35 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/50 active:scale-95 transition-all cursor-pointer"
                >
                  <Type className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleNextColor}
                  title="Trocar cor de fundo"
                  className="w-9 h-9 rounded-full bg-black/35 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/50 active:scale-95 transition-all cursor-pointer"
                >
                  <Palette className="w-4 h-4" />
                </button>
              </div>

              {/* Textarea no centro simulando o status do WhatsApp */}
              <div className="w-full max-w-sm flex flex-col items-center justify-center">
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value.slice(0, 700))}
                  placeholder="Escreva seu status..."
                  rows={4}
                  className={`w-full bg-transparent text-center text-white placeholder-white/60 text-2xl font-semibold resize-none focus:outline-none ${currentFont.className}`}
                  maxLength={700}
                  autoFocus
                />
                <span className="text-[11px] font-medium text-white/60 mt-3 tabular-nums">
                  {textContent.length}/700
                </span>
              </div>
            </div>
          )}

          {/* ABA 2: STATUS COM FOTO */}
          {activeTab === "image" && (
            <div className="relative flex-1 flex flex-col items-center justify-center bg-[#0b141a] overflow-hidden">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageSelect(file);
                }}
              />

              {imageBase64 ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <img
                    src={imageBase64}
                    alt="Preview do Status"
                    className="max-h-full max-w-full object-contain"
                  />

                  {/* Badge da Biblioteca com botão para voltar ao modelo tradicional */}
                  {selectedLibraryStory && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-950/85 border border-violet-500/40 backdrop-blur-md text-[11px] font-semibold text-violet-200 z-10 shadow-lg">
                      <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span className="truncate max-w-[120px] sm:max-w-[180px]">
                        {selectedLibraryStory.title}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearSelectedStory}
                        className="ml-1 px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] font-medium cursor-pointer transition-colors"
                        title="Desmarcar story e voltar ao modo avulso tradicional"
                      >
                        Desmarcar
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-xs font-semibold text-white hover:bg-black/80 transition-all cursor-pointer"
                  >
                    Trocar foto
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center p-8 text-center cursor-pointer border-2 border-dashed border-zinc-700 hover:border-[#00a884] rounded-2xl transition-all m-6 w-5/6"
                >
                  <div className="w-16 h-16 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center mb-4">
                    <Upload className="w-7 h-7" />
                  </div>
                  <h4 className="text-sm font-semibold text-zinc-200">
                    Selecione uma foto para o Status
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    Formatos suportados: JPEG, PNG e WEBP (máx. 16MB)
                  </p>
                  <button
                    type="button"
                    className="mt-4 px-4 py-2 rounded-xl bg-[#00a884] text-white text-xs font-semibold shadow-md active:scale-95"
                  >
                    Escolher foto (Modo Avulso)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ABA 3: STATUS COM VÍDEO */}
          {activeTab === "video" && (
            <div className="relative flex-1 flex flex-col items-center justify-center bg-[#0b141a] overflow-hidden">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVideoSelect(file);
                }}
              />

              {videoBase64 ? (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <video
                    src={videoBase64}
                    controls
                    className="max-h-full max-w-full object-contain"
                  />

                  {/* Badge da Biblioteca com botão para voltar ao modelo tradicional */}
                  {selectedLibraryStory && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-950/85 border border-violet-500/40 backdrop-blur-md text-[11px] font-semibold text-violet-200 z-10 shadow-lg pointer-events-auto">
                      <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span className="truncate max-w-[120px] sm:max-w-[180px]">
                        {selectedLibraryStory.title}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearSelectedStory}
                        className="ml-1 px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] font-medium cursor-pointer transition-colors"
                        title="Desmarcar story e voltar ao modo avulso tradicional"
                      >
                        Desmarcar
                      </button>
                    </div>
                  )}

                  <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-auto">
                    {videoDuration && videoDuration > 30 ? (
                      <span className="px-2.5 py-1 rounded-md bg-amber-500/90 text-black text-[10px] font-bold shadow-md">
                        Corte 30s
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md bg-black/60 text-white text-[10px] font-semibold">
                        {videoDuration ? `${Math.round(videoDuration)}s` : "Vídeo"}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-xs font-semibold text-white hover:bg-black/80 transition-all cursor-pointer"
                    >
                      Trocar vídeo
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => videoInputRef.current?.click()}
                  className="flex flex-col items-center justify-center p-8 text-center cursor-pointer border-2 border-dashed border-zinc-700 hover:border-[#00a884] rounded-2xl transition-all m-6 w-5/6"
                >
                  <div className="w-16 h-16 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center mb-4">
                    <VideoIcon className="w-7 h-7" />
                  </div>
                  <h4 className="text-sm font-semibold text-zinc-200">
                    Selecione um vídeo para o Status
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                    Suporta MP4 e WebM. Vídeos acima de 30s são otimizados automaticamente.
                  </p>
                  <button
                    type="button"
                    className="mt-4 px-4 py-2 rounded-xl bg-[#00a884] text-white text-xs font-semibold shadow-md active:scale-95"
                  >
                    Escolher vídeo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ABA: BIBLIOTECA DE STORIES EVERGREEN */}
          {activeTab === "library" && (
            <div className="flex-1 flex flex-col p-4 bg-[#111b21] overflow-y-auto scrollbar-none space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold tracking-wide uppercase text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    Biblioteca de Stories Evergreen
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Selecione um story para postar apenas para contatos novos
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLibraryStories(WhatsAppStoryMediaRepository.getAll())}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/5 active:scale-95"
                  title="Atualizar biblioteca"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {libraryStories.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                  <Sparkles className="w-10 h-10 mb-2 stroke-[1.5] text-violet-400/50" />
                  <p className="text-xs font-semibold text-zinc-300">Nenhum story na biblioteca ainda</p>
                  <p className="text-[11px] text-zinc-500 mt-1 max-w-xs leading-relaxed">
                    Acesse <strong>Configurações &gt; Central de Controle</strong> para adicionar fotos e vídeos à sua biblioteca de stories evergreen.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {libraryStories.map((story) => {
                    const seenCount = (story.seenContactIds || []).length;
                    const isSelected = selectedLibraryStory?.id === story.id;
                    return (
                      <div
                        key={story.id}
                        className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all ${
                          isSelected
                            ? "border-violet-500 ring-2 ring-violet-500/30 bg-violet-950/20"
                            : "border-white/10 bg-[#202c33] hover:border-white/20"
                        }`}
                      >
                        {/* Preview */}
                        <div className="relative aspect-[9/14] w-full overflow-hidden bg-black">
                          {story.type === "video" ? (
                            <video
                              src={story.mediaUrl}
                              className="h-full w-full object-cover"
                              playsInline
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <img
                              src={story.mediaUrl}
                              alt={story.title}
                              className="h-full w-full object-cover"
                            />
                          )}

                          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                            {story.type === "video" ? "Vídeo" : "Foto"}
                          </div>

                          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between rounded-lg bg-black/75 px-2 py-0.5 text-[9px] text-white backdrop-blur">
                            <span className="text-emerald-400 font-bold">
                              {seenCount} viram
                            </span>
                            <span className="text-zinc-400">
                              {story.timesPosted || 0}x
                            </span>
                          </div>
                        </div>

                        {/* Info e Botão de Ação */}
                        <div className="p-2.5 flex flex-col justify-between flex-1 gap-2">
                          <p className="text-xs font-bold text-white truncate" title={story.title}>
                            {story.title}
                          </p>

                          <button
                            type="button"
                            onClick={() => handleSelectStoryFromLibrary(story)}
                            className="w-full py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[11px] font-bold hover:brightness-110 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            <span>Usar este Story</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ABA 4: HISTÓRICO */}
          {activeTab === "history" && (
            <div className="flex-1 flex flex-col p-4 bg-[#111b21] overflow-y-auto scrollbar-none">

              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold tracking-wide uppercase text-zinc-400">
                  Publicações Realizadas pelo Vendeo
                </h4>
                <button
                  type="button"
                  onClick={async () => {
                    setIsLoadingHistory(true);
                    try {
                      const items = await WhatsAppStatusRepository.loadHistory();
                      setHistoryItems(items);
                    } finally {
                      setIsLoadingHistory(false);
                    }
                  }}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/5 active:scale-95"
                  title="Atualizar histórico"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
                </button>
              </div>

              {isLoadingHistory ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Carregando publicações...
                </div>
              ) : historyItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                  <History className="w-10 h-10 mb-2 stroke-[1.5]" />
                  <p className="text-xs font-medium">Nenhum status publicado ainda.</p>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    As postagens que você fizer por aqui serão listadas neste histórico.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-[#202c33] border border-white/5"
                    >
                      {/* Thumbnail ou Preview da Cor */}
                      <div
                        className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center overflow-hidden border border-white/10"
                        style={{
                          backgroundColor: item.backgroundColor || "#2a3942",
                        }}
                      >
                        {item.type === "text" ? (
                          <Type className="w-5 h-5 text-white/90" />
                        ) : item.type === "image" && item.mediaBase64Preview ? (
                          <img
                            src={item.mediaBase64Preview}
                            alt="Status"
                            className="w-full h-full object-cover"
                          />
                        ) : item.type === "image" ? (
                          <ImageIcon className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <VideoIcon className="w-5 h-5 text-teal-400" />
                        )}
                      </div>

                      {/* Informações */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-200 capitalize">
                            Status de {item.type === "text" ? "Texto" : item.type === "image" ? "Foto" : "Vídeo"}
                          </span>
                          <span className="text-[10px] text-zinc-400 tabular-nums">
                            {new Date(item.createdAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        {item.textContent && (
                          <p className="text-xs text-zinc-300 mt-1 line-clamp-2 break-words">
                            "{item.textContent}"
                          </p>
                        )}

                        {item.caption && (
                          <p className="text-xs text-zinc-400 mt-1 line-clamp-2 italic break-words">
                            Legenda: "{item.caption}"
                          </p>
                        )}

                        <div className="flex items-center justify-between gap-1.5 mt-2">
                          {item.status === "sent" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Publicado no WhatsApp
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-400 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              Falhou
                            </span>
                          )}
                          {item.privacyType && (
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-medium bg-white/5 border border-white/10 text-zinc-400">
                              {item.privacyType === "contact"
                                ? "Contatos"
                                : item.privacyType === "deny-list"
                                ? `Exceto ${item.privacyCount || 0}`
                                : `Apenas ${item.privacyCount || 0}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rodapé: Legenda e Botão de Ação */}
        {activeTab !== "history" && activeTab !== "library" && (
          <div className="flex flex-col gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-3 bg-[#202c33] border-t border-white/5 shrink-0 z-10">
            {/* Campo de Legenda para Foto ou Vídeo */}
            {(activeTab === "image" || activeTab === "video") && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#111b21] border border-white/5">
                <input
                  type="text"
                  value={activeTab === "image" ? imageCaption : videoCaption}
                  onChange={(e) => {
                    const val = e.target.value.slice(0, 1024);
                    if (activeTab === "image") setImageCaption(val);
                    else setVideoCaption(val);
                  }}
                  placeholder="Adicione uma legenda..."
                  className="flex-1 bg-transparent text-[16px] md:text-xs text-white placeholder-zinc-400 focus:outline-none"
                  maxLength={1024}
                />
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {(activeTab === "image" ? imageCaption : videoCaption).length}/1024
                </span>
              </div>
            )}

            {/* Seletor de Público do Status */}
            <div className="flex items-center justify-between px-1 py-1">
              <button
                type="button"
                onClick={() => setIsPrivacyModalOpen(true)}
                className={`flex items-center gap-2 px-3 py-2 rounded-full active:scale-95 transition-all text-xs font-medium border cursor-pointer group ${
                  selectedLibraryStory
                    ? "bg-violet-500/15 border-violet-500/40 text-violet-200 hover:bg-violet-500/25"
                    : "bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300 hover:text-white"
                }`}
                title="Configurar quem pode ver este status"
              >
                {selectedLibraryStory ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    <span>Público Evergreen: <strong className="text-violet-200 font-semibold">{selectedContactIds.length} contatos novos</strong></span>
                  </>
                ) : privacyType === "contact" ? (
                  <>
                    <Users className="w-3.5 h-3.5 text-[#25d366]" />
                    <span>Público: <strong className="text-white font-semibold">Meus contatos</strong></span>
                  </>
                ) : privacyType === "deny-list" ? (
                  <>
                    <UserX className="w-3.5 h-3.5 text-amber-400" />
                    <span>Público: <strong className="text-amber-300 font-semibold">Exceto {selectedContactIds.length}</strong></span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                    <span>Público: <strong className="text-purple-300 font-semibold">Somente {selectedContactIds.length}</strong></span>
                  </>
                )}
                <ChevronRight className="w-3 h-3 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </button>


              <span className="text-[11px] text-zinc-500 tabular-nums">
                {activeTab === "text"
                  ? "Texto"
                  : activeTab === "image"
                  ? imageFile ? `${(imageFile.size / 1024 / 1024).toFixed(1)} MB` : ""
                  : videoFile ? `${(videoFile.size / 1024 / 1024).toFixed(1)} MB` : ""}
              </span>
            </div>

            {/* Linha do Botão de Publicar */}
            <div className="flex items-center justify-end pt-1">

              <button
                type="button"
                disabled={
                  isSubmitting ||
                  (activeTab === "text" && !textContent.trim()) ||
                  (activeTab === "image" && !imageBase64) ||
                  (activeTab === "video" && !videoBase64) ||
                  Boolean(
                    selectedLibraryStory &&
                    (
                      isLoadingEvergreenRecipients ||
                      evergreenLedgerError ||
                      !selectedStoryKey ||
                      selectedContactIds.length === 0
                    )
                  )
                }
                onClick={handlePublish}
                className="flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-full bg-[#00a884] text-white text-xs font-bold hover:bg-[#029070] active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Publicando...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Publicar Status</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SUB-MODAL DE SELEÇÃO DE PRIVACIDADE DO STATUS */}
      {isPrivacyModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl bg-[#111b21] border border-white/10 shadow-2xl overflow-hidden text-white">
            {/* Cabeçalho do Submodal */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#202c33]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#00a884]/20 flex items-center justify-center text-[#00a884]">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Privacidade do Status</h3>
                  <p className="text-[11px] text-zinc-400">Quem pode ver suas atualizações</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrivacyModalOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo com Opções */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!selectedLibraryStory && (
                <>
                  {/* Opção 1: Meus contatos */}
                  <label
                    onClick={() => setPrivacyType("contact")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      privacyType === "contact"
                        ? "bg-[#00a884]/10 border-[#00a884]/50 shadow-sm"
                        : "bg-[#202c33]/50 border-white/5 hover:bg-[#202c33]"
                    }`}
                  >
                    <div className="mt-0.5">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        privacyType === "contact" ? "border-[#00a884] bg-[#00a884]" : "border-zinc-500"
                      }`}>
                        {privacyType === "contact" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-[#25d366]" />
                        <span className="text-xs font-semibold text-white">Meus contatos</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Compartilhar com todos os seus contatos salvos no WhatsApp.
                      </p>
                    </div>
                  </label>

                  {/* Opção 2: Meus contatos, exceto... */}
                  <label
                    onClick={() => setPrivacyType("deny-list")}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      privacyType === "deny-list"
                        ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
                        : "bg-[#202c33]/50 border-white/5 hover:bg-[#202c33]"
                    }`}
                  >
                    <div className="mt-0.5">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        privacyType === "deny-list" ? "border-amber-500 bg-amber-500" : "border-zinc-500"
                      }`}>
                        {privacyType === "deny-list" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <UserX className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-semibold text-white">Meus contatos, exceto...</span>
                        {privacyType === "deny-list" && selectedContactIds.length > 0 && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                            {selectedContactIds.length} selecionados
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Oculte este status de contatos específicos.
                      </p>
                    </div>
                  </label>
                </>
              )}

              {/* Opção 3: Compartilhar somente com... */}
              <label
                onClick={() => setPrivacyType("allow-list")}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  privacyType === "allow-list"
                    ? "bg-purple-500/10 border-purple-500/50 shadow-sm"
                    : "bg-[#202c33]/50 border-white/5 hover:bg-[#202c33]"
                }`}
              >
                <div className="mt-0.5">
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    privacyType === "allow-list" ? "border-purple-500 bg-purple-500" : "border-zinc-500"
                  }`}>
                    {privacyType === "allow-list" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold text-white">Compartilhar somente com...</span>
                    {privacyType === "allow-list" && selectedContactIds.length > 0 && (
                      <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-bold">
                        {selectedContactIds.length} selecionados
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Apenas os contatos selecionados poderão visualizar este status.
                  </p>
                </div>
              </label>

              {/* Seletor de Contatos quando for deny-list ou allow-list */}
              {(privacyType === "deny-list" || privacyType === "allow-list") && (
                <div className="pt-2 border-t border-white/10 space-y-2.5 animate-in fade-in duration-200">
                  {/* Banner Evergreen Anti-Repetição */}
                  {selectedLibraryStory && (
                    <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-violet-300 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                          Story: {selectedLibraryStory.title}
                        </span>
                        <span className="text-[10px] bg-violet-500/20 text-violet-200 font-bold px-2 py-0.5 rounded-full">
                          {isLoadingEvergreenRecipients ? "conferindo..." : `${eligibleContactsList.length} novos`}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        {isLoadingEvergreenRecipients ? (
                          <>Conferindo no histórico permanente quem já recebeu este Story...</>
                        ) : evergreenLedgerError ? (
                          <span className="text-red-300">
                            Histórico permanente indisponível. A publicação está bloqueada para evitar repetição.
                          </span>
                        ) : hiddenContactsCount > 0 ? (
                          <>
                            <strong>{hiddenContactsCount}</strong> contato(s) que já receberam este Story foram <strong>ocultados automaticamente</strong>.
                          </>
                        ) : (
                          <>Nenhum contato recebeu este Story ainda. Todos os listados estão elegíveis.</>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">
                      {privacyType === "deny-list" ? "Ocultar status de:" : "Permitir visualização para:"}
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedContactIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearSelectedContacts}
                          className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                        >
                          Limpar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSelectAllFilteredContacts}
                        className="text-[11px] text-[#00a884] hover:underline font-medium cursor-pointer"
                      >
                        Marcar listados ({eligibleContactsList.length})
                      </button>
                    </div>
                  </div>

                  {/* Barra de Pesquisa */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#202c33] border border-white/5">
                    <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      value={contactSearchQuery}
                      onChange={(e) => setContactSearchQuery(e.target.value)}
                      placeholder="Pesquisar por nome ou telefone..."
                      className="flex-1 bg-transparent text-[16px] md:text-xs text-white placeholder-zinc-500 focus:outline-none"
                    />
                    {contactSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setContactSearchQuery("")}
                        className="text-zinc-500 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Lista de Contatos */}
                  <div className="max-h-60 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                    {isLoadingContacts || (selectedLibraryStory && isLoadingEvergreenRecipients) ? (
                      <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400">
                        <Loader2 className="w-5 h-5 animate-spin text-[#00a884]" />
                        <span className="text-xs">
                          {selectedLibraryStory && isLoadingEvergreenRecipients
                            ? "Conferindo quem já recebeu este Story..."
                            : "Carregando contatos..."}
                        </span>
                      </div>
                    ) : eligibleContactsList.length === 0 ? (
                      <div className="py-6 text-center text-xs text-zinc-500 px-4">
                        {selectedLibraryStory ? (
                          <>
                            <p className="font-semibold text-zinc-400">Nenhum contato novo pendente</p>
                            <p className="text-[11px] mt-1">Todos os contatos listados já receberam este Story anteriormente.</p>
                          </>
                        ) : (
                          "Nenhum contato encontrado."
                        )}
                      </div>
                    ) : (
                      eligibleContactsList.map((contact) => {

                        const isSelected = selectedContactIds.includes(contact.id);
                        return (
                          <div
                            key={contact.id}
                            onClick={() => toggleContactSelection(contact.id)}
                            className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                              isSelected ? "bg-white/10" : "hover:bg-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {contact.avatarUrl ? (
                                <img
                                  src={contact.avatarUrl}
                                  alt={contact.name}
                                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-white/10"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center font-bold text-xs text-white shrink-0">
                                  {contact.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">
                                  {contact.name}
                                </p>
                                <p className="text-[10px] text-zinc-400 truncate">
                                  {contact.number}
                                </p>
                              </div>
                            </div>

                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                              isSelected
                                ? privacyType === "deny-list"
                                  ? "border-amber-500 bg-amber-500 text-white"
                                  : "border-[#00a884] bg-[#00a884] text-white"
                                : "border-zinc-600 bg-transparent"
                            }`}>
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé do Submodal */}
            <div className="p-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] sm:pb-3.5 border-t border-white/10 bg-[#202c33] flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">
                {privacyType === "contact"
                  ? "Todos os contatos"
                  : `${selectedContactIds.length} contato(s) selecionado(s)`}
              </span>
              <button
                type="button"
                onClick={() => void handleApplyPrivacy()}
                disabled={
                  isLoadingPrivacy ||
                  Boolean(
                    selectedLibraryStory &&
                    (isLoadingEvergreenRecipients || evergreenLedgerError || !selectedStoryKey)
                  )
                }
                className="px-4 py-2 min-h-[44px] rounded-xl bg-[#00a884] hover:bg-[#029070] text-white text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait flex items-center gap-1.5"
              >
                {isLoadingPrivacy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isLoadingPrivacy ? "Salvando..." : "Concluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
