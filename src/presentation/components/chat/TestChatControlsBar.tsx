"use client";

import React, { useState } from "react";
import {
  Zap,
  Image as ImageIcon,
  AlertTriangle,
  RotateCcw,
  User,
  Bot,
  Sparkles,
  ChevronRight,
  ShieldAlert,
  Clock,
  CheckCircle2,
} from "lucide-react";

interface TestChatControlsBarProps {
  senderRole: "them" | "me";
  onRoleChange: (role: "them" | "me") => void;
  onForceProcessAi: () => void;
  onSimulatePhoto: () => void;
  onSimulateSensitive: () => void;
  onResetChat: () => void;
  onAdvanceStage?: () => void;
  autoPilotStatus?: string;
  pauseReason?: string;
  isProcessing?: boolean;
}

export function TestChatControlsBar({
  senderRole,
  onRoleChange,
  onForceProcessAi,
  onSimulatePhoto,
  onSimulateSensitive,
  onResetChat,
  onAdvanceStage,
  autoPilotStatus = "idle",
  pauseReason,
  isProcessing = false,
}: TestChatControlsBarProps) {
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  // Status visual amigável do Piloto Automático
  const getStatusBadge = () => {
    if (isProcessing || autoPilotStatus === "processing") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse">
          <Bot className="w-2.5 h-2.5 animate-spin" />
          <span>IA gerando resposta...</span>
        </span>
      );
    }
    if (autoPilotStatus === "paused_guardrail") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 border border-red-500/40 text-red-300"
          title={pauseReason || "Guardrail acionado"}
        >
          <ShieldAlert className="w-2.5 h-2.5" />
          <span>Pausado (Guardrail)</span>
        </span>
      );
    }
    if (autoPilotStatus === "paused_handoff") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 border border-purple-500/40 text-purple-300"
          title={pauseReason || "Momento da Rifa atingido"}
        >
          <Sparkles className="w-2.5 h-2.5" />
          <span>Handoff Rifa Atingido!</span>
        </span>
      );
    }
    if (autoPilotStatus === "waiting_delay" || autoPilotStatus === "waiting_debounce") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 border border-blue-500/40 text-blue-300">
          <Clock className="w-2.5 h-2.5 animate-pulse" />
          <span>Aguardando resposta</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
        <span>Piloto Ativo</span>
      </span>
    );
  };

  return (
    <div className="shrink-0 bg-[#161618] border-b border-[#26262a] px-3 py-2 flex flex-col gap-2 z-10 select-none shadow-md">
      {/* Linha 1: Seletor de Papel + Status da IA */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-[#2c2c30]">
          <span className="text-[10px] text-zinc-400 font-medium px-1.5 hidden xs:inline">
            Digitando como:
          </span>
          <button
            type="button"
            onClick={() => onRoleChange("them")}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all active:scale-95 ${
              senderRole === "them"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <User className="w-3 h-3" />
            <span>👤 Pretendente</span>
          </button>
          <button
            type="button"
            onClick={() => onRoleChange("me")}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all active:scale-95 ${
              senderRole === "me"
                ? "bg-pink-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>👩 Larissa (Manual)</span>
          </button>
        </div>

        {/* Badge de status do piloto */}
        <div className="shrink-0">{getStatusBadge()}</div>
      </div>

      {/* Linha 2: Botões Rápidos de Simulação & Cenários */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {/* Disparar IA Imediatamente */}
        <button
          type="button"
          onClick={onForceProcessAi}
          disabled={isProcessing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
          title="Força a IA a responder agora sem esperar o timer de debounce"
        >
          <Zap className="w-3 h-3 text-amber-400 shrink-0 fill-amber-400" />
          <span>Disparar IA Agora</span>
        </button>

        {/* Simular Envio de Foto */}
        <button
          type="button"
          onClick={onSimulatePhoto}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-[#222226] hover:bg-[#2a2a30] text-zinc-300 border border-[#303036] whitespace-nowrap active:scale-95 transition-all"
          title="Simula o envio de uma foto pelo pretendente (testa o Guardrail)"
        >
          <ImageIcon className="w-3 h-3 text-blue-400 shrink-0" />
          <span>Simular Foto</span>
        </button>

        {/* Simular Mensagem Sensível */}
        <button
          type="button"
          onClick={onSimulateSensitive}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-[#222226] hover:bg-[#2a2a30] text-zinc-300 border border-[#303036] whitespace-nowrap active:scale-95 transition-all"
          title="Simula uma mensagem com termos suspeitos (testa o Guardrail de segurança)"
        >
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span>Simular Sensível</span>
        </button>

        {/* Avançar Etapa Manual */}
        {onAdvanceStage && (
          <button
            type="button"
            onClick={onAdvanceStage}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-[#222226] hover:bg-[#2a2a30] text-zinc-300 border border-[#303036] whitespace-nowrap active:scale-95 transition-all"
            title="Avança manualmente para a próxima etapa do funil"
          >
            <ChevronRight className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>Avançar Etapa</span>
          </button>
        )}

        {/* Resetar Chat */}
        {showConfirmReset ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onResetChat();
                setShowConfirmReset(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-red-600 hover:bg-red-700 text-white whitespace-nowrap active:scale-95 transition-all"
            >
              <span>Confirmar Reset?</span>
            </button>
            <button
              type="button"
              onClick={() => setShowConfirmReset(false)}
              className="px-1.5 py-1 rounded-lg text-[10px] text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirmReset(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-[#222226] hover:bg-red-950/40 text-zinc-400 hover:text-red-300 border border-[#303036] whitespace-nowrap active:scale-95 transition-all ml-auto"
            title="Limpa as mensagens do teste e reinicia a conversa do zero"
          >
            <RotateCcw className="w-3 h-3 text-zinc-400 shrink-0" />
            <span>Resetar Chat</span>
          </button>
        )}
      </div>
    </div>
  );
}
