"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Star, Heart, MapPin, CheckCircle2, ShoppingBag } from "lucide-react";
import { Product, calculateDiscount } from "@/domain/entities/Product";
import { formatCurrency } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
}

export function ProductCard({
  product,
  onSelect,
  onAddToCart,
}: ProductCardProps) {
  const [isFavorite, setIsFavorite] = useState(false);

  const discount = calculateDiscount(product.price, product.originalPrice);

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFavorite(!isFavorite);
  };

  return (
    <article
      onClick={() => onSelect(product)}
      className="group bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/5 active:scale-[0.98] cursor-pointer"
    >
      {/* Imagem do Produto */}
      <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
        <Image
          src={product.image}
          alt={product.title}
          fill
          sizes="(max-width: 480px) 50vw, 300px"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />

        {/* Badge de Desconto com regra de domínio */}
        {discount > 0 && (
          <span className="absolute top-2 left-2 bg-emerald-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-full shadow-md">
            -{discount}%
          </span>
        )}

        {/* Botão de Favorito */}
        <button
          onClick={toggleFavorite}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-slate-950/60 backdrop-blur-md flex items-center justify-center text-slate-300 hover:text-rose-400 active:scale-90 transition-all border border-white/10 cursor-pointer"
          aria-label="Favoritar"
        >
          <Heart
            className={`w-4 h-4 transition-colors ${
              isFavorite ? "fill-rose-500 text-rose-500" : ""
            }`}
          />
        </button>

        {/* Tag de Destaque */}
        {product.isFeatured && (
          <span className="absolute bottom-2 left-2 bg-slate-950/70 backdrop-blur-md text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-400/30 flex items-center gap-1">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> Destaque
          </span>
        )}
      </div>

      {/* Informações do Produto */}
      <div className="p-3 flex flex-col flex-1 justify-between gap-1.5">
        <div>
          <h3 className="text-xs font-semibold text-slate-100 line-clamp-2 leading-snug group-hover:text-emerald-400 transition-colors">
            {product.title}
          </h3>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
            <span className="truncate max-w-[90px]">{product.seller.name}</span>
            {product.seller.verified && (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            )}
            <span>•</span>
            <span className="flex items-center gap-0.5 truncate">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {product.location.split(",")[0]}
            </span>
          </div>
        </div>

        {/* Preço e Botão Rápido */}
        <div className="pt-1.5 border-t border-slate-700/40 flex items-center justify-between mt-auto">
          <div>
            {product.originalPrice && (
              <span className="text-[10px] text-slate-500 line-through block leading-none">
                {formatCurrency(product.originalPrice)}
              </span>
            )}
            <span className="text-sm font-extrabold text-emerald-400 leading-tight">
              {formatCurrency(product.price)}
            </span>
          </div>

          <button
            onClick={(e) => onAddToCart?.(product, e)}
            className="w-7 h-7 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 flex items-center justify-center active:scale-90 transition-all border border-emerald-500/20 cursor-pointer"
            title="Adicionar à Sacola"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
}
