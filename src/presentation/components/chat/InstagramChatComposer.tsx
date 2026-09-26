"use client";

import React, { useState, useRef, useImperativeHandle, forwardRef, memo } from "react";
import { MessageSquareText, Paperclip, Sparkles, Loader2, Mic } from "lucide-react";

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
  onOpenAiAssistant: () => void;
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
      onOpenAiAssistant,
    },
    ref
  ) {
    const [inputText, setInputText] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        appendText: (text: string) => {
          setInputText((prev) => (prev ? `${prev} ${text}` : text));
          inputRef.current?.focus();
        },
        setText: (text: string) => {
          setInputText(text);
          inputRef.current?.focus();
        },
        clear: () => {
          setInputText("");
        },
        focus: () => {
          inputRef.current?.focus();
        },
      }),
      []
    );

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if ((!inputText.trim() && !hasPendingImage) || isUploadingMedia) return;
      const textToSend = inputText.trim();
      setInputText("");
      await onSendMessage(textToSend);
    };

    const placeholderText = isUploadingMedia
      ? "Enviando..."
      : hasPendingImage
      ? "Adicionar legenda à foto..."
      : replyingToName
      ? `Respondendo a ${replyingToName}...`
      : "Mensagem...";

    return (
      <form onSubmit={handleSubmit} className="p-3 flex items-center gap-2">
        <div className="flex-1 bg-[#1c1c1e] border border-[#262626] rounded-full px-3.5 py-2 flex items-center gap-2.5">
          {/* Botão de abrir Pastas e Cofre Flutuante de Respostas Rápidas / Mídias */}
          <button
            type="button"
            onClick={onOpenVault}
            disabled={isUploadingMedia}
            className="text-[#a8a8a8] hover:text-[#0095f6] active:scale-90 transition-all cursor-pointer p-0.5 disabled:opacity-40"
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
            className="text-[#a8a8a8] hover:text-white active:scale-90 transition-all cursor-pointer p-0.5"
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

          {/* Campo de texto Isolado (digitação em 0ms sem re-renderizar o histórico do chat) */}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={placeholderText}
            disabled={isUploadingMedia}
            className="flex-1 bg-transparent text-sm text-white placeholder-[#737373] focus:outline-none disabled:opacity-50"
          />

          {/* Assistente de IA Contextual */}
          <button
            type="button"
            onClick={onOpenAiAssistant}
            title="Abrir Assistente de IA Contextual"
            className="text-amber-300 hover:text-amber-200 active:scale-90 transition-colors p-0.5 cursor-pointer"
          >
            <Sparkles className="w-5 h-5 stroke-[1.8] text-amber-300" />
          </button>

          {/* Spinner de Upload quando estiver enviando mídia */}
          {isUploadingMedia && (
            <div className="p-0.5 text-zinc-400" title="Enviando...">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}

          {/* Ao digitar ou ter foto pendente, surge o botão Enviar; sem texto nem foto, microfone */}
          {inputText.trim() || hasPendingImage ? (
            <button
              type="submit"
              disabled={isUploadingMedia}
              className="text-[#0095f6] font-semibold text-sm px-1 hover:text-[#1877f2] active:scale-95 transition-all cursor-pointer"
            >
              Enviar
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartRecording}
              disabled={isUploadingMedia}
              title="Gravar mensagem de voz"
              className="text-[#a8a8a8] hover:text-white active:scale-90 transition-all p-0.5 cursor-pointer disabled:opacity-40"
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
