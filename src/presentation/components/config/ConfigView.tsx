"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import {
  Flame,
  Camera,
  Sparkles,
  CheckCircle2,
  Database,
  Loader2,
  LogOut,
  RefreshCw,
  Sliders,
  ShieldCheck,
  Mic,
  Key,
  Eye,
  EyeOff,
  Edit2,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { TinderSession } from "@/domain/entities/Tinder";
import { TinderConnectModal } from "@/presentation/components/tinder/TinderConnectModal";
import { InstagramConnectModal } from "@/presentation/components/instagram/InstagramConnectModal";
import { InstagramAccount } from "@/domain/entities/Instagram";
import { getApiUrl } from "@/infrastructure/http/network";
import { ChatStagesManager } from "./ChatStagesManager";
import { AutoPilotConfigManager } from "./AutoPilotConfigManager";
import { useChatStages } from "@/presentation/hooks/useChatStages";

export function ConfigView() {
  const {
    stages,
    createStage,
    updateStage,
    deleteStage,
    moveStageUp,
    moveStageDown,
    addGoal,
    updateGoal,
    deleteGoal,
    moveGoalUp,
    moveGoalDown,
  } = useChatStages();

  const [tinderSession, setTinderSession] = useState<TinderSession | null>(null);
  const [isTinderModalOpen, setIsTinderModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  // Estados do Instagram
  const [instagramAccount, setInstagramAccount] = useState<InstagramAccount | null>(null);
  const [isInstagramConnected, setIsInstagramConnected] = useState(false);
  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);

  // Estados da Groq Cloud Whisper
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [isGroqConfigured, setIsGroqConfigured] = useState(false);
  const [isSavingGroq, setIsSavingGroq] = useState(false);
  const [groqMaskedKey, setGroqMaskedKey] = useState<string | null>(null);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isEditingGroqKey, setIsEditingGroqKey] = useState(false);

  // Estados da Kie.ai (Modelo Sol - Larissa)
  const [kieKeyInput, setKieKeyInput] = useState("");
  const [isKieConfigured, setIsKieConfigured] = useState(false);
  const [isSavingKie, setIsSavingKie] = useState(false);
  const [kieMaskedKey, setKieMaskedKey] = useState<string | null>(null);
  const [showKieKey, setShowKieKey] = useState(false);
  const [isEditingKieKey, setIsEditingKieKey] = useState(false);

  useEffect(() => {
    checkTinderStatus();
    checkInstagramStatus();
    checkGroqStatus();
    checkKieStatus();
  }, []);

  const checkGroqStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/ai/transcribe"));
      if (res.ok) {
        const data = await res.json();
        setIsGroqConfigured(Boolean(data.configured));
        setGroqMaskedKey(data.maskedKey || null);
      }
    } catch {
      setIsGroqConfigured(false);
      setGroqMaskedKey(null);
    }
  };

  const handleSaveGroqKey = async () => {
    const key = groqKeyInput.trim();
    if (!key.startsWith("gsk_")) {
      toast.error("A chave da Groq deve começar com 'gsk_'");
      return;
    }
    setIsSavingGroq(true);
    try {
      const res = await fetch(getApiUrl("/api/ai/transcribe"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar chave.");
      setIsGroqConfigured(true);
      setGroqMaskedKey(data.maskedKey || `${key.slice(0, 7)}...${key.slice(-4)}`);
      setIsEditingGroqKey(false);
      setGroqKeyInput("");
      toast.success("Chave Groq configurada com sucesso no Supabase!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar chave";
      toast.error(msg);
    } finally {
      setIsSavingGroq(false);
    }
  };

  const checkKieStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/ai/kie-status"));
      if (res.ok) {
        const data = await res.json();
        setIsKieConfigured(Boolean(data.configured));
        setKieMaskedKey(data.maskedKey || null);
      }
    } catch {
      setIsKieConfigured(false);
      setKieMaskedKey(null);
    }
  };

  const handleSaveKieKey = async () => {
    const key = kieKeyInput.trim();
    if (!key || key.length < 10) {
      toast.error("Informe uma chave válida da Kie.ai");
      return;
    }
    setIsSavingKie(true);
    try {
      const res = await fetch(getApiUrl("/api/ai/kie-status"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar chave.");
      setIsKieConfigured(true);
      setKieMaskedKey(data.maskedKey || `${key.slice(0, 4)}...${key.slice(-4)}`);
      setIsEditingKieKey(false);
      setKieKeyInput("");
      toast.success("Chave Kie.ai (Sol) configurada com sucesso no Supabase!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar chave";
      toast.error(msg);
    } finally {
      setIsSavingKie(false);
    }
  };

  const checkInstagramStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/instagram/config"));
      if (res.ok) {
        const data = await res.json();
        setIsInstagramConnected(Boolean(data.isConnected));
        setInstagramAccount(data.account || null);
      }
    } catch {
      setIsInstagramConnected(false);
      setInstagramAccount(null);
    }
  };

  const checkTinderStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/tinder/status"));
      if (res.ok) {
        const data = await res.json();
        if (data.isConnected) {
          setTinderSession({
            token: data.token || "",
            isConnected: true,
            profile: data.profile,
          });
        } else {
          setTinderSession(null);
        }
      }
    } catch (err) {
      console.error("Erro ao verificar sessão do Tinder:", err);
    }
  };

  const handleConnectTinder = async (token: string) => {
    const res = await fetch(getApiUrl("/api/tinder/auth"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Falha ao conectar com o Tinder.");
    }
    setTinderSession({
      token,
      isConnected: true,
      profile: data.profile,
    });
  };

  const handleDisconnectTinder = async () => {
    await fetch(getApiUrl("/api/tinder/disconnect"), { method: "POST" });
    setTinderSession(null);
  };

  const handleSyncMatches = async () => {
    setIsLoading(true);
    try {
      await fetch(getApiUrl("/api/tinder/matches"));
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2500);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-black text-white overflow-hidden">
      {/* Header Fixo */}
      <div className="shrink-0 px-5 py-4 bg-black border-b border-[#262626] flex items-center justify-between z-10">
        <div>
          <h1 className="text-base font-bold tracking-tight text-white">Configurações</h1>
          <p className="text-[11px] text-[#a8a8a8]">Gerencie conexões, banco de dados e integrações</p>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#1c1c1e] border border-[#262626] text-[#d4d4d4] font-medium flex items-center gap-1.5">
          <Sliders className="w-3 h-3 text-[#0095f6]" />
          Config
        </span>
      </div>

      {/* Conteúdo com scroll isolado */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-5 scrollbar-none overscroll-contain">
        {/* SEÇÃO 1: BANCO DE DADOS & PERSISTÊNCIA */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-[#8e8e8e] uppercase tracking-wider px-1">
            Banco de Dados Oficial
          </h2>

          {/* CARD SUPABASE */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] overflow-hidden p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#3ecf8e] to-[#259b66] flex items-center justify-center shadow-md">
                  <Database className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Supabase PostgreSQL
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#3ecf8e]" />
                  </h3>
                  <p className="text-[11px] text-[#a8a8a8]">Projeto: vendeo-social</p>
                </div>
              </div>

              <span className="text-[10px] bg-[#3ecf8e]/15 text-[#3ecf8e] font-bold px-2 py-0.5 rounded-full border border-[#3ecf8e]/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
                Conectado
              </span>
            </div>

            <div className="pt-2 border-t border-[#222] text-xs space-y-1.5 text-[#a8a8a8]">
              <div className="flex justify-between items-center py-0.5">
                <span>Instância:</span>
                <span className="font-mono text-white text-[11px]">wsdualhvopidgqcumonr</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>tinder_config:</span>
                <span className="text-[#3ecf8e] font-mono text-[11px]">Ativa</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>tinder_conversations:</span>
                <span className="text-[#3ecf8e] font-mono text-[11px]">Ativa</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>tinder_messages:</span>
                <span className="text-[#3ecf8e] font-mono text-[11px]">Ativa</span>
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 2: CONTAS CONECTADAS & INTEGRAÇÕES */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-[#8e8e8e] uppercase tracking-wider px-1">
            Contas Conectadas
          </h2>

          {/* CARD TINDER */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] overflow-hidden p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#fd297b] to-[#ff5864] flex items-center justify-center shadow-md">
                  <Flame className="w-5 h-5 text-white fill-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Tinder Oficial
                    {tinderSession?.isConnected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0095f6]" />
                    )}
                  </h3>
                  <p className="text-[11px] text-[#a8a8a8]">
                    {tinderSession?.isConnected
                      ? "Conta conectada e sincronizada"
                      : "Integração via Token de Sessão Web"}
                  </p>
                </div>
              </div>

              {tinderSession?.isConnected ? (
                <span className="text-[10px] bg-[#10b981]/15 text-[#10b981] font-bold px-2 py-0.5 rounded-full border border-[#10b981]/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  Ativo
                </span>
              ) : (
                <span className="text-[10px] bg-[#262626] text-[#a8a8a8] font-medium px-2 py-0.5 rounded-full">
                  Desconectado
                </span>
              )}
            </div>

            {tinderSession?.isConnected ? (
              /* ESTADO CONECTADO */
              <div className="pt-2 border-t border-[#222] space-y-3">
                <div className="flex items-center gap-3 bg-[#1a1416] p-3 rounded-xl border border-[#fe3c72]/30">
                  <div className="relative w-11 h-11 rounded-full overflow-hidden shrink-0 ring-2 ring-[#fe3c72]">
                    <Image
                      src={
                        tinderSession.profile?.photos?.[0]?.url ||
                        "/favicon.ico"
                      }
                      alt={tinderSession.profile?.name || "Tinder"}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-white truncate">
                      {tinderSession.profile?.name}
                    </h4>
                    <p className="text-[11px] text-[#ff7597] truncate">
                      ID: {tinderSession.profile?.id?.slice(0, 14)}...
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSyncMatches}
                    disabled={isLoading}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#262626] text-white text-xs font-semibold hover:bg-[#333] active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#fe3c72]" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-[#0095f6]" />
                    )}
                    {syncSuccess ? "Sincronizado!" : "Sincronizar"}
                  </button>

                  <button
                    onClick={handleDisconnectTinder}
                    className="py-2 px-3.5 rounded-xl bg-red-950/40 border border-red-900/50 text-[#ef4444] text-xs font-semibold hover:bg-red-950/60 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Desconectar
                  </button>
                </div>
              </div>
            ) : (
              /* ESTADO DESCONECTADO */
              <div className="pt-2 border-t border-[#222] flex items-center justify-between">
                <p className="text-xs text-[#a8a8a8] max-w-[210px] leading-relaxed">
                  Conecte para responder matches reais diretamente pela aba Chat.
                </p>
                <button
                  onClick={() => setIsTinderModalOpen(true)}
                  className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-[#fd297b] to-[#ff5864] text-white text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  Conectar
                </button>
              </div>
            )}
          </div>

          {/* CARD INSTAGRAM DIRECT */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] flex items-center justify-center shadow-md">
                  <Camera className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Instagram Direct Oficial</h3>
                  <p className="text-[11px] text-[#a8a8a8]">Meta Graph API & Webhooks em tempo real</p>
                </div>
              </div>

              {isInstagramConnected ? (
                <span className="text-[10px] bg-[#10b981]/15 text-[#10b981] font-bold px-2 py-0.5 rounded-full border border-[#10b981]/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  Conectado
                </span>
              ) : (
                <span className="text-[10px] bg-[#737373]/20 text-[#a8a8a8] font-bold px-2 py-0.5 rounded-full border border-[#737373]/30">
                  Desconectado
                </span>
              )}
            </div>

            {isInstagramConnected && instagramAccount ? (
              <div className="pt-2 border-t border-[#222] space-y-3">
                <div className="flex items-center gap-3 bg-[#1a1518] p-3 rounded-xl border border-[#bc1888]/30">
                  <div className="relative w-11 h-11 rounded-full overflow-hidden shrink-0 ring-2 ring-[#bc1888]">
                    {instagramAccount.profilePictureUrl ? (
                      <Image
                        src={instagramAccount.profilePictureUrl}
                        alt={instagramAccount.username}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-tr from-[#f09433] to-[#bc1888] flex items-center justify-center text-white font-bold text-xs">
                        {instagramAccount.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-white truncate">
                      {instagramAccount.name || instagramAccount.username}
                    </h4>
                    <p className="text-[11px] text-[#e6683c] truncate">
                      @{instagramAccount.username}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsInstagramModalOpen(true)}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#262626] text-white text-xs font-semibold hover:bg-[#333] active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Gerenciar / Webhooks
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 border-t border-[#222] flex items-center justify-between">
                <p className="text-xs text-[#a8a8a8] max-w-[210px] leading-relaxed">
                  Conecte para sincronizar Direct oficial e responder mensagens reais.
                </p>
                <button
                  onClick={() => setIsInstagramModalOpen(true)}
                  className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] text-white text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  Conectar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* SEÇÃO 3: IA & AUTOMATIZAÇÕES */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-[#8e8e8e] uppercase tracking-wider px-1">
            Inteligência Artificial & Chat
          </h2>

          {/* CARD MOTOR GROQ CLOUD WHISPER */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#f55036] to-[#f87171] flex items-center justify-center shadow-md">
                  <Mic className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Transcrição de Áudio (Groq Nuvem)
                    {isGroqConfigured && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#3ecf8e]" />
                    )}
                  </h3>
                  <p className="text-[11px] text-[#a8a8a8]">
                    Whisper Large v3 (100% em Nuvem · 0ms Cache)
                  </p>
                </div>
              </div>

              {isGroqConfigured ? (
                <span className="text-[10px] bg-[#3ecf8e]/15 text-[#3ecf8e] font-bold px-2 py-0.5 rounded-full border border-[#3ecf8e]/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
                  Ativo
                </span>
              ) : (
                <span className="text-[10px] bg-amber-500/15 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                  Chave Pendente
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-[#222] space-y-2.5 text-xs">
              <p className="text-[#a8a8a8] text-[11px] leading-relaxed">
                Transcreve mensagens de voz do Direct e Tinder na nuvem, alimentando o contexto do prompt da IA Larissa com precisão total.
              </p>

              {isGroqConfigured && !isEditingGroqKey ? (
                <div className="flex items-center justify-between bg-[#1c1c1e] p-2.5 rounded-xl border border-[#262626]">
                  <div className="flex items-center gap-2 min-w-0">
                    <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {groqMaskedKey || "gsk_••••••••••••••••"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingGroqKey(true);
                      setGroqKeyInput("");
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1 text-[11px] cursor-pointer"
                    title="Editar chave da Groq"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Alterar</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showGroqKey ? "text" : "password"}
                      value={groqKeyInput}
                      onChange={(e) => setGroqKeyInput(e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-[#1c1c1e] border border-[#333] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 pr-10 focus:outline-none focus:border-[#f55036] font-mono transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGroqKey(!showGroqKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer p-0.5"
                      title={showGroqKey ? "Ocultar chave" : "Mostrar chave"}
                    >
                      {showGroqKey ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveGroqKey}
                      disabled={isSavingGroq || !groqKeyInput.trim()}
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-[#f55036] to-[#f87171] text-white text-xs font-semibold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingGroq ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Key className="w-3.5 h-3.5" />
                      )}
                      Salvar Chave Groq
                    </button>

                    {isEditingGroqKey && (
                      <button
                        type="button"
                        onClick={() => setIsEditingGroqKey(false)}
                        className="py-2 px-3 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CARD MOTOR KIE.AI (SOL - LARISSA) */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center shadow-md">
                  <Bot className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Kie.ai (Modelo Sol - Larissa)
                    {isKieConfigured && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#3ecf8e]" />
                    )}
                  </h3>
                  <p className="text-[11px] text-[#a8a8a8]">
                    gpt-5-6-sol (Persona Principal com Raciocínio)
                  </p>
                </div>
              </div>

              {isKieConfigured ? (
                <span className="text-[10px] bg-[#3ecf8e]/15 text-[#3ecf8e] font-bold px-2 py-0.5 rounded-full border border-[#3ecf8e]/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
                  Ativo
                </span>
              ) : (
                <span className="text-[10px] bg-amber-500/15 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                  Chave Pendente
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-[#222] space-y-2.5 text-xs">
              <p className="text-[#a8a8a8] text-[11px] leading-relaxed">
                Chave da API da Kie.ai utilizada pelo Sol para formular todas as mensagens com o DNA da Larissa, cadência humana e raciocínio profundo.
              </p>

              {isKieConfigured && !isEditingKieKey ? (
                <div className="flex items-center justify-between bg-[#1c1c1e] p-2.5 rounded-xl border border-[#262626]">
                  <div className="flex items-center gap-2 min-w-0">
                    <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {kieMaskedKey || "••••••••••••••••"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingKieKey(true);
                      setKieKeyInput("");
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1 text-[11px] cursor-pointer active:scale-95 transition-transform min-h-[44px]"
                    title="Editar chave da Kie.ai"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Alterar</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showKieKey ? "text" : "password"}
                      value={kieKeyInput}
                      onChange={(e) => setKieKeyInput(e.target.value)}
                      placeholder="Cole a chave da Kie.ai aqui..."
                      className="w-full bg-[#1c1c1e] border border-[#333] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 pr-10 focus:outline-none focus:border-amber-400 font-mono transition-colors min-h-[44px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKieKey(!showKieKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title={showKieKey ? "Ocultar chave" : "Mostrar chave"}
                    >
                      {showKieKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveKieKey}
                      disabled={isSavingKie || !kieKeyInput.trim()}
                      className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-xs hover:opacity-95 active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingKie ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Key className="w-4 h-4" />
                      )}
                      Salvar Chave Kie.ai
                    </button>

                    {isEditingKieKey && (
                      <button
                        type="button"
                        onClick={() => setIsEditingKieKey(false)}
                        className="min-h-[44px] py-2 px-3 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 active:scale-95 transition-transform cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CARD SUGESTÕES DE RESPOSTA */}
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Sugestões de Resposta IA</h4>
                  <p className="text-[11px] text-[#a8a8a8]">Gera respostas contextuais em 1 clique</p>
                </div>
              </div>
              <span className="text-[10px] bg-amber-400/15 text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-400/30">
                Ativado
              </span>
            </div>
          </div>
        </div>

        {/* SEÇÃO: FUNIL DE CONVERSÃO & ETAPAS (CHECK-UPS) */}
        <div className="space-y-2.5">
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-3.5 sm:p-5 shadow-sm">
            <ChatStagesManager
              stages={stages}
              onCreateStage={createStage}
              onUpdateStage={updateStage}
              onDeleteStage={deleteStage}
              onMoveUp={moveStageUp}
              onMoveDown={moveStageDown}
              onAddGoal={addGoal}
              onUpdateGoal={updateGoal}
              onDeleteGoal={deleteGoal}
              onMoveGoalUp={moveGoalUp}
              onMoveGoalDown={moveGoalDown}
            />
          </div>
        </div>

        {/* SEÇÃO: PILOTO AUTOMÁTICO INTELIGENTE (IA AUTÔNOMA) */}
        <div className="space-y-2.5">
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-3.5 sm:p-5 shadow-sm">
            <AutoPilotConfigManager />
          </div>
        </div>

        {/* SEÇÃO 4: SISTEMA & ARQUITETURA */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-[#8e8e8e] uppercase tracking-wider px-1">
            Sistema & Infraestrutura
          </h2>
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-3.5 sm:p-5 text-xs space-y-2 shadow-sm text-[#a8a8a8]">
            <div className="flex justify-between items-center py-1 border-b border-[#222]">
              <span>Versão do Vendeo</span>
              <span className="font-mono text-white font-medium">v1.0.0</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-[#222]">
              <span>Padrão de Arquitetura</span>
              <span className="text-white font-medium">Clean Architecture</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-[#222]">
              <span>Provedor de Banco de Dados</span>
              <span className="text-[#3ecf8e] font-medium">Supabase (PostgreSQL 15)</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span>Status dos Servidores BFF</span>
              <span className="text-[#10b981] font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Operacional
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Conexão com o Tinder */}
      <TinderConnectModal
        isOpen={isTinderModalOpen}
        onClose={() => {
          setIsTinderModalOpen(false);
          checkTinderStatus();
        }}
        session={tinderSession}
        onConnect={handleConnectTinder}
        onDisconnect={handleDisconnectTinder}
        onSyncMatches={handleSyncMatches}
      />
      {/* Modal de Conexão com o Instagram */}
      <InstagramConnectModal
        isOpen={isInstagramModalOpen}
        onClose={() => {
          setIsInstagramModalOpen(false);
          checkInstagramStatus();
        }}
        onConnectionChange={checkInstagramStatus}
      />
    </div>
  );
}
