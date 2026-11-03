"use client";
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { reciprocityJson, type ReciprocityAttemptView, type ReciprocityContextMessage, type ReciprocityCategory } from "../reciprocity/reciprocity-client";
const categoryLabel: Record<ReciprocityCategory, string> = { baixa: "Baixa", moderada: "Moderada", alta: "Alta", evidencia_insuficiente: "Evidência insuficiente" };
const evolutionLabel = { aumento: "Aumento", diminuicao: "Diminuição", estavel: "Estável", indeterminada: "Não foi possível determinar" };
function dateLabel(value: string | null) {
  if (!value)
    return "período não informado"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}
export function ReciprocityResultDialog({ attempt, conversationId, onClose, onNavigate }: {
  attempt: ReciprocityAttemptView;
  conversationId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<ReciprocityContextMessage[] | null>(null);
  const [error, setError] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const contextRequest = useRef(0);
  const result = attempt.result;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const showEvidence = async (messageId: string) => {
    const requestId = ++contextRequest.current;
    setContextLoading(true);
    setContext(null);
    setError("");
    try {
      const payload = await reciprocityJson<{
        messages: ReciprocityContextMessage[];
      }>(`/evidence?conversationId=${encodeURIComponent(conversationId)}&attemptId=${encodeURIComponent(attempt.id)}&messageId=${encodeURIComponent(messageId)}`);
      if (contextRequest.current === requestId)
        setContext(payload.messages);
    }
    catch (error) {
      if (contextRequest.current === requestId)
        setError(error instanceof Error ? error.message : "Não foi possível abrir o contexto.");
    }
    finally {
      if (contextRequest.current === requestId)
        setContextLoading(false);
    }
  };
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="reciprocity-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-2xl rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-2xl backdrop:bg-black/50 dark:border-white/10 dark:bg-zinc-950 dark:text-white">
    <header className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-zinc-950">
      <h2 id="reciprocity-title" className="text-base font-bold">Reciprocidade da conversa</h2>
      <button type="button" onClick={onClose} aria-label="Fechar análise" className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-white/10">
        <X className="h-5 w-5" />
      </button>
    </header>
    <div className="space-y-5 p-5">
      {result && <>
        <div className="grid grid-cols-2 gap-3">{[["Participação", result.participation], ["Curiosidade pela Larissa", result.curiosity]].map(([label, value]) => <div key={label} className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="mt-1 text-sm font-bold">{categoryLabel[value as ReciprocityCategory]}</p>
        </div>)}</div>
        <p className="text-sm leading-relaxed">{result.summary}</p>
        <section>
          <h3 className="text-sm font-bold">Fundamentos</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        </section>
        <p className="text-sm">
          <strong>Evolução da participação:</strong> {evolutionLabel[result.evolution]}</p>
        <section>
          <h3 className="text-sm font-bold">Evidências verificáveis</h3>
          <div className="mt-2 space-y-2">{result.evidence.map((evidence, index) => <button type="button" key={`${evidence.messageId}-${index}`} onClick={() => void showEvidence(evidence.messageId)} className="block w-full rounded-xl border border-zinc-200 p-3 text-left hover:border-sky-400 dark:border-white/10">
            <blockquote className="text-sm">“{evidence.quote}”</blockquote>
            <p className="mt-1 text-xs text-zinc-500">{evidence.reason}</p>
            <span className="mt-2 block text-xs font-semibold text-sky-600 dark:text-sky-300">Abrir mensagem no contexto</span>
          </button>)}</div>
        </section>
        {contextLoading && <p role="status" className="text-sm">Abrindo contexto…</p>}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        {context && <section className="rounded-xl bg-zinc-100 p-3 dark:bg-white/5">
          <h3 className="text-sm font-bold">Trecho da conversa analisada</h3>
          <div className="mt-2 space-y-2">{context.map(message => <div key={message.id} className="rounded-lg border border-zinc-200 p-2 dark:border-white/10">
            <p className="text-xs font-bold">{message.role === "larissa" ? "Larissa" : "Contato"} · {dateLabel(message.at)}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{message.text || (message.mediaMissing ? "Mídia sem descrição ou transcrição disponível." : "Mensagem sem texto.")}</p>
            <button type="button" onClick={() => { onClose(); onNavigate(message.id); }} className="mt-1 text-xs text-sky-600 dark:text-sky-300">Localizar no chat</button>
          </div>)}</div>
        </section>}
        {result.limitations.length > 0 && <section>
          <h3 className="text-sm font-bold">Limitações</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-500">{result.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
        </section>}
      </>}
      <footer className="space-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-white/10">
        <p>Todo o histórico disponível de {dateLabel(attempt.coverage.from)} a {dateLabel(attempt.coverage.to)}.</p>
        <p>{attempt.coverage.messageCount} mensagens · última mensagem: {attempt.coverage.lastMessageId}</p>
        <p>{attempt.configuration.model} · raciocínio {attempt.configuration.reasoning}</p>
        <p>A análise é apenas observação e não altera o atendimento.</p>
      </footer>
    </div>
  </dialog>;
}
