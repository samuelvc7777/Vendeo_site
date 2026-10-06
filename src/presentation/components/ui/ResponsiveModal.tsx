"use client";

import React, { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/presentation/hooks/useIsMobile";

export interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl";
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
}

const maxWidthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

/**
 * Componente modal adaptativo reutilizável:
 * - Desktop: Dialog centralizado clássico com backdrop e animação suave.
 * - Mobile: Bottom Sheet nativo deslizante de baixo para cima com drag-to-dismiss,
 *   drag handle, cantos superiores arredondados e respeito integral à safe-area.
 */
export function ResponsiveModal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  maxWidth = "lg",
  showCloseButton = true,
  className = "",
  bodyClassName = "",
}: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  // Fecha ao pressionar Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      // Evita scroll da página de fundo enquanto o modal/sheet está aberto
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center overflow-hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
          />

          {/* Modal / Bottom Sheet Body */}
          {isMobile ? (
            /* MOBILE: Bottom Sheet com drag to dismiss */
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 350 }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100 || info.velocity.y > 600) {
                  onClose();
                }
              }}
              className={`relative w-full max-h-[92dvh] bg-white dark:bg-[#121214] border-t border-zinc-200 dark:border-[#262626] rounded-t-3xl shadow-2xl flex flex-col z-10 overflow-hidden pb-[calc(env(safe-area-inset-bottom,16px)+8px)] ${className}`}
            >
              {/* Drag Handle tátil */}
              <div className="pt-2.5 pb-1 flex justify-center shrink-0 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
              </div>

              {/* Header Mobile */}
              {(title || showCloseButton) && (
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-100 dark:border-[#1e1e22] shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    {icon && <div className="shrink-0">{icon}</div>}
                    <div className="min-w-0">
                      {title && (
                        <h2 className="text-base font-bold text-zinc-950 dark:text-white truncate">
                          {title}
                        </h2>
                      )}
                      {description && (
                        <p className="text-xs text-zinc-500 dark:text-[#8e8e93] truncate">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>

                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white active:scale-90 transition-all cursor-pointer"
                      aria-label="Fechar"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Corpo com scroll suave */}
              <div
                className={`flex-1 overflow-y-auto overscroll-contain p-4 no-scrollbar ${bodyClassName}`}
              >
                {children}
              </div>

              {/* Footer opcional */}
              {footer && (
                <div className="px-4 pt-2.5 pb-1 border-t border-zinc-100 dark:border-[#1e1e22] shrink-0 bg-zinc-50/50 dark:bg-[#161618]">
                  {footer}
                </div>
              )}
            </motion.div>
          ) : (
            /* DESKTOP: Centered Dialog com bordas e cantos arredondados */
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={`relative w-full ${maxWidthMap[maxWidth]} max-h-[88vh] bg-white dark:bg-[#121214] border border-zinc-200 dark:border-[#262626] rounded-2xl shadow-2xl flex flex-col z-10 overflow-hidden mx-4 my-8 ${className}`}
            >
              {/* Header Desktop */}
              {(title || showCloseButton) && (
                <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-[#262626] shrink-0">
                  <div className="flex items-center gap-3 min-w-0 pr-3">
                    {icon && <div className="shrink-0">{icon}</div>}
                    <div className="min-w-0">
                      {title && (
                        <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                          {title}
                        </h2>
                      )}
                      {description && (
                        <p className="text-xs text-zinc-500 dark:text-[#8e8e93] mt-0.5">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>

                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1.5 rounded-lg text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#262626] transition-colors cursor-pointer"
                      aria-label="Fechar"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Corpo Desktop */}
              <div className={`flex-1 overflow-y-auto p-5 ${bodyClassName}`}>
                {children}
              </div>

              {/* Footer Desktop */}
              {footer && (
                <div className="px-5 py-3 border-t border-zinc-200 dark:border-[#262626] shrink-0 bg-zinc-50/50 dark:bg-[#161618]">
                  {footer}
                </div>
              )}
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}
