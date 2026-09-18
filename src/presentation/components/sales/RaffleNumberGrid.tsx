"use client";

import React, { useState, useMemo } from "react";
import {
  Raffle,
  RaffleTicket,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import {
  Search,
  Check,
  Clock,
  User,
  X,
  Layers,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface RaffleNumberGridProps {
  raffle: Raffle;
  ticketsMap: Map<number, RaffleTicket>;
  selectedNumbers: number[];
  onToggleNumber: (num: number) => void;
  onSelectRandom: (count: number) => void;
  onSelectMultiple?: (numbers: number[]) => void;
  onSelectSequential?: (count: number) => void;
  onClearSelection?: () => void;
  onViewTicketDetails?: (ticket: RaffleTicket) => void;
}

type FilterType = "all" | "available" | "reserved" | "paid";

export function RaffleNumberGrid({
  raffle,
  ticketsMap,
  selectedNumbers,
  onToggleNumber,
  onSelectRandom,
  onSelectMultiple,
  onSelectSequential,
  onClearSelection,
  onViewTicketDetails,
}: RaffleNumberGridProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeChunk, setActiveChunk] = useState(0);

  // Painel de digitação de múltiplos números / intervalos
  const [isBatchPanelOpen, setIsBatchPanelOpen] = useState(false);
  const [batchInput, setBatchInput] = useState("");
  const [batchFeedback, setBatchFeedback] = useState<{
    type: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const totalNumbers = raffle.totalNumbers;
  const chunkSize = 100;
  const totalChunks = Math.ceil(totalNumbers / chunkSize);

  // Divide em blocos de 100 se for maior que 100
  const chunkRanges = useMemo(() => {
    const ranges: { start: number; end: number; label: string }[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize + 1;
      const end = Math.min((i + 1) * chunkSize, totalNumbers);
      ranges.push({
        start,
        end,
        label: `${formatTicketNumber(start, totalNumbers)} - ${formatTicketNumber(end, totalNumbers)}`,
      });
    }
    return ranges;
  }, [totalNumbers, totalChunks]);

  // Lista todos os números visíveis de acordo com filtros e bloco atual
  const visibleNumbers = useMemo(() => {
    const numbers: number[] = [];
    const isSearching = searchQuery.trim().length > 0;

    const start =
      isSearching || totalChunks <= 1 ? 1 : chunkRanges[activeChunk]?.start ?? 1;
    const end =
      isSearching || totalChunks <= 1
        ? totalNumbers
        : chunkRanges[activeChunk]?.end ?? totalNumbers;

    for (let i = start; i <= end; i++) {
      const ticket = ticketsMap.get(i);
      const isPaid = ticket?.status === "paid";
      const isReserved = ticket?.status === "reserved";
      const isAvailable = !ticket || ticket.status === "available";

      // Filtro por tipo
      if (filter === "available" && !isAvailable) continue;
      if (filter === "reserved" && !isReserved) continue;
      if (filter === "paid" && !isPaid) continue;

      // Filtro por busca
      if (isSearching) {
        const query = searchQuery.trim().toLowerCase();
        const formatted = formatTicketNumber(i, totalNumbers);
        const buyerName = ticket?.buyer?.name?.toLowerCase() || "";
        const buyerUser = ticket?.buyer?.username?.toLowerCase() || "";

        const matchesNumber =
          String(i).includes(query) || formatted.includes(query);
        const matchesBuyer =
          buyerName.includes(query) || buyerUser.includes(query);

        if (!matchesNumber && !matchesBuyer) continue;
      }

      numbers.push(i);
    }

    return numbers;
  }, [
    totalNumbers,
    ticketsMap,
    filter,
    searchQuery,
    activeChunk,
    totalChunks,
    chunkRanges,
  ]);

  // Processa a entrada de múltiplos números digitados
  const handleProcessBatchInput = () => {
    if (!batchInput.trim()) return;

    // Normaliza separadores: vírgula, espaço, " a ", " até "
    const normalized = batchInput
      .replace(/;/g, ",")
      .replace(/\s+a\s+/gi, "-")
      .replace(/\s+até\s+/gi, "-")
      .replace(/\s+ate\s+/gi, "-");

    const tokens = normalized.split(/[\s,]+/);
    const parsed = new Set<number>();
    const paidList: number[] = [];
    let outOfBoundsCount = 0;

    for (const token of tokens) {
      if (!token.trim()) continue;

      // Intervalo: Ex: 10-20
      if (token.includes("-")) {
        const parts = token.split("-");
        if (parts.length === 2) {
          const s = parseInt(parts[0].trim(), 10);
          const e = parseInt(parts[1].trim(), 10);
          if (!isNaN(s) && !isNaN(e)) {
            const min = Math.min(s, e);
            const max = Math.max(s, e);
            for (let n = min; n <= max; n++) {
              if (n >= 1 && n <= totalNumbers) {
                const ticket = ticketsMap.get(n);
                if (ticket?.status === "paid") {
                  paidList.push(n);
                } else {
                  parsed.add(n);
                }
              } else {
                outOfBoundsCount++;
              }
            }
            continue;
          }
        }
      }

      // Número avulso
      const n = parseInt(token.trim(), 10);
      if (!isNaN(n)) {
        if (n >= 1 && n <= totalNumbers) {
          const ticket = ticketsMap.get(n);
          if (ticket?.status === "paid") {
            paidList.push(n);
          } else {
            parsed.add(n);
          }
        } else {
          outOfBoundsCount++;
        }
      }
    }

    const numbersToAdd = Array.from(parsed);

    if (numbersToAdd.length === 0) {
      if (paidList.length > 0) {
        setBatchFeedback({
          type: "error",
          text: `Todas as cotas informadas já estão pagas! (${paidList.map((n) => formatTicketNumber(n, totalNumbers)).join(", ")})`,
        });
      } else {
        setBatchFeedback({
          type: "error",
          text: `Nenhum número válido encontrado. Digite cotas entre 1 e ${totalNumbers}.`,
        });
      }
      return;
    }

    if (onSelectMultiple) {
      onSelectMultiple(numbersToAdd);
    } else {
      for (const num of numbersToAdd) {
        if (!selectedNumbers.includes(num)) {
          onToggleNumber(num);
        }
      }
    }

    let feedbackMsg = `${numbersToAdd.length} ${numbersToAdd.length === 1 ? "cota adicionada à seleção" : "cotas adicionadas à seleção"}!`;
    if (paidList.length > 0) {
      feedbackMsg += ` (${paidList.length} ignoradas pois já foram pagas)`;
    }
    setBatchFeedback({ type: "success", text: feedbackMsg });
    setBatchInput("");
    setTimeout(() => setBatchFeedback(null), 4000);
  };

  return (
    <div className="flex flex-col bg-black">
      {/* BARRA DE FERRAMENTAS: BUSCA, ATALHOS E SELEÇÃO EM LOTE */}
      <div className="p-3 border-b border-[#262626] space-y-2.5 bg-[#0a0a0a]">
        {/* Linha Principal: Busca + Botões Rápidos + Alternador de Lote */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cota ou nome do cliente..."
              className="w-full bg-[#18181b] border border-[#262626] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737373] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Botão de Abrir Seleção de Múltiplos Números em Lote */}
          <button
            type="button"
            onClick={() => setIsBatchPanelOpen(!isBatchPanelOpen)}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all shrink-0 cursor-pointer ${
              isBatchPanelOpen
                ? "bg-[#0095f6] border-[#0095f6] text-white shadow-md shadow-[#0095f6]/30"
                : "bg-[#18181b] border-[#2b2b2e] text-[#a8a8a8] hover:text-white hover:border-[#38383a]"
            }`}
            title="Digitar múltiplos números ou selecionar intervalos"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Digitar Vários</span>
            <span className="sm:hidden">Lote</span>
          </button>

          {/* Atalhos Rápidos Aleatórios */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onSelectRandom(1)}
              className="px-2 py-1.5 rounded-lg bg-[#18181b] border border-[#262626] text-[11px] font-semibold text-[#a8a8a8] hover:text-white hover:border-[#38383a] active:scale-95 transition-all"
              title="Selecionar 1 cota aleatória livre"
            >
              +1
            </button>
            <button
              onClick={() => onSelectRandom(5)}
              className="px-2 py-1.5 rounded-lg bg-[#18181b] border border-[#262626] text-[11px] font-semibold text-[#a8a8a8] hover:text-white hover:border-[#38383a] active:scale-95 transition-all"
              title="Selecionar 5 cotas aleatórias livres"
            >
              +5
            </button>
            <button
              onClick={() => onSelectRandom(10)}
              className="px-2 py-1.5 rounded-lg bg-[#18181b] border border-[#262626] text-[11px] font-semibold text-[#a8a8a8] hover:text-white hover:border-[#38383a] active:scale-95 transition-all"
              title="Selecionar 10 cotas aleatórias livres"
            >
              +10
            </button>
          </div>
        </div>

        {/* PAINEL EXPANSÍVEL: SELEÇÃO EM LOTE / DIGITAÇÃO DE MÚLTIPLOS NÚMEROS */}
        {isBatchPanelOpen && (
          <div className="p-3 rounded-xl bg-[#12151c] border border-[#0095f6]/30 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-150 shadow-inner">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#0095f6]" />
                <span className="text-xs font-bold text-white">
                  Digitar Múltiplos Números ou Intervalos
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchPanelOpen(false)}
                className="text-[#737373] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] text-[#8e8e93]">
              Digite os números separados por vírgula ou use traço para intervalos. Exemplo:{" "}
              <span className="font-mono text-[#0095f6] font-semibold">
                05, 12, 18, 25-30
              </span>{" "}
              ou{" "}
              <span className="font-mono text-[#0095f6] font-semibold">
                1 a 10
              </span>
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleProcessBatchInput();
                }}
                placeholder="Ex: 5, 12, 28, 40-45"
                className="flex-1 bg-[#18181b] border border-[#2b3545] rounded-xl px-3 py-2 text-xs text-white placeholder-[#737373] font-mono focus:outline-none focus:border-[#0095f6]"
              />
              <button
                type="button"
                onClick={handleProcessBatchInput}
                className="px-3.5 py-2 rounded-xl bg-[#0095f6] hover:bg-[#0086dc] text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition-all shadow-md shadow-[#0095f6]/30 shrink-0 cursor-pointer"
              >
                <span>Selecionar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Atalhos rápidos de quantidade extra */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#1f2633]">
              <span className="text-[10px] text-[#737373] mr-1">Mais atalhos:</span>
              <button
                type="button"
                onClick={() => onSelectRandom(20)}
                className="px-2 py-1 rounded-lg bg-[#18181b] border border-[#2b3545] text-[11px] text-[#a8a8a8] hover:text-white active:scale-95 cursor-pointer"
              >
                +20 aleatórios
              </button>
              <button
                type="button"
                onClick={() => onSelectRandom(50)}
                className="px-2 py-1 rounded-lg bg-[#18181b] border border-[#2b3545] text-[11px] text-[#a8a8a8] hover:text-white active:scale-95 cursor-pointer"
              >
                +50 aleatórios
              </button>
              {onSelectSequential && (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectSequential(5)}
                    className="px-2 py-1 rounded-lg bg-[#18181b] border border-[#2b3545] text-[11px] text-[#a8a8a8] hover:text-white active:scale-95 cursor-pointer"
                    title="Seleciona os próximos 5 números livres em ordem sequencial"
                  >
                    Próx. 5 seguidos
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSequential(10)}
                    className="px-2 py-1 rounded-lg bg-[#18181b] border border-[#2b3545] text-[11px] text-[#a8a8a8] hover:text-white active:scale-95 cursor-pointer"
                    title="Seleciona os próximos 10 números livres em ordem sequencial"
                  >
                    Próx. 10 seguidos
                  </button>
                </>
              )}
            </div>

            {/* Feedback da operação de lote */}
            {batchFeedback && (
              <div
                className={`p-2 rounded-lg text-xs flex items-center gap-1.5 animate-in fade-in duration-100 ${
                  batchFeedback.type === "success"
                    ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                    : "bg-red-500/15 border border-red-500/40 text-red-300"
                }`}
              >
                {batchFeedback.type === "success" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{batchFeedback.text}</span>
              </div>
            )}
          </div>
        )}

        {/* Abas de Filtros de Status */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar scrollbar-none"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {(
            [
              { key: "all", label: "Todas" },
              { key: "available", label: "Livres" },
              { key: "reserved", label: "Reservadas" },
              { key: "paid", label: "Pagas" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === item.key
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-[#18181b] text-[#8e8e93] hover:text-white hover:bg-[#222225]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Abas de Chunks (se tiver mais de 100 cotas e não estiver buscando) */}
        {totalChunks > 1 && !searchQuery && (
          <div
            className="flex items-center gap-1 overflow-x-auto pt-1 no-scrollbar scrollbar-none border-t border-[#1f1f23]"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            <span className="text-[10px] text-[#737373] shrink-0 mr-1">Blocos:</span>
            {chunkRanges.map((chunk, idx) => (
              <button
                key={idx}
                onClick={() => setActiveChunk(idx)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono whitespace-nowrap transition-all cursor-pointer ${
                  activeChunk === idx
                    ? "bg-[#0095f6] text-white font-bold"
                    : "bg-[#18181b] text-[#737373] hover:text-white"
                }`}
              >
                {chunk.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legenda Visual Rápida */}
      <div className="px-4 py-1.5 bg-[#0e0e10] border-b border-[#1c1c1e] flex items-center justify-between text-[10px] text-[#8e8e93]">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#18181b] border border-[#2b2b2e]" />
          <span>Livre</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#0095f6] ring-1 ring-[#0095f6]" />
          <span>Selecionado ({selectedNumbers.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/20 border border-amber-500/50" />
          <span>Reservado</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/50" />
          <span>Pago</span>
        </div>
      </div>

      {/* GRADE DE NÚMEROS (com padding inferior pb-40 para nunca cobrir com a barra de ação) */}
      <div className="p-3.5 pb-44">
        {visibleNumbers.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-[#737373]">
            <Search className="w-8 h-8 stroke-1 text-[#3a3a3c] mb-2" />
            <p className="text-xs font-semibold text-white">Nenhum número encontrado</p>
            <p className="text-[11px] text-[#737373] mt-0.5">
              Tente mudar o filtro de status ou o termo de busca.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
            {visibleNumbers.map((num) => {
              const ticket = ticketsMap.get(num);
              const isSelected = selectedNumbers.includes(num);
              const isPaid = ticket?.status === "paid";
              const isReserved = ticket?.status === "reserved";
              const formatted = formatTicketNumber(num, totalNumbers);

              // Determina estilos visuais
              let buttonStyle =
                "bg-[#18181b] border-[#2b2b2e] text-[#e5e5e5] hover:border-[#525252] hover:bg-[#222225]";
              let indicator = null;

              if (isSelected) {
                buttonStyle =
                  "bg-[#0095f6] border-[#0095f6] text-white font-extrabold ring-2 ring-[#0095f6]/60 scale-105 shadow-lg shadow-[#0095f6]/30 z-10";
                indicator = <Check className="w-3.5 h-3.5 text-white stroke-[3]" />;
              } else if (isPaid) {
                buttonStyle =
                  "bg-emerald-950/50 border-emerald-500/60 text-emerald-200 hover:bg-emerald-900/60 shadow-sm";
                indicator = (
                  <span className="text-[8.5px] truncate max-w-[48px] text-emerald-400 font-mono font-bold leading-none mt-0.5">
                    @{ticket.buyer?.username || ticket.buyer?.name?.split(" ")[0] || "pago"}
                  </span>
                );
              } else if (isReserved) {
                buttonStyle =
                  "bg-amber-950/50 border-amber-500/60 text-amber-200 hover:bg-amber-900/60 shadow-sm";
                indicator = (
                  <span className="text-[8.5px] truncate max-w-[48px] text-amber-400 font-mono font-bold leading-none mt-0.5 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5 shrink-0" />
                    @{ticket.buyer?.username || ticket.buyer?.name?.split(" ")[0] || "res"}
                  </span>
                );
              }

              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    if (isPaid && onViewTicketDetails && ticket) {
                      onViewTicketDetails(ticket);
                    } else {
                      onToggleNumber(num);
                    }
                  }}
                  className={`relative aspect-square rounded-xl border flex flex-col items-center justify-center p-1 transition-all active:scale-90 select-none cursor-pointer ${buttonStyle}`}
                >
                  <span className="text-xs sm:text-sm font-mono font-black tracking-tight">
                    {formatted}
                  </span>
                  {indicator}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
