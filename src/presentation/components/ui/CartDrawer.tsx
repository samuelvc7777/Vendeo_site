"use client";

import React from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, ShieldCheck, Truck } from "lucide-react";
import { Cart } from "@/domain/entities/Cart";
import { formatCurrency } from "@/lib/utils";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: Cart;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
}

export function CartDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
}: CartDrawerProps) {
  const { items, totalPrice, totalQuantity, freeShippingQualified } = cart;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative w-full sm:max-w-[430px] bg-slate-900 border-t border-slate-800 rounded-t-[32px] flex flex-col max-h-[85vh] shadow-2xl z-10"
          >
            {/* Top Bar */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-emerald-400" />
                <h3 className="font-extrabold text-white text-base">Sua Sacola</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                  {totalQuantity}
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Itens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
              {items.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-800/80 flex items-center justify-center mb-3">
                    <ShoppingBag className="w-8 h-8 text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">
                    Sua sacola está vazia
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                    Explore os produtos em destaque e adicione à sua sacola.
                  </p>
                </div>
              ) : (
                items.map(({ product, quantity }) => (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-2.5"
                  >
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-900 shrink-0">
                      <Image
                        src={product.image}
                        alt={product.title}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-semibold text-white truncate">
                        {product.title}
                      </h4>
                      <p className="text-xs font-extrabold text-emerald-400 mt-0.5">
                        {formatCurrency(product.price)}
                      </p>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-2 py-1 border border-slate-700/60">
                          <button
                            onClick={() => onUpdateQuantity(product.id, -1)}
                            className="text-slate-400 hover:text-white active:scale-90 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-bold text-white px-1">
                            {quantity}
                          </span>
                          <button
                            onClick={() => onUpdateQuantity(product.id, 1)}
                            className="text-slate-400 hover:text-white active:scale-90 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        <button
                          onClick={() => onRemoveItem(product.id)}
                          className="text-slate-500 hover:text-rose-400 active:scale-90 transition-colors p-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Rodapé com Resumo e Regra de Domínio de Frete Grátis */}
            {items.length > 0 && (
              <div className="p-4 border-t border-slate-800 bg-slate-900/95 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5 text-emerald-400" />
                    Frete Express
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {freeShippingQualified ? "Grátis" : "R$ 19,90"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Subtotal</span>
                  <span className="text-lg font-black text-emerald-400">
                    {formatCurrency(totalPrice)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 justify-center">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Transação 100% protegida pelo Vendeo Pay
                </div>

                <button
                  onClick={onCheckout}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer"
                >
                  Finalizar Pedido
                  <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
