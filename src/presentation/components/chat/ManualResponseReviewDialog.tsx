"use client";

import { BellRing, Check, Clock3, Loader2, MessageCircle, X } from "lucide-react";
import Image from "next/image";

interface ReviewMessage {
  id: string;
  text: string;
  isMine: boolean;
  createdAt?: string;
  sentDate?: string;
  timestamp?: number;
  status?: string;
  mediaType?: "image" | "audio" | "video";
  mediaUrl?: string;
  replyTo?: { senderName: string; text: string };
}

interface ManualResponseReviewDialogProps {
  contactName: string;
  contactUsername: string;
  messages: ReviewMessage[];
  reason: string;
  candidateResponse?: string;
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSend: () => void;
}

function messageTime(message: ReviewMessage): string {
  const source = message.timestamp || message.sentDate || message.createdAt;
  if (!source) return "";
  const date = typeof source === "number" ? new Date(source) : new Date(source);
  return Number.isNaN(date.getTime())
    ? String(source).slice(0, 16)
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function messageLabel(message: ReviewMessage): string {
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
  candidateResponse,
  value,
  isSending,
  onChange,
  onClose,
  onSend,
}: ManualResponseReviewDialogProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in duration-150 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-response-title"
        className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-white/[0.1] bg-[#0d0d0f] shadow-[0_28px_110px_rgba(0,0,0,0.75)] animate-in zoom-in-95 duration-200"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-4 py-3.5 sm:px-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300/20 to-orange-500/10 text-amber-200 ring-1 ring-amber-200/20">
            <BellRing className="h-[18px] w-[18px]" />
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
            <p className="mt-0.5 truncate text-xs text-zinc-500">{contactName}{contactUsername ? ` · @${contactUsername.replace(/^@/, "")}` : ""}</p>
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
            <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              <MessageCircle className="h-3.5 w-3.5" />
              Contexto recente da conversa
            </div>
            <div className="mx-auto flex max-h-[34dvh] min-h-24 max-w-xl flex-col gap-2 overflow-y-auto px-1 py-1 sm:max-h-[38dvh]">
              {messages.length === 0 ? (
                <div className="m-auto rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-center text-xs text-zinc-500">
                  Ainda não há mensagens recentes carregadas.
                </div>
              ) : messages.map((message) => (
                <div key={message.id} className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-[18px] px-3.5 py-2.5 shadow-sm sm:max-w-[80%] ${message.isMine ? "rounded-br-md bg-[#34343a] text-zinc-50" : "rounded-bl-md border border-white/[0.045] bg-[#202024] text-zinc-100"}`}>
                    {message.replyTo && (
                      <div className={`mb-2 rounded-lg border-l-2 px-2.5 py-1.5 ${message.isMine ? "border-amber-200/60 bg-black/20" : "border-sky-300/60 bg-black/20"}`}>
                        <div className="mb-0.5 text-[10px] font-semibold text-zinc-300">{message.replyTo.senderName || "Mensagem respondida"}</div>
                        <div className="line-clamp-2 whitespace-pre-wrap break-words text-[11px] text-zinc-400">{message.replyTo.text}</div>
                      </div>
                    )}
                    {message.mediaUrl && message.mediaType === "image" ? (
                      <Image src={message.mediaUrl} alt="Imagem enviada na conversa" width={360} height={240} unoptimized className="mb-1 max-h-40 w-auto rounded-xl object-cover" />
                    ) : null}
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.45]">{messageLabel(message)}</p>
                    <div className={`mt-1 flex items-center justify-end gap-1 text-[9px] ${message.isMine ? "text-zinc-400" : "text-zinc-500"}`}>
                      {messageTime(message)}
                      {message.isMine && message.status === "seen" ? <span aria-label="Visualizada">· visto</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3.5 p-4 sm:p-5">
            <div className="rounded-2xl border border-amber-200/15 bg-gradient-to-br from-amber-200/[0.08] to-orange-300/[0.025] px-3.5 py-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100/80">
                <Clock3 className="h-3 w-3" />
                Por que a IA pausou
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-200">
                {reason || "A IA sinalizou que precisa de ajuda para responder com segurança."}
              </p>
            </div>

            {candidateResponse && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Sugestão que ficou retida</div>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">{candidateResponse}</p>
              </div>
            )}

            <div className="rounded-[20px] border border-white/[0.1] bg-[#17171a] p-2 shadow-inner focus-within:border-amber-200/35 focus-within:ring-2 focus-within:ring-amber-200/[0.06]">
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
                  id="manual-response-submit"
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
            <p className="text-center text-[10px] leading-relaxed text-zinc-600">
              Ao enviar, o contexto útil desta troca será salvo na memória deste chat para a IA consultar depois.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
