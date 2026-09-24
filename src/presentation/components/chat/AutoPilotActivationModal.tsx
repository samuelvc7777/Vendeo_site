"use client";

import React, { useState } from "react";
import { Bot, Zap, Clock, X, Sparkles, ArrowRight, Loader2 } from "lucide-react";

interface AutoPilotActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: "immediate" | "wait_next") => Promise<void> | void;
  chatName?: string;
}

export function AutoPilotActivationModal({
  isOpen,
  onClose,
  onConfirm,
  chatName,
}: AutoPilotActivationModalProps) {
  const [selectedMode, setSelectedMode] = useState<"immediate" | "wait_next" | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleAction = async (mode: "immediate" | "wait_next") => {
    setSelectedMode(mode);
    setIsLoading(true);
    try {
      await onConfirm(mode);
      onClose();
    } finally {
      setIsLoading(false);
      setSelectedMode(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[#121212] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header do Modal */}
        <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                Ativar Piloto Automático
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" /> IA
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {chatName ? `Conversa com ${chatName}` : "Escolha como a IA deve iniciar"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo do Modal com Opções de Inicialização */}
        <div className="p-5 space-y-3.5">
          <p className="text-xs text-zinc-300 font-medium">
            Como deseja que a Larissa inicie o atendimento nesta conversa?
          </p>

          {/* Opção 1: Responder Imediatamente */}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleAction("immediate")}
            className="w-full text-left p-4 rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/20 via-[#18181b] to-zinc-900/80 hover:border-emerald-400/70 hover:bg-emerald-500/10 transition-all cursor-pointer group relative overflow-hidden shadow-lg shadow-emerald-950/20 disabled:opacity-60"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                {isLoading && selectedMode === "immediate" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (
                  <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                    Responder agora (Imediatamente)
                  </h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                    Recomendado
                  </span>
                </div>
                <p className="text-[11px] text-zinc-300 mt-1 leading-snug">
                  A IA processará a última mensagem pendente do cliente agora mesmo e continuará respondendo as próximas automaticamente.
                </p>
                <div className="mt-2 text-[10px] text-emerald-400/90 font-medium flex items-center gap-1">
                  <span>Inicia o atendimento sem esperar nova mensagem</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          </button>

          {/* Opção 2: Aguardar Próxima Mensagem */}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleAction("wait_next")}
            className="w-full text-left p-4 rounded-xl border border-zinc-800 bg-[#161618] hover:border-zinc-700 hover:bg-[#1c1c1f] transition-all cursor-pointer group disabled:opacity-60"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0 mt-0.5 group-hover:text-zinc-200 transition-colors">
                {isLoading && selectedMode === "wait_next" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-white group-hover:text-zinc-200 transition-colors">
                  Apenas aguardar próxima mensagem
                </h4>
                <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                  O piloto ficará pronto e armado, mas só responderá quando o cliente enviar uma nova mensagem.
                </p>
                <div className="mt-2 text-[10px] text-zinc-500 font-medium">
                  Ideal se você acabou de responder manualmente
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Rodapé com botão Cancelar */}
        <div className="px-5 py-3 border-t border-[#262626] bg-[#141414] flex items-center justify-end">
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
