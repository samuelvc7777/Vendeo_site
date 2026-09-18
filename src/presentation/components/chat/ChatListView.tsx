"use client";

import React from "react";
import Image from "next/image";
import { Conversation } from "@/domain/entities/Chat";
import { MessageSquare, ShieldCheck, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ChatListViewProps {
  conversations: Conversation[];
  onSelectConversation: (conversation: Conversation) => void;
}

export function ChatListView({
  conversations,
  onSelectConversation,
}: ChatListViewProps) {
  return (
    <div className="flex-1 flex flex-col p-4 space-y-3">
      <div className="flex items-center justify-between pb-1">
        <div>
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-400" />
            Negociações & Mensagens
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Converse diretamente com compradores e vendedores
          </p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800/80 flex items-center justify-center mb-3">
            <MessageSquare className="w-8 h-8 text-slate-500" />
          </div>
          <p className="text-sm font-semibold text-slate-300">
            Nenhuma mensagem ainda
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-[220px]">
            Ao clicar em &quot;Chat&quot; na página de um produto, sua conversa aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv)}
              className="bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-emerald-500/40 rounded-2xl p-3.5 flex items-center gap-3 transition-all duration-200 cursor-pointer active:scale-[0.98]"
            >
              {/* Avatar com status online */}
              <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-700 relative">
                  <Image
                    src={conv.participant.avatar}
                    alt={conv.participant.name}
                    fill
                    className="object-cover"
                  />
                </div>
                {conv.participant.isOnline && (
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full ring-2 ring-slate-900" />
                )}
              </div>

              {/* Informações da conversa */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-xs font-bold text-white truncate">
                      {conv.participant.name}
                    </span>
                    {conv.participant.verified && (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {conv.lastMessageTime}
                  </span>
                </div>

                {/* Produto atrelado */}
                {conv.product && (
                  <div className="text-[10px] text-emerald-400/90 font-medium truncate flex items-center gap-1 mt-0.5">
                    <span>Sobre:</span>
                    <span className="truncate">{conv.product.title}</span>
                    <span className="font-bold">({formatCurrency(conv.product.price)})</span>
                  </div>
                )}

                {/* Prévia da última mensagem */}
                <p className="text-xs text-slate-400 truncate mt-1">
                  {conv.lastMessage}
                </p>
              </div>

              {/* Badge de não lidas */}
              {conv.unreadCount > 0 && (
                <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] flex items-center justify-center shrink-0">
                  {conv.unreadCount}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
