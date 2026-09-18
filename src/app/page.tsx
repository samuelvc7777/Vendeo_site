"use client";

import React, { useState } from "react";
import { TabType } from "@/presentation/types";
import { BottomNav } from "@/presentation/components/layout/BottomNav";
import { InstagramDirect } from "@/presentation/components/chat/InstagramDirect";
import { ConfigView } from "@/presentation/components/config/ConfigView";
import { SalesView } from "@/presentation/components/sales/SalesView";
import { NetworkBanner } from "@/presentation/components/ui/NetworkBanner";
import { ErrorBoundary } from "@/presentation/components/ui/ErrorBoundary";
import { LoadingProvider } from "@/presentation/context/LoadingContext";
import { Store, Sparkles } from "lucide-react";

export default function Home() {
  const [currentTab, setCurrentTab] = useState<TabType>("chat");
  const [isChatRoomOpen, setIsChatRoomOpen] = useState(false);

  return (
    <ErrorBoundary>
      <LoadingProvider>
        <div className="flex flex-col h-full w-full overflow-hidden bg-black text-white relative">
        {/* Banner Fino e Elegante de Status de Conexão */}
        <NetworkBanner />

        {/* Header Fixo (apenas na aba Vendas) */}
        {currentTab === "vendas" && (
          <header className="shrink-0 px-4 py-3 bg-black border-b border-[#262626] flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">Vendeo</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Rifas
              </span>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#1c1c1e] border border-[#262626] text-[#a8a8a8] font-semibold">
              Área de Vendas
            </span>
          </header>
        )}

        {/* Conteúdo com scroll 100% isolado (a navbar fica do lado de fora) */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {currentTab === "vendas" && (
            <SalesView />
          )}

          {currentTab === "chat" && (
            <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col">
              <InstagramDirect onChatOpenChange={setIsChatRoomOpen} />
            </div>
          )}

          {currentTab === "config" && (
            <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col">
              <ConfigView />
            </div>
          )}
        </div>

        {/* Navegação Inferior Fixa: some automaticamente ao abrir uma conversa */}
        {!isChatRoomOpen && (
          <BottomNav
            currentTab={currentTab}
            onTabChange={setCurrentTab}
          />
        )}
      </div>
      </LoadingProvider>
    </ErrorBoundary>
  );
}
