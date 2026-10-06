"use client";

import { useEffect, useState } from "react";

/**
 * Hook para detecção se a aplicação está rodando em modo standalone (PWA instalado).
 * Suporta o padrão Web W3C (display-mode: standalone / fullscreen) e o modo legado do Safari iOS (navigator.standalone).
 * Seguro para SSR (retorna false no primeiro ciclo de renderização no servidor).
 */
export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    const checkStandalone = (): boolean => {
      // 1. Verificação padrão W3C (Chrome, Edge, Firefox, Android PWA)
      const isStandaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
      const isFullscreenMedia = window.matchMedia("(display-mode: fullscreen)").matches;

      // 2. Verificação iOS Safari WebKit legado
      const isIosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;

      // 3. Fallback para Android TWA (Trusted Web Activity)
      const isAndroidTwa = document.referrer.includes("android-app://");

      return isStandaloneMedia || isFullscreenMedia || isIosStandalone || isAndroidTwa;
    };

    setIsStandalone(checkStandalone());

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches || checkStandalone());
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return isStandalone;
}
