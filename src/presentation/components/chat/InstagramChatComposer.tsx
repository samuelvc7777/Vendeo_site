"use client";

import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, memo } from "react";
import { MessageSquareText, Paperclip, Loader2, Mic, Send, Plus, Camera, SquareTerminal, Sticker } from "lucide-react";
import { useVisualViewport } from "@/presentation/hooks/useVisualViewport";
import { useIsMobile } from "@/presentation/hooks/useIsMobile";

export interface InstagramChatComposerRef {
  appendText: (text: string) => void;
  setText: (text: string) => void;
  clear: () => void;
  focus: () => void;
}

export interface InstagramChatComposerProps {
  isUploadingMedia: boolean;
  hasPendingImage: boolean;
  replyingToName?: string | null;
  onSendMessage: (text: string) => Promise<void> | void;
  onSelectImage: (file: File) => void;
  onSelectMediaFile: (file: File) => void;
  onStartRecording: () => void;
  onOpenVault: () => void;
  onOpenConsole?: () => void;
  onOpenStickers?: () => void;
  variant?: "instagram" | "whatsapp";
}

export const InstagramChatComposer = memo(
  forwardRef<InstagramChatComposerRef, InstagramChatComposerProps>(function InstagramChatComposer(
    {
      isUploadingMedia,
      hasPendingImage,
      replyingToName,
      onSendMessage,
      onSelectImage,
      onSelectMediaFile,
      onStartRecording,
      onOpenVault,
      onOpenConsole,
      onOpenStickers,
      variant = "instagram",
    },
    ref
  ) {
    const [inputText, setInputText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
    const { isKeyboardOpen } = useVisualViewport();
    const isMobile = useIsMobile();

    // Auto-resize dinâmico do textarea de 1 linha até ~120px (3 a 5 linhas)
    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 120);
      textarea.style.height = `${newHeight}px`;
    }, [inputText]);

    useImperativeHandle(
      ref,
      () => ({
        appendText: (text: string) => {
          setInputText((prev) => (prev ? `${prev} ${text}` : text));
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        },
        setText: (text: string) => {
          setInputText(text);
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        },
        clear: () => {
          setInputText("");
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
        },
        focus: () => {
          textareaRef.current?.focus();
        },
      }),
      []
    );

    const handleSubmit = async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if ((!inputText.trim() && !hasPendingImage) || isUploadingMedia) return;
      const textToSend = inputText.trim();
      setInputText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      await onSendMessage(textToSend);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // No Desktop: Enter envia a mensagem, Shift+Enter quebra a linha
      if (!isMobile && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
      // No Mobile: Enter apenas insere quebra de linha naturalmente, e o envio é feito pelo botão tátil de Enviar
    };

    const placeholderText = isUploadingMedia
      ? "Enviando..."
      : hasPendingImage
      ? "Adicionar legenda à foto..."
      : replyingToName
      ? `Respondendo a ${replyingToName}...`
      : variant === "whatsapp"
      ? "Mensagem"
      : "Mensagem...";

    if (variant === "whatsapp") {
      return (
        <form
          onSubmit={handleSubmit}
          className={`whatsapp-ios relative flex items-end gap-2 bg-transparent px-2.5 pt-1.5 transition-[padding] duration-150 ${
            isKeyboardOpen
              ? "pb-2"
              : "pb-[calc(8px+env(safe-area-inset-bottom,0px))]"
          }`}
        >
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelectImage(file);
              e.target.value = "";
            }}
          />
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*,audio/*,application/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelectMediaFile(file);
              e.target.value = "";
            }}
          />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsAttachmentMenuOpen((open) => !open)}
              disabled={isUploadingMedia}
              className="wa-ios-glass mb-0.5 flex h-10 w-10 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Anexar"
              aria-expanded={isAttachmentMenuOpen}
            >
              <Plus className={`h-6 w-6 stroke-[1.9] transition-transform duration-200 ${isAttachmentMenuOpen ? "rotate-45" : ""}`} />
            </button>

            {isAttachmentMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Fechar anexos"
                  onClick={() => setIsAttachmentMenuOpen(false)}
                />
                <div className="wa-ios-glass absolute bottom-12 left-0 z-50 w-52 overflow-hidden rounded-[20px] p-1.5 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAttachmentMenuOpen(false);
                      onOpenVault();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#111b21] hover:bg-black/[0.05] active:scale-[0.985] dark:text-white dark:hover:bg-white/[0.06]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5856d6] text-white">
                      <MessageSquareText className="h-4 w-4" />
                    </span>
                    <span className="font-medium">Cofre</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAttachmentMenuOpen(false);
                      imageInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#111b21] hover:bg-black/[0.05] active:scale-[0.985] dark:text-white dark:hover:bg-white/[0.06]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#34c759] text-white">
                      <Camera className="h-4 w-4" />
                    </span>
                    <span className="font-medium">Fotos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAttachmentMenuOpen(false);
                      mediaInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#111b21] hover:bg-black/[0.05] active:scale-[0.985] dark:text-white dark:hover:bg-white/[0.06]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#007aff] text-white">
                      <Paperclip className="h-4 w-4" />
                    </span>
                    <span className="font-medium">Documento</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="wa-ios-glass flex min-h-10 flex-1 items-end rounded-[20px] px-3 py-[7px]">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              disabled={isUploadingMedia}
              className="min-w-0 flex-1 resize-none bg-transparent text-[16px] leading-5 text-[#111b21] placeholder-[#8e8e93] outline-none disabled:opacity-50 dark:text-white max-h-[120px] overflow-y-auto scrollbar-none py-0.5"
            />
            {isUploadingMedia ? (
              <Loader2 className="mb-1 ml-1 h-4 w-4 animate-spin text-[#8e8e93]" />
            ) : (
              <div className="ml-2 mb-0.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={onOpenStickers}
                  disabled={!onOpenStickers}
                  className="flex h-8 w-8 items-center justify-center text-[#007aff] transition-transform active:scale-90 disabled:opacity-35"
                  aria-label="Abrir figurinhas"
                  title="Figurinhas"
                >
                  <Sticker className="h-5 w-5 stroke-[1.8]" />
                </button>
                <button
                  type="button"
                  onClick={onOpenConsole}
                  disabled={!onOpenConsole}
                  className="flex h-8 w-8 items-center justify-center text-[#007aff] transition-transform active:scale-90 disabled:opacity-35"
                  aria-label="Abrir console do Brain"
                  title="Console do Brain"
                >
                  <SquareTerminal className="h-5 w-5 stroke-[1.8]" />
                </button>
              </div>
            )}
          </div>

          {inputText.trim() || hasPendingImage ? (
            <button
              type="submit"
              disabled={isUploadingMedia}
              className="wa-ios-glass mb-0.5 flex h-10 w-10 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Enviar mensagem"
            >
              <Send className="h-4 w-4 fill-current stroke-[1.5]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartRecording}
              disabled={isUploadingMedia}
              className="wa-ios-glass mb-0.5 flex h-10 w-10 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Gravar áudio"
            >
              <Mic className="h-6 w-6 stroke-[1.8]" />
            </button>
          )}
        </form>
      );
    }

    return (
      <form
        onSubmit={handleSubmit}
        className={`p-2.5 md:p-3 flex items-end gap-2 transition-[padding] duration-150 ${
          isKeyboardOpen
            ? "pb-2"
            : "pb-[calc(8px+env(safe-area-inset-bottom,0px))] md:pb-3"
        }`}
      >
        <div className="flex-1 bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-[22px] px-3.5 py-2 flex items-end gap-2.5 min-h-10">
          {/* Botão de abrir Pastas e Cofre Flutuante de Respostas Rápidas / Mídias */}
          <button
            type="button"
            onClick={onOpenVault}
            disabled={isUploadingMedia}
            className="mb-0.5 text-zinc-600 dark:text-[#a8a8a8] hover:text-[#0095f6] active:scale-90 transition-all cursor-pointer p-1 disabled:opacity-40 flex items-center justify-center"
            title="Abrir Pastas e Respostas Rápidas (Cofre)"
            aria-label="Abrir cofre de respostas e pastas"
          >
            <MessageSquareText className="w-5 h-5 stroke-[1.8]" />
          </button>

          {/* Input invisível de imagem da galeria */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onSelectImage(file);
                e.target.value = "";
              }
            }}
          />

          {/* Ícone de mandar outros arquivos / documentos */}
          <label
            className="mb-0.5 text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white active:scale-90 transition-all cursor-pointer p-1 flex items-center justify-center"
            title="Enviar documento ou mídia"
          >
            <Paperclip className="w-5 h-5 stroke-[1.8]" />
            <input
              type="file"
              accept="image/*,video/*,audio/*,application/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onSelectMediaFile(file);
                  e.target.value = "";
                }
              }}
            />
          </label>

          {/* Campo de texto multiline auto-expansível */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            disabled={isUploadingMedia}
            className="min-w-0 flex-1 resize-none bg-transparent text-[16px] md:text-sm leading-5 text-zinc-950 dark:text-white placeholder-[#737373] focus:outline-none disabled:opacity-50 max-h-[120px] overflow-y-auto scrollbar-none py-0.5"
          />

          {/* Spinner de Upload quando estiver enviando mídia */}
          {isUploadingMedia && (
            <div className="mb-1 p-0.5 text-zinc-600 dark:text-zinc-400" title="Enviando...">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}

          {/* Ao digitar ou ter foto pendente, surge o botão Enviar; sem texto nem foto, microfone */}
          {inputText.trim() || hasPendingImage ? (
            <button
              type="submit"
              disabled={isUploadingMedia}
              className="mb-0.5 text-[#0095f6] font-semibold text-sm px-2 py-1 hover:text-[#1877f2] active:scale-95 transition-all cursor-pointer disabled:opacity-40 min-h-[36px] flex items-center justify-center"
              aria-label="Enviar mensagem"
            >
              Enviar
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartRecording}
              disabled={isUploadingMedia}
              title="Gravar mensagem de voz"
              className="mb-0.5 p-1 text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white active:scale-90 transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center min-w-[36px] min-h-[36px]"
              aria-label="Gravar áudio"
            >
              <Mic className="w-5 h-5 stroke-[1.8]" />
            </button>
          )}
        </div>
      </form>
    );
  })
);
