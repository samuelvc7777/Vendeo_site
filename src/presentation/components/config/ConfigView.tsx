"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import {
  Camera,
  CheckCircle2,
  Edit2,
  Eye,
  EyeOff,
  Flame,
  Key,
  Loader2,
  LogOut,
  Mic,
  RefreshCw,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";
import { TinderSession } from "@/domain/entities/Tinder";
import { InstagramAccount } from "@/domain/entities/Instagram";
import { TinderConnectModal } from "@/presentation/components/tinder/TinderConnectModal";
import { InstagramConnectModal } from "@/presentation/components/instagram/InstagramConnectModal";
import { getApiUrl } from "@/infrastructure/http/network";
import { ChatStagesManager } from "./ChatStagesManager";
import { AutoPilotConfigManager } from "./AutoPilotConfigManager";
import { useChatStages } from "@/presentation/hooks/useChatStages";

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-1">
      <h2 className="text-sm font-bold tracking-tight text-white">{title}</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}

function StatusPill({
  active,
  activeLabel = "Ativo",
  inactiveLabel = "Desconectado",
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return active ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {activeLabel}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-700 bg-zinc-800/70 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
      {inactiveLabel}
    </span>
  );
}

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
  const [isLoadingTinder, setIsLoadingTinder] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [instagramAccount, setInstagramAccount] = useState<InstagramAccount | null>(null);
  const [isInstagramConnected, setIsInstagramConnected] = useState<boolean | null>(null);
  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);

  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [isGroqConfigured, setIsGroqConfigured] = useState(false);
  const [isSavingGroq, setIsSavingGroq] = useState(false);
  const [groqMaskedKey, setGroqMaskedKey] = useState<string | null>(null);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isEditingGroqKey, setIsEditingGroqKey] = useState(false);

  useEffect(() => {
    void checkTinderStatus();
    void checkInstagramStatus();
    void checkGroqStatus();
  }, []);

  const checkGroqStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/ai/transcribe"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setIsGroqConfigured(Boolean(data.configured));
      setGroqMaskedKey(data.maskedKey || null);
    } catch {
      // Falha temporária não deve desmontar o estado visual já conhecido.
    }
  };

  const handleSaveGroqKey = async () => {
    const key = groqKeyInput.trim();
    if (!key.startsWith("gsk_")) {
      toast.error("A chave de transcrição deve começar com 'gsk_'");
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
      toast.success("Chave de transcrição configurada com sucesso!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar chave");
    } finally {
      setIsSavingGroq(false);
    }
  };

  const checkInstagramStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/instagram/config"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.isConnected === "boolean") {
        setIsInstagramConnected(data.isConnected);
      }
      setInstagramAccount(data.account || null);
    } catch {
      // Mantém o último estado conhecido em oscilações de rede.
    }
  };

  const checkTinderStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/tinder/status"), { cache: "no-store" });
      if (!res.ok) return;
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
    } catch (err) {
      console.warn("Falha temporária ao verificar Tinder:", err);
    }
  };

  const handleConnectTinder = async (token: string) => {
    const res = await fetch(getApiUrl("/api/tinder/auth"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao conectar com o Tinder.");

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
    setIsLoadingTinder(true);
    try {
      await fetch(getApiUrl("/api/tinder/matches"));
      setSyncSuccess(true);
      window.setTimeout(() => setSyncSuccess(false), 2500);
    } finally {
      setIsLoadingTinder(false);
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-black text-white">
      <header className="shrink-0 border-b border-[#262626] bg-black/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white">Configurações</h1>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Contas, automação, áudio e fluxo de conversas
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
            <Sliders className="h-3 w-3 text-sky-400" />
            Config
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-none">
        <main className="mx-auto w-full max-w-6xl space-y-6 px-3 pb-28 pt-4 sm:px-5 md:px-6 md:pt-6">
          <section className="space-y-3">
            <SectionHeading
              title="Contas"
              description="Gerencie os canais usados para receber e responder conversas."
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <article className="min-w-0 rounded-2xl border border-[#262626] bg-[#111113] p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#fd297b] to-[#ff5864]">
                      <Flame className="h-5 w-5 fill-white text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-white">Tinder</h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Matches e mensagens da conta conectada
                      </p>
                    </div>
                  </div>
                  <StatusPill active={Boolean(tinderSession?.isConnected)} />
                </div>

                <div className="mt-4 border-t border-zinc-800/80 pt-4">
                  {tinderSession?.isConnected ? (
                    <div className="space-y-3">
                      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#fe3c72]/20 bg-[#1a1416] p-3">
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-[#fe3c72]/80">
                          <Image
                            src={tinderSession.profile?.photos?.[0]?.url || "/favicon.ico"}
                            alt={tinderSession.profile?.name || "Tinder"}
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-white">
                            {tinderSession.profile?.name || "Conta Tinder"}
                          </p>
                          <p className="truncate text-[11px] text-[#ff7597]">
                            Conta conectada
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          onClick={handleSyncMatches}
                          disabled={isLoadingTinder}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50"
                        >
                          {isLoadingTinder ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4 text-sky-400" />
                          )}
                          {syncSuccess ? "Sincronizado" : "Sincronizar"}
                        </button>
                        <button
                          onClick={handleDisconnectTinder}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-900/50 bg-red-950/30 px-4 text-xs font-semibold text-red-400 transition hover:bg-red-950/50"
                        >
                          <LogOut className="h-4 w-4" />
                          Desconectar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] leading-relaxed text-zinc-400 sm:max-w-sm">
                        Conecte a conta para receber e responder matches pelo Chat.
                      </p>
                      <button
                        onClick={() => setIsTinderModalOpen(true)}
                        className="min-h-11 w-full rounded-xl bg-gradient-to-r from-[#fd297b] to-[#ff5864] px-4 text-xs font-bold text-white transition active:scale-[0.98] sm:w-auto"
                      >
                        Conectar Tinder
                      </button>
                    </div>
                  )}
                </div>
              </article>

              <article className="min-w-0 rounded-2xl border border-[#262626] bg-[#111113] p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888]">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-white">Instagram Direct</h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Mensagens oficiais e atualizações em tempo real
                      </p>
                    </div>
                  </div>
                  {isInstagramConnected === null ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] text-zinc-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Verificando
                    </span>
                  ) : (
                    <StatusPill active={isInstagramConnected} activeLabel="Conectado" />
                  )}
                </div>

                <div className="mt-4 border-t border-zinc-800/80 pt-4">
                  {isInstagramConnected && instagramAccount ? (
                    <div className="space-y-3">
                      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#bc1888]/20 bg-[#1a1518] p-3">
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-[#bc1888]/70">
                          {instagramAccount.profilePictureUrl ? (
                            <Image
                              src={instagramAccount.profilePictureUrl}
                              alt={instagramAccount.username}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-[#f09433] to-[#bc1888] text-xs font-bold text-white">
                              {instagramAccount.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-white">
                            {instagramAccount.name || instagramAccount.username}
                          </p>
                          <p className="truncate text-[11px] text-[#e6683c]">
                            @{instagramAccount.username}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setIsInstagramModalOpen(true)}
                        className="min-h-11 w-full rounded-xl bg-zinc-800 px-4 text-xs font-semibold text-white transition hover:bg-zinc-700"
                      >
                        Gerenciar Instagram
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] leading-relaxed text-zinc-400 sm:max-w-sm">
                        Conecte a conta para sincronizar o Direct e responder mensagens reais.
                      </p>
                      <button
                        onClick={() => setIsInstagramModalOpen(true)}
                        className="min-h-11 w-full rounded-xl bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] px-4 text-xs font-bold text-white transition active:scale-[0.98] sm:w-auto"
                      >
                        Conectar Instagram
                      </button>
                    </div>
                  )}
                </div>
              </article>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading
              title="IA e áudio"
              description="Configure a transcrição usada para o Brain entender mensagens de voz."
            />

            <article className="min-w-0 rounded-2xl border border-[#262626] bg-[#111113] p-4 shadow-sm sm:p-5">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-white">Áudio e Transcrição</h3>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Transcrição automática das mensagens de voz
                    </p>
                  </div>
                </div>
                <StatusPill
                  active={isGroqConfigured}
                  activeLabel="Configurado"
                  inactiveLabel="Chave pendente"
                />
              </div>

              <div className="mt-4 border-t border-zinc-800/80 pt-4">
                {isGroqConfigured && !isEditingGroqKey ? (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5">
                      <Key className="h-4 w-4 shrink-0 text-amber-400" />
                      <span className="truncate font-mono text-[11px] text-zinc-300">
                        {groqMaskedKey || "gsk_••••••••••••••••"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingGroqKey(true);
                        setGroqKeyInput("");
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700 sm:w-auto"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Alterar chave
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="relative min-w-0">
                      <input
                        type={showGroqKey ? "text" : "password"}
                        value={groqKeyInput}
                        onChange={(e) => setGroqKeyInput(e.target.value)}
                        placeholder="gsk_..."
                        className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 pr-11 font-mono text-xs text-white outline-none transition focus:border-orange-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey((current) => !current)}
                        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                        title={showGroqKey ? "Ocultar chave" : "Mostrar chave"}
                      >
                        {showGroqKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex">
                      <button
                        type="button"
                        onClick={handleSaveGroqKey}
                        disabled={isSavingGroq || !groqKeyInput.trim()}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-xs font-bold text-black transition disabled:opacity-40"
                      >
                        {isSavingGroq ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Salvar chave
                      </button>
                      {isEditingGroqKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingGroqKey(false);
                            setGroqKeyInput("");
                          }}
                          className="min-h-11 rounded-xl bg-zinc-800 px-4 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </article>
          </section>

          <section className="space-y-3">
            <SectionHeading
              title="Funil de conversa"
              description="Organize etapas, objetivos e avanço das conversas."
            />
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[#262626] bg-[#111113] p-3 shadow-sm sm:p-4 md:p-5">
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
          </section>

          <section className="space-y-3">
            <SectionHeading
              title="Piloto Automático"
              description="Controle o Brain, o tempo de resposta e a operação automática."
            />
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[#262626] bg-[#111113] p-3 shadow-sm sm:p-4 md:p-5">
              <AutoPilotConfigManager />
            </div>
          </section>
        </main>
      </div>

      <TinderConnectModal
        isOpen={isTinderModalOpen}
        onClose={() => {
          setIsTinderModalOpen(false);
          void checkTinderStatus();
        }}
        session={tinderSession}
        onConnect={handleConnectTinder}
        onDisconnect={handleDisconnectTinder}
        onSyncMatches={handleSyncMatches}
      />

      <InstagramConnectModal
        isOpen={isInstagramModalOpen}
        onClose={() => {
          setIsInstagramModalOpen(false);
          void checkInstagramStatus();
        }}
        onConnectionChange={checkInstagramStatus}
      />
    </div>
  );
}
