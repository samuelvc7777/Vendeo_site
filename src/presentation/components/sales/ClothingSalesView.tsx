"use client";

import React, { useState } from "react";
import { useClothingSales, ClothingFilterType } from "@/presentation/hooks/useClothingSales";
import {
  ClothingSale,
  formatCpf,
  formatPhone,
  formatFullAddress,
  formatShippingLabel,
} from "@/domain/entities/ClothingSale";
import { CreateClothingSaleModal } from "./CreateClothingSaleModal";
import { EditClothingSaleModal } from "./EditClothingSaleModal";
import {
  ShoppingBag,
  Plus,
  Search,
  X,
  Copy,
  Check,
  MapPin,
  Truck,
  Package,
  Clock,
  User,
  Phone,
  AlertCircle,
  ExternalLink,
  DollarSign,
  Layers,
  Sparkles,
  Loader2,
  Calendar,
} from "lucide-react";

export function ClothingSalesView() {
  const {
    filteredSales,
    sales,
    stats,
    isLoading,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    createSale,
    updateSale,
    deleteSale,
  } = useClothingSales();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<ClothingSale | null>(null);
  const [copiedSaleId, setCopiedSaleId] = useState<string | null>(null);

  const handleCopyLabel = (sale: ClothingSale) => {
    const text = formatShippingLabel(sale);
    navigator.clipboard.writeText(text);
    setCopiedSaleId(sale.id);
    setTimeout(() => setCopiedSaleId(null), 2500);
  };

  if (isLoading && sales.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
        <p className="text-xs text-[#a1a1aa]">Carregando vendas de roupas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32">
      {/* CABEÇALHO DO MÓDULO DE ROUPAS COM MÉTRICAS */}
      <div className="p-4 bg-[#101216] border-b border-[#232a36] space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 shadow-sm">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white flex items-center gap-1.5">
                Vendas de Roupas
                <span className="text-[10px] px-2 py-0.2 rounded-full bg-pink-500/20 text-pink-400 font-bold font-mono">
                  {stats.totalSales} {stats.totalSales === 1 ? "venda" : "vendas"}
                </span>
              </h2>
              <p className="text-[11px] text-[#71717a]">
                Controle de pedidos, fretes, estoques e dados de envio
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-bold text-xs shadow-md shadow-pink-500/20 active:scale-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Nova Venda</span>
          </button>
        </div>

        {/* CARTÕES DE MÉTRICAS EM GRID */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Card 1: Total Vendido */}
          <div className="p-2.5 rounded-xl bg-[#161a22] border border-[#263142]">
            <span className="text-[10px] text-[#8e8e93] font-semibold block mb-0.5">
              Faturamento Roupas
            </span>
            <span className="text-sm font-black text-emerald-400 font-mono">
              {stats.totalRevenue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>

          {/* Card 2: Em Estoque (Pronta Entrega) */}
          <div className="p-2.5 rounded-xl bg-[#161a22] border border-[#263142]">
            <span className="text-[10px] text-[#8e8e93] font-semibold block mb-0.5">
              Pronta Entrega
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-black text-white font-mono">
                {stats.inStockCount} {stats.inStockCount === 1 ? "peça" : "peças"}
              </span>
            </div>
          </div>

          {/* Card 3: Sob Encomenda */}
          <div className="p-2.5 rounded-xl bg-[#161a22] border border-[#263142]">
            <span className="text-[10px] text-[#8e8e93] font-semibold block mb-0.5">
              Sob Encomenda
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm font-black text-amber-300 font-mono">
                {stats.outOfStockCount} {stats.outOfStockCount === 1 ? "peça" : "peças"}
              </span>
            </div>
          </div>

          {/* Card 4: Fretes Pendentes */}
          <div className="p-2.5 rounded-xl bg-[#161a22] border border-[#263142]">
            <span className="text-[10px] text-[#8e8e93] font-semibold block mb-0.5">
              Fretes Pagos / Pend.
            </span>
            <span className="text-xs font-bold text-white font-mono">
              <span className="text-emerald-400">{stats.shippingPaidCount} pagos</span>
              <span className="text-[#71717a]"> • </span>
              <span className={stats.shippingPendingCount > 0 ? "text-rose-400" : "text-[#71717a]"}>
                {stats.shippingPendingCount} pend.
              </span>
            </span>
          </div>
        </div>

        {/* BARRA DE PESQUISA & FILTROS */}
        <div className="space-y-2 pt-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por cliente, CPF, peça ou cidade..."
              className="w-full bg-[#18181b] border border-[#27272a] rounded-xl pl-8 pr-7 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Abas de filtro */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar scrollbar-none"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {(
              [
                { key: "all", label: "Todas" },
                { key: "in_stock", label: "Em Estoque" },
                { key: "out_of_stock", label: "Sob Encomenda" },
                { key: "shipping_pending", label: "Frete Pendente" },
                { key: "shipping_paid", label: "Frete Pago" },
              ] as { key: ClothingFilterType; label: string }[]
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setFilterType(item.key)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  filterType === item.key
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-[#18181b] text-[#8e8e93] hover:text-white hover:bg-[#222225]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* LISTA DE VENDAS CADASTRADAS */}
      <div className="px-3 space-y-3">
        {filteredSales.length === 0 ? (
          <div className="py-16 text-center space-y-3 bg-[#101216] border border-[#232a36] rounded-2xl p-6">
            <div className="w-14 h-14 rounded-2xl bg-[#161a22] border border-[#263142] flex items-center justify-center text-pink-400 mx-auto">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Nenhuma venda de roupa encontrada</h3>
              <p className="text-xs text-[#71717a] max-w-xs mx-auto mt-1">
                {searchQuery || filterType !== "all"
                  ? "Tente ajustar o termo de pesquisa ou os filtros de status."
                  : "Cadastre sua primeira venda de roupa para controlar pedidos e etiquetas de envio."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs inline-flex items-center gap-1.5 shadow-lg shadow-pink-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Cadastrar Primeira Venda</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {filteredSales.map((sale) => {
              const fullAddr = formatFullAddress(sale.address);
              const isCopied = copiedSaleId === sale.id;

              return (
                <div
                  key={sale.id}
                  className="p-3.5 rounded-2xl bg-[#101319] border border-[#1e2736] hover:border-[#2e3e56] transition-all space-y-3 shadow-md"
                >
                  {/* Linha 1: Cliente, Instagram e Data */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-bold text-white truncate">
                            {sale.customerName}
                          </h4>
                          {sale.customerPhone && (
                            <a
                              href={`https://wa.me/55${sale.customerPhone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 font-mono font-semibold truncate flex items-center gap-1 hover:bg-emerald-500/20 transition-colors"
                              title="Abrir WhatsApp"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone className="w-2.5 h-2.5 shrink-0 text-emerald-400" />
                              <span>{formatPhone(sale.customerPhone)}</span>
                            </a>
                          )}
                        </div>
                        {sale.customerCpf && (
                          <span className="text-[10px] text-[#71717a] font-mono block mt-0.5">
                            CPF: {formatCpf(sale.customerCpf)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Preço em destaque */}
                    <div className="text-right shrink-0">
                      <span className="text-xs font-black text-emerald-400 font-mono block">
                        {sale.saleAmount.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                      <span className="text-[9px] text-[#71717a]">
                        {new Date(sale.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  </div>

                  {/* Linha 2: Peça / Descrição */}
                  <div className="p-2.5 rounded-xl bg-[#151a22] border border-[#232d3d] flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Package className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                      <span className="text-xs font-semibold text-white truncate">
                        {sale.productDescription}
                      </span>
                    </div>

                    {/* Tags de Estoque e Frete */}
                    <div className="flex items-center gap-1 shrink-0">
                      {sale.inStock ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold">
                          Em Estoque
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold">
                          Sob Encomenda
                        </span>
                      )}

                      {sale.shippingPaid ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-md bg-teal-500/15 border border-teal-500/40 text-teal-300 font-bold flex items-center gap-0.5">
                          <Truck className="w-2.5 h-2.5" />
                          Frete Pago
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-300 font-bold flex items-center gap-0.5">
                          <Truck className="w-2.5 h-2.5" />
                          Frete Pendente
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Linha 3: Endereço Formatado */}
                  <div className="flex items-start gap-1.5 text-[11px] text-[#a1a1aa] px-1">
                    <MapPin className="w-3.5 h-3.5 text-pink-400 shrink-0 mt-0.5" />
                    <span className="line-clamp-2 leading-relaxed">{fullAddr}</span>
                  </div>

                  {/* Linha 4: Barra de Ações Rápidas */}
                  <div className="pt-1 flex items-center justify-between border-t border-[#1e2736]">
                    <button
                      type="button"
                      onClick={() => handleCopyLabel(sale)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                        isCopied
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
                          : "bg-[#181d26] text-pink-400 border border-[#2b374a] hover:bg-pink-500/10 hover:border-pink-500/40"
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Etiqueta Copiada!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copiar Etiqueta de Envio</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingSale(sale)}
                        className="px-2.5 py-1.5 rounded-xl bg-[#181d26] border border-[#2b374a] text-xs font-semibold text-[#8e8e93] hover:text-white hover:bg-[#222a38] transition-colors cursor-pointer"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const confirm = window.confirm(
                            `Deseja realmente EXCLUIR a venda de "${sale.customerName}"?`
                          );
                          if (confirm) {
                            await deleteSale(sale.id);
                          }
                        }}
                        className="p-1.5 rounded-xl text-[#71717a] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Excluir venda"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DE NOVA VENDA */}
      <CreateClothingSaleModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={createSale}
      />

      {/* MODAL DE EDIÇÃO */}
      <EditClothingSaleModal
        isOpen={Boolean(editingSale)}
        onClose={() => setEditingSale(null)}
        sale={editingSale}
        onUpdate={updateSale}
        onDelete={deleteSale}
      />
    </div>
  );
}
