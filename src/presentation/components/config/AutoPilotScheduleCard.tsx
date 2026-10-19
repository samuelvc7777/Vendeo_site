"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import type { AutoPilotConfig, AutoPilotDailySchedule } from "@/domain/entities/AutoPilot";

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const DEFAULT_SCHEDULE: AutoPilotDailySchedule = {
  enabled: false,
  days: [0, 1, 2, 3, 4, 5, 6],
  startTime: "08:00",
  endTime: "22:00",
  timeZone: "America/Sao_Paulo",
};

interface Props {
  config: AutoPilotConfig;
  onSave: (schedule: AutoPilotDailySchedule) => Promise<void>;
}

export function AutoPilotScheduleCard({ config, onSave }: Props) {
  const [draft, setDraft] = useState<AutoPilotDailySchedule>(
    () => ({ ...DEFAULT_SCHEDULE, ...config.autoSchedule }),
  );
  const [isSaving, setIsSaving] = useState(false);
  const normalizedSaved = { ...DEFAULT_SCHEDULE, ...config.autoSchedule };
  const dirty = JSON.stringify(draft) !== JSON.stringify(normalizedSaved);
  const timesValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime);
  const valid = !draft.enabled || (draft.days.length > 0 && timesValid && draft.startTime !== draft.endTime);
  const enabled = config.autoSchedule?.enabled === true;

  const handleSave = async () => {
    if (!valid || isSaving) return;
    setIsSaving(true);
    try {
      await onSave({ ...draft, days: [...draft.days].sort((a, b) => a - b) });
    } catch {
      // Mensagem de erro exibida pela tela de configurações.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-zinc-200/80 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-500">
            <Clock3 className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-950 dark:text-white">Programar horário da IA</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              O Brain liga e desliga automaticamente nos dias e horários escolhidos, mesmo com o site fechado.
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          <span>{draft.enabled ? "Programação ativa" : "Desativada"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Ativar programação da IA"
            checked={draft.enabled}
            onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
            className="h-4 w-4 accent-purple-600"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          <span>Horário para ligar</span>
          <input
            type="time"
            value={draft.startTime}
            onChange={(event) => setDraft((prev) => ({ ...prev, startTime: event.target.value }))}
            className="min-h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-purple-500 dark:border-white/10 dark:bg-[#121214] dark:text-white"
          />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          <span>Horário para desligar</span>
          <input
            type="time"
            value={draft.endTime}
            onChange={(event) => setDraft((prev) => ({ ...prev, endTime: event.target.value }))}
            className="min-h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-purple-500 dark:border-white/10 dark:bg-[#121214] dark:text-white"
          />
        </label>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">Dias da semana</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((day, index) => {
            const selected = draft.days.includes(index);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft((prev) => ({
                  ...prev,
                  days: selected ? prev.days.filter((value) => value !== index) : [...prev.days, index].sort(),
                }))}
                className={`min-h-9 min-w-10 rounded-xl border px-2 py-1 text-[11px] font-bold transition ${
                  selected
                    ? "border-purple-500 bg-purple-500/15 text-purple-700 dark:text-purple-300"
                    : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-white/10 dark:bg-zinc-900"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-lg text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Fuso de Brasília (São Paulo). Se desligar após meia-noite, o horário segue o dia em que a IA ligou.
          {enabled && (
            <span className="mt-1 block font-semibold text-purple-700 dark:text-purple-300">
              Programação salva: o botão geral será controlado pelo horário. Ajustes entram em vigor em até 1 minuto.
            </span>
          )}
          {!valid && <span className="mt-1 block text-red-500">Escolha pelo menos um dia e horários diferentes e válidos.</span>}
        </div>
        <button
          type="button"
          disabled={!dirty || !valid || isSaving}
          onClick={() => void handleSave()}
          className="min-h-11 w-full rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {isSaving ? "Salvando..." : "Salvar programação"}
        </button>
      </div>
    </section>
  );
}
