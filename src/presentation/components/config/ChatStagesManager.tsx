"use client";

import React, { useState, useEffect } from "react";
import {
  Layers,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit2,
  Check,
  X,
  Folder,
  Sparkles,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { ChatStage } from "@/domain/entities/ChatStage";
import { VaultFolderWithStats } from "@/domain/entities/Vault";
import { useVault } from "@/presentation/hooks/useVault";

interface ChatStagesManagerProps {
  stages: ChatStage[];
  onCreateStage: (data: {
    name: string;
    folderId: string;
    color?: string;
    description?: string;
  }) => Promise<any>;
  onUpdateStage: (
    id: string,
    data: {
      name?: string;
      folderId?: string;
      color?: string;
      description?: string;
    }
  ) => Promise<any>;
  onDeleteStage: (id: string) => Promise<any>;
  onMoveUp: (id: string) => Promise<any>;
  onMoveDown: (id: string) => Promise<any>;
}

const PRESET_COLORS = [
  "#3b82f6", // Azul
  "#10b981", // Esmeralda
  "#f59e0b", // Âmbar
  "#8b5cf6", // Roxo
  "#ec4899", // Rosa
  "#06b6d4", // Ciano
  "#ef4444", // Vermelho
  "#eab308", // Amarelo
];

export function ChatStagesManager({
  stages,
  onCreateStage,
  onUpdateStage,
  onDeleteStage,
  onMoveUp,
  onMoveDown,
}: ChatStagesManagerProps) {
  const { folders, refreshFolders } = useVault();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<ChatStage | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const openCreateModal = () => {
    setEditingStage(null);
    setName("");
    setSelectedFolderId(folders[0]?.id || "");
    setSelectedColor(PRESET_COLORS[stages.length % PRESET_COLORS.length]);
    setDescription("");
    setIsModalOpen(true);
  };

  const openEditModal = (stage: ChatStage) => {
    setEditingStage(stage);
    setName(stage.name);
    setSelectedFolderId(stage.folderId);
    setSelectedColor(stage.color || PRESET_COLORS[0]);
    setDescription(stage.description || "");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!selectedFolderId) return;

    setIsSubmitting(true);
    try {
      if (editingStage) {
        await onUpdateStage(editingStage.id, {
          name: name.trim(),
          folderId: selectedFolderId,
          color: selectedColor,
          description: description.trim(),
        });
      } else {
        await onCreateStage({
          name: name.trim(),
          folderId: selectedFolderId,
          color: selectedColor,
          description: description.trim(),
        });
      }
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFolderName = (folderId: string) => {
    const f = folders.find((item) => item.id === folderId);
    return f ? f.name : "Pasta não encontrada";
  };

  const getFolderItemCount = (folderId: string) => {
    const f = folders.find((item) => item.id === folderId);
    return f ? f.totalItems : 0;
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho da Seção */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            Funil de Conversão & Checklists (Check-ups)
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Defina as etapas sequenciais das conversas. Cada etapa herda os arquivos da pasta do cofre vinculada.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all shadow-md shadow-sky-500/20"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nova Etapa</span>
        </button>
      </div>

      {/* Lista de Etapas */}
      {stages.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-zinc-800 text-center space-y-3 bg-zinc-900/30">
          <div className="w-10 h-10 rounded-full bg-zinc-800/80 text-zinc-400 flex items-center justify-center mx-auto">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-300">Nenhuma etapa cadastrada ainda</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Crie etapas como &ldquo;1. Conexão & Apresentação&rdquo;, &ldquo;2. Semeadura da Rifa&rdquo; e vincule às suas pastas do cofre.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors"
          >
            Criar Primeira Etapa
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, index) => {
            const isFirst = index === 0;
            const isLast = index === stages.length - 1;
            const folderName = getFolderName(stage.folderId);
            const itemCount = getFolderItemCount(stage.folderId);

            return (
              <div
                key={stage.id}
                className="p-3 rounded-xl bg-[#18181b] border border-[#27272a] hover:border-zinc-700 transition-all flex items-center justify-between gap-3"
              >
                {/* Lado Esquerdo: Posição, Cor, Nome e Pasta */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex flex-col items-center justify-center w-6 shrink-0">
                    <span className="text-xs font-bold text-zinc-400">#{index + 1}</span>
                  </div>

                  <div
                    className="w-3 h-8 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: stage.color || "#3b82f6" }}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white truncate">{stage.name}</h4>
                      {isLast && (
                        <span className="shrink-0 px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                          Etapa Final
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                      <span className="flex items-center gap-1 truncate text-zinc-300">
                        <Folder className="w-3 h-3 text-sky-400 shrink-0" />
                        {folderName}
                      </span>
                      <span>•</span>
                      <span className="text-zinc-400">{itemCount} itens no checklist</span>
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Ações (Reordenar ⬆️ ⬇️, Editar, Excluir) */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Seta Subir */}
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => onMoveUp(stage.id)}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none active:scale-90 transition-transform"
                    title="Mover para cima"
                    aria-label="Mover para cima"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>

                  {/* Seta Descer */}
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => onMoveDown(stage.id)}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none active:scale-90 transition-transform"
                    title="Mover para baixo"
                    aria-label="Mover para baixo"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Editar */}
                  <button
                    type="button"
                    onClick={() => openEditModal(stage)}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-sky-400 active:scale-90 transition-all ml-1"
                    title="Editar etapa"
                    aria-label="Editar etapa"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Excluir */}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Deseja realmente excluir a etapa "${stage.name}"?`)) {
                        onDeleteStage(stage.id);
                      }
                    }}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-red-400 active:scale-90 transition-all"
                    title="Excluir etapa"
                    aria-label="Excluir etapa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição de Etapa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                {editingStage ? "Editar Etapa" : "Nova Etapa do Funil"}
              </h4>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Nome da Etapa */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Nome da Etapa *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 1. Apresentação & Fotos da Rotina"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Pasta do Cofre Vinculada */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Pasta do Cofre Vinculada (Checklist) *</span>
                </label>
                {folders.length === 0 ? (
                  <p className="text-xs text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Você precisa ter ao menos uma pasta criada no Cofre de Arquivos.
                  </p>
                ) : (
                  <select
                    required
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="" disabled>
                      Selecione uma pasta do cofre...
                    </option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        📁 {f.name} ({f.totalItems} arquivos)
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-zinc-400">
                  Todos os arquivos existentes (e os que você adicionar depois) nesta pasta se tornam automaticamente o checklist desta etapa.
                </p>
              </div>

              {/* Cor da Etapa */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      style={{ backgroundColor: color }}
                      className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center ${
                        selectedColor === color
                          ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110"
                          : "opacity-80 hover:opacity-100 hover:scale-105"
                      }`}
                    >
                      {selectedColor === color && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descrição / Observações */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Descrição / Orientações (opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Mandar fotos de rotina no hospital e estabelecer conexão acolhedora..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim() || !selectedFolderId}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95"
                >
                  {isSubmitting
                    ? "Salvando..."
                    : editingStage
                    ? "Salvar Alterações"
                    : "Criar Etapa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
