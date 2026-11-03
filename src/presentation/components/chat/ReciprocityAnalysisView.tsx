"use client";
import React from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { ReciprocitySnapshotView } from "../reciprocity/reciprocity-client";
export function ReciprocityHeaderButton({ available, onOpen }: {
  available: boolean;
  onOpen: () => void;
}) {
  if (!available)
    return null;
  return <button type="button" title="Abrir análise de reciprocidade" aria-label="Abrir análise de reciprocidade" onClick={onOpen} className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sky-600 transition active:scale-90 wa-ios-glass dark:text-sky-300">
    <Activity className="h-[19px] w-[19px]" />
  </button>;
}
export function ReciprocityStageStatus({ hasAccess, snapshot, busy, error, onRequest, onRefresh }: {
  hasAccess: boolean;
  snapshot: ReciprocitySnapshotView | null;
  busy: boolean;
  error?: string | null;
  onRequest: () => void;
  onRefresh: () => void;
}) {
  if (!hasAccess)
    return <p className="border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-white/10">Para consultar a reciprocidade, informe sua chave de acesso em Configurações.</p>;
  const processing = snapshot?.state === "queued" || snapshot?.state === "processing";
  const failed = snapshot?.state === "failed";
  if (snapshot && !snapshot.eligible && !snapshot.latestCompleted && !processing && !failed && !error)
    return null;
  return <div className="flex flex-wrap items-center gap-2 border-b border-sky-100 bg-sky-50/70 px-4 py-2 text-xs text-sky-950 dark:border-white/10 dark:bg-sky-950/25 dark:text-sky-100" aria-live="polite">
    <span className="min-w-0 flex-1">{error || (processing ? "Análise em andamento no servidor." : failed ? "Não foi possível concluir a análise." : snapshot?.latestCompleted ? "Análise de reciprocidade disponível no cabeçalho." : !snapshot ? "Consultando análise de reciprocidade…" : "Checklist de Conexão concluído. A conversa pode ser analisada.")}{failed && snapshot?.latestCompleted ? " O resultado anterior continua disponível." : ""}</span>
    {(!processing && snapshot?.eligible && (!snapshot.latestCompleted || failed)) && <button type="button" disabled={busy} onClick={onRequest} className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">{failed ? "Tentar novamente" : "Analisar conversa"}</button>}
    <button type="button" disabled={busy} onClick={onRefresh} className="inline-flex items-center gap-1 rounded-lg border border-sky-300 px-2 py-1.5 disabled:opacity-50">
      <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />Atualizar</button>
  </div>;
}
