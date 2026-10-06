"use client";

import React, { ReactNode } from "react";

export interface SafeAreaContainerProps {
  children: ReactNode;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
  className?: string;
}

/**
 * Contêiner utilitário para envolver elementos e garantir que respeitem
 * as safe-areas de aparelhos móveis (entalhe do iPhone, Dynamic Island, barra home do iOS/Android).
 */
export function SafeAreaContainer({
  children,
  top = false,
  bottom = false,
  left = false,
  right = false,
  className = "",
}: SafeAreaContainerProps) {
  const styles: React.CSSProperties = {
    paddingTop: top ? "env(safe-area-inset-top, 0px)" : undefined,
    paddingBottom: bottom ? "env(safe-area-inset-bottom, 0px)" : undefined,
    paddingLeft: left ? "env(safe-area-inset-left, 0px)" : undefined,
    paddingRight: right ? "env(safe-area-inset-right, 0px)" : undefined,
  };

  return (
    <div style={styles} className={className}>
      {children}
    </div>
  );
}
