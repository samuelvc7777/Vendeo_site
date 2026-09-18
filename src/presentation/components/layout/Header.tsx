"use client";

import React, { useState } from "react";
import { Search, Bell, ShoppingBag, SlidersHorizontal, X } from "lucide-react";

interface HeaderProps {
  onSearchChange?: (query: string) => void;
  cartCount?: number;
  onOpenCart?: () => void;
  onOpenFilter?: () => void;
}

export function Header({
  onSearchChange,
  cartCount = 0,
  onOpenCart,
  onOpenFilter,
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    onSearchChange?.(val);
  };

  const clearSearch = () => {
    setSearchQuery("");
    onSearchChange?.("");
    setIsSearchOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Logo & Marca */}
        <div className="flex items-center gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Vendeo
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                CLEAN
              </span>
            </div>
          </div>
        </div>

        {/* Ações Rápidas no Topo */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white active:scale-90 transition-all border border-slate-700/50 cursor-pointer"
            aria-label="Buscar"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenFilter}
            className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white active:scale-90 transition-all border border-slate-700/50 cursor-pointer"
            aria-label="Filtros"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenCart}
            className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white active:scale-90 transition-all border border-slate-700/50 relative cursor-pointer"
            aria-label="Sacola"
          >
            <ShoppingBag className="w-4 h-4" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-slate-950 text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-slate-900 animate-in zoom-in">
                {cartCount}
              </span>
            )}
          </button>

          <button
            className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white active:scale-90 transition-all border border-slate-700/50 relative cursor-pointer"
            aria-label="Notificações"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-emerald-400 rounded-full ring-1 ring-slate-900" />
          </button>
        </div>
      </div>

      {/* Barra de Busca Expansível */}
      {isSearchOpen && (
        <div className="mt-3 relative animate-in fade-in slide-in-from-top-2 duration-200">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearch}
            placeholder="Buscar produtos, vendedores, cidades..."
            autoFocus
            className="w-full bg-slate-800/90 border border-slate-700 rounded-2xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-inner"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3.5 top-3 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </header>
  );
}
