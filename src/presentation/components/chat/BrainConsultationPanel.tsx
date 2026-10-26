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
  HelpCircle,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  BookmarkPlus,
  ArrowRight,
} from "lucide-react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";

type ConsultationMessage = {
  id: string;
  role: "operator" | "brain";
  content: string;
};

export interface BrainConsultationPanelProps {
  turnId: string;
  question: string;
  answer: string;
  submitting: boolean;
  onAnswerChange: (value: string) => void;
  onSubmit: (saveForFuture: boolean, overrideAnswer?: string) => void;
  theme?: "default" | "whatsapp-ios";
}

const QUICK_PROMPTS = [
  {
    label: "3 caminhos",
    prompt: "Me dê 3 caminhos possíveis para conduzir essa situação, com uma frase curta explicando a diferença entre eles.",
    icon: Sparkles,
  },
  {
    label: "Sugerir resposta neutra",
    prompt: "Sugira uma resposta natural e descontraída no estilo da Larissa que contorne a situação sem inventar fatos.",
    icon: MessageCircleQuestion,
  },
  {
    label: "O que já sabemos?",
    prompt: "O que já sabemos nesta conversa que pode ajudar a responder isso? Liste só fatos sustentados pelo histórico.",
    icon: BrainCircuit,
  },
  {
    label: "Resumir contexto",
    prompt: "Me resume o contexto que levou a essa dúvida e separa o que é fato do que é inferência.",
    icon: Search,
  },
];

const QUICK_SHORTCUTS = [
  "Sim, pode confirmar",
  "Não, não faz/não tem",
  "Desconversa e muda de assunto",
  "Diz que vai ver com calma depois",
];

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseQuestionAndContext(rawQuestion: string) {
  let cleaned = (rawQuestion || "")
    .replace(/^brain_manual_resolution\|?/i, "")
    .replace(/^Brain precisa saber:\s*/i, "")
    .trim();

  const contextMatch = cleaned.match(/[\r\n]+Contexto:\s*([\s\S]+)$/i);
  if (contextMatch) {
    const mainQuestion = cleaned.slice(0, contextMatch.index).trim();
    const context = contextMatch[1].trim();
    return { mainQuestion: mainQuestion || cleaned, context };
  }
  return { mainQuestion: cleaned || "O Brain precisa da sua instrução para formular a resposta.", context: null };
}

