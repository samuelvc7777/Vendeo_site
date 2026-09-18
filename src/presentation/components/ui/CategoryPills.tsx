"use client";

import React from "react";
import { Category } from "@/domain/entities/Category";
import { Sparkles, Smartphone, Shirt, Home, Car, Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryPillsProps {
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Sparkles,
  Smartphone,
  Shirt,
  Home,
  Car,
  Gamepad2,
};

export function CategoryPills({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategoryPillsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2 px-4 scrollbar-none select-none">
      {categories.map((cat) => {
        const IconComponent = ICON_MAP[cat.icon] || Sparkles;
        const isSelected = selectedCategory === cat.id;

        return (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all duration-200 active:scale-95 cursor-pointer shrink-0 border",
              isSelected
                ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20"
                : "bg-slate-800/80 text-slate-300 border-slate-700/60 hover:bg-slate-800 hover:text-white"
            )}
          >
            <IconComponent className={cn("w-3.5 h-3.5", isSelected ? "text-slate-950" : "text-emerald-400")} />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
