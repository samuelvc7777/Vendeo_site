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
  Target,
  ChevronDown,
  ChevronUp,
  Sliders,
  CheckCircle2,
  CircleDot,
  Power,
} from "lucide-react";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";
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
      goals?: ConversationGoal[];
    }
  ) => Promise<any>;
  onDeleteStage: (id: string) => Promise<any>;
  onMoveUp: (id: string) => Promise<any>;
  onMoveDown: (id: string) => Promise<any>;
  onAddGoal?: (
    stageId: string,
    data: {
      label: string;
      memoryEntity?: string;
      memoryField: string;
      description?: string;
      required?: boolean;
      enabled?: boolean;
    }
  ) => Promise<any>;
  onUpdateGoal?: (
    stageId: string,
    goalId: string,
    updates: Partial<ConversationGoal>
  ) => Promise<any>;
  onDeleteGoal?: (stageId: string, goalId: string) => Promise<any>;
  onMoveGoalUp?: (stageId: string, goalId: string) => Promise<any>;
  onMoveGoalDown?: (stageId: string, goalId: string) => Promise<any>;
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
  onAddGoal,
  onUpdateGoal,
  onDeleteGoal,
  onMoveGoalUp,
  onMoveGoalDown,
}: ChatStagesManagerProps) {
  const { folders, refreshFolders } = useVault();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<ChatStage | null>(null);

  // Form states para Etapas
  const [name, setName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados para Objetivos da Conversa (Goals)
  const [expandedStageGoals, setExpandedStageGoals] = useState<Record<string, boolean>>({});
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [activeGoalStageId, setActiveGoalStageId] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<ConversationGoal | null>(null);

  const [goalLabel, setGoalLabel] = useState("");
  const [goalMemoryEntity, setGoalMemoryEntity] = useState("self");
  const [goalMemoryField, setGoalMemoryField] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalRequired, setGoalRequired] = useState(true);
  const [goalEnabled, setGoalEnabled] = useState(true);
  const [isGoalSubmitting, setIsGoalSubmitting] = useState(false);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const toggleStageGoals = (stageId: string) => {
    setExpandedStageGoals((prev) => ({
      ...prev,
      [stageId]: !prev[stageId],
    }));
  };

  const openAddGoalModal = (stageId: string) => {
    setActiveGoalStageId(stageId);
    setEditingGoal(null);
    setGoalLabel("");
    setGoalMemoryEntity("self");
    setGoalMemoryField("");
    setGoalDescription("");
    setGoalRequired(true);
    setGoalEnabled(true);
    setIsGoalModalOpen(true);
  };

  const openEditGoalModal = (stageId: string, goal: ConversationGoal) => {
    setActiveGoalStageId(stageId);
    setEditingGoal(goal);
    setGoalLabel(goal.label);
    setGoalMemoryEntity(goal.memoryEntity || "self");
    setGoalMemoryField(goal.memoryField || "");
    setGoalDescription(goal.description || "");
    setGoalRequired(goal.required ?? false);
    setGoalEnabled(goal.enabled ?? true);
    setIsGoalModalOpen(true);
  };

  const closeGoalModal = () => {
    setIsGoalModalOpen(false);
    setActiveGoalStageId(null);
    setEditingGoal(null);
  };

  const handleGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGoalStageId || !goalLabel.trim() || !goalMemoryField.trim()) return;

    setIsGoalSubmitting(true);
    try {
      if (editingGoal) {
        if (onUpdateGoal) {
          await onUpdateGoal(activeGoalStageId, editingGoal.id, {
            label: goalLabel.trim(),
            memoryEntity: (goalMemoryEntity || "self").trim().toLowerCase(),
            memoryField: goalMemoryField.trim().toLowerCase(),
            description: goalDescription.trim(),
            required: goalRequired,
            enabled: goalEnabled,
          });
        } else {
          // Fallback via onUpdateStage
          const targetStage = stages.find((s) => s.id === activeGoalStageId);
          if (targetStage) {
            const updatedGoals = (targetStage.goals || []).map((g) =>
              g.id === editingGoal.id
                ? {
                    ...g,
                    label: goalLabel.trim(),
                    memoryEntity: (goalMemoryEntity || "self").trim().toLowerCase(),
                    memoryField: goalMemoryField.trim().toLowerCase(),
                    description: goalDescription.trim(),
                    required: goalRequired,
                    enabled: goalEnabled,
                  }
                : g
            );
            await onUpdateStage(activeGoalStageId, { goals: updatedGoals });
          }
        }
      } else {
        if (onAddGoal) {
          await onAddGoal(activeGoalStageId, {
            label: goalLabel.trim(),
            memoryEntity: (goalMemoryEntity || "self").trim().toLowerCase(),
            memoryField: goalMemoryField.trim().toLowerCase(),
            description: goalDescription.trim(),
            required: goalRequired,
            enabled: goalEnabled,
          });
        } else {
          // Fallback via onUpdateStage
          const targetStage = stages.find((s) => s.id === activeGoalStageId);
          if (targetStage) {
            const currentGoals = targetStage.goals || [];
            const newG: ConversationGoal = {
              id: "goal_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
              stageId: activeGoalStageId,
              label: goalLabel.trim(),
              memoryEntity: (goalMemoryEntity || "self").trim().toLowerCase(),
              memoryField: goalMemoryField.trim().toLowerCase(),
              description: goalDescription.trim(),
              required: goalRequired,
              order: currentGoals.length,
              enabled: goalEnabled,
            };
            await onUpdateStage(activeGoalStageId, { goals: [...currentGoals, newG] });
          }
        }
      }
      closeGoalModal();
    } finally {
      setIsGoalSubmitting(false);
    }
  };

  const handleToggleGoalEnabled = async (stageId: string, goal: ConversationGoal) => {
    const updated = !goal.enabled;
    if (onUpdateGoal) {
      await onUpdateGoal(stageId, goal.id, { enabled: updated });
    } else {
      const targetStage = stages.find((s) => s.id === stageId);
      if (targetStage) {
        const updatedGoals = (targetStage.goals || []).map((g) =>
          g.id === goal.id ? { ...g, enabled: updated } : g
        );
        await onUpdateStage(stageId, { goals: updatedGoals });
      }
    }
  };

  const handleDeleteGoal = async (stageId: string, goalId: string) => {
    if (confirm("Deseja realmente excluir este objetivo da conversa?")) {
      if (onDeleteGoal) {
        await onDeleteGoal(stageId, goalId);
      } else {
        const targetStage = stages.find((s) => s.id === stageId);
        if (targetStage) {
          const updatedGoals = (targetStage.goals || []).filter((g) => g.id !== goalId);
          updatedGoals.forEach((g, i) => { g.order = i; });
          await onUpdateStage(stageId, { goals: updatedGoals });
        }
      }
    }
  };

  const handleMoveGoalUp = async (stageId: string, goalId: string) => {
    if (onMoveGoalUp) {
      await onMoveGoalUp(stageId, goalId);
    } else {
      const targetStage = stages.find((s) => s.id === stageId);
      if (!targetStage) return;
      const goals = [...(targetStage.goals || [])].sort((a, b) => a.order - b.order);
      const idx = goals.findIndex((g) => g.id === goalId);
      if (idx <= 0) return;
      const temp = goals[idx - 1];
      goals[idx - 1] = goals[idx];
      goals[idx] = temp;
      goals.forEach((g, i) => { g.order = i; });
      await onUpdateStage(stageId, { goals });
    }
  };

  const handleMoveGoalDown = async (stageId: string, goalId: string) => {
    if (onMoveGoalDown) {
      await onMoveGoalDown(stageId, goalId);
    } else {
      const targetStage = stages.find((s) => s.id === stageId);
      if (!targetStage) return;
      const goals = [...(targetStage.goals || [])].sort((a, b) => a.order - b.order);
      const idx = goals.findIndex((g) => g.id === goalId);
      if (idx === -1 || idx >= goals.length - 1) return;
      const temp = goals[idx + 1];
      goals[idx + 1] = goals[idx];
      goals[idx] = temp;
      goals.forEach((g, i) => { g.order = i; });
      await onUpdateStage(stageId, { goals });
    }
  };

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

            const isGoalsExpanded = !!expandedStageGoals[stage.id];
            const stageGoals = (stage.goals || []).sort((a, b) => a.order - b.order);

            return (
              <div
                key={stage.id}
                className="rounded-xl bg-[#18181b] border border-[#27272a] hover:border-zinc-700 transition-all overflow-hidden"
              >
                {/* Linha Principal da Etapa */}
                <div className="p-3 space-y-2.5">
                  {/* Linha 1: Nome da Etapa e Ações */}
                  <div className="flex items-center justify-between gap-2">
                    {/* Lado Esquerdo: Posição, Cor, Nome */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-xs font-bold text-zinc-500 w-5 shrink-0">#{index + 1}</span>

                      <div
                        className="w-2.5 h-6 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: stage.color || "#3b82f6" }}
                      />

                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white truncate">{stage.name}</h4>
                        {isLast && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                            Final
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Lado Direito: Ações (Reordenar, Editar, Excluir) */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => onMoveUp(stage.id)}
                        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform"
                        title="Mover para cima"
                        aria-label="Mover para cima"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => onMoveDown(stage.id)}
                        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform"
                        title="Mover para baixo"
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(stage)}
                        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-sky-400 active:scale-90 transition-all ml-0.5"
                        title="Editar etapa"
                        aria-label="Editar etapa"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

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

                  {/* Linha 2: Metadados do Cofre */}
                  <div className="flex items-center gap-2 text-xs text-zinc-400 pl-7">
                    <span className="flex items-center gap-1 truncate text-zinc-300">
                      <Folder className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="truncate max-w-[150px] sm:max-w-none">{folderName}</span>
                    </span>
                    <span>•</span>
                    <span className="text-zinc-400">{itemCount} itens no cofre</span>
                  </div>

                  {/* Linha 3: Barra de Acesso aos Objetivos Semânticos */}
                  <div className="pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStageGoals(stage.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border border-zinc-800/80 transition-colors text-xs font-semibold active:scale-95"
                    >
                      <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>Objetivos da Conversa ({stageGoals.length})</span>
                      {isGoalsExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-400 ml-0.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openAddGoalModal(stage.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold active:scale-95 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo Objetivo</span>
                    </button>
                  </div>
                </div>

                {/* Seção Expandida: Objetivos da Conversa (Checklist Semântico) */}
                {isGoalsExpanded && (
                  <div className="border-t border-[#27272a] bg-zinc-950/40 p-3 space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-sky-400" />
                        <span className="text-xs font-bold text-white">
                          Objetivos Semânticos da Conversa
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          (Bússola para subagentes, sem interrogatório)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAddGoalModal(stage.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 text-xs font-semibold active:scale-95 transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Adicionar Objetivo</span>
                      </button>
                    </div>

                    {stageGoals.length === 0 ? (
                      <div className="p-3 rounded-lg border border-dashed border-zinc-800 text-center">
                        <p className="text-xs text-zinc-400">
                          Nenhum objetivo conversacional definido para esta etapa.
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Adicione tópicos que a persona deve descobrir organicamente (ex: Idade, Cidade, Profissão).
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {stageGoals.map((goal, gIdx) => {
                          const isFirstGoal = gIdx === 0;
                          const isLastGoal = gIdx === stageGoals.length - 1;

                          return (
                            <div
                              key={goal.id}
                              className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 transition-all ${
                                goal.enabled
                                  ? "bg-zinc-900/80 border-zinc-800"
                                  : "bg-zinc-900/30 border-zinc-800/50 opacity-60"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-[11px] font-mono text-zinc-500 w-4 shrink-0">
                                  #{gIdx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold text-zinc-200">
                                      {goal.label}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono border border-zinc-700/50">
                                      {goal.memoryEntity || "self"}.{goal.memoryField}
                                    </span>
                                    {goal.required && (
                                      <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 text-[10px] font-medium border border-amber-500/20">
                                        Obrigatório
                                      </span>
                                    )}
                                    {!goal.enabled && (
                                      <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500 text-[10px]">
                                        Inativo
                                      </span>
                                    )}
                                  </div>
                                  {goal.description && (
                                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                      {goal.description}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {/* Toggle Ativo / Inativo */}
                                <button
                                  type="button"
                                  onClick={() => handleToggleGoalEnabled(stage.id, goal)}
                                  className={`p-1 rounded-md transition-colors ${
                                    goal.enabled
                                      ? "text-emerald-400 hover:bg-emerald-500/10"
                                      : "text-zinc-500 hover:bg-zinc-800"
                                  }`}
                                  title={goal.enabled ? "Desativar objetivo" : "Ativar objetivo"}
                                >
                                  <Power className="w-3.5 h-3.5" />
                                </button>

                                {/* Seta Subir */}
                                <button
                                  type="button"
                                  disabled={isFirstGoal}
                                  onClick={() => handleMoveGoalUp(stage.id, goal.id)}
                                  className="p-1 rounded-md text-zinc-400 hover:text-white disabled:opacity-20 transition-colors"
                                  title="Subir prioridade"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>

                                {/* Seta Descer */}
                                <button
                                  type="button"
                                  disabled={isLastGoal}
                                  onClick={() => handleMoveGoalDown(stage.id, goal.id)}
                                  className="p-1 rounded-md text-zinc-400 hover:text-white disabled:opacity-20 transition-colors"
                                  title="Descer prioridade"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>

                                {/* Editar */}
                                <button
                                  type="button"
                                  onClick={() => openEditGoalModal(stage.id, goal)}
                                  className="p-1 rounded-md text-zinc-400 hover:text-sky-400 transition-colors"
                                  title="Editar objetivo"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>

                                {/* Excluir */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteGoal(stage.id, goal.id)}
                                  className="p-1 rounded-md text-zinc-400 hover:text-red-400 transition-colors"
                                  title="Excluir objetivo"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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

      {/* Modal de Criação / Edição de Objetivo Semântico (Goal) */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-sky-400" />
                {editingGoal ? "Editar Objetivo" : "Novo Objetivo da Conversa"}
              </h4>
              <button
                type="button"
                onClick={closeGoalModal}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGoalSubmit} className="space-y-3.5">
              {/* Rótulo do Goal */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Rótulo do Objetivo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Idade, Cidade onde mora, Profissão"
                  value={goalLabel}
                  onChange={(e) => setGoalLabel(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Mapeamento de Memória: Entidade e Campo */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Entidade de Memória *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="self"
                    value={goalMemoryEntity}
                    onChange={(e) => setGoalMemoryEntity(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono text-xs"
                  />
                  <p className="text-[10px] text-zinc-500">Padrão: &quot;self&quot; (o pretendente)</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Campo de Memória *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="age, city, occupation"
                    value={goalMemoryField}
                    onChange={(e) => setGoalMemoryField(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono text-xs"
                  />
                  <p className="text-[10px] text-zinc-500">Campo salvo pelo MemoryWriter</p>
                </div>
              </div>

              {/* Descrição / Orientação para a IA */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">
                  Orientação para a IA (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Descobrir a idade naturalmente quando falar de estudos ou trabalho, sem parecer interrogatório..."
                  value={goalDescription}
                  onChange={(e) => setGoalDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Flags: Obrigatório e Ativo */}
              <div className="pt-1 flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={goalRequired}
                    onChange={(e) => setGoalRequired(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 bg-zinc-900 border-zinc-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-xs text-zinc-300">Obrigatório na etapa</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={goalEnabled}
                    onChange={(e) => setGoalEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-zinc-900 border-zinc-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-xs text-zinc-300">Ativo</span>
                </label>
              </div>

              {/* Botões do Modal */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={closeGoalModal}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isGoalSubmitting || !goalLabel.trim() || !goalMemoryField.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95"
                >
                  {isGoalSubmitting
                    ? "Salvando..."
                    : editingGoal
                    ? "Salvar Alterações"
                    : "Adicionar Objetivo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
