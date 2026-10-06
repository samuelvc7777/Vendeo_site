"use client";

import React, { useState, useMemo } from "react";
import {
  Raffle,
  RaffleBuyer,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import {
  Check,
  Clock,
  Copy,
  Search,
  User,
  X,
  AlertCircle,
  Phone,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface RaffleCheckoutDrawerProps {
  raffle: Raffle;
  selectedNumbers: number[];
  whatsappContacts: RaffleBuyer[];
  activeBuyer: RaffleBuyer | null;
  onSelectBuyer: (buyer: RaffleBuyer | null) => void;
  onRemoveNumber: (num: number) => void;
  isSubmitting: boolean;
  onClearSelection: () => void;
  onConfirmPurchase: (params: {
    buyer: RaffleBuyer;
    status: "reserved" | "paid";
    notes?: string;
  }) => Promise<void>;
}

export function RaffleCheckoutDrawer({
  raffle,
  selectedNumbers,
  whatsappContacts,
  activeBuyer,
  onSelectBuyer,
  onRemoveNumber,
  isSubmitting,
  onClearSelection,
  onConfirmPurchase,
}: RaffleCheckoutDrawerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchingBuyer, setIsSearchingBuyer] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedNumbers, setCopiedNumbers] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalNumbers = raffle.totalNumbers;
  const pricePerNumber = raffle.pricePerNumber;
  const totalPrice = selectedNumbers.length * pricePerNumber;

  const normalizePhone = (value?: string) => String(value || "").replace(/\D+/g, "");
  const formatPhone = (value?: string) => {
    const digits = normalizePhone(value);
    if (!digits) return "Telefone indisponível";
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      const ddd = digits.slice(2, 4);
      const local = digits.slice(4);
      const split = local.length === 9 ? 5 : 4;
      return `+55 (${ddd}) ${local.slice(0, split)}-${local.slice(split)}`;
    }
    return `+${digits}`;
  };

  const filteredContacts = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    if (!query) return whatsappContacts.slice(0, 10);
    const digits = normalizePhone(query);
    return whatsappContacts
      .filter((contact) => {
        const nameMatch = String(contact.name || "").toLowerCase().includes(query);
        const phoneMatch = Boolean(digits && normalizePhone(contact.phone).includes(digits));
        return nameMatch || phoneMatch;
      })
      .slice(0, 16);
  }, [searchTerm, whatsappContacts]);

  if (selectedNumbers.length === 0) return null;

  const formattedNumbersList = selectedNumbers
    .map((n) => formatTicketNumber(n, totalNumbers))
    .join(", ");

  const handleCopyWhatsAppMessage = () => {
    const buyerFirstName =
      activeBuyer?.name?.split(" ")[0] || "amigo";
    const text = `Oii ${buyerFirstName}! Confirmadíssimo seus números da rifa: [${formattedNumbersList}] 🎉 Já anotei aqui com todo carinho, boa sorte demaiss! 🍀`;
    navigator.clipboard.writeText(text);
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 2500);
  };

  const handleCopyNumbers = async () => {
    try {
      await navigator.clipboard.writeText(formattedNumbersList);
      setCopiedNumbers(true);
      setTimeout(() => setCopiedNumbers(false), 2200);
    } catch {
      setErrorMessage("Não foi possível copiar os números para a área de transferência.");
    }
  };

  const handleConfirm = async (status: "reserved" | "paid") => {
    if (!activeBuyer) {
      setIsSearchingBuyer(true);
      setErrorMessage("Vincule um contato do WhatsApp antes de confirmar.");
      return;
    }

    try {
      setErrorMessage(null);
      await onConfirmPurchase({
        buyer: activeBuyer,
        status,
      });
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao registrar venda de cotas.");
    }
  };

  return (
    <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px))] md:bottom-6 left-0 right-0 z-40 p-2.5 sm:p-4 pointer-events-none">
      <div className="max-w-md md:max-w-xl mx-auto bg-white/95 dark:bg-[#0d1117]/95 backdrop-blur-xl border border-zinc-200 dark:border-[#233044] rounded-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.3)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.8)] p-3.5 pointer-events-auto text-zinc-950 dark:text-white space-y-2.5 animate-in slide-in-from-bottom-3 duration-200">
        
        {/* LINHA 1: RESUMO DE COTAS SELECIONADAS + VALOR + CHIPS COM REMOÇÃO INDIVIDUAL */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-[#1e293b] pb-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-lg bg-[#0095f6] text-white text-xs font-black tracking-wide flex items-center gap-1 shadow-sm shadow-[#0095f6]/40">
              <span>{selectedNumbers.length}</span>
              <span>{selectedNumbers.length === 1 ? "cota" : "cotas"}</span>
            </span>
            <span className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400">
              {totalPrice.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyNumbers}
              className={`min-h-[36px] text-xs font-semibold flex items-center gap-1 rounded-xl px-2.5 py-1 transition-all active:scale-95 cursor-pointer ${
                copiedNumbers
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "text-[#0095f6] hover:bg-[#0095f6]/10"
              }`}
              title="Copiar números selecionados"
            >
              {copiedNumbers ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedNumbers ? "Copiado" : "Copiar"}</span>
            </button>

            <button
              type="button"
              onClick={onClearSelection}
              className="min-h-[36px] text-xs font-semibold text-zinc-500 dark:text-[#8e8e93] hover:text-zinc-950 dark:hover:text-white flex items-center gap-1 px-2 py-1 rounded-xl transition-colors active:scale-95 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          </div>
        </div>

        {/* CHIPS HORIZONTAIS DOS NÚMEROS SELECIONADOS (Touch friendly) */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5"
        >
          {selectedNumbers.map((num) => (
            <span
              key={num}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#0095f6]/15 border border-[#0095f6]/35 text-[#0095f6] text-xs font-mono font-bold shrink-0"
            >
              <span>{formatTicketNumber(num, totalNumbers)}</span>
              <button
                type="button"
                onClick={() => onRemoveNumber(num)}
                className="min-w-[20px] min-h-[20px] flex items-center justify-center hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer"
                title={`Desmarcar cota ${formatTicketNumber(num, totalNumbers)}`}
                aria-label={`Desmarcar cota ${formatTicketNumber(num, totalNumbers)}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>

        {errorMessage && (
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-500 dark:text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* LINHA 2: CONTATO DO WHATSAPP VINCULADO OU SELETOR */}
        {activeBuyer ? (
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-[#111d18] border border-emerald-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {activeBuyer.avatar ? (
                <img
                  src={activeBuyer.avatar}
                  alt={activeBuyer.name}
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-emerald-500/50 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <span className="text-xs font-bold text-zinc-950 dark:text-white truncate block">
                  {activeBuyer.name}
                </span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono truncate block">
                  {formatPhone(activeBuyer.phone)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyWhatsAppMessage}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                title="Copiar mensagem para o WhatsApp"
                aria-label="Copiar mensagem para o WhatsApp"
              >
                {copiedMessage ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onSelectBuyer(null)}
                className="min-h-[40px] px-2 text-xs text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white rounded-xl transition-colors cursor-pointer flex items-center"
              >
                Trocar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {!isSearchingBuyer ? (
              <button
                type="button"
                onClick={() => setIsSearchingBuyer(true)}
                className="w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-emerald-50 dark:bg-[#111d18] border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-between hover:bg-emerald-100 dark:hover:bg-emerald-500/10 active:scale-98 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span>Vincular Cliente do WhatsApp</span>
                </div>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="space-y-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-[#111d18] border border-emerald-500/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-950 dark:text-white flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-500" />
                    Selecionar nome e telefone
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSearchingBuyer(false)}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    inputMode="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Digite o nome ou número do comprador..."
                    className="w-full min-h-[40px] bg-white dark:bg-[#0d1117] border border-zinc-300 dark:border-[#2b3545] rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1"
                >
                  {filteredContacts.map((contact) => (
                    <button
                      key={contact.conversationId || contact.phone}
                      type="button"
                      onClick={() => {
                        onSelectBuyer(contact);
                        setSearchTerm("");
                        setIsSearchingBuyer(false);
                      }}
                      className="min-h-[44px] flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#0d1117] border border-zinc-300 dark:border-[#2b3545] text-left hover:border-emerald-500 shrink-0 active:scale-95 transition-all cursor-pointer max-w-[200px]"
                    >
                      {contact.avatar ? (
                        <img
                          src={contact.avatar}
                          alt={contact.name}
                          className="w-6 h-6 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-[#262626] flex items-center justify-center shrink-0">
                          <User className="w-3 h-3 text-zinc-500 dark:text-[#737373]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-zinc-950 dark:text-white truncate block max-w-[110px]">
                          {contact.name}
                        </span>
                        <span className="text-[9px] text-emerald-700 dark:text-emerald-300 font-mono truncate block max-w-[125px]">
                          {formatPhone(contact.phone)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && (
                    <span className="text-xs text-zinc-500 dark:text-[#737373] py-2 px-1">
                      Nenhum contato encontrado.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* LINHA 3: BOTÕES DE CONFIRMAÇÃO IMEDIATA (Touch target >= 44px) */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleConfirm("reserved")}
            className="min-h-[44px] py-2.5 px-3 rounded-xl bg-amber-50 dark:bg-[#171e2a] border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
          >
            <Clock className="w-4 h-4 text-amber-500" />
            <span>Reservar ({selectedNumbers.length})</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleConfirm("paid")}
            className="min-h-[44px] py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 stroke-[3]" />
            )}
            <span>Confirmar Pago ({selectedNumbers.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
