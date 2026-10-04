"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  X,
  Flame,
  MapPin,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  User,
  Camera,
  MessageCircle,
  CheckCircle2,
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
  type?: "tinder" | "instagram" | "whatsapp2";
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

  if (!isOpen || !profile) return null;

  const photos =
    profile.photos && profile.photos.length > 0
      ? profile.photos
      : [profile.avatar || "/favicon.ico"];

  const handlePrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
  };

  const handleNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-sm sm:max-w-md h-full sm:h-[90vh] bg-[#111113] border border-zinc-800 rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Carrossel de Fotos Superior */}
        <div className="relative w-full h-[52vh] sm:h-[50%] shrink-0 bg-black overflow-hidden group">
          <Image
            src={photos[activePhotoIndex] || profile.avatar}
            alt={profile.fullName}
            fill
            unoptimized
            priority
            className="object-cover transition-all duration-300"
          />

          {/* Botão de Fechar */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-30 p-2 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:text-white hover:bg-black/70 transition-all cursor-pointer shadow-lg active:scale-90"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Indicadores de Barras de Story/Fotos no Topo */}
          {photos.length > 1 && (
            <div className="absolute top-2 inset-x-3 z-20 flex items-center gap-1.5 px-2">
              {photos.map((_, idx) => (
                <div
                  key={idx}
                  className="h-1 flex-1 rounded-full overflow-hidden bg-white/30 backdrop-blur-sm"
                >
                  <div
                    className={`h-full transition-all duration-300 ${
                      idx === activePhotoIndex
                        ? "bg-white shadow-sm"
                        : idx < activePhotoIndex
                        ? "bg-white/70"
                        : "bg-transparent"
                    }`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Controles de Navegação de Fotos */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrevPhoto}
                className="absolute left-0 top-0 bottom-0 w-1/3 z-20 flex items-center justify-start pl-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="Foto anterior"
              >
                {activePhotoIndex > 0 && (
                  <span className="p-2 rounded-full bg-black/40 backdrop-blur-sm text-white/90">
                    <ChevronLeft className="w-5 h-5" />
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleNextPhoto}
                className="absolute right-0 top-0 bottom-0 w-1/3 z-20 flex items-center justify-end pr-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="Próxima foto"
              >
                {activePhotoIndex < photos.length - 1 && (
                  <span className="p-2 rounded-full bg-black/40 backdrop-blur-sm text-white/90">
                    <ChevronRight className="w-5 h-5" />
                  </span>
                )}
              </button>
            </>
          )}

          {/* Gradiente Inferior com Nome e Localização */}
          <div className="absolute bottom-0 inset-x-0 pt-20 pb-4 px-5 bg-gradient-to-t from-[#111113] via-[#111113]/80 to-transparent z-25 pointer-events-none">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-md">
                {profile.fullName}
              </h2>
              <span className="p-1 rounded-full bg-[#fe3c72]/20 border border-[#fe3c72]/30 flex items-center justify-center shrink-0">
                <Flame className="w-4 h-4 text-[#fe3c72] fill-[#fe3c72]" />
              </span>
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
                Match no Tinder
              </span>
            </div>
          </div>
        </div>

        {/* Seção de Informações Rolável */}
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
              <div className="p-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm leading-relaxed whitespace-pre-line shadow-inner">
                {profile.bio}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 text-zinc-500 text-xs italic">
                Nenhuma biografia detalhada foi fornecida no Tinder ainda.
              </div>
            )}
          </div>

          {/* Miniaturas de Fotos Adicionais */}
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

          {/* Detalhes do Perfil */}
          <div className="pt-2 border-t border-zinc-800 grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Plataforma
              </span>
              <span className="text-zinc-200 font-semibold flex items-center gap-1 mt-0.5">
                <Flame className="w-3.5 h-3.5 text-[#fe3c72] fill-[#fe3c72]" />
                Tinder Match
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Status
              </span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                Conectado
              </span>
            </div>
          </div>
        </div>

        {/* Rodapé de Ação */}
        <div className="p-4 border-t border-zinc-800 bg-[#111113] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 px-4 rounded-full font-bold text-sm text-white bg-gradient-to-r from-[#fd297b] via-[#ff5864] to-[#fe3c72] hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-500/25 cursor-pointer"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Voltar para a conversa</span>
          </button>
        </div>
      </div>
    </div>
  );
}
