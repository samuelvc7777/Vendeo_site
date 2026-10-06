"use client";

import { useState, useEffect } from "react";

export interface VisualViewportInfo {
  viewportHeight: number;
  keyboardHeight: number;
  isKeyboardOpen: boolean;
}

/**
 * Hook para monitoramento em tempo real da altura visual útil (visualViewport)
 * e detecção precisa da abertura do teclado virtual no iPhone (iOS Safari / PWA) e Android.
 * Previne barras brancas, deslocamentos indesejados e duplicação de safe-area-inset-bottom.
 */
export function useVisualViewport(): VisualViewportInfo {
  const [info, setInfo] = useState<VisualViewportInfo>({
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
    keyboardHeight: 0,
    isKeyboardOpen: false,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;

    const handleViewportChange = () => {
      const windowHeight = window.innerHeight;
      const currentHeight = vv.height;
      const rawDiff = windowHeight - currentHeight;
      // Considera teclado aberto se a redução na viewport for relevante (> 120px)
      const isKeyboard = rawDiff > 120;
      const kbHeight = isKeyboard ? Math.max(0, rawDiff) : 0;

      setInfo({
        viewportHeight: currentHeight,
        keyboardHeight: kbHeight,
        isKeyboardOpen: isKeyboard,
      });

      // No iOS, focar em inputs pode causar window.scrollY indesejado; forçamos reset suave
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);

    handleViewportChange();

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, []);

  return info;
}
