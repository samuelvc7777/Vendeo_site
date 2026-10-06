"use client";

import React from "react";
import { Flame, Store, MessageSquare, Settings } from "lucide-react";
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
  const isWhatsApp2RemoteBuild = process.env.NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL === "/wa2";
  const activeTabClass = isWhatsApp2RemoteBuild
    ? "text-[#00a884] dark:text-[#25d366]"
    : "text-zinc-950 dark:text-white";
  const inactiveTabClass = isWhatsApp2RemoteBuild
    ? "text-[#8e8e93] hover:text-[#636366] dark:text-[#8e8e93] dark:hover:text-[#aeaeb2]"
    : "text-zinc-500 dark:text-[#737373] hover:text-zinc-700 dark:hover:text-[#a8a8a8]";

  return (
    <nav
      aria-label="Navegação Principal"
      className={cn(
        "shrink-0 w-full border-t flex items-center justify-around px-6 z-50 select-none backdrop-blur-xl pb-[env(safe-area-inset-bottom,0px)]",
        isWhatsApp2RemoteBuild
          ? "h-[calc(58px+env(safe-area-inset-bottom,0px))] bg-[#f9f9f9]/[0.94] border-[#c6c6c8]/70 dark:bg-[#1c1c1e]/[0.94] dark:border-[#38383a]"
          : "h-[calc(52px+env(safe-area-inset-bottom,0px))] bg-white/95 dark:bg-black border-zinc-200 dark:border-[#262626]"
      )}
    >
      {/* Aba Vendas */}
      <button
        onClick={() => onTabChange("vendas")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "vendas" ? activeTabClass : inactiveTabClass
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
            currentTab === "vendas" ? `font-semibold ${activeTabClass}` : `font-medium ${inactiveTabClass}`
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
          currentTab === "chat" ? activeTabClass : inactiveTabClass
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
            <span className={cn(
              "absolute -top-0.5 -right-1 w-2 h-2 rounded-full ring-2 ring-white dark:ring-black",
              isWhatsApp2RemoteBuild ? "bg-[#25d366]" : "bg-[#0095f6]"
            )} />
          )}
        </div>
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "chat" ? `font-semibold ${activeTabClass}` : `font-medium ${inactiveTabClass}`
          )}
        >
          {isWhatsApp2RemoteBuild ? "Conversas" : "Chat"}
        </span>
      </button>

      {/* Aba Match */}
      <button
        onClick={() => onTabChange("match")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "match" ? activeTabClass : inactiveTabClass
        )}
      >
        <Flame
          className={cn(
            "w-5 h-5 transition-transform group-active:scale-90",
            currentTab === "match" ? "stroke-[2.5] fill-current" : "stroke-[1.8]"
          )}
        />
        <span
          className={cn(
            "text-[10px] tracking-tight leading-none",
            currentTab === "match" ? `font-semibold ${activeTabClass}` : `font-medium ${inactiveTabClass}`
          )}
        >
          Match
        </span>
      </button>

      {/* Aba Config */}
      <button
        onClick={() => onTabChange("config")}
        className={cn(
          "flex flex-col items-center justify-center py-1 gap-1 transition-colors cursor-pointer group flex-1",
          currentTab === "config" ? activeTabClass : inactiveTabClass
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
            currentTab === "config" ? `font-semibold ${activeTabClass}` : `font-medium ${inactiveTabClass}`
          )}
        >
          Config
        </span>
      </button>
    </nav>
  );
}
