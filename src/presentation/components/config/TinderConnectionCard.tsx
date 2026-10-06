"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Eye, EyeOff, Flame, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  connectTinder,
  disconnectTinder,
  getTinderStatus,
  TinderPublicProfile,
} from "@/presentation/components/match/tinder-client";

interface TinderConnectionCardProps {
  onConnectionChange?: (connected: boolean) => void;
}

export function TinderConnectionCard({ onConnectionChange }: TinderConnectionCardProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<TinderPublicProfile | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const refresh = async () => {
    setChecking(true);
    try {
      const status = await getTinderStatus();
      setConnected(Boolean(status.connected));
      setProfile(status.profile || null);
      onConnectionChange?.(Boolean(status.connected));
    } catch {
      setConnected(false);
      setProfile(null);
      onConnectionChange?.(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleConnect = async () => {
    const value = token.trim();
    if (!value) {
      toast.error("Cole o token do Tinder primeiro.");
      return;
    }
    setLoading(true);
    try {
      const connectedProfile = await connectTinder(value);
      setConnected(true);
      setProfile(connectedProfile);
      setToken("");
      setShowToken(false);
      onConnectionChange?.(true);
      toast.success("Tinder conectado com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar o Tinder.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectTinder();
      setConnected(false);
      setProfile(null);
      onConnectionChange?.(false);
      toast.success("Tinder desconectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desconectar o Tinder.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-[26px] border border-[#fd5068]/20 bg-white shadow-sm dark:bg-[#111113]">
      <div className="h-1 bg-gradient-to-r from-[#ff6036] via-[#fd5068] to-[#e8368f]" />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6036] via-[#fd5068] to-[#e8368f] text-white shadow-md">
              <Flame className="h-5 w-5 fill-current" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-zinc-950 dark:text-white">Tinder</h3>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Conta real usada pela área Match
              </p>
            </div>
          </div>

          {checking ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[9px] font-black uppercase text-zinc-500 dark:border-white/10 dark:bg-white/5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verificando
            </span>
          ) : connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              Conectado
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[9px] font-black uppercase text-zinc-500 dark:border-white/10 dark:bg-white/5">
              Desconectado
            </span>
          )}
        </div>

        {connected && profile ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                {profile.photos?.[0]?.url ? (
                  <Image
                    src={profile.photos[0].url}
                    alt={profile.name}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[#fd5068]">
                    <Flame className="h-5 w-5 fill-current" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-zinc-950 dark:text-white">
                  {profile.name}
                  {profile.age ? <span className="font-medium">, {profile.age}</span> : null}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {profile.city || "Perfil validado pelo Tinder"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-2xl bg-emerald-50/70 p-3 text-[11px] leading-relaxed text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O token não é devolvido para a interface. O navegador usa uma sessão privada revogável do Match.
              </span>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 text-xs font-black text-red-600 transition active:scale-[0.98] disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Desconectar Tinder
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-400">
              Cole o seu token de autenticação web do Tinder. Ele será validado no servidor e não ficará exposto na tela.
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                Token do Tinder (X-Auth-Token)
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Ex: 063c7b5e-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="min-h-12 w-full rounded-2xl border border-zinc-200 bg-white px-3.5 pr-12 font-mono text-[16px] text-zinc-950 outline-none transition focus:border-[#fd5068] dark:border-white/10 dark:bg-black dark:text-white sm:text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((value) => !value)}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
                  aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConnect}
              disabled={loading || !token.trim()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#fd297b] to-[#ff5864] px-4 text-xs font-black text-white shadow-sm transition active:scale-[0.98] disabled:opacity-45"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4 fill-current" />}
              {loading ? "Validando no Tinder..." : "Conectar Tinder"}
            </button>

            {/* Dica passo a passo */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-zinc-600 dark:text-zinc-400">
              <p className="font-bold text-amber-700 dark:text-amber-300 mb-1">Como obter o token:</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-[10px]">
                <li>Faça login em <strong>tinder.com</strong> no navegador.</li>
                <li>Pressione <strong>F12</strong> → <strong>Application</strong> → <strong>Local Storage</strong> → <code>tinder.com</code>.</li>
                <li>Copie o valor da chave <strong>TinderWeb/APIToken</strong>.</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
