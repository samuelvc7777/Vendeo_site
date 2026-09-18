"use client";

import React from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, Star, ShieldCheck, MapPin, Truck, MessageCircle, ShoppingBag, ArrowRight } from "lucide-react";
import { Product } from "@/domain/entities/Product";
import { formatCurrency } from "@/lib/utils";

interface ProductDrawerProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
  onOpenChat?: (product: Product) => void;
}

export function ProductDrawer({
  product,
  isOpen,
  onClose,
  onAddToCart,
  onOpenChat,
}: ProductDrawerProps) {
  if (!product) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          {/* Drawer com física de toque */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="relative w-full sm:max-w-[430px] bg-slate-900 border-t border-slate-800 rounded-t-[32px] overflow-hidden flex flex-col max-h-[88vh] shadow-2xl z-10"
          >
            {/* Puxador tátil */}
            <div className="w-full pt-3 pb-2 flex justify-center cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-slate-700 rounded-full" />
            </div>

            {/* Fechar */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white z-20 border border-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Conteúdo com Scroll */}
            <div className="overflow-y-auto px-5 pb-6 pt-1 space-y-4 scrollbar-none">
              <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800">
                <Image
                  src={product.image}
                  alt={product.title}
                  fill
                  className="object-cover"
                />
                <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-xl text-xs font-semibold text-emerald-400 flex items-center gap-1 border border-white/10">
                  <Star className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                  {product.rating} ({product.reviewsCount} avaliações)
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-black text-emerald-400">
                    {formatCurrency(product.price)}
                  </span>
                  {product.originalPrice && (
                    <span className="text-sm text-slate-500 line-through">
                      {formatCurrency(product.originalPrice)}
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-white mt-1 leading-snug">
                  {product.title}
                </h2>
              </div>

              {/* Vendedor */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10 rounded-full overflow-hidden border border-emerald-500/30">
                    <Image
                      src={product.seller.avatar}
                      alt={product.seller.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-white">
                        {product.seller.name}
                      </span>
                      {product.seller.verified && (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-500" />
                      {product.location}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => onOpenChat?.(product)}
                  className="px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1 transition-colors cursor-pointer active:scale-95"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                  Chat
                </button>
              </div>

              {/* Benefícios Rápidos */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Envio Rápido</p>
                    <p className="text-[10px] text-slate-400">Postagem em 24h</p>
                  </div>
                </div>
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-200">Compra Segura</p>
                    <p className="text-[10px] text-slate-400">Garantia Vendeo</p>
                  </div>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Descrição
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {product.description}
                </p>
              </div>

              {/* Ação de Compra */}
              <div className="pt-2 flex items-center gap-3">
                <button
                  onClick={() => {
                    onAddToCart(product);
                    onClose();
                  }}
                  className="flex-1 py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all cursor-pointer"
                >
                  <ShoppingBag className="w-4 h-4 stroke-[2.5]" />
                  Comprar Agora
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
