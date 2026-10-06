"use client";

import React, { useMemo, useState } from "react";
import { Raffle, RaffleBuyer, formatTicketNumber } from "@/domain/entities/Raffle";
import { Phone, Search, User, X, Check, Clock, Copy, Loader2 } from "lucide-react";

interface WhatsAppBuyerConnectorProps {
  raffle: Raffle;
  activeBuyer: RaffleBuyer | null;
  onSelectBuyer: (buyer: RaffleBuyer | null) => void;
  whatsappContacts: RaffleBuyer[];
  selectedNumbers: number[];
  isSubmitting: boolean;
  onConfirmPurchase: (status: "reserved" | "paid") => Promise<void>;
  onClearSelection: () => void;
}

function normalizePhoneSearch(value?: string) {
  return String(value || "").replace(/\D+/g, "");
}

function formatPhone(value?: string) {
  const digits = normalizePhoneSearch(value);
  if (!digits) return "Telefone indisponível";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    const split = local.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${local.slice(0, split)}-${local.slice(split)}`;
  }
  return value?.startsWith("+") ? value : `+${digits}`;
}

export function WhatsAppBuyerConnector({
  raffle,
  activeBuyer,
  onSelectBuyer,
  whatsappContacts,
  selectedNumbers,
  isSubmitting,
  onConfirmPurchase,
  onClearSelection,
}: WhatsAppBuyerConnectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);

  const totalNumbers = raffle.totalNumbers;
  const totalPrice = selectedNumbers.length * raffle.pricePerNumber;

  const filteredContacts = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase();
    if (!raw) return whatsappContacts;
    const digits = normalizePhoneSearch(raw);
    return whatsappContacts.filter((contact) => {
      const name = String(contact.name || "").toLowerCase();
      const phone = normalizePhoneSearch(contact.phone);
      return name.includes(raw) || Boolean(digits && phone.includes(digits));
    });
  }, [searchTerm, whatsappContacts]);

  const formattedNumbersList = selectedNumbers
    .map((n) => formatTicketNumber(n, totalNumbers))
    .join(", ");

  const handleCopyWhatsAppMessage = () => {
    if (!activeBuyer) return;
    const firstName = activeBuyer.name?.split(" ")[0] || "amigo";
    const text = `Oii ${firstName}! Confirmadíssimo seus números da rifa: [${formattedNumbersList}] 🎉 Já anotei aqui com todo carinho, boa sorte demaiss! 🍀`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="px-3 sm:px-4 pt-2.5">
      <div className="bg-white dark:bg-[#101318] border border-zinc-200 dark:border-[#1e2836] rounded-2xl p-3.5 sm:p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Phone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-zinc-950 dark:text-white flex items-center gap-1.5">
                <span>Vincular ao WhatsApp</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold">
                  telefone
                </span>
              </h3>
              <p className="text-[10px] text-zinc-500 dark:text-[#737373]">
                Selecione pelo nome ou número do comprador
              </p>
            </div>
          </div>

          {activeBuyer && (
            <button
              type="button"
              onClick={() => onSelectBuyer(null)}
              className="min-h-[44px] px-2 text-xs font-semibold text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white flex items-center gap-1 transition-colors shrink-0 active:scale-95 cursor-pointer"
              aria-label="Trocar comprador selecionado"
            >
              <X className="w-3.5 h-3.5" />
              <span>Trocar</span>
            </button>
          )}
        </div>

        {activeBuyer ? (
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-[#111d18] border border-emerald-500/30 flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              {activeBuyer.avatar ? (
                <img
                  src={activeBuyer.avatar}
                  alt={activeBuyer.name}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-emerald-500/50 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <User className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs sm:text-sm font-black text-zinc-950 dark:text-white truncate">
                    {activeBuyer.name}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold shrink-0">
                    Selecionado
                  </span>
                </div>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono font-medium truncate mt-0.5">
                  {formatPhone(activeBuyer.phone)}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] text-zinc-500 dark:text-[#737373] block leading-none">
                Pronto p/ marcar
              </span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                {selectedNumbers.length} {selectedNumbers.length === 1 ? "cota" : "cotas"}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                inputMode="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Digite o nome ou número do cliente..."
                className="w-full bg-zinc-50 dark:bg-[#161a22] border border-zinc-300 dark:border-[#2b3545] rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-950 dark:text-white placeholder-[#606e82] focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-zinc-500 dark:text-[#606e82] block">
                Contatos do WhatsApp:
              </span>

              {filteredContacts.length > 0 ? (
                <div
                  className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar"
                >
                  {filteredContacts.map((contact) => (
                    <button
                      key={contact.conversationId || contact.phone}
                      type="button"
                      onClick={() => {
                        onSelectBuyer(contact);
                        setSearchTerm("");
                      }}
                      className="min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-[#161a22] border border-zinc-200 dark:border-[#2b3545] text-left hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 active:scale-95 transition-all shrink-0 cursor-pointer max-w-[200px] shadow-sm"
                    >
                      {contact.avatar ? (
                        <img
                          src={contact.avatar}
                          alt={contact.name}
                          className="w-7 h-7 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-[#262626] flex items-center justify-center shrink-0">
                          <User className="w-3.5 h-3.5 text-zinc-500 dark:text-[#737373]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-zinc-950 dark:text-white truncate block">
                          {contact.name}
                        </span>
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono truncate block">
                          {formatPhone(contact.phone)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-200 dark:border-[#2b3545] px-3 py-2.5 text-[11px] text-zinc-500 dark:text-[#737373] text-center">
                  Nenhum contato do WhatsApp encontrado com essa busca.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resumo de Ação Imediata se Cotas Estiverem Selecionadas */}
        {selectedNumbers.length > 0 && (
          <div className="pt-2.5 border-t border-zinc-200 dark:border-[#1e2836] space-y-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-zinc-500 dark:text-[#8e8e93]">Cotas:</span>
                {selectedNumbers.slice(0, 6).map((num) => (
                  <span
                    key={num}
                    className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-bold"
                  >
                    {formatTicketNumber(num, totalNumbers)}
                  </span>
                ))}
                {selectedNumbers.length > 6 && (
                  <span className="text-[10px] text-zinc-500 dark:text-[#737373]">
                    +{selectedNumbers.length - 6} mais
                  </span>
                )}
              </div>

              <span className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                {totalPrice.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>

            {!activeBuyer && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl">
                Selecione o comprador pelo nome ou telefone do WhatsApp para concluir a venda.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!activeBuyer || isSubmitting}
                onClick={() => onConfirmPurchase("reserved")}
                className="min-h-[44px] py-2 px-3 rounded-xl bg-white dark:bg-[#161a22] border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
              >
                <Clock className="w-4 h-4 text-amber-500" />
                <span>Reservar</span>
              </button>

              <button
                type="button"
                disabled={!activeBuyer || isSubmitting}
                onClick={() => onConfirmPurchase("paid")}
                className="min-h-[44px] py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[3]" />
                )}
                <span>Confirmar Pago</span>
              </button>
            </div>

            {activeBuyer && (
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleCopyWhatsAppMessage}
                  className="min-h-[44px] flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:opacity-80 active:scale-95 transition-all cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-500" />
                      <span>Mensagem copiada!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar mensagem para o WhatsApp</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onClearSelection}
                  className="min-h-[44px] px-2 text-xs text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white cursor-pointer active:scale-95"
                >
                  Limpar cotas
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
