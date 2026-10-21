import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MobileContainer } from "@/presentation/components/layout/MobileContainer";
import { ThemeProvider } from "@/presentation/context/ThemeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

const themeInitializerScript = `
  try {
    const saved = localStorage.getItem("vendeo-theme");
    const theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
`;

const whatsappGatewayBridgeScript = `
  (() => {
    const nativeFetch = window.fetch.bind(window);
    const gatewayConfig = nativeFetch("/wa2-config.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        const raw = typeof config?.gatewayUrl === "string" ? config.gatewayUrl.trim() : "";
        try {
          const parsed = new URL(raw);
          return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : "";
        } catch { return ""; }
      })
      .catch(() => "");

    window.fetch = function(input, init) {
      const rawUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === "string"
            ? input.url
            : "";
      let staleUrl;
      try { staleUrl = new URL(rawUrl, window.location.href); }
      catch { return nativeFetch(input, init); }
      if (!staleUrl.hostname.endsWith(".trycloudflare.com")) {
        return nativeFetch(input, init);
      }
      return gatewayConfig.then((gatewayUrl) => {
        if (!gatewayUrl) return nativeFetch(input, init);
        return nativeFetch(gatewayUrl + staleUrl.pathname + staleUrl.search, init);
      });
    };
  })();
`;

export const metadata: Metadata = {
  title: "Vendeo",
  description: "Vendeo - Gestão de Rifas, Vendas e Atendimento",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vendeo",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializerScript }} />
        <Script id="wa2-gateway-bridge" strategy="beforeInteractive">{whatsappGatewayBridgeScript}</Script>
      </head>
      <body className="h-full overflow-hidden flex flex-col selection:bg-emerald-500 selection:text-white">
        <ThemeProvider>
          <MobileContainer>{children}</MobileContainer>
        </ThemeProvider>
      </body>
    </html>
  );
}
