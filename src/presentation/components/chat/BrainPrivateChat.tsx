"use client";

import React, { useEffect, useRef, useState } from "react";
import { BrainCircuit, Check, Copy, Loader2, RotateCcw, Send, ShieldCheck, X } from "lucide-react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
import styles from "./BrainPrivateChat.module.css";

export type VisibleBrainChatMessage = { role: "larissa" | "contact"; text: string };
type Entry = { role: "operator" | "brain"; content: string };

type Props = {
  conversationId: string;
  contactName: string;
  visibleMessages: VisibleBrainChatMessage[];
  onClose: () => void;
};

const suggestions = [
  "Me resume essa conversa e diz em que ponto estamos.",
  "O que vc acha do interesse dele até agora?",
  "Como a Larissa pode continuar essa conversa naturalmente?",
];

function storageKey(conversationId: string) {
  return `vendeo_private_brain_chat_v1:${conversationId}`;
}

function restoreEntries(conversationId: string): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(conversationId)) || "[]");
    return Array.isArray(saved)
      ? saved.slice(-32).filter((entry: Entry) => (entry.role === "operator" || entry.role === "brain") && typeof entry.content === "string")
      : [];
  } catch {
    return [];
  }
}

export function BrainPrivateChat({ conversationId, contactName, visibleMessages, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>(() => restoreEntries(conversationId));
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  // O painel é montado com key={conversationId}; carrega o histórico antes do
  // primeiro efeito para não sobrescrever as mensagens salvas na montagem.
  useEffect(() => {
    requestRef.current += 1;
    setDraft("");
    setError("");
  }, [conversationId]);

  useEffect(() => {
    // Apenas no navegador e apenas para esta conversa; não alimenta o autopilot.
    try { sessionStorage.setItem(storageKey(conversationId), JSON.stringify(entries.slice(-32))); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [conversationId, entries, working]);

  useEffect(() => {
    return () => { requestRef.current += 1; };
  }, []);

  async function send(textOverride?: string) {
    const content = (textOverride ?? draft).trim();
    if (!content || working) return;
    const savedHistory = entries.slice(-20);
    const requestId = ++requestRef.current;
    setEntries((current) => [...current, { role: "operator", content }]);
    setDraft("");
    setError("");
    setWorking(true);
    try {
      const response = await brainOperatorFetch("/operator/brain/private-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          contactName,
          message: content,
          history: savedHistory,
          visibleMessages: visibleMessages.slice(-75),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true || !result.answer) {
        throw new Error(result.error || "Não foi possível conversar com o Brian.");
      }
      if (requestRef.current !== requestId) return;
      setEntries((current) => [...current, { role: "brain", content: String(result.answer) }]);
    } catch (e) {
      if (requestRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : "Falha ao conectar com o Brian.");
    } finally {
      if (requestRef.current === requestId) setWorking(false);
    }
  }

  function clear() {
    if (working) return;
    setEntries([]);
    setError("");
    try { sessionStorage.removeItem(storageKey(conversationId)); } catch {}
  }

  async function copy(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(index);
    } catch {
      setError("Não consegui copiar a mensagem.");
    }
  }

  return (
    <div className={`${styles.overlay} absolute inset-0 z-[80] flex items-end justify-center bg-black/35 backdrop-blur-[3px] md:items-center md:p-5`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`Conversa privada com Brian sobre ${contactName}`}
        className={`${styles.dialog} flex h-[min(91dvh,780px)] w-full max-w-[620px] flex-col overflow-hidden rounded-t-[24px] border border-violet-200 bg-[#f8f7fc] shadow-2xl md:h-[min(86vh,760px)] md:rounded-[24px] dark:border-violet-500/25 dark:bg-[#15141b]`}>
        <header className={`${styles.header} flex shrink-0 items-center justify-between gap-3 border-b border-violet-200/70 bg-white/90 px-4 py-3 dark:border-white/10 dark:bg-[#1e1a2a]`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-zinc-950 dark:text-white">Conversar com Brian</p>
              <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">Sobre {contactName}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={clear} disabled={working || entries.length === 0}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-violet-100 disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-white/10" aria-label="Limpar conversa privada" title="Nova conversa privada">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-violet-100 dark:text-zinc-300 dark:hover:bg-white/10" aria-label="Fechar conversa com Brian">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className={`${styles.notice} flex items-center gap-2 border-b border-violet-100 bg-violet-50 px-4 py-2 text-[11px] font-medium text-violet-700 dark:border-white/5 dark:bg-violet-500/10 dark:text-violet-200`}>
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Chat privado. O cliente não vê e nada será enviado automaticamente.
        </div>
        <div className={`${styles.messages} min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-4 md:px-5`} aria-live="polite">
          {entries.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col gap-3 py-8 text-center">
              <BrainCircuit className="mx-auto h-10 w-10 text-violet-500" />
              <p className="text-base font-bold text-zinc-900 dark:text-white">Pode falar comigo!</p>
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">Tenho acesso ao histórico visível desta conversa. Podemos analisar o cliente, pensar em abordagens ou trocar ideias sem travar o atendimento.</p>
              <div className="mt-3 flex flex-col gap-2">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => void send(suggestion)}
                    className="rounded-xl border border-violet-200 bg-white px-3 py-3 text-left text-xs font-medium text-violet-800 hover:border-violet-400 hover:bg-violet-50 dark:border-violet-500/25 dark:bg-white/5 dark:text-violet-200">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries.map((entry, index) => (
            <div key={index} className={`flex ${entry.role === "operator" ? "justify-end" : "justify-start"}`}>
              <div className={`group max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed shadow-sm ${entry.role === "operator" ? "rounded-br-sm bg-violet-600 text-white" : "rounded-bl-sm border border-zinc-200 bg-white text-zinc-800 dark:border-white/10 dark:bg-[#24222e] dark:text-zinc-100"}`}>
                {entry.content}
                {entry.role === "brain" && (
                  <button type="button" onClick={() => void copy(entry.content, index)}
                    className="mt-2 flex items-center gap-1 border-t border-black/5 pt-2 text-[10px] text-violet-600 hover:underline dark:border-white/10 dark:text-violet-300">
                    {copied === index ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied === index ? "Copiado" : "Copiar resposta"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {working && (
            <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-300"><Loader2 className="h-4 w-4 animate-spin" /> Brian está pensando…</div>
          )}
          {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <div ref={endRef} />
        </div>
        <footer className={`${styles.footer} shrink-0 border-t border-violet-200 bg-white px-3.5 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 md:pb-4 dark:border-white/10 dark:bg-[#1e1a2a]`}>
          <div className={`${styles.composer} flex items-end gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-1.5 focus-within:border-violet-400 dark:border-white/10 dark:bg-white/5`}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              placeholder="Converse livremente com o Brian…" maxLength={3000} rows={1} disabled={working}
              className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2 text-[16px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white" />
            <button type="button" onClick={() => void send()} disabled={working || !draft.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-35" aria-label="Enviar ao Brian">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-zinc-400">Enter para enviar · Shift+Enter para pular linha</p>
        </footer>
      </section>
    </div>
  );
}
