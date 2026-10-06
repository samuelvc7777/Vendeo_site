"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  Timer,
  Trash2,
  Workflow,
  X,
  AlertTriangle,
} from "lucide-react";
import { ConversationSchedule, SCHEDULE_BRAIN_MODELS, SCHEDULE_CATEGORIES } from "@/domain/entities/ConversationSchedule";
import { ChatStage, ConversationGoal } from "@/domain/entities/ChatStage";
import { ChatStagesManager } from "./ChatStagesManager";
import { ConnectionWindowManager } from "./ConnectionWindowManager";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface Props {
  schedules: ConversationSchedule[];
  stages: ChatStage[];
  onCreateSchedule: (data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt" | "order">) => Promise<any>;
  onUpdateSchedule: (id: string, data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>) => Promise<any>;
  onDeleteSchedule: (id: string) => Promise<any>;
  onMoveSchedule: (id: string, direction: -1 | 1) => Promise<any>;
  onCreateStage: (data: any) => Promise<any>;
  onUpdateStage: (id: string, data: any) => Promise<any>;
  onDeleteStage: (id: string) => Promise<any>;
  onMoveStageUp: (id: string) => Promise<any>;
  onMoveStageDown: (id: string) => Promise<any>;
  onAddGoal?: (stageId: string, data: any) => Promise<any>;
  onUpdateGoal?: (stageId: string, goalId: string, updates: Partial<ConversationGoal>) => Promise<any>;
  onDeleteGoal?: (stageId: string, goalId: string) => Promise<any>;
  onMoveGoalUp?: (stageId: string, goalId: string) => Promise<any>;
  onMoveGoalDown?: (stageId: string, goalId: string) => Promise<any>;
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
      else await props.onCreateSchedule(payload as any);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[22px] border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-sky-50/60 p-3.5 shadow-sm dark:border-violet-500/15 dark:from-violet-500/[0.07] dark:via-white/[0.025] dark:to-sky-500/[0.06]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-white shadow-md">
              <Workflow className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-600 dark:text-violet-400">Jornadas do Brain</p>
              <h3 className="text-[13px] font-black text-zinc-950 dark:text-white">Cronogramas de conversa</h3>
              <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400">Cada cronograma pode ser orientado por objetivos ou por uma janela de conexão com arsenal próprio.</p>
            </div>
          </div>
          <button type="button" onClick={openCreate} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-zinc-950 px-4 text-xs font-bold text-white shadow-sm active:scale-95 transition-transform dark:bg-white dark:text-black">
            <Plus className="h-4 w-4" /> Novo cronograma
          </button>
        </div>
      </div>

      {ordered.map((schedule, index) => {
        const scheduleStages = props.stages.filter((stage) => stage.scheduleId === schedule.id);
        const expanded = expandedId === schedule.id;
        return (
          <div key={schedule.id} className="overflow-hidden rounded-[22px] border border-zinc-200 bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <div className="p-3.5">
              <div className="flex items-start gap-2.5">
                <button type="button" onClick={() => setExpandedId(expanded ? null : schedule.id)} className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 active:scale-90 transition-transform dark:bg-white/[0.06]">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-zinc-400">#{index + 1}</span>
                    <h4 className="text-sm font-black text-zinc-950 dark:text-white">{schedule.name}</h4>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${schedule.isActive ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5"}`}>
                      {schedule.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  {schedule.description && <p className="mt-1 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{schedule.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Bot className="h-3 w-3" /> {SCHEDULE_BRAIN_MODELS.find((x) => x.value === schedule.brainModel)?.label || schedule.brainModel}</span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[9px] font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"><Timer className="h-3 w-3" /> {formatDelay(schedule)}</span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-bold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300"><CalendarClock className="h-3 w-3" /> {schedule.durationMinutes ? `${schedule.durationMinutes >= 1440 ? schedule.durationMinutes / 1440 + " dia(s)" : schedule.durationMinutes / 60 + "h"}` : "Sem limite"}</span>
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-bold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">{schedule.executionMode === "connection_window" ? "Arsenal & tempo" : `${scheduleStages.length} etapa(s)`}</span>
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-bold text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">{schedule.executionMode === "connection_window" ? "Janela de conexão" : "Orientado a objetivos"}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button disabled={index === 0} onClick={() => props.onMoveSchedule(schedule.id, -1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06] active:scale-90 transition-transform disabled:opacity-20" aria-label="Mover para cima"><ArrowUp className="h-4 w-4" /></button>
                  <button disabled={index === ordered.length - 1} onClick={() => props.onMoveSchedule(schedule.id, 1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06] active:scale-90 transition-transform disabled:opacity-20" aria-label="Mover para baixo"><ArrowDown className="h-4 w-4" /></button>
                  <button onClick={() => openEdit(schedule)} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:text-sky-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06] active:scale-90 transition-transform" aria-label="Editar cronograma"><Edit2 className="h-4 w-4" /></button>
                  <button onClick={() => setScheduleToDelete(schedule)} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 active:scale-90 transition-transform" aria-label="Excluir cronograma"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
            {expanded && (
              <div className="border-t border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-white/10 dark:bg-black/20">
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
      })}

      {/* Modal Responsivo de Edição/Criação de Cronograma */}
      <ResponsiveModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="lg"
        title={editing ? "Editar cronograma" : "Novo cronograma"}
        description="Configure o modo da jornada, cadência e modelo do Brain."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <Workflow className="h-5 w-5" />
          </div>
        }
      >
        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>Nome *</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Pós-venda 24h"
                className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>Classificação</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none focus:border-violet-500"
              >
                {SCHEDULE_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <p className="text-xs font-bold text-zinc-950 dark:text-white">Modo de execução</p>
            <p className="mt-0.5 text-[10px] text-zinc-500">Define como o Brain entende progresso neste cronograma.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSalesModeLocked}
                onClick={() => setForm({ ...form, executionMode: "goal_driven" })}
                className={`min-h-12 rounded-xl border p-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${form.executionMode === "goal_driven" ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" : "border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-400"}`}
              >
                Orientado a objetivos
              </button>
              <button
                type="button"
                disabled={isSalesModeLocked}
                onClick={() => setForm({ ...form, executionMode: "connection_window", hasDuration: true })}
                className={`min-h-12 rounded-xl border p-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${form.executionMode === "connection_window" ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300" : "border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-400"}`}
              >
                Janela de conexão
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              {form.executionMode === "connection_window"
                ? "Sem checkpoints obrigatórios. O Brain usa tempo, fases, arsenal e uma ação final."
                : "Mantém o fluxo atual de etapas e objetivos/checkpoints."}
            </p>
          </div>

          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>{form.executionMode === "connection_window" ? "Intenção inicial" : "Descrição"}</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Qual é a missão deste cronograma?"
              className="w-full resize-none rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-xs text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none focus:border-violet-500"
            />
          </label>

          <div className="rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-zinc-950 dark:text-white">Duração</p>
                <p className="text-[10px] text-zinc-500">{form.executionMode === "connection_window" ? "Obrigatória neste modo: define a janela em que o Brain trabalha." : "Sem limite ou janela máxima para o cronograma."}</p>
              </div>
              <input
                type="checkbox"
                checked={form.hasDuration}
                disabled={form.executionMode === "connection_window"}
                onChange={(e) => setForm({ ...form, hasDuration: e.target.checked })}
                className="h-5 w-5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
              />
            </div>
            {form.hasDuration && (
              <div className="grid grid-cols-[1fr_140px] gap-2 pt-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.durationValue}
                  onChange={(e) => setForm({ ...form, durationValue: Number(e.target.value) })}
                  className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                />
                <select
                  value={form.durationUnit}
                  onChange={(e) => setForm({ ...form, durationUnit: e.target.value as any })}
                  className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                >
                  <option value="hours">Horas</option>
                  <option value="days">Dias</option>
                </select>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <p className="text-xs font-bold text-zinc-950 dark:text-white">Tempo de resposta</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, responseDelayMode: "fixed" })}
                className={`min-h-10 rounded-xl border p-2 text-xs font-bold transition-colors ${
                  form.responseDelayMode === "fixed"
                    ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                    : "border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                Fixo
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, responseDelayMode: "range" })}
                className={`min-h-10 rounded-xl border p-2 text-xs font-bold transition-colors ${
                  form.responseDelayMode === "range"
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                    : "border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                Intervalo
              </button>
            </div>
            {form.responseDelayMode === "fixed" ? (
              <div className="mt-2 grid grid-cols-[1fr_140px] gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={form.fixedValue}
                  onChange={(e) => setForm({ ...form, fixedValue: Number(e.target.value) })}
                  className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                />
                <select
                  value={form.fixedUnit}
                  onChange={(e) => setForm({ ...form, fixedUnit: e.target.value as any })}
                  className="rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                >
                  <option value="minutes">Minutos</option>
                  <option value="hours">Horas</option>
                </select>
              </div>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-bold text-zinc-500">Mínimo</p>
                  <div className="grid grid-cols-[1fr_92px] gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.1"
                      value={form.minValue}
                      onChange={(e) => setForm({ ...form, minValue: Number(e.target.value) })}
                      className="rounded-xl border border-zinc-300 bg-zinc-50 px-2 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                    />
                    <select
                      value={form.minUnit}
                      onChange={(e) => setForm({ ...form, minUnit: e.target.value as any })}
                      className="rounded-xl border border-zinc-300 bg-zinc-50 px-2 py-2 text-[16px] md:text-xs text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                    >
                      <option value="minutes">min</option>
                      <option value="hours">h</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold text-zinc-500">Máximo</p>
                  <div className="grid grid-cols-[1fr_92px] gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.1"
                      value={form.maxValue}
                      onChange={(e) => setForm({ ...form, maxValue: Number(e.target.value) })}
                      className="rounded-xl border border-zinc-300 bg-zinc-50 px-2 py-2 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                    />
                    <select
                      value={form.maxUnit}
                      onChange={(e) => setForm({ ...form, maxUnit: e.target.value as any })}
                      className="rounded-xl border border-zinc-300 bg-zinc-50 px-2 py-2 text-[16px] md:text-xs text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none"
                    >
                      <option value="minutes">min</option>
                      <option value="hours">h</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
            {form.responseDelayMode === "range" && (
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                O backend escolhe uma única hora dentro da janela, persiste e reutiliza a mesma escolha em retries e novas mensagens do lote.
              </p>
            )}
          </div>

          <label className="block space-y-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Modelo do Brain</span>
            <select
              value={form.brainModel}
              onChange={(e) => setForm({ ...form, brainModel: e.target.value as any })}
              className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-[16px] md:text-sm text-zinc-950 dark:text-white dark:border-zinc-700 dark:bg-zinc-900 outline-none focus:border-violet-500"
            >
              {SCHEDULE_BRAIN_MODELS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
            <div>
              <p className="text-xs font-bold text-zinc-950 dark:text-white">Cronograma ativo</p>
              <p className="text-[10px] text-zinc-500">Cronogramas inativos não entram na sequência.</p>
            </div>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-5 w-5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-white/10">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-11 rounded-xl px-4 py-2 text-xs font-bold text-zinc-500"
            >
              Cancelar
            </button>
            <button
              disabled={saving || !form.name.trim()}
              type="submit"
              className="min-h-11 rounded-xl bg-violet-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700 active:scale-95 disabled:opacity-40"
            >
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar cronograma"}
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
