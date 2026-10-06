"use client";

import React, { useState } from "react";
import {
  Raffle,
  RaffleTicket,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { Ticket, User, Phone, CheckCircle2, Clock, Copy, Check, MessageSquare } from "lucide-react";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface RaffleTicketDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: RaffleTicket | null;
  raffle: Raffle;
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

export function RaffleTicketDetailsModal({
  isOpen,
  onClose,
  ticket,
  raffle,
}: RaffleTicketDetailsModalProps) {
  const [copied, setCopied] = useState(false);

  if (!ticket) return null;

  const formattedNum = formatTicketNumber(ticket.number, raffle.totalNumbers);

  const handleCopyMessage = () => {
    const buyerName = ticket.buyer?.name?.split(" ")[0] || "amigo";
    const text = `Oii ${buyerName}! Conferindo aqui seu número ${formattedNum} da rifa "${raffle.title}"! 🎉 Já tá tudo certinho por aqui, boa sorte demaiss! 🍀`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Cota ${formattedNum}`}
      description={raffle.title}
      maxWidth="sm"
      icon={
        <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 font-mono font-black text-sm">
          #{formattedNum}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Status e Valor */}
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#262626] flex items-center justify-between">
          <div>
            <span className="text-[10px] text-zinc-500 dark:text-[#737373] block uppercase tracking-wider font-bold">
              Status da Cota
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              {ticket.status === "paid" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Pago
                </span>
              ) : ticket.status === "reserved" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <Clock className="w-3.5 h-3.5" />
                  Reservado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  Disponível
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-zinc-500 dark:text-[#737373] block uppercase tracking-wider font-bold">
              Valor
            </span>
            <span className="text-base font-black text-amber-500">
              {raffle.pricePerNumber.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>
        </div>

        {/* Informações do Comprador */}
        {ticket.buyer ? (
          <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#262626] space-y-3">
            <span className="text-[10px] text-zinc-500 dark:text-[#737373] block uppercase tracking-wider font-bold">
              Comprador Vinculado
            </span>

            <div className="flex items-center gap-3">
              {ticket.buyer.avatar ? (
                <img
                  src={ticket.buyer.avatar}
                  alt={ticket.buyer.name}
                  className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-[#262626] shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-[#262626] flex items-center justify-center text-zinc-600 dark:text-[#a8a8a8] shrink-0">
                  <User className="w-6 h-6" />
                </div>
              )}

              <div className="min-w-0">
                <p className="text-sm font-black text-zinc-950 dark:text-white truncate">
                  {ticket.buyer.name}
                </p>
                {ticket.buyer.phone && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-mono font-medium flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3 shrink-0" />
                    <span>{formatPhoneDisplay(ticket.buyer.phone)}</span>
                  </p>
                )}
                {ticket.buyer.username && (
                  <p className="text-xs text-[#0095f6] font-mono mt-0.5">
                    @{ticket.buyer.username}
                  </p>
                )}
              </div>
            </div>

            {/* Ação de Copiar Mensagem */}
            <button
              type="button"
              onClick={handleCopyMessage}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span>Mensagem copiada!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Copiar confirmação p/ WhatsApp</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-2xl border border-dashed border-zinc-200 dark:border-[#262626] text-center text-xs text-zinc-500">
            Nenhum comprador vinculado a esta cota.
          </div>
        )}

        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-2.5 rounded-xl border border-zinc-200 dark:border-[#262626] text-xs font-semibold text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white active:scale-95 transition-all cursor-pointer"
          >
            Fechar Detalhes
          </button>
        </div>
      </div>
    </ResponsiveModal>
  );
}
