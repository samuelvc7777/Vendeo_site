"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Loader2, Send, UserRound, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getTinderMessages,
  sendTinderMessage,
  TinderMatchItem,
  TinderMatchMessage,
} from "./tinder-client";

interface MatchChatModalProps {
  match: TinderMatchItem | null;
  onClose: () => void;
}

function formatMessageTime(dateString?: string | null): string {
  if (!dateString) return "";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function MatchChatModal({ match, onClose }: MatchChatModalProps) {
  const [messages, setMessages] = useState<TinderMatchMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const loadMessages = async () => {
    if (!match?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getTinderMessages(match.id);
      setMessages(data);
      setTimeout(() => scrollToBottom("auto"), 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar mensagens.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (match) {
      void loadMessages();
      inputRef.current?.focus();
    }
  }, [match?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  if (!match) return null;

  const handleSend = async () => {
    const text = inputMessage.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const sentMsg = await sendTinderMessage(match.id, text);
      setMessages((prev) => [...prev, sentMsg]);
      setInputMessage("");
      scrollToBottom();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const avatar = match.person.photos?.[0]?.url || "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-black">
      {/* Header Fixo */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-200/80 bg-white/95 px-3 py-2.5 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] backdrop-blur-xl dark:border-white/10 dark:bg-black/95">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar para matches"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 active:scale-95 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            {avatar ? (
              <Image
                src={avatar}
                alt={match.person.name}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <UserRound className="h-5 w-5" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-zinc-950 dark:text-white leading-tight">
              {match.person.name}
              {match.person.age ? (
                <span className="font-medium text-xs text-zinc-500 dark:text-zinc-400">, {match.person.age}</span>
              ) : null}
            </h2>
            <p className="truncate text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
              Match no Tinder
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadMessages()}
          disabled={loading}
          aria-label="Atualizar conversa"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {/* Área de Mensagens com scroll */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && messages.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-zinc-400">
            <Loader2 className="h-6 w-6 animate-spin text-[#fd5068]" />
            <span className="text-xs">Carregando conversa...</span>
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center px-4">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-xs">{error}</p>
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="rounded-full bg-[#fd5068] px-4 py-2 text-xs font-bold text-white shadow active:scale-95"
            >
              Tentar novamente
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center px-6">
            <div className="h-16 w-16 rounded-full bg-[#fd5068]/10 text-[#fd5068] flex items-center justify-center mb-3">
              <UserRound className="h-8 w-8" />
            </div>
            <h3 className="text-sm font-black text-zinc-900 dark:text-white">
              Comece a conversa com {match.person.name}!
            </h3>
            <p className="mt-1 text-xs text-zinc-500 max-w-xs">
              Vocês deram match. Envie uma mensagem diretamente pela conta Tinder.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = Boolean(msg.isMine);
            const time = formatMessageTime(msg.sentAt);

            return (
              <div
                key={msg.id}
                className={cn("flex flex-col", isMine ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm break-words",
                    isMine
                      ? "bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white rounded-br-xs"
                      : "bg-zinc-100 text-zinc-950 dark:bg-[#1f1f22] dark:text-white rounded-bl-xs border border-zinc-200/50 dark:border-white/5",
                  )}
                >
                  <p>{msg.text}</p>
                </div>
                {time && (
                  <span className="mt-1 px-1 text-[9px] text-zinc-400">
                    {time}
                  </span>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Fixo Inferior */}
      <footer className="shrink-0 border-t border-zinc-200/80 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-xl dark:border-white/10 dark:bg-black/95">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Conversar com ${match.person.name}...`}
            disabled={sending}
            spellCheck={false}
            className="flex-1 min-h-11 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-[16px] sm:text-xs text-zinc-950 outline-none transition focus:border-[#fd5068] focus:bg-white dark:border-white/10 dark:bg-[#161618] dark:text-white dark:focus:border-[#fd5068]"
          />

          <button
            type="submit"
            disabled={sending || !inputMessage.trim()}
            aria-label="Enviar mensagem"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white shadow-sm transition active:scale-95 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
          </button>
        </form>
      </footer>
    </div>
  );
}
