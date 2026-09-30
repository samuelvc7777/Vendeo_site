"use client";

import React, { useCallback, useState, useEffect } from "react";
import {
  Bot,
  Clock,
  Sparkles,
  Trophy,
  BellRing,
  Key,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { AutoPilotConfig } from "@/domain/entities/AutoPilot";
import { SupabaseAutoPilotRepository } from "@/infrastructure/repositories/SupabaseAutoPilotRepository";
import { useMobileNotifications } from "@/presentation/hooks/useMobileNotifications";

const autoPilotRepo = new SupabaseAutoPilotRepository();
const OPENAI_CONFIG_ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/functions/v1/api/ai/openai-config`;

const PRESET_DELAYS = [
  { label: "1 min (Testes)", value: 1 },
  { label: "3 min", value: 3 },
  { label: "5 min", value: 5 },
  { label: "10 min (Recomendado)", value: 10 },
  { label: "15 min", value: 15 },
];

const MAX_BATCH_PRESETS = [
  { label: "3 min", value: 3 },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
];

export function AutoPilotConfigManager() {
  const [config, setConfig] = useState<AutoPilotConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiMaskedKey, setOpenAiMaskedKey] = useState<string | null>(null);
  const [openAiModel, setOpenAiModel] = useState("");
  const [openAiCurrentModel, setOpenAiCurrentModel] = useState<string | null>(null);
  const [openAiCurrentModelLabel, setOpenAiCurrentModelLabel] = useState<string | null>(null);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState("low");
  const [openAiVerbosity, setOpenAiVerbosity] = useState("low");
  const [isOpenAiReasoningDirty, setIsOpenAiReasoningDirty] = useState(false);
  const [isOpenAiVerbosityDirty, setIsOpenAiVerbosityDirty] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const mobileNotifications = useMobileNotifications();

  const loadOpenAiConfig = useCallback(async () => {
    try {
      const response = await fetch(OPENAI_CONFIG_ENDPOINT, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Falha ao carregar configuração OpenAI");
      setOpenAiMaskedKey(data.maskedKey || null);
      setOpenAiCurrentModel(data.model || null);
      setOpenAiCurrentModelLabel(data.modelLabel || null);
      if (data.model === "gpt-6-luna" || data.model === "gpt-6-sol" || data.model === "gpt-6.1-sol") setOpenAiModel(data.model);
      else setOpenAiModel("");
      if (data.reasoningEffort) setOpenAiReasoningEffort(data.reasoningEffort);
      if (data.verbosity) setOpenAiVerbosity(data.verbosity);
      setIsOpenAiReasoningDirty(false);
      setIsOpenAiVerbosityDirty(false);
    } catch (e) {
      console.warn("Aviso ao carregar configuração OpenAI:", e);
    }
  }, []);

  const handleSaveOpenAiConfig = async () => {
    if (!openAiKey.trim() && !openAiModel && !isOpenAiReasoningDirty && !isOpenAiVerbosityDirty) return;
    setIsSavingKey(true);
    try {
      const payload: Record<string, string | undefined> = {
        apiKey: openAiKey.trim() || undefined,
        model: openAiModel || undefined,
      };
      if (isOpenAiReasoningDirty) payload.reasoningEffort = openAiReasoningEffort;
      if (isOpenAiVerbosityDirty) payload.verbosity = openAiVerbosity;
      const response = await fetch(OPENAI_CONFIG_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Falha ao salvar configuração OpenAI");
      setOpenAiKey("");
      setOpenAiMaskedKey(data.maskedKey || openAiMaskedKey);
      setOpenAiCurrentModel(data.model || openAiCurrentModel);
      setOpenAiCurrentModelLabel(data.modelLabel || openAiCurrentModelLabel);
      setOpenAiModel(data.model === "gpt-6-luna" || data.model === "gpt-6-sol" || data.model === "gpt-6.1-sol" ? data.model : "");
      setOpenAiReasoningEffort(data.reasoningEffort || openAiReasoningEffort);
      setOpenAiVerbosity(data.verbosity || openAiVerbosity);
      setIsOpenAiReasoningDirty(false);
      setIsOpenAiVerbosityDirty(false);
      toast.success("Configuração do OpenAI — Brain da Larissa salva com sucesso!");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Erro ao salvar configuração OpenAI: " + message);
    } finally {
      setIsSavingKey(false);
    }
  };

  const loadConfig = useCallback(async () => {
    try {
      const data = await autoPilotRepo.getConfig();
      setConfig(data);
    } catch (err) {
      console.warn("Erro ao carregar config do piloto:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // A busca assíncrona inicializa os dados da tela; as atualizações ocorrem após I/O.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConfig();
    void loadOpenAiConfig();
  }, [loadConfig, loadOpenAiConfig]);

  const handleToggleGlobal = async (checked: boolean) => {
    if (!config) return;
    const next = { ...config, isEnabledGlobally: checked };
    setConfig(next);
    setIsSaving(true);
    try {
      await autoPilotRepo.saveConfig({ isEnabledGlobally: checked });
      if (checked) {
        toast.success("Piloto Automático ATIVADO! As conversas serão respondidas no tempo programado.");
      } else {
        toast.info("Piloto Automático DESLIGADO. Chats parados desligam na hora; os que já estão com o Brain trabalhando terminam o ciclo e desligam em seguida.");
      }
    } catch {
      toast.error("Erro ao alternar Piloto Automático.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (partial: Partial<AutoPilotConfig>) => {
    if (!config) return;
    const normalizedPartial = { ...partial };
    if (
      typeof normalizedPartial.responseDelayMinutes === "number" &&
      normalizedPartial.responseDelayMinutes > config.maxDebounceWindowMinutes
    ) {
      normalizedPartial.maxDebounceWindowMinutes = normalizedPartial.responseDelayMinutes;
    }
    if (
      typeof normalizedPartial.maxDebounceWindowMinutes === "number" &&
      normalizedPartial.maxDebounceWindowMinutes < (normalizedPartial.responseDelayMinutes ?? config.responseDelayMinutes)
    ) {
      normalizedPartial.maxDebounceWindowMinutes = normalizedPartial.responseDelayMinutes ?? config.responseDelayMinutes;
    }
    const next = { ...config, ...normalizedPartial };
    setConfig(next);
    setIsSaving(true);
    try {
      await autoPilotRepo.saveConfig(normalizedPartial);
      toast.success("Configuração do Piloto salva com sucesso!");
    } catch {
      toast.error("Erro ao salvar configuração.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !config) {
    return (
      <div className="p-4 rounded-2xl bg-[#141414] border border-[#262626] animate-pulse space-y-3">
        <div className="h-5 bg-zinc-800 rounded w-1/3" />
        <div className="h-10 bg-zinc-800/60 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 flex-wrap">
              Piloto Automático Inteligente
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30">
                IA Autônoma
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">
              Atendimento autônomo, cronograma por etapas, fila sequencial e hand-off.
            </p>
          </div>
        </div>

        {/* Chave Mestra Geral com Badge Visual */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto pt-1 sm:pt-0 border-t border-zinc-800/40 sm:border-t-0">
          <span
            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border transition-all ${
              config.isEnabledGlobally
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/35 animate-pulse"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}
          >
            {config.isEnabledGlobally ? "🟢 LIGADA (Ativa)" : "⚪ DESLIGADA (Parada)"}
          </span>

          <label className="relative inline-flex items-center cursor-pointer" title="Ligar ou desligar o Piloto Automático globalmente">
            <input
              type="checkbox"
              checked={config.isEnabledGlobally}
              onChange={(e) => handleToggleGlobal(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
          </label>
        </div>
      </div>

      <div className={`rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${
        config.isEnabledGlobally
          ? "border-emerald-500/20 bg-emerald-500/5 text-zinc-400"
          : "border-amber-500/25 bg-amber-500/5 text-zinc-400"
      }`}>
        <div className="flex items-start gap-2">
          <Info className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${config.isEnabledGlobally ? "text-emerald-400" : "text-amber-400"}`} />
          <p>
            Ao desligar, chats parados são interrompidos na hora. Um ciclo que já estiver processando termina com segurança e desliga em seguida.
          </p>
        </div>
      </div>

      {/* Card: OpenAI — Brain da Larissa */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-purple-500/20 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            OpenAI — Brain da Larissa
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 self-start sm:self-auto">
            {openAiMaskedKey ? "OpenAI conectada" : "OpenAI não configurada"}
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          O Brain oficial da Larissa usa o mesmo Agent OpenAI remoto. Escolha aqui o modelo aplicado ao Agent.
        </p>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium flex items-center gap-1">
            <Key className="w-3 h-3 text-amber-400" />
            Chave da API OpenAI
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="password"
              placeholder="sk-proj-..."
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              className="min-h-11 min-w-0 w-full flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none transition focus:border-purple-500"
            />
            <button
              type="button"
              disabled={isSavingKey}
              onClick={handleSaveOpenAiConfig}
              className="min-h-11 w-full shrink-0 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-purple-500 disabled:opacity-40 sm:w-auto"
            >
              {isSavingKey ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
          <span className="text-[10px] text-zinc-500">
            {openAiMaskedKey ? `Chave atual: ${openAiMaskedKey}. Deixe o campo vazio para manter a chave.` : "Nenhuma chave OpenAI configurada."}
          </span>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium block">Modelo do Brain</label>
          <select
            value={openAiModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setOpenAiModel(nextModel);
              if (nextModel === "gpt-6.1-sol" && openAiReasoningEffort === "none") {
                setOpenAiReasoningEffort("medium");
                setIsOpenAiReasoningDirty(true);
              }
            }}
            className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="" disabled>Selecione um modelo GPT-6</option>
            <option value="gpt-6-luna">GPT-6 Luna — Mais econômico</option>
            <option value="gpt-6-sol">GPT-6 Sol — Mais capacidade</option>
            <option value="gpt-6.1-sol">GPT-6.1 Sol — Novo Sol, cache mais barato</option>
          </select>
          <span className="text-[10px] text-zinc-500">
            Modelo atual: {openAiCurrentModelLabel || openAiCurrentModel || "não identificado"}
          </span>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium block">Esforço de raciocínio</label>
          <select value={openAiReasoningEffort} onChange={(e) => { setOpenAiReasoningEffort(e.target.value); setIsOpenAiReasoningDirty(true); }} className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500">
            <option value="none" disabled={openAiModel === "gpt-6.1-sol"}>None — mínimo tempo de raciocínio</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">XHigh — muito alto</option>
            <option value="max">Max — esforço máximo</option>
          </select>
          <span className="text-[10px] text-zinc-500">Esforço atual: {openAiReasoningEffort === "xhigh" ? "XHigh" : openAiReasoningEffort.charAt(0).toUpperCase() + openAiReasoningEffort.slice(1)}</span>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium block">Nível de verbosidade</label>
          <select value={openAiVerbosity} onChange={(e) => { setOpenAiVerbosity(e.target.value); setIsOpenAiVerbosityDirty(true); }} className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500">
            <option value="low">Low — respostas mais concisas</option>
            <option value="medium">Medium — equilíbrio</option>
            <option value="high">High — máximo de detalhe suportado</option>
          </select>
          <span className="text-[10px] text-zinc-500">Verbosity atual: {openAiVerbosity.charAt(0).toUpperCase() + openAiVerbosity.slice(1)}{openAiVerbosity === "high" ? " (máxima)" : ""}</span>
        </div>
      </div>

      {/* Card 0: Operação 100% Automática Direta */}
      <div className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#1a1a1d] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-white block">
              Disparo 100% Automático
            </span>
            <span className="text-[10.5px] text-zinc-400">
              A IA responde e envia mensagens diretamente sem exigir aprovação manual.
            </span>
          </div>
        </div>
        <span className="self-start shrink-0 rounded-lg border border-purple-500/30 bg-purple-500/20 px-2.5 py-1 text-[10px] font-bold text-purple-300 sm:self-auto">
          100% Autônomo
        </span>
      </div>

      {/* Notificações móveis */}
      <div className="space-y-3 rounded-xl border border-white/5 bg-[#1a1a1d] p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <BellRing className="w-3.5 h-3.5 text-purple-400" />
              Notificações no celular
            </span>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Alertas somente quando o Brain precisar de uma informação sua ou quando uma conversa for finalizada.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!mobileNotifications.remoteRegistered) {
                void mobileNotifications.requestPermission();
              }
            }}
            disabled={mobileNotifications.remoteRegistered || mobileNotifications.isLoading}
            className={`min-h-11 w-full shrink-0 rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition-all sm:w-auto ${
              mobileNotifications.remoteRegistered
                ? "bg-emerald-600/30 text-emerald-200 cursor-default"
                : "bg-purple-600 hover:bg-purple-500 text-white animate-pulse"
            }`}
          >
            {mobileNotifications.remoteRegistered ? "Push remoto ativo" : mobileNotifications.permission === "granted" ? "Vincular push remoto" : "Ativar no Celular"}
          </button>
        </div>
      </div>

      {/* Card 1: Tempo de Espera (Debounce da Última Mensagem) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-400" />
            Tempo de Espera antes de Responder:
          </span>
          <span className="text-xs font-bold text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-lg">
            {config.responseDelayMinutes} min
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          A IA aguarda este intervalo contado a partir da <strong>última mensagem</strong>. Novas mensagens podem reiniciar o quiet period, mas nunca passam do teto absoluto do lote configurado abaixo.
        </p>

        {/* Botões Rápidos de Delay */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
          {PRESET_DELAYS.map((preset, index) => {
            const isSelected = config.responseDelayMinutes === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleUpdate({ responseDelayMinutes: preset.value })}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-center ${
                  index === PRESET_DELAYS.length - 1 ? "col-span-2 sm:col-span-1" : ""
                } ${
                  isSelected
                    ? "bg-purple-600 text-white shadow-sm border border-purple-400"
                    : "bg-[#121214] hover:bg-[#262629] text-zinc-300 border border-white/5"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="pt-2 border-t border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Teto máximo do lote</span>
            <span className="text-[11px] font-bold text-amber-300">{config.maxDebounceWindowMinutes} min</span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Contado da primeira mensagem do lote. Ao atingir esse limite o Brain responde mesmo que continuem chegando novos balões.
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {MAX_BATCH_PRESETS.map((preset) => {
              const effectiveValue = Math.max(preset.value, config.responseDelayMinutes);
              const isSelected = config.maxDebounceWindowMinutes === effectiveValue;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handleUpdate({ maxDebounceWindowMinutes: effectiveValue })}
                  className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                    isSelected ? "bg-amber-500/20 text-amber-200 border border-amber-500/40" : "bg-[#121214] text-zinc-400 border border-white/5"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card 2: Parada Crítica da Rifa (Hand-off) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              Pausar e Notificar no Momento da Rifa
            </span>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Após enviar os 2 áudios pessoais sobre a Larissa e atingir o passo do áudio da rifa, a IA <strong>desliga sozinha</strong> naquele chat e toca um alerta para você assumir.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={config.handOffAtRaffleStep}
              onChange={(e) => handleUpdate({ handOffAtRaffleStep: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>
      </div>


    </div>
  );
}
