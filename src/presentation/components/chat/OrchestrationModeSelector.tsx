"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Eye,
  FlaskConical,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  X,
  ChevronDown,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  OrchestrationMode,
  ConversationOrchestrationState,
  DEFAULT_ORCHESTRATION_STATE,
} from "@/domain/entities/Orchestration";
import { createClient } from "@supabase/supabase-js";

interface OrchestrationModeSelectorProps {
  conversationId: string;
  initialState?: ConversationOrchestrationState | null;
  onStateChange?: (state: ConversationOrchestrationState) => void;
}

function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
}

export function OrchestrationModeSelector({
  conversationId,
  initialState,
  onStateChange,
}: OrchestrationModeSelectorProps) {
  const [state, setState] = useState<ConversationOrchestrationState>(
    initialState || DEFAULT_ORCHESTRATION_STATE
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmExperimentalOpen, setConfirmExperimentalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Busca o estado atualizado do backend
  const fetchState = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await fetch(
        getApiUrl(`/api/autopilot/orchestration/state?conversationId=${encodeURIComponent(conversationId)}`)
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && data?.orchestration) {
        setState(data.orchestration);
        onStateChange?.(data.orchestration);
      }
    } catch (err) {
      console.warn("Erro ao buscar estado de orquestração:", err);
    }
  }, [conversationId, onStateChange]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Escuta broadcast realtime do Supabase para atualizar a UI instantaneamente
  useEffect(() => {
    if (typeof window === "undefined" || !conversationId) return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wsdualhvopidgqcumonr.supabase.co";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    if (!supabaseAnonKey) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const channel = supabase
      .channel(`orch_${conversationId}`)
      .on(
        "broadcast",
        { event: "orchestration_mode_changed" },
        (payload: { payload?: { conversationId?: string; orchestration?: ConversationOrchestrationState } }) => {
          if (payload?.payload?.conversationId === conversationId && payload?.payload?.orchestration) {
            setState(payload.payload.orchestration);
            onStateChange?.(payload.payload.orchestration);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, onStateChange]);

  // Fecha o popover ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Altera o modo com chamada à API
  const applyMode = async (mode: OrchestrationMode) => {
    setIsUpdating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(getApiUrl("/api/autopilot/orchestration/mode"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          mode,
          fallbackToLegacyOnError: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || "Falha ao atualizar modo de orquestração");
      }
      setState(data.orchestration);
      onStateChange?.(data.orchestration);
      setIsOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsUpdating(false);
    }
  };

  // Botão de Pânico: Reseta imediatamente para o modo legado
  const handleResetToLegacy = async () => {
    setIsUpdating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(getApiUrl("/api/autopilot/orchestration/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || "Falha ao resetar para legado");
      }
      setState(data.orchestration);
      onStateChange?.(data.orchestration);
      setIsOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao resetar");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSelectMode = (mode: OrchestrationMode) => {
    if (mode === state.mode) {
      setIsOpen(false);
      return;
    }
    if (mode === "experimental") {
      setConfirmExperimentalOpen(true);
      setIsOpen(false);
      return;
    }
    applyMode(mode);
  };

  const currentMode = state.mode || "legacy";

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Botão Badge Principal */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isUpdating}
        className={`px-2.5 py-1.5 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shrink-0 ${
          currentMode === "experimental"
            ? "bg-purple-500/15 text-purple-300 border-purple-500/40 hover:bg-purple-500/25 shadow-sm shadow-purple-500/10"
            : currentMode === "shadow"
            ? "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 shadow-sm shadow-amber-500/10"
            : "bg-[#1c1c1e] text-[#a8a8a8] border-[#2e2e30] hover:text-white hover:bg-[#2c2c2e]"
        }`}
        title={`Modo de Orquestração Atual: ${
          currentMode === "experimental"
            ? "Experimental (Novo Agente)"
            : currentMode === "shadow"
            ? "Shadow (Observação Silenciosa)"
            : "Legado (Piloto Tradicional)"
        }`}
      >
        {isUpdating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : currentMode === "experimental" ? (
          <FlaskConical className="w-3.5 h-3.5 text-purple-400" />
        ) : currentMode === "shadow" ? (
          <Eye className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <Shield className="w-3.5 h-3.5 text-zinc-400" />
        )}
        <span>
          {currentMode === "experimental"
            ? "Experimental"
            : currentMode === "shadow"
            ? "Shadow"
            : "Legado"}
        </span>
        <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
      </button>

      {/* Popover de Opções e Status */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-[#18181b] border border-[#2e2e30] rounded-2xl shadow-2xl p-4 z-50 text-left animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-[#27272a] mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-white tracking-wide uppercase">
                Orquestração IA
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {errorMsg && (
            <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Opções de Modo */}
          <div className="space-y-2 mb-4">
            {/* Modo Legado */}
            <button
              type="button"
              onClick={() => handleSelectMode("legacy")}
              disabled={isUpdating}
              className={`w-full p-2.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer text-left ${
                currentMode === "legacy"
                  ? "bg-zinc-800/80 border-zinc-500/50 text-white shadow-inner"
                  : "bg-[#1f1f23]/60 border-transparent hover:bg-zinc-800/40 text-zinc-300"
              }`}
            >
              <Shield className={`w-4 h-4 mt-0.5 shrink-0 ${currentMode === "legacy" ? "text-blue-400" : "text-zinc-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">1. Modo Legado</span>
                  {currentMode === "legacy" && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">
                  Fluxo padrão 100% preservado (Atria + Sol). Resposta automática segura e validada.
                </p>
              </div>
            </button>

            {/* Modo Shadow */}
            <button
              type="button"
              onClick={() => handleSelectMode("shadow")}
              disabled={isUpdating}
              className={`w-full p-2.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer text-left ${
                currentMode === "shadow"
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-inner"
                  : "bg-[#1f1f23]/60 border-transparent hover:bg-zinc-800/40 text-zinc-300"
              }`}
            >
              <Eye className={`w-4 h-4 mt-0.5 shrink-0 ${currentMode === "shadow" ? "text-amber-400" : "text-zinc-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">2. Modo Shadow</span>
                  {currentMode === "shadow" && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">
                  Novo agente analisa a mensagem em silêncio. NÃO envia mensagens nem executa ações externas.
                </p>
              </div>
            </button>

            {/* Modo Experimental */}
            <button
              type="button"
              onClick={() => handleSelectMode("experimental")}
              disabled={isUpdating}
              className={`w-full p-2.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer text-left ${
                currentMode === "experimental"
                  ? "bg-purple-500/15 border-purple-500/40 text-purple-200 shadow-inner"
                  : "bg-[#1f1f23]/60 border-transparent hover:bg-zinc-800/40 text-zinc-300"
              }`}
            >
              <FlaskConical className={`w-4 h-4 mt-0.5 shrink-0 ${currentMode === "experimental" ? "text-purple-400" : "text-zinc-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">3. Modo Experimental</span>
                  {currentMode === "experimental" && <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">
                  Novo agente assume as respostas deste chat com validação de fase (Conexão Inicial → Descoberta).
                </p>
              </div>
            </button>
          </div>

          {/* Card de Diagnóstico e Checkpoint */}
          <div className="p-2.5 rounded-xl bg-black/40 border border-[#27272a] space-y-1.5 text-[11px] text-zinc-300 mb-3">
            <div className="flex items-center justify-between text-zinc-400">
              <span>Fase ativa:</span>
              <span className="font-semibold text-white">
                {state.currentPhase === "conexao_inicial" ? "Conexão Inicial" : "Descoberta"}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-400">
              <span>Checkpoint:</span>
              <span className="font-mono text-[10px] text-purple-300 truncate max-w-[140px]" title={state.checkpoint}>
                {state.checkpoint || "nenhum"}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-400">
              <span>Último Status:</span>
              <span
                className={`font-semibold ${
                  state.lastProcessingStatus === "sent"
                    ? "text-emerald-400"
                    : state.lastProcessingStatus === "shadow_logged"
                    ? "text-amber-400"
                    : state.lastProcessingStatus === "failed"
                    ? "text-red-400"
                    : "text-zinc-400"
                }`}
              >
                {state.lastProcessingStatus || "idle"}
              </span>
            </div>
            {state.lastError && (
              <div className="pt-1 text-[10px] text-red-400 truncate" title={state.lastError}>
                ⚠️ Erro: {state.lastError}
              </div>
            )}
          </div>

          {/* Botão de Emergência: Pausar e Voltar ao Legado */}
          {currentMode !== "legacy" && (
            <button
              type="button"
              onClick={handleResetToLegacy}
              disabled={isUpdating}
              className="w-full py-2 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Pausar e Voltar ao Legado</span>
            </button>
          )}
        </div>
      )}

      {/* Modal de Confirmação para Ativação Experimental */}
      {confirmExperimentalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#18181b] border border-purple-500/30 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0">
                <FlaskConical className="w-5 h-5 text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white">
                  Ativar Modo Experimental nesta conversa?
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  O novo agente principal assumirá as decisões e o envio de mensagens para este contato específico.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2 text-xs text-zinc-300">
              <div className="flex items-center gap-2 text-amber-400 font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Garantias de Segurança:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-zinc-400">
                <li>Apenas esta conversa será afetada; todas as outras permanecem no fluxo legado.</li>
                <li>Validação estrita de fases no backend (Conexão Inicial → Descoberta).</li>
                <li>Em caso de qualquer erro ou divergência, o envio é abortado com fallback automático para o legado.</li>
                <li>Você pode pausar e retornar ao legado a qualquer momento em 1 clique.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmExperimentalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmExperimentalOpen(false);
                  applyMode("experimental");
                }}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-md shadow-purple-600/20"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Sim, Ativar Experimental</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
