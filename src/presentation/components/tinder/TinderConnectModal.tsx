"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  X,
  Flame,
  KeyRound,
  CheckCircle2,
  LogOut,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { TinderSession } from "@/domain/entities/Tinder";

interface TinderConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: TinderSession | null;
  onConnect: (token: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSyncMatches: () => Promise<void>;
}

export function TinderConnectModal({
  isOpen,
  onClose,
  session,
  onConnect,
  onDisconnect,
  onSyncMatches,
}: TinderConnectModalProps) {
  const [tokenInput, setTokenInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);

  if (!isOpen) return null;

  const handleCopyConsoleScript = () => {
    navigator.clipboard.writeText("localStorage.getItem('tinder-auth-token')");
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      await onConnect(tokenInput.trim());
      setTokenInput("");
      onClose();
    } catch (err: any) {
      setErrorMessage(
        err?.message || "Token inválido ou não foi possível conectar com o Tinder."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#111113] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-[#161618]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#fd297b] to-[#ff5864] flex items-center justify-center shadow-md">
              <Flame className="w-4 h-4 text-white fill-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Conexão Tinder Oficial
              </h3>
              <p className="text-[11px] text-zinc-400">
                {session?.isConnected ? "Conta vinculada e ativa" : "Conecte sua conta real"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-full hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-5 overflow-y-auto space-y-4">
          {session?.isConnected ? (
            /* CONTA CONECTADA */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center gap-3.5">
                <div className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 ring-2 ring-[#fe3c72]">
                  <Image
                    src={session.profile?.photos?.[0]?.url || "/favicon.ico"}
                    alt={session.profile?.name || "Tinder User"}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-bold text-white truncate">
                      {session.profile?.name || "Usuário Conectado"}
                    </h4>
                    <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  </div>
                  <p className="text-xs text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Sessão Oficial Ativa
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await onSyncMatches();
                      onClose();
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white text-xs font-bold hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Sincronizar Matches"
                  )}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await onDisconnect();
                      onClose();
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="py-2.5 px-4 rounded-xl bg-zinc-800 text-red-400 text-xs font-semibold hover:bg-zinc-700 active:scale-[0.98] transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            /* CONECTAR NOVA CONTA */
            <form onSubmit={handleConnectSubmit} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-white">
                  <KeyRound className="w-4 h-4 text-[#fe3c72]" />
                  Como obter seu Token em 10 segundos:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-zinc-400 leading-relaxed">
                  <li>
                    Acesse o{" "}
                    <a
                      href="https://tinder.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white underline font-semibold inline-flex items-center gap-0.5 hover:text-[#fe3c72]"
                    >
                      tinder.com <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    e faça login.
                  </li>
                  <li>
                    Pressione <kbd className="bg-zinc-800 px-1 py-0.5 rounded text-white text-[10px]">F12</kbd> (Console) e rode:
                  </li>
                </ol>

                <div className="flex items-center justify-between bg-black/60 rounded-lg p-2 border border-zinc-800">
                  <code className="text-[11px] text-amber-300 font-mono select-all truncate mr-2">
                    localStorage.getItem(&apos;tinder-auth-token&apos;)
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyConsoleScript}
                    className="text-zinc-400 hover:text-white shrink-0 p-1 cursor-pointer"
                    title="Copiar comando"
                  >
                    {copiedScript ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  3. Copie o código gerado (sem as aspas) e cole no campo abaixo:
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  Tinder Auth Token (X-Auth-Token)
                </label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Ex: 12345678-abcd-ef01-2345-6789abcdef01"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#fe3c72] transition-colors"
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !tokenInput.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white text-xs font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validando e conectando...
                  </>
                ) : (
                  <>
                    <Flame className="w-4 h-4 fill-white" />
                    Conectar Conta Real do Tinder
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
