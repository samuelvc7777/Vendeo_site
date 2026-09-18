"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  X,
  Flame,
  MapPin,
  Sparkles,
  User,
  Camera,
  MessageCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface TinderProfileData {
  id: string;
  fullName: string;
  username: string;
  avatar: string;
  photos?: string[];
  bio?: string;
  city?: string;
  lastActive?: string;
  type?: "tinder" | "instagram";
}

interface TinderProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: TinderProfileData | null;
}

export function TinderProfileModal({
  isOpen,
  onClose,
  profile,
}: TinderProfileModalProps) {
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  // Lista normalizada de fotos garantindo ao menos o avatar
  const photos = useMemo(() => {
    if (!profile) return [];
    if (profile.photos && profile.photos.length > 0) {
      return profile.photos;
    }
    return profile.avatar ? [profile.avatar] : [];
  }, [profile]);

  // URL otimizada para abertura do perfil no app do Instagram (Android e iOS) com fallback web
  const instagramProfileUrl = useMemo(() => {
    const raw = profile?.username || profile?.id || "";
    const cleanUsername = raw.replace(/^@/, "").trim();
    if (!cleanUsername) return "https://www.instagram.com/";

    const webUrl = `https://www.instagram.com/${cleanUsername}/`;
    const fallbackEncoded = encodeURIComponent(webUrl);

    if (typeof window !== "undefined") {
      const ua = navigator.userAgent || "";
      const isAndroid = /Android/i.test(ua);
      if (isAndroid) {
        return `intent://instagram.com/_u/${cleanUsername}#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=${fallbackEncoded};end`;
      }
    }
    return webUrl;
  }, [profile?.username, profile?.id]);

  // Reseta índice ao trocar de perfil ou abrir
  useEffect(() => {
    setActivePhotoIndex(0);
  }, [profile?.id, isOpen]);

  const handlePrev = useCallback(() => {
    setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  const handleNext = useCallback(() => {
    setActivePhotoIndex((prev) =>
      prev < photos.length - 1 ? prev + 1 : prev
    );
  }, [photos.length]);

  // Atalhos de teclado (Setas e Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  if (!isOpen || !profile) return null;

  const currentPhoto = photos[activePhotoIndex] || profile.avatar;
  const isInstagram = profile.type === "instagram";
  const isTinder = !isInstagram;
  const isAndroid = typeof window !== "undefined" && /Android/i.test(navigator.userAgent || "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Perfil de ${profile.fullName}`}
    >
      <div
        className="relative w-full max-w-md bg-[#111113] rounded-[28px] overflow-hidden border border-white/10 shadow-2xl flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ================= ÁREA VISUAL PRINCIPAL DA FOTO ================= */}
        <div className="relative w-full aspect-[3/4] max-h-[58dvh] bg-zinc-950 overflow-hidden shrink-0 select-none">
          {/* Foto Principal em Alta Resolução */}
          {currentPhoto ? (
            <Image
              src={currentPhoto}
              alt={`${profile.fullName} - Foto ${activePhotoIndex + 1}`}
              fill
              unoptimized
              priority
              className="object-cover transition-all duration-300"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 gap-2">
              <User className="w-16 h-16 text-zinc-600" />
              <span className="text-xs">Sem foto disponível</span>
            </div>
          )}

          {/* Barrinhas de Progresso / Stories no Topo */}
          {photos.length > 1 && (
            <div className="absolute top-3 inset-x-3 z-30 flex items-center gap-1.5">
              {photos.map((_, idx) => (
                <div
                  key={idx}
                  className="h-1 flex-1 rounded-full overflow-hidden bg-black/40 backdrop-blur-sm"
                >
                  <div
                    className={`h-full transition-all duration-200 ${
                      idx === activePhotoIndex
                        ? "bg-white shadow-sm"
                        : idx < activePhotoIndex
                        ? "bg-white/70"
                        : "bg-white/25"
                    }`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Botão Superior para Fechar */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-6 right-3.5 z-40 p-2.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 active:scale-90 transition-all cursor-pointer shadow-lg"
            title="Fechar perfil"
            aria-label="Fechar perfil"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>

          {/* Badge do Contador de Fotos */}
          {photos.length > 1 && (
            <div className="absolute top-6 left-3.5 z-30 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-white tracking-wide shadow-md">
              {activePhotoIndex + 1} / {photos.length}
            </div>
          )}

          {/* Áreas de Toque Invisíveis para Navegação (Esquerda e Direita) */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                disabled={activePhotoIndex === 0}
                className="absolute inset-y-0 left-0 w-1/2 z-20 cursor-pointer flex items-center justify-start pl-2 group disabled:cursor-default"
                aria-label="Foto anterior"
              >
                {activePhotoIndex > 0 && (
                  <span className="p-2 rounded-full bg-black/30 backdrop-blur-sm text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronLeft className="w-5 h-5" />
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={activePhotoIndex === photos.length - 1}
                className="absolute inset-y-0 right-0 w-1/2 z-20 cursor-pointer flex items-center justify-end pr-2 group disabled:cursor-default"
                aria-label="Próxima foto"
              >
                {activePhotoIndex < photos.length - 1 && (
                  <span className="p-2 rounded-full bg-black/30 backdrop-blur-sm text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="w-5 h-5" />
                  </span>
                )}
              </button>
            </>
          )}

          {/* Gradiente Inferior com Nome, Idade e Localização */}
          <div className="absolute bottom-0 inset-x-0 pt-20 pb-4 px-5 bg-gradient-to-t from-[#111113] via-[#111113]/80 to-transparent z-25 pointer-events-none">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-md">
                {profile.fullName}
              </h2>
              {isTinder ? (
                <span className="p-1 rounded-full bg-[#fe3c72]/20 border border-[#fe3c72]/30 flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4 text-[#fe3c72] fill-[#fe3c72]" />
                </span>
              ) : (
                <CheckCircle2 className="w-5 h-5 text-sky-400 shrink-0" />
              )}
            </div>

            <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-300 drop-shadow">
              {profile.city && (
                <span className="flex items-center gap-1 font-medium">
                  <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  {profile.city}
                </span>
              )}
              <span className="flex items-center gap-1 font-medium text-emerald-400">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {isTinder ? "Match no Tinder" : "Direct Instagram"}
              </span>
            </div>
          </div>
        </div>

        {/* ================= SEÇÃO ROLÁVEL DE INFORMAÇÕES ================= */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-none overscroll-contain bg-[#111113]">
          {/* Biografia / Sobre mim */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider uppercase text-zinc-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-rose-400" />
                Sobre mim
              </span>
              <span className="text-[10px] text-zinc-500 font-medium">
                {profile.bio ? "Bio do Tinder" : ""}
              </span>
            </div>

            {profile.bio && profile.bio.trim() ? (
              <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-white/5 text-zinc-200 text-sm leading-relaxed whitespace-pre-line shadow-inner">
                {profile.bio}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-zinc-900/40 border border-white/5 text-zinc-500 text-xs italic">
                Nenhuma biografia detalhada foi fornecida no Tinder ainda.
              </div>
            )}
          </div>

          {/* Miniaturas de Fotos Adicionais (se houver mais de 1) */}
          {photos.length > 1 && (
            <div className="space-y-2 pt-1">
              <span className="text-[11px] font-bold tracking-wider uppercase text-zinc-400 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-rose-400" />
                Fotos do Perfil ({photos.length})
              </span>
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                {photos.map((photoUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActivePhotoIndex(idx)}
                    className={`relative w-14 h-18 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer active:scale-95 ${
                      idx === activePhotoIndex
                        ? "border-[#fe3c72] ring-2 ring-[#fe3c72]/30 scale-105"
                        : "border-transparent opacity-60 hover:opacity-100"
                    }`}
                  >
                    <Image
                      src={photoUrl}
                      alt={`Miniatura ${idx + 1}`}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detalhes do Perfil / Resumo */}
          <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-zinc-900/40 border border-white/5">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Plataforma
              </span>
              <span className="text-zinc-200 font-semibold flex items-center gap-1 mt-0.5">
                {isTinder && <Flame className="w-3.5 h-3.5 text-[#fe3c72] fill-[#fe3c72]" />}
                {isTinder ? "Tinder Match" : "Instagram"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-900/40 border border-white/5">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Status
              </span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                Conectado
              </span>
            </div>
          </div>
        </div>

        {/* ================= BARRA DE AÇÃO INFERIOR ================= */}
        <div className="p-4 border-t border-white/10 bg-[#111113]/95 backdrop-blur-md shrink-0">
          {isInstagram ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-2.5 rounded-full font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-[#fd297b] via-[#ff5864] to-[#fe3c72] hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-rose-500/25 cursor-pointer select-none"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">Voltar para a conversa</span>
              </button>

              <a
                href={instagramProfileUrl}
                target={isAndroid ? undefined : "_blank"}
                rel="noopener noreferrer"
                className="w-full py-3 px-2.5 rounded-full font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-pink-500/25 cursor-pointer select-none"
                title="Abrir perfil no aplicativo do Instagram"
              >
                <svg
                  className="w-4 h-4 fill-none stroke-current stroke-2 shrink-0"
                  viewBox="0 0 24 24"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
                <span className="truncate">Abrir perfil no Instagram</span>
              </a>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 px-4 rounded-full font-bold text-sm text-white bg-gradient-to-r from-[#fd297b] via-[#ff5864] to-[#fe3c72] hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Voltar para a conversa</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
