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
    <div className="bg-[#0c0c0e] border-b border-[#222225] p-3 space-y-2.5">
      {/* Linha 1: Seletor de Rifa + Botões de Ação */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="relative inline-block w-full max-w-[260px]">
            <select
              value={activeRaffle.id}
              onChange={(e) => onSelectRaffle(e.target.value)}
              aria-label="Selecionar rifa ativa"
              className="w-full appearance-none bg-[#18181b] border border-[#2b2b2e] rounded-xl px-3 py-1.5 pr-8 text-xs font-bold text-white truncate focus:outline-none focus:border-[#0095f6] cursor-pointer"
            >
              {raffles.map((r) => (
                <option key={r.id} value={r.id} className="bg-[#18181b] text-white">
                  {r.title} ({r.totalNumbers} cotas)
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#737373] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onOpenEditModal}
            className="p-1.5 rounded-xl bg-[#18181b] border border-[#2b2b2e] text-[#a8a8a8] hover:text-white hover:border-[#3a3a3d] transition-all cursor-pointer"
            title="Editar rifa"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onDeleteRaffle}
            className="p-1.5 rounded-xl bg-[#18181b] border border-[#2b2b2e] text-[#737373] hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer"
            title="Excluir rifa"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onOpenBuyersModal}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#18181b] border border-[#2b2b2e] text-xs font-semibold text-[#a8a8a8] hover:text-white hover:border-[#3a3a3d] transition-all cursor-pointer"
            title="Ver compradores da rifa"
          >
            <Users className="w-3.5 h-3.5 text-[#0095f6]" />
            <span className="hidden xs:inline">Compradores</span>
          </button>

          <button
            onClick={onOpenCreateModal}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black text-xs font-bold shadow-md shadow-amber-500/10 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span className="hidden sm:inline">Nova Rifa</span>
          </button>
        </div>
      </div>

      {/* Linha 2: Card Resumo da Rifa (Título, Preço e Progresso) */}
      <div className="p-3 rounded-2xl bg-[#141416] border border-[#222225] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Rifa Oficial
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase ${
                  activeRaffle.status === "active"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : activeRaffle.status === "paused"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                }`}
              >
                {activeRaffle.status === "active"
                  ? "Ativa"
                  : activeRaffle.status === "paused"
                  ? "Pausada"
                  : "Sorteada"}
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-black text-white truncate">
              {activeRaffle.title}
            </h2>
            {activeRaffle.description && (
              <p className="text-[11px] text-[#737373] line-clamp-1 mt-0.5">
                {activeRaffle.description}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <span className="text-xs text-[#737373] block leading-none">Valor da Cota</span>
            <span className="text-sm sm:text-base font-black text-amber-400">
              {activeRaffle.pricePerNumber.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>
        </div>

        {/* Barra de Progresso e Percentual */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#a8a8a8] font-medium flex items-center gap-1">
              <Flame className="w-3 h-3 text-amber-400 fill-amber-400" />
              Progresso de Vendas
            </span>
            <span className="font-bold text-white">
              {stats.paid} de {stats.total} cotas (
              <span className="text-emerald-400">{stats.percentSold}%</span>)
            </span>
          </div>

          <div className="w-full bg-[#1c1c1e] h-2 rounded-full overflow-hidden border border-[#2b2b2e]">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm transition-all duration-500"
              style={{ width: `${stats.percentSold}%` }}
            />
          </div>
        </div>

        {/* Datas */}
        <div className="flex items-center justify-between pt-1 border-t border-[#1e1e22] text-[10px] text-[#737373]">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Início: {formatDate(activeRaffle.startDate)}
          </span>
          <span>Término: {formatDate(activeRaffle.endDate)}</span>
        </div>
      </div>

      {/* Linha 3: Métricas em 4 Cards Compactos */}
      <div className="grid grid-cols-4 gap-2">
        {/* Total Arrecadado */}
        <div className="bg-[#141416] border border-[#222225] rounded-xl p-2 flex flex-col justify-between">
          <span className="text-[10px] text-[#737373] font-medium leading-none">Arrecadado</span>
          <span className="text-xs font-black text-emerald-400 mt-1 truncate">
            {stats.totalRevenue.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
              maximumFractionDigits: 0,
            })}
          </span>
        </div>

        {/* Cotas Pagas */}
        <div className="bg-[#141416] border border-[#222225] rounded-xl p-2 flex flex-col justify-between">
          <span className="text-[10px] text-[#737373] font-medium leading-none flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
            Pagas
          </span>
          <span className="text-xs font-bold text-white mt-1">
            {stats.paid} <span className="text-[10px] text-[#737373] font-normal">cotas</span>
          </span>
        </div>

        {/* Cotas Reservadas */}
        <div className="bg-[#141416] border border-[#222225] rounded-xl p-2 flex flex-col justify-between">
          <span className="text-[10px] text-[#737373] font-medium leading-none flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-amber-400" />
            Reservadas
          </span>
          <span className="text-xs font-bold text-amber-400 mt-1">
            {stats.reserved} <span className="text-[10px] text-[#737373] font-normal">cotas</span>
          </span>
        </div>

        {/* Cotas Livres */}
        <div className="bg-[#141416] border border-[#222225] rounded-xl p-2 flex flex-col justify-between">
          <span className="text-[10px] text-[#737373] font-medium leading-none flex items-center gap-1">
            <CircleDot className="w-2.5 h-2.5 text-[#0095f6]" />
            Livres
          </span>
          <span className="text-xs font-bold text-[#0095f6] mt-1">
            {stats.available} <span className="text-[10px] text-[#737373] font-normal">cotas</span>
          </span>
        </div>
      </div>
    </div>
  );
}
