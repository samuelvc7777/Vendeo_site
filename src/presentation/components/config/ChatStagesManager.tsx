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
  }) => Promise<any>;
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
  ) => Promise<any>;
  onDeleteStage: (id: string) => Promise<any>;
  onMoveUp: (id: string) => Promise<any>;
  onMoveDown: (id: string) => Promise<any>;
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
      {/* Cabeçalho da Seção */}
      <div className="rounded-[22px] border border-sky-200/80 dark:border-sky-500/15 bg-gradient-to-br from-sky-50 via-white to-violet-50/50 dark:from-sky-500/[0.07] dark:via-white/[0.025] dark:to-violet-500/[0.06] p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 text-white shadow-md shadow-sky-500/20">
              <Layers className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-sky-600 dark:text-sky-400">
                Arquitetura da conversa
              </p>
              <h3 className="mt-0.5 text-[13px] font-black text-zinc-950 dark:text-white">
                Etapas & Checkpoints
              </h3>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Organize o caminho que o Brain percorre em cada conversa.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-2xl bg-zinc-950 px-4 text-xs font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-zinc-800 active:scale-95 dark:bg-white dark:text-black dark:hover:bg-zinc-200 sm:w-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova etapa</span>
          </button>
        </div>
      </div>

      {/* Lista de Etapas */}
      {stages.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center space-y-3 bg-zinc-100/60 dark:bg-zinc-900/30">
          <div className="w-10 h-10 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 flex items-center justify-center mx-auto">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Nenhuma etapa cadastrada ainda</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Crie etapas como &ldquo;1. Conexão & Apresentação&rdquo;, &ldquo;2. Semeadura da Rifa&rdquo; e vincule às suas pastas do cofre.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs font-semibold text-zinc-950 dark:text-white transition-colors"
          >
            Criar Primeira Etapa
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
                className="rounded-[20px] bg-white/90 dark:bg-white/[0.035] border border-zinc-200/90 dark:border-white/10 hover:border-sky-300 dark:hover:border-sky-500/25 transition-all overflow-hidden shadow-sm"
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
                        <h4 className="text-sm font-bold text-zinc-950 dark:text-white truncate">{stage.name}</h4>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          stage.isRequired !== false
                            ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25"
                            : "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25"
                        }`}>
                          {stage.isRequired !== false ? "Obrigatória" : "Opcional"}
                        </span>
                        {isLast && (
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            finalizesWorkflow
                              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30"
                              : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30"
                          }`}>
                            {finalizesWorkflow ? "Final" : "Continua aberta"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Lado Direito: Ações (Reordenar, Editar, Excluir) */}
                    <div className="flex items-center justify-end gap-1.5 shrink-0 pt-1 sm:pt-0 border-t border-zinc-200 dark:border-zinc-800/40 sm:border-t-0">
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => onMoveUp(stage.id)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform cursor-pointer"
                        title="Mover para cima"
                        aria-label="Mover para cima"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => onMoveDown(stage.id)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white disabled:opacity-25 disabled:pointer-events-none active:scale-90 transition-transform cursor-pointer"
                        title="Mover para baixo"
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(stage)}
                        className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-sky-400 active:scale-90 transition-all ml-0.5 cursor-pointer"
                        title="Editar etapa"
                        aria-label="Editar etapa"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setStageToDelete(stage)}
                        className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-red-400 active:scale-90 transition-all cursor-pointer"
                        title="Excluir etapa"
                        aria-label="Excluir etapa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Barra de Acesso aos Objetivos da Etapa */}
                  <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStageGoals(stage.id)}
                      className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg bg-zinc-100/90 dark:bg-zinc-900/90 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800/80 transition-colors text-xs font-semibold active:scale-95 cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>Checkpoints da Etapa ({stageGoals.length})</span>
                      </div>
                      {isGoalsExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400 ml-0.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400 ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openAddGoalModal(stage.id)}
                      className="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo Checkpoint</span>
                    </button>
                  </div>
                </div>

                {/* Seção Expandida: Checkpoints / Objetivos da Etapa */}
                {isGoalsExpanded && (
                  <div className="border-t border-zinc-200 dark:border-[#27272a] bg-zinc-100/80 dark:bg-zinc-950/40 p-3 sm:p-3.5 space-y-3 animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="text-xs font-bold text-zinc-950 dark:text-white">
                          Checkpoints / Objetivos da Etapa
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          (Obrigatórios bloqueiam o avanço; opcionais ficam disponíveis ao Brain quando fizer sentido)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <button
                          type="button"
                          onClick={() => openAddGoalModal(stage.id)}
                          className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 text-xs font-semibold active:scale-95 transition-all min-h-[34px] sm:min-h-0 cursor-pointer"
                        >
                          <Plus className="w-3 h-3 shrink-0" />
                          <span>Adicionar Checkpoint</span>
                        </button>
                      </div>
                    </div>

                    {stageGoals.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center">
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">
                          Nenhum checkpoint conversacional definido para esta etapa.
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
                                  ? "bg-zinc-100/80 dark:bg-zinc-900/80 border-zinc-200 dark:border-zinc-800"
                                  : "bg-zinc-100/60 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800/50 opacity-60"
                              }`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <span className="text-[11px] font-mono text-zinc-500 w-5 shrink-0 pt-0.5">
                                  #{gIdx + 1}
                                </span>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                      {goal.label}
                                    </span>
                                    {goal.kind === "action" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-medium border border-amber-500/30">
                                        Ação
                                      </span>
                                    ) : goal.kind === "conversation_state" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 text-[10px] font-medium border border-purple-500/30">
                                        Estado da Conversa
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium border border-emerald-500/30">
                                        Fato do Contato
                                      </span>
                                    )}
                                    {goal.kind === "action" ? (
                                      <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-amber-800 dark:text-amber-200 text-[10px] font-mono border border-zinc-300 dark:border-zinc-700/50">
                                        {goal.actionType === "send_audio" ? "enviar áudio" : goal.actionType || "ação"}
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] font-mono border border-zinc-300 dark:border-zinc-700/50">
                                        {goal.memoryEntity || "self"}.{goal.memoryField}
                                      </span>
                                    )}
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                      goal.required !== false
                                        ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25"
                                        : "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25"
                                    }`}>
                                      {goal.required !== false ? "Obrigatório" : "Opcional"}
                                    </span>
                                    {!goal.enabled && (
                                      <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-500 text-[10px]">
                                        Inativo
                                      </span>
                                    )}
                                  </div>
                                  {goal.description && (
                                    <div className="p-2 rounded-lg bg-white/90 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800/80 text-[11px] text-zinc-700 dark:text-zinc-300 break-words leading-relaxed">
                                      <span className="font-semibold text-sky-400">Missão do Checkpoint: </span>
                                      {goal.description}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Ações do Objetivo: barra dedicada com touch targets mínimos de 34px */}
                              <div className="flex items-center justify-between sm:justify-end gap-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800/60 sm:border-t-0 sm:pt-0 shrink-0 w-full sm:w-auto">
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
                                        : "bg-zinc-200 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-zinc-700"
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
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all active:scale-95 cursor-pointer"
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
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all active:scale-95 cursor-pointer"
                                    title="Descer prioridade"
                                    aria-label="Descer prioridade"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Editar */}
                                  <button
                                    type="button"
                                    onClick={() => openEditGoalModal(stage.id, goal)}
                                    className="p-2 sm:p-1.5 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:text-sky-400 transition-all active:scale-95 cursor-pointer"
                                    title="Editar objetivo"
                                    aria-label="Editar objetivo"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Excluir */}
                                  <button
                                    type="button"
                                    onClick={() => setGoalToDelete({ stageId: stage.id, goal })}
                                    className="p-2 sm:p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-[#f87171] hover:bg-red-100 dark:hover:bg-red-900/40 transition-all active:scale-95 cursor-pointer"
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
      <ResponsiveModal
        isOpen={isModalOpen}
        onClose={closeModal}
        maxWidth="lg"
        title={editingStage ? "Editar Etapa do Funil" : "Nova Etapa do Funil"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome da Etapa */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Nome da Etapa *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: 1. Apresentação & Fotos da Rotina"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-sm text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Descrição / Orientação da Etapa */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Descrição / Orientação para a Persona
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Conhecer o pretendente naturalmente, criar conexão inicial e entender seu estilo de vida."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-xs text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
            />
          </div>

          {/* Cor da Etapa */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Cor de Identificação
            </label>
            <div className="flex items-center gap-2.5 flex-wrap">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-8 h-8 rounded-full transition-transform flex items-center justify-center cursor-pointer ${
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

          <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Etapa obrigatória</p>
              <p className="text-[10px] text-zinc-500">Se for opcional, o Brain pode ignorar a etapa inteira quando não fizer sentido.</p>
            </div>
            <input
              type="checkbox"
              checked={stageRequired}
              onChange={(e) => setStageRequired(e.target.checked)}
              className="h-4 w-4 rounded"
            />
          </label>

          {/* Botões de Ação */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-[#27272a]">
            <button
              type="button"
              onClick={closeModal}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer text-center min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95 cursor-pointer text-center min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              {isSubmitting
                ? "Salvando..."
                : editingStage
                ? "Salvar Alterações"
                : "Criar Etapa"}
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal de Criação / Edição de Objetivo Semântico (Goal) */}
      <ResponsiveModal
        isOpen={isGoalModalOpen}
        onClose={closeGoalModal}
        maxWidth="lg"
        title={editingGoal ? "Editar Objetivo da Conversa" : "Novo Objetivo da Conversa"}
      >
        <form onSubmit={handleGoalSubmit} className="space-y-3.5">
          {/* Rótulo do Goal */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Rótulo do Objetivo *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Idade, Cidade onde mora, Profissão"
              value={goalLabel}
              onChange={(e) => setGoalLabel(e.target.value)}
              className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-sm text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Tipo de Objetivo: Fato vs Estado Conversacional */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Tipo Conceitual de Objetivo *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setGoalKind("fact");
                  if (goalMemoryEntity === "conversation") setGoalMemoryEntity("self");
                }}
                className={`px-3 py-2.5 sm:py-2 rounded-xl text-xs font-medium border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                  goalKind === "fact"
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span className="font-semibold text-zinc-950 dark:text-white flex items-center gap-1.5">
                  Fato do Contato
                </span>
                <span className="text-[10px] text-zinc-600 dark:text-zinc-400">
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
                    ? "bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300"
                    : "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span className="font-semibold text-zinc-950 dark:text-white flex items-center gap-1.5">
                  Estado da Conversa
                </span>
                <span className="text-[10px] text-zinc-600 dark:text-zinc-400">
                  Dinâmica qualitativa (reciprocidade, profundidade).
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setGoalKind("action");
                  setGoalMemoryEntity("");
                  setGoalMemoryField("");
                }}
                className={`px-3 py-2.5 sm:py-2 rounded-xl text-xs font-medium border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                  goalKind === "action"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300"
                    : "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span className="font-semibold text-zinc-950 dark:text-white flex items-center gap-1.5">
                  Ação
                </span>
                <span className="text-[10px] text-zinc-600 dark:text-zinc-400">
                  Missão que precisa ser executada pelo Brain.
                </span>
              </button>
            </div>
          </div>

          {goalKind === "action" ? (
            <div className="space-y-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Ação que o Brain precisa executar *</label>
                <select
                  value={goalActionType}
                  onChange={(e) => setGoalActionType(e.target.value as NonNullable<ConversationGoal["actionType"]>)}
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-sm text-zinc-950 dark:text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="send_audio">Enviar áudio vinculado ao objetivo</option>
                  <option value="send_raffle_details" disabled>Enviar foto + detalhes da rifa — estrutura preparada</option>
                  <option value="send_raffle_numbers" disabled>Enviar 10 números livres — estrutura preparada</option>
                  <option value="operator_handoff" disabled>Finalizar e avisar operador — estrutura preparada</option>
                </select>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                O áudio é vinculado a este objetivo no Cofre de Áudios. O objetivo só será concluído após o provedor confirmar o envio.
                Se o contexto estiver sensível, o Brain pode adiar, mas a missão permanece pendente para os próximos turnos.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Entidade de Memória {goalKind === "fact" ? "*" : "(Opcional)"}
                </label>
                <input
                  type="text"
                  required={goalKind === "fact"}
                  placeholder={goalKind === "fact" ? "self" : "conversation"}
                  value={goalMemoryEntity}
                  onChange={(e) => setGoalMemoryEntity(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-xs text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono"
                />
                <p className="text-[10px] text-zinc-500">
                  {goalKind === "fact" ? 'Padrão: "self" (o pretendente)' : 'Padrão: "conversation"'}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Campo de Memória {goalKind === "fact" ? "*" : "(Auto se vazio)"}
                </label>
                <input
                  type="text"
                  required={goalKind === "fact"}
                  placeholder={goalKind === "fact" ? "age, city, job" : "slug do estado"}
                  value={goalMemoryField}
                  onChange={(e) => setGoalMemoryField(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-xs text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 font-mono"
                />
                <p className="text-[10px] text-zinc-500">
                  {goalKind === "fact" ? "Campo salvo na ContactMemory" : "Avaliado pelo contexto e histórico"}
                </p>
              </div>
            </div>
          )}

          {/* Descrição / Orientação para a IA */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Orientação para a IA (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Descobrir a idade naturalmente quando falar de estudos ou trabalho, sem parecer interrogatório..."
              value={goalDescription}
              onChange={(e) => setGoalDescription(e.target.value)}
              className="w-full px-3 py-2.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-[16px] md:text-xs text-zinc-950 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div>
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Obrigatório</p>
                <p className="text-[10px] text-zinc-500">Se desligado, vira uma possibilidade e não bloqueia o avanço.</p>
              </div>
              <input type="checkbox" checked={goalRequired} onChange={(e) => setGoalRequired(e.target.checked)} className="h-4 w-4 rounded" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div>
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Ativo</p>
                <p className="text-[10px] text-zinc-500">Desligado remove o objetivo do repertório do Brain.</p>
              </div>
              <input type="checkbox" checked={goalEnabled} onChange={(e) => setGoalEnabled(e.target.checked)} className="h-4 w-4 rounded" />
            </label>
          </div>

          {/* Botões do Modal */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-[#27272a]">
            <button
              type="button"
              onClick={closeGoalModal}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer text-center min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isGoalSubmitting || !goalLabel.trim() || (goalKind === "fact" && !goalMemoryField.trim())}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-sky-500/20 active:scale-95 cursor-pointer text-center min-h-[44px] sm:min-h-0 flex items-center justify-center"
            >
              {isGoalSubmitting
                ? "Salvando..."
                : editingGoal
                ? "Salvar Alterações"
                : "Adicionar Objetivo"}
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
