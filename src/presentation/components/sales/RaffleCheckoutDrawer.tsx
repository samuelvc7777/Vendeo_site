"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Raffle,
  RaffleBuyer,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { InstagramConversation } from "@/domain/entities/Instagram";
import {
  Check,
  Clock,
  Copy,
  Search,
  User,
  X,
  Sparkles,
  AlertCircle,
  AtSign,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface RaffleCheckoutDrawerProps {
  raffle: Raffle;
  selectedNumbers: number[];
  instagramConversations: InstagramConversation[];
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
  instagramConversations,
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalNumbers = raffle.totalNumbers;
  const pricePerNumber = raffle.pricePerNumber;
  const totalPrice = selectedNumbers.length * pricePerNumber;

  // Filtra conversas do Instagram
  const filteredConversations = useMemo(() => {
    if (!searchTerm.trim()) {
      return instagramConversations.slice(0, 8);
    }
    const query = searchTerm.toLowerCase().trim().replace(/^@/, "");
    return instagramConversations
      .filter((conv) => {
        const usernameMatch = conv.username?.toLowerCase().includes(query);
        const nameMatch = conv.fullName?.toLowerCase().includes(query);
        return usernameMatch || nameMatch;
      })
      .slice(0, 10);
  }, [searchTerm, instagramConversations]);

  if (selectedNumbers.length === 0) return null;

  const formattedNumbersList = selectedNumbers
    .map((n) => formatTicketNumber(n, totalNumbers))
    .join(", ");

  const handleCopyDirectMessage = () => {
    const buyerFirstName =
      activeBuyer?.name?.split(" ")[0] || activeBuyer?.username || "amigo";
    const text = `Oii ${buyerFirstName}! Confirmadíssimo seus números da rifa: [${formattedNumbersList}] 🎉 Já anotei aqui com todo carinho, boa sorte demaiss! 🍀`;
    navigator.clipboard.writeText(text);
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 2500);
  };

  const handleConfirm = async (status: "reserved" | "paid") => {
    if (!activeBuyer) {
      setIsSearchingBuyer(true);
      setErrorMessage("Vincule um cliente do Instagram antes de confirmar.");
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
    <div className="fixed bottom-14 left-0 right-0 z-40 p-2 sm:p-3 pointer-events-none pb-[calc(env(safe-area-inset-bottom,0px)+3.5rem)]">
      <div className="max-w-md mx-auto bg-[#0d1117]/95 backdrop-blur-xl border border-[#233044] rounded-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.8)] p-3 pointer-events-auto text-white space-y-2.5 animate-in slide-in-from-bottom-3 duration-200">
        
        {/* LINHA 1: RESUMO DE COTAS SELECIONADAS + VALOR + CHIPS COM REMOÇÃO INDIVIDUAL */}
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-lg bg-[#0095f6] text-white text-[11px] font-black tracking-wide flex items-center gap-1 shadow-sm shadow-[#0095f6]/40">
              <span>{selectedNumbers.length}</span>
              <span>{selectedNumbers.length === 1 ? "cota" : "cotas"}</span>
            </span>
            <span className="text-xs font-black text-emerald-400">
              {totalPrice.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>

          <button
            type="button"
            onClick={onClearSelection}
            className="text-[11px] font-semibold text-[#8e8e93] hover:text-white flex items-center gap-1 transition-colors active:scale-95 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        </div>

        {/* CHIPS HORIZONTAIS DOS NÚMEROS SELECIONADOS */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scrollbar-none py-0.5"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {selectedNumbers.map((num) => (
            <span
              key={num}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0095f6]/20 border border-[#0095f6]/40 text-[#0095f6] text-xs font-mono font-bold shrink-0"
            >
              <span>{formatTicketNumber(num, totalNumbers)}</span>
              <button
                type="button"
                onClick={() => onRemoveNumber(num)}
                className="hover:text-white transition-colors cursor-pointer"
                title={`Desmarcar cota ${formatTicketNumber(num, totalNumbers)}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        {errorMessage && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* LINHA 2: CLIENTE DO INSTAGRAM VINCULADO OU SELETOR */}
        {activeBuyer ? (
          <div className="p-2 rounded-xl bg-[#141b26] border border-[#2b394d] flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {activeBuyer.avatar ? (
                <img
                  src={activeBuyer.avatar}
                  alt={activeBuyer.name}
                  className="w-7 h-7 rounded-full object-cover ring-1 ring-[#0095f6] shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#1c2738] flex items-center justify-center text-[#0095f6] shrink-0">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="min-w-0">
                <span className="text-xs font-bold text-white font-mono truncate block">
                  @{activeBuyer.username || activeBuyer.name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyDirectMessage}
                className="p-1.5 rounded-lg text-[#0095f6] hover:bg-[#0095f6]/15 transition-colors cursor-pointer"
                title="Copiar mensagem para o Direct"
              >
                {copiedMessage ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onSelectBuyer(null)}
                className="text-[10px] text-[#737373] hover:text-white px-1.5 py-1 rounded transition-colors cursor-pointer"
              >
                Trocar @
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {!isSearchingBuyer ? (
              <button
                type="button"
                onClick={() => setIsSearchingBuyer(true)}
                className="w-full py-2 px-3 rounded-xl bg-[#161f2e] border border-[#0095f6]/50 text-[#0095f6] font-bold text-xs flex items-center justify-between hover:bg-[#1c283c] active:scale-98 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <AtSign className="w-4 h-4" />
                  <span>Vincular Cliente do Instagram</span>
                </div>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="space-y-2 p-2 rounded-xl bg-[#141b26] border border-[#2b394d]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white flex items-center gap-1">
                    <AtSign className="w-3.5 h-3.5 text-[#0095f6]" />
                    Selecionar @ do Cliente
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSearchingBuyer(false)}
                    className="text-[#737373] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#737373] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && searchTerm.trim()) {
                        const clean = searchTerm.trim().replace(/^@/, "");
                        onSelectBuyer({ name: clean, username: clean });
                        setSearchTerm("");
                        setIsSearchingBuyer(false);
                      }
                    }}
                    placeholder="Digite o @ ou nome do comprador..."
                    className="w-full bg-[#0d1117] border border-[#2b3545] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6]"
                  />
                </div>

                {/* Carrossel de conversas recentes */}
                <div
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scrollbar-none pt-1"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {filteredConversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => {
                        onSelectBuyer({
                          name: conv.fullName || conv.username,
                          username: conv.username,
                          avatar: conv.avatar,
                          conversationId: conv.id,
                        });
                        setSearchTerm("");
                        setIsSearchingBuyer(false);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0d1117] border border-[#2b3545] text-left hover:border-[#0095f6] shrink-0 active:scale-95 transition-all cursor-pointer"
                    >
                      {conv.avatar ? (
                        <img
                          src={conv.avatar}
                          alt={conv.username}
                          className="w-4 h-4 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-[#262626] flex items-center justify-center shrink-0">
                          <User className="w-2.5 h-2.5 text-[#737373]" />
                        </div>
                      )}
                      <span className="text-[10px] font-bold text-white font-mono truncate max-w-[80px]">
                        @{conv.username}
                      </span>
                    </button>
                  ))}

                  {searchTerm.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const clean = searchTerm.trim().replace(/^@/, "");
                        onSelectBuyer({ name: clean, username: clean });
                        setSearchTerm("");
                        setIsSearchingBuyer(false);
                      }}
                      className="px-2 py-1 rounded-lg bg-[#0095f6]/20 border border-[#0095f6] text-[#0095f6] text-[10px] font-bold shrink-0 cursor-pointer"
                    >
                      Vincular @{searchTerm.trim().replace(/^@/, "")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* LINHA 3: BOTÕES DE CONFIRMAÇÃO IMEDIATA */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleConfirm("reserved")}
            className="py-2.5 px-3 rounded-xl bg-[#171e2a] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Reservar ({selectedNumbers.length})</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleConfirm("paid")}
            className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            )}
            <span>Confirmar Pago ({selectedNumbers.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
