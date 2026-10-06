"use client";

import React, { useState } from "react";
import {
  Layers,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit2,
  Check,
  Target,
  ChevronDown,
  Power,
} from "lucide-react";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";
import { toast } from "sonner";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface ChatStagesManagerProps {
  stages: ChatStage[];
  activeScheduleId?: string;
  onCreateStage: (data: {
    name: string;
    color?: string;
    description?: string;
    scheduleId?: string;
    isRequired?: boolean;
    icon?: string;
  }) => Promise<unknown>;
  onUpdateStage: (
    id: string,
    data: {
      name?: string;
      color?: string;
      description?: string;
      scheduleId?: string;
      isRequired?: boolean;
      goals?: ConversationGoal[];
    }
  ) => Promise<unknown>;
  onDeleteStage: (id: string) => Promise<unknown>;
  onMoveUp: (id: string) => Promise<unknown>;
  onMoveDown: (id: string) => Promise<unknown>;
  onAddGoal?: (
    stageId: string,
    data: {
      label: string;
      memoryEntity?: string;
      memoryField?: string;
      description?: string;
      kind?: ConversationGoal["kind"];
      completionPolicy?: ConversationGoal["completionPolicy"];
      actionType?: ConversationGoal["actionType"];
      actionConfig?: ConversationGoal["actionConfig"];
      required?: boolean;
      enabled?: boolean;
    }
  ) => Promise<unknown>;
  onUpdateGoal?: (
    stageId: string,
    goalId: string,
    updates: Partial<ConversationGoal>
  ) => Promise<unknown>;
  onDeleteGoal?: (stageId: string, goalId: string) => Promise<unknown>;
  onMoveGoalUp?: (stageId: string, goalId: string) => Promise<unknown>;
  onMoveGoalDown?: (stageId: string, goalId: string) => Promise<unknown>;
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
  activeScheduleId,
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<ChatStage | null>(null);

  // Form states para Etapas
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState("");
  const [stageRequired, setStageRequired] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados para Objetivos da Conversa (Goals)
  const [expandedStageGoals, setExpandedStageGoals] = useState<Record<string, boolean>>({});
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [activeGoalStageId, setActiveGoalStageId] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<ConversationGoal | null>(null);

  const [goalLabel, setGoalLabel] = useState("");
  const [goalKind, setGoalKind] = useState<NonNullable<ConversationGoal["kind"]>>("fact");
  const [goalActionType, setGoalActionType] = useState<NonNullable<ConversationGoal["actionType"]>>("send_audio");
  const [goalMemoryEntity, setGoalMemoryEntity] = useState("self");
  const [goalMemoryField, setGoalMemoryField] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalRequired, setGoalRequired] = useState(true);
  const [goalEnabled, setGoalEnabled] = useState(true);
  const [isGoalSubmitting, setIsGoalSubmitting] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<ChatStage | null>(null);
  const [goalToDelete, setGoalToDelete] = useState<{ stageId: string; goal: ConversationGoal } | null>(null);
  const [isDeletingStage, setIsDeletingStage] = useState(false);
  const [isDeletingGoal, setIsDeletingGoal] = useState(false);

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
    setGoalActionType("send_audio");
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
    setGoalLabel(goal.label || goal.title || "");
    setGoalKind(goal.kind || "fact");
    setGoalActionType(goal.actionType || "send_audio");
    setGoalMemoryEntity(goal.memoryEntity || (goal.kind === "conversation_state" ? "conversation" : "self"));
    setGoalMemoryField(goal.memoryField || "");
    setGoalDescription(goal.description || "");
    setGoalRequired(goal.required !== false);
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
    if (!activeGoalStageId || !goalLabel.trim()) return;

    let finalField = goalMemoryField.trim().toLowerCase();
    if (!finalField && goalKind === "conversation_state") {
      finalField = goalLabel.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    }
    if (goalKind === "fact" && !finalField) return;

    const finalEntity = goalKind === "action"
      ? undefined
      : (goalMemoryEntity || (goalKind === "conversation_state" ? "conversation" : "self")).trim().toLowerCase();
    const completionPolicy: ConversationGoal["completionPolicy"] =
      goalKind === "action"
        ? (goalActionType === "operator_handoff" ? "operator_handoff" : "delivery_confirmed")
        : "conversation_evidence";
    const actionConfig: ConversationGoal["actionConfig"] = goalKind === "action"
      ? {
          ...(goalActionType === "send_raffle_details" || goalActionType === "send_raffle_numbers"
            ? { raffleSource: "active" as const }
            : {}),
          ...(goalActionType === "send_raffle_numbers" ? { numbersCount: 10 } : {}),
          finalizeWorkflowOnCompletion: goalActionType === "operator_handoff",
        }
      : undefined;

    setIsGoalSubmitting(true);
    try {
      if (editingGoal) {
        if (onUpdateGoal) {
          await onUpdateGoal(activeGoalStageId, editingGoal.id, {
            label: goalLabel.trim(),
            kind: goalKind,
            memoryEntity: finalEntity,
            memoryField: finalField || undefined,
            description: goalDescription.trim(),
            completionPolicy,
            actionType: goalKind === "action" ? goalActionType : undefined,
            actionConfig,
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
                    title: goalLabel.trim(),
                    label: goalLabel.trim(),
                    kind: goalKind,
                    memoryEntity: finalEntity,
                    memoryField: finalField || undefined,
                    description: goalDescription.trim(),
                    completionPolicy,
                    actionType: goalKind === "action" ? goalActionType : undefined,
                    actionConfig,
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
            kind: goalKind,
            memoryEntity: finalEntity,
            memoryField: finalField || undefined,
            description: goalDescription.trim(),
            completionPolicy,
            actionType: goalKind === "action" ? goalActionType : undefined,
            actionConfig,
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
              title: goalLabel.trim(),
              label: goalLabel.trim(),
              kind: goalKind,
              memoryEntity: finalEntity,
              memoryField: finalField || undefined,
              description: goalDescription.trim(),
              completionPolicy,
              actionType: goalKind === "action" ? goalActionType : undefined,
              actionConfig,
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

  const handleConfirmDeleteStage = async () => {
    if (!stageToDelete) return;
    try {
      setIsDeletingStage(true);
      await onDeleteStage(stageToDelete.id);
      setStageToDelete(null);
      toast.success("Etapa removida com sucesso");
    } catch {
      toast.error("Erro ao remover etapa");
    } finally {
      setIsDeletingStage(false);
    }
  };

  const handleConfirmDeleteGoal = async () => {
    if (!goalToDelete) return;
    try {
      setIsDeletingGoal(true);
      const { stageId, goal } = goalToDelete;
      if (onDeleteGoal) {
        await onDeleteGoal(stageId, goal.id);
      } else {
        const targetStage = stages.find((s) => s.id === stageId);
        if (targetStage) {
          const updatedGoals = (targetStage.goals || []).filter((g) => g.id !== goal.id);
          updatedGoals.forEach((g, i) => { g.order = i; });
          await onUpdateStage(stageId, { goals: updatedGoals });
        }
      }
      setGoalToDelete(null);
      toast.success("Objetivo removido com sucesso");
    } catch {
      toast.error("Erro ao remover objetivo");
    } finally {
      setIsDeletingGoal(false);
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
    setSelectedColor(PRESET_COLORS[stages.length % PRESET_COLORS.length]);
    setDescription("");
    setStageRequired(true);
    setIsModalOpen(true);
  };

  const openEditModal = (stage: ChatStage) => {
    setEditingStage(stage);
    setName(stage.name);
    setSelectedColor(stage.color || PRESET_COLORS[0]);
    setDescription(stage.description || "");
    setStageRequired(stage.isRequired !== false);
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
          color: selectedColor,
          description: description.trim(),
          isRequired: stageRequired,
        });
      } else {
        await onCreateStage({
          name: name.trim(),
          scheduleId: activeScheduleId || "schedule_sales",
          isRequired: stageRequired,
          color: selectedColor,
          description: description.trim(),
        });
      }
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="space-y-3">
      {/* Cabeçalho Contextual da Seção de Etapas */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-0.5 pb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <h4 className="text-xs sm:text-sm font-bold tracking-tight text-zinc-950 dark:text-white">
              Etapas & Checkpoints
            </h4>
            <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
              {stages.length} {stages.length === 1 ? "etapa" : "etapas"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Sequência de progressão do Brain e marcos obrigatórios/opcionais da conversa.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-xs font-semibold text-white shadow-xs transition hover:bg-zinc-800 active:scale-95 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nova etapa</span>
        </button>
      </div>

      {/* Lista de Etapas */}
      {stages.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-zinc-200 dark:border-white/10 text-center space-y-2.5 bg-zinc-50/50 dark:bg-white/[0.02]">
          <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 flex items-center justify-center mx-auto">
            <Layers className="w-4.5 h-4.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Nenhuma etapa cadastrada neste cronograma</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-sm mx-auto">
              Crie etapas como &ldquo;1. Conexão & Apresentação&rdquo; e &ldquo;2. Oferta da Rifa&rdquo; para estruturar a progressão.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 text-xs font-semibold active:scale-95 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Criar primeira etapa
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, index) => {
            const isFirst = index === 0;
            const isLast = index === stages.length - 1;

            const isGoalsExpanded = !!expandedStageGoals[stage.id];
            const stageGoals = (stage.goals || []).sort((a, b) => a.order - b.order);
            const activeStageGoals = stageGoals.filter((goal) => goal.enabled !== false);
            const finalizesWorkflow =
              isLast &&
              activeStageGoals.length > 0 &&
              activeStageGoals.every((goal) => goal.actionConfig?.finalizeWorkflowOnCompletion !== false);

            return (
              <div
                key={stage.id}
                className={`overflow-hidden rounded-xl border transition-all duration-150 ${
                  isGoalsExpanded
                    ? "border-sky-300/80 bg-white shadow-xs dark:border-sky-500/30 dark:bg-zinc-900/80"
                    : "border-zinc-200/80 bg-white/90 hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-white/15"
                }`}
              >
                {/* Linha Principal da Etapa */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleStageGoals(stage.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleStageGoals(stage.id);
                    }
                  }}
                  className="w-full cursor-pointer p-2.5 sm:p-3 text-left select-none transition-colors hover:bg-zinc-50/50 dark:hover:bg-white/[0.015]"
                  aria-expanded={isGoalsExpanded}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    {/* Lado Esquerdo: Ordem, Cor, Nome e Badges */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono text-[11px] font-bold text-zinc-400 dark:text-zinc-500 w-5 text-center shrink-0">
                        #{index + 1}
                      </span>

                      <div
                        className="w-2 h-5 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: stage.color || "#3b82f6" }}
                      />

                      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                        <h5 className="text-xs sm:text-sm font-bold text-zinc-950 dark:text-white truncate max-w-[120px] sm:max-w-xs md:max-w-none">
                          {stage.name}
                        </h5>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                            stage.isRequired !== false
                              ? "bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25"
                              : "bg-violet-50 text-violet-700 border-violet-200/70 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/25"
                          }`}
                        >
                          {stage.isRequired !== false ? "Obrigatória" : "Opcional"}
                        </span>
                        {isLast && (
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                              finalizesWorkflow
                                ? "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
                                : "bg-sky-50 text-sky-700 border-sky-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30"
                            }`}
                          >
                            {finalizesWorkflow ? "Finaliza jornada" : "Continua aberta"}
                          </span>
                        )}
                        <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400 font-medium">
                          • {stageGoals.length} {stageGoals.length === 1 ? "checkpoint" : "checkpoints"}
                        </span>
                      </div>
                    </div>

                    {/* Lado Direito: Ações da Etapa & Alternador de Checkpoints */}
                    <div
                      className="flex shrink-0 items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => onMoveUp(stage.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent dark:hover:bg-white/10 dark:hover:text-white"
                        title="Mover etapa para cima"
                        aria-label="Mover etapa para cima"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => onMoveDown(stage.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent dark:hover:bg-white/10 dark:hover:text-white"
                        title="Mover etapa para baixo"
                        aria-label="Mover etapa para baixo"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(stage)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-500/10 dark:hover:text-sky-400"
                        title="Editar etapa"
                        aria-label="Editar etapa"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setStageToDelete(stage)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        title="Excluir etapa"
                        aria-label="Excluir etapa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleStageGoals(stage.id)}
                        className={`ml-1 flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition active:scale-95 ${
                          isGoalsExpanded
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                        }`}
                        aria-label={isGoalsExpanded ? "Recolher checkpoints" : "Ver checkpoints"}
                        title={isGoalsExpanded ? "Recolher checkpoints" : "Ver checkpoints"}
                      >
                        <span className="hidden sm:inline text-[10.5px]">
                          {isGoalsExpanded ? "Recolher" : "Checkpoints"}
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${
                            isGoalsExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Seção Expandida: Árvore Hierárquica de Checkpoints */}
                {isGoalsExpanded && (
                  <div className="border-t border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-black/20 p-2.5 sm:p-3 space-y-2">
                    {stageGoals.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-200 dark:border-white/10 p-3 text-center">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Nenhum checkpoint definido nesta etapa.
                        </p>
                        <button
                          type="button"
                          onClick={() => openAddGoalModal(stage.id)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          <Plus className="w-3 h-3" /> Adicionar primeiro checkpoint
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">
                        {stageGoals.map((goal, gIdx) => {
                          const isFirstGoal = gIdx === 0;
                          const isLastGoal = gIdx === stageGoals.length - 1;

                          return (
                            <div
                              key={goal.id}
                              className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border p-2 sm:px-3 sm:py-2 text-xs transition-all ml-6 ${
                                goal.enabled
                                  ? "bg-white dark:bg-zinc-900/90 border-zinc-200/80 dark:border-white/10 shadow-2xs"
                                  : "bg-zinc-50/60 dark:bg-zinc-900/30 border-zinc-200/50 dark:border-white/5 opacity-60"
                              }`}
                            >
                              {/* Linha horizontal conectora da árvore */}
                              <div className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-zinc-200 dark:bg-zinc-800" />

                              {/* Conteúdo do Checkpoint */}
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                                    #{gIdx + 1}
                                  </span>
                                  <span className="font-semibold text-zinc-900 dark:text-white">
                                    {goal.label}
                                  </span>

                                  {/* Tipo / Configuração relevante */}
                                  {goal.kind === "action" ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-medium border border-amber-200/60 dark:border-amber-500/20">
                                      Ação: {goal.actionType === "send_audio" ? "enviar áudio" : goal.actionType || "ação"}
                                    </span>
                                  ) : goal.kind === "conversation_state" ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 text-[10px] font-medium border border-purple-200/60 dark:border-purple-500/20">
                                      Estado: {goal.memoryField || "conversa"}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium border border-emerald-200/60 dark:border-emerald-500/20">
                                      Fato: {goal.memoryEntity || "self"}.{goal.memoryField}
                                    </span>
                                  )}

                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-medium border ${
                                      goal.required !== false
                                        ? "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20"
                                        : "bg-zinc-100 text-zinc-600 border-zinc-200/60 dark:bg-white/5 dark:text-zinc-400 dark:border-white/10"
                                    }`}
                                  >
                                    {goal.required !== false ? "Obrigatório" : "Opcional"}
                                  </span>

                                  {!goal.enabled && (
                                    <span className="px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-white/5 text-zinc-400 text-[10px]">
                                      Inativo
                                    </span>
                                  )}
                                </div>

                                {/* Descrição sutil se houver */}
                                {goal.description && (
                                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-1">
                                    {goal.description}
                                  </p>
                                )}
                              </div>

                              {/* Ações do Checkpoint */}
                              <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleGoalEnabled(stage.id, goal)}
                                  className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
                                    goal.enabled
                                      ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/15"
                                      : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5"
                                  }`}
                                  title={goal.enabled ? "Desativar checkpoint" : "Ativar checkpoint"}
                                  aria-label={goal.enabled ? "Desativar checkpoint" : "Ativar checkpoint"}
                                >
                                  <Power className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isFirstGoal}
                                  onClick={() => handleMoveGoalUp(stage.id, goal.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 disabled:opacity-20 disabled:hover:bg-transparent dark:hover:text-white dark:hover:bg-white/10 transition"
                                  title="Subir prioridade"
                                  aria-label="Subir prioridade"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isLastGoal}
                                  onClick={() => handleMoveGoalDown(stage.id, goal.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 disabled:opacity-20 disabled:hover:bg-transparent dark:hover:text-white dark:hover:bg-white/10 transition"
                                  title="Descer prioridade"
                                  aria-label="Descer prioridade"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditGoalModal(stage.id, goal)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:text-sky-400 dark:hover:bg-sky-500/10 transition"
                                  title="Editar checkpoint"
                                  aria-label="Editar checkpoint"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setGoalToDelete({ stageId: stage.id, goal })}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition"
                                  title="Excluir checkpoint"
                                  aria-label="Excluir checkpoint"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Botão Contextual de Novo Checkpoint dentro da Etapa */}
                    <div className="pt-1 flex justify-start">
                      <button
                        type="button"
                        onClick={() => openAddGoalModal(stage.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-sky-300 dark:border-sky-500/30 bg-sky-50/50 dark:bg-sky-500/5 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300 transition hover:bg-sky-100/70 dark:hover:bg-sky-500/15 active:scale-95"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Novo checkpoint nesta etapa</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição de Etapa */}
      <ResponsiveModal
        isOpen={isModalOpen}
        onClose={closeModal}
        maxWidth="lg"
        title={editingStage ? "Editar etapa do funil" : "Nova etapa do funil"}
        description="Configure o nome, cor de identificação e regras de avanço desta etapa."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <Layers className="h-5 w-5" />
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          {/* Nome da Etapa */}
          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Nome da etapa *</span>
            <input
              type="text"
              required
              placeholder="Ex: 1. Conexão & Apresentação"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 transition-colors"
            />
          </label>

          {/* Descrição / Orientação da Etapa */}
          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Orientação para o Brain nesta etapa (Opcional)</span>
            <textarea
              rows={2}
              placeholder="Ex: Conhecer o pretendente naturalmente, criar conexão inicial e entender seu estilo de vida."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 transition-colors leading-relaxed"
            />
          </label>

          {/* Cor da Etapa */}
          <div className="space-y-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Cor de identificação
            </span>
            <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center cursor-pointer ${
                    selectedColor === color
                      ? "ring-2 ring-zinc-950 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-110"
                      : "opacity-80 hover:opacity-100 hover:scale-105"
                  }`}
                  aria-label={`Selecionar cor ${color}`}
                >
                  {selectedColor === color && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Obrigatoriedade */}
          <label className="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02] cursor-pointer">
            <div>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Etapa obrigatória</p>
              <p className="text-[10px] text-zinc-500">Se for opcional, o Brain pode ignorá-la caso o contexto da conversa avance organicamente.</p>
            </div>
            <input
              type="checkbox"
              checked={stageRequired}
              onChange={(e) => setStageRequired(e.target.checked)}
              className="h-4.5 w-4.5 rounded border-zinc-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
            />
          </label>

          {/* Botões de Ação */}
          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-white/10">
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[38px] rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="min-h-[38px] rounded-xl bg-zinc-950 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 active:scale-95 disabled:opacity-40 transition"
            >
              {isSubmitting
                ? "Salvando..."
                : editingStage
                ? "Salvar alterações"
                : "Criar etapa"}
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal de Criação / Edição de Objetivo Semântico (Goal) */}
      <ResponsiveModal
        isOpen={isGoalModalOpen}
        onClose={closeGoalModal}
        maxWidth="lg"
        title={editingGoal ? "Editar checkpoint" : "Novo checkpoint"}
        description="Defina o que o Brain deve descobrir, registrar ou executar nesta etapa."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <Target className="h-5 w-5" />
          </div>
        }
      >
        <form onSubmit={handleGoalSubmit} className="space-y-3.5 pt-1">
          {/* Rótulo do Goal */}
          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Rótulo do checkpoint *</span>
            <input
              type="text"
              required
              placeholder="Ex: Idade, Cidade onde mora, Profissão"
              value={goalLabel}
              onChange={(e) => setGoalLabel(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 transition-colors"
            />
          </label>

          {/* Tipo de Objetivo: Segmented Control Moderno */}
          <div className="space-y-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Tipo conceitual de objetivo *
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setGoalKind("fact");
                  if (goalMemoryEntity === "conversation") setGoalMemoryEntity("self");
                }}
                className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                  goalKind === "fact"
                    ? "bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-2xs dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-200"
                    : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-white/10 dark:text-zinc-400"
                }`}
              >
                <span className="block text-xs font-bold">Fato do Contato</span>
                <span className="block text-[10px] opacity-75 mt-0.5">Dado durável (idade, cidade, profissão).</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setGoalKind("conversation_state");
                  if (goalMemoryEntity === "self") setGoalMemoryEntity("conversation");
                }}
                className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                  goalKind === "conversation_state"
                    ? "bg-purple-50/80 border-purple-300 text-purple-950 shadow-2xs dark:bg-purple-500/15 dark:border-purple-500/40 dark:text-purple-200"
                    : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-white/10 dark:text-zinc-400"
                }`}
              >
                <span className="block text-xs font-bold">Estado da Conversa</span>
                <span className="block text-[10px] opacity-75 mt-0.5">Dinâmica (reciprocidade, interesse).</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setGoalKind("action");
                  setGoalMemoryEntity("");
                  setGoalMemoryField("");
                }}
                className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                  goalKind === "action"
                    ? "bg-amber-50/80 border-amber-300 text-amber-950 shadow-2xs dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-200"
                    : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-white/10 dark:text-zinc-400"
                }`}
              >
                <span className="block text-xs font-bold">Ação</span>
                <span className="block text-[10px] opacity-75 mt-0.5">Missão executada pelo Brain (ex: áudio).</span>
              </button>
            </div>
          </div>

          {/* Configuração Específica do Tipo */}
          {goalKind === "action" ? (
            <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-3">
              <label className="block space-y-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <span>Ação que o Brain precisa executar *</span>
                <select
                  value={goalActionType}
                  onChange={(e) => setGoalActionType(e.target.value as NonNullable<ConversationGoal["actionType"]>)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="send_audio">Enviar áudio vinculado ao objetivo</option>
                  <option value="send_raffle_details" disabled>Enviar foto + detalhes da rifa — estrutura preparada</option>
                  <option value="send_raffle_numbers" disabled>Enviar 10 números livres — estrutura preparada</option>
                  <option value="operator_handoff" disabled>Finalizar e avisar operador — estrutura preparada</option>
                </select>
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                O áudio é vinculado a este objetivo no Cofre de Áudios. O checkpoint só é concluído após a confirmação do envio.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <span>Entidade de Memória {goalKind === "fact" ? "*" : "(Opcional)"}</span>
                <input
                  type="text"
                  required={goalKind === "fact"}
                  placeholder={goalKind === "fact" ? "self" : "conversation"}
                  value={goalMemoryEntity}
                  onChange={(e) => setGoalMemoryEntity(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 font-mono"
                />
                <span className="block text-[10px] text-zinc-400">
                  {goalKind === "fact" ? 'Padrão: "self" (o pretendente)' : 'Padrão: "conversation"'}
                </span>
              </label>

              <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <span>Campo de Memória {goalKind === "fact" ? "*" : "(Auto se vazio)"}</span>
                <input
                  type="text"
                  required={goalKind === "fact"}
                  placeholder={goalKind === "fact" ? "age, city, job" : "slug do estado"}
                  value={goalMemoryField}
                  onChange={(e) => setGoalMemoryField(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 font-mono"
                />
                <span className="block text-[10px] text-zinc-400">
                  {goalKind === "fact" ? "Campo salvo no histórico/perfil" : "Avaliado pelo contexto e histórico"}
                </span>
              </label>
            </div>
          )}

          {/* Orientação para a IA */}
          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Orientação para a IA (Opcional)</span>
            <textarea
              rows={2}
              placeholder="Ex: Descobrir a idade naturalmente ao falar de rotina ou trabalho, sem parecer interrogatório..."
              value={goalDescription}
              onChange={(e) => setGoalDescription(e.target.value)}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-sky-500 transition-colors leading-relaxed"
            />
          </label>

          {/* Flags: Obrigatório e Ativo */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02] cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Obrigatório</p>
                <p className="text-[10px] text-zinc-500">Bloqueia o avanço da etapa até ser concluído.</p>
              </div>
              <input
                type="checkbox"
                checked={goalRequired}
                onChange={(e) => setGoalRequired(e.target.checked)}
                className="h-4.5 w-4.5 rounded border-zinc-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02] cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Ativo</p>
                <p className="text-[10px] text-zinc-500">Disponível no repertório e objetivos da IA.</p>
              </div>
              <input
                type="checkbox"
                checked={goalEnabled}
                onChange={(e) => setGoalEnabled(e.target.checked)}
                className="h-4.5 w-4.5 rounded border-zinc-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
              />
            </label>
          </div>

          {/* Botões do Modal */}
          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-white/10">
            <button
              type="button"
              onClick={closeGoalModal}
              className="min-h-[38px] rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isGoalSubmitting || !goalLabel.trim() || (goalKind === "fact" && !goalMemoryField.trim())}
              className="min-h-[38px] rounded-xl bg-zinc-950 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 active:scale-95 disabled:opacity-40 transition"
            >
              {isGoalSubmitting
                ? "Salvando..."
                : editingGoal
                ? "Salvar alterações"
                : "Adicionar checkpoint"}
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal de Confirmação de Exclusão de Etapa */}
      <ResponsiveModal
        isOpen={!!stageToDelete}
        onClose={() => setStageToDelete(null)}
        title="Excluir etapa"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tem certeza de que deseja excluir a etapa{" "}
            <span className="font-bold text-zinc-950 dark:text-white">
              &quot;{stageToDelete?.name}&quot;
            </span>
            ? Todos os objetivos desta etapa também serão removidos.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setStageToDelete(null)}
              className="flex-1 sm:flex-none rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 active:scale-95 transition-transform min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeletingStage}
              onClick={handleConfirmDeleteStage}
              className="flex-1 sm:flex-none rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700 active:scale-95 transition-transform disabled:opacity-50 min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              {isDeletingStage ? "Excluindo..." : "Excluir etapa"}
            </button>
          </div>
        </div>
      </ResponsiveModal>

      {/* Modal de Confirmação de Exclusão de Objetivo */}
      <ResponsiveModal
        isOpen={!!goalToDelete}
        onClose={() => setGoalToDelete(null)}
        title="Excluir objetivo"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tem certeza de que deseja excluir o objetivo{" "}
            <span className="font-bold text-zinc-950 dark:text-white">
              &quot;{goalToDelete?.goal.label || goalToDelete?.goal.title}&quot;
            </span>
            ?
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setGoalToDelete(null)}
              className="flex-1 sm:flex-none rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 active:scale-95 transition-transform min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeletingGoal}
              onClick={handleConfirmDeleteGoal}
              className="flex-1 sm:flex-none rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700 active:scale-95 transition-transform disabled:opacity-50 min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              {isDeletingGoal ? "Excluindo..." : "Excluir objetivo"}
            </button>
          </div>
        </div>
      </ResponsiveModal>
    </div>
  );
}
