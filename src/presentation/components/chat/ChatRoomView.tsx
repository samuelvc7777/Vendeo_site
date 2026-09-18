"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Conversation, ChatMessage } from "@/domain/entities/Chat";
import { ArrowLeft, Send, ShieldCheck, ShoppingBag, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ChatRoomViewProps {
  conversation: Conversation;
  messages: ChatMessage[];
  onBack: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onBuyProduct?: (productTitle: string) => void;
}

export function ChatRoomView({
  conversation,
  messages,
  onBack,
  onSendMessage,
  onBuyProduct,
}: ChatRoomViewProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText("");
    await onSendMessage(text);
  };

  return (
    <div className="flex-1 flex flex-col h-full relative bg-slate-950">
      {/* Header do Chat */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white active:scale-90 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="relative">
            <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-700 relative">
              <Image
                src={conversation.participant.avatar}
                alt={conversation.participant.name}
                fill
                className="object-cover"
              />
            </div>
            {conversation.participant.isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-slate-900" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-white">
                {conversation.participant.name}
              </span>
              {conversation.participant.verified && (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </div>
            <span className="text-[10px] text-slate-400">
              {conversation.participant.isOnline ? "Online agora" : "Visto por último hoje"}
            </span>
          </div>
        </div>
      </div>

      {/* Mini Card de Produto Fixado no Topo */}
      {conversation.product && (
        <div className="bg-slate-900/80 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-slate-800 shrink-0">
              <Image
                src={conversation.product.image}
                alt={conversation.product.title}
                fill
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-white truncate">
                {conversation.product.title}
              </p>
              <p className="text-[11px] font-bold text-emerald-400">
                {formatCurrency(conversation.product.price)}
              </p>
            </div>
          </div>

          <button
            onClick={() => onBuyProduct?.(conversation.product!.title)}
            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 shrink-0 active:scale-95 transition-all cursor-pointer shadow-md shadow-emerald-500/10"
          >
            <ShoppingBag className="w-3 h-3 stroke-[2.5]" />
            Comprar
          </button>
        </div>
      )}

      {/* Lista de Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none pb-24">
        <div className="text-center my-2">
          <span className="text-[10px] bg-slate-900 text-slate-400 px-3 py-1 rounded-full border border-slate-800">
            🔒 Conversa protegida pelo Vendeo Safe
          </span>
        </div>

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.isMine ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                msg.isMine
                  ? "bg-emerald-500 text-slate-950 font-medium rounded-tr-none shadow-md shadow-emerald-500/10"
                  : "bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/60"
              }`}
            >
              <p>{msg.text}</p>
              <span
                className={`text-[9px] block text-right mt-1 ${
                  msg.isMine ? "text-slate-900/80 font-bold" : "text-slate-400"
                }`}
              >
                {msg.createdAt}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de Mensagem Fixo no Rodapé da Conversa */}
      <form
        onSubmit={handleSend}
        className="absolute bottom-16 inset-x-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-3 py-2.5 flex items-center gap-2 z-20"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Digite uma mensagem ou proposta..."
          className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
        />

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="w-9 h-9 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0 shadow-md shadow-emerald-500/20"
        >
          <Send className="w-4 h-4 stroke-[2.5]" />
        </button>
      </form>
    </div>
  );
}
