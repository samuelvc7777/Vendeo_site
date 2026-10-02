"use client";

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Loader2, Sticker, Trash2, X } from "lucide-react";

export interface WhatsAppSavedSticker {
  id: string;
  stickerUrl: string;
  sourceMessageId?: string | null;
  title?: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
  createdAt?: string | null;
}

interface WhatsAppStickerTrayProps {
  open: boolean;
  stickers: WhatsAppSavedSticker[];
  loading?: boolean;
  sendingStickerId?: string | null;
  onClose: () => void;
  onSend: (sticker: WhatsAppSavedSticker) => void | Promise<void>;
  onDelete: (sticker: WhatsAppSavedSticker) => void | Promise<void>;
}

export function WhatsAppStickerTray({
  open,
  stickers,
  loading = false,
  sendingStickerId = null,
  onClose,
  onSend,
  onDelete,
}: WhatsAppStickerTrayProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Fechar figurinhas"
            className="absolute inset-0 z-[54] bg-black/[0.025]"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
            onClick={onClose}
          />
          <motion.section
            className="whatsapp-ios wa-ios-glass absolute bottom-[58px] left-2.5 right-2.5 z-[55] overflow-hidden rounded-[22px]"
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
            transition={reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 500, damping: 38, mass: 0.62 }}
          >
            <header className="flex items-center justify-between border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25d366]/12 text-[#00a884] dark:text-[#25d366]">
                  <Sticker className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[14px] font-semibold text-[#111b21] dark:text-white">
                    Figurinhas
                  </h3>
                  <p className="text-[10px] text-[#8e8e93]">
                    {stickers.length} salva{stickers.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#8e8e93] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="max-h-[310px] min-h-[170px] overflow-y-auto p-3 scrollbar-none">
              {loading ? (
                <div className="flex h-36 items-center justify-center text-[#8e8e93]">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : stickers.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center gap-2 px-6 text-center">
                  <Sticker className="h-8 w-8 text-[#c7c7cc]" />
                  <p className="text-[13px] font-medium text-[#3c3c43] dark:text-[#d1d1d6]">
                    Nenhuma figurinha salva ainda
                  </p>
                  <p className="max-w-xs text-[11px] leading-relaxed text-[#8e8e93]">
                    Quando chegar uma figurinha no chat, pressione nela e escolha “Salvar figurinha”.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                  {stickers.map((sticker) => {
                    const sending = sendingStickerId === sticker.id;
                    return (
                      <div key={sticker.id} className="group relative aspect-square">
                        <button
                          type="button"
                          disabled={Boolean(sendingStickerId)}
                          onClick={() => void onSend(sticker)}
                          className="flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] bg-black/[0.025] p-1 transition-all active:scale-[0.94] disabled:opacity-55 dark:bg-white/[0.035]"
                          title="Enviar figurinha"
                        >
                          <img
                            src={sticker.stickerUrl}
                            alt={sticker.title || "Figurinha"}
                            className="max-h-full max-w-full object-contain"
                            draggable={false}
                          />
                          {sending && (
                            <span className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/20 backdrop-blur-[1px]">
                              <Loader2 className="h-5 w-5 animate-spin text-white" />
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onDelete(sticker);
                          }}
                          className="absolute right-0 top-0 hidden h-6 w-6 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-[#ff3b30] text-white shadow-md transition-transform active:scale-90 group-hover:flex"
                          aria-label="Excluir figurinha"
                          title="Excluir figurinha"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
