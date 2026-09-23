"use client";

import React, { useCallback, useState, useEffect } from "react";
import {
  Bot,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Trophy,
  Sliders,
  Check,
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
      if (data.model === "gpt-6-luna" || data.model === "gpt-6-sol") setOpenAiModel(data.model);
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
      setOpenAiModel(data.model === "gpt-6-luna" || data.model === "gpt-6-sol" ? data.model : "");
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
        toast.info("Piloto Automático DESLIGADO. Filas aguardando foram canceladas; análises em andamento serão concluídas com segurança.");
      }
    } catch {
      toast.error("Erro ao alternar Piloto Automático.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (partial: Partial<AutoPilotConfig>) => {
    if (!config) return;
    const next = { ...config, ...partial };
    setConfig(next);
    setIsSaving(true);
    try {
      await autoPilotRepo.saveConfig(partial);
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

      {/* Observação de Parada Graciosa */}
      <div
        className={`p-3 rounded-xl border text-[11px] leading-relaxed transition-all ${
          config.isEnabledGlobally
            ? "bg-emerald-950/20 border-emerald-500/30 text-zinc-300"
            : "bg-amber-950/25 border-amber-500/40 text-amber-200/90"
        }`}
      >
        <div className="flex items-start gap-2.5">
          <Info className={`w-4 h-4 shrink-0 mt-0.5 ${config.isEnabledGlobally ? "text-emerald-400" : "text-amber-400"}`} />
          <div className="space-y-1">
            <span className="font-bold text-xs block text-white flex items-center gap-1.5 flex-wrap">
              Observação sobre Desligamento & Parada
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${config.isEnabledGlobally ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                {config.isEnabledGlobally ? "Monitoramento Ativo" : "Parada Segura"}
              </span>
            </span>
            <p className="text-zinc-300 leading-snug">
              Caso a IA seja desligada enquanto já estiver <strong>em processo de análise (pensamento)</strong> ou <strong>enviando mensagens</strong>, ela <strong>concluirá esse atendimento atual</strong> com segurança para não cortar frases pela metade.
            </p>
            <p className="text-zinc-400 leading-snug">
              Todas as outras conversas que ainda estiverem aguardando o tempo de resposta são <strong>paradas imediatamente</strong>. Assim que a conversa que já estava em curso finalizar, o sistema para por completo de forma 100% automática.
            </p>
          </div>
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
          <div className="flex items-center gap-2">
            <input
              type="password"
              placeholder="sk-proj-..."
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              className="flex-1 bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500"
            />
            <button
              type="button"
              disabled={isSavingKey}
              onClick={handleSaveOpenAiConfig}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs font-bold text-white transition-all shrink-0 cursor-pointer shadow-sm"
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
            onChange={(e) => setOpenAiModel(e.target.value)}
            className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="" disabled>Selecione um modelo GPT-6</option>
            <option value="gpt-6-luna">GPT-6 Luna — Mais econômico</option>
            <option value="gpt-6-sol">GPT-6 Sol — Mais capacidade</option>
          </select>
          <span className="text-[10px] text-zinc-500">
            Modelo atual: {openAiCurrentModelLabel || openAiCurrentModel || "não identificado"}
          </span>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium block">Esforço de raciocínio</label>
          <select value={openAiReasoningEffort} onChange={(e) => { setOpenAiReasoningEffort(e.target.value); setIsOpenAiReasoningDirty(true); }} className="w-full bg-[#121214] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500">
            <option value="none">None — mínimo tempo de raciocínio</option>
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
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 flex items-center justify-between">
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
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
          ⚡ 100% Autônomo
        </span>
      </div>

      {/* Card: Notificações Móveis e Push (Firebase Cloud Messaging) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <BellRing className="w-3.5 h-3.5 text-purple-400" />
              Notificações Móveis no Celular (Push Notification)
            </span>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Receba alertas com som e vibração no smartphone mesmo com a tela bloqueada ou em outro app quando a IA gerar propostas ou chegarem mensagens.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (mobileNotifications.permission === "granted") {
                mobileNotifications.sendTestNotification();
              } else {
                mobileNotifications.requestPermission();
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer shadow-sm ${
              mobileNotifications.permission === "granted"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-purple-600 hover:bg-purple-500 text-white animate-pulse"
            }`}
          >
            {mobileNotifications.permission === "granted" ? "Testar no Celular" : "Ativar no Celular"}
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
          A IA aguarda este intervalo contado a partir da <strong>última mensagem</strong> recebida de cada cliente. Se o cliente enviar outra mensagem enquanto o cronômetro estiver correndo, o tempo reseta para ele automaticamente.
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
      </div>

      {/* Card 2: Parada Crítica da Rifa (Hand-off) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-2">
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

      {/* Card 3: Guardrails de Segurança (Fotos & Conteúdo Sensível) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-white/5 space-y-3">
        <span className="text-xs font-semibold text-white flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Guardrails de Segurança (Pausa para Permissão Humana):
        </span>

        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <div className="pr-2">
              <span className="text-xs text-zinc-200">Pausar se receber Foto do Cliente</span>
              <p className="text-[10px] text-zinc-400">
                Pede aprovação antes de continuar caso o cliente envie imagens.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={config.pauseOnPhotoReceived}
                onChange={(e) => handleUpdate({ pauseOnPhotoReceived: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="pr-2">
              <span className="text-xs text-zinc-200">Pausar em Conteúdo Estranho / Explícito</span>
              <p className="text-[10px] text-zinc-400">
                Interrompe a IA se detectar palavras abusivas, cobranças ou assédio.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={config.pauseOnSensitiveContent}
                onChange={(e) => handleUpdate({ pauseOnSensitiveContent: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
