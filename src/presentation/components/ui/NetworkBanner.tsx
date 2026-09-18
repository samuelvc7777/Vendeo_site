"use client";

import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff, CheckCircle2 } from "lucide-react";
import { useNetworkStatus } from "@/presentation/hooks/useNetworkStatus";

interface NetworkBannerProps {
  className?: string;
}

export function NetworkBanner({ className = "" }: NetworkBannerProps) {
  const { isOnline, wasOffline } = useNetworkStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const reconnectedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isOnline) {
      // Ficou offline: cancela timer de reconexão se houver
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
        reconnectedTimerRef.current = null;
      }
      setShowReconnected(false);
    } else if (isOnline && wasOffline) {
      // Conexão restabelecida após ter ficado offline
      setShowReconnected(true);

      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
      }

      reconnectedTimerRef.current = setTimeout(() => {
        setShowReconnected(false);
        reconnectedTimerRef.current = null;
      }, 2500);
    }

    return () => {
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
      }
    };
  }, [isOnline, wasOffline]);

  // Se estiver online e não estiver no período de feedback de reconexão, não exibe nada
  const isVisible = !isOnline || showReconnected;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={!isOnline ? "offline-banner" : "reconnected-banner"}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className={`w-full overflow-hidden shrink-0 z-50 select-none ${className}`}
        >
          {!isOnline ? (
            <div className="w-full bg-amber-950/90 border-b border-amber-500/40 text-amber-200 px-3 py-1.5 flex items-center justify-center gap-2 text-[11px] font-medium tracking-tight shadow-sm backdrop-blur-md">
              <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-pulse" />
              <span className="truncate">
                Sem conexão com a internet. Tentando reconectar...
              </span>
            </div>
          ) : (
            <div className="w-full bg-emerald-950/90 border-b border-emerald-500/40 text-emerald-200 px-3 py-1.5 flex items-center justify-center gap-2 text-[11px] font-medium tracking-tight shadow-sm backdrop-blur-md">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">Conexão restabelecida</span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
