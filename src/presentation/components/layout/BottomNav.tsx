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
      className="shrink-0 h-13 w-full bg-black border-t border-[#262626] flex items-center justify-around px-6 z-50 select-none"
    >
      {/* Aba Vendas */}
      <button
        onClick={() => onTabChange("vendas")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "vendas" ? "text-white" : "text-[#737373] hover:text-[#a8a8a8]"
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
            currentTab === "vendas" ? "font-bold text-white" : "font-medium text-[#737373]"
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
          currentTab === "chat" ? "text-white" : "text-[#737373] hover:text-[#a8a8a8]"
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
            <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-[#0095f6] rounded-full ring-2 ring-black" />
          )}
        </div>
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "chat" ? "font-bold text-white" : "font-medium text-[#737373]"
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
          currentTab === "config" ? "text-white" : "text-[#737373] hover:text-[#a8a8a8]"
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
            currentTab === "config" ? "font-bold text-white" : "font-medium text-[#737373]"
          )}
        >
          Config
        </span>
      </button>
    </nav>
  );
}
