"use client";

import React, { useState, useEffect } from "react";
import { apiFetch as fetch } from "@/infrastructure/http/apiFetch";
import Image from "next/image";
import {
  Camera,
  X,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogOut,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { InstagramAccount } from "@/domain/entities/Instagram";

interface InstagramConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionChange?: () => void;
}

export function InstagramConnectModal({
  isOpen,
  onClose,
  onConnectionChange,
}: InstagramConnectModalProps) {
  const [account, setAccount] = useState<InstagramAccount | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Form State
  const [accessToken, setAccessToken] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Guide State
  const [showGuide, setShowGuide] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // URL do webhook montada dinamicamente
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/instagram/webhook`);
    }
  }, []);

  const loadStatus = async () => {
    setLoadingInitial(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/instagram/config");
      if (res.ok) {
        const data = await res.json();
        setIsConnected(Boolean(data.isConnected));
        setAccount(data.account || null);
      }
    } catch {
      setIsConnected(false);
      setAccount(null);
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) {
      setErrorMessage("Por favor, insira o Access Token da Meta.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/instagram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          instagramAccountId: instagramAccountId.trim() || undefined,
          appSecret: appSecret.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Falha ao validar e conectar a conta do Instagram.");
      }

      setIsConnected(true);
      setAccount(data.account || null);
      setSuccessMessage("Conta do Instagram conectada e autenticada com sucesso!");
      setAccessToken("");
      onConnectionChange?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao conectar conta.";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Deseja realmente desconectar a conta do Instagram?")) return;

    setIsSubmitting(true);
    try {
      await fetch("/api/instagram/config", { method: "DELETE" });
      setIsConnected(false);
      setAccount(null);
      setSuccessMessage("Conta desconectada.");
      onConnectionChange?.();
    } catch {
      setErrorMessage("Erro ao desconectar conta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full sm:max-w-lg bg-[#121212] border border-[#262626] rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header do Modal */}
        <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between bg-[#161616]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] flex items-center justify-center shadow-md">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Conexão Instagram Direct Oficial
              </h3>
              <p className="text-[11px] text-[#a8a8a8]">
                {isConnected ? "Conta vinculada via Meta Graph API" : "Conecte sua conta profissional oficial"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#a8a8a8] hover:text-white p-1.5 rounded-full hover:bg-[#262626] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo com scroll */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {loadingInitial ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 text-[#bc1888] animate-spin" />
              <p className="text-xs text-[#a8a8a8]">Verificando status de conexão...</p>
            </div>
          ) : isConnected && account ? (
            /* ESTADO CONECTADO */
            <div className="space-y-4">
              {/* Card de Perfil Conectado */}
              <div className="p-4 rounded-xl bg-[#1c1c1e] border border-[#262626] flex items-center gap-3.5">
                <div className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 ring-2 ring-[#bc1888]">
                  {account.profilePictureUrl ? (
                    <Image
                      src={account.profilePictureUrl}
                      alt={account.name || account.username}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-tr from-[#f09433] to-[#bc1888] flex items-center justify-center text-white font-bold text-lg">
                      {account.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-bold text-white truncate">
                      {account.name || account.username}
                    </h4>
                    <span className="text-[10px] bg-[#10b981]/20 text-[#10b981] font-semibold px-2 py-0.5 rounded-full border border-[#10b981]/30">
                      Oficial
                    </span>
                  </div>
                  <p className="text-xs text-[#bc1888] font-medium truncate">
                    @{account.username}
                  </p>
                  <p className="text-[10px] text-[#737373] truncate mt-0.5">
                    ID da Conta: {account.id}
                  </p>
                </div>
              </div>

              {/* Informações de Webhook para Tempo Real */}
              <div className="p-3.5 rounded-xl bg-[#18181b] border border-[#27272a] space-y-2.5">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <ShieldCheck className="w-4 h-4 text-[#10b981]" />
                  <span>Webhook da Meta em Tempo Real</span>
                </div>
                <p className="text-[#a1a1aa] leading-relaxed">
                  Para receber mensagens no mesmo instante em que os pretendentes enviarem, configure este endpoint no seu app Meta for Developers:
                </p>

                <div className="space-y-2 pt-1">
                  <div>
                    <span className="text-[10px] text-[#71717a] uppercase font-semibold">URL de Retorno de Chamada (Callback URL)</span>
                    <div className="flex items-center justify-between bg-black/60 border border-[#27272a] rounded-lg px-2.5 py-1.5 mt-1 font-mono text-[11px] text-zinc-300">
                      <span className="truncate mr-2">{webhookUrl || "/api/instagram/webhook"}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(webhookUrl, "url")}
                        className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                        title="Copiar URL"
                      >
                        {copiedField === "url" ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-[#71717a] uppercase font-semibold">Token de Verificação (Verify Token)</span>
                    <div className="flex items-center justify-between bg-black/60 border border-[#27272a] rounded-lg px-2.5 py-1.5 mt-1 font-mono text-[11px] text-zinc-300">
                      <span>vendeo_ig_secret_token</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard("vendeo_ig_secret_token", "token")}
                        className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                        title="Copiar Token"
                      >
                        {copiedField === "token" ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-red-950/40 border border-red-900/50 text-[#ef4444] text-xs font-semibold hover:bg-red-950/60 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Desconectar Conta do Instagram
                </button>
              </div>
            </div>
          ) : (
            /* FORMULÁRIO DE CONEXÃO */
            <form onSubmit={handleConnectSubmit} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-900/40 text-blue-300/90 leading-relaxed">
                <div className="flex items-center gap-2 font-semibold text-blue-200 mb-1">
                  <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                  Conexão 100% Segura & Oficial da Meta
                </div>
                Utilizamos a Meta Graph API oficial, o que protege sua conta contra bloqueios e garante envio direto no Direct do Instagram.
              </div>

              {/* Mensagem de Erro */}
              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-tight">{errorMessage}</span>
                </div>
              )}

              {/* Mensagem de Sucesso */}
              {successMessage && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-tight">{successMessage}</span>
                </div>
              )}

              {/* Campo: Access Token */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>Meta Access Token (Obrigatório)</span>
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#0095f6] hover:underline flex items-center gap-1 font-normal text-[11px]"
                  >
                    Graph API Explorer <ExternalLink className="w-3 h-3" />
                  </a>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="EAABw..."
                    className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#bc1888] font-mono pr-9"
                    required
                  />
                  <KeyRound className="w-4 h-4 text-[#737373] absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              {/* Campo: Instagram Business Account ID (Opcional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>Instagram Business Account ID (Opcional)</span>
                  <span className="text-[10px] text-[#0095f6] font-medium">Pode deixar em branco</span>
                </label>
                <input
                  type="text"
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  placeholder="Deixe em branco (autodetecta sozinho) ou ID numérico"
                  className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#bc1888] font-mono"
                />
              </div>

              {/* Campo: App Secret (Opcional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>Meta App Secret (Opcional para HMAC-SHA256)</span>
                  <span className="text-[10px] text-[#737373]">Validação de Webhook</span>
                </label>
                <input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="Ex: 8f7e2a9..."
                  className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#bc1888] font-mono"
                />
              </div>

              {/* Botão de Conectar */}
              <button
                type="submit"
                disabled={isSubmitting || !accessToken.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] text-white text-xs font-bold hover:opacity-95 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validando com a Meta...
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    Validar e Conectar Instagram
                  </>
                )}
              </button>

              {/* Accordion: Como obter as credenciais */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="w-full py-2 px-3 rounded-xl bg-[#1c1c1e] border border-[#262626] text-[#a8a8a8] hover:text-white flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <HelpCircle className="w-3.5 h-3.5 text-[#0095f6]" />
                    Como obter o Token da Meta em 2 minutos?
                  </span>
                  {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showGuide && (
                  <div className="mt-2 p-3.5 rounded-xl bg-[#161618] border border-[#262626] space-y-2.5 text-[11px] text-[#a8a8a8] leading-relaxed">
                    <ol className="list-decimal list-inside space-y-1.5 marker:text-[#0095f6] marker:font-bold">
                      <li>
                        Acesse o{" "}
                        <a
                          href="https://developers.facebook.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#0095f6] hover:underline inline-flex items-center gap-0.5"
                        >
                          Meta for Developers <ExternalLink className="w-2.5 h-2.5" />
                        </a>{" "}
                        e crie ou selecione um App do tipo <strong>Business</strong>.
                      </li>
                      <li>
                        Vincule sua conta de Instagram (Profissional/Criador) a uma <strong>Página do Facebook</strong>.
                      </li>
                      <li>
                        Vá no <strong>Graph API Explorer</strong>, selecione seu App e sua Página.
                      </li>
                      <li>
                        Adicione as permissões: <code className="bg-black/50 px-1 py-0.5 rounded text-zinc-300">pages_show_list</code>, <code className="bg-black/50 px-1 py-0.5 rounded text-zinc-300">instagram_basic</code>, <code className="bg-black/50 px-1 py-0.5 rounded text-zinc-300">instagram_manage_messages</code>.
                      </li>
                      <li>
                        Clique em <strong>Generate Access Token</strong> e cole o token acima!
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
