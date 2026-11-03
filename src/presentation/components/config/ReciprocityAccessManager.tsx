"use client";
import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { saveReciprocityAccess } from "../reciprocity/reciprocity-client";
import { useReciprocityAccess } from "../reciprocity/useReciprocityAccess";
import { ReciprocitySettingsManager } from "./ReciprocitySettingsManager";
export function ReciprocityAccessManager() {
  const [input, setInput] = useState("");
  const configured = Boolean(useReciprocityAccess());
  return <section className="rounded-2xl border border-sky-200 bg-white p-4 text-zinc-950 dark:border-white/10 dark:bg-zinc-950 dark:text-white">
    <h3 className="flex items-center gap-2 text-sm font-bold">
      <KeyRound className="h-4 w-4 text-sky-500" />Acesso à análise de reciprocidade</h3>
    <p className="mt-2 text-xs text-zinc-500">Use a chave fornecida pelo responsável pela conta. O acesso fica salvo somente nesta sessão do navegador.</p>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); saveReciprocityAccess(input); setInput(""); }}>
      <label className="min-w-40 flex-1">
        <span className="sr-only">Chave de acesso à análise</span>
        <input type="password" autoComplete="off" value={input} onChange={event => setInput(event.target.value)} placeholder={configured ? "Acesso configurado nesta sessão" : "Chave de acesso"} className="w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-white/20" />
      </label>
      <button type="submit" disabled={!input.trim()} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Salvar acesso</button>
      {configured && <button type="button" onClick={() => { saveReciprocityAccess(""); setInput(""); }} className="rounded-xl border border-zinc-300 px-3 py-2 text-xs dark:border-white/20">Remover acesso</button>}
    </form>
    <ReciprocitySettingsManager />
  </section>;
}
