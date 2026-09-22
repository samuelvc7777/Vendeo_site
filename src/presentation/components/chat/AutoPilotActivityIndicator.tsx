"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Clock3,
  Loader2,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Mic,
  MessageSquare,
  Bot,
  Zap,
  Pause,
  Edit3,
  Check,
  X,
  FastForward,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AutoPilotChatState } from "@/domain/entities/AutoPilot";

export type Variant = "banner" | "inbox" | "bubble" | "floating";

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

export function isAutoPilotWorking(state?: AutoPilotChatState | null): boolean {
  if (!state) return false;
  if (state.status === "paused_guardrail" || state.status === "paused_handoff") return true;

  // Proteção contra atividades que ficaram congeladas no visual se a rede ou worker oscilar
  if (state.activity) {
    const actUpdatedAt = state.activity.updatedAt || state.stateUpdatedAt;
    const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
    
    // Para fase de espera / agendamento de debounce:
    if (state.activity.phase === "waiting" || state.status === "waiting_delay") {
      const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
      // Só é zumbi se já passou do horário agendado há mais de 120s
      if (scheduledMs > 0 && Date.now() - scheduledMs > 120_000) {
        return false;
      }
    } else if (state.activity.phase === "completed") {
      // Fase completed NUNCA é zumbi! Representa o histórico preservado da última resposta enviada.
      // Continua disponível até a IA começar a responder outra mensagem.
    } else {
      // Fases ativas de geração (sol, atria, reanalyzing): se tiver mais de 90s sem atualização, é zumbi
      if (updatedAtMs > 0 && Date.now() - updatedAtMs > 90_000) {
        return false;
      }
      if ((state.activity.phase === "typing" || state.activity.phase === "sending") && updatedAtMs > 0 && Date.now() - updatedAtMs > 45_000) {
        return false;
      }
    }
  }

  // Se tem atividade em andamento ou pensamentos preservados, DEVE exibir o card!
  const hasActiveProgress = Boolean(
    state.activity ||
      state.lastThoughts ||
      state.status === "activation_wait" ||
      state.status === "waiting_delay" ||
      state.status === "waiting_debounce" ||
      state.status === "in_queue" ||
      state.status === "processing"
  );
  if (hasActiveProgress) return true;

  return Boolean(state.isEnabled);
}

export function isAutoPilotActivelyWorking(state?: AutoPilotChatState | null): boolean {
  if (!isAutoPilotWorking(state)) return false;
  if (state?.status === "paused_guardrail" || state?.status === "paused_handoff") return false;
  return (
    !["waiting", "completed", undefined].includes(state?.activity?.phase) &&
    state?.status !== "activation_wait" &&
    state?.status !== "waiting_delay" &&
    state?.status !== "waiting_debounce"
  );
}

function getCopy(state: AutoPilotChatState) {
  if (state.status === "paused_guardrail") {
    return {
      title: "IA pausada por erro",
      detail: state.pauseReason || "O provedor de IA não respondeu. Revise e retome o piloto.",
    };
  }
  if (state.status === "paused_handoff") {
    return {
      title: "IA pausada para intervenção",
      detail: state.pauseReason || "A conversa precisa de uma ação manual.",
    };
  }
  const actUpdatedAt = state.activity?.updatedAt || state.stateUpdatedAt;
  const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
  const isWaiting = state.activity?.phase === "waiting" || state.status === "waiting_delay";
  const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
  const isCompleted = state.activity?.phase === "completed";
  const isStale = isCompleted
    ? false
    : isWaiting
    ? (scheduledMs > 0 && Date.now() - scheduledMs > 120_000)
    : (updatedAtMs > 0 && Date.now() - updatedAtMs > 90_000);
  if (state.activity && !isStale) {
    return {
      title: state.activity.label,
      detail: state.activity.detail || "A IA está trabalhando nesta conversa.",
    };
  }
  if (state.status === "activation_wait") {
    return {
      title: "IA preparando o atendimento",
      detail: "Aguardando o período de segurança após a ativação.",
    };
  }
  if (state.status === "waiting_delay") {
    return {
      title: "IA aguardando tempo pra agir",
      detail: "Esperando o tempo configurado antes de analisar e responder.",
    };
  }
  if (state.status === "in_queue") {
    return {
      title: "IA na fila",
      detail: "Esta conversa será processada em seguida.",
    };
  }
  if (state.lastThoughts?.atriaThought || state.lastThoughts?.solThought) {
    return {
      title: "Última resposta enviada",
      detail: "Aguardando nova mensagem do cliente para iniciar novo raciocínio.",
    };
  }
  return {
    title: "Piloto Automático ativo",
    detail: "Aguardando nova mensagem do cliente para iniciar raciocínio.",
  };
}

