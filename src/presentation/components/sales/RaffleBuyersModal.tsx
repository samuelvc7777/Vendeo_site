"use client";

import React, { useMemo, useState } from "react";
import {
  Raffle,
  RaffleTicket,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { X, Users, Search, Trash2, CheckCircle2, Clock, User } from "lucide-react";

interface RaffleBuyersModalProps {
  isOpen: boolean;
  onClose: () => void;
  raffle: Raffle;
  tickets: RaffleTicket[];
  onReleaseNumbers: (numbers: number[]) => Promise<void>;
}

interface BuyerGroup {
  buyerKey: string;
  name: string;
  username?: string;
  avatar?: string;
  conversationId?: string;
  tickets: RaffleTicket[];
  status: "paid" | "reserved";
  totalValue: number;
}

export function RaffleBuyersModal({
  isOpen,
  onClose,
  raffle,
  tickets,
  onReleaseNumbers,
}: RaffleBuyersModalProps) {
  const [search, setSearch] = useState("");
  const [releasingGroup, setReleasingGroup] = useState<string | null>(null);

  // Agrupa os tickets por comprador
  const buyerGroups = useMemo(() => {
    const map = new Map<string, BuyerGroup>();

    for (const ticket of tickets) {
      if (ticket.status === "available") continue;

      const key =
        ticket.buyer?.conversationId ||
        ticket.buyer?.username ||
        ticket.buyer?.name ||
        `ticket_${ticket.id}`;

      const name = ticket.buyer?.name || "Comprador não identificado";
      const username = ticket.buyer?.username;
      const avatar = ticket.buyer?.avatar;
      const conversationId = ticket.buyer?.conversationId;

      const existing = map.get(key);
      if (existing) {
        existing.tickets.push(ticket);
        existing.totalValue += raffle.pricePerNumber;
        if (ticket.status === "paid") existing.status = "paid";
      } else {
        map.set(key, {
          buyerKey: key,
          name,
          username,
          avatar,
          conversationId,
          tickets: [ticket],
          status: ticket.status,
          totalValue: raffle.pricePerNumber,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.tickets.length - a.tickets.length
    );
  }, [tickets, raffle.pricePerNumber]);

  // Filtro de busca
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return buyerGroups;
    const q = search.toLowerCase().trim();
    return buyerGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.username?.toLowerCase().includes(q) ||
        g.tickets.some((t) => String(t.number).includes(q) || t.formattedNumber.includes(q))
    );
  }, [buyerGroups, search]);

  if (!isOpen) return null;

  const handleRelease = async (group: BuyerGroup) => {
    const confirm = window.confirm(
      `Deseja realmente liberar as ${group.tickets.length} cotas de ${group.name}?`
    );
    if (!confirm) return;

    try {
      setReleasingGroup(group.buyerKey);
      const numbers = group.tickets.map((t) => t.number);
      await onReleaseNumbers(numbers);
    } catch (err: any) {
      alert(err?.message || "Erro ao liberar cotas.");
    } finally {
      setReleasingGroup(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="w-full max-w-lg bg-[#121212] border border-[#262626] rounded-t-2xl sm:rounded-2xl p-5 text-white flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#262626] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0095f6]/20 border border-[#0095f6]/40 flex items-center justify-center text-[#0095f6]">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Compradores da Rifa</h2>
              <p className="text-[11px] text-[#737373]">
                {buyerGroups.length} participantes • {tickets.filter((t) => t.status !== "available").length} cotas adquiridas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#737373] hover:text-white hover:bg-[#262626] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Busca */}
        <div className="pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por comprador ou número..."
              className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6]"
            />
          </div>
        </div>

        {/* Lista de Compradores */}
        <div className="flex-1 overflow-y-auto space-y-2.5 py-2">
          {filteredGroups.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-center p-4 text-[#737373]">
              <Users className="w-8 h-8 stroke-1 text-[#3a3a3c] mb-2" />
              <p className="text-xs font-semibold text-white">Nenhum comprador ainda</p>
              <p className="text-[11px] text-[#737373] mt-0.5">
                Selecione os números na grade para registrar a primeira venda.
              </p>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div
                key={group.buyerKey}
                className="p-3 rounded-xl bg-[#18181b] border border-[#262626] flex flex-col gap-2"
              >
                {/* Dados do Comprador */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {group.avatar ? (
                      <img
                        src={group.avatar}
                        alt={group.name}
                        className="w-8 h-8 rounded-full object-cover border border-[#262626]"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#262626] flex items-center justify-center text-[#737373]">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {group.name}
                      </p>
                      {group.username && (
                        <p className="text-[10px] text-[#0095f6] font-mono truncate">
                          @{group.username}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 ${
                        group.status === "paid"
                          ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                          : "bg-amber-500/15 border border-amber-500/30 text-amber-400"
                      }`}
                    >
                      {group.status === "paid" ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Pago
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" />
                          Reservado
                        </>
                      )}
                    </span>

                    <button
                      onClick={() => handleRelease(group)}
                      disabled={releasingGroup === group.buyerKey}
                      className="p-1 rounded-lg text-[#737373] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Liberar cotas deste comprador"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Números Comprados */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-[#737373] mr-1">
                    {group.tickets.length} cotas (
                    {group.totalValue.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                    ):
                  </span>
                  {group.tickets.map((t) => (
                    <span
                      key={t.id}
                      className="px-1.5 py-0.5 rounded-md bg-[#222225] border border-[#2b2b2e] text-white font-mono text-[10px]"
                    >
                      {formatTicketNumber(t.number, raffle.totalNumbers)}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
