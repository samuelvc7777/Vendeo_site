"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { LoadingSpinner } from "@/presentation/components/ui/LoadingState";
import { AnimatePresence, motion } from "framer-motion";

interface LoadingContextType {
  isLoading: boolean;
  loadingMessage: string | null;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
  withLoading: <T>(action: () => Promise<T>, message?: string) => Promise<T>;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);

  const showLoading = useCallback((message?: string) => {
    setLoadingMessage(message || null);
    setIsLoading(true);
  }, []);

  const hideLoading = useCallback(() => {
    setIsLoading(false);
    setLoadingMessage(null);
  }, []);

  const withLoading = useCallback(
    async <T,>(action: () => Promise<T>, message?: string): Promise<T> => {
      showLoading(message);
      try {
        return await action();
      } finally {
        hideLoading();
      }
    },
    [showLoading, hideLoading]
  );

  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        loadingMessage,
        showLoading,
        hideLoading,
        withLoading,
      }}
    >
      {children}

      {/* Overlay Global com Backdrop Blur Suave */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm select-none"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-[#141414] border border-[#262626] shadow-2xl min-w-[140px] text-center"
            >
              <LoadingSpinner size="lg" />
              {loadingMessage && (
                <p className="text-xs text-zinc-300 font-medium tracking-tight">
                  {loadingMessage}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error("useLoading deve ser utilizado dentro de um LoadingProvider");
  }
  return context;
}
