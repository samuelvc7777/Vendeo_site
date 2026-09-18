"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Sparkles,
  Trophy,
  ArrowRight,
  Target,
  Check,
} from "lucide-react";
import { ChatStageDetail, StageObjectiveItem } from "@/application/use-cases/ManageChatProgressUseCase";
import { StageChecklistItem } from "@/domain/entities/ChatStage";

interface ChatStageBarProps {
  detail: ChatStageDetail | null;
  onToggleItem?: (itemId: string, isCompleted: boolean) => void;
  onToggleObjective?: (objectiveId: string, isCompleted: boolean) => void;
  onAdvanceStage: () => void;
  onSetStage: (stageId: string) => void;
  onToggleConverted: (isConverted: boolean) => void;
  onQuickSendItem?: (item: StageChecklistItem) => void;
}

export function ChatStageBar({
  detail,
  onToggleItem,
  onToggleObjective,
  onAdvanceStage,
  onSetStage,
  onToggleConverted,
}: ChatStageBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSelectingStage, setIsSelectingStage] = useState(false);

  if (!detail || !detail.stage) {
    return null;
  }

  const {
    stage,
    stageIndex,
    totalStages,
    isLastStage,
    objectives = [],
    totalObjectives = 0,
    completedObjectivesCount = 0,
    requiredPendingCount = 0,
    is100Percent,
    isConverted,
    allStages,
  } = detail;

  const percentage =
    totalObjectives > 0
      ? Math.round((completedObjectivesCount / totalObjectives) * 100)
      : 0;
  const stageColor = stage.color || "#3b82f6";

  const handleToggle = (obj: StageObjectiveItem) => {
    const isComp = obj.status === "completed";
    if (onToggleObjective) {
      onToggleObjective(obj.id, !isComp);
    } else if (onToggleItem) {
      // Fallback compatível
      onToggleItem(obj.id, !isComp);
    }
  };

  return (
    <div className="w-full bg-[#121214] border-b border-[#262626] transition-all duration-200 z-20 shrink-0">
      {/* Barra Compacta (Sempre Visível) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3.5 py-2 flex items-center justify-between cursor-pointer active:bg-[#1c1c1f] transition-colors select-none"
      >
        {/* Lado Esquerdo: Etapa & Nome */}
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
            style={{ backgroundColor: stageColor }}
          />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 shrink-0">
            Etapa {stageIndex + 1}/{totalStages}
          </span>
          <span className="text-xs font-semibold text-white truncate max-w-[130px] sm:max-w-[200px]">
            {stage.name}
          </span>
          {isConverted && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30 flex items-center gap-1">
              <Trophy className="w-2.5 h-2.5" />
              Finalizado
            </span>
          )}
        </div>

        {/* Lado Direito: Progresso dos Objetivos & Botão de Expansão */}
        <div className="flex items-center gap-2 shrink-0">
          {is100Percent ? (
            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
              <CheckCircle2 className="w-3 h-3" />
              100%
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="w-12 sm:w-16 h-1.5 bg-[#262626] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: stageColor,
                  }}
                />
              </div>
              <span className="text-[11px] font-medium text-zinc-400">
                {completedObjectivesCount}/{totalObjectives}
              </span>
            </div>
          )}

          <button
            type="button"
            className="p-1 text-zinc-400 hover:text-white rounded-md active:bg-white/10"
            aria-label={isExpanded ? "Recolher objetivos" : "Expandir objetivos"}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Visão Expandida com os Objetivos da Etapa (Sem arquivos do Cofre) */}
      {isExpanded && (
        <div className="px-3.5 pt-1 pb-3 space-y-2.5 border-t border-[#1c1c1f] bg-[#0d0d0f]/95 animate-fade-in">
          {/* Cabeçalho da Visão Expandida */}
          <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
            <span className="font-medium flex items-center gap-1.5 text-zinc-200">
              <Target className="w-3.5 h-3.5 text-sky-400" />
              Objetivos da Etapa ({completedObjectivesCount}/{totalObjectives})
              {requiredPendingCount > 0 && (
                <span className="text-[10px] text-amber-400 font-semibold ml-1">
                  • {requiredPendingCount} obrigatório{requiredPendingCount > 1 ? "s" : ""}
                </span>
              )}
            </span>

            {/* Alternador manual de etapa */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSelectingStage(!isSelectingStage);
              }}
              className="text-[11px] text-sky-400 hover:underline active:text-sky-300"
            >
              {isSelectingStage ? "Cancelar" : "Mudar etapa"}
            </button>
          </div>

          {/* Menu de seleção manual de etapa */}
          {isSelectingStage && (
            <div className="p-2 rounded-lg bg-[#18181b] border border-[#27272a] space-y-1 my-1">
              <p className="text-[10px] uppercase font-bold text-zinc-400 px-1 mb-1">
                Trocar etapa manualmente:
              </p>
              <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto">
                {allStages.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onSetStage(s.id);
                      setIsSelectingStage(false);
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-left transition-colors ${
                      s.id === stage.id
                        ? "bg-white/10 text-white font-semibold"
                        : "text-zinc-300 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: s.color || "#3b82f6" }}
                      />
                      Etapa {idx + 1}: {s.name}
                    </span>
                    {s.id === stage.id && <Check className="w-3 h-3 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lista de Objetivos da Etapa */}
          {objectives.length === 0 ? (
            <div className="py-2.5 px-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-center text-xs text-zinc-400">
              Nenhum objetivo cadastrado nesta etapa. Configure objetivos em Configurações &gt; Etapas do Chat.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {objectives.map((obj) => {
                const isCompleted = obj.status === "completed";

                return (
                  <div
                    key={obj.id}
                    className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                      isCompleted
                        ? "bg-emerald-950/20 border-emerald-900/40 text-zinc-300"
                        : "bg-zinc-900/80 border-zinc-800/80 text-white hover:border-zinc-700"
                    }`}
                  >
                    {/* Checkbox + Rótulo + Valor Conhecido */}
                    <div
                      onClick={() => handleToggle(obj)}
                      className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer select-none"
                    >
                      <button
                        type="button"
                        className="shrink-0 mt-0.5 text-zinc-400 hover:text-white"
                        aria-label={isCompleted ? "Reabrir objetivo" : "Marcar objetivo como concluído"}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 fill-emerald-400/20" />
                        ) : (
                          <Circle className="w-4 h-4 text-zinc-500" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p
                            className={`text-xs font-semibold truncate ${
                              isCompleted ? "line-through text-zinc-400" : "text-zinc-100"
                            }`}
                          >
                            {obj.title}
                          </p>
                          {obj.required ? (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 text-[10px] font-bold border border-amber-500/20">
                              Obrigatório
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 text-[10px] font-medium">
                              Opcional
                            </span>
                          )}
                        </div>

                        {/* Valor descoberto pela memória */}
                        {obj.value !== null && obj.value !== undefined && (
                          <p className="text-[11px] font-medium text-emerald-400 mt-0.5 flex items-center gap-1">
                            <span>✓</span>
                            <span>{String(obj.value)}</span>
                          </p>
                        )}

                        {/* Descrição orientativa sutil */}
                        {obj.description && !obj.value && (
                          <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                            {obj.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Barra de Ações: Avançar de Etapa ou Finalizar Objetivo */}
          <div className="pt-1.5 flex items-center justify-between gap-2">
            {/* Toggle de Conversão/Finalizado */}
            <button
              type="button"
              onClick={() => onToggleConverted(!isConverted)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border ${
                isConverted
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>{isConverted ? "Finalizado" : "Marcar como Finalizado"}</span>
            </button>

            {/* Botão de Avanço de Etapa */}
            {isLastStage ? (
              <button
                type="button"
                onClick={() => onToggleConverted(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  is100Percent
                    ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-black shadow-lg shadow-amber-500/20 active:scale-95"
                    : "bg-zinc-800 text-zinc-400 opacity-80"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Finalizar Objetivo Final</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onAdvanceStage}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  is100Percent
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20 active:scale-95 animate-bounce"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:scale-95"
                }`}
              >
                <span>Avançar para Etapa {stageIndex + 2}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