function ActivityIcon({ state, className }: { state: AutoPilotChatState; className: string }) {
  if (state.status === "paused_guardrail" || state.status === "paused_handoff") {
    return <AlertTriangle className={className} />;
  }
  const phase = state.activity?.phase;
  if (phase === "completed") return <Check className={className} />;
  if (phase === "waiting" || !phase) return <Clock3 className={className} />;
  if (phase === "atria" || phase === "context") return <BrainCircuit className={`${className} animate-pulse`} />;
  if (phase === "sending") return <Send className={`${className} animate-pulse`} />;
  if (phase === "sol" || phase === "checklist") return <Sparkles className={`${className} animate-pulse`} />;
  return <Loader2 className={`${className} animate-spin`} />;
}

function TypingDots({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`${compact ? "h-1 w-1" : "h-1.5 w-1.5"} rounded-full bg-current animate-bounce`}
          style={{ animationDelay: `${index * 140}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}

function getValidThought(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (trimmed.length < 2) return null;
  if (/^[\s.·…\-–—_~*#]+$/.test(trimmed)) return null;

  // Se o pensamento contiver JSON cru ou chaves técnicas da persona/Atria
  if (trimmed.startsWith("{") || trimmed.includes('"analise_do_pretendente"') || trimmed.includes('"responses"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.reason === "string" && parsed.reason.trim()) {
        return parsed.reason.trim();
      }
      if (typeof parsed?.analise_do_pretendente === "string" && parsed.analise_do_pretendente.trim()) {
        return parsed.analise_do_pretendente.trim();
      }
    } catch {
      // Se não for JSON válido (ex: truncado), extrai o texto da análise via regex
      const analiseMatch = trimmed.match(/"analise_do_pretendente"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"responses|"|\n|$)/i);
      if (analiseMatch && analiseMatch[1]) {
        return analiseMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      }
      const reasonMatch = trimmed.match(/"reason"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+"|\s*})/i);
      if (reasonMatch && reasonMatch[1]) {
        return reasonMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      }
      trimmed = trimmed
        .replace(/"responses"\s*:\s*\[[\s\S]*/i, "")
        .replace(/^[{\s]*"?analise_do_pretendente"?\s*:\s*"?/i, "")
        .replace(/["\s,{}]+$/i, "")
        .trim();
    }
  }

  return trimmed || null;
}

export function AutoPilotActivityIndicator({
  state,
  variant,
  conversationId,
}: {
  state: AutoPilotChatState;
  variant: Variant;
  conversationId?: string;
}) {
  if (variant === "floating") {
    if (!state || !state.isEnabled) return null;
  } else {
    if (!isAutoPilotWorking(state)) return null;
  }
  const copy = getCopy(state);
  const activity = state.activity;
  const targetId = conversationId || state.conversationId;

  // Contagem regressiva suave para prévia e delay (recalcula com precisão mesmo em caso de F5/refresh)
  const calcInitialCountdown = () => {
    if (state.scheduledResponseAt && (state.status === "waiting_delay" || activity?.phase === "waiting")) {
      const diffSec = Math.round((Date.parse(state.scheduledResponseAt) - Date.now()) / 1000);
      return Math.max(0, diffSec);
    }
    return activity?.countdownSeconds ?? 0;
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number>(calcInitialCountdown);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedText, setEditedText] = useState<string>("");
  const [isPausing, setIsPausing] = useState<boolean>(false);
  const [isSendingNow, setIsSendingNow] = useState<boolean>(false);

  // Fases e Stepper Cognitivo
  const phase = activity?.phase;
  const isFailed = phase === "failed" || state.status === "failed";

  // Pensamentos limpos e estruturados (recupera da atividade atual ou do histórico persistido apenas se NÃO falhou)
  const rawAtria = activity?.atriaThought || (!isFailed ? state.lastThoughts?.atriaThought : undefined);
  const rawSol = activity?.solThought || (!isFailed ? state.lastThoughts?.solThought : undefined);
  const validAtriaThought = getValidThought(rawAtria);
  const validSolThought = getValidThought(rawSol);
  const hasThoughts = Boolean(validAtriaThought || validSolThought);
  const isCompleted = phase === "completed" || (!isAutoPilotActivelyWorking(state) && hasThoughts);
  const isAtriaActive = phase === "atria" || phase === "context" || (phase as string) === "search" || (phase as string) === "reanalyzing";
  const isAtriaDone = isCompleted || (!isAtriaActive && (Boolean(validAtriaThought) || phase === "sol" || phase === "typing" || phase === "sending" || phase === "checklist"));

  const isSolActive = phase === "sol";
  const isSolDone = isCompleted || (!isSolActive && (Boolean(validSolThought) || phase === "typing" || phase === "sending"));

  const isTypingOrSending = phase === "typing" || phase === "sending";
  const isSendingDone = isCompleted;
  const isWorking = isAutoPilotWorking(state);
  const isActivelyThinking = isAtriaActive || isSolActive || (phase as string) === "search";

  // Auto-scroll suave para seguir o streaming ao vivo
  const atriaThoughtRef = useRef<HTMLDivElement>(null);
  const solThoughtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAtriaActive && atriaThoughtRef.current) {
      atriaThoughtRef.current.scrollTop = atriaThoughtRef.current.scrollHeight;
    }
  }, [validAtriaThought, isAtriaActive]);

  useEffect(() => {
    if (isSolActive && solThoughtRef.current) {
      solThoughtRef.current.scrollTop = solThoughtRef.current.scrollHeight;
    }
  }, [validSolThought, isSolActive]);

  // Reatividade estilo Antigravity: aberto por padrão durante atividade de raciocínio
  const [isThinkingExpanded, setIsThinkingExpanded] = useState<boolean>(true);
  const lastPhaseRef = useRef<string | undefined>(activity?.phase);
  const lastThoughtsRef = useRef<string>("");

  useEffect(() => {
    // Quando uma nova fase ativa começar ou novos pensamentos chegarem, auto-expande reativamente
    const currentPhase = activity?.phase;
    const thoughtsKey = `${validAtriaThought || ""}_${validSolThought || ""}`;

    if (
      (currentPhase && currentPhase !== lastPhaseRef.current && ["atria", "sol", "search", "typing"].includes(currentPhase)) ||
      (thoughtsKey && thoughtsKey !== lastThoughtsRef.current)
    ) {
      lastPhaseRef.current = currentPhase;
      lastThoughtsRef.current = thoughtsKey;
      setIsThinkingExpanded(true);
    }
  }, [activity?.phase, validAtriaThought, validSolThought]);

  useEffect(() => {
    setRemainingSeconds(calcInitialCountdown());
  }, [activity?.countdownSeconds, activity?.currentBalloon, state.scheduledResponseAt]);

  useEffect(() => {
    if (remainingSeconds <= 0 || isEditing) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSeconds, isEditing]);

  const currentPreview = activity?.currentResponsePreview;

  useEffect(() => {
    if (currentPreview && !isEditing) {
      setEditedText(currentPreview);
    }
  }, [currentPreview, isEditing]);

  // Ações de intervenção do operador
  const handleStartEdit = async () => {
    setIsEditing(true);
    if (!targetId) return;
    try {
      await fetch(getApiUrl("/api/autopilot/hold-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, isEditing: true }),
      });
    } catch (err) {
      console.warn("Aviso ao pausar contagem para edição:", err);
    }
  };

  const handleCancelEdit = async () => {
    setIsEditing(false);
    if (currentPreview) {
      setEditedText(currentPreview);
    }
    if (!targetId) return;
    try {
      await fetch(getApiUrl("/api/autopilot/hold-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, isEditing: false }),
      });
    } catch (err) {
      console.warn("Aviso ao cancelar edição:", err);
    }
  };

  const handlePause = async () => {
    if (!targetId || isPausing) return;
    setIsPausing(true);
    try {
      const res = await fetch(getApiUrl("/api/autopilot/pause"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId }),
      });
      if (res.ok) {
        toast.success("Piloto Automático pausado.");
      } else {
        toast.error("Erro ao pausar piloto.");
      }
    } catch {
      toast.error("Erro de conexão ao pausar.");
    } finally {
      setIsPausing(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!targetId || !editedText.trim()) return;
    try {
      const res = await fetch(getApiUrl("/api/autopilot/edit-preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, editedText: editedText.trim() }),
      });
      if (res.ok) {
        toast.success("Texto atualizado! A contagem foi retomada para o envio.");
        setIsEditing(false);
      } else {
        toast.error("Erro ao salvar edição.");
      }
    } catch {
      toast.error("Erro de conexão ao editar.");
    }
  };

  const handleSendNow = async () => {
    if (!targetId || isSendingNow) return;
    setIsSendingNow(true);
    try {
      const res = await fetch(getApiUrl("/api/autopilot/send-now"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId }),
      });
      if (res.ok) {
        toast.success("Disparo adiantado!");
      }
    } catch {
      toast.error("Erro ao adiantar envio.");
    } finally {
      setIsSendingNow(false);
    }
  };

  // VARIANTE INBOX (Lista de conversas - limpa e elegante)
  if (variant === "inbox") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
        <ActivityIcon state={state} className="h-3 w-3 shrink-0" />
        <span className="truncate">{copy.title}</span>
        <TypingDots compact />
      </span>
    );
  }

  // VARIANTE BANNER (Topo estático opcional)
  if (variant === "banner") {
    return (
      <div className="mx-1 mb-2 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-cyan-950/30 to-slate-900/50 p-2.5 text-emerald-100 shadow-md backdrop-blur-md transition-all duration-300">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15">
              <ActivityIcon state={state} className="h-4 w-4 text-emerald-400" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-200">
                <span>{copy.title}</span>
                <TypingDots compact />
              </div>
              <p className="truncate text-[10px] text-zinc-400">{copy.detail}</p>
            </div>
          </div>

          {(hasThoughts || isActivelyThinking) && (
            <button
              type="button"
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all cursor-pointer shrink-0"
              title="Alternar visão de pensamento da IA"
            >
              <BrainCircuit className="h-3 w-3 text-cyan-400" />
              <span className="hidden sm:inline">Raciocínio</span>
              {isThinkingExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
    );
  }

  // VARIANTE FLOATING (Cápsula Flutuante sobre o Chat - Estilo Antigravity Reativo)
  const isAudioPreview = currentPreview?.startsWith("[audio:");
  const shouldShowReasoningSection = Boolean(hasThoughts || isAtriaActive || isSolActive || validAtriaThought || validSolThought);

  return (
    <div className="w-full select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="rounded-2xl border border-zinc-800/90 bg-[#0d0d11]/95 shadow-2xl shadow-black/90 backdrop-blur-2xl p-3 text-zinc-100 transition-all duration-300">
        
        {/* Cabeçalho do HUD Flutuante */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                isAtriaActive
                  ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-sm shadow-cyan-500/20"
                  : isSolActive
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm shadow-amber-500/20"
                  : isTypingOrSending
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/20"
                  : isCompleted
                  ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                  : "bg-zinc-800/80 border-zinc-700 text-zinc-400"
              )}
            >
              <ActivityIcon state={state} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-100 truncate">
                  {copy.title}
                </span>
                {!isCompleted && isWorking && <TypingDots compact />}
              </div>
              <p className="text-[10px] text-zinc-400 truncate">
                {copy.detail}
              </p>
            </div>
          </div>

          {/* Badges de Contagem & Controles Rápidos */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isEditing ? (
              <span className="font-mono text-[10px] font-bold text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-500/40 animate-pulse flex items-center gap-1">
                <Pause className="h-2.5 w-2.5" />
                <span>Pausado p/ edição</span>
              </span>
            ) : remainingSeconds > 0 && (
              <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/40 animate-pulse">
                {remainingSeconds >= 60
                  ? `${Math.floor(remainingSeconds / 60)}m ${String(remainingSeconds % 60).padStart(2, "0")}s`
                  : `${remainingSeconds}s`}
              </span>
            )}

            {/* Botão Responder Já (quando aguardando debounce de tempo) */}
            {(state.status === "waiting_delay" || activity?.phase === "waiting") && (
              <button
                type="button"
                onClick={handleSendNow}
                disabled={isSendingNow}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Ignorar o tempo de espera e responder agora"
              >
                <FastForward className="h-3 w-3" />
                <span className="hidden sm:inline">Responder Já</span>
              </button>
            )}

            {/* Botão Pausar (ativo quando em processamento) */}
            {isWorking && (
              <button
                type="button"
                onClick={handlePause}
                disabled={isPausing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Pausar o envio da IA agora"
              >
                <Pause className="h-3 w-3" />
                <span className="hidden sm:inline">Pausar</span>
              </button>
            )}

            {/* Botão Alternar Raciocínio (Estilo Antigravity) */}
            {shouldShowReasoningSection && (
              <button
                type="button"
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold active:scale-95 transition-all cursor-pointer border",
                  isThinkingExpanded
                    ? "bg-zinc-800/80 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                    : "bg-cyan-500/15 text-cyan-300 border-cyan-500/35 hover:bg-cyan-500/25"
                )}
                title="Alternar visão de raciocínio da Atria e do Sol"
              >
                <BrainCircuit className="h-3 w-3 text-cyan-400" />
                <span>{isThinkingExpanded ? "Recolher" : "Raciocínio"}</span>
                {isThinkingExpanded ? (
                  <ChevronUp className="h-2.5 w-2.5 ml-0.5" />
                ) : (
                  <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Stepper Cognitivo dos Agentes - Estilo Antigravity */}
        {isWorking && (
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/50 rounded-xl border border-zinc-800/70 mt-2.5 text-[10px]">
            {/* Etapa 1: Atria */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isAtriaActive
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/50 font-bold animate-pulse"
                  : isAtriaDone
                  ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
                  : "text-zinc-500"
              )}
            >
              <BrainCircuit className="h-3 w-3 shrink-0" />
              <span className="truncate">1. Atria</span>
              {isAtriaDone && !isAtriaActive && (
                <Check className="h-2.5 w-2.5 text-cyan-400 shrink-0 ml-0.5" />
              )}
            </div>

            {/* Etapa 2: Sol */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isSolActive
                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/50 font-bold animate-pulse"
                  : isSolDone
                  ? "bg-amber-500/10 text-amber-300 border border-amber-500/25"
                  : "text-zinc-500"
              )}
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="truncate">2. Sol</span>
              {isSolDone && !isSolActive && (
                <Check className="h-2.5 w-2.5 text-amber-400 shrink-0 ml-0.5" />
              )}
            </div>

            {/* Etapa 3: Envio */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isTypingOrSending
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/50 font-bold animate-pulse"
                  : isSendingDone
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                  : "text-zinc-500"
              )}
            >
              <Send className="h-3 w-3 shrink-0" />
              <span className="truncate">3. Envio</span>
              {isSendingDone && !isTypingOrSending && (
                <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0 ml-0.5" />
              )}
            </div>
          </div>
        )}

        {/* Prévia da Mensagem e Cadência de Digitação */}
        {isTypingOrSending && currentPreview && (
          <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80">
            <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px] font-semibold text-zinc-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <MessageSquare className="h-3 w-3" />
                <span>
                  {activity?.totalBalloons && activity.totalBalloons > 1
                    ? `Balão ${activity.currentBalloon || 1} de ${activity.totalBalloons}:`
                    : "Mensagem pronta para envio:"}
                </span>
              </span>

              {!isAudioPreview && !isEditing && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 active:scale-95 cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 transition-all"
                  >
                    <Edit3 className="h-2.5 w-2.5" />
                    <span>Editar</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendNow}
                    disabled={isSendingNow}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 active:scale-95 cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 transition-all"
                  >
                    <FastForward className="h-2.5 w-2.5" />
                    <span>Enviar Já</span>
                  </button>
                </div>
              )}
            </div>

            {isAudioPreview ? (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-emerald-500/30 text-emerald-300 text-xs">
                <Mic className="h-4 w-4 animate-pulse text-emerald-400" />
                <span className="font-semibold text-[11px]">
                  Áudio gravado da Larissa sendo enviado...
                </span>
              </div>
            ) : isEditing ? (
              <div className="space-y-2 animate-in fade-in duration-150">
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full rounded-xl bg-black border border-cyan-500/50 p-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none min-h-[55px]"
                  placeholder="Edite a resposta aqui antes do envio..."
                  rows={2}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-[10px] hover:bg-zinc-700 active:scale-95 cursor-pointer flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    <span>Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] active:scale-95 cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <Check className="h-3 w-3" />
                    <span>Salvar Edição</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800/90 text-xs text-zinc-200 leading-relaxed font-normal whitespace-pre-wrap select-text">
                {currentPreview}
              </div>
            )}
          </div>
        )}

        {/* Pensamentos Reativos da Atria e do Sol (Estilo Antigravity) */}
        {shouldShowReasoningSection && isThinkingExpanded && (
          <div className="mt-2.5 space-y-2 border-t border-zinc-800/80 pt-2.5 text-xs animate-in fade-in duration-200">
            
            {/* Bloco Atria (Estrategista) */}
            {(isAtriaActive || validAtriaThought) && (
              <div
                className={cn(
                  "rounded-xl border p-2.5 transition-all duration-200",
                  isAtriaActive
                    ? "border-cyan-500/40 bg-cyan-950/20 shadow-inner"
                    : "border-cyan-500/25 bg-cyan-950/15"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-cyan-300 text-[10px] uppercase tracking-wider">
                    <Bot className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Atria • Estrategista</span>
                  </div>
                  {isAtriaActive ? (
                    <span className="text-[9px] font-semibold text-cyan-300 bg-cyan-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {validAtriaThought ? "Analisando ao vivo..." : "Analisando..."}
                    </span>
                  ) : isFailed && validAtriaThought ? (
                    <span className="text-[9px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <X className="h-2.5 w-2.5 text-rose-400" />
                      Rascunho descartado
                    </span>
                  ) : validAtriaThought ? (
                    <span className="text-[9px] font-medium text-cyan-400/90 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Check className="h-2.5 w-2.5 text-cyan-400" />
                      Estratégia traçada
                    </span>
                  ) : null}
                </div>

                {validAtriaThought ? (
                  <div
                    ref={atriaThoughtRef}
                    className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto pr-1 select-text scrollbar-thin scrollbar-thumb-zinc-700"
                  >
                    {validAtriaThought}
                    {isAtriaActive && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-cyan-400 animate-pulse align-middle rounded-sm" />
                    )}
                  </div>
                ) : isAtriaActive ? (
                  <p className="text-[11px] leading-relaxed text-cyan-200/80 italic">
                    {phase === "search" ? (
                      <span className="flex items-center gap-1 text-cyan-300">
                        <Search className="h-3 w-3 animate-spin" />
                        Pesquisando informações na web sobre termos citados pelo pretendente...
                      </span>
                    ) : (
                      "Analisando histórico, contexto do pretendente e definindo diretrizes..."
                    )}
                  </p>
                ) : null}
              </div>
            )}

            {/* Bloco Sol (Voz da Larissa) */}
            {(isSolActive || validSolThought) && (
              <div
                className={cn(
                  "rounded-xl border p-2.5 transition-all duration-200",
                  isSolActive
                    ? "border-amber-500/40 bg-amber-950/20 shadow-inner"
                    : "border-amber-500/25 bg-amber-950/15"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300 text-[10px] uppercase tracking-wider">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>Sol • Voz da Larissa</span>
                  </div>
                  {isSolActive ? (
                    <span className="text-[9px] font-semibold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {validSolThought ? "Redigindo ao vivo..." : "Redigindo..."}
                    </span>
                  ) : isFailed && validSolThought ? (
                    <span className="text-[9px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <X className="h-2.5 w-2.5 text-rose-400" />
                      Rascunho descartado
                    </span>
                  ) : validSolThought ? (
                    <span className="text-[9px] font-medium text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Check className="h-2.5 w-2.5 text-amber-400" />
                      Persona calibrada
                    </span>
                  ) : null}
                </div>

                {validSolThought ? (
                  <div
                    ref={solThoughtRef}
                    className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto pr-1 select-text scrollbar-thin scrollbar-thumb-zinc-700"
                  >
                    {validSolThought}
                    {isSolActive && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-amber-400 animate-pulse align-middle rounded-sm" />
                    )}
                  </div>
                ) : isSolActive ? (
                  <p className="text-[11px] leading-relaxed text-amber-200/80 italic">
                    Incorporando o estilo e o vocabulário da Larissa, calibrando gírias e respostas humanas...
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
