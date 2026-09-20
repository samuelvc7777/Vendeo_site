"use client";

import React, { useState, useEffect } from "react";
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
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

const autoPilotRepo = new SupabaseAutoPilotRepository();

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
  const [isSavingKey, setIsSavingKey] = useState(false);
  const mobileNotifications = useMobileNotifications();

  useEffect(() => {
    loadConfig();
    loadOpenAiKey();
  }, []);

  const loadOpenAiKey = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "openai_api_key")
        .maybeSingle();
      if (data?.app_secret) {
        setOpenAiKey(data.app_secret);
      }
    } catch (e) {
      console.warn("Aviso ao carregar openai_api_key:", e);
    }
  };

  const handleSaveOpenAiKey = async () => {
    if (!openAiKey.trim()) return;
    setIsSavingKey(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("instagram_config").upsert({
        id: "openai_api_key",
        app_secret: openAiKey.trim(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Chave da OpenAI (ChatGPT Sol) salva com sucesso!");
    } catch (e: any) {
      toast.error("Erro ao salvar chave da OpenAI: " + (e.message || ""));
    } finally {
      setIsSavingKey(false);
    }
  };

  const loadConfig = async () => {
    try {
      setIsLoading(true);
      const data = await autoPilotRepo.getConfig();
      setConfig(data);
    } catch (err) {
      console.warn("Erro ao carregar config do piloto:", err);
    } finally {
      setIsLoading(false);
    }
  };

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
    } catch (err: any) {
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

      {/* Card: Arquitetura Dual de Inteligência Artificial (Orquestrador + Persona ChatGPT Sol) */}
      <div className="p-3.5 rounded-xl bg-[#1a1a1d] border border-purple-500/20 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            Motor Dual de IA (Orquestrador + ChatGPT Sol)
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 self-start sm:self-auto">
            {openAiKey ? "OpenAI Sol Conectada" : "Groq Ativo (Custo Zero)"}
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          O <strong>Orquestrador (Groq)</strong> avalia o checklist a custo zero e dita a Regra do Bumerangue. A <strong>Persona (ChatGPT Sol)</strong> formula a resposta humana com o DNA da Larissa.
        </p>

        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] text-zinc-300 font-medium flex items-center gap-1">
            <Key className="w-3 h-3 text-amber-400" />
            Chave de API OpenAI (sk-...) para ChatGPT Sol:
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
              disabled={isSavingKey || !openAiKey.trim()}
              onClick={handleSaveOpenAiKey}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs font-bold text-white transition-all shrink-0 cursor-pointer shadow-sm"
            >
              {isSavingKey ? "Salvando..." : "Salvar Chave"}
            </button>
          </div>
          <span className="text-[10px] text-zinc-500">
            Caso não configure chave da OpenAI, o sistema utilizará o Groq (Llama-3.3-70b) com fallback 100% gratuito.
          </span>
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
