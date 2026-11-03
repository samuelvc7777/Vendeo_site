"use client";
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { reciprocityJson, type ReciprocityAttemptView, type ReciprocityContextMessage, type ReciprocityCategory } from "../reciprocity/reciprocity-client";
const categoryLabel: Record<ReciprocityCategory, string> = { baixa: "Baixa", moderada: "Moderada", alta: "Alta", evidencia_insuficiente: "Evidência insuficiente" };
const evolutionLabel = { aumento: "Aumento", diminuicao: "Diminuição", estavel: "Estável", indeterminada: "Não foi possível determinar" };
const reasoningLabel = { low: "baixo", medium: "médio", high: "alto" };
function dateLabel(value: string | null) {
  if (!value)
    return "período não informado"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}
export function ReciprocityResultDialog({ attempt: latestAttempt, attempts, state = "completed", busy = false, requestError, onReevaluate, onRefresh, conversationId, onClose, onNavigate }: {
  attempt: ReciprocityAttemptView;
  attempts?: ReciprocityAttemptView[];
  state?: "none" | "queued" | "processing" | "completed" | "failed";
  busy?: boolean;
  requestError?: string | null;
  onReevaluate?: () => void;
  onRefresh?: () => void;
  conversationId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const completedAttempts = (attempts || [latestAttempt]).filter(item => item.state === "completed" && item.result);
  const attempt = completedAttempts.find(item => item.id === selectedId) || latestAttempt;
  const [context, setContext] = useState<ReciprocityContextMessage[] | null>(null);
  const [contextAttemptId, setContextAttemptId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const contextRequest = useRef(0);
  const result = attempt.result;
  const processing = state === "queued" || state === "processing";
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const showEvidence = async (messageId: string) => {
    const requestId = ++contextRequest.current;
    setContextLoading(true);
    setContextAttemptId(attempt.id);
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
      <section className="space-y-3" aria-label="Histórico de avaliações">
        <label className="block text-xs font-semibold">
          Histórico de avaliações
          <select value={attempt.id} onChange={event => {
            contextRequest.current++;
            setContext(null);
            setContextLoading(false);
            setError("");
            setSelectedId(event.target.value);
          }} className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm dark:border-white/20 dark:bg-zinc-950">
            {completedAttempts.map(item => <option key={item.id} value={item.id}>
              {item.id === latestAttempt.id ? "Mais recente · " : ""}{dateLabel(item.completedAt || item.createdAt)} · {item.configuration.model} · {reasoningLabel[item.configuration.reasoning]}
            </option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {onReevaluate && <button type="button" disabled={busy || processing} onClick={onReevaluate} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Reavaliar conversa</button>}
          {onRefresh && <button type="button" disabled={busy} onClick={onRefresh} className="rounded-xl border border-zinc-300 px-3 py-2 text-xs dark:border-white/20 disabled:opacity-50">Atualizar resultados</button>}
        </div>
        {processing && <p role="status" className="text-xs text-sky-700 dark:text-sky-300">Nova análise em andamento. O resultado anterior continua disponível.</p>}
        {state === "failed" && <p role="status" className="text-xs text-rose-600 dark:text-rose-300">A nova análise falhou. O resultado anterior continua disponível e você pode reavaliar novamente.</p>}
        {requestError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{requestError}</p>}
      </section>
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
        {contextLoading && contextAttemptId === attempt.id && <p role="status" className="text-sm">Abrindo contexto…</p>}
        {error && contextAttemptId === attempt.id && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        {context && contextAttemptId === attempt.id && <section className="rounded-xl bg-zinc-100 p-3 dark:bg-white/5">
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
        <p>{attempt.configuration.model} · raciocínio {reasoningLabel[attempt.configuration.reasoning]}</p>
        <p>A análise é apenas observação e não altera o atendimento.</p>
      </footer>
    </div>
  </dialog>;
}
