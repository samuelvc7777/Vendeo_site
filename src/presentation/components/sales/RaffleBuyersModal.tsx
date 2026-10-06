"use client";

import React, { useMemo, useState } from "react";
import {
  Raffle,
  RaffleTicket,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { Users, Search, Trash2, CheckCircle2, Clock, User, X } from "lucide-react";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

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
  phone?: string;
  avatar?: string;
  conversationId?: string;
  tickets: RaffleTicket[];
  status: "paid" | "reserved";
  totalValue: number;
}

function formatPhoneDisplay(value?: string) {
  if (!value) return "";
  const digits = String(value).replace(/\D+/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    const split = local.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${local.slice(0, split)}-${local.slice(split)}`;
  }
  return value.startsWith("+") ? value : `+${digits}`;
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
        ticket.buyer?.phone ||
        ticket.buyer?.username ||
        ticket.buyer?.name ||
        `ticket_${ticket.id}`;

      const name = ticket.buyer?.name || "Comprador não identificado";
      const username = ticket.buyer?.username;
      const phone = ticket.buyer?.phone;
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
          phone,
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
    const phoneQuery = q.replace(/\D+/g, "");
    return buyerGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        Boolean(phoneQuery && g.phone?.replace(/\D+/g, "").includes(phoneQuery)) ||
        g.username?.toLowerCase().includes(q) ||
        g.tickets.some((t) => String(t.number).includes(q) || t.formattedNumber.includes(q))
    );
  }, [buyerGroups, search]);

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

  const totalSoldTickets = tickets.filter((t) => t.status !== "available").length;

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Compradores da Rifa"
      description={`${buyerGroups.length} participantes • ${totalSoldTickets} cotas adquiridas`}
      maxWidth="lg"
      icon={
        <div className="w-9 h-9 rounded-xl bg-[#0095f6]/15 border border-[#0095f6]/30 flex items-center justify-center text-[#0095f6]">
          <Users className="w-5 h-5" />
        </div>
      }
    >
      <div className="space-y-3">
        {/* Busca com inputMode adequado */}
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            inputMode="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por comprador ou número da cota..."
            className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-8 py-2.5 text-xs text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none focus:border-[#0095f6]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Lista de Compradores em Cards Touch-Friendly */}
        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto no-scrollbar pt-1">
          {filteredGroups.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center p-4 text-zinc-500 dark:text-[#737373]">
              <Users className="w-10 h-10 stroke-1 text-zinc-400 dark:text-[#3a3a3c] mb-2" />
              <p className="text-xs font-bold text-zinc-950 dark:text-white">Nenhum comprador encontrado</p>
              <p className="text-[11px] text-zinc-500 dark:text-[#737373] mt-0.5">
                {buyerGroups.length === 0
                  ? "Selecione os números na grade para registrar a primeira venda."
                  : "Tente outro termo na busca acima."}
              </p>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div
                key={group.buyerKey}
                className="p-3.5 rounded-2xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#262626] flex flex-col gap-2.5 shadow-sm"
              >
                {/* Linha Principal: Avatar, Nome, Telefone e Ações */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {group.avatar ? (
                      <img
                        src={group.avatar}
                        alt={group.name}
                        className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-[#262626] shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-[#262626] flex items-center justify-center text-zinc-500 dark:text-[#737373] shrink-0">
                        <User className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-black text-zinc-950 dark:text-white truncate">
                        {group.name}
                      </p>
                      {group.phone ? (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono font-medium truncate">
                          {formatPhoneDisplay(group.phone)}
                        </p>
                      ) : group.username ? (
                        <p className="text-[11px] text-[#0095f6] font-mono truncate">
                          @{group.username}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                        group.status === "paid"
                          ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {group.status === "paid" ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Pago</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" />
                          <span>Reservado</span>
                        </>
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRelease(group)}
                      disabled={releasingGroup === group.buyerKey}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-[#737373] hover:text-red-500 hover:bg-red-500/10 active:scale-90 transition-all cursor-pointer"
                      title="Liberar cotas deste comprador"
                      aria-label={`Liberar cotas de ${group.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Linha Secundária: Números Adquiridos */}
                <div className="pt-2 border-t border-zinc-100 dark:border-[#222225] flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-zinc-500 dark:text-[#737373] mr-1">
                    {group.tickets.length} {group.tickets.length === 1 ? "cota" : "cotas"} (
                    <strong className="text-zinc-950 dark:text-white">
                      {group.totalValue.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </strong>
                    ):
                  </span>
                  {group.tickets.map((t) => (
                    <span
                      key={t.id}
                      className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#222225] border border-zinc-200 dark:border-[#2b2b2e] text-zinc-950 dark:text-white font-mono text-[11px] font-bold"
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
    </ResponsiveModal>
  );
}
