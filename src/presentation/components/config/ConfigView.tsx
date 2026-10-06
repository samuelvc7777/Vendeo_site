"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Camera,
  Flame,
  CheckCircle2,
  Edit2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Mic,
  Moon,
  Sliders,
  Sun,
  Bot,
  Workflow,
  Link2,
  Sparkles,
  ChevronLeft,
  MessageCircle,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { InstagramAccount } from "@/domain/entities/Instagram";
import { InstagramConnectModal } from "@/presentation/components/instagram/InstagramConnectModal";
import { getApiUrl } from "@/infrastructure/http/network";
import { AutoPilotConfigManager } from "./AutoPilotConfigManager";
import { ConversationSchedulesManager } from "./ConversationSchedulesManager";
import { useChatStages } from "@/presentation/hooks/useChatStages";
import { useConversationSchedules } from "@/presentation/hooks/useConversationSchedules";
import { useTheme } from "@/presentation/context/ThemeContext";
import { WhatsApp2ConnectionCard } from "./WhatsApp2ConnectionCard";
import { WhatsAppStoryMediaManager } from "./WhatsAppStoryMediaManager";
import { TinderConnectionCard } from "./TinderConnectionCard";
import { getTinderStatus } from "@/presentation/components/match/tinder-client";
import { useIsMobile } from "@/presentation/hooks/useIsMobile";
import { MobilePageHeader } from "@/presentation/components/ui/MobilePageHeader";
import {
  SettingsGroup,
  SettingsItemRow,
  SettingsToggleRow,
} from "./SettingsSectionGroup";

function SectionHeading({
  title,
  description,
  eyebrow = "Configuração",
}: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <div className="flex items-start gap-3 px-1">
      <div className="mt-0.5 h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-sky-400 via-violet-500 to-fuchsia-500" />
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-[15px] font-black tracking-tight text-zinc-950 dark:text-white">{title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
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
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/25 bg-white/80 dark:bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300 shadow-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {activeLabel}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-zinc-500 dark:text-zinc-400 shadow-sm">
      {inactiveLabel}
    </span>
  );
}

type SettingsSubSection = "whatsapp" | "tinder" | "stories" | "ia" | "schedules" | "autopilot" | null;

export interface ConfigViewProps {
  onDetailOpenChange?: (isOpen: boolean) => void;
}

