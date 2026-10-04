"use client";

import React from "react";
import {
  X,
  Check,
  Clock,
  History,
  RotateCcw,
  SlidersHorizontal,
  Camera,
  Flame,
} from "lucide-react";
import type { TinderFilter } from "@/domain/entities/Tinder";

export type SortOrder = "recentes" | "antigas";
export type InstagramFilter = "todos" | "respondidos" | "nao_respondidos" | "pedidos";

interface ChatFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  instaFilter: InstagramFilter;
  onInstaFilterChange: (filter: InstagramFilter) => void;
  isTinder?: boolean;
  tinderFilter?: TinderFilter;
  onTinderFilterChange?: (filter: TinderFilter) => void;
  onReset: () => void;
}

export function ChatFilterModal({
  isOpen,
  onClose,
  sortOrder,
  onSortOrderChange,
  instaFilter,
  onInstaFilterChange,
  isTinder = false,
  tinderFilter = "todos",
  onTinderFilterChange,
  onReset,
}: ChatFilterModalProps) {
  if (!isOpen) return null;

  const activeBgBorder =
    "bg-zinc-900 border-zinc-900 dark:bg-white/15 dark:border-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md bg-white dark:bg-[#121212] border border-zinc-200 dark:border-[#262626] rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-[#262626] flex items-center justify-between bg-white dark:bg-[#161616]">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md ${
                isTinder
                  ? "bg-gradient-to-tr from-[#fd5068] to-[#ff6036]"
                  : "bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888]"
              }`}
            >
              {isTinder ? (
                <Flame className="w-4 h-4 text-white fill-white" />
              ) : (
                <SlidersHorizontal className="w-4 h-4 text-white stroke-[2.2]" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-950 dark:text-white tracking-tight flex items-center gap-2">
                Filtros e Ordenação
                {isTinder ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 bg-[#fd5068]/10 border-[#fd5068]/30 text-[#fd5068]">
                    <Flame className="w-2.5 h-2.5 fill-current" />
                    Tinder
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 bg-[#bc1888]/10 border-[#bc1888]/30 text-[#e6683c]">
                    <Camera className="w-2.5 h-2.5" />
                    Instagram
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-zinc-600 dark:text-[#a8a8a8]">
                {isTinder
                  ? "Personalize a ordem e os filtros dos matches"
                  : "Personalize a ordem e os filtros das conversas"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-[#262626] transition-colors cursor-pointer"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <div className="space-y-2.5">
            <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-500 dark:text-[#8e8e8e] px-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Ordem das mensagens
            </label>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => onSortOrderChange("recentes")}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer active:scale-[0.99] ${
                  sortOrder === "recentes"
                    ? `${activeBgBorder} text-white font-semibold`
                    : "bg-zinc-100 dark:bg-[#1c1c1e] border-zinc-200 dark:border-[#262626] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:border-[#333]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    sortOrder === "recentes"
                      ? "bg-white/15 text-white"
                      : "bg-zinc-100 dark:bg-[#262626] text-zinc-500 dark:text-[#8e8e8e]"
                  }`}>
                    <Clock className="w-4 h-4 stroke-[2]" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-950 dark:text-white">Mais recentes primeiro</h4>
                    <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e]">Conversas e respostas novas no topo</p>
                  </div>
                </div>
                {sortOrder === "recentes" && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center bg-white text-black">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => onSortOrderChange("antigas")}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer active:scale-[0.99] ${
                  sortOrder === "antigas"
                    ? `${activeBgBorder} text-white font-semibold`
                    : "bg-zinc-100 dark:bg-[#1c1c1e] border-zinc-200 dark:border-[#262626] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:border-[#333]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    sortOrder === "antigas"
                      ? "bg-white/15 text-white"
                      : "bg-zinc-100 dark:bg-[#262626] text-zinc-500 dark:text-[#8e8e8e]"
                  }`}>
                    <History className="w-4 h-4 stroke-[2]" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-950 dark:text-white">Mais antigas primeiro</h4>
                    <p className="text-[11px] text-zinc-500 dark:text-[#8e8e8e]">Prioriza contatos que aguardam há mais tempo</p>
                  </div>
                </div>
                {sortOrder === "antigas" && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center bg-white text-black">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-[#262626]">
            <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-500 dark:text-[#8e8e8e] px-0.5 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filtrar por status
            </label>

            <div className="grid grid-cols-1 gap-1.5">
              {isTinder
                ? [
                    { id: "todos", label: "Todos os Matches", desc: "Exibe todos os matches ativos da caixa de entrada" },
                    { id: "novos", label: "Novos Matches", desc: "Matches recentes sem mensagens trocadas ainda" },
                    { id: "sua_vez", label: "Sua Vez de Responder", desc: "Matches aguardando sua resposta" },
                    { id: "vez_deles", label: "Vez Deles Responderem", desc: "Você enviou a última mensagem" },
                    { id: "restritos", label: "Restritos / Pausados", desc: "Matches com automação pausada ou restritos" },
                  ].map((item) => {
                    const selected = tinderFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onTinderFilterChange?.(item.id as TinderFilter)}
                        className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          selected
                            ? "bg-zinc-900 border-zinc-900 text-white dark:bg-white/15 dark:border-white/40 font-semibold"
                            : "bg-zinc-100 dark:bg-[#1c1c1e] border-zinc-200 dark:border-[#262626] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white"
                        }`}
                      >
                        <div>
                          <span className="text-xs font-semibold text-zinc-950 dark:text-white">{item.label}</span>
                          <p className="text-[10px] text-zinc-500 dark:text-[#8e8e8e]">{item.desc}</p>
                        </div>
                        {selected && (
                          <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })
                : [
                    { id: "todos", label: "Todas as conversas", desc: "Exibe todas as conversas ativas da caixa de entrada" },
                    { id: "nao_respondidos", label: "Não respondidas", desc: "Aguardando sua resposta ou novas" },
                    { id: "respondidos", label: "Respondidas", desc: "Conversas em que você já enviou mensagem" },
                    { id: "pedidos", label: "Pedidos e Restringidos", desc: "Pedidos de novas mensagens e contas restringidas" },
                  ].map((item) => {
                    const selected = instaFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onInstaFilterChange(item.id as InstagramFilter)}
                        className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          selected
                            ? "bg-zinc-900 border-zinc-900 text-white dark:bg-white/15 dark:border-white/40 font-semibold"
                            : "bg-zinc-100 dark:bg-[#1c1c1e] border-zinc-200 dark:border-[#262626] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white"
                        }`}
                      >
                        <div>
                          <span className="text-xs font-semibold text-zinc-950 dark:text-white">{item.label}</span>
                          <p className="text-[10px] text-zinc-500 dark:text-[#8e8e8e]">{item.desc}</p>
                        </div>
                        {selected && (
                          <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#161616] flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="py-2.5 px-3.5 rounded-xl bg-zinc-100 dark:bg-[#262626] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}
