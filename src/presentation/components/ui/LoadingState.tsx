"use client";

import React from "react";
import { Skeleton } from "./Skeleton";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Spinner universal tátil
 */
export function LoadingSpinner({
  size = "md",
  className,
  label,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
      <Loader2
        className={cn(
          "animate-spin text-[#0095f6]",
          sizeClasses[size]
        )}
      />
      {label && <p className="text-xs text-[#a8a8a8] font-medium animate-pulse">{label}</p>}
    </div>
  );
}

/**
 * Skeleton para linhas de conversa do Instagram e Tinder
 */
export function ConversationSkeleton({ isTinder = false }: { isTinder?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-2 rounded-xl">
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {/* Avatar Circular com borda sutil */}
        <Skeleton
          className={cn(
            "w-13 h-13 rounded-full shrink-0",
            isTinder && "ring-1 ring-[#fe3c72]/30"
          )}
        />

        {/* Informações da conversa */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-28 rounded" />
            <Skeleton className="h-3 w-14 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-40 rounded" />
            <Skeleton className="h-2.5 w-8 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Lista de Skeletons de conversas
 */
export function ConversationSkeletonList({
  count = 6,
  isTinder = false,
}: {
  count?: number;
  isTinder?: boolean;
}) {
  return (
    <div className="space-y-1 divide-y divide-zinc-900/40">
      {Array.from({ length: count }).map((_, idx) => (
        <ConversationSkeleton key={idx} isTinder={isTinder} />
      ))}
    </div>
  );
}

/**
 * Skeleton para histórico de mensagens dentro da conversa aberta
 */
export function ChatMessageSkeletonList({ count = 5 }: { count?: number }) {
  const widths = ["w-48", "w-64", "w-36", "w-56", "w-40"];

  return (
    <div className="space-y-3.5 py-3 px-2">
      {Array.from({ length: count }).map((_, idx) => {
        const isMine = idx % 2 === 1;
        const widthClass = widths[idx % widths.length];

        return (
          <div
            key={idx}
            className={cn("flex flex-col", isMine ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "flex items-end gap-2 max-w-[78%]",
                isMine ? "flex-row-reverse" : "flex-row"
              )}
            >
              <Skeleton
                className={cn(
                  "h-10 rounded-2xl",
                  widthClass,
                  isMine
                    ? "rounded-br-[4px] bg-zinc-700/50"
                    : "rounded-bl-[4px] bg-zinc-800/70"
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Skeleton para grid de produtos do catálogo
 */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl bg-[#141414] border border-[#262626] overflow-hidden p-2.5 space-y-2.5 shadow-sm"
        >
          {/* Imagem do produto */}
          <Skeleton className="w-full aspect-square rounded-xl" />

          {/* Dados do produto */}
          <div className="space-y-1.5 px-0.5">
            <Skeleton className="h-3.5 w-3/4 rounded" />
            <Skeleton className="h-4 w-1/2 rounded" />
            <div className="pt-1 flex items-center justify-between">
              <Skeleton className="h-3 w-16 rounded-full" />
              <Skeleton className="h-3 w-10 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
