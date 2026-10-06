"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  HelpCircle,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { connectTinder, TinderPublicProfile } from "./tinder-client";

interface TinderConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (profile: TinderPublicProfile) => void;
}

export function TinderConnectModal({
  isOpen,
  onClose,
  onSuccess,
}: TinderConnectModalProps) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) {
      toast.error("Cole o token do Tinder.");
      return;
    }

    setLoading(true);
    try {
      const profile = await connectTinder(cleanToken);
      toast.success(`Tinder conectado como ${profile.name}!`);
      setToken("");
      onSuccess?.(profile);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível conectar o Tinder.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#111113] border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Barra superior de gradiente */}
        <div className="h-1.5 w-full bg-gradient-to-r from-[#ff6036] via-[#fd5068] to-[#e8368f]" />

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-100 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6036] via-[#fd5068] to-[#e8368f] text-white shadow-md">
              <Flame className="h-5 w-5 fill-current" />
            </div>
            <div>
              <h3 className="text-base font-black text-zinc-950 dark:text-white leading-tight">
                Conectar Conta Tinder
              </h3>
              <p className="text-[11px] text-zinc-500">
                Integração real de matches e mensagens
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Token de Autenticação (X-Auth-Token)
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="063c7b5e-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={loading}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-12 w-full rounded-2xl border border-zinc-200 bg-white px-3.5 pr-12 font-mono text-[16px] sm:text-xs text-zinc-950 outline-none transition focus:border-[#fd5068] dark:border-white/10 dark:bg-black dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
                  aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-2xl bg-zinc-50 dark:bg-white/[0.04] p-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>
                O token é validado e armazenado de forma segura no Supabase. O navegador utiliza apenas uma sessão opaca e revogável.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#fd297b] to-[#ff5864] px-5 text-sm font-black text-white shadow-md transition active:scale-95 disabled:opacity-45"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4 fill-current" />}
              {loading ? "Validando no Tinder..." : "Validar e Conectar"}
            </button>
          </form>

          {/* Guia de como obter o token */}
          <div className="border-t border-zinc-100 dark:border-white/5 pt-3">
            <button
              type="button"
              onClick={() => setShowTutorial(!showTutorial)}
              className="flex w-full items-center justify-between py-1 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#fd5068]"
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4 text-[#fd5068]" />
                Como pegar o token no Tinder Web?
              </span>
              <span className="text-[10px] text-zinc-400">
                {showTutorial ? "Ocultar" : "Ver passo a passo"}
              </span>
            </button>

            {showTutorial && (
              <div className="mt-3 space-y-2 rounded-2xl bg-amber-500/10 p-3.5 text-[11px] text-amber-900 dark:text-amber-200">
                <p className="font-bold">Siga estes 4 passos simples:</p>
                <ol className="list-decimal space-y-1 pl-4 leading-relaxed">
                  <li>
                    Acesse <strong>tinder.com</strong> no seu navegador (Chrome/Edge) e faça login na sua conta.
                  </li>
                  <li>
                    Abra o DevTools pressionando <strong>F12</strong> (ou botão direito → Inspecionar).
                  </li>
                  <li>
                    Acesse a aba <strong>Application</strong> (ou Aplicativo) → <strong>Local Storage</strong> → clique em <code>https://tinder.com</code>.
                  </li>
                  <li>
                    Procure a chave <strong>TinderWeb/APIToken</strong> e copie o valor dela (formato UUID com 36 caracteres).
                  </li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
