"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ReciprocityConfiguration } from "@/domain/entities/Reciprocity";
import { reciprocityJson } from "../reciprocity/reciprocity-client";
import { useReciprocityAccess } from "../reciprocity/useReciprocityAccess";

const INITIAL: ReciprocityConfiguration = { model: "gpt-6-luna", reasoning: "low" };
const MODELS: Array<{ value: ReciprocityConfiguration["model"]; label: string }> = [
  { value: "gpt-6-luna", label: "Luna" },
  { value: "gpt-6.1-terra", label: "Terra" },
  { value: "gpt-6.1-sol", label: "Sol" },
];
const LEVELS: Array<{ value: ReciprocityConfiguration["reasoning"]; label: string }> = [
  { value: "low", label: "Baixo" },
  { value: "medium", label: "Médio" },
  { value: "high", label: "Alto" },
];

export function ReciprocitySettingsManager() {
  const access = useReciprocityAccess();
  const [configuration, setConfiguration] = useState(INITIAL);
  const [saved, setSaved] = useState<ReciprocityConfiguration | null>(null);
  const [loadedAccess, setLoadedAccess] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    if (access) {
      reciprocityJson<ReciprocityConfiguration>("/settings", { signal: controller.signal })
        .then(value => {
          if (controller.signal.aborted) return;
          setConfiguration(value);
          setSaved(value);
          setError("");
          setMessage("");
        })
        .catch(reason => {
          if (!controller.signal.aborted) {
            setSaved(null);
            setConfiguration(INITIAL);
            setError(reason instanceof Error ? reason.message : "Não foi possível carregar a configuração.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadedAccess(access);
            setSaving(false);
          }
        });
    }
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [access, reload]);

  if (!access) return null;
  const loading = loadedAccess !== access;
  const dirty = saved?.model !== configuration.model || saved?.reasoning !== configuration.reasoning;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const value = await reciprocityJson<ReciprocityConfiguration>("/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration), signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setConfiguration(value);
        setSaved(value);
        setMessage("Configuração salva para as próximas análises.");
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível salvar a configuração.");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/10">
    <h4 className="text-sm font-semibold">Modelo da análise</h4>
    <p className="mt-1 text-xs leading-relaxed text-zinc-500">A escolha vale para novas análises de todos os chats autorizados da conta. Resultados anteriores e análises já solicitadas são preservados.</p>
    {loading && <p role="status" className="mt-3 text-xs text-zinc-500">Carregando configuração…</p>}
    {!loading && <form onSubmit={save} className="mt-3 space-y-3">
      <fieldset disabled={saving || !saved} className="grid gap-3 sm:grid-cols-2 disabled:opacity-60">
        <label className="space-y-1 text-xs font-medium">Modelo
          <select aria-label="Modelo da análise de reciprocidade" value={configuration.model} onChange={event => { setConfiguration(current => ({ ...current, model: event.target.value as ReciprocityConfiguration["model"] })); setMessage(""); }} className="block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 dark:border-white/20 dark:bg-zinc-950 dark:text-white">
            {MODELS.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">Raciocínio
          <select aria-label="Raciocínio da análise de reciprocidade" value={configuration.reasoning} onChange={event => { setConfiguration(current => ({ ...current, reasoning: event.target.value as ReciprocityConfiguration["reasoning"] })); setMessage(""); }} className="block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 dark:border-white/20 dark:bg-zinc-950 dark:text-white">
            {LEVELS.map(level => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="text-xs text-zinc-500">Padrão: Luna com raciocínio baixo. A disponibilidade do modelo é conferida ao salvar.</p>
      <button disabled={saving || !saved || !dirty} type="submit" className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Verificando e salvando…" : "Salvar modelo e raciocínio"}</button>
    </form>}
    {!loading && error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    {!loading && error && !saved && <button type="button" className="mt-2 rounded-xl border border-zinc-300 px-3 py-2 text-xs dark:border-white/20" onClick={() => { setLoadedAccess(""); setReload(value => value + 1); }}>Tentar carregar novamente</button>}
    {!loading && message && <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
  </div>;
}
