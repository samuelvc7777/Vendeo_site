"use client";

import React from "react";
import { Store, MessageSquare, Settings } from "lucide-react";
import { TabType } from "@/presentation/types";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  unreadChatCount?: number;
}

export function BottomNav({
  currentTab,
  onTabChange,
  unreadChatCount = 0,
}: BottomNavProps) {
  return (
    <nav
      aria-label="Navegação Principal"
      className="shrink-0 h-13 w-full bg-white/95 dark:bg-black border-t border-zinc-200 dark:border-[#262626] flex items-center justify-around px-6 z-50 select-none backdrop-blur-xl"
    >
      {/* Aba Vendas */}
      <button
        onClick={() => onTabChange("vendas")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "vendas" ? "text-zinc-950 dark:text-white" : "text-zinc-500 dark:text-[#737373] hover:text-zinc-700 dark:hover:text-[#a8a8a8]"
        )}
      >
        <Store
          className={cn(
            "w-5 h-5 transition-transform group-active:scale-90",
            currentTab === "vendas" ? "stroke-[2.5]" : "stroke-[1.8]"
          )}
        />
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "vendas" ? "font-bold text-zinc-950 dark:text-white" : "font-medium text-zinc-500 dark:text-[#737373]"
          )}
        >
          Vendas
        </span>
      </button>

      {/* Aba Chat */}
      <button
        onClick={() => onTabChange("chat")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group relative flex-1",
          currentTab === "chat" ? "text-zinc-950 dark:text-white" : "text-zinc-500 dark:text-[#737373] hover:text-zinc-700 dark:hover:text-[#a8a8a8]"
        )}
      >
        <div className="relative">
          <MessageSquare
            className={cn(
              "w-5 h-5 transition-transform group-active:scale-90",
              currentTab === "chat" ? "stroke-[2.5]" : "stroke-[1.8]"
            )}
          />
          {unreadChatCount > 0 && (
            <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-[#0095f6] rounded-full ring-2 ring-white dark:ring-black" />
          )}
        </div>
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "chat" ? "font-bold text-zinc-950 dark:text-white" : "font-medium text-zinc-500 dark:text-[#737373]"
          )}
        >
          Chat
        </span>
      </button>

      {/* Aba Config */}
      <button
        onClick={() => onTabChange("config")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "config" ? "text-zinc-950 dark:text-white" : "text-zinc-500 dark:text-[#737373] hover:text-zinc-700 dark:hover:text-[#a8a8a8]"
        )}
      >
        <Settings
          className={cn(
            "w-5 h-5 transition-transform group-active:scale-90",
            currentTab === "config" ? "stroke-[2.5]" : "stroke-[1.8]"
          )}
        />
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "config" ? "font-bold text-zinc-950 dark:text-white" : "font-medium text-zinc-500 dark:text-[#737373]"
          )}
        >
          Config
        </span>
      </button>
    </nav>
  );
}
