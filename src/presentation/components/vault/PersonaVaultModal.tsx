"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Plus,
  Play,
  Pause,
  Send,
  Trash2,
  Search,
  Loader2,
  Upload,
  Pencil,
  Power,
  Mic,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PersonaImageAsset, PersonaAudioAsset } from "@/domain/entities/ChatStage";
import { usePersonaImages } from "@/presentation/hooks/usePersonaImages";
import { usePersonaAudios } from "@/presentation/hooks/usePersonaAudios";
import { useChatStages } from "@/presentation/hooks/useChatStages";
import { getApiUrl } from "@/infrastructure/http/network";
import { convertToWhatsAppVoiceNote, ensureInstagramCompatibleAudio } from "@/presentation/components/chat/audio-converter";

type VaultTab = "photos" | "audios";

interface PersonaVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: VaultTab;
  activeChat?: {
    id: string;
    fullName: string;
    username: string;
  } | null;
  onSendImageToChat?: (image: PersonaImageAsset) => Promise<void>;
  onSendAudioToChat?: (audio: PersonaAudioAsset) => Promise<void>;
}

export function PersonaVaultModal({
  isOpen,
  onClose,
  initialTab = "photos",
  activeChat,
  onSendImageToChat,
  onSendAudioToChat,
}: PersonaVaultModalProps) {
  const [activeTab, setActiveTab] = useState<VaultTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStageFilter, setSelectedStageFilter] = useState<string>("todas");

  // Hooks de dados
  const { stages } = useChatStages(undefined, { loadAllProgresses: false });
  const {
    images,
    isLoading: isLoadingImages,
    addImage,
    updateImage,
    deleteImage,
    toggleImageEnabled,
  } = usePersonaImages();
  const {
    audios,
    isLoading: isLoadingAudios,
    addAudio,
    updateAudio,
    deleteAudio,
    toggleAudioEnabled,
  } = usePersonaAudios();

  // Estado do Player de Áudio
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Estado do Formulário (compartilhado para simplificar, mas tipado dinamicamente)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PersonaImageAsset | PersonaAudioAsset | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formObjectiveId, setFormObjectiveId] = useState("");
  const [formMediaUrl, setFormMediaUrl] = useState(""); // imageUrl ou audioUrl
  const [formWhatsAppAudioUrl, setFormWhatsAppAudioUrl] = useState("");
  const [formUsageInstruction, setFormUsageInstruction] = useState("");
  const [formDescriptionOrTranscript, setFormDescriptionOrTranscript] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formIsViewOnce, setFormIsViewOnce] = useState(false);
  const [formDuration, setFormDuration] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resetar estado ao abrir/fechar
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSearchQuery("");
      setSelectedStageFilter("todas");
    } else {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        setPlayingAudioId(null);
      }
      setIsFormOpen(false);
      setEditingItem(null);
    }
  }, [isOpen, initialTab]);

  // Objetivos disponíveis
  const objectives = useMemo(() => stages.flatMap((stage) =>
    (stage.objectives || stage.goals || [])
      .filter((objective) => objective.enabled !== false)
      .map((objective) => ({
        id: objective.id,
        label: objective.title || objective.label || objective.id,
        stageName: stage.name,
      })),
  ), [stages]);

  // Filtros
  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      if (selectedStageFilter !== "todas" && img.objectiveId !== selectedStageFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          img.title.toLowerCase().includes(q) ||
          (img.description || "").toLowerCase().includes(q) ||
          (img.usageInstruction || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [images, selectedStageFilter, searchQuery]);

  const filteredAudios = useMemo(() => {
    return audios.filter((a) => {
      if (selectedStageFilter !== "todas" && a.objectiveId !== selectedStageFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          a.title.toLowerCase().includes(q) ||
          (a.transcript || "").toLowerCase().includes(q) ||
          (a.usageInstruction || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [audios, selectedStageFilter, searchQuery]);

  // Handlers de Áudio
  const handlePlayPause = (audio: PersonaAudioAsset) => {
    if (playingAudioId === audio.id) {
      if (audioElementRef.current) {
        if (audioElementRef.current.paused) audioElementRef.current.play();
        else {
          audioElementRef.current.pause();
          setPlayingAudioId(null);
        }
      }
      return;
    }
    if (audioElementRef.current) audioElementRef.current.pause();
    const newAudio = new Audio(audio.audioUrl);
    audioElementRef.current = newAudio;
    setPlayingAudioId(audio.id);
    setPlaybackProgress(0);
    newAudio.ontimeupdate = () => {
      if (newAudio.duration > 0) {
        setPlaybackProgress((newAudio.currentTime / newAudio.duration) * 100);
        setPlaybackDuration(newAudio.duration);
      }
    };
    newAudio.onended = () => { setPlayingAudioId(null); setPlaybackProgress(0); };
    newAudio.onerror = () => { toast.error("Erro ao reproduzir áudio."); setPlayingAudioId(null); };
    newAudio.play().catch(() => { toast.error("Não foi possível reproduzir."); setPlayingAudioId(null); });
  };

  // Handlers de Formulário
  const openCreateForm = () => {
    setEditingItem(null);
    setFormTitle("");
    setFormObjectiveId("");
    setFormMediaUrl("");
    setFormWhatsAppAudioUrl("");
    setFormUsageInstruction("");
    setFormDescriptionOrTranscript("");
    setFormEnabled(true);
    setFormIsViewOnce(false);
    setFormDuration(0);
    setIsFormOpen(true);
  };

  const openEditForm = (item: PersonaImageAsset | PersonaAudioAsset) => {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormObjectiveId(item.objectiveId || "");
    setFormUsageInstruction(item.usageInstruction || "");
    setFormEnabled(item.enabled);

    if ("imageUrl" in item) {
      setFormMediaUrl(item.imageUrl);
      setFormDescriptionOrTranscript(item.description || "");
      setFormIsViewOnce(Boolean(item.isViewOnce));
    } else {
      setFormMediaUrl(item.audioUrl);
      setFormWhatsAppAudioUrl(item.whatsappAudioUrl || "");
      setFormDescriptionOrTranscript(item.transcript || "");
      setFormDuration(item.duration || 0);
    }
    setIsFormOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isAudio = activeTab === "audios";
    const isValidType = isAudio ? file.type.startsWith("audio/") : file.type.startsWith("image/");

    if (!isValidType) {
      toast.error(`Selecione um arquivo de ${isAudio ? "áudio" : "imagem"} válido.`);
      return;
    }

    setIsUploading(true);
    try {
      if (!formTitle) {
        setFormTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
      }

      let fileToUpload = file;
      let whatsappFile: File | null = null;

      if (isAudio) {
        // Pré-visualização local para duração
        const tempUrl = URL.createObjectURL(file);
        const tempAudio = new Audio(tempUrl);
        tempAudio.onloadedmetadata = () => {
          if (tempAudio.duration > 0) setFormDuration(Math.round(tempAudio.duration));
        };

        const compatible = await ensureInstagramCompatibleAudio(file);
        const whatsapp = await convertToWhatsAppVoiceNote(file);
        fileToUpload = compatible;
        whatsappFile = whatsapp;
      }

      // Upload principal
      const formData = new FormData();
      formData.append("file", fileToUpload, fileToUpload.name);
      formData.append("type", isAudio ? "audio" : "image");

      const res = await fetch(getApiUrl("/api/instagram/upload"), { method: "POST", body: formData });
      if (!res.ok) throw new Error("Falha no upload");
      const data = await res.json();
      if (!data?.url) throw new Error("URL não retornada");

      setFormMediaUrl(data.url);

      // Upload WhatsApp (se áudio)
      if (isAudio && whatsappFile) {
        const waForm = new FormData();
        waForm.append("file", whatsappFile, whatsappFile.name);
        waForm.append("type", "audio");
        const waRes = await fetch(getApiUrl("/api/instagram/upload"), { method: "POST", body: waForm });
        const waData = await waRes.json().catch(() => ({}));
        if (waRes.ok && waData?.url) setFormWhatsAppAudioUrl(String(waData.url));
      }

      toast.success(`${isAudio ? "Áudio" : "Imagem"} enviado(a) com sucesso!`);
    } catch (err: any) {
      console.error("[PersonaVault] Upload error:", err);
      toast.error("Erro no upload: " + (err?.message || "Tente novamente"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formMediaUrl.trim()) {
      toast.error("Título e arquivo são obrigatórios.");
      return;
    }
    if (formMediaUrl.startsWith("blob:") || formMediaUrl.startsWith("data:")) {
      toast.error("O arquivo ainda não foi hospedado. Selecione novamente.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (activeTab === "photos") {
        const payload = {
          title: formTitle.trim(),
          objectiveId: formObjectiveId || undefined,
          imageUrl: formMediaUrl.trim(),
          usageInstruction: formUsageInstruction.trim(),
          description: formDescriptionOrTranscript.trim(),
          enabled: formEnabled,
          isViewOnce: formIsViewOnce,
        };
        if (editingItem && "imageUrl" in editingItem) {
          await updateImage(editingItem.id, payload);
        } else {
          await addImage(payload);
        }
      } else {
        if (!formWhatsAppAudioUrl.trim() && !editingItem) {
           // Se for criação e não tiver URL do WA (pode acontecer se upload falhar parcialmente), tenta usar a mesma
           // Mas idealmente deveria ter. Vamos permitir fallback para não bloquear, mas avisar.
           if (!formWhatsAppAudioUrl) toast.warning("Variante WhatsApp não disponível. Áudio pode não tocar no WA.");
        }

        const payload = {
          title: formTitle.trim(),
          objectiveId: formObjectiveId || undefined,
          audioUrl: formMediaUrl.trim(),
          whatsappAudioUrl: formWhatsAppAudioUrl.trim() || formMediaUrl.trim(),
          transcript: formDescriptionOrTranscript.trim(),
          usageInstruction: formUsageInstruction.trim(),
          duration: formDuration || undefined,
          enabled: formEnabled,
        };
        if (editingItem && "audioUrl" in editingItem) {
          await updateAudio(editingItem.id, payload);
        } else {
          await addAudio(payload);
        }
      }
      setIsFormOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingItem) return;
    if (confirm(`Excluir "${editingItem.title}"?`)) {
      if ("imageUrl" in editingItem) await deleteImage(editingItem.id);
      else await deleteAudio(editingItem.id);
      setIsFormOpen(false);
    }
  };

  const formatSeconds = (sec?: number) => {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  const isPhotoTab = activeTab === "photos";
  const accentColor = isPhotoTab ? "pink" : "sky";
  const itemsCount = isPhotoTab ? filteredImages.length : filteredAudios.length;
  const isLoading = isPhotoTab ? isLoadingImages : isLoadingAudios;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl max-h-[92vh] bg-[#121214] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header Unificado */}
        <div className="p-4 border-b border-[#27272a] bg-[#18181b] flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-${accentColor}-500/10 border border-${accentColor}-500/30 flex items-center justify-center text-${accentColor}-400 transition-colors duration-300`}>
                {isPhotoTab ? <ImageIcon className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Cofre da Larissa</h2>
                <p className="text-xs text-zinc-400">Biblioteca de mídia pessoal para envio orgânico</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs e Busca */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex p-1 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <button
                onClick={() => setActiveTab("photos")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                  isPhotoTab
                    ? "bg-pink-500 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Fotos ({images.length})
              </button>
              <button
                onClick={() => setActiveTab("audios")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                  !isPhotoTab
                    ? "bg-sky-500 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                Áudios ({audios.length})
              </button>
            </div>

            <div className="relative w-full sm:w-auto flex-1 max-w-xs">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Conteúdo Principal */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center text-zinc-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
              <span className="text-sm">Carregando cofre...</span>
            </div>
          ) : itemsCount === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20 p-8">
              <div className={`w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4 text-zinc-600`}>
                {isPhotoTab ? <ImageIcon className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-1">Nenhum item encontrado</h3>
              <p className="text-xs text-zinc-500 max-w-xs mb-4">
                {searchQuery
                  ? "Tente buscar por outros termos."
                  : `Adicione ${isPhotoTab ? "fotos" : "áudios"} ao cofre para usá-los nas conversas.`}
              </p>
              {!searchQuery && (
                <button
                  onClick={openCreateForm}
                  className={`px-4 py-2 rounded-lg bg-${accentColor}-500 hover:bg-${accentColor}-600 text-white text-xs font-semibold transition-colors`}
                >
                  Adicionar Primeiro Item
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Renderização de Fotos */}
              {isPhotoTab && filteredImages.map((img) => (
                <div key={img.id} className={`group relative rounded-xl border bg-zinc-900/40 overflow-hidden transition-all hover:border-zinc-600 ${!img.enabled ? "opacity-50 grayscale" : ""}`}>
                  <div className="aspect-square bg-zinc-950 relative">
                    <img src={img.imageUrl} alt={img.title} className="w-full h-full object-cover" loading="lazy" />
                    {!img.enabled && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Inativo</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                       <button onClick={() => openEditForm(img)} className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg backdrop-blur-sm"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div>
                      <h4 className="text-sm font-medium text-white truncate">{img.title}</h4>
                      {img.usageInstruction && <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{img.usageInstruction}</p>}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50">
                      <button
                        onClick={() => toggleImageEnabled(img.id, img.enabled)}
                        className={`text-[10px] font-medium px-2 py-1 rounded border ${img.enabled ? "text-pink-400 border-pink-500/30 bg-pink-500/10" : "text-zinc-500 border-zinc-800"}`}
                      >
                        {img.enabled ? "Ativo" : "Inativo"}
                      </button>
                      {activeChat && onSendImageToChat && (
                        <button
                          onClick={() => onSendImageToChat(img)}
                          className="p-1.5 text-pink-400 hover:bg-pink-500/10 rounded-lg transition-colors"
                          title="Enviar para chat"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Renderização de Áudios */}
              {!isPhotoTab && filteredAudios.map((audio) => {
                const isPlaying = playingAudioId === audio.id;
                return (
                  <div key={audio.id} className={`group rounded-xl border bg-zinc-900/40 p-3 transition-all hover:border-zinc-600 ${!audio.enabled ? "opacity-50" : ""} ${isPlaying ? `border-${accentColor}-500/50 bg-${accentColor}-950/10` : ""}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-white truncate">{audio.title}</h4>
                        <p className="text-[10px] text-zinc-500 truncate">{formatSeconds(audio.duration)}</p>
                      </div>
                      <button onClick={() => openEditForm(audio)} className="text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Player Waveform Simplificado */}
                    <div className="flex items-center gap-3 bg-zinc-950/50 rounded-lg p-2 border border-zinc-800/50">
                      <button
                        onClick={() => handlePlayPause(audio)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isPlaying ? `bg-${accentColor}-500 text-white` : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />}
                      </button>
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full bg-${accentColor}-400 transition-all duration-100`} style={{ width: `${isPlaying ? playbackProgress : 0}%` }} />
                      </div>
                    </div>

                    {audio.usageInstruction && (
                      <p className="text-[10px] text-zinc-400 mt-2 line-clamp-1 italic">&quot;{audio.usageInstruction}&quot;</p>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-800/50">
                       <button
                        onClick={() => toggleAudioEnabled(audio.id, audio.enabled)}
                        className={`text-[10px] font-medium px-2 py-1 rounded border ${audio.enabled ? "text-sky-400 border-sky-500/30 bg-sky-500/10" : "text-zinc-500 border-zinc-800"}`}
                      >
                        {audio.enabled ? "Ativo" : "Inativo"}
                      </button>
                      {activeChat && onSendAudioToChat && (
                        <button
                          onClick={() => onSendAudioToChat(audio)}
                          className="p-1.5 text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"
                          title="Enviar para chat"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer com Ação Principal */}
        <div className="p-4 border-t border-[#27272a] bg-[#18181b] flex justify-end">
          <button
            onClick={openCreateForm}
            className={`px-4 py-2 rounded-xl bg-${accentColor}-500 hover:bg-${accentColor}-600 text-white text-sm font-semibold flex items-center gap-2 shadow-lg shadow-${accentColor}-500/20 transition-all active:scale-95`}
          >
            <Plus className="w-4 h-4" />
            Novo {isPhotoTab ? "Foto" : "Áudio"}
          </button>
        </div>
      </div>

      {/* Modal de Formulário (Overlay Interno) */}
      {isFormOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#1c1c1e] border border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {editingItem ? "Editar" : "Novo"} {isPhotoTab ? "Foto" : "Áudio"}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Título *</label>
                <input required value={formTitle} onChange={e => setFormTitle(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-zinc-600 outline-none" placeholder="Ex: Selfie na academia" />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Objetivo (Opcional)</label>
                <select value={formObjectiveId} onChange={e => setFormObjectiveId(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-zinc-600 outline-none">
                  <option value="">Uso Geral / Arsenal</option>
                  {objectives.map(o => <option key={o.id} value={o.id}>{o.stageName} • {o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Arquivo *</label>
                <div className="flex gap-2">
                  <input readOnly value={formMediaUrl ? "Arquivo carregado ✓" : ""} placeholder="Nenhum arquivo selecionado" className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 cursor-not-allowed" />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium rounded-lg border border-zinc-700 flex items-center gap-2 disabled:opacity-50">
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload
                  </button>
                  <input type="file" ref={fileInputRef} accept={isPhotoTab ? "image/*" : "audio/*"} onChange={handleFileUpload} className="hidden" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Quando usar? (Instrução para IA)</label>
                <textarea rows={2} value={formUsageInstruction} onChange={e => setFormUsageInstruction(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-zinc-600 outline-none resize-none" placeholder="Ex: Quando perguntarem sobre treinos..." />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">{isPhotoTab ? "Descrição Visual" : "Transcrição"}</label>
                <textarea rows={2} value={formDescriptionOrTranscript} onChange={e => setFormDescriptionOrTranscript(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-zinc-600 outline-none resize-none" placeholder={isPhotoTab ? "Descreva a foto..." : "O que é dito no áudio..."} />
              </div>

              {isPhotoTab && (
                <div className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                  <span className="text-xs text-zinc-300">Visualização Única</span>
                  <input type="checkbox" checked={formIsViewOnce} onChange={e => setFormIsViewOnce(e.target.checked)} className="rounded accent-pink-500" />
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                 <button type="button" onClick={() => setIsFormOpen(false)} className="text-sm text-zinc-400 hover:text-white">Cancelar</button>
                 <div className="flex gap-2">
                   {editingItem && (
                     <button type="button" onClick={handleDelete} className="px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg text-sm font-medium transition-colors">Excluir</button>
                   )}
                   <button type="submit" disabled={isSubmitting} className={`px-4 py-2 bg-${accentColor}-500 hover:bg-${accentColor}-600 text-white rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50`}>
                     {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                     Salvar
                   </button>
                 </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}