"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Trash2, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const WALLPAPER_STORAGE_KEY = "vendeo_whatsapp_wallpaper";

export function getWhatsAppWallpaper(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(WALLPAPER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setWhatsAppWallpaper(dataUrl: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (dataUrl) {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, dataUrl);
    } else {
      localStorage.removeItem(WALLPAPER_STORAGE_KEY);
    }
    // Dispara evento para componentes ouvintes atualizarem
    window.dispatchEvent(new CustomEvent("vendeo-wallpaper-change"));
  } catch (err) {
    console.error("Erro ao salvar wallpaper:", err);
    toast.error("Erro ao salvar imagem. Tente uma imagem menor.");
  }
}

export function WhatsAppWallpaperManager() {
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWallpaper(getWhatsAppWallpaper());

    const handleChange = () => {
      setWallpaper(getWhatsAppWallpaper());
    };

    window.addEventListener("vendeo-wallpaper-change", handleChange);
    return () => window.removeEventListener("vendeo-wallpaper-change", handleChange);
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validações
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione apenas arquivos de imagem");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }

    setIsUploading(true);

    try {
      // Converte para base64 e redimensiona se necessário
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            // Redimensiona se for muito grande (max 1920px)
            const maxSize = 1920;
            let width = img.width;
            let height = img.height;

            if (width > maxSize || height > maxSize) {
              if (width > height) {
                height = (height / width) * maxSize;
                width = maxSize;
              } else {
                width = (width / height) * maxSize;
                height = maxSize;
              }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Erro ao processar imagem"));
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.onerror = () => reject(new Error("Erro ao carregar imagem"));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
        reader.readAsDataURL(file);
      });

      setWhatsAppWallpaper(dataUrl);
      setWallpaper(dataUrl);
      toast.success("Foto de fundo atualizada com sucesso!");
    } catch (err) {
      console.error("Erro ao processar imagem:", err);
      toast.error("Erro ao processar imagem. Tente outra.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, []);

  const handleRemove = useCallback(() => {
    setWhatsAppWallpaper(null);
    setWallpaper(null);
    toast.success("Foto de fundo removida");
  }, []);

  return (
    <article className="relative min-w-0 overflow-hidden rounded-[26px] border border-emerald-200/80 dark:border-emerald-500/15 bg-gradient-to-br from-white via-white to-emerald-50/70 dark:from-[#121214] dark:via-[#111113] dark:to-[#0f1813] p-4 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500" />

      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-zinc-950 dark:text-white">Foto de Fundo do Chat</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Personalize o fundo das conversas do WhatsApp
            </p>
          </div>
        </div>
        {wallpaper && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/25 bg-white/80 dark:bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Ativo
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800/80 pt-4 space-y-4">
        {/* Preview */}
        {wallpaper ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-zinc-900">
            <img
              src={wallpaper}
              alt="Preview do wallpaper"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                Preview
              </span>
              <button
                type="button"
                onClick={handleRemove}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/90 text-white shadow-lg transition hover:bg-red-600 active:scale-95"
                title="Remover foto de fundo"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-white/15 bg-zinc-50 dark:bg-white/[0.03] text-zinc-400 dark:text-zinc-500">
            <ImageIcon className="h-8 w-8 opacity-50" />
            <p className="text-xs font-medium">Nenhuma foto de fundo definida</p>
            <p className="text-[10px] opacity-70">O padrão do WhatsApp será usado</p>
          </div>
        )}

        {/* Botão de Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-500 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Processando...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              {wallpaper ? "Trocar foto de fundo" : "Escolher foto de fundo"}
            </>
          )}
        </button>

        <p className="text-center text-[10px] text-zinc-400 dark:text-zinc-500">
          Formatos: JPG, PNG, WebP · Máximo: 5MB · Recomendado: 1920x1080px
        </p>
      </div>
    </article>
  );
}