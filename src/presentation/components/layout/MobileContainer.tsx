"use client";

import React, { ReactNode } from "react";

interface MobileContainerProps {
  children: ReactNode;
}

export function MobileContainer({ children }: MobileContainerProps) {
  return (
    <div className="h-full max-h-[100dvh] w-full bg-black text-white flex justify-center overflow-hidden selection:bg-slate-800">
      <div className="w-full max-w-md h-full max-h-[100dvh] bg-black flex flex-col relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
