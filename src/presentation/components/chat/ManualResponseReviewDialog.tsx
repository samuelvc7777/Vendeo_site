"use client";

import { Check, Clock3, Loader2, MessageCircle, X } from "lucide-react";

export interface ManualReviewMessage {
  id: string;
  text: string;
  isMine: boolean;
  createdAt?: string;
  sentDate?: string;
  timestamp?: number;
  status?: string;
  mediaType?: "image" | "audio" | "video";
}

interface ManualResponseReviewDialogProps {
  contactName: string;
  contactUsername: string;
  messages: ManualReviewMessage[];
  reason: string;
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSend: () => void;
}

function formatMessageTime(message: ManualReviewMessage): string {
  const source = message.timestamp ?? message.sentDate ?? message.createdAt;
  if (source === undefined) return "";
  const date = new Date(source);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getMessageText(message: ManualReviewMessage): string {
  if (message.mediaType === "audio" || message.text.startsWith("[audio:")) return "🎙️ Mensagem de voz";
  if (message.mediaType === "image" || message.text.startsWith("[image:")) return "📷 Foto";
  if (message.mediaType === "video" || message.text.startsWith("[video:")) return "🎥 Vídeo";
  return message.text || "Mensagem";
}

export function ManualResponseReviewDialog({
  contactName,
  contactUsername,
  messages,
  reason,
  value,
  isSending,
  onChange,
  onClose,
  onSend,
}: ManualResponseReviewDialogProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-response-title"
        className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0d0d0f] shadow-[0_28px_110px_rgba(0,0,0,0.75)]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-4 py-3.5 sm:px-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-200 ring-1 ring-amber-200/20">
            <MessageCircle className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="manual-response-title" className="truncate text-sm font-semibold text-white">
                Resposta aguardando você
              </h2>
              <span className="hidden rounded-full border border-amber-200/20 bg-amber-200/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100 sm:inline-flex">
                IA pausada
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {contactName}{contactUsername ? ` · @${contactUsername.replace(/^@/, "")}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Responder depois"
            title="Responder depois"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b border-white/[0.06] bg-[#09090b] px-3 py-3 sm:px-5">
            <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              <MessageCircle className="h-3.5 w-3.5" /> Contexto recente da conversa
            </div>
            <div className="mx-auto flex max-h-[34dvh] min-h-24 max-w-xl flex-col gap-2 overflow-y-auto px-1 py-1 sm:max-h-[38dvh]">
              {messages.length === 0 ? (
                <div className="m-auto rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-center text-xs text-zinc-500">
                  Ainda não há mensagens recentes carregadas.
                </div>
              ) : messages.map((message) => (
                <div key={message.id} className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-[18px] px-3.5 py-2.5 shadow-sm sm:max-w-[80%] ${message.isMine ? "rounded-br-md bg-[#34343a] text-zinc-50" : "rounded-bl-md border border-white/[0.045] bg-[#202024] text-zinc-100"}`}>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.45]">{getMessageText(message)}</p>
                    <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-zinc-500">
                      {formatMessageTime(message)}
                      {message.isMine && message.status === "seen" ? <span>· visto</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3.5 p-4 sm:p-5">
            <div className="rounded-2xl border border-amber-200/15 bg-gradient-to-br from-amber-200/[0.08] to-orange-300/[0.025] px-3.5 py-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100/80">
                <Clock3 className="h-3 w-3" /> Por que a IA pausou
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-200">
                {reason || "A IA precisa da sua ajuda para responder com segurança."}
              </p>
            </div>

            <div className="rounded-[20px] border border-white/10 bg-[#17171a] p-2 shadow-inner focus-within:border-amber-200/35 focus-within:ring-2 focus-within:ring-amber-200/[0.06]">
              <label htmlFor="manual-response-input" className="sr-only">Sua resposta</label>
              <textarea
                id="manual-response-input"
                autoFocus
                rows={3}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                placeholder="Escreva sua resposta…"
                className="max-h-36 min-h-[76px] w-full resize-y bg-transparent px-2.5 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-zinc-600"
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
                <span className="text-[10px] text-zinc-600">Ctrl+Enter para enviar</span>
                <button
                  type="button"
                  disabled={!value.trim() || isSending}
                  onClick={onSend}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full bg-amber-200 px-4 text-xs font-bold text-[#17130a] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {isSending ? "Enviando…" : "Enviar resposta"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