export function ConfigView({ onDetailOpenChange }: ConfigViewProps = {}) {
  const { theme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [activeSubSection, setActiveSubSection] = useState<SettingsSubSection>(null);
  const isPushedToHistoryRef = useRef(false);

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
  } = useChatStages(undefined, { loadAllProgresses: false });
  const {
    schedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    moveSchedule,
  } = useConversationSchedules();

  const [instagramAccount, setInstagramAccount] = useState<InstagramAccount | null>(null);
  const [isInstagramConnected, setIsInstagramConnected] = useState<boolean | null>(null);
  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);
  const [isWhatsApp2Connected, setIsWhatsApp2Connected] = useState<boolean | null>(null);
  const [isTinderConnected, setIsTinderConnected] = useState<boolean | null>(null);

  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [isGroqConfigured, setIsGroqConfigured] = useState(false);
  const [isSavingGroq, setIsSavingGroq] = useState(false);
  const [groqMaskedKey, setGroqMaskedKey] = useState<string | null>(null);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isEditingGroqKey, setIsEditingGroqKey] = useState(false);

  useEffect(() => {
    void checkInstagramStatus();
    void checkGroqStatus();
    void checkTinderConnectionStatus();
  }, []);

  const closeDetailDirectly = useCallback(() => {
    setActiveSubSection(null);
    onDetailOpenChange?.(false);
  }, [onDetailOpenChange]);

  // Suporte a botão de voltar nativo (Android/iOS/PWA)
  useEffect(() => {
    const handlePopState = () => {
      if (activeSubSection) {
        isPushedToHistoryRef.current = false;
        closeDetailDirectly();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [activeSubSection, closeDetailDirectly]);

  const handleOpenSubSection = (section: NonNullable<SettingsSubSection>) => {
    setActiveSubSection(section);
    onDetailOpenChange?.(true);

    if (typeof window !== "undefined") {
      if (!isPushedToHistoryRef.current) {
        window.history.pushState({ vendeoSettingsDetail: section }, "");
        isPushedToHistoryRef.current = true;
      } else {
        window.history.replaceState({ vendeoSettingsDetail: section }, "");
      }
    }
  };

  const handleBackToSettings = () => {
    if (isPushedToHistoryRef.current) {
      isPushedToHistoryRef.current = false;
      if (typeof window !== "undefined" && window.history.length > 1) {
        window.history.back();
      }
    }
    closeDetailDirectly();
  };

  const checkTinderConnectionStatus = async () => {
    try {
      const status = await getTinderStatus();
      setIsTinderConnected(Boolean(status.connected));
    } catch {
      setIsTinderConnected(false);
    }
  };

  const checkGroqStatus = async () => {
    try {
      const res = await fetch(getApiUrl("/api/ai/transcribe"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setIsGroqConfigured(Boolean(data.configured));
      setGroqMaskedKey(data.maskedKey || null);
    } catch {
      // Falha temporária não desmonta o estado
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
      // Mantém o último estado conhecido
    }
  };

  const connectedChannels =
    Number(Boolean(isInstagramConnected)) +
    Number(Boolean(isWhatsApp2Connected));
  const availableChannelCount = 2;
  const activeObjectives = stages.reduce(
    (total, stage) => total + (stage.goals || []).filter((goal) => goal.enabled !== false).length,
    0,
  );

  // =========================================================================
  // SUB-TELAS MOBILE (VISÃO DE DETALHE COMPLETA)
  // =========================================================================
  if (isMobile && activeSubSection !== null) {
    let detailTitle = "Configuração";
    let detailContent: React.ReactNode = null;

    switch (activeSubSection) {
      case "whatsapp":
        detailTitle = "WhatsApp";
        detailContent = (
          <div className="space-y-4">
            <WhatsApp2ConnectionCard onConnectionChange={setIsWhatsApp2Connected} />
          </div>
        );
        break;

      case "tinder":
        detailTitle = "Tinder";
        detailContent = (
          <div className="space-y-4">
            <TinderConnectionCard onConnectionChange={setIsTinderConnected} />
          </div>
        );
        break;

      case "stories":
        detailTitle = "Stories (Evergreen)";
        detailContent = (
          <div className="space-y-4">
            <WhatsAppStoryMediaManager />
          </div>
        );
        break;

      case "schedules":
        detailTitle = "Cronogramas & Etapas";
        detailContent = (
          <div className="space-y-4">
            <ConversationSchedulesManager
              schedules={schedules}
              stages={stages}
              onCreateSchedule={createSchedule}
              onUpdateSchedule={updateSchedule}
              onDeleteSchedule={deleteSchedule}
              onMoveSchedule={moveSchedule}
              onCreateStage={createStage}
              onUpdateStage={updateStage}
              onDeleteStage={deleteStage}
              onMoveStageUp={moveStageUp}
              onMoveStageDown={moveStageDown}
              onAddGoal={addGoal}
              onUpdateGoal={updateGoal}
              onDeleteGoal={deleteGoal}
              onMoveGoalUp={moveGoalUp}
              onMoveGoalDown={moveGoalDown}
            />
          </div>
        );
        break;

      case "autopilot":
        detailTitle = "Piloto Automático";
        detailContent = (
          <div className="space-y-4">
            <AutoPilotConfigManager />
          </div>
        );
        break;

      case "ia":
        detailTitle = "IA & Transcrição";
        detailContent = (
          <div className="space-y-4">
            <article className="relative min-w-0 overflow-hidden rounded-[26px] border border-orange-200/80 dark:border-orange-500/15 bg-gradient-to-br from-white via-white to-orange-50/70 dark:from-[#121214] dark:via-[#111113] dark:to-[#18130f] p-4 shadow-sm">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-700 dark:text-orange-300">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-zinc-950 dark:text-white">Áudio e Transcrição</h3>
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

              <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800/80 pt-4">
                {isGroqConfigured && !isEditingGroqKey ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2.5 shadow-sm">
                      <Key className="h-4 w-4 shrink-0 text-amber-400" />
                      <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                        {groqMaskedKey || "gsk_••••••••••••••••"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingGroqKey(true);
                        setGroqKeyInput("");
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-bold text-zinc-800 dark:text-zinc-200 shadow-sm transition active:scale-95"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Alterar chave
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative min-w-0">
                      <input
                        type={showGroqKey ? "text" : "password"}
                        value={groqKeyInput}
                        onChange={(e) => setGroqKeyInput(e.target.value)}
                        placeholder="gsk_..."
                        className="min-h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 pr-11 font-mono text-[16px] md:text-xs text-zinc-950 dark:text-white outline-none transition focus:border-orange-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey((current) => !current)}
                        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-400 transition hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
                        title={showGroqKey ? "Ocultar chave" : "Mostrar chave"}
                      >
                        {showGroqKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleSaveGroqKey}
                        disabled={isSavingGroq || !groqKeyInput.trim()}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-xs font-bold text-black transition active:scale-95 disabled:opacity-40"
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
                          className="min-h-11 rounded-xl bg-zinc-200 dark:bg-zinc-800 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition active:scale-95"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </article>
          </div>
        );
        break;
    }

    return (
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#f6f7fb] dark:bg-[#050506] text-zinc-950 dark:text-white animate-in fade-in duration-150">
        <MobilePageHeader
          title={detailTitle}
          subtitle="Configurações"
          leftAction={
            <button
              type="button"
              onClick={handleBackToSettings}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center -ml-2 text-[#007aff] transition-transform active:scale-90"
              aria-label="Voltar para Configurações"
            >
              <ChevronLeft className="h-7 w-7 stroke-[2.2]" />
            </button>
          }
        />

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] scrollbar-none">
          {detailContent}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VISÃO PRINCIPAL MOBILE (LISTA CATEGORIZADA NATIVA COM CHEVRON)
  // =========================================================================
  if (isMobile) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#f6f7fb] dark:bg-[#050506] text-zinc-950 dark:text-white">
        <header className="shrink-0 pt-[env(safe-area-inset-top,0px)] border-b border-zinc-200/80 dark:border-white/10 bg-white/90 dark:bg-black/85 backdrop-blur-2xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 text-white shadow-md">
                <Sliders className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                  Vendeo
                </p>
                <h1 className="text-[15px] font-black tracking-tight text-zinc-950 dark:text-white">
                  Configurações
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-2.5 text-[10px] font-bold text-zinc-700 dark:text-zinc-200 shadow-sm active:scale-95"
              aria-label={theme === "dark" ? "Tema claro" : "Tema escuro"}
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-violet-500" />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-28 space-y-5 scrollbar-none">
          {/* Card Resumo do Sistema */}
          <div className="rounded-2xl border border-zinc-200/80 dark:border-white/10 bg-gradient-to-br from-white via-sky-50/70 to-violet-50/70 dark:from-[#121218] dark:via-[#0d0d12] dark:to-[#171222] p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                Operação Ativa
              </span>
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] p-2 text-center backdrop-blur">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">Canais</p>
                <p className="mt-0.5 text-base font-black text-zinc-950 dark:text-white">
                  {connectedChannels}<span className="text-xs text-zinc-400">/{availableChannelCount}</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] p-2 text-center backdrop-blur">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">Etapas</p>
                <p className="mt-0.5 text-base font-black text-zinc-950 dark:text-white">{stages.length}</p>
              </div>
              <div className="rounded-xl border border-white/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] p-2 text-center backdrop-blur">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">Objetivos</p>
                <p className="mt-0.5 text-base font-black text-zinc-950 dark:text-white">{activeObjectives}</p>
              </div>
            </div>
          </div>

          {/* Grupo: CANAIS & CONEXÕES */}
          <SettingsGroup title="Canais & Conexões">
            <SettingsItemRow
              icon={<MessageCircle className="h-5 w-5" />}
              iconBgClassName="bg-[#25d366] text-white"
              title="WhatsApp"
              subtitle="Dispositivo vinculado via WhatsApp Web"
              badge={
                <StatusPill
                  active={Boolean(isWhatsApp2Connected)}
                  activeLabel="Conectado"
                  inactiveLabel="Desconectado"
                />
              }
              onClick={() => handleOpenSubSection("whatsapp")}
            />

            <SettingsItemRow
              icon={<Camera className="h-5 w-5" />}
              iconBgClassName="bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-white"
              title="Instagram Direct"
              subtitle={instagramAccount ? `@${instagramAccount.username}` : "Mensagens oficiais da Meta"}
              badge={
                <StatusPill
                  active={Boolean(isInstagramConnected)}
                  activeLabel="Conectado"
                  inactiveLabel="Conectar"
                />
              }
              onClick={() => setIsInstagramModalOpen(true)}
            />

            <SettingsItemRow
              icon={<Flame className="h-5 w-5 fill-current" />}
              iconBgClassName="bg-gradient-to-br from-[#ff6036] via-[#fd5068] to-[#e8368f] text-white"
              title="Tinder"
              subtitle="Provedor da nova área Match"
              badge={
                <StatusPill
                  active={Boolean(isTinderConnected)}
                  activeLabel="Conectado"
                  inactiveLabel="Conectar"
                />
              }
              onClick={() => handleOpenSubSection("tinder")}
            />

            <SettingsItemRow
              icon={<Layers className="h-5 w-5" />}
              iconBgClassName="bg-sky-500 text-white"
              title="Stories (Evergreen)"
              subtitle="Biblioteca de status com anti-repetição"
              onClick={() => handleOpenSubSection("stories")}
            />
          </SettingsGroup>

          {/* Grupo: AUTOMAÇÃO & IA */}
          <SettingsGroup title="Automação & IA">
            <SettingsItemRow
              icon={<Bot className="h-5 w-5" />}
              iconBgClassName="bg-purple-600 text-white"
              title="Piloto Automático"
              subtitle="Brain, tempo de resposta e autonomia"
              onClick={() => handleOpenSubSection("autopilot")}
            />

            <SettingsItemRow
              icon={<Workflow className="h-5 w-5" />}
              iconBgClassName="bg-violet-600 text-white"
              title="Cronogramas & Etapas"
              subtitle={`${schedules.length} cronograma(s) · ${stages.length} etapa(s)`}
              onClick={() => handleOpenSubSection("schedules")}
            />

            <SettingsItemRow
              icon={<Mic className="h-5 w-5" />}
              iconBgClassName="bg-orange-500 text-white"
              title="IA & Transcrição"
              subtitle="Groq Whisper para áudio das conversas"
              badge={
                <StatusPill
                  active={isGroqConfigured}
                  activeLabel="Ativo"
                  inactiveLabel="Pendente"
                />
              }
              onClick={() => handleOpenSubSection("ia")}
            />
          </SettingsGroup>

          {/* Grupo: SISTEMA */}
          <SettingsGroup title="Sistema">
            <SettingsToggleRow
              icon={theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              iconBgClassName={theme === "dark" ? "bg-violet-600 text-white" : "bg-amber-500 text-white"}
              title="Tema Escuro"
              subtitle={theme === "dark" ? "Ativado" : "Desativado"}
              checked={theme === "dark"}
              onChange={toggleTheme}
            />
          </SettingsGroup>
        </div>

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

  // =========================================================================
  // VISÃO DESKTOP (PRESERVADA 100% COM LAYOUT AMPLO E PAINÉIS LADO A LADO)
  // =========================================================================
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#f6f7fb] dark:bg-[#050506] text-zinc-950 dark:text-white">
      <header className="shrink-0 border-b border-zinc-200/80 dark:border-white/10 bg-white/90 dark:bg-black/85 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20">
              <Sliders className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                Vendeo
              </p>
              <h1 className="truncate text-[15px] font-black tracking-tight text-zinc-950 dark:text-white">
                Central de Controle
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3 text-[10px] font-bold text-zinc-700 dark:text-zinc-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:hover:bg-white/10"
            aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
            title={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-violet-500" />
            )}
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-none">
        <main className="mx-auto w-full max-w-6xl space-y-8 px-3 pb-28 pt-4 sm:px-5 md:px-6">
          <section className="relative overflow-hidden rounded-[28px] border border-zinc-200/80 dark:border-white/10 bg-gradient-to-br from-white via-sky-50/80 to-violet-50 dark:from-[#121218] dark:via-[#0d0d12] dark:to-[#171222] p-4 shadow-[0_18px_60px_-28px_rgba(59,130,246,0.45)] sm:p-5">
            <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-500/10" />
            <div className="pointer-events-none absolute -bottom-16 -left-12 h-36 w-36 rounded-full bg-sky-400/15 blur-3xl dark:bg-sky-500/10" />

            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                    Sistema operacional
                  </span>
                  <h2 className="mt-3 text-xl font-black tracking-[-0.035em] text-zinc-950 dark:text-white">
                    Tudo do Vendeo,
                    <span className="block bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                      em um só lugar.
                    </span>
                  </h2>
                  <p className="mt-2 max-w-md text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Conexões, Brain, automação e o funil de conversa organizados como uma central de operação.
                  </p>
                </div>
                <Sparkles className="mt-1 h-5 w-5 shrink-0 text-violet-400" />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-white/80 dark:border-white/10 bg-white/75 dark:bg-white/[0.04] p-3 shadow-sm backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                    <Link2 className="h-3 w-3 text-sky-500" />
                    Canais
                  </div>
                  <p className="mt-1 text-lg font-black text-zinc-950 dark:text-white">
                    {connectedChannels}<span className="text-xs text-zinc-400">/{availableChannelCount}</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 dark:border-white/10 bg-white/75 dark:bg-white/[0.04] p-3 shadow-sm backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                    <Workflow className="h-3 w-3 text-violet-500" />
                    Etapas
                  </div>
                  <p className="mt-1 text-lg font-black text-zinc-950 dark:text-white">{stages.length}</p>
                </div>
                <div className="rounded-2xl border border-white/80 dark:border-white/10 bg-white/75 dark:bg-white/[0.04] p-3 shadow-sm backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                    <Bot className="h-3 w-3 text-fuchsia-500" />
                    Objetivos
                  </div>
                  <p className="mt-1 text-lg font-black text-zinc-950 dark:text-white">{activeObjectives}</p>
                </div>
              </div>
            </div>
          </section>

          <section id="config-contas" className="scroll-mt-16 space-y-3">
            <SectionHeading
              eyebrow="Integrações"
              title="Canais conectados"
              description="Gerencie os canais usados para receber e responder conversas."
            />

            <div className="grid grid-cols-1 gap-3">
              <article className="min-w-0 rounded-2xl border border-zinc-200 dark:border-[#262626] bg-white dark:bg-[#111113] p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888]">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-zinc-950 dark:text-white">Instagram Direct</h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Mensagens oficiais e atualizações em tempo real
                      </p>
                    </div>
                  </div>
                  {isInstagramConnected === null ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 text-[10px] text-zinc-600 dark:text-zinc-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Verificando
                    </span>
                  ) : (
                    <StatusPill active={isInstagramConnected} activeLabel="Conectado" />
                  )}
                </div>

                <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800/80 pt-4">
                  {isInstagramConnected && instagramAccount ? (
                    <div className="space-y-3">
                      <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-fuchsia-200/80 dark:border-[#bc1888]/20 bg-white/80 dark:bg-[#1a1518] p-3 shadow-sm">
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
                          <p className="truncate text-xs font-bold text-zinc-950 dark:text-white">
                            {instagramAccount.name || instagramAccount.username}
                          </p>
                          <p className="truncate text-[11px] text-[#e6683c]">
                            @{instagramAccount.username}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setIsInstagramModalOpen(true)}
                        className="min-h-11 w-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-bold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-50 dark:hover:bg-white/10"
                      >
                        Gerenciar Instagram
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 sm:max-w-sm">
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

              <WhatsApp2ConnectionCard onConnectionChange={setIsWhatsApp2Connected} />

              <TinderConnectionCard onConnectionChange={setIsTinderConnected} />
            </div>
          </section>

          <section id="config-stories" className="scroll-mt-16 space-y-3">
            <SectionHeading
              eyebrow="WhatsApp Stories"
              title="Biblioteca de Stories (Evergreen)"
              description="Gerencie fotos e vídeos para os status e utilize a estratégia anti-repetição: contatos que já viram um story nunca o recebem novamente."
            />
            <WhatsAppStoryMediaManager />
          </section>

          <section id="config-ia" className="scroll-mt-16 space-y-3">
            <SectionHeading
              eyebrow="Inteligência"
              title="IA & áudio"
              description="Configure a transcrição usada para o Brain entender mensagens de voz."
            />

            <article className="relative min-w-0 overflow-hidden rounded-[26px] border border-orange-200/80 dark:border-orange-500/15 bg-gradient-to-br from-white via-white to-orange-50/70 dark:from-[#121214] dark:via-[#111113] dark:to-[#18130f] p-4 shadow-[0_18px_45px_-30px_rgba(249,115,22,0.45)] sm:p-5">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-700 dark:text-orange-300">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-zinc-950 dark:text-white">Áudio e Transcrição</h3>
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

              <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800/80 pt-4">
                {isGroqConfigured && !isEditingGroqKey ? (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2.5 shadow-sm">
                      <Key className="h-4 w-4 shrink-0 text-amber-400" />
                      <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                        {groqMaskedKey || "gsk_••••••••••••••••"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingGroqKey(true);
                        setGroqKeyInput("");
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-bold text-zinc-800 dark:text-zinc-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-50 dark:hover:bg-white/10 sm:w-auto"
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
                        className="min-h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 pr-11 font-mono text-[16px] md:text-xs text-zinc-950 dark:text-white outline-none transition focus:border-orange-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey((current) => !current)}
                        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-400 transition hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white"
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
                          className="min-h-11 rounded-xl bg-zinc-200 dark:bg-zinc-800 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-300 dark:hover:bg-zinc-700"
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

          <section id="config-funil" className="scroll-mt-16 space-y-3">
            <SectionHeading
              eyebrow="Estratégia"
              title="Cronogramas de conversa"
              description="Crie jornadas sequenciais com etapas, objetivos, modelo do Brain e tempo de resposta próprios."
            />
            <div className="min-w-0 overflow-hidden rounded-[28px] border border-violet-200/80 dark:border-violet-500/15 bg-gradient-to-br from-white to-violet-50/40 dark:from-[#111113] dark:to-[#15111d] p-2.5 shadow-[0_18px_50px_-34px_rgba(139,92,246,0.5)] sm:p-3.5">
              <ConversationSchedulesManager
                schedules={schedules}
                stages={stages}
                onCreateSchedule={createSchedule}
                onUpdateSchedule={updateSchedule}
                onDeleteSchedule={deleteSchedule}
                onMoveSchedule={moveSchedule}
                onCreateStage={createStage}
                onUpdateStage={updateStage}
                onDeleteStage={deleteStage}
                onMoveStageUp={moveStageUp}
                onMoveStageDown={moveStageDown}
                onAddGoal={addGoal}
                onUpdateGoal={updateGoal}
                onDeleteGoal={deleteGoal}
                onMoveGoalUp={moveGoalUp}
                onMoveGoalDown={moveGoalDown}
              />
            </div>
          </section>

          <section id="config-automacao" className="scroll-mt-16 space-y-3">
            <SectionHeading
              eyebrow="Operação"
              title="Piloto Automático"
              description="Controle a ativação global do Brain, notificações e operação automática. Modelo e tempo pertencem a cada cronograma."
            />
            <div className="min-w-0 overflow-hidden rounded-[28px] border border-purple-200/80 dark:border-purple-500/15 bg-gradient-to-br from-white to-purple-50/40 dark:from-[#111113] dark:to-[#15111b] p-2.5 shadow-[0_18px_50px_-34px_rgba(168,85,247,0.5)] sm:p-3.5">
              <AutoPilotConfigManager />
            </div>
          </section>
        </main>
      </div>

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
