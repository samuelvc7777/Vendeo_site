import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MobileContainer } from "@/presentation/components/layout/MobileContainer";

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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#020617",
};

export const metadata: Metadata = {
  title: "Vendeo | Marketplace Mobile Fluido",
  description: "Compre e venda de forma rápida, segura e com sensação de app nativo na web.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vendeo",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased bg-slate-950`}
    >
      <body className="h-full overflow-hidden flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
        <MobileContainer>{children}</MobileContainer>
      </body>
    </html>
  );
}
