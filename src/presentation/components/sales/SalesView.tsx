"use client";

import React, { useState } from "react";
import { useRaffles } from "@/presentation/hooks/useRaffles";
import { RaffleDashboard } from "./RaffleDashboard";
import { RaffleNumberGrid } from "./RaffleNumberGrid";
import { RaffleCheckoutDrawer } from "./RaffleCheckoutDrawer";
import { CreateRaffleModal } from "./CreateRaffleModal";
import { EditRaffleModal } from "./EditRaffleModal";
import { RaffleBuyersModal } from "./RaffleBuyersModal";
import { InstagramBuyerConnector } from "./InstagramBuyerConnector";
import { ClothingSalesView } from "./ClothingSalesView";
import { RaffleTicket, RaffleBuyer, formatTicketNumber } from "@/domain/entities/Raffle";
import {
  Loader2,
  Sparkles,
  Plus,
  AlertCircle,
  X,
  User,
  Trash2,
  ShoppingBag,
} from "lucide-react";

export function SalesView() {
  const [salesSection, setSalesSection] = useState<"raffles" | "clothes">("raffles");

  const {
    raffles,
    activeRaffle,
    tickets,
    ticketsMap,
    stats,
    selectedNumbers,
    isLoading,
    isSubmitting,
    instagramConversations,
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
    <div className="flex-1 overflow-y-auto h-full min-h-0 bg-black text-white relative no-scrollbar">
      {/* SELETOR DE ABAS PRINCIPAIS: RIFAS vs ROUPAS */}
      <div className="sticky top-0 z-30 bg-black/95 backdrop-blur-md px-3 pt-2.5 pb-2 border-b border-[#1e232e]">
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-[#12151b] border border-[#232d3d]">
          {/* Aba 1: Rifas */}
          <button
            type="button"
            onClick={() => setSalesSection("raffles")}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              salesSection === "raffles"
                ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-black shadow-md shadow-amber-500/20"
                : "text-[#8e8e93] hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Rifas</span>
          </button>

          {/* Aba 2: Roupas */}
          <button
            type="button"
            onClick={() => setSalesSection("clothes")}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              salesSection === "clothes"
                ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/20"
                : "text-[#8e8e93] hover:text-white"
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Roupas</span>
          </button>
        </div>
      </div>

      {/* CONTEÚDO DA ABA SELECIONADA */}
      {salesSection === "clothes" ? (
        <ClothingSalesView />
      ) : (
        <>
          {isLoading && !activeRaffle ? (
            <div className="py-20 flex flex-col items-center justify-center text-white space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
              <p className="text-xs text-[#a8a8a8]">Carregando módulo de rifas...</p>
            </div>
          ) : !activeRaffle ? (
            <div className="py-20 flex flex-col items-center justify-center text-white p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#1c1c1e] border border-[#262626] flex items-center justify-center text-amber-400">
                <Sparkles className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Nenhuma Rifa Cadastrada</h2>
                <p className="text-xs text-[#737373] max-w-xs mt-1">
                  Cadastre sua primeira rifa para começar a marcar números e vincular aos clientes do Instagram.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 active:scale-95 transition-all cursor-pointer"
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

              {/* Barra / Card de Vínculo com o @ do Instagram */}
              <InstagramBuyerConnector
                raffle={activeRaffle}
                activeBuyer={activeBuyer}
                onSelectBuyer={setActiveBuyer}
                instagramConversations={instagramConversations}
                selectedNumbers={selectedNumbers}
                isSubmitting={isSubmitting}
                onConfirmPurchase={async (status) => {
                  if (!activeBuyer) return;
                  await purchaseSelected({ buyer: activeBuyer, status });
                }}
                onClearSelection={clearSelection}
              />

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

              {/* Floating Action Dock de Checkout ao Selecionar Cotas */}
              <RaffleCheckoutDrawer
                raffle={activeRaffle}
                selectedNumbers={selectedNumbers}
                instagramConversations={instagramConversations}
                activeBuyer={activeBuyer}
                onSelectBuyer={setActiveBuyer}
                onRemoveNumber={removeSelectedNumber}
                isSubmitting={isSubmitting}
                onClearSelection={clearSelection}
                onConfirmPurchase={purchaseSelected}
              />

              {/* Modal de Cadastro de Nova Rifa */}
              <CreateRaffleModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={createRaffle}
              />

              {/* Modal de Edição e Exclusão da Rifa */}
              <EditRaffleModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                raffle={activeRaffle}
                onUpdate={updateRaffle}
                onDelete={deleteRaffle}
              />

              {/* Modal com Lista de Compradores */}
              <RaffleBuyersModal
                isOpen={isBuyersModalOpen}
                onClose={() => setIsBuyersModalOpen(false)}
                raffle={activeRaffle}
                tickets={tickets}
                onReleaseNumbers={releaseNumbers}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
