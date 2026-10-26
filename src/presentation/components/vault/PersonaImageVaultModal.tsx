"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Plus,
  Send,
  Trash2,
  Search,
  Sparkles,
  Loader2,
  Upload,
  Pencil,
  Power,
  ImageIcon,
  Tag,
  Filter,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { PersonaImageAsset, ChatStage } from "@/domain/entities/ChatStage";
import { usePersonaImages } from "@/presentation/hooks/usePersonaImages";
import { useChatStages } from "@/presentation/hooks/useChatStages";
import { getApiUrl } from "@/infrastructure/http/network";

function isPhotoCurrentlyInTime(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const now = formatter.format(new Date());
    if (start <= end) {
      return now >= start && now <= end;
    } else {
      return now >= start || now <= end;
    }
  } catch {
    return true;
  }
}

interface PersonaImageVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeChat?: {
    id: string;
    fullName: string;
    username: string;
  } | null;
  onSendImageToChat?: (image: PersonaImageAsset) => Promise<void>;
}

export function PersonaImageVaultModal({
  isOpen,
  onClose,
  activeChat,
  onSendImageToChat,
}: PersonaImageVaultModalProps) {
  const { stages } = useChatStages(undefined, { loadAllProgresses: false });
  const {
    images,
    isLoading,
    addImage,
    updateImage,
    deleteImage,
    toggleImageEnabled,
    refreshImages,
  } = usePersonaImages();

  const [selectedStageFilter, setSelectedStageFilter] = useState<string>("todas");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal de Criação / Edição de Imagem
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<PersonaImageAsset | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formObjectiveId, setFormObjectiveId] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formUsageInstruction, setFormUsageInstruction] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formIsViewOnce, setFormIsViewOnce] = useState(false);
  const [formAllowedTimeStart, setFormAllowedTimeStart] = useState("");
  const [formAllowedTimeEnd, setFormAllowedTimeEnd] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      if (selectedStageFilter !== "todas") {
        if (img.objectiveId !== selectedStageFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = img.title.toLowerCase().includes(q);
        const matchDesc = (img.description || "").toLowerCase().includes(q);
        const matchUsage = (img.usageInstruction || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchUsage) return false;
      }
      return true;
    });
  }, [images, selectedStageFilter, searchQuery]);

  const objectives = useMemo(() => stages.flatMap((stage) =>
    (stage.objectives || stage.goals || [])
      .filter((objective) => objective.enabled !== false)
      .map((objective) => ({
      id: objective.id,
      label: objective.title || objective.label || objective.id,
      stageName: stage.name,
    })),
  ), [stages]);

  const openCreateModal = () => {
    setEditingImage(null);
    setFormTitle("");
    setFormObjectiveId("");
    setFormImageUrl("");
    setFormUsageInstruction("");
    setFormDescription("");
    setFormEnabled(true);
    setFormIsViewOnce(false);
    setFormAllowedTimeStart("");
    setFormAllowedTimeEnd("");
    setIsFormModalOpen(true);
  };

  const openEditModal = (image: PersonaImageAsset) => {
    setEditingImage(image);
    setFormTitle(image.title);
    setFormObjectiveId(image.objectiveId || "");
    setFormImageUrl(image.imageUrl);
    setFormUsageInstruction(image.usageInstruction || "");
    setFormDescription(image.description || "");
    setFormEnabled(image.enabled);
    setFormIsViewOnce(Boolean(image.isViewOnce));
    setFormAllowedTimeStart(image.allowedTimeStart || "");
    setFormAllowedTimeEnd(image.allowedTimeEnd || "");
    setIsFormModalOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione um arquivo de imagem válido (jpg, png, webp, etc).");
      return;
    }

    setIsUploading(true);
    try {
      if (!formTitle) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        setFormTitle(cleanName);
      }

      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("type", "image");

      const upRes = await fetch(getApiUrl("/api/instagram/upload"), {
        method: "POST",
        body: formData,
      });

      if (!upRes.ok) {
        throw new Error("Falha no upload da imagem para o servidor");
      }

      const upData = await upRes.json();
      if (!upData?.url) {
        throw new Error(upData?.error || "Servidor não retornou URL pública da imagem");
      }

      setFormImageUrl(upData.url);
      toast.success("Imagem enviada com sucesso!");
    } catch (err: any) {
      console.error("[PersonaImageVaultModal] Erro no upload:", err);
      toast.error("Erro ao hospedar imagem no servidor: " + (err?.message || "Tente novamente"));
      setFormImageUrl("");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formImageUrl.trim()) {
      toast.error("Título e imagem são obrigatórios.");
      return;
    }
    if (formImageUrl.startsWith("blob:") || formImageUrl.startsWith("data:")) {
      toast.error("A imagem ainda não foi hospedada no servidor. Por favor, selecione o arquivo novamente.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingImage) {
        await updateImage(editingImage.id, {
          title: formTitle.trim(),
          objectiveId: formObjectiveId || undefined,
          imageUrl: formImageUrl.trim(),
          usageInstruction: formUsageInstruction.trim(),
          description: formDescription.trim(),
          enabled: formEnabled,
          isViewOnce: formIsViewOnce,
          allowedTimeStart: formAllowedTimeStart.trim() || null,
          allowedTimeEnd: formAllowedTimeEnd.trim() || null,
        });
      } else {
        await addImage({
          title: formTitle.trim(),
          objectiveId: formObjectiveId || undefined,
          imageUrl: formImageUrl.trim(),
          usageInstruction: formUsageInstruction.trim(),
          description: formDescription.trim(),
          enabled: formEnabled,
          isViewOnce: formIsViewOnce,
          allowedTimeStart: formAllowedTimeStart.trim() || null,
          allowedTimeEnd: formAllowedTimeEnd.trim() || null,
        });
      }
      setIsFormModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (image: PersonaImageAsset) => {
    if (confirm(`Deseja realmente excluir a imagem "${image.title}"?`)) {
      await deleteImage(image.id);
    }
  };

  const getObjectiveName = (objectiveId?: string) => {
    if (!objectiveId) return "Sem objetivo";
    return objectives.find((objective) => objective.id === objectiveId)?.label || objectiveId;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl max-h-[92vh] bg-[#121214] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho do Cofre */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between gap-3 bg-[#18181b]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
                Cofre de Fotos da Larissa
                <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-[10px] font-mono">
                  {images.length} {images.length === 1 ? "foto" : "fotos"}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                Biblioteca de imagens pré-cadastradas para seleção orgânica pela IA.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openCreateModal}
              className="px-3 py-1.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all shadow-md shadow-pink-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nova Foto</span>
              <span className="sm:hidden">Nova</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
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
              placeholder="Buscar por título, descrição ou instrução..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-zinc-900/90 border border-zinc-700/80 rounded-xl text-[16px] md:text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500"
            />
          </div>

          {/* Filtro por objetivo */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setSelectedStageFilter("todas")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all ${
                selectedStageFilter === "todas"
                  ? "bg-pink-500 text-white shadow-sm"
                  : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Todos os Objetivos
            </button>
            {objectives.map((objective) => (
              <button
                key={objective.id}
                type="button"
                onClick={() => setSelectedStageFilter(objective.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 ${
                  selectedStageFilter === objective.id
                    ? "bg-zinc-700 text-white ring-1 ring-pink-400"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span>{objective.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Cards de Imagem */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {isLoading ? (
            <div className="py-16 text-center text-zinc-500 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-pink-400" />
              <p className="text-xs">Carregando biblioteca de fotos...</p>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 space-y-2 border border-dashed border-zinc-800/80 rounded-2xl bg-zinc-900/20">
              <ImageIcon className="w-8 h-8 mx-auto text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">Nenhuma foto encontrada</p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                {searchQuery || selectedStageFilter !== "todas"
                  ? "Tente ajustar o filtro ou o termo de busca."
                  : "Cadastre as primeiras fotos da Larissa para esta etapa."}
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors"
              >
                + Adicionar Primeira Foto
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredImages.map((image) => {
                const objectiveName = getObjectiveName(image.objectiveId);

                return (
                  <div
                    key={image.id}
                    className={`rounded-xl border p-3 flex flex-col justify-between space-y-3 transition-all ${
                      image.enabled
                        ? "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                        : "bg-zinc-950/40 border-zinc-800/50 opacity-60"
                    }`}
                  >
                    {/* Topo do Card: Título, Etapa & Status */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 truncate">
                            <ImageIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                            <span className="truncate">{image.title}</span>
                          </h4>
                          <p className="text-[11px] text-zinc-400 font-medium truncate mt-0.5">
                            {objectiveName}
                          </p>
                        </div>

                        {!image.enabled && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-semibold shrink-0">
                            Inativo
                          </span>
                        )}
                      </div>

                      {/* Horário Permitido e Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {image.allowedTimeStart && image.allowedTimeEnd ? (
                          (() => {
                            const isAllowedNow = isPhotoCurrentlyInTime(image.allowedTimeStart, image.allowedTimeEnd);
                            return (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                  isAllowedNow
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/25"
                                }`}
                                title={isAllowedNow ? "Liberada para a IA neste momento" : "Oculta para a IA neste momento (fora do horário)"}
                              >
                                <Clock className="w-3 h-3" />
                                <span>{image.allowedTimeStart} às {image.allowedTimeEnd}</span>
                                <span className="text-[9px] opacity-80">({isAllowedNow ? "no horário" : "fora de hora"})</span>
                              </span>
                            );
                          })()
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-700/40">
                            <Clock className="w-3 h-3 text-zinc-500" />
                            <span>24h (qualquer horário)</span>
                          </span>
                        )}
                        {image.isViewOnce && (
                          <span className="px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[9px] font-bold">
                            1x View Once
                          </span>
                        )}
                      </div>

                      {/* Preview da Imagem */}
                      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-zinc-900/90 border border-zinc-800/80">
                        <img
                          src={image.imageUrl}
                          alt={image.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>

                      {/* Quando Usar (Instrução de Uso) */}
                      {image.usageInstruction && (
                        <div className="text-[11px] bg-zinc-900/50 rounded-lg p-2 border border-zinc-800/50 space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-pink-400 block tracking-wider">
                            Quando usar:
                          </span>
                          <p className="text-zinc-300 line-clamp-2 text-[11px] leading-relaxed">
                            {image.usageInstruction}
                          </p>
                        </div>
                      )}

                      {/* Descrição Persistida */}
                      {image.description && (
                        <p className="text-[10px] text-zinc-400 italic line-clamp-2 px-1">
                          &ldquo;{image.description}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Rodapé do Card: Ações */}
                    <div className="pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleImageEnabled(image.id, image.enabled)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            image.enabled
                              ? "bg-zinc-800 text-pink-400 border-zinc-700 hover:bg-zinc-700"
                              : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:bg-zinc-850"
                          }`}
                          title={image.enabled ? "Desativar foto" : "Ativar foto"}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(image)}
                          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-pink-400 hover:bg-zinc-700 border border-zinc-700/60 transition-colors"
                          title="Editar foto"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(image)}
                          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-red-400 hover:bg-zinc-700 border border-zinc-700/60 transition-colors"
                          title="Excluir foto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Disparo Manual no Chat (se chat ativo) */}
                      {activeChat && onSendImageToChat && (
                        <button
                          type="button"
                          onClick={() => onSendImageToChat(image)}
                          className="px-2.5 py-1 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-semibold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
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


      {/* Modal de Cadastro / Edição de Imagem */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-pink-400" />
                {editingImage ? "Editar Foto da Larissa" : "Nova Foto da Larissa"}
              </h4>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3.5">
              {/* Título da Imagem */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Título da Foto *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Selfie na academia"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-[16px] md:text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500"
                />
              </div>

              {/* Objetivo Associado */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Objetivo Associado <span className="font-normal text-zinc-500">(opcional)</span>
                </label>
                <select
                  value={formObjectiveId}
                  onChange={(e) => setFormObjectiveId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-[16px] md:text-xs text-white focus:outline-none focus:border-pink-500"
                >
                  <option value="">Sem objetivo — disponível para Arsenal / uso geral</option>
                  {objectives.map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.stageName} · {objective.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Upload ou URL da Imagem */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Arquivo de Imagem *</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="URL direta (https://...) ou faça upload"
                    value={formImageUrl}
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-[16px] md:text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="px-3 py-2 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 border border-zinc-700"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </button>
                </div>
              </div>

              {/* Quando Usar Esta Imagem (usageInstruction) */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Quando usar esta foto? (Instrução Semântica)</span>
                  <span className="text-[10px] text-pink-400">Para a IA entender</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Sempre que perguntarem sobre treinos, vida saudável ou rotina na academia."
                  value={formUsageInstruction}
                  onChange={(e) => setFormUsageInstruction(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-[16px] md:text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500 resize-none"
                />
              </div>

              {/* Descrição Persistida */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Descrição da Foto (Contexto visual para a IA)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Selfie no espelho da academia, roupa de treino preta, cabelo preso."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-[16px] md:text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500 resize-none"
                />
              </div>

              {/* Switch de Ativo */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-semibold text-zinc-300">Foto Ativa para a IA</span>
                <input
                  type="checkbox"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-pink-500"
                />
              </div>
              {/* Janela de Horário Permitido */}
              <div className="space-y-2 rounded-xl bg-zinc-900/80 border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-pink-400" />
                    <span>Horário Permitido para Uso</span>
                  </label>
                  <span className="text-[10px] text-zinc-400">Brasília (UTC-3)</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  A IA só poderá usar esta foto dentro desta faixa de horário. Fora dela, o sistema oculta a foto para ela.
                </p>

                {/* Atalhos Rápidos */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => { setFormAllowedTimeStart(""); setFormAllowedTimeEnd(""); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      !formAllowedTimeStart && !formAllowedTimeEnd
                        ? "bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50"
                    }`}
                  >
                    24h (Sempre)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFormAllowedTimeStart("06:00"); setFormAllowedTimeEnd("12:00"); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      formAllowedTimeStart === "06:00" && formAllowedTimeEnd === "12:00"
                        ? "bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50"
                    }`}
                  >
                    Manhã (06h - 12h)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFormAllowedTimeStart("12:00"); setFormAllowedTimeEnd("17:00"); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      formAllowedTimeStart === "12:00" && formAllowedTimeEnd === "17:00"
                        ? "bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50"
                    }`}
                  >
                    Tarde / Estágio (12h - 17h)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFormAllowedTimeStart("18:00"); setFormAllowedTimeEnd("23:59"); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      formAllowedTimeStart === "18:00" && (formAllowedTimeEnd === "23:59" || formAllowedTimeEnd === "00:00")
                        ? "bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50"
                    }`}
                  >
                    Noite / Aula (18h - 00h)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFormAllowedTimeStart("00:00"); setFormAllowedTimeEnd("06:00"); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      formAllowedTimeStart === "00:00" && formAllowedTimeEnd === "06:00"
                        ? "bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50"
                    }`}
                  >
                    Madrugada (00h - 06h)
                  </button>
                </div>

                {/* Inputs de Horário Manual */}
                <div className="grid grid-cols-2 gap-2 pt-1.5">
                  <div>
                    <span className="text-[10px] font-medium text-zinc-400 block mb-1">A partir de (Início)</span>
                    <input
                      type="time"
                      value={formAllowedTimeStart}
                      onChange={(e) => setFormAllowedTimeStart(e.target.value)}
                      className="w-full px-2.5 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-pink-500"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-zinc-400 block mb-1">Até às (Término)</span>
                    <input
                      type="time"
                      value={formAllowedTimeEnd}
                      onChange={(e) => setFormAllowedTimeEnd(e.target.value)}
                      className="w-full px-2.5 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-pink-500"
                    />
                  </div>
                </div>
              </div>

              {/* Toggle Visualização Única */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-zinc-300">Visualização Única</span>
                  <span className="text-[10px] text-zinc-500">A foto desaparece após ser vista</span>
                </div>
                <input
                  type="checkbox"
                  checked={formIsViewOnce}
                  onChange={(e) => setFormIsViewOnce(e.target.checked)}
                  className="w-4 h-4 rounded accent-pink-500"
                />
              </div>

              {/* Botões do Modal */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-pink-500 hover:bg-pink-600 text-xs font-semibold text-white flex items-center gap-1.5 shadow-md shadow-pink-500/20"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{editingImage ? "Salvar Alterações" : "Cadastrar Foto"}</span>
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
