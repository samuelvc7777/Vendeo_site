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
  Bot,
} from "lucide-react";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";
import { VaultFolderWithStats } from "@/domain/entities/Vault";
import { useVault } from "@/presentation/hooks/useVault";
import { useSubagents } from "@/presentation/hooks/useSubagents";
import { toast } from "sonner";

interface ChatStagesManagerProps {
  stages: ChatStage[];
  onCreateStage: (data: {
    name: string;
    folderId?: string;
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
      kind?: "fact" | "conversation_state";
      required?: boolean;
      enabled?: boolean;
      allowedSubagents?: string[];
      primarySubagent?: string;
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
  const { subagents } = useSubagents();
  const [editingGoal, setEditingGoal] = useState<ConversationGoal | null>(null);

  const [goalLabel, setGoalLabel] = useState("");
  const [goalKind, setGoalKind] = useState<"fact" | "conversation_state">("fact");
  const [goalMemoryEntity, setGoalMemoryEntity] = useState("self");
  const [goalMemoryField, setGoalMemoryField] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalRequired, setGoalRequired] = useState(false);
  const [goalEnabled, setGoalEnabled] = useState(true);
  const [goalAllowedSubagents, setGoalAllowedSubagents] = useState<string[]>([]);
  const [goalPrimarySubagent, setGoalPrimarySubagent] = useState<string>("");
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
    setGoalKind("fact");
    setGoalMemoryEntity("self");
    setGoalMemoryField("");
    setGoalDescription("");
    setGoalRequired(false);
    setGoalEnabled(true);
    // Por padrão, seleciona os subagentes ativos
    const activeIds = subagents.filter((s) => s.enabled !== false).map((s) => s.id);
    setGoalAllowedSubagents(activeIds);
    setGoalPrimarySubagent(activeIds[0] || "");
    setIsGoalModalOpen(true);
  };

  const openEditGoalModal = (stageId: string, goal: ConversationGoal) => {
    setActiveGoalStageId(stageId);
    setEditingGoal(goal);
    setGoalLabel(goal.label || goal.title || "");
    setGoalKind(goal.kind || "fact");
    setGoalMemoryEntity(goal.memoryEntity || (goal.kind === "conversation_state" ? "conversation" : "self"));
    setGoalMemoryField(goal.memoryField || "");
    setGoalDescription(goal.description || "");
    setGoalRequired(goal.required ?? false);
    setGoalEnabled(goal.enabled ?? true);
    setGoalAllowedSubagents(goal.allowedSubagents || []);
    setGoalPrimarySubagent(goal.primarySubagent || "");
    setIsGoalModalOpen(true);
  };

  const closeGoalModal = () => {
    setIsGoalModalOpen(false);
    setActiveGoalStageId(null);
    setEditingGoal(null);
    setGoalAllowedSubagents([]);
    setGoalPrimarySubagent("");
  };

