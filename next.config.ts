import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function (phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    ...(!isDev ? { output: "export" as const } : {}),
    reactCompiler: true,

    images: {
      unoptimized: true,
      remotePatterns: [
        {
          protocol: "https",
          hostname: "images.unsplash.com",
        },
        {
          protocol: "https",
          hostname: "**.cdninstagram.com",
        },
        {
          protocol: "https",
          hostname: "**.instagram.com",
        },
        {
          protocol: "https",
          hostname: "**.fbcdn.net",
        },
        {
          protocol: "https",
          hostname: "*.supabase.co",
        },
      ],
    },
  };
}
