"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Folder,
  FolderPlus,
  Plus,
  FileText,
  Mic,
  Image as ImageIcon,
  Play,
  Pause,
  Send,
  CornerDownLeft,
  Trash2,
  Search,
  ArrowLeft,
  MoreVertical,
  Volume2,
  Sparkles,
  Loader2,
  Upload,
  Forward,
  Clock,
  ShieldCheck,
  Pencil,
  CheckSquare,
  Check,
  ChevronUp,
  ChevronDown,
  Download,
  Link2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useVault } from "@/presentation/hooks/useVault";
import { VaultFolder, VaultFolderWithStats, VaultItem } from "@/domain/entities/Vault";

export interface ActiveChatVaultInfo {
  id: string;
  fullName: string;
  username: string;
  avatar?: string;
  type?: "instagram" | "tinder";
}

/**
 * Realiza o download nativo de áudios e fotos do cofre flutuante.
 * Prioriza Blobs locais armazenados no IndexedDB ou efetua fetch/fallback seguro em URLs remotas do Supabase.
 */
async function downloadVaultMedia(item: VaultItem) {
  if (item.type === "text") return;

  const isAudio = item.type === "audio";
  const label = isAudio ? "áudio" : "foto";
  const toastId = toast.loading(`Iniciando download do ${label}...`);

  try {
    // 1. Prioridade: Se o Blob estiver armazenado no IndexedDB
    if (item.mediaBlob) {
      const blobUrl = URL.createObjectURL(item.mediaBlob);
      const ext = item.fileName?.split(".").pop() || (isAudio ? "mp3" : "jpg");
      const cleanTitle = item.title.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
      const fileName = item.fileName || `${cleanTitle}.${ext}`;

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      toast.success(`${isAudio ? "Áudio" : "Foto"} baixado com sucesso!`, { id: toastId });
      return;
    }

    // 2. Se possuir mediaUrl (Storage do Supabase ou URL direta)
    if (item.mediaUrl) {
      try {
        const response = await fetch(item.mediaUrl);
        if (!response.ok) throw new Error("Falha na resposta do servidor de armazenamento.");
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        let ext = item.fileName?.split(".").pop();
        if (!ext) {
          if (isAudio) {
            ext = item.mediaUrl.includes(".wav")
              ? "wav"
              : item.mediaUrl.includes(".m4a")
              ? "m4a"
              : item.mediaUrl.includes(".ogg")
              ? "ogg"
              : "mp3";
          } else {
            ext = item.mediaUrl.includes(".png")
              ? "png"
              : item.mediaUrl.includes(".webp")
              ? "webp"
              : item.mediaUrl.includes(".gif")
              ? "gif"
              : "jpg";
          }
        }

        const cleanTitle = item.title.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
        const fileName = item.fileName || `${cleanTitle}.${ext}`;

        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
        toast.success(`${isAudio ? "Áudio" : "Foto"} baixado com sucesso!`, { id: toastId });
        return;
      } catch (fetchErr) {
        console.warn("Falha no download via blob/fetch (CORS/rede), disparando download direto:", fetchErr);
        const a = document.createElement("a");
        a.href = item.mediaUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const cleanTitle = item.title.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
        a.download = item.fileName || `${cleanTitle}.${isAudio ? "mp3" : "jpg"}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success(`Download de ${label} iniciado!`, { id: toastId });
        return;
      }
    }

    throw new Error(`Arquivo não encontrado para download.`);
  } catch (err: any) {
    console.error(`Erro ao baixar ${label}:`, err);
    toast.error(`Não foi possível baixar o ${label}: ${err?.message || "Tente novamente"}`, { id: toastId });
  }
}


interface FloatingVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeChat?: ActiveChatVaultInfo | null;
  targetFolderId?: string;
  targetStageName?: string;
  onInsertText: (text: string) => void;
  onForwardItem?: (item: VaultItem, delaySeconds: number) => Promise<void>;
  onSendText?: (text: string) => Promise<void>;
  onSendAudioFile?: (file: File) => Promise<void>;
  onSendImageFile?: (file: File) => Promise<void>;
}

interface VaultItemRowProps {
  item: VaultItem;
  index: number;
  totalItems: number;
  allItems: VaultItem[];
  selectedItemIds: Set<string>;
  isSelectMode: boolean;
  toggleSelectItem: (id: string, e?: React.MouseEvent) => void;
  deleteItem: (id: string) => void;
  setEditingItem: (item: VaultItem) => void;
  setEditTitle: (title: string) => void;
  setEditContent: (content: string) => void;
  setEditLinkedItemId: (linkedItemId: string) => void;
  handleTogglePlayAudio: (item: VaultItem) => void;
  playingAudioId: string | null;
  audioProgress: number;
  onInsertText: (text: string) => void;
  onClose: () => void;
  handleInitiateForward: (item: VaultItem) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function VaultItemRow({
  item,
  index,
  totalItems,
  allItems,
  selectedItemIds,
  isSelectMode,
  toggleSelectItem,
  deleteItem,
  setEditingItem,
  setEditTitle,
  setEditContent,
  setEditLinkedItemId,
  handleTogglePlayAudio,
  playingAudioId,
  audioProgress,
  onInsertText,
  onClose,
  handleInitiateForward,
  onMoveUp,
  onMoveDown,
}: VaultItemRowProps) {
  const isFirst = index === 0;
  const isLast = index === totalItems - 1;
  const linkedItem = item.linkedItemId
    ? allItems.find((i) => i.id === item.linkedItemId)
    : undefined;

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 450, damping: 35 }}
      key={item.id}
      className={`p-3 rounded-2xl bg-[#1c1c1e] border flex flex-col gap-2 transition-all select-none relative ${
        selectedItemIds.has(item.id)
          ? "border-[#0095f6] bg-[#1a2332]/60 shadow-md"
          : "border-[#27272a] hover:border-zinc-700"
      }`}
      onClick={isSelectMode ? () => toggleSelectItem(item.id) : undefined}
    >
      {/* Cabeçalho do item */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Checkbox quando em modo de seleção múltipla */}
          {isSelectMode && (
            <button
              type="button"
              onClick={(e) => toggleSelectItem(item.id, e)}
              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                selectedItemIds.has(item.id)
                  ? "bg-[#0095f6] border-[#0095f6] text-white"
                  : "border-zinc-600 bg-[#27272a]/50 text-transparent hover:border-zinc-400"
              }`}
            >
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </button>
          )}

          <div className="w-6 h-6 rounded-lg bg-[#27272a] flex items-center justify-center shrink-0">
            {item.type === "text" && <FileText className="w-3 h-3 text-blue-400" />}
            {item.type === "audio" && <Mic className="w-3 h-3 text-emerald-400" />}
            {item.type === "image" && <ImageIcon className="w-3 h-3 text-purple-400" />}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <h4 className="text-xs font-bold text-white truncate">{item.title}</h4>
            {linkedItem && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-blue-400 font-medium truncate mt-0.5"
                title={`Envia junto com "${linkedItem.title}"`}
              >
                <Link2 className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                <span className="truncate">Junto com: {linkedItem.title}</span>
              </span>
            )}
          </div>
        </div>

        {/* Ações de Reordenação por Setas, Edição e Exclusão */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Setas para Subir e Descer a Posição */}
          <div className="flex items-center bg-[#27272a]/80 rounded-lg p-0.5 border border-[#3f3f46]/40">
            <button
              type="button"
              disabled={isFirst}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(index);
              }}
              className={`p-1 rounded-md transition-all cursor-pointer ${
                isFirst
                  ? "text-zinc-600 opacity-25 cursor-not-allowed"
                  : "text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90"
              }`}
              title={isFirst ? "Primeiro item da lista" : "Mover para cima"}
              aria-label="Mover para cima"
            >
              <ChevronUp className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>

            <button
              type="button"
              disabled={isLast}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(index);
              }}
              className={`p-1 rounded-md transition-all cursor-pointer ${
                isLast
                  ? "text-zinc-600 opacity-25 cursor-not-allowed"
                  : "text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90"
              }`}
              title={isLast ? "Último item da lista" : "Mover para baixo"}
              aria-label="Mover para baixo"
            >
              <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>

          {(item.type === "audio" || item.type === "image") && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadVaultMedia(item);
              }}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer active:scale-90"
              title={item.type === "audio" ? "Baixar áudio" : "Baixar foto"}
              aria-label={item.type === "audio" ? "Baixar áudio" : "Baixar foto"}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditingItem(item);
              setEditTitle(item.title);
              setEditContent(item.content || "");
              setEditLinkedItemId(item.linkedItemId || "");
            }}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer active:scale-90"
            title="Editar item"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteItem(item.id);
            }}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer active:scale-90"
            title="Excluir item"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Conteúdo de acordo com o tipo */}
      {item.type === "text" && (
        <div className="bg-[#18181b] border border-[#262626] rounded-xl p-2.5">
          <p className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {item.content}
          </p>
        </div>
      )}

      {item.type === "audio" && (
        <div className="bg-[#18181b] border border-[#262626] rounded-xl p-2.5 flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePlayAudio(item);
            }}
            className="w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform cursor-pointer shadow-sm"
            title={playingAudioId === item.id ? "Pausar áudio" : "Ouvir áudio"}
          >
            {playingAudioId === item.id ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <span>Áudio Baixado</span>
              <span>{item.duration ? `${item.duration}s` : "Áudio"}</span>
            </div>

            <div className="w-full bg-[#27272a] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-100"
                style={{
                  width: `${playingAudioId === item.id ? audioProgress : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {item.type === "image" && (
        <div className="bg-[#18181b] border border-[#262626] rounded-xl p-2 flex items-center gap-3">
          {item.mediaUrl ? (
            <img
              src={item.mediaUrl}
              alt={item.title}
              className="w-16 h-16 rounded-lg object-cover border border-[#27272a] shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-[#27272a] flex items-center justify-center shrink-0">
              <ImageIcon className="w-6 h-6 text-zinc-500" />
            </div>
          )}

          <div className="flex-1 min-w-0 text-xs text-zinc-400">
            <p className="truncate font-medium text-white">{item.fileName || item.title}</p>
            <p className="text-[10px] mt-0.5">
              {item.fileSize ? `${(item.fileSize / 1024).toFixed(0)} KB` : "Foto salva"}
            </p>
          </div>
        </div>
      )}

      {/* Barra de Ações do Item */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {item.type === "text" && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInsertText(item.content || "");
                onClose();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
              title="Inserir no campo para editar antes de mandar"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              <span>Inserir no campo</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleInitiateForward(item);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#0095f6] hover:bg-[#0081d6] text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
              title="Encaminhar para a conversa com delay no servidor"
            >
              <Forward className="w-3.5 h-3.5" />
              <span>Encaminhar</span>
            </button>
          </>
        )}

        {item.type === "audio" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadVaultMedia(item);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border border-[#3f3f46]/40 shadow-sm"
              title="Baixar áudio para o aparelho"
              aria-label="Baixar áudio"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Baixar</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleInitiateForward(item);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
              title="Encaminhar áudio com delay igual à duração"
            >
              <Forward className="w-3.5 h-3.5" />
              <span>Encaminhar Áudio</span>
            </button>
          </div>
        )}

        {item.type === "image" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadVaultMedia(item);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border border-[#3f3f46]/40 shadow-sm"
              title="Baixar foto para o aparelho"
              aria-label="Baixar foto"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" />
              <span>Baixar</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleInitiateForward(item);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
              title="Encaminhar foto para a conversa aberta"
            >
              <Forward className="w-3.5 h-3.5" />
              <span>Encaminhar Foto</span>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function FloatingVaultModal({
  isOpen,
  onClose,
  activeChat,
  targetFolderId,
  targetStageName,
  onInsertText,
  onForwardItem,
  onSendText,
  onSendAudioFile,
  onSendImageFile,
}: FloatingVaultModalProps) {
  const {
    folders,
    activeFolder,
    items,
    isLoading,
    searchQuery,
    searchResults,
    setActiveFolder,
    setSearchQuery,
    createFolder,
    renameFolder,
    deleteFolder,
    addTextItem,
    addAudioItem,
    addImageItem,
    updateItem,
    reorderItems,
    deleteItem,
  } = useVault();

  // Referência para controlar a auto-navegação para a pasta da etapa ao abrir o modal
  const hasAutoNavigatedRef = useRef(false);

  // Identifica se uma pasta corresponde à etapa atual do chat ativo
  const isCurrentStageFolder = (folder: VaultFolder | VaultFolderWithStats | null) => {
    if (!folder) return false;
    if (targetFolderId && folder.id === targetFolderId) return true;
    if (targetStageName) {
      const cleanTarget = targetStageName.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
      const cleanFolder = folder.name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
      if (cleanTarget && cleanFolder && (cleanFolder.includes(cleanTarget) || cleanTarget.includes(cleanFolder))) {
        return true;
      }
    }
    return false;
  };

  // Auto-navega para a pasta correspondente à etapa do chat ativo na abertura
  useEffect(() => {
    if (!isOpen) {
      hasAutoNavigatedRef.current = false;
      return;
    }

    // Se já auto-navegou nesta sessão de abertura, preserva navegação manual do usuário
    if (hasAutoNavigatedRef.current) return;

    if (folders.length > 0 && (targetFolderId || targetStageName)) {
      // 1. Tenta correspondência exata por folderId
      let matchedFolder = targetFolderId
        ? folders.find((f) => f.id === targetFolderId)
        : null;

      // 2. Se não encontrou por ID, tenta por nome da etapa
      if (!matchedFolder && targetStageName) {
        const cleanStageName = targetStageName.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        matchedFolder =
          folders.find((f) => {
            const cleanFolderName = f.name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
            return (
              cleanFolderName.includes(cleanStageName) ||
              cleanStageName.includes(cleanFolderName)
            );
          }) || null;
      }

      if (matchedFolder) {
        setActiveFolder(matchedFolder);
        hasAutoNavigatedRef.current = true;
      }
    }
  }, [isOpen, folders, targetFolderId, targetStageName, setActiveFolder]);

  // Estados de criação de conteúdo
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<VaultFolderWithStats | VaultFolder | null>(null);

  // Estados de edição de pasta (Renomear)
  const [folderToEdit, setFolderToEdit] = useState<VaultFolderWithStats | VaultFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState("");

  // Estados de edição de item
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editLinkedItemId, setEditLinkedItemId] = useState<string>("");

  // Estados de seleção múltipla para envio em lote
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isForwardingMultiple, setIsForwardingMultiple] = useState(false);
  const [multipleForwardStep, setMultipleForwardStep] = useState<number>(0);

  const [activeTabToAdd, setActiveTabToAdd] = useState<"text" | "audio" | "image" | null>(null);
  const [newTextTitle, setNewTextTitle] = useState("");
  const [newTextContent, setNewTextContent] = useState("");
  const [newTextLinkedItemId, setNewTextLinkedItemId] = useState<string>("");

  const [newMediaTitle, setNewMediaTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [newMediaLinkedItemId, setNewMediaLinkedItemId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendingItemId, setSendingItemId] = useState<string | null>(null);

  // Estados de confirmação de encaminhamento com delay
  const [forwardingItem, setForwardingItem] = useState<VaultItem | null>(null);
  const [isForwarding, setIsForwarding] = useState(false);

  // Áudio Player interno
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Parar áudio ao fechar modal ou mudar de pasta
  useEffect(() => {
    if (!isOpen || !activeFolder) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingAudioId(null);
    }
  }, [isOpen, activeFolder]);

  if (!isOpen) return null;

  // Gerenciamento de reprodução de áudio
  const handleTogglePlayAudio = (item: VaultItem) => {
    if (playingAudioId === item.id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const src = item.mediaUrl || (item.mediaBlob ? URL.createObjectURL(item.mediaBlob) : null);
    if (!src) return;

    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingAudioId(item.id);
    setAudioProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.onended = () => {
      setPlayingAudioId(null);
      setAudioProgress(0);
    };

    audio.play().catch((err) => {
      console.warn("Erro ao reproduzir áudio:", err);
      setPlayingAudioId(null);
    });
  };

  // Submeter nova pasta
  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setIsSubmitting(true);
      await createFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    } catch (err) {
      alert("Erro ao criar pasta: " + (err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submeter edição/renomeação de pasta
  const handleEditFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderToEdit || !editFolderName.trim()) return;
    try {
      setIsSubmitting(true);
      const newName = editFolderName.trim();
      await renameFolder(folderToEdit.id, newName);
      toast.success(`Pasta renomeada para "${newName}"!`);
      setFolderToEdit(null);
      setEditFolderName("");
    } catch (err) {
      console.error("Erro ao renomear pasta:", err);
      toast.error("Erro ao renomear pasta: " + ((err as Error)?.message || "Tente novamente"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submeter novo texto
  const handleCreateTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFolder || !newTextTitle.trim() || !newTextContent.trim()) return;
    try {
      setIsSubmitting(true);
      const targetLinked = newTextLinkedItemId || undefined;
      await addTextItem(activeFolder.id, newTextTitle.trim(), newTextContent.trim(), targetLinked);
      setNewTextTitle("");
      setNewTextContent("");
      setNewTextLinkedItemId("");
      setActiveTabToAdd(null);
      toast.success("Texto salvo no cofre com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar texto:", err);
      toast.error("Erro ao salvar texto: " + (err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submeter novo áudio ou foto
  const handleCreateMediaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFolder || !newMediaTitle.trim() || !selectedFile) return;

    try {
      setIsSubmitting(true);
      const targetLinked = newMediaLinkedItemId || undefined;
      if (activeTabToAdd === "audio") {
        await addAudioItem(activeFolder.id, newMediaTitle.trim(), selectedFile, targetLinked);
        toast.success("Áudio salvo no cofre com sucesso!");
      } else if (activeTabToAdd === "image") {
        await addImageItem(activeFolder.id, newMediaTitle.trim(), selectedFile, targetLinked);
        toast.success("Foto salva no cofre com sucesso!");
      }
      setNewMediaTitle("");
      setSelectedFile(null);
      setNewMediaLinkedItemId("");
      setActiveTabToAdd(null);
    } catch (err) {
      console.error("Erro ao salvar arquivo:", err);
      toast.error("Erro ao salvar arquivo: " + (err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Ações de encaminhamento com confirmação e delay assíncrono no servidor
  const handleInitiateForward = (item: VaultItem) => {
    if (!activeChat) {
      alert("Abra ou selecione uma conversa antes de encaminhar este item.");
      return;
    }
    setForwardingItem(item);
  };

  const handleConfirmForward = async () => {
    if (!forwardingItem) return;
    try {
      setIsForwarding(true);
      // O 1º item demora a sua cadência (áudio = tempo do áudio, texto/imagem = 10s)
      const firstDelay = getItemCadenceSeconds(forwardingItem);

      const sendSingle = async (it: VaultItem, d: number) => {
        if (onForwardItem) {
          await onForwardItem(it, d);
        } else if (it.type === "text" && onSendText) {
          await onSendText(it.content || "");
        } else if (it.type === "audio" && onSendAudioFile && it.mediaBlob) {
          const audioFile = new File(
            [it.mediaBlob],
            it.fileName || "audio.wav",
            { type: it.mimeType || "audio/wav" }
          );
          await onSendAudioFile(audioFile);
        } else if (it.type === "image" && onSendImageFile && it.mediaBlob) {
          const imgFile = new File(
            [it.mediaBlob],
            it.fileName || "image.jpg",
            { type: it.mimeType || "image/jpeg" }
          );
          await onSendImageFile(imgFile);
        }
      };

      await sendSingle(forwardingItem, firstDelay);

      // Se possuir item vinculado, o 2º item demora o tempo do 1º + o tempo do 2º ("e assim vai")
      if (forwardingItem.linkedItemId) {
        const linkedItem = items.find((i) => i.id === forwardingItem.linkedItemId);
        if (linkedItem) {
          const secondDuration = getItemCadenceSeconds(linkedItem);
          await sendSingle(linkedItem, secondDuration);
        }
      }

      setForwardingItem(null);
      onClose();
    } catch (err) {
      alert("Erro ao encaminhar item: " + (err as Error).message);
    } finally {
      setIsForwarding(false);
    }
  };

  const toggleSelectItem = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getItemCadenceSeconds = (item: VaultItem): number => {
    if (item.type === "audio") {
      // Para áudio, leva o tempo exato do áudio (limitado entre 2s e 60s)
      if (typeof item.duration === "number" && item.duration > 0) {
        return Math.min(Math.max(Math.round(item.duration), 2), 60);
      }
      return 10;
    }
    // Para texto e imagem, leva 10 segundos
    return 10;
  };

  const handleForwardSelectedItems = async () => {
    const selectedList = items.filter((i) => selectedItemIds.has(i.id));
    if (selectedList.length === 0) return;

    setIsForwardingMultiple(true);
    setMultipleForwardStep(0);

    try {
      let cumulativeDelay = 0;

      for (let i = 0; i < selectedList.length; i++) {
        const item = selectedList[i];
        setMultipleForwardStep(i + 1);

        // O 1º balão demora a sua cadência, o 2º soma a sua, e assim sucessivamente
        const itemDuration = getItemCadenceSeconds(item);
        cumulativeDelay += itemDuration;
        const currentDelay = cumulativeDelay;

        if (onForwardItem) {
          await onForwardItem(item, itemDuration);
        } else if (item.type === "text" && item.content) {
          if (onSendText) {
            await onSendText(item.content);
          } else {
            onInsertText(item.content);
          }
        }

        // Intervalo suave de 150ms entre os registros para garantir timestamps e IDs distintos na UI
        if (i < selectedList.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      toast.success(
        `${selectedList.length} itens agendados no chat! Áudios levam o tempo da gravação e textos 10s.`,
        { duration: 4500 }
      );
      setSelectedItemIds(new Set());
      setIsSelectMode(false);
      onClose();
    } catch (err) {
      console.error("Erro ao enviar itens selecionados:", err);
      toast.error("Ocorreu um erro ao enviar alguns itens.");
    } finally {
      setIsForwardingMultiple(false);
      setMultipleForwardStep(0);
    }
  };

  // Reordenação de itens por setas (subir e descer posições)
  const handleMoveItemUp = (index: number) => {
    if (index <= 0 || !items || items.length <= 1) return;
    const next = [...items];
    const temp = next[index];
    next[index] = next[index - 1];
    next[index - 1] = temp;
    reorderItems(next);
  };

  const handleMoveItemDown = (index: number) => {
    if (!items || index >= items.length - 1) return;
    const next = [...items];
    const temp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = temp;
    reorderItems(next);
  };

  const handleEditItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editTitle.trim()) return;

    try {
      setIsSubmitting(true);
      const targetLinkedId = editLinkedItemId && editLinkedItemId !== editingItem.id ? editLinkedItemId : undefined;
      await updateItem(editingItem.id, {
        title: editTitle.trim(),
        content: editingItem.type === "text" ? editContent.trim() : editingItem.content,
        linkedItemId: targetLinkedId,
      });
      toast.success("Item atualizado com sucesso!");
      setEditingItem(null);
    } catch (err) {
      console.error("Erro ao atualizar item:", err);
      toast.error("Erro ao salvar alterações.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-lg bg-[#121212] border border-[#27272a] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col h-[85vh] sm:h-[650px] overflow-hidden text-white"
      >
        {/* Cabeçalho do Modal */}
        <div className="shrink-0 px-4 py-3.5 border-b border-[#262626] bg-[#18181b]/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {activeFolder ? (
              <button
                type="button"
                onClick={() => {
                  setActiveFolder(null);
                  setActiveTabToAdd(null);
                }}
                className="w-8 h-8 rounded-full bg-[#27272a] hover:bg-[#3f3f46] flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer"
                title="Voltar às pastas"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-xl bg-[#0095f6]/20 border border-[#0095f6]/40 flex items-center justify-center text-[#0095f6]">
                <Folder className="w-4 h-4" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="text-sm font-bold text-white truncate max-w-[170px] sm:max-w-[220px]">
                  {activeFolder ? activeFolder.name : "Pastas & Respostas Rápidas"}
                </h2>
                {activeFolder && isCurrentStageFolder(activeFolder) && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                    Etapa Atual
                  </span>
                )}
                {activeFolder && (
                  <button
                    type="button"
                    onClick={() => {
                      setFolderToEdit(activeFolder);
                      setEditFolderName(activeFolder.name);
                    }}
                    className="p-1 rounded-md text-zinc-400 hover:text-[#0095f6] hover:bg-[#0095f6]/15 active:scale-90 transition-all cursor-pointer"
                    title={`Editar nome da pasta "${activeFolder.name}"`}
                    aria-label={`Editar nome da pasta ${activeFolder.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-zinc-400">
                {activeFolder
                  ? `${items.length} itens armazenados`
                  : "Organize textos, áudios e fotos para envio ágil"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#27272a] hover:bg-[#3f3f46] text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra de Busca quando estiver na raiz */}
        {!activeFolder && (
          <div className="p-3 border-b border-[#262626] bg-[#141415] flex items-center gap-2">
            <div className="flex-1 bg-[#1c1c1e] border border-[#27272a] rounded-xl px-3 py-2 flex items-center gap-2 text-xs">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Pesquisar em todo o cofre..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-white placeholder-zinc-500 focus:outline-none flex-1 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsCreatingFolder(true)}
              className="px-3 py-2 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] active:scale-95 text-white text-xs font-semibold flex items-center gap-1.5 transition-transform cursor-pointer shrink-0 shadow-sm"
              title="Criar nova pasta"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Nova Pasta</span>
            </button>
          </div>
        )}

        {/* Barra de Ações dentro da pasta */}
        {activeFolder && !activeTabToAdd && (
          <div className="p-2.5 border-b border-[#262626] bg-[#141415] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTabToAdd("text")}
                className="px-2.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>+ Texto</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTabToAdd("audio");
                  setSelectedFile(null);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                <span>+ Áudio</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTabToAdd("image");
                  setSelectedFile(null);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                <span>+ Foto</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsSelectMode((prev) => !prev);
                  if (isSelectMode) setSelectedItemIds(new Set());
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isSelectMode
                    ? "bg-[#0095f6] text-white shadow-sm"
                    : "bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300"
                }`}
                title="Selecionar múltiplos itens para enviar"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>{isSelectMode ? "Concluir" : "Selecionar"}</span>
              </button>

              <button
                type="button"
                onClick={() => setFolderToDelete(activeFolder)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Excluir esta pasta"
                aria-label="Excluir esta pasta"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Formulário de Criação de Pasta */}
        <AnimatePresence>
          {isCreatingFolder && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              onSubmit={handleCreateFolderSubmit}
              className="p-3 bg-[#1c1c1e] border-b border-[#262626] flex items-center gap-2 overflow-hidden"
            >
              <input
                type="text"
                placeholder="Nome da pasta (ex: Áudios de Fechamento)"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                className="flex-1 bg-[#27272a] border border-[#3f3f46] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSubmitting || !newFolderName.trim()}
                className="px-3 py-2 rounded-xl bg-[#0095f6] text-white text-xs font-semibold hover:bg-[#0081d6] active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingFolder(false)}
                className="px-2.5 py-2 rounded-xl bg-[#27272a] text-zinc-400 hover:text-white text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Formulário de Criação de Item (Texto, Áudio ou Foto) */}
        <AnimatePresence>
          {activeTabToAdd && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-3.5 bg-[#18181b] border-b border-[#262626] overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  {activeTabToAdd === "text" && <FileText className="w-3.5 h-3.5 text-blue-400" />}
                  {activeTabToAdd === "audio" && <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                  {activeTabToAdd === "image" && <ImageIcon className="w-3.5 h-3.5 text-purple-400" />}
                  Adicionar {activeTabToAdd === "text" ? "Texto" : activeTabToAdd === "audio" ? "Áudio Gravado / Baixado" : "Foto"}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTabToAdd(null)}
                  className="text-zinc-500 hover:text-white text-xs"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeTabToAdd === "text" && (
                <form onSubmit={handleCreateTextSubmit} className="space-y-2">
                  <input
                    type="text"
                    placeholder="Título (ex: Mensagem de Boas-Vindas)"
                    value={newTextTitle}
                    onChange={(e) => setNewTextTitle(e.target.value)}
                    required
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none"
                  />
                  <textarea
                    rows={3}
                    placeholder="Escreva a resposta rápida..."
                    value={newTextContent}
                    onChange={(e) => setNewTextContent(e.target.value)}
                    required
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none resize-none"
                  />

                  <div>
                    <label className="text-[11px] font-medium text-zinc-400 block mb-1 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Enviar junto com outro item (Linkar combo):</span>
                    </label>
                    <select
                      value={newTextLinkedItemId}
                      onChange={(e) => setNewTextLinkedItemId(e.target.value)}
                      className="w-full bg-[#27272a] border border-[#3f3f46] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0095f6] cursor-pointer"
                    >
                      <option value="">Nenhum (Item avulso / enviado sozinho)</option>
                      {items.map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.type === "audio" ? "🎙️ [Áudio]" : other.type === "text" ? "📝 [Texto]" : "📷 [Foto]"} {other.title}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                      Ao linkar, a IA e o sistema enviarão os dois itens juntos no mesmo turno em balões seguidos.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTabToAdd(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !newTextTitle.trim() || !newTextContent.trim()}
                      className="px-3.5 py-1.5 rounded-lg bg-[#0095f6] text-white text-xs font-semibold hover:bg-[#0081d6] active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      Salvar Texto
                    </button>
                  </div>
                </form>
              )}

              {(activeTabToAdd === "audio" || activeTabToAdd === "image") && (
                <form onSubmit={handleCreateMediaSubmit} className="space-y-2.5">
                  <input
                    type="text"
                    placeholder={`Título (ex: ${activeTabToAdd === "audio" ? "Áudio Explicando Garantia" : "Catálogo do Produto"})`}
                    value={newMediaTitle}
                    onChange={(e) => setNewMediaTitle(e.target.value)}
                    required
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none"
                  />

                  {/* Seletor de Arquivo */}
                  <div className="flex flex-col gap-1.5">
                    {activeTabToAdd === "audio" && (
                      <>
                        <input
                          ref={audioInputRef}
                          type="file"
                          accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setSelectedFile(file);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => audioInputRef.current?.click()}
                          className="w-full border border-dashed border-[#3f3f46] hover:border-emerald-400/50 bg-[#27272a]/50 hover:bg-[#27272a] rounded-xl p-3 flex items-center justify-center gap-2 text-xs text-zinc-300 transition-colors cursor-pointer"
                        >
                          <Upload className="w-4 h-4 text-emerald-400" />
                          <span>
                            {selectedFile ? selectedFile.name : "Selecionar áudio baixado (.mp3, .wav, .m4a)"}
                          </span>
                        </button>
                      </>
                    )}

                    {activeTabToAdd === "image" && (
                      <>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*,.png,.jpg,.jpeg,.webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setSelectedFile(file);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="w-full border border-dashed border-[#3f3f46] hover:border-purple-400/50 bg-[#27272a]/50 hover:bg-[#27272a] rounded-xl p-3 flex items-center justify-center gap-2 text-xs text-zinc-300 transition-colors cursor-pointer"
                        >
                          <Upload className="w-4 h-4 text-purple-400" />
                          <span>
                            {selectedFile ? selectedFile.name : "Selecionar foto (.png, .jpg, .webp)"}
                          </span>
                        </button>
                      </>
                    )}

                    {selectedFile && (
                      <p className="text-[10px] text-zinc-400 px-1">
                        Tamanho: {(selectedFile.size / 1024).toFixed(0)} KB · Tipo: {selectedFile.type || "Arquivo de mídia"}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-zinc-400 block mb-1 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Enviar junto com outro item (Linkar combo):</span>
                    </label>
                    <select
                      value={newMediaLinkedItemId}
                      onChange={(e) => setNewMediaLinkedItemId(e.target.value)}
                      className="w-full bg-[#27272a] border border-[#3f3f46] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0095f6] cursor-pointer"
                    >
                      <option value="">Nenhum (Item avulso / enviado sozinho)</option>
                      {items.map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.type === "audio" ? "🎙️ [Áudio]" : other.type === "text" ? "📝 [Texto]" : "📷 [Foto]"} {other.title}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                      Ao linkar, a IA e o sistema enviarão os dois itens juntos no mesmo turno em balões seguidos.
                    </p>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTabToAdd(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !newMediaTitle.trim() || !selectedFile}
                      className="px-3.5 py-1.5 rounded-lg bg-[#0095f6] text-white text-xs font-semibold hover:bg-[#0081d6] active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {isSubmitting
                          ? activeTabToAdd === "audio"
                            ? "Convertendo & Salvando..."
                            : "Enviando Foto..."
                          : "Salvar no Cofre"}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Corpo Principal do Modal */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
          {/* Resultados de Busca Global */}
          {searchQuery.trim() ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400">
                Resultados da busca ({searchResults.length}):
              </p>
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 text-xs">
                  Nenhum item encontrado com o termo &quot;{searchQuery}&quot;.
                </div>
              ) : (
                searchResults.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-[#1c1c1e] border border-[#27272a] flex items-start gap-3"
                  >
                    <div className="w-7 h-7 rounded-lg bg-[#27272a] flex items-center justify-center shrink-0">
                      {item.type === "text" && <FileText className="w-3.5 h-3.5 text-blue-400" />}
                      {item.type === "audio" && <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                      {item.type === "image" && <ImageIcon className="w-3.5 h-3.5 text-purple-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate">{item.title}</p>
                      {item.type === "text" && (
                        <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
                          {item.content}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.type === "text" && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onInsertText(item.content || "");
                              onClose();
                            }}
                            className="p-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs cursor-pointer"
                            title="Inserir no campo de mensagem"
                          >
                            <CornerDownLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateForward(item)}
                            className="p-1.5 rounded-lg bg-[#0095f6] hover:bg-[#0081d6] text-white text-xs cursor-pointer"
                            title="Encaminhar mensagem com delay no servidor"
                          >
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {item.type === "audio" && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadVaultMedia(item);
                            }}
                            className="p-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs cursor-pointer flex items-center gap-1 active:scale-90 transition-transform"
                            title="Baixar áudio"
                            aria-label="Baixar áudio"
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-400" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateForward(item)}
                            className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs cursor-pointer flex items-center gap-1"
                            title="Encaminhar áudio com delay no servidor"
                          >
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {item.type === "image" && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadVaultMedia(item);
                            }}
                            className="p-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs cursor-pointer flex items-center gap-1 active:scale-90 transition-transform"
                            title="Baixar foto"
                            aria-label="Baixar foto"
                          >
                            <Download className="w-3.5 h-3.5 text-purple-400" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateForward(item)}
                            className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs cursor-pointer flex items-center gap-1"
                            title="Encaminhar foto"
                          >
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : !activeFolder ? (
            /* Visualização de Pastas (Raiz) */
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 px-1">Pastas Criadas</p>

              {isLoading && folders.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-xs">Carregando cofre...</span>
                </div>
              ) : folders.length === 0 ? (
                <div className="text-center py-12 space-y-2 text-zinc-400">
                  <Folder className="w-10 h-10 mx-auto text-zinc-600" />
                  <p className="text-xs font-medium">Nenhuma pasta criada ainda.</p>
                  <p className="text-[11px] text-zinc-500">
                    Crie uma pasta para organizar seus scripts, áudios e fotos.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {folders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => setActiveFolder(folder)}
                      className="p-3.5 rounded-2xl bg-[#1c1c1e] hover:bg-[#252528] border border-[#27272a] hover:border-zinc-700 transition-all cursor-pointer flex flex-col justify-between group text-left active:scale-98"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border"
                          style={{
                            backgroundColor: `${folder.color || "#0095f6"}15`,
                            borderColor: `${folder.color || "#0095f6"}40`,
                            color: folder.color || "#0095f6",
                          }}
                        >
                          <Folder className="w-4 h-4 fill-current/20" />
                        </div>

                        <div className="flex items-center gap-1">
                          {isCurrentStageFolder(folder) && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                              Etapa Atual
                            </span>
                          )}
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#27272a] text-zinc-300">
                            {folder.totalItems} {folder.totalItems === 1 ? "item" : "itens"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderToEdit(folder);
                              setEditFolderName(folder.name);
                            }}
                            className="p-1 rounded-lg text-zinc-400 hover:text-[#0095f6] hover:bg-[#0095f6]/15 active:scale-90 transition-all cursor-pointer"
                            title={`Editar nome da pasta "${folder.name}"`}
                            aria-label={`Editar nome da pasta ${folder.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderToDelete(folder);
                            }}
                            className="p-1 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/15 active:scale-90 transition-all cursor-pointer"
                            title={`Excluir pasta "${folder.name}"`}
                            aria-label={`Excluir pasta ${folder.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3">
                        <h3 className="text-xs font-bold text-white group-hover:text-[#0095f6] transition-colors truncate">
                          {folder.name}
                        </h3>

                        {/* Estatísticas por tipo */}
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-400">
                          {folder.textCount > 0 && (
                            <span className="flex items-center gap-0.5 text-blue-400">
                              <FileText className="w-3 h-3" /> {folder.textCount}
                            </span>
                          )}
                          {folder.audioCount > 0 && (
                            <span className="flex items-center gap-0.5 text-emerald-400">
                              <Mic className="w-3 h-3" /> {folder.audioCount}
                            </span>
                          )}
                          {folder.imageCount > 0 && (
                            <span className="flex items-center gap-0.5 text-purple-400">
                              <ImageIcon className="w-3 h-3" /> {folder.imageCount}
                            </span>
                          )}
                          {folder.totalItems === 0 && <span>Vazia</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Visualização de Itens Dentro da Pasta Ativa */
            <div className="space-y-2.5">
              {isLoading && items.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-xs">Carregando itens...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12 space-y-2 text-zinc-400">
                  <div className="w-12 h-12 rounded-2xl bg-[#1c1c1e] border border-[#27272a] mx-auto flex items-center justify-center text-zinc-500">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-medium text-white">Esta pasta está vazia</p>
                  <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                    Use os botões acima para adicionar textos prontos, carregar áudios baixados ou fotos.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {items.map((item, index) => (
                    <VaultItemRow
                      key={item.id}
                      item={item}
                      index={index}
                      totalItems={items.length}
                      allItems={items}
                      selectedItemIds={selectedItemIds}
                      isSelectMode={isSelectMode}
                      toggleSelectItem={toggleSelectItem}
                      deleteItem={deleteItem}
                      setEditingItem={setEditingItem}
                      setEditTitle={setEditTitle}
                      setEditContent={setEditContent}
                      setEditLinkedItemId={setEditLinkedItemId}
                      handleTogglePlayAudio={handleTogglePlayAudio}
                      playingAudioId={playingAudioId}
                      audioProgress={audioProgress}
                      onInsertText={onInsertText}
                      onClose={onClose}
                      handleInitiateForward={handleInitiateForward}
                      onMoveUp={handleMoveItemUp}
                      onMoveDown={handleMoveItemDown}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Barra de Envio Múltiplo Flutuante quando houver itens selecionados */}
        {activeFolder && selectedItemIds.size > 0 && (
          <div className="p-3 border-t border-[#262626] bg-[#18181b] flex items-center justify-between gap-3 shrink-0 shadow-xl z-20">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-6 h-6 rounded-full bg-[#0095f6]/20 text-[#0095f6] font-bold text-xs flex items-center justify-center">
                {selectedItemIds.size}
              </span>
              <span>{selectedItemIds.size === 1 ? "item selecionado" : "itens selecionados"}</span>
            </div>

            <button
              type="button"
              onClick={handleForwardSelectedItems}
              disabled={isForwardingMultiple}
              className="px-4 py-2 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] active:scale-95 text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
            >
              {isForwardingMultiple ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Enviando {multipleForwardStep}/{selectedItemIds.size}...</span>
                </>
              ) : (
                <>
                  <Forward className="w-4 h-4" />
                  <span>Encaminhar ({selectedItemIds.size})</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Diálogo de Confirmação de Encaminhamento com Destinatário e Delay */}
        <AnimatePresence>
          {forwardingItem && activeChat && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 15 }}
                className="w-full max-w-sm bg-[#18181b] border border-[#2e2e32] rounded-3xl p-5 shadow-2xl space-y-4 text-white"
              >
                {/* Cabeçalho */}
                <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#0095f6]/20 text-[#0095f6] flex items-center justify-center">
                      <Forward className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-white">Confirmar Encaminhamento</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForwardingItem(null)}
                    className="text-zinc-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Destinatário Aberto */}
                <div className="bg-[#121214] border border-[#27272a] rounded-2xl p-3 flex items-center gap-3">
                  {activeChat.avatar ? (
                    <img
                      src={activeChat.avatar}
                      alt={activeChat.fullName}
                      className="w-10 h-10 rounded-full object-cover border border-[#3f3f46]"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#27272a] flex items-center justify-center text-sm font-bold text-white">
                      {activeChat.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-400 font-medium">Encaminhar para:</p>
                    <h4 className="text-sm font-bold text-white truncate">{activeChat.fullName}</h4>
                    <p className="text-[11px] text-zinc-500 truncate">@{activeChat.username}</p>
                  </div>
                </div>

                {/* Detalhes do Conteúdo */}
                <div className="bg-[#202024] border border-[#2e2e32] rounded-2xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-[#27272a] flex items-center justify-center">
                      {forwardingItem.type === "audio" && <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                      {forwardingItem.type === "text" && <FileText className="w-3.5 h-3.5 text-blue-400" />}
                      {forwardingItem.type === "image" && <ImageIcon className="w-3.5 h-3.5 text-purple-400" />}
                    </div>
                    <p className="text-xs font-semibold text-white truncate">{forwardingItem.title}</p>
                  </div>

                  {forwardingItem.type === "audio" && (
                    <p className="text-[11px] text-zinc-300">
                      Áudio com duração de <strong className="text-emerald-400">{forwardingItem.duration || 5}s</strong>.
                    </p>
                  )}

                  {forwardingItem.type === "text" && (
                    <p className="text-[11px] text-zinc-300 line-clamp-2 italic bg-[#141416] p-2 rounded-lg border border-[#27272a]">
                      &quot;{forwardingItem.content}&quot;
                    </p>
                  )}
                </div>

                {/* Item Vinculado (Combo em Dupla) */}
                {(() => {
                  const linked = forwardingItem.linkedItemId
                    ? items.find((i) => i.id === forwardingItem.linkedItemId)
                    : null;
                  if (!linked) return null;
                  return (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-3 space-y-1.5 text-blue-300 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-blue-400">
                        <Link2 className="w-4 h-4 shrink-0" />
                        <span>Item Vinculado: Envio em Dupla</span>
                      </div>
                      <p className="text-[11px] text-blue-200/90 leading-relaxed">
                        Este item está vinculado a <strong>&quot;{linked.title}&quot;</strong> ({linked.type === "audio" ? "Áudio" : linked.type === "text" ? "Texto" : "Foto"}). Ambos serão enviados em sequência no chat com intervalo humanizado!
                      </p>
                    </div>
                  );
                })()}

                {/* Informação sobre o Delay no Servidor */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-1.5 text-amber-300 text-xs">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      {forwardingItem.type === "audio"
                        ? `Aguardará ${forwardingItem.duration || 5}s antes do envio`
                        : forwardingItem.type === "text"
                        ? "Aguardará 10s antes do envio"
                        : "Envio direto"}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    {forwardingItem.type === "audio"
                      ? `O servidor aguardará o tempo exato do áudio (${forwardingItem.duration || 5} segundos) para simular o tempo real de gravação humana no Instagram.`
                      : forwardingItem.type === "text"
                      ? "O servidor aguardará 10 segundos antes de enviar para simular o tempo de digitação humana no Instagram."
                      : "A foto será entregue na conversa."}
                  </p>
                  <div className="pt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium border-t border-amber-500/20">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Processado pelo servidor. Você pode fechar o app!</span>
                  </div>
                </div>

                {/* Botões de Ação */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setForwardingItem(null)}
                    disabled={isForwarding}
                    className="flex-1 py-2.5 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmForward}
                    disabled={isForwarding}
                    className="flex-1 py-2.5 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] active:scale-95 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md disabled:opacity-50"
                  >
                    {isForwarding ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Agendando...</span>
                      </>
                    ) : (
                      <>
                        <Forward className="w-3.5 h-3.5" />
                        <span>Confirmar Envio</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal de Confirmação de Exclusão de Pasta */}
        <AnimatePresence>
          {folderToDelete && (
            <div
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setFolderToDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-[#1c1c1e] border border-[#27272a] rounded-2xl p-5 shadow-2xl text-center space-y-4"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 mx-auto flex items-center justify-center">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Excluir Pasta?</h3>
                  <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                    Tem certeza de que deseja excluir a pasta{" "}
                    <span className="font-semibold text-white">"{folderToDelete.name}"</span>?
                    Todos os itens salvos dentro dela serão removidos permanentemente.
                  </p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setFolderToDelete(null)}
                    className="flex-1 py-2.5 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const target = folderToDelete;
                      setFolderToDelete(null);
                      try {
                        await deleteFolder(target.id);
                        toast.success(`Pasta "${target.name}" excluída com sucesso!`);
                      } catch (err) {
                        console.error("Erro ao excluir pasta:", err);
                        toast.error("Não foi possível excluir a pasta.");
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors cursor-pointer active:scale-95 shadow-md shadow-red-600/20"
                  >
                    Sim, Excluir
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal de Edição de Pasta (Renomear) */}
        <AnimatePresence>
          {folderToEdit && (
            <div
              className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setFolderToEdit(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-[#1c1c1e] border border-[#27272a] rounded-2xl p-5 shadow-2xl space-y-4 text-white"
              >
                <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#0095f6]/20 text-[#0095f6] flex items-center justify-center">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Editar Nome da Pasta</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFolderToEdit(null)}
                    className="text-zinc-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleEditFolderSubmit} className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                      Nome da Pasta
                    </label>
                    <input
                      type="text"
                      value={editFolderName}
                      onChange={(e) => setEditFolderName(e.target.value)}
                      placeholder="Nome da pasta"
                      className="w-full bg-[#121214] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#0095f6]"
                      required
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setFolderToEdit(null)}
                      disabled={isSubmitting}
                      className="flex-1 py-2.5 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !editFolderName.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] text-white text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Salvando...</span>
                        </>
                      ) : (
                        <span>Salvar</span>
                      )}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal de Edição de Item (Título e Conteúdo) */}
        <AnimatePresence>
          {editingItem && (
            <div
              className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setEditingItem(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-[#1c1c1e] border border-[#27272a] rounded-2xl p-5 shadow-2xl space-y-4 text-white"
              >
                <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Editar Item</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="text-zinc-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleEditItemSubmit} className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                      Título do Item
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Nome de identificação"
                      className="w-full bg-[#121214] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#0095f6]"
                      required
                      autoFocus
                    />
                  </div>

                  {editingItem.type === "text" && (
                    <div>
                      <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                        Conteúdo do Texto
                      </label>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={4}
                        placeholder="Mensagem pronta..."
                        className="w-full bg-[#121214] border border-[#27272a] rounded-xl p-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#0095f6] resize-none"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-medium text-zinc-400 block mb-1 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Enviar junto com outro item (Linkar combo):</span>
                    </label>
                    <select
                      value={editLinkedItemId}
                      onChange={(e) => setEditLinkedItemId(e.target.value)}
                      className="w-full bg-[#121214] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0095f6] cursor-pointer"
                    >
                      <option value="">Nenhum (Item avulso / enviado sozinho)</option>
                      {items
                        .filter((other) => other.id !== editingItem.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.type === "audio" ? "🎙️ [Áudio]" : other.type === "text" ? "📝 [Texto]" : "📷 [Foto]"} {other.title}
                          </option>
                        ))}
                    </select>
                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                      Ao linkar, a IA e o sistema enviarão os dois itens juntos no mesmo turno em balões seguidos.
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      disabled={isSubmitting}
                      className="flex-1 py-2.5 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !editTitle.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] text-white text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Salvando...</span>
                        </>
                      ) : (
                        <span>Salvar</span>
                      )}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