  const handleGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGoalStageId || !goalLabel.trim()) return;

    let finalField = goalMemoryField.trim().toLowerCase();
    if (!finalField) {
      if (goalKind === "conversation_state") {
        finalField = goalLabel.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      } else {
        return;
      }
    }

    const finalEntity = (goalMemoryEntity || (goalKind === "conversation_state" ? "conversation" : "self")).trim().toLowerCase();

    setIsGoalSubmitting(true);
    try {
      if (editingGoal) {
        if (onUpdateGoal) {
          await onUpdateGoal(activeGoalStageId, editingGoal.id, {
            label: goalLabel.trim(),
            kind: goalKind,
            memoryEntity: finalEntity,
            memoryField: finalField,
            description: goalDescription.trim(),
            required: goalRequired,
            enabled: goalEnabled,
            allowedSubagents: goalAllowedSubagents,
            primarySubagent: goalPrimarySubagent || undefined,
          });
        } else {
          // Fallback via onUpdateStage
          const targetStage = stages.find((s) => s.id === activeGoalStageId);
          if (targetStage) {
            const updatedGoals = (targetStage.goals || []).map((g) =>
              g.id === editingGoal.id
                ? {
                    ...g,
                    title: goalLabel.trim(),
                    label: goalLabel.trim(),
                    kind: goalKind,
                    memoryEntity: finalEntity,
                    memoryField: finalField,
                    description: goalDescription.trim(),
                    required: goalRequired,
                    enabled: goalEnabled,
                    allowedSubagents: goalAllowedSubagents,
                    primarySubagent: goalPrimarySubagent || undefined,
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
            kind: goalKind,
            memoryEntity: finalEntity,
            memoryField: finalField,
            description: goalDescription.trim(),
            required: goalRequired,
            enabled: goalEnabled,
            allowedSubagents: goalAllowedSubagents,
            primarySubagent: goalPrimarySubagent || undefined,
          });
        } else {
          // Fallback via onUpdateStage
          const targetStage = stages.find((s) => s.id === activeGoalStageId);
          if (targetStage) {
            const currentGoals = targetStage.goals || [];
            const newG: ConversationGoal = {
              id: "goal_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
              stageId: activeGoalStageId,
              title: goalLabel.trim(),
              label: goalLabel.trim(),
              kind: goalKind,
              memoryEntity: finalEntity,
              memoryField: finalField,
              description: goalDescription.trim(),
              required: goalRequired,
              order: currentGoals.length,
              enabled: goalEnabled,
              allowedSubagents: goalAllowedSubagents,
              primarySubagent: goalPrimarySubagent || undefined,
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

  const handleSuggestAiObjectives = async (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    const defaultSuggestions = [
      {
        label: "Descobrir cidade",
        memoryEntity: "self",
        memoryField: "city",
        description: "Descobrir onde o pretendente mora de forma natural",
        required: true,
      },
      {
        label: "Descobrir profissão",
        memoryEntity: "self",
        memoryField: "profession",
        description: "Entender no que ele trabalha ou estuda",
        required: true,
      },
      {
        label: "Descobrir idade",
        memoryEntity: "self",
        memoryField: "age",
        description: "Descobrir a faixa etária ou quantos anos tem",
        required: false,
      },
      {
        label: "Entender rotina",
        memoryEntity: "self",
        memoryField: "routine",
        description: "Entender horários e dinâmica do dia a dia",
        required: false,
      },
      {
        label: "Descobrir hobbies",
        memoryEntity: "self",
        memoryField: "hobbies",
        description: "Descobrir o que ele gosta de fazer no tempo livre",
        required: false,
      },
      {
        label: "Entender estilo de vida",
        memoryEntity: "self",
        memoryField: "lifestyle",
        description: "Preferências de passeios, esportes e gostos pessoais",
        required: false,
      },
    ];

    const current = stage.goals || [];
    const existingFields = new Set(current.map((g) => g.memoryField));
    const toAdd = defaultSuggestions.filter((s) => !existingFields.has(s.memoryField));

    if (toAdd.length === 0) {
      toast.info("Todos os objetivos padrão já foram adicionados a esta etapa.");
      return;
    }

    for (const sug of toAdd) {
      if (onAddGoal) {
        await onAddGoal(stageId, {
          label: sug.label,
          memoryEntity: sug.memoryEntity,
          memoryField: sug.memoryField,
          description: sug.description,
          required: sug.required,
          enabled: true,
        });
      }
    }
    toast.success(`✨ ${toAdd.length} objetivos sugeridos com IA adicionados!`);
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
    setSelectedFolderId(stage.folderId || "");
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

    setIsSubmitting(true);
    try {
      if (editingStage) {
        await onUpdateStage(editingStage.id, {
          name: name.trim(),
          folderId: selectedFolderId || undefined,
          color: selectedColor,
          description: description.trim(),
        });
      } else {
        await onCreateStage({
          name: name.trim(),
          folderId: selectedFolderId || undefined,
          color: selectedColor,
          description: description.trim(),
        });
      }
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFolderName = (folderId?: string) => {
    if (!folderId) return "Sem pasta associada";
    const f = folders.find((item) => item.id === folderId);
    return f ? f.name : "Pasta não encontrada";
  };

  const getFolderItemCount = (folderId?: string) => {
    if (!folderId) return 0;
    const f = folders.find((item) => item.id === folderId);
    return f ? f.totalItems : 0;
  };


  return (
    <div className="space-y-4">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          className="w-full sm:w-auto py-2 sm:py-1.5 px-3.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-md shadow-sky-500/20 min-h-[38px] sm:min-h-0 cursor-pointer"
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
                <div className="p-3 sm:p-3.5 space-y-2.5">
                  {/* Linha 1: Nome da Etapa e Ações */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    {/* Lado Esquerdo: Posição, Cor, Nome */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
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
                    <div className="flex items-center justify-end gap-1.5 shrink-0 pt-1 sm:pt-0 border-t border-zinc-800/40 sm:border-t-0">
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => onMoveUp(stage.id)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform cursor-pointer"
                        title="Mover para cima"
                        aria-label="Mover para cima"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => onMoveDown(stage.id)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform cursor-pointer"
                        title="Mover para baixo"
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(stage)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:text-sky-400 active:scale-90 transition-all ml-0.5 cursor-pointer"
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
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:text-red-400 active:scale-90 transition-all cursor-pointer"
                        title="Excluir etapa"
                        aria-label="Excluir etapa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Linha 2: Metadados do Cofre */}
                  <div className="flex items-center gap-2 text-xs text-zinc-400 pl-0 sm:pl-7 flex-wrap">
                    <span className="flex items-center gap-1 truncate text-zinc-300">
                      <Folder className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="truncate max-w-[200px] sm:max-w-none">{folderName}</span>
                    </span>
                    <span>•</span>
                    <span className="text-zinc-400">{itemCount} itens no cofre</span>
                  </div>

                  {/* Linha 3: Barra de Acesso aos Objetivos Semânticos */}
                  <div className="pt-2 border-t border-zinc-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStageGoals(stage.id)}
                      className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border border-zinc-800/80 transition-colors text-xs font-semibold active:scale-95 cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>Objetivos da Conversa ({stageGoals.length})</span>
                      </div>
                      {isGoalsExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-400 ml-0.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openAddGoalModal(stage.id)}
                      className="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo Objetivo</span>
                    </button>
                  </div>
                </div>

                {/* Seção Expandida: Objetivos da Conversa (Checklist Semântico) */}
                {isGoalsExpanded && (
                  <div className="border-t border-[#27272a] bg-zinc-950/40 p-3 sm:p-3.5 space-y-3 animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="text-xs font-bold text-white">
                          Objetivos Semânticos da Conversa
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          (Bússola para subagentes, sem interrogatório)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <button
                          type="button"
                          onClick={() => handleSuggestAiObjectives(stage.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold active:scale-95 transition-all min-h-[34px] sm:min-h-0 cursor-pointer"
                          title="Sugerir objetivos padrão com IA"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                          <span>Sugerir com IA</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddGoalModal(stage.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 text-xs font-semibold active:scale-95 transition-all min-h-[34px] sm:min-h-0 cursor-pointer"
                        >
                          <Plus className="w-3 h-3 shrink-0" />
                          <span>Adicionar Objetivo</span>
                        </button>
                      </div>
                    </div>

                    {stageGoals.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center">
                        <p className="text-xs text-zinc-400">
                          Nenhum objetivo conversacional definido para esta etapa.
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Adicione tópicos que a persona deve descobrir organicamente (ex: Idade, Cidade, Profissão).
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {stageGoals.map((goal, gIdx) => {
                          const isFirstGoal = gIdx === 0;
                          const isLastGoal = gIdx === stageGoals.length - 1;

                          return (
                            <div
                              key={goal.id}
                              className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all ${
                                goal.enabled
                                  ? "bg-zinc-900/80 border-zinc-800"
                                  : "bg-zinc-900/30 border-zinc-800/50 opacity-60"
                              }`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <span className="text-[11px] font-mono text-zinc-500 w-5 shrink-0 pt-0.5">
                                  #{gIdx + 1}
                                </span>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-zinc-100">
                                      {goal.label}
                                    </span>
                                    {goal.kind === "conversation_state" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] font-medium border border-purple-500/30">
                                        Estado da Conversa
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-medium border border-emerald-500/30">
                                        Fato do Contato
                                      </span>
                                    )}
                                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono border border-zinc-700/50">
                                      {goal.memoryEntity || "self"}.{goal.memoryField}
                                    </span>
                                    {goal.required && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] font-medium border border-amber-500/20">
                                        Obrigatório
                                      </span>
                                    )}
                                    {!goal.enabled && (
                                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">
                                        Inativo
                                      </span>
                                    )}
                                  </div>
                                  {goal.description && (
                                    <p className="text-[11px] text-zinc-400 break-words leading-relaxed">
                                      {goal.description}
                                    </p>
                                  )}
                                  {goal.allowedSubagents && goal.allowedSubagents.length > 0 && (
                                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                                      <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                                        <Bot className="w-2.5 h-2.5" /> Subagentes:
                                      </span>
                                      {goal.allowedSubagents.map((subId) => {
                                        const subDef = subagents.find((s) => s.id === subId);
                                        const isPrimary = goal.primarySubagent === subId;
                                        return (
                                          <span
                                            key={subId}
                                            className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                              isPrimary
                                                ? "bg-sky-500/15 text-sky-300 border-sky-500/30 font-medium"
                                                : "bg-zinc-800/90 text-zinc-400 border-zinc-700/60"
                                            }`}
                                            title={subDef ? subDef.mission : subId}
                                          >
                                            {subDef ? subDef.name : subId}
                                            {isPrimary && " ★"}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Ações do Objetivo: barra dedicada com touch targets mínimos de 34px */}
                              <div className="flex items-center justify-between sm:justify-end gap-1.5 pt-2 border-t border-zinc-800/60 sm:border-t-0 sm:pt-0 shrink-0 w-full sm:w-auto">
                                <span className="sm:hidden text-[10px] text-zinc-500 font-medium">
                                  Prioridade & Ações
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {/* Toggle Ativo / Inativo */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleGoalEnabled(stage.id, goal)}
                                    className={`p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg border transition-all active:scale-95 cursor-pointer ${
                                      goal.enabled
                                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                                        : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:bg-zinc-700"
                                    }`}
                                    title={goal.enabled ? "Desativar objetivo" : "Ativar objetivo"}
                                    aria-label={goal.enabled ? "Desativar objetivo" : "Ativar objetivo"}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Seta Subir */}
                                  <button
                                    type="button"
                                    disabled={isFirstGoal}
                                    onClick={() => handleMoveGoalUp(stage.id, goal.id)}
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all active:scale-95 cursor-pointer"
                                    title="Subir prioridade"
                                    aria-label="Subir prioridade"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Seta Descer */}
                                  <button
                                    type="button"
                                    disabled={isLastGoal}
                                    onClick={() => handleMoveGoalDown(stage.id, goal.id)}
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all active:scale-95 cursor-pointer"
                                    title="Descer prioridade"
                                    aria-label="Descer prioridade"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Editar */}
                                  <button
                                    type="button"
                                    onClick={() => openEditGoalModal(stage.id, goal)}
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-sky-400 transition-all active:scale-95 cursor-pointer"
                                    title="Editar objetivo"
                                    aria-label="Editar objetivo"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Excluir */}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteGoal(stage.id, goal.id)}
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-red-950/30 border border-red-900/40 text-[#f87171] hover:bg-red-900/40 hover:text-white transition-all active:scale-95 cursor-pointer"
                                    title="Excluir objetivo"
                                    aria-label="Excluir objetivo"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4 overscroll-contain">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                {editingStage ? "Editar Etapa" : "Nova Etapa do Funil"}
              </h4>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 sm:p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer transition-colors"
                aria-label="Fechar"
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
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Descrição / Orientação da Etapa */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Descrição / Orientação para a Persona
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Conhecer o pretendente naturalmente, criar conexão inicial e entender seu estilo de vida."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
                />
              </div>

              {/* Pasta do Cofre (Opcional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Pasta do Cofre de Arquivos (Opcional)</span>
                  <span className="text-[10px] text-zinc-500">Opcional</span>
                </label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  <option value="">
                    Nenhuma pasta vinculada (opcional)
                  </option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      📁 {f.name} ({f.totalItems} arquivos)
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  Etapas agora funcionam de forma autônoma baseadas em Objetivos Semânticos. A vinculação de pasta é opcional.
                </p>
              </div>

              {/* Cor da Etapa */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      style={{ backgroundColor: color }}
                      className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center cursor-pointer ${
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
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
                />
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95 cursor-pointer text-center"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4 overscroll-contain">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-sky-400" />
                {editingGoal ? "Editar Objetivo" : "Novo Objetivo da Conversa"}
              </h4>
              <button
                type="button"
                onClick={closeGoalModal}
                className="p-2 sm:p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer transition-colors"
                aria-label="Fechar"
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
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Tipo de Objetivo: Fato vs Estado Conversacional */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Tipo Conceitual de Objetivo *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setGoalKind("fact");
                      if (goalMemoryEntity === "conversation") setGoalMemoryEntity("self");
                    }}
                    className={`px-3 py-2.5 sm:py-2 rounded-xl text-xs font-medium border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                      goalKind === "fact"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      Fato do Contato
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      Dado durável (idade, cidade, profissão).
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGoalKind("conversation_state");
                      if (goalMemoryEntity === "self") setGoalMemoryEntity("conversation");
                    }}
                    className={`px-3 py-2.5 sm:py-2 rounded-xl text-xs font-medium border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                      goalKind === "conversation_state"
                        ? "bg-purple-500/15 border-purple-500/40 text-purple-300"
                        : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      Estado da Conversa
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      Dinâmica qualitativa (reciprocidade, profundidade).
                    </span>
                  </button>
                </div>
              </div>

              {/* Mapeamento de Memória: Entidade e Campo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Entidade de Memória {goalKind === "fact" ? "*" : "(Opcional)"}
                  </label>
                  <input
                    type="text"
                    required={goalKind === "fact"}
                    placeholder={goalKind === "fact" ? "self" : "conversation"}
                    value={goalMemoryEntity}
                    onChange={(e) => setGoalMemoryEntity(e.target.value)}
                    className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono text-xs"
                  />
                  <p className="text-[10px] text-zinc-500">
                    {goalKind === "fact" ? 'Padrão: "self" (o pretendente)' : 'Padrão: "conversation"'}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Campo de Memória {goalKind === "fact" ? "*" : "(Auto se vazio)"}
                  </label>
                  <input
                    type="text"
                    required={goalKind === "fact"}
                    placeholder={goalKind === "fact" ? "age, city, job" : "slug do estado"}
                    value={goalMemoryField}
                    onChange={(e) => setGoalMemoryField(e.target.value)}
                    className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono text-xs"
                  />
                  <p className="text-[10px] text-zinc-500">
                    {goalKind === "fact" ? "Campo salvo na ContactMemory" : "Avaliado pelo contexto e histórico"}
                  </p>
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
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
                />
              </div>

              {/* Vínculo com Subagentes (allowedSubagents & primarySubagent) */}
              <div className="space-y-2 pt-1 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-sky-400" />
                    Subagentes Autorizados *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setGoalAllowedSubagents(
                          subagents.filter((s) => s.enabled !== false).map((s) => s.id)
                        )
                      }
                      className="text-[10px] text-sky-400 hover:text-sky-300 font-medium px-2 py-1 rounded bg-sky-500/10 cursor-pointer active:scale-95"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGoalAllowedSubagents([]);
                        setGoalPrimarySubagent("");
                      }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-300 font-medium px-2 py-1 rounded bg-zinc-800 cursor-pointer active:scale-95"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Selecione quais subagentes podem conduzir ou avançar este objetivo quando assumirem o turno.
                </p>

                {subagents.length === 0 ? (
                  <div className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500">
                    Carregando catálogo de subagentes...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {subagents
                      .filter((s) => s.enabled !== false)
                      .map((sub) => {
                        const isSelected = goalAllowedSubagents.includes(sub.id);
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                const next = goalAllowedSubagents.filter((id) => id !== sub.id);
                                setGoalAllowedSubagents(next);
                                if (goalPrimarySubagent === sub.id) {
                                  setGoalPrimarySubagent(next[0] || "");
                                }
                              } else {
                                const next = [...goalAllowedSubagents, sub.id];
                                setGoalAllowedSubagents(next);
                                if (!goalPrimarySubagent) {
                                  setGoalPrimarySubagent(sub.id);
                                }
                              }
                            }}
                            className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                              isSelected
                                ? "bg-sky-500/10 border-sky-500/40 text-white"
                                : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-800/60"
                            }`}
                          >
                            <div className="min-w-0 pr-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate">{sub.name}</span>
                                <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                                  {sub.isSystem ? "Sistema" : "Custom"}
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                                {sub.id}
                              </p>
                            </div>
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                                isSelected
                                  ? "bg-sky-500 border-sky-500 text-white"
                                  : "border-zinc-700 bg-zinc-900"
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}

                {goalAllowedSubagents.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                      Agente Principal (Opcional)
                    </label>
                    <select
                      value={goalPrimarySubagent}
                      onChange={(e) => setGoalPrimarySubagent(e.target.value)}
                      className="w-full px-3 py-2.5 sm:py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                    >
                      <option value="">Nenhum (todos os autorizados têm o mesmo peso)</option>
                      {goalAllowedSubagents.map((subId) => {
                        const sub = subagents.find((s) => s.id === subId);
                        return (
                          <option key={subId} value={subId}>
                            {sub ? sub.name : subId} ({subId})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              {/* Flags: Obrigatório e Ativo */}
              <div className="pt-1 flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={goalRequired}
                    onChange={(e) => setGoalRequired(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 bg-zinc-900 border-zinc-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-xs text-zinc-300">Obrigatório na etapa</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none py-1">
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
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={closeGoalModal}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isGoalSubmitting || !goalLabel.trim() || !goalMemoryField.trim()}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95 cursor-pointer text-center"
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
