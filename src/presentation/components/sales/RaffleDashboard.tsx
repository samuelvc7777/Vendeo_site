"use client";

import React from "react";
import {
  Raffle,
  RaffleStats,
} from "@/domain/entities/Raffle";
import {
  Plus,
  Users,
  Calendar,
  Sparkles,
  Pencil,
  Trash2,
  ChevronDown,
  Flame,
  CheckCircle2,
  Clock,
  CircleDot,
} from "lucide-react";

interface RaffleDashboardProps {
  raffles: Raffle[];
  activeRaffle: Raffle | null;
  stats: RaffleStats;
  onSelectRaffle: (id: string) => void;
  onOpenCreateModal: () => void;
  onOpenEditModal: () => void;
  onOpenBuyersModal: () => void;
  onDeleteRaffle: () => void;
}

export function RaffleDashboard({
  raffles,
  activeRaffle,
  stats,
  onSelectRaffle,
  onOpenCreateModal,
  onOpenEditModal,
  onOpenBuyersModal,
  onDeleteRaffle,
}: RaffleDashboardProps) {
  if (!activeRaffle) return null;

  const formatDate = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="bg-zinc-50 dark:bg-[#0c0c0e] border-b border-zinc-200 dark:border-[#222225] p-3 sm:p-4 space-y-3">
      {/* Linha 1: Seletor de Rifa + Botões de Ação com Touch Targets >= 44px */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Seletor de Rifa */}
        <div className="flex-1 min-w-0">
          <div className="relative w-full sm:max-w-xs">
            <select
              value={activeRaffle.id}
              onChange={(e) => onSelectRaffle(e.target.value)}
              aria-label="Selecionar rifa ativa"
              className="w-full min-h-[44px] appearance-none bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#2b2b2e] rounded-xl px-3.5 pr-10 text-xs sm:text-sm font-bold text-zinc-950 dark:text-white truncate focus:outline-none focus:border-[#0095f6] cursor-pointer shadow-sm"
            >
              {raffles.map((r) => (
                <option key={r.id} value={r.id} className="bg-white dark:bg-[#18181b] text-zinc-950 dark:text-white">
                  {r.title} ({r.totalNumbers} cotas)
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Botões de Ação (área de toque confortável no mobile) */}
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={onOpenEditModal}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#2b2b2e] text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:border-zinc-400 dark:hover:border-[#3a3a3d] active:scale-95 transition-all cursor-pointer shadow-sm"
            title="Editar rifa"
            aria-label="Editar rifa"
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onDeleteRaffle}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#2b2b2e] text-zinc-500 dark:text-[#737373] hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 active:scale-90 transition-all cursor-pointer shadow-sm"
            title="Excluir rifa"
            aria-label="Excluir rifa"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenBuyersModal}
            className="min-h-[44px] px-3 flex items-center gap-1.5 rounded-xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#2b2b2e] text-xs font-semibold text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:border-zinc-400 dark:hover:border-[#3a3a3d] active:scale-95 transition-all cursor-pointer shadow-sm"
            title="Ver compradores da rifa"
            aria-label="Ver compradores da rifa"
          >
            <Users className="w-4 h-4 text-[#0095f6]" />
            <span className="hidden xs:inline">Compradores</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateModal}
            className="min-h-[44px] px-3.5 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black text-xs font-bold shadow-md shadow-amber-500/15 active:scale-95 transition-all cursor-pointer"
            aria-label="Criar nova rifa"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Nova Rifa</span>
          </button>
        </div>
      </div>

      {/* Linha 2: Card Resumo da Rifa (Título, Preço e Progresso) */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#222225] space-y-2.5 shadow-sm">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400 font-bold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Rifa Oficial
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase ${
                  activeRaffle.status === "active"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                    : activeRaffle.status === "paused"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30"
                }`}
              >
                {activeRaffle.status === "active"
                  ? "Ativa"
                  : activeRaffle.status === "paused"
                  ? "Pausada"
                  : "Sorteada"}
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-black text-zinc-950 dark:text-white truncate">
              {activeRaffle.title}
            </h2>
            {activeRaffle.description && (
              <p className="text-[11px] text-zinc-500 dark:text-[#737373] line-clamp-1 mt-0.5">
                {activeRaffle.description}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <span className="text-[11px] text-zinc-500 dark:text-[#737373] block leading-none">
              Valor da Cota
            </span>
            <span className="text-base sm:text-lg font-black text-amber-500 dark:text-amber-400 mt-1 block">
              {activeRaffle.pricePerNumber.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>
        </div>

        {/* Barra de Progresso e Percentual */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-600 dark:text-[#a8a8a8] font-medium flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 fill-amber-500/30" />
              Progresso de Vendas
            </span>
            <span className="font-bold text-zinc-950 dark:text-white">
              {stats.paid} de {stats.total} cotas (
              <span className="text-emerald-500 dark:text-emerald-400">{stats.percentSold}%</span>)
            </span>
          </div>

          <div className="w-full bg-zinc-100 dark:bg-[#1c1c1e] h-2.5 rounded-full overflow-hidden border border-zinc-200 dark:border-[#2b2b2e]">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, stats.percentSold))}%` }}
            />
          </div>
        </div>

        {/* Datas */}
        <div className="flex items-center justify-between pt-1.5 border-t border-zinc-100 dark:border-[#1e1e22] text-[10px] text-zinc-500 dark:text-[#737373]">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Início: {formatDate(activeRaffle.startDate)}
          </span>
          <span>Término: {formatDate(activeRaffle.endDate)}</span>
        </div>
      </div>

      {/* Linha 3: Métricas (2 colunas no mobile, 4 colunas no desktop para evitar textos comprimidos) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
        {/* Total Arrecadado */}
        <div className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#222225] rounded-2xl p-3 flex flex-col justify-between shadow-sm">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-[#737373] font-semibold leading-none">
            Arrecadado
          </span>
          <span className="text-sm sm:text-base font-black text-emerald-500 dark:text-emerald-400 mt-1.5 truncate">
            {stats.totalRevenue.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
              maximumFractionDigits: 0,
            })}
          </span>
        </div>

        {/* Cotas Pagas */}
        <div className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#222225] rounded-2xl p-3 flex flex-col justify-between shadow-sm">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-[#737373] font-semibold leading-none flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            Pagas
          </span>
          <span className="text-sm sm:text-base font-bold text-zinc-950 dark:text-white mt-1.5">
            {stats.paid} <span className="text-xs text-zinc-500 font-normal">cotas</span>
          </span>
        </div>

        {/* Cotas Reservadas */}
        <div className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#222225] rounded-2xl p-3 flex flex-col justify-between shadow-sm">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-[#737373] font-semibold leading-none flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" />
            Reservadas
          </span>
          <span className="text-sm sm:text-base font-bold text-amber-500 dark:text-amber-400 mt-1.5">
            {stats.reserved} <span className="text-xs text-zinc-500 font-normal">cotas</span>
          </span>
        </div>

        {/* Cotas Livres */}
        <div className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#222225] rounded-2xl p-3 flex flex-col justify-between shadow-sm">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-[#737373] font-semibold leading-none flex items-center gap-1">
            <CircleDot className="w-3 h-3 text-[#0095f6]" />
            Livres
          </span>
          <span className="text-sm sm:text-base font-bold text-[#0095f6] mt-1.5">
            {stats.available} <span className="text-xs text-zinc-500 font-normal">cotas</span>
          </span>
        </div>
      </div>
    </div>
  );
}
