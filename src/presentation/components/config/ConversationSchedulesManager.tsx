"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarClock,
  ChevronDown,
  Edit2,
  Plus,
  Timer,
  Trash2,
  Workflow,
} from "lucide-react";
import { ConversationSchedule, SCHEDULE_BRAIN_MODELS, SCHEDULE_CATEGORIES } from "@/domain/entities/ConversationSchedule";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";
import { ChatStagesManager } from "./ChatStagesManager";
import { ConnectionWindowManager } from "./ConnectionWindowManager";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface Props {
  schedules: ConversationSchedule[];
  stages: ChatStage[];
  onCreateSchedule: (data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt" | "order">) => Promise<unknown>;
  onUpdateSchedule: (id: string, data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>) => Promise<unknown>;
  onDeleteSchedule: (id: string) => Promise<unknown>;
  onMoveSchedule: (id: string, direction: -1 | 1) => Promise<unknown>;
  onCreateStage: (data: Parameters<React.ComponentProps<typeof ChatStagesManager>["onCreateStage"]>[0]) => Promise<unknown>;
  onUpdateStage: (id: string, data: Parameters<React.ComponentProps<typeof ChatStagesManager>["onUpdateStage"]>[1]) => Promise<unknown>;
  onDeleteStage: (id: string) => Promise<unknown>;
  onMoveStageUp: (id: string) => Promise<unknown>;
  onMoveStageDown: (id: string) => Promise<unknown>;
  onAddGoal?: (stageId: string, data: Parameters<NonNullable<React.ComponentProps<typeof ChatStagesManager>["onAddGoal"]>>[1]) => Promise<unknown>;
  onUpdateGoal?: (stageId: string, goalId: string, updates: Partial<ConversationGoal>) => Promise<unknown>;
  onDeleteGoal?: (stageId: string, goalId: string) => Promise<unknown>;
  onMoveGoalUp?: (stageId: string, goalId: string) => Promise<unknown>;
  onMoveGoalDown?: (stageId: string, goalId: string) => Promise<unknown>;
}

type FormState = {
  name: string;
  description: string;
  category: ConversationSchedule["category"];
  executionMode: ConversationSchedule["executionMode"];
  isActive: boolean;
  hasDuration: boolean;
  durationValue: number;
  durationUnit: "hours" | "days";
  responseDelayMode: ConversationSchedule["responseDelayMode"];
  fixedValue: number;
  fixedUnit: "minutes" | "hours";
  minValue: number;
  minUnit: "minutes" | "hours";
  maxValue: number;
  maxUnit: "minutes" | "hours";
  brainModel: ConversationSchedule["brainModel"];
};

const defaultForm = (): FormState => ({
  name: "",
  description: "",
  category: "custom",
  executionMode: "goal_driven",
  isActive: true,
  hasDuration: false,
  durationValue: 24,
  durationUnit: "hours",
  responseDelayMode: "fixed",
  fixedValue: 3,
  fixedUnit: "minutes",
  minValue: 60,
  minUnit: "minutes",
  maxValue: 120,
  maxUnit: "minutes",
  brainModel: "gpt-6.1-sol",
});

function seconds(value: number, unit: "minutes" | "hours") {
  return Math.max(0, Math.round(value * (unit === "hours" ? 3600 : 60)));
}

function minutes(value: number, unit: "hours" | "days") {
  return Math.max(1, Math.round(value * (unit === "days" ? 1440 : 60)));
}

function formatDelay(schedule: ConversationSchedule) {
  if (schedule.responseDelayMode === "range") {
    const min = Number(schedule.responseDelayMinSeconds || 0);
    const max = Number(schedule.responseDelayMaxSeconds || 0);
    const format = (s: number) => s >= 3600 && s % 3600 === 0 ? `${s / 3600}h` : `${Math.round(s / 60)}min`;
    return `${format(min)}–${format(max)}`;
  }
  const fixed = Number(schedule.responseDelayFixedSeconds || 0);
  return fixed >= 3600 && fixed % 3600 === 0 ? `${fixed / 3600}h fixa` : `${Math.round(fixed / 60)}min fixa`;
}

export function ConversationSchedulesManager(props: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(props.schedules[0]?.id || null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConversationSchedule | null>(null);
  const [scheduleToDelete, setScheduleToDelete] = useState<ConversationSchedule | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);

  const ordered = useMemo(() => [...props.schedules].sort((a, b) => a.order - b.order), [props.schedules]);
  const isSalesModeLocked = editing?.id === "schedule_sales";

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm());
    setModalOpen(true);
  };

  const openEdit = (schedule: ConversationSchedule) => {
    const duration = schedule.durationMinutes || 0;
    const fixed = schedule.responseDelayFixedSeconds || 0;
    const minDelay = schedule.responseDelayMinSeconds || 0;
    const maxDelay = schedule.responseDelayMaxSeconds || 0;
    setEditing(schedule);
    setForm({
      name: schedule.name,
      description: schedule.description || "",
      category: schedule.category,
      executionMode: schedule.executionMode,
      isActive: schedule.isActive,
      hasDuration: schedule.durationMinutes != null,
      durationValue: duration >= 1440 && duration % 1440 === 0 ? duration / 1440 : Math.max(1, duration / 60 || 24),
      durationUnit: duration >= 1440 && duration % 1440 === 0 ? "days" : "hours",
      responseDelayMode: schedule.responseDelayMode,
      fixedValue: fixed >= 3600 && fixed % 3600 === 0 ? fixed / 3600 : fixed / 60,
      fixedUnit: fixed >= 3600 && fixed % 3600 === 0 ? "hours" : "minutes",
      minValue: minDelay >= 3600 && minDelay % 3600 === 0 ? minDelay / 3600 : minDelay / 60,
      minUnit: minDelay >= 3600 && minDelay % 3600 === 0 ? "hours" : "minutes",
      maxValue: maxDelay >= 3600 && maxDelay % 3600 === 0 ? maxDelay / 3600 : maxDelay / 60,
      maxUnit: maxDelay >= 3600 && maxDelay % 3600 === 0 ? "hours" : "minutes",
      brainModel: schedule.brainModel,
    });
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    const minSeconds = seconds(form.minValue, form.minUnit);
    const maxSeconds = seconds(form.maxValue, form.maxUnit);
    if (form.responseDelayMode === "range" && minSeconds > maxSeconds) return;
    if (form.executionMode === "connection_window" && !form.hasDuration) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        executionMode: form.executionMode,
        connectionIntent: form.executionMode === "connection_window" ? (form.description.trim() || undefined) : undefined,
        isActive: form.isActive,
        durationMinutes: form.hasDuration ? minutes(form.durationValue, form.durationUnit) : null,
        responseDelayMode: form.responseDelayMode,
        responseDelayFixedSeconds: form.responseDelayMode === "fixed" ? seconds(form.fixedValue, form.fixedUnit) : null,
        responseDelayMinSeconds: form.responseDelayMode === "range" ? minSeconds : null,
        responseDelayMaxSeconds: form.responseDelayMode === "range" ? maxSeconds : null,
        brainModel: form.brainModel,
      } as const;
      if (editing) await props.onUpdateSchedule(editing.id, payload);
      else await props.onCreateSchedule(payload);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Cabeçalho compacto da tela */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between px-1 py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold tracking-tight text-zinc-950 dark:text-white">
              Cronogramas & Etapas
            </h3>
            <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300 border border-violet-200/50 dark:border-violet-500/20 px-2 py-0.5 text-[10px] font-semibold">
              {ordered.length} {ordered.length === 1 ? "cronograma" : "cronogramas"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Jornadas sequenciais do Brain com cadência, modelos e objetivos próprios.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Novo cronograma</span>
        </button>
      </div>

      {/* Lista de cronogramas escaneável */}
      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 p-8 text-center">
          <Workflow className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-2" />
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Nenhum cronograma cadastrado</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Crie o primeiro cronograma para estruturar as etapas de atendimento do Brain.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3.5 inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold active:scale-95 transition"
          >
            <Plus className="h-3.5 w-3.5" /> Criar cronograma
          </button>
        </div>
      ) : (
        ordered.map((schedule, index) => {
          const scheduleStages = props.stages.filter((stage) => stage.scheduleId === schedule.id);
          const expanded = expandedId === schedule.id;
          return (
            <div
              key={schedule.id}
              className={`overflow-hidden rounded-2xl border transition-all duration-150 ${
                expanded
                  ? "border-violet-300 bg-white ring-2 ring-violet-500/10 shadow-sm dark:border-violet-500/30 dark:bg-zinc-900/90 dark:ring-violet-500/10"
                  : "border-zinc-200/90 bg-white hover:border-zinc-300 hover:shadow-xs dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedId(expanded ? null : schedule.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(expanded ? null : schedule.id);
                  }
                }}
                className="w-full cursor-pointer p-3 sm:p-3.5 text-left select-none transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]"
                aria-expanded={expanded}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Informações do Cronograma em 3 Linhas Hierárquicas */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {/* Linha 1: # ordem, Nome do cronograma, status */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-5 items-center justify-center rounded-md bg-zinc-100 px-1.5 font-mono text-[11px] font-bold text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                        #{index + 1}
                      </span>
                      <h4 className="text-sm font-bold tracking-tight text-zinc-950 dark:text-white truncate max-w-[150px] sm:max-w-xs md:max-w-none">
                        {schedule.name}
                      </h4>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          schedule.isActive
                            ? "border border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "border border-zinc-200/70 bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            schedule.isActive ? "bg-emerald-500" : "bg-zinc-400"
                          }`}
                        />
                        {schedule.isActive ? "Ativo" : "Inativo"}
                      </span>
                    </div>

                    {/* Linha 2: Descrição */}
                    {schedule.description ? (
                      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-1">
                        {schedule.description}
                      </p>
                    ) : null}

                    {/* Linha 3: Metadados compactos: modelo • tempo de resposta • duração • etapas • modo */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-200">
                        <Bot className="h-3 w-3 text-violet-500 shrink-0" />
                        {SCHEDULE_BRAIN_MODELS.find((x) => x.value === schedule.brainModel)?.label || schedule.brainModel}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700 select-none">•</span>
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Timer className="h-3 w-3 text-sky-500 shrink-0" />
                        {formatDelay(schedule)}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700 select-none">•</span>
                      <span className="inline-flex items-center gap-1 font-medium">
                        <CalendarClock className="h-3 w-3 text-amber-500 shrink-0" />
                        {schedule.durationMinutes
                          ? `${schedule.durationMinutes >= 1440 ? `${schedule.durationMinutes / 1440}d` : `${schedule.durationMinutes / 60}h`}`
                          : "Sem limite"}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700 select-none">•</span>
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Workflow className="h-3 w-3 text-emerald-500 shrink-0" />
                        {scheduleStages.length} {scheduleStages.length === 1 ? "etapa" : "etapas"}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700 select-none">•</span>
                      <span className="inline-flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-400">
                        {schedule.executionMode === "connection_window" ? "Janela de conexão" : "Orientado a objetivos"}
                      </span>
                    </div>
                  </div>

                  {/* Ações e Alternador de Expansão */}
                  <div
                    className="flex shrink-0 items-center gap-1 self-start pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => props.onMoveSchedule(schedule.id, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                      aria-label="Mover cronograma para cima"
                      title="Mover para cima"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === ordered.length - 1}
                      onClick={() => props.onMoveSchedule(schedule.id, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                      aria-label="Mover cronograma para baixo"
                      title="Mover para baixo"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(schedule)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-500/10 dark:hover:text-sky-400"
                      aria-label="Editar configurações do cronograma"
                      title="Editar cronograma"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleToDelete(schedule)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      aria-label="Excluir cronograma"
                      title="Excluir cronograma"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>

                    {/* Botão evidente de expandir/recolher */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : schedule.id)}
                      className={`ml-1 flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition active:scale-95 ${
                        expanded
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                      }`}
                      aria-label={expanded ? "Recolher etapas" : "Expandir etapas"}
                      title={expanded ? "Recolher etapas" : "Expandir etapas"}
                    >
                      <span className="hidden sm:inline text-[11px]">
                        {expanded ? "Recolher" : "Etapas"}
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-zinc-200/80 bg-zinc-50/60 p-3.5 sm:p-5 dark:border-white/10 dark:bg-black/30">
                  {schedule.executionMode === "connection_window" ? (
                    <ConnectionWindowManager schedule={schedule} onUpdateSchedule={props.onUpdateSchedule} />
                  ) : (
                    <ChatStagesManager
                      stages={scheduleStages}
                      activeScheduleId={schedule.id}
                      onCreateStage={props.onCreateStage}
                      onUpdateStage={props.onUpdateStage}
                      onDeleteStage={props.onDeleteStage}
                      onMoveUp={props.onMoveStageUp}
                      onMoveDown={props.onMoveStageDown}
                      onAddGoal={props.onAddGoal}
                      onUpdateGoal={props.onUpdateGoal}
                      onDeleteGoal={props.onDeleteGoal}
                      onMoveGoalUp={props.onMoveGoalUp}
                      onMoveGoalDown={props.onMoveGoalDown}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Modal Responsivo de Edição/Criação de Cronograma */}
      <ResponsiveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="lg"
        title={editing ? "Editar cronograma" : "Novo cronograma"}
        description="Configure o modo da jornada, modelo do Brain e cadência de resposta."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <Workflow className="h-5 w-5" />
          </div>
        }
      >
        <form onSubmit={submit} className="space-y-3.5 pt-1">
          {/* Seção 1: Identificação Básica */}
          <div className="space-y-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Identificação & Modelo
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <span>Nome do cronograma *</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Pós-venda 24h"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500 transition-colors"
                />
              </label>

              <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <span>Classificação</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as ConversationSchedule["category"] })}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500 transition-colors"
                >
                  {SCHEDULE_CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>Modelo do Brain</span>
              <select
                value={form.brainModel}
                onChange={(e) => setForm({ ...form, brainModel: e.target.value as ConversationSchedule["brainModel"] })}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500 transition-colors"
              >
                {SCHEDULE_BRAIN_MODELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Seção 2: Modo de Execução */}
          <div className="space-y-2 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Modo de Execução
              </p>
              {isSalesModeLocked && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  Modo de Vendas travado por sistema
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSalesModeLocked}
                onClick={() => setForm({ ...form, executionMode: "goal_driven" })}
                className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  form.executionMode === "goal_driven"
                    ? "border-sky-500 bg-sky-50/70 text-sky-950 shadow-xs dark:bg-sky-500/15 dark:border-sky-500/40 dark:text-sky-200"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Orientado a objetivos</span>
                  <Workflow className="h-3.5 w-3.5 opacity-60" />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed opacity-75">
                  Segue sequência estruturada com etapas e checkpoints a validar.
                </p>
              </button>

              <button
                type="button"
                disabled={isSalesModeLocked}
                onClick={() => setForm({ ...form, executionMode: "connection_window", hasDuration: true })}
                className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  form.executionMode === "connection_window"
                    ? "border-violet-500 bg-violet-50/70 text-violet-950 shadow-xs dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-200"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Janela de conexão</span>
                  <Timer className="h-3.5 w-3.5 opacity-60" />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed opacity-75">
                  Sem checkpoints fixos. O Brain utiliza arsenal, fases e tempo.
                </p>
              </button>
            </div>

            <label className="block pt-1 space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>{form.executionMode === "connection_window" ? "Intenção inicial da janela" : "Descrição / Missão"}</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={
                  form.executionMode === "connection_window"
                    ? "Qual é o objetivo principal desta janela de contato?"
                    : "Qual a missão ou contexto deste cronograma?"
                }
                className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500 transition-colors leading-relaxed"
              />
            </label>
          </div>

          {/* Seção 3: Cadência & Duração */}
          <div className="space-y-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Cadência & Duração
            </p>

            {/* Tempo de resposta */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Tempo de resposta</span>
                <div className="flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, responseDelayMode: "fixed" })}
                    className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      form.responseDelayMode === "fixed"
                        ? "bg-white text-zinc-950 shadow-2xs dark:bg-white/15 dark:text-white"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    Fixo
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, responseDelayMode: "range" })}
                    className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      form.responseDelayMode === "range"
                        ? "bg-white text-zinc-950 shadow-2xs dark:bg-white/15 dark:text-white"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    Intervalo
                  </button>
                </div>
              </div>

              {form.responseDelayMode === "fixed" ? (
                <div className="grid grid-cols-[1fr_120px] gap-2 pt-0.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={form.fixedValue}
                    onChange={(e) => setForm({ ...form, fixedValue: Number(e.target.value) })}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                  />
                  <select
                    value={form.fixedUnit}
                    onChange={(e) => setForm({ ...form, fixedUnit: e.target.value as "minutes" | "hours" })}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                  >
                    <option value="minutes">Minutos</option>
                    <option value="hours">Horas</option>
                  </select>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 pt-0.5">
                  <div>
                    <span className="text-[10px] font-medium text-zinc-500">Mínimo</span>
                    <div className="grid grid-cols-[1fr_80px] gap-1.5 mt-0.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        value={form.minValue}
                        onChange={(e) => setForm({ ...form, minValue: Number(e.target.value) })}
                        className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                      />
                      <select
                        value={form.minUnit}
                        onChange={(e) => setForm({ ...form, minUnit: e.target.value as "minutes" | "hours" })}
                        className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none"
                      >
                        <option value="minutes">min</option>
                        <option value="hours">h</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-zinc-500">Máximo</span>
                    <div className="grid grid-cols-[1fr_80px] gap-1.5 mt-0.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        value={form.maxValue}
                        onChange={(e) => setForm({ ...form, maxValue: Number(e.target.value) })}
                        className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                      />
                      <select
                        value={form.maxUnit}
                        onChange={(e) => setForm({ ...form, maxUnit: e.target.value as "minutes" | "hours" })}
                        className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[16px] md:text-xs text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none"
                      >
                        <option value="minutes">min</option>
                        <option value="hours">h</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Duração Máxima */}
            <div className="space-y-1.5 pt-1 border-t border-zinc-200/60 dark:border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Duração limite</span>
                  <p className="text-[10px] text-zinc-500">
                    {form.executionMode === "connection_window"
                      ? "Obrigatória neste modo: delimita a janela de ação."
                      : "Opcional: encerra ou avança após este período."}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={form.hasDuration}
                  disabled={form.executionMode === "connection_window"}
                  onChange={(e) => setForm({ ...form, hasDuration: e.target.checked })}
                  className="h-4.5 w-4.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
                />
              </div>

              {form.hasDuration && (
                <div className="grid grid-cols-[1fr_120px] gap-2 pt-0.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={form.durationValue}
                    onChange={(e) => setForm({ ...form, durationValue: Number(e.target.value) })}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                  />
                  <select
                    value={form.durationUnit}
                    onChange={(e) => setForm({ ...form, durationUnit: e.target.value as "hours" | "days" })}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white outline-none focus:border-violet-500"
                  >
                    <option value="hours">Horas</option>
                    <option value="days">Dias</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Ativo Switch */}
          <label className="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02] cursor-pointer">
            <div>
              <p className="text-xs font-bold text-zinc-950 dark:text-white">Cronograma ativo</p>
              <p className="text-[10px] text-zinc-500">Cronogramas inativos não são iniciados pelo Brain.</p>
            </div>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4.5 w-4.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
            />
          </label>

          {/* Rodapé de Ações */}
          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-white/10">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-[38px] rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              disabled={saving || !form.name.trim()}
              type="submit"
              className="min-h-[38px] rounded-xl bg-violet-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-violet-700 active:scale-95 disabled:opacity-40 transition"
            >
              {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar cronograma"}
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal Responsivo de Exclusão Segura de Cronograma */}
      <ResponsiveModal
        isOpen={Boolean(scheduleToDelete)}
        onClose={() => setScheduleToDelete(null)}
        maxWidth="sm"
        title="Excluir cronograma?"
        description={`O cronograma "${scheduleToDelete?.name}" será removido.`}
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <Trash2 className="h-5 w-5" />
          </div>
        }
        footer={
          <div className="flex w-full gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setScheduleToDelete(null)}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!scheduleToDelete) return;
                await props.onDeleteSchedule(scheduleToDelete.id);
                setScheduleToDelete(null);
              }}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl bg-red-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-red-700 active:scale-95"
            >
              Sim, excluir
            </button>
          </div>
        }
      >
        <p className="text-xs text-zinc-600 dark:text-zinc-400 py-1">
          As conversas vinculadas a este cronograma não seguirão mais as etapas deste fluxo.
        </p>
      </ResponsiveModal>
    </div>
  );
}
