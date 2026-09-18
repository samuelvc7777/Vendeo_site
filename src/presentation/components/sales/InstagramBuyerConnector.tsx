"use client";

import React, { useState, useMemo } from "react";
import {
  Raffle,
  RaffleBuyer,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { InstagramConversation } from "@/domain/entities/Instagram";
import {
  AtSign,
  Search,
  User,
  X,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Sparkles,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface InstagramBuyerConnectorProps {
  raffle: Raffle;
  activeBuyer: RaffleBuyer | null;
  onSelectBuyer: (buyer: RaffleBuyer | null) => void;
  instagramConversations: InstagramConversation[];
  selectedNumbers: number[];
  isSubmitting: boolean;
  onConfirmPurchase: (status: "reserved" | "paid") => Promise<void>;
  onClearSelection: () => void;
}

export function InstagramBuyerConnector({
  raffle,
  activeBuyer,
  onSelectBuyer,
  instagramConversations,
  selectedNumbers,
  isSubmitting,
  onConfirmPurchase,
  onClearSelection,
}: InstagramBuyerConnectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);

  const totalNumbers = raffle.totalNumbers;
  const totalPrice = selectedNumbers.length * raffle.pricePerNumber;

  // Filtra conversas do Instagram
  const filteredConversations = useMemo(() => {
    if (!searchTerm.trim()) {
      return instagramConversations.slice(0, 12);
    }
    const q = searchTerm.toLowerCase().trim().replace(/^@/, "");
    return instagramConversations
      .filter((c) => {
        const u = c.username?.toLowerCase() || "";
        const n = c.fullName?.toLowerCase() || "";
        return u.includes(q) || n.includes(q);
      })
      .slice(0, 15);
  }, [searchTerm, instagramConversations]);

  const formattedNumbersList = selectedNumbers
    .map((n) => formatTicketNumber(n, totalNumbers))
    .join(", ");

  const handleCopyDirectMessage = () => {
    if (!activeBuyer) return;
    const firstName = activeBuyer.name?.split(" ")[0] || activeBuyer.username || "amigo";
    const text = `Oii ${firstName}! Confirmadíssimo seus números da rifa: [${formattedNumbersList}] 🎉 Já anotei aqui com todo carinho, boa sorte demaiss! 🍀`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleManualInputEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchTerm.trim()) {
      const cleanAt = searchTerm.trim().replace(/^@/, "");
      onSelectBuyer({
        name: cleanAt,
        username: cleanAt,
      });
      setSearchTerm("");
    }
  };

  return (
    <div className="px-3 pt-2">
      <div className="bg-[#101318] border border-[#1e2836] rounded-2xl p-3.5 shadow-lg space-y-3">
        {/* Cabeçalho do Vínculo */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-[#0095f6]/20 border border-[#0095f6]/40 flex items-center justify-center text-[#0095f6]">
              <AtSign className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                Vincular ao Instagram
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-[#0095f6]/15 text-[#0095f6] font-mono">
                  @cliente
                </span>
              </h3>
              <p className="text-[10px] text-[#737373]">
                Selecione o comprador para registrar as cotas
              </p>
            </div>
          </div>

          {activeBuyer && (
            <button
              onClick={() => onSelectBuyer(null)}
              className="text-[11px] font-semibold text-[#737373] hover:text-white flex items-center gap-1 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Trocar @
            </button>
          )}
        </div>

        {/* COMPRADOR ATIVO SELECIONADO */}
        {activeBuyer ? (
          <div className="p-3 rounded-xl bg-[#141c26] border border-[#0095f6]/40 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {activeBuyer.avatar ? (
                <img
                  src={activeBuyer.avatar}
                  alt={activeBuyer.name}
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-[#0095f6] shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#1c2738] flex items-center justify-center text-[#0095f6] shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-black text-white font-mono">
                    @{activeBuyer.username || activeBuyer.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                    Ativo
                  </span>
                </div>
                {activeBuyer.name && activeBuyer.name !== activeBuyer.username && (
                  <p className="text-[10px] text-[#8e8e93] truncate">
                    {activeBuyer.name}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] text-[#737373] block">Pronto p/ marcar</span>
              <span className="text-[11px] text-[#0095f6] font-bold">
                {selectedNumbers.length}{" "}
                {selectedNumbers.length === 1 ? "cota" : "cotas"}
              </span>
            </div>
          </div>
        ) : (
          /* CAMPO DE BUSCA E SELEÇÃO DE @ DO INSTAGRAM */
          <div className="space-y-2.5">
            <div className="relative">
              <AtSign className="w-4 h-4 text-[#0095f6] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleManualInputEnter}
                placeholder="Digite o @ ou pesquise o nome do cliente..."
                className="w-full bg-[#161a22] border border-[#2b3545] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-[#606e82] focus:outline-none focus:border-[#0095f6] transition-colors"
              />
            </div>

            {/* Sugestões Rápidas de Clientes do Direct */}
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-[#606e82] block">
                Conversas Recentes do Direct:
              </span>
              <div
                className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar scrollbar-none"
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
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#161a22] border border-[#2b3545] text-left hover:border-[#0095f6] hover:bg-[#1a2332] active:scale-95 transition-all shrink-0 cursor-pointer"
                  >
                    {conv.avatar ? (
                      <img
                        src={conv.avatar}
                        alt={conv.username}
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#262626] flex items-center justify-center shrink-0">
                        <User className="w-3 h-3 text-[#737373]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-white font-mono truncate block max-w-[90px]">
                        @{conv.username}
                      </span>
                    </div>
                  </button>
                ))}

                {/* Opção de confirmar @ digitado avulso */}
                {searchTerm.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const clean = searchTerm.trim().replace(/^@/, "");
                      onSelectBuyer({
                        name: clean,
                        username: clean,
                      });
                      setSearchTerm("");
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#0095f6]/20 border border-[#0095f6] text-[#0095f6] text-xs font-bold shrink-0 active:scale-95 transition-all"
                  >
                    <span>Vincular @{searchTerm.trim().replace(/^@/, "")}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* BARRA DE AÇÃO QUANDO NÚMEROS ESTÃO SELECIONADOS */}
        {selectedNumbers.length > 0 && (
          <div className="pt-2 border-t border-[#1e2836] space-y-2.5 animate-in fade-in duration-150">
            {/* Resumo de Cotas e Valor */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-[#8e8e93]">Cotas:</span>
                {selectedNumbers.slice(0, 6).map((num) => (
                  <span
                    key={num}
                    className="px-1.5 py-0.5 rounded-md bg-[#0095f6]/20 border border-[#0095f6]/40 text-[#0095f6] text-[11px] font-mono font-bold"
                  >
                    {formatTicketNumber(num, totalNumbers)}
                  </span>
                ))}
                {selectedNumbers.length > 6 && (
                  <span className="text-[10px] text-[#737373]">
                    +{selectedNumbers.length - 6} mais
                  </span>
                )}
              </div>

              <div className="text-right">
                <span className="text-xs font-black text-emerald-400">
                  {totalPrice.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
            </div>

            {/* Aviso se nenhum comprador foi vinculado ainda */}
            {!activeBuyer && (
              <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                ⚠️ Selecione ou digite o @ do cliente acima para concluir a venda.
              </p>
            )}

            {/* Botões de Ação */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!activeBuyer || isSubmitting}
                onClick={() => onConfirmPurchase("reserved")}
                className="py-2 px-2.5 rounded-xl bg-[#161a22] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Reservar</span>
              </button>

              <button
                type="button"
                disabled={!activeBuyer || isSubmitting}
                onClick={() => onConfirmPurchase("paid")}
                className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                )}
                <span>Confirmar Pago</span>
              </button>
            </div>

            {/* Copiar Comprovante para o Direct */}
            {activeBuyer && (
              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  onClick={handleCopyDirectMessage}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0095f6] hover:text-[#38bdf8] transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Mensagem Copiada!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar texto p/ Direct da Larissa</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-[10px] text-[#737373] hover:text-white"
                >
                  Desmarcar cotas
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
