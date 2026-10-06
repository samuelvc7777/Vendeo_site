"use client";

import React, { ReactNode } from "react";

interface MobileContainerProps {
  children: ReactNode;
}

export function MobileContainer({ children }: MobileContainerProps) {
  return (
    <div className="h-full max-h-[100dvh] w-full bg-zinc-100 dark:bg-black text-zinc-950 dark:text-white flex justify-center overflow-hidden selection:bg-sky-200 dark:selection:bg-slate-800">
      <div className="w-full max-w-md md:max-w-5xl lg:max-w-7xl h-full max-h-[100dvh] bg-white dark:bg-black flex flex-col relative overflow-hidden transition-[max-width]">
        {children}
      </div>
    </div>
  );
}
