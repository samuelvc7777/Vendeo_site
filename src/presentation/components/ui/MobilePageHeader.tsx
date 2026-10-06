"use client";

import React, { ReactNode } from "react";

export interface MobilePageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  leftAction?: ReactNode;
  rightActions?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho mobile padronizado e compacto:
 * - Respeito estrito à safe-area superior (Dynamic Island / Notch do iPhone).
 * - Touch targets generosos (mínimo 44px) para ações nos cantos.
 * - Suporte a título, subtítulo/badge e ações laterais.
 * - Backdrop blur fluido para sensação nativa de app.
 */
export function MobilePageHeader({
  title,
  subtitle,
  badge,
  leftAction,
  rightActions,
  className = "",
}: MobilePageHeaderProps) {
  return (
    <header
      className={`shrink-0 pt-[env(safe-area-inset-top,0px)] bg-white/95 dark:bg-black/95 backdrop-blur-xl border-b border-zinc-200 dark:border-[#262626] z-20 select-none ${className}`}
    >
      <div className="h-14 px-3 sm:px-4 flex items-center justify-between gap-2">
        {/* Lado Esquerdo */}
        <div className="flex items-center gap-2 min-w-0">
          {leftAction && (
            <div className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 shrink-0">
              {leftAction}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-bold tracking-tight text-zinc-950 dark:text-white truncate">
                {title}
              </h1>
              {badge && <div className="shrink-0">{badge}</div>}
            </div>
            {subtitle && (
              <p className="text-[10px] text-zinc-500 dark:text-[#737373] truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Lado Direito (Ações com touch targets confortáveis) */}
        {rightActions && (
          <div className="flex items-center gap-1.5 shrink-0">
            {rightActions}
          </div>
        )}
      </div>
    </header>
  );
}