export function BrainConsultationPanel({
  turnId,
  question,
  answer,
  submitting,
  onAnswerChange,
  onSubmit,
  theme = "default",
}: BrainConsultationPanelProps) {
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isConsulting, setIsConsulting] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const answerInputRef = useRef<HTMLTextAreaElement>(null);

  const isWa = theme === "whatsapp-ios";
  const { mainQuestion, context } = parseQuestionAndContext(question);

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setConsultationError(null);
    setIsAssistantOpen(false);
  }, [turnId]);

  useEffect(() => {
    if (isAssistantOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, isConsulting, isAssistantOpen]);

  const sendConsultation = async (overrideMessage?: string) => {
    const content = (overrideMessage ?? draft).trim();
    if (!content || isConsulting) return;

    if (!isAssistantOpen) {
      setIsAssistantOpen(true);
    }

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

  const handleApplySuggestion = (text: string) => {
    onAnswerChange(text);
    if (answerInputRef.current) {
      answerInputRef.current.focus();
    }
  };

  const effectiveAnswer = answer.trim() || draft.trim();
  const canSubmit = Boolean(effectiveAnswer) && !submitting;

  const handleFinalSubmit = (saveForFuture: boolean) => {
    if (!effectiveAnswer || submitting) return;
    if (!answer.trim() && draft.trim()) {
      onAnswerChange(draft.trim());
      onSubmit(saveForFuture, draft.trim());
    } else {
      onSubmit(saveForFuture, answer.trim());
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
    <article
      aria-label="Intervenção do operador necessária"
      className={`overflow-hidden rounded-2xl border transition-all shadow-md ${
        isWa
          ? "border-[#ffb020]/30 bg-[#182229] text-[#e9edef]"
          : "border-amber-400/35 bg-white dark:bg-[#131218] text-zinc-900 dark:text-zinc-100"
      }`}
    >
      {/* 1. TOPO: Badge e Título de Chamada */}
      <div
        className={`px-4 py-3.5 border-b flex flex-wrap items-center justify-between gap-2.5 ${
          isWa
            ? "border-white/[0.08] bg-[#111b21]/70"
            : "border-amber-500/15 bg-amber-500/[0.04]"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
              isWa
                ? "border-[#ffb020]/35 bg-[#ffb020]/15 text-[#ffb020]"
                : "border-amber-400/40 bg-amber-400/15 text-amber-600 dark:text-amber-300"
            }`}
          >
            <HelpCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold tracking-tight">
                A Larissa precisa da sua instrução
              </h4>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isWa
                    ? "bg-[#ffb020]/20 text-[#ffb020]"
                    : "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200"
                }`}
              >
                Aguardando você
              </span>
            </div>
            <p className={`text-xs ${isWa ? "text-[#8696a0]" : "text-zinc-500"}`}>
              A IA pausou este turno com segurança para não inventar informações.
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
            isWa
              ? "text-[#8696a0] bg-white/[0.04]"
              : "text-zinc-500 bg-zinc-100 dark:bg-zinc-800"
          }`}
          title="Esta interação é interna da equipe e não é visível para o pretendente"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          Consulta interna
        </span>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* 2. CARD DA PERGUNTA DO BRAIN */}
        <div
          className={`rounded-xl p-3.5 sm:p-4 border ${
            isWa
              ? "border-[#ffb020]/25 bg-[#202c33]/70"
              : "border-amber-300/40 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-500/20"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                isWa
                  ? "bg-[#ffb020]/20 text-[#ffb020]"
                  : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              }`}
            >
              ?
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider block mb-1 ${
                  isWa ? "text-[#ffb020]" : "text-amber-700 dark:text-amber-300"
                }`}
              >
                Dúvida factual levantada
              </span>
              <p
                className={`text-sm sm:text-[15px] font-semibold leading-snug break-words ${
                  isWa ? "text-[#e9edef]" : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {mainQuestion}
              </p>

              {context && (
                <div
                  className={`mt-2.5 pt-2.5 border-t text-xs leading-relaxed flex items-start gap-2 ${
                    isWa
                      ? "border-white/[0.08] text-[#8696a0]"
                      : "border-amber-200/60 dark:border-amber-500/20 text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-70" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold mr-1">Contexto da conversa:</span>
                    <span className="italic">{context}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. CAMPO DE RESPOSTA PRINCIPAL (DIRETO E CONFORTÁVEL) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`manual-resolution-${turnId}`}
              className={`text-xs font-bold flex items-center gap-1.5 ${
                isWa ? "text-[#e9edef]" : "text-zinc-800 dark:text-zinc-200"
              }`}
            >
              <span>Sua resposta / instrução para a conversa:</span>
            </label>
            {answer && (
              <button
                type="button"
                onClick={() => onAnswerChange("")}
                className={`text-[11px] font-medium transition hover:underline cursor-pointer flex items-center gap-1 ${
                  isWa ? "text-[#8696a0] hover:text-[#e9edef]" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <X className="h-3 w-3" />
                Limpar campo
              </button>
            )}
          </div>

          <textarea
            ref={answerInputRef}
            id={`manual-resolution-${turnId}`}
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Digite a informação factual ou instrua como a Larissa deve conduzir a resposta..."
            className={`w-full resize-y rounded-xl p-3 text-sm leading-relaxed outline-none transition focus:ring-2 ${
              isWa
                ? "border border-white/[0.12] bg-[#202c33] text-[#e9edef] placeholder:text-[#8696a0] focus:border-[#25d366]/50 focus:ring-[#25d366]/20"
                : "border border-zinc-200 bg-zinc-50/70 text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500/50 focus:ring-violet-500/20 dark:border-zinc-800 dark:bg-black/30 dark:text-zinc-100"
            }`}
            disabled={submitting}
          />

          {/* Atalhos rápidos de 1 clique */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider mr-0.5 ${isWa ? "text-[#8696a0]" : "text-zinc-400"}`}>
              Atalhos rápidos:
            </span>
            {QUICK_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut}
                type="button"
                onClick={() => handleApplySuggestion(shortcut)}
                disabled={submitting}
                className={`text-xs px-2.5 py-1 rounded-lg border transition active:scale-95 cursor-pointer font-medium ${
                  isWa
                    ? "border-white/[0.08] bg-[#202c33]/70 hover:bg-[#202c33] text-[#e9edef]"
                    : "border-zinc-200 bg-zinc-100/70 hover:bg-zinc-200 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300"
                }`}
              >
                {shortcut}
              </button>
            ))}
          </div>
        </div>

        {/* 4. ASSISTENTE INTELIGENTE RECOLHÍVEL (CONSULTA COM O BRAIN) */}
        <div
          className={`rounded-xl border transition-all ${
            isAssistantOpen
              ? isWa
                ? "border-emerald-500/30 bg-[#111b21]/90"
                : "border-violet-400/30 bg-violet-500/[0.03]"
              : isWa
              ? "border-white/[0.08] bg-[#202c33]/40 hover:bg-[#202c33]/70"
              : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-white/[0.02] hover:bg-zinc-100/60"
          }`}
        >
          <button
            type="button"
            onClick={() => setIsAssistantOpen(!isAssistantOpen)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer transition select-none"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                  isWa
                    ? "bg-[#25d366]/15 text-[#25d366]"
                    : "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                }`}
              >
                <Lightbulb className="h-3.5 w-3.5" />
              </span>
              <span className={`text-xs font-bold ${isWa ? "text-[#e9edef]" : "text-zinc-800 dark:text-zinc-200"}`}>
                Quer ideias? Peça sugestões ao Brain
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  isWa
                    ? "bg-white/[0.06] text-[#8696a0]"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"
                }`}
              >
                Opcional
              </span>
            </div>
            {isAssistantOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 opacity-70" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
            )}
          </button>

          {isAssistantOpen && (
            <div className={`p-3.5 pt-0 space-y-3 border-t ${isWa ? "border-white/[0.08]" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-2">
                {QUICK_PROMPTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => void sendConsultation(item.prompt)}
                      disabled={isConsulting}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40 cursor-pointer ${
                        isWa
                          ? "border-white/[0.08] bg-[#202c33] text-[#e9edef] hover:border-[#25d366]/40 hover:text-[#25d366]"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {/* Mensagens de Consulta */}
              {(messages.length > 0 || isConsulting) && (
                <div
                  className={`max-h-60 space-y-2.5 overflow-y-auto rounded-xl border p-3 scrollbar-thin ${
                    isWa
                      ? "border-white/[0.08] bg-[#0c1317]"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black/40"
                  }`}
                >
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "operator" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                          message.role === "operator"
                            ? isWa
                              ? "bg-[#005c4b] text-[#e9edef] rounded-br-sm"
                              : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black rounded-br-sm"
                            : isWa
                            ? "bg-[#202c33] text-[#e9edef] border border-white/[0.06] rounded-bl-sm"
                            : "bg-violet-50 text-zinc-800 border border-violet-200/60 dark:bg-violet-950/20 dark:border-violet-500/20 dark:text-zinc-200 rounded-bl-sm"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        {message.role === "brain" && (
                          <div className={`mt-2 flex flex-wrap items-center gap-1.5 pt-2 border-t ${isWa ? "border-white/[0.08]" : "border-violet-200/60 dark:border-violet-500/20"}`}>
                            <button
                              type="button"
                              onClick={() => handleApplySuggestion(message.content)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition active:scale-95 cursor-pointer ${
                                isWa
                                  ? "bg-[#00a884] text-white hover:bg-[#06cf9c]"
                                  : "bg-violet-600 text-white hover:bg-violet-500"
                              }`}
                            >
                              <ArrowRight className="h-3 w-3" />
                              Usar como minha resposta
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyMessage(message)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition cursor-pointer ${
                                isWa
                                  ? "text-[#8696a0] hover:text-[#e9edef]"
                                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                              }`}
                            >
                              {copiedId === message.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              {copiedId === message.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isConsulting && (
                    <div className="flex justify-start">
                      <div
                        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
                          isWa
                            ? "bg-[#202c33] text-[#8696a0]"
                            : "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                        }`}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Brain pensando na melhor sugestão...
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {consultationError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-300">
                  {consultationError}
                </div>
              )}

              {/* Input de Pergunta Livre ao Brain */}
              <div
                className={`flex items-center gap-2 rounded-xl border p-1.5 ${
                  isWa
                    ? "border-white/[0.12] bg-[#202c33]"
                    : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-black/30"
                }`}
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendConsultation();
                    }
                  }}
                  placeholder="Pergunte algo ao Brain..."
                  className={`flex-1 bg-transparent px-2.5 py-1 text-xs outline-none ${
                    isWa
                      ? "text-[#e9edef] placeholder:text-[#8696a0]"
                      : "text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100"
                  }`}
                  disabled={isConsulting}
                />
                <button
                  type="button"
                  onClick={() => void sendConsultation()}
                  disabled={!draft.trim() || isConsulting}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition active:scale-95 disabled:opacity-40 cursor-pointer ${
                    isWa
                      ? "bg-[#00a884] text-white hover:bg-[#06cf9c]"
                      : "bg-violet-600 text-white hover:bg-violet-500"
                  }`}
                  aria-label="Enviar ao Brain"
                >
                  {isConsulting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 5. BOTÕES DE AÇÃO PRINCIPAIS (RETOMADA DO TURNO) */}
        <div className="pt-2 border-t border-white/[0.08] flex flex-col sm:flex-row gap-2.5">
          {/* Botão Secundário: Usar só neste turno */}
          <button
            type="button"
            onClick={() => handleFinalSubmit(false)}
            disabled={!canSubmit}
            className={`min-h-[46px] flex-1 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95 disabled:opacity-40 cursor-pointer border flex flex-col items-center justify-center text-center ${
              isWa
                ? "border-white/[0.12] bg-[#202c33] text-[#e9edef] hover:bg-white/[0.08]"
                : "border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            <span>{submitting ? "Retomando..." : "Responder só nesta vez"}</span>
            <span className={`text-[10px] font-normal mt-0.5 ${isWa ? "text-[#8696a0]" : "text-zinc-400"}`}>
              Apenas para esta mensagem
            </span>
          </button>

          {/* Botão Primário: Salvar na memória e retomar */}
          <button
            type="button"
            onClick={() => handleFinalSubmit(true)}
            disabled={!canSubmit}
            className={`min-h-[46px] flex-1 rounded-xl px-4 py-2 text-xs font-black transition active:scale-95 disabled:opacity-40 cursor-pointer flex flex-col items-center justify-center text-center shadow-lg ${
              isWa
                ? "bg-[#00a884] hover:bg-[#06cf9c] text-white shadow-[#00a884]/20"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/20"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <BookmarkPlus className="h-3.5 w-3.5" />
              <span>{submitting ? "Gravando e retomando..." : "Salvar na memória e responder"}</span>
            </span>
            <span className="text-[10px] font-normal opacity-90 mt-0.5">
              Larissa aprende e lembra nos próximos papos
            </span>
          </button>
        </div>
      </div>
    </article>
  );
}
