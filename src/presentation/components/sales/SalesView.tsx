"use client";

import React, { useState } from "react";
import { useRaffles } from "@/presentation/hooks/useRaffles";
import { RaffleDashboard } from "./RaffleDashboard";
import { RaffleNumberGrid } from "./RaffleNumberGrid";
import { RaffleCheckoutDrawer } from "./RaffleCheckoutDrawer";
import { CreateRaffleModal } from "./CreateRaffleModal";
import { EditRaffleModal } from "./EditRaffleModal";
import { RaffleBuyersModal } from "./RaffleBuyersModal";
import { RaffleTicketDetailsModal } from "./RaffleTicketDetailsModal";
import { WhatsAppBuyerConnector } from "./WhatsAppBuyerConnector";
import { ClothingSalesView } from "./ClothingSalesView";
import { RaffleReportView } from "./RaffleReportView";
import { RaffleTicket, RaffleBuyer } from "@/domain/entities/Raffle";
import {
  Loader2,
  Sparkles,
  Plus,
  ShoppingBag,
  BarChart3,
} from "lucide-react";

export function SalesView() {
  const [salesSection, setSalesSection] = useState<"raffles" | "clothes" | "report">("raffles");

  const {
    raffles,
    activeRaffle,
    tickets,
    ticketsMap,
    stats,
    selectedNumbers,
    isLoading,
    isSubmitting,
    whatsappContacts,
    selectRaffle,
    toggleNumberSelection,
    clearSelection,
    selectRandomNumbers,
    selectMultipleNumbers,
    selectSequentialNumbers,
    removeSelectedNumber,
    createRaffle,
    updateRaffle,
    deleteRaffle,
    purchaseSelected,
    releaseNumbers,
  } = useRaffles();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isBuyersModalOpen, setIsBuyersModalOpen] = useState(false);
  const [activeBuyer, setActiveBuyer] = useState<RaffleBuyer | null>(null);
  const [inspectingTicket, setInspectingTicket] = useState<RaffleTicket | null>(null);

  return (
    <div className="flex-1 overflow-y-auto h-full min-h-0 bg-zinc-50 dark:bg-black text-zinc-950 dark:text-white relative no-scrollbar">
      {/* SELETOR DE ABAS PRINCIPAIS: RIFAS vs ROUPAS vs RELATÓRIO */}
      <div className="sticky top-0 z-30 bg-white/95 dark:bg-black/95 backdrop-blur-md px-3 sm:px-4 pt-2.5 pb-2 border-b border-zinc-200 dark:border-[#1e232e]">
        <div className="grid grid-cols-3 p-1 rounded-2xl bg-zinc-100 dark:bg-[#12151b] border border-zinc-200 dark:border-[#232d3d] max-w-xl mx-auto">
          {/* Aba 1: Rifas */}
          <button
            type="button"
            onClick={() => setSalesSection("raffles")}
            className={`min-h-[44px] py-2 px-3 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
              salesSection === "raffles"
                ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-black shadow-md shadow-amber-500/20"
                : "text-zinc-500 dark:text-[#8e8e93] hover:text-zinc-950 dark:hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Rifas</span>
          </button>

          {/* Aba 2: Roupas */}
          <button
            type="button"
            onClick={() => setSalesSection("clothes")}
            className={`min-h-[44px] py-2 px-3 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
              salesSection === "clothes"
                ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/20"
                : "text-zinc-500 dark:text-[#8e8e93] hover:text-zinc-950 dark:hover:text-white"
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Roupas</span>
          </button>

          {/* Aba 3: Relatório */}
          <button
            type="button"
            onClick={() => setSalesSection("report")}
            className={`min-h-[44px] py-2 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer active:scale-95 ${
              salesSection === "report"
                ? "bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-md shadow-sky-500/20"
                : "text-zinc-500 dark:text-[#8e8e93] hover:text-zinc-950 dark:hover:text-white"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Relatório</span>
          </button>
        </div>
      </div>

      {/* CONTEÚDO DA ABA SELECIONADA */}
      {salesSection === "clothes" ? (
        <ClothingSalesView />
      ) : salesSection === "report" ? (
        <RaffleReportView />
      ) : (
        <>
          {isLoading && !activeRaffle ? (
            <div className="py-24 flex flex-col items-center justify-center text-zinc-950 dark:text-white space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              <p className="text-xs font-semibold text-zinc-600 dark:text-[#a8a8a8]">
                Carregando módulo de rifas...
              </p>
            </div>
          ) : !activeRaffle ? (
            <div className="py-24 flex flex-col items-center justify-center text-zinc-950 dark:text-white p-6 text-center space-y-4 max-w-sm mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] flex items-center justify-center text-amber-500 shadow-sm">
                <Sparkles className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-950 dark:text-white">Nenhuma Rifa Cadastrada</h2>
                <p className="text-xs text-zinc-500 dark:text-[#737373] mt-1 leading-relaxed">
                  Cadastre sua primeira rifa para começar a marcar números e vincular aos clientes do WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Cadastrar Primeira Rifa</span>
              </button>

              <CreateRaffleModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={createRaffle}
              />
            </div>
          ) : (
            <div className="pb-32">
              {/* COMPOSIÇÃO RESPONSIVA:
                  - Mobile (< lg): Empilhado (Dashboard -> WhatsApp Buyer -> Grid)
                  - Desktop (>= lg): Painéis lado a lado (Painel de Gestão e Vínculo à esquerda + Grade de Cotas à direita)
              */}
              <div className="lg:flex lg:items-start lg:gap-0">
                {/* PAINEL ESQUERDO NO DESKTOP / SEÇÃO SUPERIOR NO MOBILE */}
                <div className="lg:w-[420px] lg:shrink-0 lg:border-r lg:border-zinc-200 lg:dark:border-[#1e232e] lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:no-scrollbar">
                  {/* Dashboard da Rifa: Seletor, Estatísticas e Barra de Progresso */}
                  <RaffleDashboard
                    raffles={raffles}
                    activeRaffle={activeRaffle}
                    stats={stats}
                    onSelectRaffle={selectRaffle}
                    onOpenCreateModal={() => setIsCreateModalOpen(true)}
                    onOpenEditModal={() => setIsEditModalOpen(true)}
                    onOpenBuyersModal={() => setIsBuyersModalOpen(true)}
                    onDeleteRaffle={async () => {
                      if (!activeRaffle) return;
                      const confirm = window.confirm(
                        `ATENÇÃO: Deseja realmente EXCLUIR a rifa "${activeRaffle.title}"?\n\nTodos os bilhetes e registros desta rifa serão apagados!`
                      );
                      if (confirm) {
                        try {
                          await deleteRaffle(activeRaffle.id);
                        } catch (err: any) {
                          alert(err?.message || "Erro ao excluir rifa.");
                        }
                      }
                    }}
                  />

                  {/* Vínculo do comprador por nome + telefone do WhatsApp */}
                  <WhatsAppBuyerConnector
                    raffle={activeRaffle}
                    activeBuyer={activeBuyer}
                    onSelectBuyer={setActiveBuyer}
                    whatsappContacts={whatsappContacts}
                    selectedNumbers={selectedNumbers}
                    isSubmitting={isSubmitting}
                    onConfirmPurchase={async (status) => {
                      if (!activeBuyer) return;
                      await purchaseSelected({ buyer: activeBuyer, status });
                    }}
                    onClearSelection={clearSelection}
                  />
                </div>

                {/* PAINEL DIREITO NO DESKTOP / SEÇÃO INFERIOR NO MOBILE */}
                <div className="lg:flex-1 lg:min-w-0">
                  {/* Grade Interativa de Cotas (com busca, filtros, digitação em lote e atalhos) */}
                  <RaffleNumberGrid
                    raffle={activeRaffle}
                    ticketsMap={ticketsMap}
                    selectedNumbers={selectedNumbers}
                    onToggleNumber={toggleNumberSelection}
                    onSelectRandom={selectRandomNumbers}
                    onSelectMultiple={selectMultipleNumbers}
                    onSelectSequential={selectSequentialNumbers}
                    onClearSelection={clearSelection}
                    onViewTicketDetails={(ticket) => setInspectingTicket(ticket)}
                  />
                </div>
              </div>

              {/* Floating Action Dock de Checkout ao Selecionar Cotas */}
              <RaffleCheckoutDrawer
                raffle={activeRaffle}
                selectedNumbers={selectedNumbers}
                whatsappContacts={whatsappContacts}
                activeBuyer={activeBuyer}
                onSelectBuyer={setActiveBuyer}
                onRemoveNumber={removeSelectedNumber}
                isSubmitting={isSubmitting}
                onClearSelection={clearSelection}
                onConfirmPurchase={purchaseSelected}
              />

              {/* Modal de Cadastro de Nova Rifa (Adaptativo: Dialog no Desktop, Bottom Sheet no Mobile) */}
              <CreateRaffleModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={createRaffle}
              />

              {/* Modal de Edição e Exclusão da Rifa (Adaptativo) */}
              <EditRaffleModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                raffle={activeRaffle}
                onUpdate={updateRaffle}
                onDelete={deleteRaffle}
              />

              {/* Modal com Lista de Compradores (Adaptativo) */}
              <RaffleBuyersModal
                isOpen={isBuyersModalOpen}
                onClose={() => setIsBuyersModalOpen(false)}
                raffle={activeRaffle}
                tickets={tickets}
                onReleaseNumbers={releaseNumbers}
              />

              {/* Modal de Detalhes da Cota Inspecionada (Adaptativo) */}
              <RaffleTicketDetailsModal
                isOpen={Boolean(inspectingTicket)}
                onClose={() => setInspectingTicket(null)}
                ticket={inspectingTicket}
                raffle={activeRaffle}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
