"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  Copy,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";

type ConsultationMessage = {
  id: string;
  role: "operator" | "brain";
  content: string;
};

interface BrainConsultationPanelProps {
  turnId: string;
  question: string;
  answer: string;
  submitting: boolean;
  onAnswerChange: (value: string) => void;
  onSubmit: (saveForFuture: boolean) => void;
}

const QUICK_PROMPTS = [
  {
    label: "Resumir contexto",
    prompt: "Me resume o contexto que levou a essa dúvida e separa o que é fato do que é inferência.",
    icon: Search,
  },
  {
    label: "O que já sabemos?",
    prompt: "O que já sabemos nesta conversa que pode ajudar a responder isso? Liste só fatos sustentados pelo histórico.",
    icon: BrainCircuit,
  },
  {
    label: "3 caminhos",
    prompt: "Me dê 3 caminhos possíveis para conduzir essa situação, com uma frase curta explicando a diferença entre eles.",
    icon: Sparkles,
  },
  {
    label: "Pergunta de sondagem",
    prompt: "Sugira uma pergunta natural e neutra para descobrir a informação que está faltando sem parecer interrogatório.",
    icon: MessageCircleQuestion,
  },
];

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function BrainConsultationPanel({
  turnId,
  question,
  answer,
  submitting,
  onAnswerChange,
  onSubmit,
}: BrainConsultationPanelProps) {
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isConsulting, setIsConsulting] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setConsultationError(null);
  }, [turnId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, isConsulting]);

  const sendConsultation = async (overrideMessage?: string) => {
    const content = (overrideMessage ?? draft).trim();
    if (!content || isConsulting) return;

    const operatorEntry: ConsultationMessage = {
      id: makeId("operator"),
      role: "operator",
      content,
    };
    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((current) => [...current, operatorEntry]);
    setDraft("");
    setConsultationError(null);
    setIsConsulting(true);

    try {
      const response = await brainOperatorFetch("/operator/brain/consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnId,
          question,
          message: content,
          history,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success || !result.answer) {
        throw new Error(result.error || "O Brain não conseguiu responder à consulta.");
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId("brain"),
          role: "brain",
          content: String(result.answer),
        },
      ]);
    } catch (error: unknown) {
      setConsultationError(
        error instanceof Error ? error.message : "Falha ao consultar o Brain.",
      );
    } finally {
      setIsConsulting(false);
    }
  };

  const copyMessage = async (message: ConsultationMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setConsultationError("Não foi possível copiar esta resposta.");
    }
  };

  return (
    <section className="mb-4 overflow-hidden rounded-[22px] border border-violet-300/60 bg-gradient-to-br from-violet-50 via-white to-sky-50/70 shadow-[0_18px_50px_-34px_rgba(124,58,237,0.55)] dark:border-violet-500/25 dark:from-[#17131f] dark:via-[#111016] dark:to-[#10141d]">
      <div className="border-b border-violet-200/70 bg-white/55 px-3.5 py-3 backdrop-blur-xl dark:border-violet-500/15 dark:bg-white/[0.025]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h4 className="text-sm font-black text-zinc-950 dark:text-white">
                  Consulta privada com o Brain
                </h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Interno
                </span>
              </div>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Pense junto com o Brain antes de decidir o que entra no turno.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3 dark:border-amber-500/20 dark:bg-amber-500/[0.07]">
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
            O que está faltando
          </p>
          <p className="mt-1 break-words text-xs font-medium leading-5 text-zinc-800 dark:text-zinc-200">
            {question || "Uma informação factual para continuar."}
          </p>
        </div>
      </div>

      <div className="space-y-3 p-3.5">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {QUICK_PROMPTS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => void sendConsultation(item.prompt)}
                disabled={isConsulting}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 text-[9.5px] font-bold text-zinc-600 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:text-violet-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-violet-500/30 dark:hover:text-violet-300"
              >
                <Icon className="h-3 w-3" />
                {item.label}
              </button>
            );
          })}
        </div>

        {(messages.length > 0 || isConsulting) && (
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white/60 p-2.5 scrollbar-thin dark:border-white/10 dark:bg-black/15">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "operator" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-[11px] leading-5 shadow-sm ${
                    message.role === "operator"
                      ? "rounded-br-md bg-zinc-900 text-white dark:bg-white dark:text-black"
                      : "rounded-bl-md border border-violet-200 bg-violet-50 text-zinc-800 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-zinc-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.role === "brain" && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-violet-200/70 pt-2 dark:border-violet-500/15">
                      <button
                        type="button"
                        onClick={() => onAnswerChange(message.content)}
                        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[9px] font-bold text-white transition hover:bg-violet-500"
                      >
                        <Lightbulb className="h-3 w-3" />
                        Usar no campo final
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-bold text-violet-700 transition hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-500/10"
                      >
                        {copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedId === message.id ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isConsulting && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-[10px] font-semibold text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Brain consultando histórico e contexto…
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {consultationError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-medium text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {consultationError}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm focus-within:border-violet-300 dark:border-white/10 dark:bg-black/20 dark:focus-within:border-violet-500/30">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendConsultation();
              }
            }}
            rows={1}
            maxLength={3000}
            placeholder="Pergunte algo ao Brain antes de responder…"
            className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[11px] leading-5 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            disabled={isConsulting}
          />
          <button
            type="button"
            onClick={() => void sendConsultation()}
            disabled={!draft.trim() || isConsulting}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20 transition active:scale-95 disabled:opacity-35"
            aria-label="Enviar pergunta ao Brain"
          >
            {isConsulting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">
                Informação final
              </p>
              <p className="mt-0.5 text-[9.5px] text-zinc-400 dark:text-zinc-500">
                Só este campo será usado para retomar o turno.
              </p>
            </div>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>

          <textarea
            id={`manual-resolution-${turnId}`}
            value={answer}
            onChange={(event) => onAnswerChange(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Digite ou traga uma conclusão da consulta"
            className="mt-2.5 min-h-20 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-900 outline-none transition focus:border-violet-300 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100 dark:focus:border-violet-500/40"
            disabled={submitting}
          />

          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => onSubmit(false)}
              disabled={submitting || !answer.trim()}
              className="min-h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[10.5px] font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              {submitting ? "Retomando…" : "Usar só neste turno"}
            </button>
            <button
              type="button"
              onClick={() => onSubmit(true)}
              disabled={submitting || !answer.trim()}
              className="min-h-10 flex-1 rounded-xl bg-gradient-to-r from-amber-300 to-amber-400 px-3 text-[10.5px] font-black text-zinc-950 shadow-md shadow-amber-400/15 transition hover:-translate-y-0.5 disabled:opacity-40"
            >
              {submitting ? "Retomando…" : "Salvar e retomar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
