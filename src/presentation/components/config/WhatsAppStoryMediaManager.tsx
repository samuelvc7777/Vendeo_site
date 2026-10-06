"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Film,
  Image as ImageIcon,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertCircle,
  Play,
  UploadCloud,
  Layers,
  Sparkles,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { WhatsAppStoryMedia } from "@/domain/entities/WhatsAppStoryMedia";
import { WhatsAppStoryMediaRepository } from "@/infrastructure/repositories/WhatsAppStoryMediaRepository";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface WhatsAppStoryMediaManagerProps {
  onSelectStoryForPosting?: (story: WhatsAppStoryMedia) => void;
}

export function WhatsAppStoryMediaManager({
  onSelectStoryForPosting,
}: WhatsAppStoryMediaManagerProps) {
  const [stories, setStories] = useState<WhatsAppStoryMedia[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmStory, setDeleteConfirmStory] = useState<{ id: string; title: string } | null>(null);
  const [resetConfirmStory, setResetConfirmStory] = useState<{ id: string; title: string } | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [captionInput, setCaptionInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<{
    file: File;
    previewUrl: string;
    type: "image" | "video";
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadStories = () => {
    const list = WhatsAppStoryMediaRepository.getAll();
    setStories(list);
  };

  useEffect(() => {
    loadStories();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isImage && !isVideo) {
      toast.error("Formato não suportado. Escolha uma foto ou vídeo MP4.");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      toast.error("O arquivo excede o limite máximo de 25MB.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setSelectedFile({
      file,
      previewUrl,
      type: isVideo ? "video" : "image",
    });

    if (!titleInput.trim()) {
      const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      setTitleInput(baseName.charAt(0).toUpperCase() + baseName.slice(1));
    }
  };

  const handleSaveNewStory = async () => {
    if (!selectedFile) {
      toast.error("Selecione uma imagem ou vídeo.");
      return;
    }

    setIsUploading(true);
    try {
      // Converte o arquivo para Base64 Data URL para persistência segura
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile.file);
      });

      const mediaUrl = await base64Promise;

      WhatsAppStoryMediaRepository.create({
        title: titleInput.trim() || `Story ${new Date().toLocaleDateString("pt-BR")}`,
        type: selectedFile.type,
        mediaUrl,
        caption: captionInput.trim(),
      });

      toast.success("Story salvo na biblioteca com sucesso!");
      setTitleInput("");
      setCaptionInput("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadStories();
    } catch (err: any) {
      console.error("[WhatsAppStoryMediaManager] Erro ao salvar story:", err);
      toast.error("Erro ao salvar o arquivo na biblioteca.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteStory = (id: string, title: string) => {
    setDeleteConfirmStory({ id, title });
  };

  const handleResetSeen = (id: string, title: string) => {
    setResetConfirmStory({ id, title });
  };

  return (
    <div className="space-y-6">
      {/* Card Informativo com Regra de Negócio */}
      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 dark:border-sky-500/15 dark:bg-sky-500/10">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
        <div className="text-xs text-zinc-600 dark:text-zinc-300">
          <p className="font-bold text-zinc-900 dark:text-white">
            Estratégia Evergreen Anti-Repetição
          </p>
          <p className="mt-1 leading-relaxed">
            Cadastre suas fotos e vídeos aqui. Cada story possui um identificador único e registra quem já o visualizou.
            Quando for postar, os contatos que já viram aquele story específico{" "}
            <strong>serão ocultados automaticamente da seleção</strong>, garantindo que novos contatos sempre vejam o story sem que os antigos recebam conteúdo repetido.
          </p>
        </div>
      </div>

      {/* Formulário de Upload */}
      <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111113] p-4 shadow-sm sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-950 dark:text-white">
          <UploadCloud className="h-4 w-4 text-violet-500" />
          Adicionar Novo Story à Biblioteca
        </h3>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Seletor de Arquivo e Preview */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="hidden"
              id="story-upload-input"
            />
            {selectedFile ? (
              <div className="relative aspect-[9/16] max-h-72 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950">
                {selectedFile.type === "video" ? (
                  <video
                    src={selectedFile.previewUrl}
                    className="h-full w-full object-contain"
                    controls
                    playsInline
                  />
                ) : (
                  <img
                    src={selectedFile.previewUrl}
                    alt="Preview"
                    className="h-full w-full object-contain"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80"
                  title="Trocar arquivo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                htmlFor="story-upload-input"
                className="flex aspect-[9/16] max-h-72 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-6 text-center transition hover:border-violet-500 hover:bg-violet-50/20 dark:hover:border-violet-500/40"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <Plus className="h-6 w-6" />
                </div>
                <p className="mt-3 text-xs font-bold text-zinc-900 dark:text-white">
                  Clique para selecionar foto ou vídeo
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  JPG, PNG, WEBP ou MP4 até 25MB
                </p>
              </label>
            )}
          </div>

          {/* Campos de Título e Legenda */}
          <div className="flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Nome / Título do Story
                </label>
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="Ex: Apresentação da Loja, Look Vermelho..."
                  className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:text-white outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Legenda Padrão (Opcional)
                </label>
                <textarea
                  value={captionInput}
                  onChange={(e) => setCaptionInput(e.target.value)}
                  placeholder="Legenda que será sugerida ao postar..."
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 text-[16px] md:text-xs text-zinc-950 dark:text-white outline-none focus:border-violet-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveNewStory}
              disabled={isUploading || !selectedFile}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-xs font-bold text-white shadow-md shadow-violet-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-40 min-h-[44px]"
            >
              {isUploading ? (
                <>Salvando arquivo na biblioteca...</>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar Story na Biblioteca
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Grid de Stories Salvos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-950 dark:text-white">
            <Layers className="h-4 w-4 text-sky-500" />
            Stories Salvos na Biblioteca ({stories.length})
          </h3>
          <button
            type="button"
            onClick={loadStories}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 min-h-[36px]"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </button>
        </div>

        {stories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 p-8 text-center text-xs text-zinc-500">
            Nenhum story cadastrado ainda. Adicione fotos e vídeos acima para começar a biblioteca evergreen.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {stories.map((story) => {
              const seenCount = (story.seenContactIds || []).length;
              return (
                <div
                  key={story.id}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111113] shadow-sm transition hover:shadow-md"
                >
                  {/* Preview da Mídia */}
                  <div className="relative aspect-[9/16] w-full overflow-hidden bg-zinc-950">
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

                    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                      {story.type === "video" ? (
                        <>
                          <Film className="h-2.5 w-2.5 text-fuchsia-400" /> Vídeo
                        </>
                      ) : (
                        <>
                          <ImageIcon className="h-2.5 w-2.5 text-sky-400" /> Foto
                        </>
                      )}
                    </div>

                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-lg bg-black/70 px-2 py-1 text-[10px] text-white backdrop-blur">
                      <span className="flex items-center gap-1 font-bold text-emerald-400">
                        <Eye className="h-3 w-3" />
                        {seenCount} viram
                      </span>
                      <span className="text-[9px] text-zinc-300">
                        Postado {story.timesPosted || 0}x
                      </span>
                    </div>
                  </div>

                  {/* Informações e Ações */}
                  <div className="flex flex-1 flex-col justify-between p-3">
                    <div>
                      <p className="truncate text-xs font-bold text-zinc-900 dark:text-white" title={story.title}>
                        {story.title}
                      </p>
                      {story.caption && (
                        <p className="mt-1 line-clamp-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                          {story.caption}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 pt-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleResetSeen(story.id, story.title)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:text-amber-500 active:bg-amber-500/10 transition-colors"
                        title="Resetar contatos que já viram"
                        aria-label="Resetar contatos que já viram"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteStory(story.id, story.title)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:text-rose-500 active:bg-rose-500/10 transition-colors"
                        title="Excluir story"
                        aria-label="Excluir story"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Exclusão de Story */}
      <ResponsiveModal
        isOpen={Boolean(deleteConfirmStory)}
        onClose={() => setDeleteConfirmStory(null)}
        maxWidth="sm"
        title="Remover Story?"
        description={`O story "${deleteConfirmStory?.title}" será excluído permanentemente.`}
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <Trash2 className="h-5 w-5" />
          </div>
        }
        footer={
          <div className="flex w-full gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setDeleteConfirmStory(null)}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!deleteConfirmStory) return;
                WhatsAppStoryMediaRepository.delete(deleteConfirmStory.id);
                toast.success("Story removido com sucesso.");
                setDeleteConfirmStory(null);
                loadStories();
              }}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl bg-red-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-red-700 active:scale-95"
            >
              Sim, excluir
            </button>
          </div>
        }
      >
        <p className="text-xs text-zinc-600 dark:text-zinc-400 py-1">
          Ele deixará de ser sugerido para postagem nos status do WhatsApp.
        </p>
      </ResponsiveModal>

      {/* Modal de Reset de Visualizadores */}
      <ResponsiveModal
        isOpen={Boolean(resetConfirmStory)}
        onClose={() => setResetConfirmStory(null)}
        maxWidth="sm"
        title="Resetar Histórico?"
        description={`Histórico de "${resetConfirmStory?.title}".`}
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
            <RefreshCw className="h-5 w-5" />
          </div>
        }
        footer={
          <div className="flex w-full gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setResetConfirmStory(null)}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!resetConfirmStory) return;
                WhatsAppStoryMediaRepository.resetSeenContacts(resetConfirmStory.id);
                toast.success("Histórico de visualizadores resetado.");
                setResetConfirmStory(null);
                loadStories();
              }}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl bg-amber-500 px-4 text-xs font-bold text-black shadow-sm hover:bg-amber-400 active:scale-95"
            >
              Resetar histórico
            </button>
          </div>
        }
      >
        <p className="text-xs text-zinc-600 dark:text-zinc-400 py-1">
          Todos os contatos da sua lista que já viram este story poderão vê-lo novamente na próxima vez que for publicado.
        </p>
      </ResponsiveModal>
    </div>
  );
}
