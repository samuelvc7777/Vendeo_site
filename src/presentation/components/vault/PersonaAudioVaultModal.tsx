"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { apiFetch as fetch } from "@/infrastructure/http/apiFetch";
import {
  X,
  Plus,
  Play,
  Pause,
  Send,
  Trash2,
  Search,
  Volume2,
  Sparkles,
  Loader2,
  Upload,
  Pencil,
  Power,
  Clock,
  Mic,
  Tag,
  Filter,
  FolderArchive,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { PersonaAudioAsset, ChatStage } from "@/domain/entities/ChatStage";
import { usePersonaAudios } from "@/presentation/hooks/usePersonaAudios";
import { useChatStages } from "@/presentation/hooks/useChatStages";

interface PersonaAudioVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeChat?: {
    id: string;
    fullName: string;
    username: string;
  } | null;
  onSendAudioToChat?: (audio: PersonaAudioAsset) => Promise<void>;
  onOpenLegacyVault?: () => void;
}

export function PersonaAudioVaultModal({
  isOpen,
  onClose,
  activeChat,
  onSendAudioToChat,
  onOpenLegacyVault,
}: PersonaAudioVaultModalProps) {
  const { stages } = useChatStages();
  const {
    audios,
    isLoading,
    addAudio,
    updateAudio,
    deleteAudio,
    toggleAudioEnabled,
    refreshAudios,
  } = usePersonaAudios();

  const [selectedStageFilter, setSelectedStageFilter] = useState<string>("todas");
  const [searchQuery, setSearchQuery] = useState("");

  // Estado do Player de Áudio
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Modal de Criação / Edição de Áudio
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingAudio, setEditingAudio] = useState<PersonaAudioAsset | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formStageId, setFormStageId] = useState("");
  const [formAudioUrl, setFormAudioUrl] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
  const [formUsageInstruction, setFormUsageInstruction] = useState("");
  const [formDuration, setFormDuration] = useState<number>(0);
  const [formEnabled, setFormEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parar áudio ao fechar
  useEffect(() => {
    if (!isOpen && audioElementRef.current) {
      audioElementRef.current.pause();
      setPlayingAudioId(null);
    }
  }, [isOpen]);

  const handlePlayPause = (audio: PersonaAudioAsset) => {
    if (playingAudioId === audio.id) {
      if (audioElementRef.current) {
        if (audioElementRef.current.paused) {
          audioElementRef.current.play();
        } else {
          audioElementRef.current.pause();
          setPlayingAudioId(null);
        }
      }
      return;
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }

    const newAudio = new Audio(audio.audioUrl);
    audioElementRef.current = newAudio;
    setPlayingAudioId(audio.id);
    setPlaybackProgress(0);

    newAudio.ontimeupdate = () => {
      if (newAudio.duration > 0) {
        setPlaybackCurrentTime(newAudio.currentTime);
        setPlaybackDuration(newAudio.duration);
        setPlaybackProgress((newAudio.currentTime / newAudio.duration) * 100);
      }
    };

    newAudio.onended = () => {
      setPlayingAudioId(null);
      setPlaybackProgress(0);
    };

    newAudio.onerror = () => {
      toast.error("Erro ao reproduzir o arquivo de áudio.");
      setPlayingAudioId(null);
    };

    newAudio.play().catch((err) => {
      console.warn("Falha ao tocar áudio:", err);
      toast.error("Não foi possível reproduzir.");
      setPlayingAudioId(null);
    });
  };

  const filteredAudios = useMemo(() => {
    return audios.filter((a) => {
      if (selectedStageFilter !== "todas") {
        if (a.stageId !== selectedStageFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchTranscript = (a.transcript || "").toLowerCase().includes(q);
        const matchUsage = (a.usageInstruction || "").toLowerCase().includes(q);
        if (!matchTitle && !matchTranscript && !matchUsage) return false;
      }
      return true;
    });
  }, [audios, selectedStageFilter, searchQuery]);

  const openCreateModal = () => {
    setEditingAudio(null);
    setFormTitle("");
    setFormStageId(stages[0]?.id || "");
    setFormAudioUrl("");
    setFormTranscript("");
    setFormUsageInstruction("");
    setFormDuration(0);
    setFormEnabled(true);
    setIsFormModalOpen(true);
  };


  const openEditModal = (audio: PersonaAudioAsset) => {
    setEditingAudio(audio);
    setFormTitle(audio.title);
    setFormStageId(audio.stageId || "");
    setFormAudioUrl(audio.audioUrl);
    setFormTranscript(audio.transcript || "");
    setFormUsageInstruction(audio.usageInstruction || "");
    setFormDuration(audio.duration || 0);
    setFormEnabled(audio.enabled);
    setIsFormModalOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      toast.error("Por favor, selecione um arquivo de áudio válido (mp3, wav, m4a, etc).");
      return;
    }

    setIsUploading(true);
    try {
      // 1. Duração e preview temporário local
      const localPreviewUrl = URL.createObjectURL(file);
      const tempAudio = new Audio(localPreviewUrl);
      tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration > 0) {
          setFormDuration(Math.round(tempAudio.duration));
        }
      };

      if (!formTitle) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        setFormTitle(cleanName);
      }

      // 2. Upload REAL para o bucket do Supabase Storage via rota interna
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "audio");

      const upRes = await fetch("/api/instagram/upload", {
        method: "POST",
        body: formData,
      });

      if (!upRes.ok) {
        throw new Error("Falha no upload do áudio para o servidor");
      }

      const upData = await upRes.json();
      if (!upData?.url) {
        throw new Error(upData?.error || "Servidor não retornou URL pública do áudio");
      }

      setFormAudioUrl(upData.url);
      toast.success("Arquivo de áudio enviado e hospedado com sucesso!");
    } catch (err: any) {
      console.error("[PersonaAudioVaultModal] Erro no upload:", err);
      toast.error("Erro ao hospedar áudio no servidor: " + (err?.message || "Tente novamente"));
      setFormAudioUrl("");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formAudioUrl.trim()) {
      toast.error("Título e arquivo de áudio são obrigatórios.");
      return;
    }

    if (formAudioUrl.startsWith("blob:") || formAudioUrl.startsWith("data:")) {
      toast.error("O áudio ainda não foi hospedado no servidor. Por favor, selecione o arquivo novamente.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingAudio) {
        await updateAudio(editingAudio.id, {
          title: formTitle.trim(),
          stageId: formStageId || undefined,
          audioUrl: formAudioUrl.trim(),
          transcript: formTranscript.trim(),
          usageInstruction: formUsageInstruction.trim(),
          duration: formDuration || undefined,
          enabled: formEnabled,
        });
      } else {
        await addAudio({
          title: formTitle.trim(),
          stageId: formStageId || undefined,
          audioUrl: formAudioUrl.trim(),
          transcript: formTranscript.trim(),
          usageInstruction: formUsageInstruction.trim(),
          duration: formDuration || undefined,
          enabled: formEnabled,
        });
      }
      setIsFormModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (audio: PersonaAudioAsset) => {
    if (confirm(`Deseja realmente excluir o áudio "${audio.title}"?`)) {
      await deleteAudio(audio.id);
    }
  };

  const getStageName = (stageId?: string) => {
    if (!stageId) return "Todas as Etapas";
    const st = stages.find((s) => s.id === stageId);
    return st ? st.name : "Etapa geral";
  };

  const formatSeconds = (sec?: number) => {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl max-h-[92vh] bg-[#121214] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho do Cofre */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between gap-3 bg-[#18181b]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
                Cofre de Áudios da Larissa
                <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-[10px] font-mono">
                  {audios.length} {audios.length === 1 ? "áudio" : "áudios"}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                Biblioteca de voz pré-gravada para seleção orgânica pela IA.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenLegacyVault && (
              <button
                type="button"
                onClick={onOpenLegacyVault}
                title="Abrir arquivos e mídias do cofre antigo"
                className="px-2.5 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 font-medium text-xs flex items-center gap-1.5 transition-colors"
              >
                <FolderArchive className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Cofre Antigo</span>
              </button>
            )}
            <button
              type="button"
              onClick={openCreateModal}
              className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all shadow-md shadow-sky-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo Áudio</span>
              <span className="sm:hidden">Novo</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              aria-label="Fechar cofre"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="p-3 border-b border-[#222226] bg-[#141417] space-y-2.5">
          {/* Campo de Busca */}
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por título, conteúdo transcrito ou instrução..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-zinc-900/90 border border-zinc-700/80 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Filtro por Etapa */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setSelectedStageFilter("todas")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all ${
                selectedStageFilter === "todas"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Todas as Etapas
            </button>
            {stages.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setSelectedStageFilter(st.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 ${
                  selectedStageFilter === st.id
                    ? "bg-zinc-700 text-white ring-1 ring-sky-400"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: st.color || "#3b82f6" }}
                />
                <span>{st.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Cards de Áudio */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {isLoading ? (
            <div className="py-16 text-center text-zinc-500 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-sky-400" />
              <p className="text-xs">Carregando biblioteca de áudios...</p>
            </div>
          ) : filteredAudios.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 space-y-2 border border-dashed border-zinc-800/80 rounded-2xl bg-zinc-900/20">
              <Mic className="w-8 h-8 mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">Nenhum áudio encontrado</p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                {searchQuery || selectedStageFilter !== "todas"
                  ? "Tente ajustar o filtro ou o termo de busca."
                  : "Cadastre os primeiros áudios da Larissa para esta etapa."}
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors"
              >
                + Adicionar Primeiro Áudio
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredAudios.map((audio) => {
                const isPlaying = playingAudioId === audio.id;
                const stageName = getStageName(audio.stageId);

                return (
                  <div
                    key={audio.id}
                    className={`rounded-xl border p-3 flex flex-col justify-between space-y-3 transition-all ${
                      isPlaying
                        ? "bg-sky-950/20 border-sky-500/50 shadow-md shadow-sky-500/10"
                        : audio.enabled
                        ? "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                        : "bg-zinc-950/40 border-zinc-800/50 opacity-60"
                    }`}
                  >
                    {/* Topo do Card: Título, Etapa & Status */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 truncate">
                            <Mic className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span className="truncate">{audio.title}</span>
                          </h4>
                          <p className="text-[11px] text-zinc-400 font-medium truncate mt-0.5">
                            {stageName}
                          </p>
                        </div>

                        {!audio.enabled && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-semibold shrink-0">
                            Inativo
                          </span>
                        )}
                      </div>

                      {/* Player de Reprodução */}
                      <div className="p-2 rounded-lg bg-zinc-900/90 border border-zinc-800/80 flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => handlePlayPause(audio)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90 ${
                            isPlaying
                              ? "bg-sky-500 text-white"
                              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          }`}
                          aria-label={isPlaying ? "Pausar" : "Tocar"}
                        >
                          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-sky-400 rounded-full transition-all duration-200"
                              style={{ width: `${isPlaying ? playbackProgress : 0}%` }}
                            />
                          </div>
                        </div>

                        <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                          {formatSeconds(isPlaying ? playbackDuration : audio.duration)}
                        </span>
                      </div>

                      {/* Quando Usar (Instrução de Uso) */}
                      {audio.usageInstruction && (
                        <div className="text-[11px] bg-zinc-900/50 rounded-lg p-2 border border-zinc-800/50 space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-sky-400 block tracking-wider">
                            Quando usar:
                          </span>
                          <p className="text-zinc-300 line-clamp-2 text-[11px] leading-relaxed">
                            {audio.usageInstruction}
                          </p>
                        </div>
                      )}

                      {/* Transcrição Persistida */}
                      {audio.transcript && (
                        <p className="text-[10px] text-zinc-400 italic line-clamp-2 px-1">
                          &ldquo;{audio.transcript}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Rodapé do Card: Ações */}
                    <div className="pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleAudioEnabled(audio.id, audio.enabled)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            audio.enabled
                              ? "bg-zinc-800 text-sky-400 border-zinc-700 hover:bg-zinc-700"
                              : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:bg-zinc-850"
                          }`}
                          title={audio.enabled ? "Desativar áudio" : "Ativar áudio"}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(audio)}
                          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-sky-400 hover:bg-zinc-700 border border-zinc-700/60 transition-colors"
                          title="Editar áudio"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(audio)}
                          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-red-400 hover:bg-zinc-700 border border-zinc-700/60 transition-colors"
                          title="Excluir áudio"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Disparo Manual no Chat (se chat ativo) */}
                      {activeChat && onSendAudioToChat && (
                        <button
                          type="button"
                          onClick={() => onSendAudioToChat(audio)}
                          className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
                        >
                          <Send className="w-3 h-3" />
                          <span>Enviar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>


      {/* Modal de Cadastro / Edição de Áudio */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Mic className="w-4 h-4 text-sky-400" />
                {editingAudio ? "Editar Áudio da Larissa" : "Novo Áudio da Larissa"}
              </h4>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3.5">
              {/* Título do Áudio */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Título do Áudio *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: O que eu gosto de fazer"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Etapa Associada */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Etapa Associada (Opcional)
                </label>
                <select
                  value={formStageId}
                  onChange={(e) => setFormStageId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">Todas as Etapas (Áudio Geral)</option>
                  {stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      Etapa: {st.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Upload ou URL do Arquivo de Áudio */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Arquivo de Áudio *</span>
                  {formDuration > 0 && (
                    <span className="text-[10px] text-zinc-400 font-mono">
                      Duração: {formatSeconds(formDuration)}
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="URL direta (https://...) ou faça upload"
                    value={formAudioUrl}
                    onChange={(e) => setFormAudioUrl(e.target.value)}
                    className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 border border-zinc-700"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </button>
                </div>
              </div>

              {/* Quando Usar Este Áudio (usageInstruction) */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Quando usar este áudio? (Instrução Semântica)</span>
                  <span className="text-[10px] text-sky-400">Para a IA entender</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Sempre que perguntarem sobre hobbies, o que Larissa faz no tempo livre ou fins de semana."
                  value={formUsageInstruction}
                  onChange={(e) => setFormUsageInstruction(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Transcrição Persistida */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Transcrição do Áudio (Conteúdo que a Larissa fala)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Ah, eu adoro sair pra comer, ver um filminho e treinar..."
                  value={formTranscript}
                  onChange={(e) => setFormTranscript(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Switch de Ativo */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-semibold text-zinc-300">Áudio Ativo para a IA</span>
                <input
                  type="checkbox"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-500"
                />
              </div>

              {/* Botões do Modal */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-xs font-semibold text-white flex items-center gap-1.5 shadow-md shadow-sky-500/20"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{editingAudio ? "Salvar Alterações" : "Cadastrar Áudio"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
