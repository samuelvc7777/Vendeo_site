"use client";

import React, { useState, useEffect, useRef, useReducer } from "react";
import { autopilotApiFetch } from "@/infrastructure/http/autopilotApiFetch";
import {
  AlertTriangle,
  BrainCircuit,
  Clock3,
  Loader2,
  Send,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Mic,
  MessageSquare,
  Bot,
  Pause,
  StopCircle,
  Maximize2,
  Edit3,
  Check,
  Copy,
  X,
  FastForward,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
import { BrainConsultationPanel } from "./BrainConsultationPanel";
import { AutoPilotActivityPhase, AutoPilotChatState, AutoPilotCycleEvent } from "@/domain/entities/AutoPilot";
import {
  brainTurnUiReducer,
  formatBrainEvent,
  formatBrainPhase,
  formatBrainStatus,
  formatVisibleBrainIdentity,
  attachDeliveryActionsToTurns,
  deriveDeliveryProjection,
  groupBrainTurns,
  getEffectiveBrainTurnEvent,
  getVisibleBrainTurns,
  selectActiveBrainTurn,
  initialBrainTurnUiState,
  isTerminalBrainTurn,
} from "./brain-turn-view-model";
import type { BrainDecisionAction, BrainOperationalEvent, DeliveryProjection } from "./brain-turn-view-model";

export type Variant = "banner" | "inbox" | "bubble" | "floating" | "console-only";
type BrainConsoleTheme = "default" | "whatsapp-ios";

type MediaObservationRequest = {
  kind: "video" | "image";
  messageId: string;
  detail: string;
};

function parseMediaObservationPauseReason(
  reason?: string | null,
  detail?: string | null,
): MediaObservationRequest | null {
  const match = /^media_observation_required\|(video|image)\|(.+)$/.exec(String(reason || ""));
  if (!match) return null;
  return {
    kind: match[1] as "video" | "image",
    messageId: match[2],
    detail: String(detail || "").trim(),
  };
}

function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port === "3000";

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
}

export function isAutoPilotWorking(state?: AutoPilotChatState | null): boolean {
  if (!state) return false;
  if (state.status === "paused_guardrail" || state.status === "paused_handoff" || state.status === "waiting_human") return true;

  // Proteção contra atividades que ficaram congeladas no visual se a rede ou worker oscilar
  if (state.activity) {
    const actUpdatedAt = state.activity.updatedAt || state.stateUpdatedAt;
    const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
    
    // Para fase de espera / agendamento de debounce:
    if (
      state.activity.phase === "waiting" ||
      state.activity.phase === "scheduled" ||
      state.status === "waiting_delay" ||
      state.status === "waiting_debounce" ||
      state.status === "scheduled"
    ) {
      const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
      // Só é zumbi se já passou do horário agendado há mais de 120s
      if (scheduledMs > 0 && Date.now() - scheduledMs > 120_000) {
        return false;
      }
    } else if (state.activity.phase === "completed") {
      // Fase completed NUNCA é zumbi! Representa o histórico preservado da última resposta enviada.
      // Continua disponível até a IA começar a responder outra mensagem.
    } else {
      // Fases ativas de geração: se tiver mais de 90s sem atualização, é zumbi
      if (updatedAtMs > 0 && Date.now() - updatedAtMs > 90_000) {
        return false;
      }
      if ((state.activity.phase === "typing" || state.activity.phase === "sending") && updatedAtMs > 0 && Date.now() - updatedAtMs > 45_000) {
        return false;
      }
    }
  }

  // Se tem atividade em andamento ou pensamentos preservados, DEVE exibir o card!
  const hasActiveProgress = Boolean(
    state.activity ||
      state.lastThoughts ||
      state.status === "activation_wait" ||
      state.status === "waiting_delay" ||
      state.status === "waiting_debounce" ||
      state.status === "scheduled" ||
      state.status === "in_queue" ||
      state.status === "processing"
  );
  if (hasActiveProgress) return true;

  return Boolean(state.isEnabled);
}

export function isAutoPilotActivelyWorking(state?: AutoPilotChatState | null): boolean {
  if (!isAutoPilotWorking(state)) return false;
  if (state?.status === "paused_guardrail" || state?.status === "paused_handoff" || state?.status === "waiting_human") return false;
  return (
    !["waiting", "scheduled", "completed", undefined].includes(state?.activity?.phase) &&
    state?.status !== "activation_wait" &&
    state?.status !== "waiting_delay" &&
    state?.status !== "waiting_debounce" &&
    state?.status !== "scheduled"
  );
}

function eventMetadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function eventMetadataStrings(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function eventMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatConsoleModel(model: string | null): string | null {
  if (!model) return null;
  if (/atria/i.test(model)) return "Brain";
  const labels: Record<string, string> = {
    "gpt-6-luna": "GPT-6 Luna",
    "gpt-6-sol": "GPT-6 Sol",
    "gpt-6.1-sol": "GPT-6.1 Sol",
  };
  return labels[model] || model;
}

function formatConsoleSetting(value: string | null): string | null {
  if (!value) return null;
  if (value === "xhigh") return "Máximo extra";
  if (value === "none") return "Nenhum";
  if (value === "max") return "Máximo";
  if (value === "standard") return "Padrão";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function usageValue(usage: Record<string, unknown>, key: string): number | null {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatUsageTokens(value: number | null): string {
  return value === null ? "Indisponível" : new Intl.NumberFormat("pt-BR").format(value);
}

function OpenAiUsagePanel({ metadata }: { metadata: Record<string, unknown> }) {
  const rawUsage = metadata.usage;
  if (!rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) return null;
  const usage = rawUsage as Record<string, unknown>;
  const requests = usageValue(usage, "requestCount");
  const input = usageValue(usage, "inputTokens");
  const cached = usageValue(usage, "cachedInputTokens");
  const uncached = usageValue(usage, "uncachedInputTokens");
  const output = usageValue(usage, "outputTokens");
  const reasoning = usageValue(usage, "reasoningTokens");
  const total = usageValue(usage, "totalTokens");
  const cacheHitRate = usageValue(usage, "cacheHitRate");
  const usd = usageValue(usage, "estimatedUsd");
  const brl = usageValue(usage, "estimatedBrl");
  const models = Array.isArray(usage.models) ? usage.models.filter((item): item is string => typeof item === "string") : [];
  const modelNames = models.map((item) => formatConsoleModel(item) || item).join(" · ") || formatConsoleModel(eventMetadataText(metadata, "model")) || "Modelo não informado";
  const reasoningEffort = formatConsoleSetting(eventMetadataText(metadata, "reasoningEffort"));
  const fx = usageValue(usage, "usdBrlEstimate");
  const tokenRows = [
    ["Entrada total", input], ["Em cache", cached], ["Fora do cache", uncached],
    ["Saída", output], ["↳ Raciocínio", reasoning], ["Total", total],
  ] as const;

  return (
    <section className="mt-3 rounded-xl border border-cyan-200 dark:border-cyan-900/50 bg-cyan-50/70 dark:bg-cyan-950/20 p-3" aria-label="Uso da OpenAI neste turno">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-200/60 dark:border-cyan-900/40 pb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
          Uso da OpenAI
        </div>
        <div className="text-[10px] text-zinc-600 dark:text-zinc-400">
          {requests === null ? "Solicitações indisponíveis" : `${formatUsageTokens(requests)} solicitações`}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-zinc-700 dark:text-zinc-300 font-medium">
        <span>{modelNames}{reasoningEffort ? ` · raciocínio ${reasoningEffort}` : ""}</span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {tokenRows.map(([label, value]) => (
          <div
            key={label}
            className={`rounded-lg p-2 border ${
              label.startsWith("↳")
                ? "border-cyan-200/40 dark:border-cyan-900/30 bg-cyan-100/30 dark:bg-cyan-950/10 text-cyan-900 dark:text-cyan-200"
                : label === "Total"
                ? "border-cyan-300 dark:border-cyan-800/60 bg-cyan-100/60 dark:bg-cyan-900/30 font-semibold"
                : "border-zinc-200/60 dark:border-white/5 bg-white/60 dark:bg-black/20"
            }`}
          >
            <div className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 truncate">
              {label}
            </div>
            <div className="mt-0.5 text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">
              {formatUsageTokens(value)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap justify-between items-center gap-x-3 text-[10px] text-zinc-700 dark:text-zinc-300 border-t border-cyan-200/60 dark:border-cyan-900/40 pt-2">
        <span className="text-zinc-500">Acerto de cache:</span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          {cacheHitRate === null ? "Indisponível" : `${cacheHitRate.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
        </span>
      </div>

      <div className="mt-2 rounded-lg bg-black/20 p-2.5 border border-white/5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Custo estimado · tarifa padrão</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-black font-mono text-zinc-900 dark:text-zinc-100">
            {usd === null ? "Indisponível" : `US$ ${usd.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}
          </span>
          {brl !== null && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              ≈ R$ {brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
        {fx !== null && (
          <div className="mt-1 text-[9px] text-zinc-500">
            Câmbio estimado: R$ {fx.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/US$
          </div>
        )}
        {usage.cacheWriteTokens == null && (
          <div className="mt-1 text-[9.5px] text-zinc-500">A gravação no cache não foi informada pela API.</div>
        )}
        {typeof usage.serviceTier === "string" && (
          <div className="mt-0.5 text-[9.5px] text-zinc-500">Categoria: {formatConsoleSetting(usage.serviceTier) || "Padrão"}</div>
        )}
      </div>
    </section>
  );
}

function objectiveDecisionLabel(value: string | null): string | null {
  const labels: Record<string, string> = {
    pursue: "Avançar objetivo",
    defer: "Adiar objetivo",
    already_satisfied: "Objetivo satisfeito",
    none: "Sem ação de objetivo",
  };
  return value ? labels[value] || value : null;
}

function memoryStatusLabel(value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    success_with_results: "consultada",
    success_no_results: "consultada · nenhum resultado relevante",
    tool_error: "erro técnico",
    not_consulted: "não consultada",
  };
  return labels[value] || value;
}

function ConsoleEventField({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function ConsoleCycleEventCard({ event }: { event: BrainOperationalEvent }) {
  const metadata = event.metadata || {};
  const memoryToolResults = Array.isArray(metadata.memoryToolResults)
    ? metadata.memoryToolResults.filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === "object").slice(0, 8)
    : [];
  const model = formatConsoleModel(eventMetadataText(metadata, "model"));
  const configuredModel = formatConsoleModel(eventMetadataText(metadata, "configuredModel"));
  const executedModel = formatConsoleModel(eventMetadataText(metadata, "executedModel"));
  const reasoningEffort = formatConsoleSetting(eventMetadataText(metadata, "reasoningEffort"));
  const configuredReasoning = formatConsoleSetting(eventMetadataText(metadata, "configuredReasoningEffort"));
  const executedReasoning = formatConsoleSetting(eventMetadataText(metadata, "executedReasoningEffort"));
  const verbosity = formatConsoleSetting(eventMetadataText(metadata, "verbosity"));
  const hasModelDivergence = Boolean(configuredModel && executedModel && configuredModel !== executedModel);
  const hasReasoningDivergence = Boolean(configuredReasoning && executedReasoning && configuredReasoning !== executedReasoning);
  const hasDivergence = hasModelDivergence || hasReasoningDivergence;
  const responses = eventMetadataStrings(metadata, "responses");
  const proposedResponses = eventMetadataStrings(metadata, "proposedResponses");
  const toolsUsed = eventMetadataStrings(metadata, "toolsUsed");
  const memorySources = eventMetadataStrings(metadata, "memorySources");
  const coveredHooks = eventMetadataStrings(metadata, "coveredHooks");
  const ignoredRelevantHooks = eventMetadataStrings(metadata, "ignoredRelevantHooks");
  const objectiveBridgeDetected = typeof metadata.objectiveBridgeDetected === "boolean" ? metadata.objectiveBridgeDetected : null;
  const contextWindow = metadata.contextWindow && typeof metadata.contextWindow === "object" && !Array.isArray(metadata.contextWindow)
    ? metadata.contextWindow as Record<string, unknown>
    : null;
  const contextWindowMessages = contextWindow && Array.isArray(contextWindow.includedMessages)
    ? contextWindow.includedMessages.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const contextWindowPreviews = contextWindow && Array.isArray(contextWindow.previews)
    ? contextWindow.previews.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const contextWindowCuts = contextWindow?.cuts && typeof contextWindow.cuts === "object" && !Array.isArray(contextWindow.cuts)
    ? contextWindow.cuts as Record<string, unknown>
    : {};
  const socialCue = metadata.socialCueInterpretation && typeof metadata.socialCueInterpretation === "object" && !Array.isArray(metadata.socialCueInterpretation)
    ? metadata.socialCueInterpretation as Record<string, unknown>
    : null;
  const objectiveDecision = eventMetadataText(metadata, "objectiveDecision");
  const questionIntents = Array.isArray(metadata.questionIntents) ? metadata.questionIntents : [];
  const isBrainDecision = event.event === "brain_decision";
  const isBrainStarted = event.event === "brain_started";
  const isBrainMemory = event.event === "brain_memory";
  const isResponseReady = event.event === "response_ready";
  const isDiagnostic = isBrainDecision || isBrainStarted || isBrainMemory || isResponseReady;

  return (
    <article className={`rounded-xl border p-3 ${isBrainDecision ? "border-purple-300 dark:border-purple-500/40 bg-purple-50 dark:bg-purple-950/20" : isResponseReady ? "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/15" : "border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] text-zinc-500">{new Date(event.timestamp).toLocaleTimeString("pt-BR")} · evento {event.sequence ?? "—"} · {formatBrainPhase(event.phase)}</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">{formatBrainEvent(event.event)}</div>
        </div>
        {isBrainDecision && <BrainCircuit className="h-4 w-4 shrink-0 text-purple-700 dark:text-purple-300" />}
      </div>

      {isBrainStarted && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ConsoleEventField label="Modelo">
            {hasModelDivergence ? (
              <span>
                <span className="text-amber-400">Configurado: {configuredModel}</span>
                <span className="mx-1 text-zinc-500">·</span>
                <span className="text-emerald-400">Executado: {executedModel}</span>
              </span>
            ) : (
              executedModel || model
            )}
          </ConsoleEventField>
          <ConsoleEventField label="Nível de raciocínio">
            {hasReasoningDivergence ? (
              <span>
                <span className="text-amber-400">Configurado: {configuredReasoning}</span>
                <span className="mx-1 text-zinc-500">·</span>
                <span className="text-emerald-400">Executado: {executedReasoning}</span>
              </span>
            ) : (
              executedReasoning || reasoningEffort
            )}
          </ConsoleEventField>
          <ConsoleEventField label="Nível de detalhe">{verbosity}</ConsoleEventField>
          <ConsoleEventField label="Etapa">{eventMetadataText(metadata, "stageId")}</ConsoleEventField>
          <ConsoleEventField label="Objetivo atual">{eventMetadataText(metadata, "currentObjectiveLabel")}</ConsoleEventField>
          <ConsoleEventField label="Inbounds">{eventMetadataNumber(metadata, "inboundCount")}</ConsoleEventField>
        </div>
      )}

      {isBrainMemory && (
        <div className="mt-3 space-y-2">
          <ConsoleEventField label="Memórias">{memorySources.join(" · ") || toolsUsed.join(" · ")}</ConsoleEventField>
          <ConsoleEventField label="Consultas realizadas">{eventMetadataNumber(metadata, "searchCount")}</ConsoleEventField>
          <ConsoleEventField label="Status das buscas de memória">
            {memoryToolResults.map((result, index) => {
              const rawToolName = String(result.toolName || "memory");
              const tool = ["persona_memory_search", "contact_memory_search", "conversation_memory_search"].find((name) => rawToolName.endsWith(name)) || rawToolName;
              const reasonCode = typeof result.reasonCode === "string" ? result.reasonCode : "";
              const status = result.status === "tool_error"
                ? `erro técnico${reasonCode ? ` · ${reasonCode}` : ""}`
                : result.status === "success_no_results"
                ? "consultada · nenhum resultado relevante"
                : "consultada";
              return <div key={`${tool}-${index}`}>{tool}: {status}</div>;
            })}
          </ConsoleEventField>
          {eventMetadataNumber(metadata, "relevantPersonaFactsCount") !== null && (
            <ConsoleEventField label="Fatos relevantes incluídos">{eventMetadataNumber(metadata, "relevantPersonaFactsCount")}</ConsoleEventField>
          )}
          <ConsoleEventField label="Motivo da consulta">{eventMetadataText(metadata, "memoryRationale")}</ConsoleEventField>
        </div>
      )}

      {isBrainDecision && (
        <div className="mt-3 space-y-3">
          {contextWindow && (
            <details className="rounded-lg border border-cyan-200 dark:border-cyan-900/50 bg-cyan-50 dark:bg-cyan-950/10 p-2.5 text-[10px] text-zinc-700 dark:text-zinc-300">
              <summary className="cursor-pointer font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Contexto enviado ao Brain</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <ConsoleEventField label="Mensagens candidatas">{eventMetadataNumber(contextWindow, "candidateCount")}</ConsoleEventField>
                <ConsoleEventField label="Após deduplicação">{eventMetadataNumber(contextWindow, "deduplicatedCount")}</ConsoleEventField>
                <ConsoleEventField label="Após limite de contexto">{eventMetadataNumber(contextWindow, "budgetedCount")}</ConsoleEventField>
                <ConsoleEventField label="Mensagens enviadas">{eventMetadataNumber(contextWindow, "includedCount")}</ConsoleEventField>
                <ConsoleEventField label="Obrigatórias preservadas">{eventMetadataNumber(contextWindow, "mandatoryCount")}</ConsoleEventField>
                <ConsoleEventField label="Última outbound da Larissa incluída">
                  {contextWindow.lastLarissaOutboundIncluded === true ? "Sim" : contextWindow.lastLarissaOutboundIncluded === false ? "Não" : "Sem outbound identificada"}
                  {eventMetadataText(contextWindow, "lastLarissaOutboundId") ? ` · ${eventMetadataText(contextWindow, "lastLarissaOutboundId")}` : ""}
                </ConsoleEventField>
                <ConsoleEventField label="Reply targets preservados">
                  {eventMetadataNumber(contextWindow, "replyTargetsIncludedCount")}/{eventMetadataNumber(contextWindow, "replyTargetRequiredCount")}
                </ConsoleEventField>
                <ConsoleEventField label="Removidas por limites">{eventMetadataNumber(contextWindow, "droppedNonMandatoryCount")}</ConsoleEventField>
                <ConsoleEventField label="Overflow obrigatório">{contextWindow.mandatoryContextOverflow === true ? "Sim" : "Não"}</ConsoleEventField>
                <ConsoleEventField label="Duplicatas inbound removidas">{eventMetadataNumber(contextWindow, "currentInboundDuplicateCount")}</ConsoleEventField>
                <ConsoleEventField label="Corte por limite de mensagens">{contextWindow.cutByMessageLimit === true || contextWindowCuts.messageLimit === true ? "Sim" : "Não"}</ConsoleEventField>
                <ConsoleEventField label="Corte por limite de tokens">{contextWindowCuts.tokenBudget === true ? "Sim" : "Não"}</ConsoleEventField>
                <ConsoleEventField label="Corte por caracteres">{contextWindow.cutByCharLimit === true || contextWindowCuts.finalCharacters === true ? "Sim" : "Não"}</ConsoleEventField>
                {contextWindowCuts.mandatoryTokenOverflow === true && <ConsoleEventField label="Observação de limite">As mensagens obrigatórias excederam o limite de contexto</ConsoleEventField>}
              </div>
              {contextWindowMessages.length > 0 && (
                <details className="mt-2 border-t border-zinc-200 dark:border-zinc-800 pt-2">
                  <summary className="cursor-pointer">Mensagens incluídas ({contextWindowMessages.length})</summary>
                  {Array.isArray(contextWindow.finalMandatoryMessageIds) && contextWindow.finalMandatoryMessageIds.length > 0 && (
                    <div className="mt-2 break-all text-cyan-700 dark:text-cyan-300">Obrigatórias preservadas: {contextWindow.finalMandatoryMessageIds.filter((id): id is string => typeof id === "string").join(" · ")}</div>
                  )}
                  <ol className="mt-2 space-y-1">
                    {contextWindowMessages.map((item, index) => (
                      <li key={`${String(item.id || "message")}-${index}`} className="break-all text-zinc-600 dark:text-zinc-400">
                        {typeof item.sender === "string" ? item.sender : "Mensagem"}
                        {typeof item.timestamp === "string" ? ` · ${item.timestamp}` : ""}
                        {typeof item.id === "string" ? ` · ${item.id}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {contextWindowPreviews.length > 0 && (
                <div className="mt-2 border-t border-zinc-200 dark:border-zinc-800 pt-2">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">Prévia segura · últimas mensagens</div>
                  <ol className="mt-1 space-y-1 text-zinc-700 dark:text-zinc-300">
                    {contextWindowPreviews.map((item, index) => (
                      <li key={`${String(item.id || "preview")}-${index}`}>
                        {typeof item.sender === "string" ? item.sender : "Mensagem"}: “{typeof item.text === "string" ? item.text : ""}”
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </details>
          )}
          <div className="rounded-lg bg-black/20 p-2 text-[10px] text-zinc-700 dark:text-zinc-300">
            {hasDivergence ? (
              <div className="space-y-1">
                <div>
                  <span className="font-semibold text-amber-400">Configurado:</span> {configuredModel || model || "Modelo não informado"}
                  {(configuredReasoning || reasoningEffort) && <span className="text-zinc-500"> · raciocínio: {configuredReasoning || reasoningEffort}</span>}
                </div>
                <div>
                  <span className="font-semibold text-emerald-400">Executado:</span> {executedModel || model || "Modelo não informado"}
                  {(executedReasoning || reasoningEffort) && <span className="text-zinc-500"> · raciocínio: {executedReasoning || reasoningEffort}</span>}
                </div>
              </div>
            ) : (
              <>
                {executedModel || model || "Modelo não informado"}
                {(reasoningEffort || verbosity) && <span className="text-zinc-500"> · raciocínio: {reasoningEffort || "—"} · nível de detalhe: {verbosity || "—"}</span>}
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ConsoleEventField label="Objetivo · decisão">
              {objectiveDecisionLabel(objectiveDecision)}{objectiveDecision ? ` (${objectiveDecision})` : ""}
            </ConsoleEventField>
            <ConsoleEventField label="Objetivo atual">
              {eventMetadataText(metadata, "currentObjectiveLabel") || eventMetadataText(metadata, "currentObjectiveId")}
            </ConsoleEventField>
            <ConsoleEventField label="Tópico atual">{eventMetadataText(metadata, "currentTopic")}</ConsoleEventField>
            <ConsoleEventField label="Gancho principal">{eventMetadataText(metadata, "bestHook")}</ConsoleEventField>
            <ConsoleEventField label="Oportunidade">{eventMetadataText(metadata, "curiosityOpportunity")}</ConsoleEventField>
            {socialCue && (
              <ConsoleEventField label="Leitura social · Agent">
                {[socialCue.socialCueType, socialCue.primaryIntent, socialCue.socialCueExpression]
                  .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
                  .join(" · ") || null}
                {typeof socialCue.requiresExplicitAcknowledgement === "boolean"
                  ? ` · reconhecimento explícito ${socialCue.requiresExplicitAcknowledgement ? "indicado" : "não necessário"}`
                  : ""}
              </ConsoleEventField>
            )}
            {typeof metadata.selfFactRepeatedRisk === "boolean" && (
              <ConsoleEventField label="Risco de repetição de fato próprio">
                {metadata.selfFactRepeatedRisk ? "Indicado pelo Agent" : "Não indicado pelo Agent"}
              </ConsoleEventField>
            )}
            <ConsoleEventField label="Memória">
              {metadata.memoryConsulted === true ? "Consultada" : metadata.memoryConsulted === false ? "Não consultada" : null}
              {eventMetadataText(metadata, "memoryRationale") ? ` · ${eventMetadataText(metadata, "memoryRationale")}` : ""}
              {memoryStatusLabel(eventMetadataText(metadata, "memoryStatus")) ? ` · ${memoryStatusLabel(eventMetadataText(metadata, "memoryStatus"))}` : ""}
            </ConsoleEventField>
            <ConsoleEventField label="Ponte para objetivo">
              {objectiveBridgeDetected === null ? null : objectiveBridgeDetected ? `Detectada${eventMetadataText(metadata, "objectiveBridgeEvidence") ? ` · ${eventMetadataText(metadata, "objectiveBridgeEvidence")}` : ""}` : "Não detectada"}
            </ConsoleEventField>
            <ConsoleEventField label="Ganchos cobertos">{coveredHooks.join(" · ") || null}</ConsoleEventField>
            <ConsoleEventField label="Ganchos relevantes não cobertos">{ignoredRelevantHooks.join(" · ") || null}</ConsoleEventField>
            <ConsoleEventField label="Motivo da decisão">{eventMetadataText(metadata, "reasoningSummary")}</ConsoleEventField>
            <ConsoleEventField label="Ferramentas usadas">{toolsUsed.join(" · ") || null}</ConsoleEventField>
          </div>
          {(eventMetadataText(metadata, "satisfiedObjectiveId") || eventMetadataText(metadata, "evidenceMessageId")) && (
            <details className="text-[10px] text-zinc-500">
              <summary className="cursor-pointer">Dados técnicos do objetivo</summary>
              <div className="mt-2 space-y-1 break-all">
                {eventMetadataText(metadata, "satisfiedObjectiveId") && <div>Objetivo satisfeito: {eventMetadataText(metadata, "satisfiedObjectiveId")}</div>}
                {eventMetadataText(metadata, "evidenceMessageId") && <div>Mensagem de evidência: {eventMetadataText(metadata, "evidenceMessageId")}</div>}
              </div>
            </details>
          )}
          {proposedResponses.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] uppercase tracking-wide text-zinc-500">Brain propôs</div>
              <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                {proposedResponses.map((response, index) => <li key={`${index}-${response}`}>{response}</li>)}
              </ol>
            </div>
          )}
          {questionIntents.length > 0 && (
            <details className="text-[10px] text-zinc-500">
              <summary className="cursor-pointer">Intenções de pergunta ({questionIntents.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
              {questionIntents.map((intent: unknown, index: number) => {
                const item = typeof intent === "object" && intent !== null ? intent as Record<string, unknown> : {};
                const meaning = typeof item.canonicalMeaning === "string" ? item.canonicalMeaning : null;
                const intentKey = typeof item.intentKey === "string" ? item.intentKey : "intent";
                return <li key={`${intentKey}-${index}`}>{meaning || intentKey}</li>;
              })}
              </ul>
            </details>
          )}
        </div>
      )}

      {isResponseReady && (
        <div className="mt-3">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-emerald-300/80">Resposta final autorizada · ainda não significa que foi enviada</div>
          {eventMetadataText(metadata, "payloadType") === "audio" ? (
            <div className="text-[11px] text-zinc-800 dark:text-zinc-200">Áudio autorizado para envio</div>
          ) : responses.length > 0 ? (
            <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-900 dark:text-zinc-100">
              {responses.map((response, index) => <li key={`${index}-${response}`}>{response}</li>)}
            </ol>
          ) : null}
        </div>
      )}

      {!isDiagnostic && event.detail && <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">{formatVisibleBrainIdentity(event.detail)}</div>}
      <OpenAiUsagePanel metadata={metadata} />
    </article>
  );
}

function formatConsoleTime(value: string | undefined, withSeconds = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Horário indisponível";
  return new Date(value).toLocaleTimeString("pt-BR", withSeconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
}

function eventMainDescription(event: BrainOperationalEvent): string | null {
  const metadata = event.metadata || {};
  if (event.event === "brain_decision") return formatVisibleBrainIdentity(eventMetadataText(metadata, "reasoningSummary"));
  if (event.event === "response_ready") {
    const responses = eventMetadataStrings(metadata, "responses");
    if (responses.length === 0) responses.push(...eventMetadataStrings(metadata, "proposedResponses"));
    return responses.length ? formatVisibleBrainIdentity(responses.join(" · ")) : eventMetadataText(metadata, "payloadType") === "audio" ? "Áudio preparado para envio." : null;
  }
  if (event.event === "manual_resolution_required") return formatVisibleBrainIdentity(event.detail) || null;
  if (["cycle_failed", "action_failed_confirmed", "failed_confirmed", "action_dispatch_uncertain", "dispatch_uncertain"].includes(event.event)) {
    return event.event === "action_dispatch_uncertain" || event.event === "dispatch_uncertain"
      ? "O provedor ainda não confirmou o resultado do envio."
      : "O turno terminou antes de concluir uma ação.";
  }
  if (["turn_completed", "cycle_completed", "cycle_cancelled", "action_sent"].includes(event.event)) return formatVisibleBrainIdentity(event.detail) || null;
  return null;
}

function formatDeliveryActionStatus(action: BrainDecisionAction): string {
  const status = action.status.toLowerCase();
  if (status === "sent" && action.providerMessageId) return "Enviada e confirmada pelo provedor";
  if (status === "sent") return "Sem confirmação de entrega registrada";
  if (status === "failed_confirmed") return action.attempts
    ? `Falha confirmada após ${action.attempts} tentativas`
    : "Falha confirmada";
  if (status === "dispatch_uncertain") return "Confirmação de envio pendente";
  if (status === "sending") return "Tentando enviar";
  if (status === "failed_retryable") return "Nova tentativa programada";
  if (status === "waiting_delay") return "Aguardando o horário de envio";
  if (status === "cancelled") return "Envio cancelado";
  return "Pendente · não enviada";
}

function deliveryStatusTone(status: DeliveryProjection["status"]): string {
  if (status === "fully_sent") return "border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-800 dark:text-emerald-200";
  if (status === "failed") return "border-rose-400/25 bg-rose-400/[0.06] text-rose-900 dark:text-rose-100";
  if (status === "uncertain" || status === "partially_sent") return "border-amber-400/25 bg-amber-400/[0.06] text-amber-900 dark:text-amber-100";
  if (status === "sending") return "border-emerald-400/20 bg-emerald-400/[0.04] text-emerald-900 dark:text-emerald-100";
  return "border-zinc-300 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300";
}

function eventDotTone(event: string): string {
  if (event === "action_sent" || event === "fully_sent") return "border-emerald-300 bg-emerald-400";
  if (event === "cycle_failed" || event.includes("failed")) return "border-rose-300 bg-rose-400";
  if (event === "manual_resolution_required") return "border-amber-300 bg-amber-400";
  if (event === "turn_completed" || event === "cycle_completed") return "border-purple-300 bg-purple-400";
  return "border-cyan-300 bg-[#101016]";
}

function ProviderErrorDetails({ value }: { value: Record<string, unknown> }) {
  const provider = typeof value.provider === "string" ? value.provider : "Provedor";
  const httpStatus = typeof value.httpStatus === "number" ? value.httpStatus : null;
  const code = value.code;
  const subcode = value.subcode;
  const message = typeof value.message === "string" ? value.message : "Falha sem mensagem detalhada.";
  return (
    <div className="rounded-xl border border-rose-400/30 bg-rose-400/[0.08] p-3 text-xs text-zinc-800 dark:text-zinc-200">
      <div className="flex items-center gap-1.5 font-bold text-rose-800 dark:text-rose-200">
        <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
        <span>{provider}{httpStatus !== null ? ` · HTTP ${httpStatus}` : ""}</span>
        {code !== undefined ? <span className="opacity-75">· código {String(code)}</span> : null}
        {subcode !== undefined ? <span className="opacity-75">· subcódigo {String(subcode)}</span> : null}
      </div>
      <p className="mt-1.5 break-words text-rose-900 dark:text-rose-100 leading-relaxed font-mono text-[11px] bg-black/20 p-2 rounded-lg">{formatVisibleBrainIdentity(message)}</p>
    </div>
  );
}

function CopyableIdBadge({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value || value === "Não informado") {
    return (
      <div className="flex flex-col gap-0.5 min-w-0">
        <dt className="text-[10px] uppercase font-bold text-zinc-500">{label}</dt>
        <dd className="break-all font-mono text-xs text-zinc-500">Não informado</dd>
      </div>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-[10px] uppercase font-bold text-zinc-500">{label}</dt>
      <dd className="flex items-center gap-1.5 min-w-0">
        <span className="truncate font-mono text-xs text-zinc-800 dark:text-zinc-200 bg-black/10 dark:bg-white/5 px-2 py-0.5 rounded-lg border border-black/5 dark:border-white/5 select-all">
          {value}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 active:scale-90 transition-transform shrink-0 cursor-pointer"
          title={`Copiar ${label}`}
          aria-label={`Copiar ${label}`}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </dd>
    </div>
  );
}

function ConsoleJsonViewer({ data, title = "Dados completos do evento" }: { data: unknown; title?: string }) {
  const [copied, setCopied] = useState(false);
  const jsonString = typeof data === "string" ? data : JSON.stringify(data, null, 2);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <details className="group mt-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-black/40 overflow-hidden text-xs">
      <summary className="min-h-[42px] px-3 py-2 flex items-center justify-between gap-2 cursor-pointer font-medium text-zinc-700 dark:text-zinc-300 select-none hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]">
        <span className="truncate font-semibold">{title}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 active:scale-95 transition-transform shrink-0 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copiado!" : "Copiar"}</span>
        </button>
      </summary>
      <div className="p-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-black/60">
        <pre className="max-h-72 overflow-x-auto overflow-y-auto whitespace-pre font-mono text-[11px] leading-5 text-zinc-300 p-2 rounded-lg bg-black/40 border border-white/5 scrollbar-thin">
          {formatVisibleBrainIdentity(jsonString)}
        </pre>
      </div>
    </details>
  );
}

function BrainTurnTimeline({
  turn,
  turnNumber,
  expanded,
  active,
  failedActions,
  retryingActionId,
  onRetryAction,
  onToggleTurn,
  manualResolution,
  onManualResolution,
  onManualResolutionChange,
  theme = "default",
}: {
  turn: ReturnType<typeof groupBrainTurns>[number];
  turnNumber: number;
  expanded: boolean;
  active: boolean;
  failedActions: Array<{ id: string; action_type: string; action_index: number; payload?: Record<string, unknown> }>;
  retryingActionId: string | null;
  onRetryAction: (actionId: string) => void;
  onToggleTurn: (turnId: string) => void;
  manualResolution: { answer: string; question: string; submitting: boolean };
  onManualResolution: (saveForFuture: boolean) => void;
  onManualResolutionChange: (value: string) => void;
  theme?: BrainConsoleTheme;
}) {
  const whatsappTheme = theme === "whatsapp-ios";
  const decision = [...turn.events].reverse().find((event) => event.event === "brain_decision");
  const decisionMetadata = decision?.metadata || {};
  const decisionSummary = eventMetadataText(decisionMetadata, "reasoningSummary");
  const objectiveLabel = eventMetadataText(decisionMetadata, "currentObjectiveLabel");
  const objectiveDecision = eventMetadataText(decisionMetadata, "objectiveDecision");
  const evidenceId = eventMetadataText(decisionMetadata, "evidenceMessageId");
  const satisfiedObjectiveId = eventMetadataText(decisionMetadata, "satisfiedObjectiveId");
  const objectiveStatus = satisfiedObjectiveId && evidenceId
    ? "Concluído"
    : objectiveDecision === "already_satisfied"
    ? "Já estava concluído"
    : objectiveDecision === "pursue"
    ? "Em andamento"
    : objectiveDecision === "none"
    ? "Ignorado neste turno"
    : null;
  const plannedResponses = [...eventMetadataStrings(decisionMetadata, "proposedResponses")];
  const modelEvent = [...turn.events].reverse().find((event) => event.event === "brain_started");
  const model = formatConsoleModel(eventMetadataText(modelEvent?.metadata || {}, "executedModel") || eventMetadataText(modelEvent?.metadata || {}, "model"));
  const delivery = turn.delivery;
  const deliveryActions = turn.deliveryActions || [];
  const statusTone = whatsappTheme
    ? turn.status === "stale"
      ? "border-white/[0.08] bg-white/[0.04] text-[#8696a0]"
      : turn.status === "running"
      ? "border-[#25d366]/25 bg-[#25d366]/10 text-[#25d366]"
      : turn.status === "waiting_human"
      ? "border-[#ffb020]/25 bg-[#ffb020]/10 text-[#ffb020]"
      : turn.status === "completed"
      ? "border-[#00a884]/30 bg-[#00a884]/10 text-[#25d366]"
      : turn.status === "cancelled"
      ? "border-white/[0.08] bg-white/[0.04] text-[#8696a0]"
      : "border-[#ff453a]/25 bg-[#ff453a]/10 text-[#ff6b64]"
    : turn.status === "stale"
    ? "border-zinc-300 dark:border-zinc-700 bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
    : turn.status === "running"
    ? "border-purple-400/30 bg-purple-400/10 text-purple-800 dark:text-purple-200"
    : turn.status === "waiting_human"
    ? "border-amber-400/30 bg-amber-400/10 text-amber-800 dark:text-amber-200"
    : turn.status === "completed"
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-800 dark:text-emerald-200"
    : turn.status === "cancelled"
    ? "border-zinc-600 bg-zinc-200/70 dark:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300"
    : "border-rose-400/30 bg-rose-400/10 text-rose-800 dark:text-rose-200";
  const turnEvents = turn.events;

  return (
    <article
      id={`brain-turn-${turnNumber}`}
      data-turn-id={turn.id}
      className={`overflow-hidden transition-colors ${
        whatsappTheme
          ? `rounded-[18px] border ${
              active
                ? "border-[#25d366]/25 bg-[#103529]/55 shadow-[0_8px_28px_rgba(0,0,0,0.16)]"
                : "border-white/[0.07] bg-[#111b21]/88"
            }`
          : `rounded-2xl border ${
              active
                ? "border-purple-300 dark:border-purple-400/35 bg-purple-50 dark:bg-[#111018] shadow-sm dark:shadow-lg dark:shadow-purple-950/20"
                : "border-zinc-200 dark:border-zinc-800 bg-zinc-900/50"
            }`
      }`}
    >
      <div
        onClick={() => onToggleTurn(turn.id)}
        className="flex items-stretch cursor-pointer select-none transition-colors hover:bg-black/5 dark:hover:bg-white/[0.02]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 sm:px-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${statusTone}`}>
            {turn.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : turn.status === "completed" ? <Check className="h-4 w-4" /> : turn.status === "failed" ? <AlertTriangle className="h-4 w-4" /> : turn.status === "cancelled" ? <StopCircle className="h-4 w-4" /> : turn.status === "stale" ? <Clock3 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className={`text-sm font-bold ${
                whatsappTheme ? "text-[#e9edef]" : "text-zinc-900 dark:text-zinc-100"
              }`}>Turno {turnNumber}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
                {turn.provisional && active ? "Iniciando" : formatBrainStatus(turn.status === "running" ? "brain_running" : turn.status === "cancelled" ? "cancelled" : turn.status)}
              </span>
              {active && (
                <span className={`text-[11px] font-bold uppercase tracking-wide ${
                  whatsappTheme ? "text-[#25d366]" : "text-purple-700 dark:text-purple-300"
                }`}>
                  Agora
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              {formatConsoleTime(turn.startedAt)}
              {delivery?.actionCount ? ` · ${delivery.label}` : ""}
              {model ? ` · ${model.replace(/^GPT-[^ ]+ /, "")}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={`${expanded ? "Recolher" : "Abrir"} detalhes do Turno ${turnNumber}`}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTurn(turn.id);
          }}
          className={`flex min-h-[48px] w-12 shrink-0 items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset cursor-pointer ${
            whatsappTheme
              ? "text-[#8696a0] hover:bg-white/[0.04] active:scale-95 focus-visible:ring-[#25d366]/50"
              : "border-l border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-800/70 active:bg-zinc-700 focus-visible:ring-purple-300"
          }`}
        >
          {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>

      {expanded && (
        <div className={`border-t px-3 pb-4 pt-3 sm:px-4 ${
          whatsappTheme ? "border-white/[0.07]" : "border-zinc-200 dark:border-zinc-800"
        }`}>
          {delivery && delivery.actionCount > 0 && (
            <section aria-label="Estado de entrega" className={`mb-4 rounded-xl border p-3 ${deliveryStatusTone(delivery.status)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{delivery.statusLabel}</h4>
                <span className="text-xs tabular-nums">{delivery.label}</span>
              </div>
              <ol className="mt-2 space-y-1.5">
                {deliveryActions.map((action) => (
                  <li key={action.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span>Ação {action.actionIndex + 1} · {action.actionType === "audio" ? "áudio" : "mensagem"}</span>
                    <span>{formatDeliveryActionStatus(action)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {decision && (
            <section className={`mb-4 rounded-xl border p-3 ${
              whatsappTheme
                ? "border-[#25d366]/15 bg-[#25d366]/[0.045]"
                : "border-purple-400/20 bg-purple-400/[0.06]"
            }`}>
              <div className={`flex items-center gap-2 text-xs font-semibold ${
                whatsappTheme ? "text-[#25d366]" : "text-purple-800 dark:text-purple-200"
              }`}><BrainCircuit className="h-4 w-4" />Decisão</div>
              {decisionSummary && <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-800 dark:text-zinc-200">{decisionSummary}</p>}
              {objectiveLabel && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Objetivo deste turno</span><span className="rounded-full bg-zinc-200 dark:bg-zinc-800 px-2.5 py-1 text-zinc-800 dark:text-zinc-200">{objectiveLabel}</span>
                  {objectiveStatus && <span className={objectiveStatus === "Concluído" ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-400"}>{objectiveStatus === "Concluído" ? "✓ " : ""}{objectiveStatus}</span>}
                </div>
              )}
              {plannedResponses.length > 0 && (
                <details className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium text-emerald-800 dark:text-emerald-200">Ver resposta planejada</summary>
                  <ul className="space-y-2 pb-2">{plannedResponses.map((response, index) => <li key={`${index}-${response}`} className="rounded-lg bg-black/20 px-3 py-2 leading-5">{response}</li>)}</ul>
                </details>
              )}
              {decisionSummary && <details className="mt-1 text-sm text-zinc-700 dark:text-zinc-300"><summary className="min-h-11 cursor-pointer py-2 font-medium text-zinc-600 dark:text-zinc-400">Ver detalhes do raciocínio</summary><p className="pb-2 leading-6">{decisionSummary}</p></details>}
            </section>
          )}

          {turn.status === "waiting_human" && (
            <BrainConsultationPanel
              turnId={turn.turnId || turn.id}
              question={manualResolution.question || "Uma informação factual para continuar."}
              answer={manualResolution.answer}
              submitting={manualResolution.submitting}
              onAnswerChange={onManualResolutionChange}
              onSubmit={onManualResolution}
            />
          )}

          {turn.status === "failed" && <p className="mb-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.06] p-3 text-sm leading-5 text-rose-900 dark:text-rose-100">O Brain terminou com um problema. Abra os detalhes técnicos do evento para consultar a causa registrada.</p>}
          <ol className="space-y-0">
            {turnEvents.map((event, index) => {
              const isLast = index === turnEvents.length - 1;
              const label = formatBrainEvent(event.event);
              const description = eventMainDescription(event);
              const linkedAction = event.actionId ? failedActions.find((action) => action.id === event.actionId) : undefined;
              return (
                <li key={`${turn.id}-${event.sequence}-${event.event}`} className="relative flex gap-3">
                  {!isLast && <span aria-hidden="true" className="absolute bottom-0 left-[7px] top-4 w-px bg-zinc-200 dark:bg-zinc-800" />}
                  <span className={`relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${eventDotTone(event.event)}`} />
                  <div className={`min-w-0 flex-1 pb-4 ${isLast ? "pb-1" : ""}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><time className="text-xs tabular-nums text-zinc-500">{formatConsoleTime(event.timestamp, true)}</time><span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span></div>
                    {description && <p className="mt-1 break-words text-sm leading-5 text-zinc-700 dark:text-zinc-300">{description}</p>}
                    {linkedAction && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-2.5"><span className="text-sm text-rose-900 dark:text-rose-100">Ação {linkedAction.action_index + 1}: {linkedAction.action_type === "audio" ? "áudio" : "mensagem"} não enviada</span><button type="button" onClick={() => onRetryAction(linkedAction.id)} disabled={Boolean(retryingActionId)} className="min-h-11 rounded-lg bg-rose-300 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">{retryingActionId === linkedAction.id ? "Enviando…" : "Enviar manualmente"}</button></div>}
                    <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <summary className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-white/5 bg-black/10 dark:bg-white/[0.03] cursor-pointer font-medium select-none flex items-center justify-between hover:bg-black/20 dark:hover:bg-white/[0.06] transition-colors">
                        <span>Ver detalhes técnicos</span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </summary>
                      <div className="mt-2 space-y-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/80 dark:bg-black/30 p-3">
                        {event.metadata && event.metadata.providerError && typeof event.metadata.providerError === "object"
                          ? <ProviderErrorDetails value={event.metadata.providerError as Record<string, unknown>} />
                          : null}
                        <dl className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
                          <CopyableIdBadge label="ID do turno" value={event.turnId || turn.turnId} />
                          <CopyableIdBadge label="ID da sessão" value={event.sessionId || turn.sessionId} />
                          <CopyableIdBadge label="ID do ciclo" value={event.cycleId || turn.cycleId} />
                          {event.decisionId && <CopyableIdBadge label="ID da decisão" value={event.decisionId} />}
                          <div>
                            <dt className="text-[10px] uppercase font-bold text-zinc-500">Etapa registrada</dt>
                            <dd className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {formatBrainPhase(event.phase)} <span className="text-zinc-500">({event.phase})</span>
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase font-bold text-zinc-500">Estado registrado</dt>
                            <dd className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {formatBrainStatus(event.status)}{event.status ? ` (${event.status})` : ""}
                            </dd>
                          </div>
                          {event.actionId && <CopyableIdBadge label="ID da ação" value={event.actionId} />}
                          <div className="sm:col-span-2">
                            <dt className="text-[10px] uppercase font-bold text-zinc-500">Data e hora</dt>
                            <dd className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{event.timestamp}</dd>
                          </div>
                        </dl>
                        <ConsoleCycleEventCard event={event} />
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <ConsoleJsonViewer data={event.metadata} title="Dados completos do evento" />
                        )}
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </article>
  );
}

function BrainOperationalConsole({
  open,
  events,
  deliveryActions,
  runtimeState,
  failedActions,
  isRetryExhausted,
  isRetryingManual,
  retryingActionId,
  onRetryAction,
  onManualRetry,
  onClose,
  manualResolution,
  onManualResolution,
  onManualResolutionChange,
  mediaObservation,
  mediaObservationAnswer,
  mediaObservationSubmitting,
  onMediaObservationChange,
  onMediaObservationSubmit,
  theme = "default",
}: {
  open: boolean;
  events: AutoPilotCycleEvent[];
  deliveryActions: BrainDecisionAction[];
  runtimeState: { activeCycleToken?: string | null };
  failedActions: Array<{ id: string; action_type: string; action_index: number; payload?: Record<string, unknown> }>;
  isRetryExhausted: boolean;
  isRetryingManual: boolean;
  retryingActionId: string | null;
  onRetryAction: (actionId: string) => void;
  onManualRetry: () => void;
  onClose: () => void;
  manualResolution: { answer: string; question: string; submitting: boolean };
  onManualResolution: (saveForFuture: boolean) => void;
  onManualResolutionChange: (value: string) => void;
  mediaObservation: MediaObservationRequest | null;
  mediaObservationAnswer: string;
  mediaObservationSubmitting: boolean;
  onMediaObservationChange: (value: string) => void;
  onMediaObservationSubmit: () => void;
  theme?: BrainConsoleTheme;
}) {
  const whatsappTheme = theme === "whatsapp-ios";
  const groupedTurns = attachDeliveryActionsToTurns(groupBrainTurns(events), deliveryActions);
  const selectorRuntime = { ...runtimeState, now: Date.now() };
  const activeTurn = selectActiveBrainTurn(groupedTurns, selectorRuntime);
  const turns = getVisibleBrainTurns(groupedTurns, selectorRuntime);
  const [uiState, dispatch] = useReducer(brainTurnUiReducer, initialBrainTurnUiState);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const activeTurnIdRef = useRef<string | null>(null);
  const turnStatusesRef = useRef(new Map<string, string>());
  const collapseTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const nextActiveId = activeTurn?.id || null;
    if (activeTurnIdRef.current !== nextActiveId) {
      activeTurnIdRef.current = nextActiveId;
      dispatch({ type: "activate", turnId: nextActiveId });
      if (nextActiveId && followTailRef.current) {
        window.requestAnimationFrame(() => document.querySelector(`[data-turn-id="${CSS.escape(nextActiveId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      }
    }

    const currentStatuses = new Map(turns.map((turn) => [turn.id, turn.status]));
    for (const turn of turns) {
      const previousStatus = turnStatusesRef.current.get(turn.id);
      const existingTimer = collapseTimersRef.current.get(turn.id);
      if (!isTerminalBrainTurn(turn) && existingTimer) {
        window.clearTimeout(existingTimer);
        collapseTimersRef.current.delete(turn.id);
      }
      if (isTerminalBrainTurn(turn) && previousStatus && !isTerminalBrainTurn({ status: previousStatus as typeof turn.status }) && !existingTimer) {
        const timer = window.setTimeout(() => {
          dispatch({ type: "collapse_finished", turnId: turn.id });
          collapseTimersRef.current.delete(turn.id);
        }, 1800);
        collapseTimersRef.current.set(turn.id, timer);
      }
    }
    turnStatusesRef.current = currentStatuses;
  }, [activeTurn?.id, events, turns]);

  useEffect(() => () => {
    for (const timer of collapseTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const activeId = activeTurn?.id;
    if (!open || !activeId || !followTailRef.current) return;
    window.requestAnimationFrame(() => {
      const activeElement = scrollContainerRef.current?.querySelector(`[data-turn-id="${CSS.escape(activeId)}"]`);
      activeElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [open, activeTurn?.id, events.length]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const toggleTurn = (turnId: string) => dispatch({ type: "toggle", turnId });
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] ${
        whatsappTheme
          ? "whatsapp-ios bg-black/40 backdrop-blur-[2px]"
          : "bg-black/80 backdrop-blur-sm"
      } p-0 sm:p-6 flex flex-col justify-end sm:justify-center items-center`}
      role="dialog"
      aria-modal="true"
      aria-label="Console operacional do Brain"
    >
      <div
        className={`flex h-full w-full max-w-4xl flex-col overflow-hidden shadow-2xl transition-all ${
          whatsappTheme
            ? "brain-console-whatsapp rounded-none sm:rounded-[24px] border-0 sm:border border-white/[0.08] bg-[#0b141a] sm:bg-[#0b141a]/96 text-[#e9edef] shadow-black/40 backdrop-blur-3xl"
            : "rounded-none sm:rounded-2xl border-0 sm:border border-zinc-300 dark:border-zinc-700 bg-[#0b0b0f] text-zinc-900 dark:text-zinc-100"
        }`}
      >
        <header
          className={`flex items-center justify-between gap-3 border-b px-3.5 py-2.5 sm:px-5 sm:py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:pt-3 shrink-0 ${
            whatsappTheme
              ? "border-white/[0.07] bg-[#111b21]/95 sm:bg-[#111b21]/84 backdrop-blur-2xl"
              : "border-zinc-200 dark:border-zinc-800 bg-[#0b0b0f]/95 backdrop-blur-2xl"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar para a conversa"
              className="flex sm:hidden h-10 w-10 shrink-0 items-center justify-center -ml-1 rounded-xl text-zinc-400 hover:text-white active:scale-90 transition-transform cursor-pointer"
            >
              <ChevronLeft className="h-6 w-6 stroke-[2.2]" />
            </button>
            <span
              className={`hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border ${
                whatsappTheme
                  ? "border-[#25d366]/20 bg-[#25d366]/10 text-[#25d366]"
                  : "border-purple-400/25 bg-purple-400/10 text-purple-800 dark:text-purple-200"
              }`}
            >
              <BrainCircuit className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className={`truncate text-sm sm:text-base font-bold ${whatsappTheme ? "text-[#e9edef]" : "text-zinc-100"}`}>
                  Console do Brain
                </h2>
                {activeTurn && (
                  <span className="hidden xs:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border border-purple-500/30 bg-purple-500/10 text-purple-300">
                    {activeTurn.status === "running" ? "Processando" : activeTurn.status === "waiting_human" ? "Aguardando Operador" : "Ativo"}
                  </span>
                )}
              </div>
              <p className={`truncate text-xs ${whatsappTheme ? "text-[#8696a0]" : "text-zinc-400"}`}>
                Acompanhe o turno atual e consulte o histórico
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar console"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 cursor-pointer ${
              whatsappTheme
                ? "text-[#8696a0] hover:bg-white/[0.06] hover:text-[#e9edef] focus-visible:ring-[#25d366]/50"
                : "rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus-visible:ring-purple-300"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {isRetryExhausted && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-3"><p className="text-sm leading-5 text-amber-900 dark:text-amber-100">As tentativas automáticas terminaram. Você pode autorizar mais uma tentativa.</p><button type="button" onClick={onManualRetry} disabled={isRetryingManual} className="min-h-[44px] rounded-xl bg-amber-300 px-4 text-sm font-semibold text-zinc-950 active:scale-95 transition-transform disabled:opacity-50 cursor-pointer">{isRetryingManual ? "Tentando novamente…" : "Tentar mais uma vez"}</button></div>}
        <div
          ref={scrollContainerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            followTailRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 88;
          }}
          className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-5 ${
            whatsappTheme ? "bg-[#0b141a]" : "bg-[#0b0b0f]"
          }`}
        >
          {mediaObservation && (
            <section aria-label="Observação de mídia pendente">
              <h3 className={`mb-2 text-xs font-semibold uppercase tracking-widest ${
                whatsappTheme ? "text-[#25d366]" : "text-purple-700 dark:text-purple-300"
              }`}>Agora</h3>
              <div className={`rounded-2xl border p-4 ${
                whatsappTheme
                  ? "border-[#ff9500]/20 bg-[#ff9500]/[0.06]"
                  : "border-violet-400/30 bg-violet-400/[0.07]"
              }`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    whatsappTheme
                      ? "border-[#ff9500]/20 bg-[#ff9500]/10 text-[#ff9500]"
                      : "border-violet-400/25 bg-violet-400/10 text-violet-700 dark:text-violet-200"
                  }`}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">O Brain precisa da sua observação</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                      {mediaObservation.detail || (mediaObservation.kind === "video"
                        ? "Assista ao vídeo ou Reel e descreva o que é relevante para a conversa."
                        : "Descreva o que aparece na imagem para o Brain continuar.")}
                    </p>
                  </div>
                </div>
                <textarea
                  value={mediaObservationAnswer}
                  onChange={(event) => onMediaObservationChange(event.target.value)}
                  rows={3}
                  maxLength={3000}
                  placeholder={mediaObservation.kind === "video"
                    ? "Ex: ele mostrou o carro novo e comentou que acabou de comprar..."
                    : "Ex: selfie dele numa trilha, sorrindo..."}
                  className={`mt-3 min-h-24 w-full resize-y rounded-xl border p-3 text-[16px] md:text-sm leading-5 outline-none ${
                    whatsappTheme
                      ? "border-white/[0.08] bg-[#202c33] text-[#e9edef] placeholder:text-[#8696a0] focus:border-[#25d366]/40"
                      : "border-violet-400/25 bg-white/80 text-zinc-900 focus:border-violet-400/60 dark:bg-black/25 dark:text-zinc-100"
                  }`}
                  disabled={mediaObservationSubmitting}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={onMediaObservationSubmit}
                    disabled={mediaObservationSubmitting || !mediaObservationAnswer.trim()}
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer ${
                      whatsappTheme ? "bg-[#00a884] hover:bg-[#06cf9c]" : "bg-violet-600 hover:bg-violet-500"
                    }`}
                  >
                    {mediaObservationSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {mediaObservationSubmitting ? "Retomando..." : "Enviar observação e retomar"}
                  </button>
                </div>
              </div>
            </section>
          )}
          {activeTurn && !mediaObservation && (
            <section aria-label="Turno atual">
              <h3 className={`mb-2 text-xs font-semibold uppercase tracking-widest ${
                whatsappTheme ? "text-[#25d366]" : "text-purple-700 dark:text-purple-300"
              }`}>Agora</h3>
              <BrainTurnTimeline
                turn={activeTurn}
                turnNumber={turns.length - turns.indexOf(activeTurn)}
                expanded={uiState.expandedTurnIds.has(activeTurn.id)}
                active
                failedActions={failedActions}
                retryingActionId={retryingActionId}
                onRetryAction={onRetryAction}
                onToggleTurn={toggleTurn}
                manualResolution={manualResolution}
                onManualResolution={onManualResolution}
                onManualResolutionChange={onManualResolutionChange}
                theme={theme}
              />
            </section>
          )}
          {turns.some((turn) => turn !== activeTurn) && (
            <section aria-label="Histórico de turnos">
              <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                whatsappTheme ? "text-[#8696a0]" : "text-zinc-500"
              }`}>Histórico</h3>
              <div className={whatsappTheme ? "space-y-2.5" : "space-y-2"}>
                {turns.filter((turn) => turn !== activeTurn).map((turn) => (
                  <BrainTurnTimeline
                    key={turn.id}
                    turn={turn}
                    turnNumber={turns.length - turns.indexOf(turn)}
                    expanded={uiState.expandedTurnIds.has(turn.id)}
                    active={false}
                    failedActions={failedActions}
                    retryingActionId={retryingActionId}
                    onRetryAction={onRetryAction}
                    onToggleTurn={toggleTurn}
                    manualResolution={manualResolution}
                    onManualResolution={onManualResolution}
                    onManualResolutionChange={onManualResolutionChange}
                    theme={theme}
                  />
                ))}
              </div>
            </section>
          )}
          {turns.length === 0 && !mediaObservation && <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-10 text-center"><Clock3 className="mx-auto h-6 w-6 text-zinc-500" /><p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">Nenhuma atividade do Brain foi registrada nesta conversa.</p><p className="mt-1 text-xs text-zinc-500">Os turnos aparecerão aqui assim que começarem.</p></div>}
        </div>
      </div>
    </div>
  );
}

function getCopy(state: AutoPilotChatState) {
  if (state.status === "waiting_human") {
    const mediaObservation = String(state.pauseReason || "").startsWith("media_observation_required|");
    return {
      title: mediaObservation ? "Precisa de observação" : "Aguardando sua resposta",
      detail: mediaObservation
        ? state.activity?.detail || "Uma mídia precisa da sua observação antes de o Brain continuar."
        : state.pauseReason || "A IA não respondeu com segurança. Responda manualmente e retome o Piloto quando quiser.",
    };
  }
  if (state.status === "paused_guardrail") {
    return {
      title: "IA pausada por erro",
      detail: state.pauseReason || "O provedor de IA não respondeu. Revise e retome o piloto.",
    };
  }
  if (state.status === "paused_handoff") {
    return {
      title: "IA pausada para intervenção",
      detail: state.pauseReason || "A conversa precisa de uma ação manual.",
    };
  }
  const actUpdatedAt = state.activity?.updatedAt || state.stateUpdatedAt;
  const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
  const isWaiting =
    state.activity?.phase === "waiting" ||
    state.activity?.phase === "scheduled" ||
    state.status === "waiting_delay" ||
    state.status === "waiting_debounce" ||
    state.status === "scheduled";
  const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
  const isCompleted = state.activity?.phase === "completed";
  const isStale = isCompleted
    ? false
    : isWaiting
    ? (scheduledMs > 0 && Date.now() - scheduledMs > 120_000)
    : (updatedAtMs > 0 && Date.now() - updatedAtMs > 90_000);
  if (state.activity && !isStale) {
    return {
      title: formatVisibleBrainIdentity(state.activity.label),
      detail: formatVisibleBrainIdentity(state.activity.detail || "A IA está trabalhando nesta conversa."),
    };
  }
  if (state.status === "activation_wait") {
    return {
      title: "IA preparando o atendimento",
      detail: "Aguardando o período de segurança após a ativação.",
    };
  }
  if (state.status === "waiting_delay" || state.status === "waiting_debounce" || state.status === "scheduled") {
    return {
      title: "IA aguardando tempo pra agir",
      detail: "Esperando o tempo configurado antes de analisar e responder.",
    };
  }
  if (state.status === "in_queue") {
    return {
      title: "IA na fila",
      detail: "Esta conversa será processada em seguida.",
    };
  }
  if (scheduledMs > 0 && Date.now() >= scheduledMs) {
    return {
      title: "IA na fila de resposta",
      detail: "Tempo programado concluído. Processando resposta.",
    };
  }
  if (state.lastThoughts?.brainThought) {
    return {
      title: "Última resposta enviada",
      detail: "Aguardando nova mensagem do cliente para iniciar novo raciocínio.",
    };
  }
  return {
    title: "Piloto Automático ativo",
    detail: "Aguardando nova mensagem do cliente para iniciar raciocínio.",
  };
}

function ActivityIcon({ state, className }: { state: AutoPilotChatState; className: string }) {
  if (!state.isEnabled && state.status === "disabled") return <Bot className={className} />;
  if (state.status === "paused_guardrail" || state.status === "paused_handoff" || state.status === "waiting_human") {
    return <AlertTriangle className={className} />;
  }
  const phase = state.activity?.phase;
  if (phase === "completed") return <Check className={className} />;
  if (phase === "waiting" || phase === "scheduled" || !phase) return <Clock3 className={className} />;
  if (phase === "brain" || phase === "context") return <BrainCircuit className={`${className} animate-pulse text-purple-400`} />;
  if (phase === "sending" || phase === "typing") return <Send className={`${className} animate-pulse text-emerald-400`} />;
  return <Loader2 className={`${className} animate-spin`} />;
}

function TypingDots({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`${compact ? "h-1 w-1" : "h-1.5 w-1.5"} rounded-full bg-current animate-bounce`}
          style={{ animationDelay: `${index * 140}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}

function getValidThought(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (trimmed.length < 2) return null;
  if (/^[\s.·…\-–—_~*#]+$/.test(trimmed)) return null;

  // Se o pensamento contiver JSON cru ou chaves técnicas antigas da persona
  if (trimmed.startsWith("{") || trimmed.includes('"analise_do_pretendente"') || trimmed.includes('"responses"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.reason === "string" && parsed.reason.trim()) {
        return parsed.reason.trim();
      }
      if (typeof parsed?.analise_do_pretendente === "string" && parsed.analise_do_pretendente.trim()) {
        return parsed.analise_do_pretendente.trim();
      }
    } catch {
      // Se não for JSON válido (ex: truncado), extrai o texto da análise via regex
      const analiseMatch = trimmed.match(/"analise_do_pretendente"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"responses|"|\n|$)/i);
      if (analiseMatch && analiseMatch[1]) {
        return analiseMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      }
      const reasonMatch = trimmed.match(/"reason"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+"|\s*})/i);
      if (reasonMatch && reasonMatch[1]) {
        return reasonMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      }
      trimmed = trimmed
        .replace(/"responses"\s*:\s*\[[\s\S]*/i, "")
        .replace(/^[{\s]*"?analise_do_pretendente"?\s*:\s*"?/i, "")
        .replace(/["\s,{}]+$/i, "")
        .trim();
    }
  }

  return trimmed || null;
}

export function AutoPilotActivityIndicator({
  state: sourceState,
  variant,
  conversationId,
  openConsoleRequestId,
  onConsoleOpenRequestDismissed,
}: {
  state: AutoPilotChatState;
  variant: Variant;
  conversationId?: string;
  openConsoleRequestId?: number;
  onConsoleOpenRequestDismissed?: (requestId: number) => void;
}) {
  const targetId = conversationId || sourceState.conversationId;

  // Contagem regressiva suave para prévia e delay (recalcula com precisão mesmo em caso de F5/refresh)
  const calcInitialCountdown = () => {
    if (
      sourceState.scheduledResponseAt &&
      (
        sourceState.status === "waiting_delay" ||
        sourceState.status === "waiting_debounce" ||
        sourceState.status === "scheduled" ||
        sourceState.activity?.phase === "waiting" ||
        sourceState.activity?.phase === "scheduled"
      )
    ) {
      const diffSec = Math.ceil((Date.parse(sourceState.scheduledResponseAt) - Date.now()) / 1000);
      return Math.max(0, diffSec);
    }
    return sourceState.activity?.countdownSeconds ?? 0;
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number>(calcInitialCountdown);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedText, setEditedText] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isSendingNow, setIsSendingNow] = useState<boolean>(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [isRetryingManual, setIsRetryingManual] = useState<boolean>(false);
  const [manualResolutionAnswer, setManualResolutionAnswer] = useState("");
  const [isSubmittingResolution, setIsSubmittingResolution] = useState(false);
  const [mediaObservationAnswer, setMediaObservationAnswer] = useState("");
  const [isSubmittingMediaObservation, setIsSubmittingMediaObservation] = useState(false);
  const [canonicalEvents, setCanonicalEvents] = useState<AutoPilotCycleEvent[]>([]);
  const [canonicalDeliveryActions, setCanonicalDeliveryActions] = useState<BrainDecisionAction[]>([]);
  const [failedConfirmedActions, setFailedConfirmedActions] = useState<Array<{ id: string; action_type: string; action_index: number; payload?: Record<string, unknown> }>>([]);
  const [retryingActionId, setRetryingActionId] = useState<string | null>(null);
  const consoleOpen = isConsoleOpen || openConsoleRequestId !== undefined;
  const mediaObservation = sourceState.status === "waiting_human"
    ? parseMediaObservationPauseReason(sourceState.pauseReason, sourceState.activity?.detail)
    : null;

  useEffect(() => {
    setMediaObservationAnswer("");
  }, [mediaObservation?.messageId]);

  useEffect(() => {
    if (!targetId) return;

    // O painel fechado usa a projeção Realtime de autopilot_chat_states.
    // Histórico detalhado só é consultado quando o console é aberto.
    if (!consoleOpen) {
      setCanonicalEvents([]);
      setCanonicalDeliveryActions([]);
      setFailedConfirmedActions([]);
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;

    const loadCanonicalEvents = async () => {
      try {
        const query = new URLSearchParams({ conversationId: targetId });
        const response = await brainOperatorFetch(`/operator/brain/events?${query.toString()}`);
        const result = await response.json().catch(() => ({})) as {
          success?: boolean;
          events?: Array<{
            id?: string | number; turn_id?: string | null; session_id?: string | null;
            action_id?: string | null; decision_id?: string | null; conversation_id?: string | null;
            status?: string | null; event_type?: string | null; human_message?: string | null;
            created_at?: string | null; metadata?: Record<string, unknown> | null;
          }>;
          failedActions?: Array<{ id: string; action_type: string; action_index: number; payload?: Record<string, unknown> }>;
          actions?: Array<{
            id: string; decision_id?: string | null; turn_id?: string | null;
            decision_delivery_status?: string | null; action_index: number; action_type: string;
            status: string; provider_message_id?: string | null; attempts?: number;
          }>;
        };

        if (!response.ok || result?.success !== true || cancelled) return;

        const normalizedEvents = (result.events || []).map((event) => ({
          id: event.id,
          cycleId: eventMetadataText(event.metadata || {}, "cycleId") || eventMetadataText(event.metadata || {}, "cycle_id") || undefined,
          turnId: event.turn_id || undefined, sessionId: event.session_id || undefined,
          actionId: event.action_id || undefined, decisionId: event.decision_id || undefined,
          conversationId: event.conversation_id || targetId, sequence: Number(event.id) || 0,
          phase: String(event.metadata?.phase || event.status || "observed"),
          status: event.status || undefined, event: event.event_type || "brain_event",
          label: formatVisibleBrainIdentity(String(event.metadata?.label || formatBrainEvent(event.event_type))),
          detail: event.human_message ? formatVisibleBrainIdentity(event.human_message) : undefined,
          timestamp: event.created_at || new Date().toISOString(), metadata: event.metadata || {},
        }));
        setCanonicalEvents(normalizedEvents);
        setCanonicalDeliveryActions((result.actions || []).map((action) => ({
          id: action.id, decisionId: action.decision_id || undefined, turnId: action.turn_id || undefined,
          actionIndex: action.action_index, actionType: action.action_type, status: action.status,
          providerMessageId: action.provider_message_id, attempts: action.attempts,
          deliveryStatus: action.decision_delivery_status,
        })));
        setFailedConfirmedActions(Array.isArray(result.failedActions) ? result.failedActions : []);
      } catch {
        // Observabilidade nunca interrompe o atendimento.
      } finally {
        if (!cancelled) pollTimer = window.setTimeout(() => { void loadCanonicalEvents(); }, 4000);
      }
    };

    void loadCanonicalEvents();
    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [targetId, consoleOpen]);

  const handleSubmitMediaObservation = async () => {
    if (!targetId || !mediaObservation || !mediaObservationAnswer.trim() || isSubmittingMediaObservation) return;
    setIsSubmittingMediaObservation(true);
    try {
      const response = await brainOperatorFetch("/operator/brain/media-observation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: targetId,
          messageId: mediaObservation.messageId,
          observation: mediaObservationAnswer.trim(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Não foi possível registrar a observação.");
      }
      setMediaObservationAnswer("");
      toast.success("Observação registrada. O Brain vai retomar a conversa.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a observação.");
    } finally {
      setIsSubmittingMediaObservation(false);
    }
  };

  const handleManualFailedAction = async (actionId: string) => {
    if (!targetId || retryingActionId) return;
    setRetryingActionId(actionId);
    try {
      const response = await brainOperatorFetch("/operator/brain/retry-failed-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, actionId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) throw new Error(result?.error || "A ação não pôde ser enviada.");
      toast.success(result.queuedForBrainReview
        ? "Ação autorizada e aguardando o Brain revisar as mensagens novas."
        : "Envio confirmado. A mensagem foi registrada no histórico da conversa.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a ação.");
    } finally {
      setRetryingActionId(null);
    }
  };

  const turnRuntimeState = { activeCycleToken: sourceState.activeCycleToken, now: Date.now() };
  const groupedCanonicalTurns = attachDeliveryActionsToTurns(groupBrainTurns(canonicalEvents), canonicalDeliveryActions);
  const activeCanonicalTurn = selectActiveBrainTurn(groupedCanonicalTurns, turnRuntimeState);
  const visibleCanonicalTurns = getVisibleBrainTurns(groupedCanonicalTurns, turnRuntimeState);
  const latestDisplayTurn = activeCanonicalTurn
    || visibleCanonicalTurns.find((turn) => Boolean(turn.turnId) && isTerminalBrainTurn(turn))
    || visibleCanonicalTurns.find((turn) => turn.status === "waiting_human")
    || visibleCanonicalTurns.find((turn) => Boolean(turn.turnId))
    || visibleCanonicalTurns[0];
  const deliveryProjection = latestDisplayTurn?.delivery || deriveDeliveryProjection([]);
  const deliveryActionDetails = latestDisplayTurn?.deliveryActions?.map((action) =>
    `Ação ${action.actionIndex + 1}: ${formatDeliveryActionStatus(action)}`
  ) || [];
  const hasUnresolvedDelivery = deliveryProjection.status === "pending"
    || deliveryProjection.status === "sending"
    || deliveryProjection.status === "partially_sent"
    || deliveryProjection.status === "failed"
    || deliveryProjection.status === "uncertain";
  const latestCanonicalEvent = latestDisplayTurn ? getEffectiveBrainTurnEvent(latestDisplayTurn) : undefined;
  const latestBrainDecisionEvent = latestDisplayTurn
    ? [...latestDisplayTurn.events].reverse().find((event) => event.event === "brain_decision")
    : undefined;
  const canonicalEventToStatus: Record<string, { status: AutoPilotChatState["status"]; phase: AutoPilotActivityPhase }> = {
    brain_late: { status: "processing", phase: "brain" },
    manual_resolution_required: { status: "waiting_human", phase: "completed" },
    manual_resolution_received: { status: "processing", phase: "brain" },
    decision_persisted: { status: "processing", phase: "sending" },
    action_sending: { status: "processing", phase: "sending" },
    action_sent: { status: "processing", phase: "sending" },
    action_cancelled: { status: "processing", phase: "validating" },
    manual_delivery_authorized: { status: "processing", phase: "brain" },
    action_failed_retryable: { status: "processing", phase: "sending" },
    turn_completed: { status: "idle", phase: "completed" },
    action_dispatch_uncertain: { status: "failed", phase: "failed" },
    action_failed_confirmed: { status: "failed", phase: "failed" },
    cycle_completed: { status: "idle", phase: "completed" },
    cycle_cancelled: { status: "idle", phase: "cancelled" },
    cycle_failed: { status: "failed", phase: "failed" },
    failed_confirmed: { status: "failed", phase: "failed" },
    dispatch_uncertain: { status: "failed", phase: "failed" },
  };
  const validOperationalPhases: AutoPilotActivityPhase[] = [
    "waiting", "scheduled", "starting", "loading_context", "context", "search", "reanalyzing", "brain",
    "checklist", "validating", "typing", "recording_audio", "sending", "completed", "cancelled", "idle", "failed",
  ];
  const latestOperationalPhase = validOperationalPhases.includes(latestCanonicalEvent?.phase as AutoPilotActivityPhase)
    ? latestCanonicalEvent?.phase as AutoPilotActivityPhase
    : undefined;
  const phaseProjection = latestOperationalPhase
    ? {
        status: latestOperationalPhase === "failed"
          ? "failed" as const
          : latestOperationalPhase === "waiting" || latestOperationalPhase === "scheduled"
          ? "waiting_delay" as const
          : latestOperationalPhase === "idle" || latestOperationalPhase === "completed" || latestOperationalPhase === "cancelled"
          ? "idle" as const
          : "processing" as const,
        phase: latestOperationalPhase,
      }
    : undefined;
  const canonicalProjection = latestCanonicalEvent
    ? canonicalEventToStatus[latestCanonicalEvent.event] || phaseProjection
    : undefined;
  const hasLiveScheduledWait = Boolean(
    sourceState.isEnabled &&
    sourceState.scheduledResponseAt &&
    (
      sourceState.status === "waiting_delay" ||
      sourceState.status === "waiting_debounce" ||
      sourceState.status === "scheduled" ||
      sourceState.activity?.phase === "waiting" ||
      sourceState.activity?.phase === "scheduled"
    )
  );
  const state: AutoPilotChatState = !hasLiveScheduledWait && canonicalProjection && latestCanonicalEvent
    ? {
        ...sourceState,
        status: canonicalProjection.status,
        activity: {
          ...(sourceState.activity || {}),
          phase: canonicalProjection.phase,
          label: formatVisibleBrainIdentity(latestCanonicalEvent.label),
          detail: formatVisibleBrainIdentity(latestCanonicalEvent.detail),
          updatedAt: latestCanonicalEvent.timestamp,
        },
        pauseReason: latestCanonicalEvent.event === "manual_resolution_required"
          ? latestCanonicalEvent.detail || sourceState.pauseReason
          : sourceState.pauseReason,
      }
    : sourceState;
  const shouldRender = variant === "console-only"
    ? consoleOpen
    : variant === "floating"
    ? state.isEnabled || state.status === "waiting_human" || state.status === "failed"
    : hasLiveScheduledWait || isAutoPilotWorking(state) || hasUnresolvedDelivery;
  const rawCopy = getCopy(state);
  const copy = {
    title: formatVisibleBrainIdentity(hasUnresolvedDelivery ? deliveryProjection.statusLabel : rawCopy.title),
    detail: formatVisibleBrainIdentity(hasUnresolvedDelivery
      ? [deliveryProjection.label,
          deliveryProjection.failedCount ? `${deliveryProjection.failedCount} falha(s) confirmada(s)` : "",
          deliveryProjection.pendingCount ? `${deliveryProjection.pendingCount} pendente(s)` : "",
          deliveryProjection.uncertainCount ? `${deliveryProjection.uncertainCount} sem confirmação` : "",
          ...deliveryActionDetails,
        ].filter(Boolean).join(" · ")
      : rawCopy.detail),
  };
  const activity = state.activity;

  // Fases e Stepper Cognitivo
  const phase = activity?.phase;
  const isFailed = phase === "failed" || state.status === "failed";
  const isRetryExhausted =
    isFailed &&
    (state.lastError === "technical_retry_exhausted" ||
      copy.title.toLowerCase().includes("esgotadas") ||
      Boolean(canonicalEvents.some((event) => event.event === "technical_retry_exhausted")) ||
      (activity?.phase === "failed" && Boolean(activity?.label?.toLowerCase().includes("esgotadas"))));

  const rawBrainThought =
    activity?.brainThought ||
    (!isFailed ? state.lastThoughts?.brainThought : undefined);
  const validBrainThought = formatVisibleBrainIdentity(getValidThought(rawBrainThought));
  const hasThoughts = Boolean(validBrainThought);
  const isCompleted = phase === "completed" || (!isAutoPilotActivelyWorking(state) && hasThoughts);

  const isBrainActive =
    phase === "brain" ||
    phase === "context" ||
    (phase as string) === "search" ||
    (phase as string) === "analyzing" ||
    (phase as string) === "reanalyzing";

  const isTypingOrSending = phase === "typing" || phase === "sending";
  const isSendingDone = deliveryProjection.showSuccess;
  const isSendingActive = !isSendingDone && (deliveryProjection.status === "sending" || isTypingOrSending);
  const isBrainDone = isCompleted || (!isBrainActive && (Boolean(validBrainThought) || isTypingOrSending));

  const isWorking = isAutoPilotWorking(state);
  const isActivelyThinking = isBrainActive || (phase as string) === "search";
  const objectiveSourceEvent = latestDisplayTurn
    ? [...latestDisplayTurn.events].reverse().find((event) => eventMetadataText(event.metadata || {}, "currentObjectiveLabel"))
    : undefined;
  const currentObjectiveLabel = eventMetadataText(objectiveSourceEvent?.metadata || {}, "currentObjectiveLabel");
  const objectiveDecision = eventMetadataText(latestBrainDecisionEvent?.metadata || {}, "objectiveDecision");
  const planLabel = ({
    pursue: "Avançar objetivo",
    defer: "Adiar objetivo",
    already_satisfied: "Objetivo satisfeito",
    none: "Sem avanço de objetivo",
  } as Record<string, string>)[objectiveDecision || ""] || (latestBrainDecisionEvent ? "Decisão registrada" : "Em análise");
  const nextOperationalAction = state.status === "waiting_human"
    ? "Aguardar informação do operador"
    : deliveryProjection.status === "uncertain"
    ? "Reconciliar confirmação do envio"
    : deliveryProjection.status === "failed"
    ? "Revisar falha confirmada"
    : hasUnresolvedDelivery
    ? "Concluir envio das ações persistidas"
    : isBrainActive
    ? "Concluir decisão do Brain"
    : isCompleted
    ? "Aguardar nova mensagem"
    : "Continuar processamento";
  const showOperationalSummary = Boolean(latestDisplayTurn && (activeCanonicalTurn || latestBrainDecisionEvent || hasUnresolvedDelivery));

  // Auto-scroll suave para seguir o streaming ao vivo do raciocínio do Brain
  const brainThoughtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldRender) return;
    if (isBrainActive && brainThoughtRef.current) {
      brainThoughtRef.current.scrollTop = brainThoughtRef.current.scrollHeight;
    }
  }, [validBrainThought, isBrainActive, shouldRender]);

  // Reatividade estilo Antigravity: aberto por padrão durante atividade de raciocínio
  const [isThinkingExpanded, setIsThinkingExpanded] = useState<boolean>(true);
  const lastPhaseRef = useRef<string | undefined>(activity?.phase);
  const lastThoughtsRef = useRef<string>("");

  useEffect(() => {
    if (!shouldRender) return;
    const currentPhase = activity?.phase;
    const thoughtsKey = validBrainThought || "";

    if (
      (currentPhase && currentPhase !== lastPhaseRef.current && ["brain", "sol", "search", "typing"].includes(currentPhase)) ||
      (thoughtsKey && thoughtsKey !== lastThoughtsRef.current)
    ) {
      lastPhaseRef.current = currentPhase;
      lastThoughtsRef.current = thoughtsKey;
      setIsThinkingExpanded(true);
    }
  }, [activity?.phase, validBrainThought, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    if (isEditing) return;
    const interval = setInterval(() => {
      if (
        state.scheduledResponseAt &&
        (
          state.status === "waiting_delay" ||
          state.status === "waiting_debounce" ||
          state.status === "scheduled" ||
          activity?.phase === "waiting" ||
          activity?.phase === "scheduled"
        )
      ) {
        setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(state.scheduledResponseAt) - Date.now()) / 1000)));
      } else if (activity?.countdownSeconds && activity.countdownSeconds > 0) {
        const updatedAt = Date.parse(activity.updatedAt || state.stateUpdatedAt || "");
        setRemainingSeconds(Math.max(0, activity.countdownSeconds - Math.floor((Date.now() - updatedAt) / 1000)));
      } else {
        setRemainingSeconds(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activity?.countdownSeconds, activity?.updatedAt, activity?.phase, state.scheduledResponseAt, state.status, state.stateUpdatedAt, isEditing, shouldRender]);

  const currentPreview = activity?.currentResponsePreview;

  // Ações de intervenção do operador
  const handleStartEdit = async () => {
    setEditedText(currentPreview || "");
    setIsEditing(true);
    if (!targetId) return;
    try {
      await fetch(getApiUrl("/api/autopilot/hold-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, isEditing: true }),
      });
    } catch (err) {
      console.warn("Aviso ao pausar contagem para edição:", err);
    }
  };

  const handleCancelEdit = async () => {
    setIsEditing(false);
    if (currentPreview) {
      setEditedText(currentPreview);
    }
    if (!targetId) return;
    try {
      await fetch(getApiUrl("/api/autopilot/hold-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, isEditing: false }),
      });
    } catch (err) {
      console.warn("Aviso ao cancelar edição:", err);
    }
  };

  const handleCancelAction = async () => {
    if (!targetId || isCancelling) return;
    setIsCancelling(true);
    try {
      const res = await autopilotApiFetch("/api/autopilot/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, source: "cancel_action_button" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success === true && data.result === "cancelled") {
        toast.success(data.isEnabled ? "Ação cancelada. A IA continua ligada." : "Ação cancelada; a IA permanece desligada como solicitado.");
      } else {
        toast.error(data.detail || "Erro ao cancelar ação.");
      }
    } catch {
      toast.error("Erro de conexão ao cancelar ação.");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!targetId || !editedText.trim()) return;
    try {
      const res = await fetch(getApiUrl("/api/autopilot/edit-preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId, editedText: editedText.trim() }),
      });
      if (res.ok) {
        toast.success("Texto atualizado! A contagem foi retomada para o envio.");
        setIsEditing(false);
      } else {
        toast.error("Erro ao salvar edição.");
      }
    } catch {
      toast.error("Erro de conexão ao editar.");
    }
  };

  const handleSendNow = async () => {
    if (!targetId || isSendingNow) return;
    setIsSendingNow(true);
    try {
      const res = await fetch(getApiUrl("/api/autopilot/send-now"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.result === "started" || data.result === "already_processing") {
        toast.success(data.result === "started" ? "Ciclo iniciado." : "Este ciclo já está em processamento.");
      } else if (data.result === "disabled") {
        toast.error("IA está desativada neste chat.");
      } else if (data.result === "nothing_to_answer") {
        toast.info("Não há mensagem pendente para responder.");
      } else {
        toast.error(data.detail || "Não foi possível iniciar o ciclo.");
      }
    } catch {
      toast.error("Erro ao adiantar envio.");
    } finally {
      setIsSendingNow(false);
    }
  };

  const handleManualRetryOnce = async () => {
    if (!targetId || isRetryingManual) return;
    setIsRetryingManual(true);
    try {
      const res = await brainOperatorFetch("/operator/brain/retry-once", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast.success("Tentativa manual autorizada com sucesso!");
      } else {
        toast.error(data.message || data.error || "Não foi possível autorizar a nova tentativa manual.");
      }
    } catch {
      toast.error("Erro de conexão ao solicitar nova tentativa manual.");
    } finally {
      setIsRetryingManual(false);
    }
  };

  const handleSubmitManualResolution = async (saveForFuture: boolean) => {
    if (!targetId || !manualResolutionAnswer.trim() || isSubmittingResolution) return;
    setIsSubmittingResolution(true);
    try {
      const response = await brainOperatorFetch("/operator/brain/manual-resolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: targetId,
          answer: manualResolutionAnswer.trim(),
          saveForFuture,
          question: state.pauseReason || "",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || "Não foi possível retomar o Brain.");
      setManualResolutionAnswer("");
      toast.success(saveForFuture ? "Fato salvo para novas sessões. Brain retomou o turno." : "Brain retomou o turno com este fato apenas nesta sessão.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar a informação ao Brain.");
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  if (!shouldRender) return null;


  if (variant === "console-only") {
    return (
      <BrainOperationalConsole
        open={consoleOpen}
        events={canonicalEvents}
        deliveryActions={canonicalDeliveryActions}
        runtimeState={{ activeCycleToken: state.activeCycleToken }}
        failedActions={failedConfirmedActions}
        isRetryExhausted={isRetryExhausted}
        isRetryingManual={isRetryingManual}
        retryingActionId={retryingActionId}
        onRetryAction={handleManualFailedAction}
        onManualRetry={handleManualRetryOnce}
        onClose={() => {
          setIsConsoleOpen(false);
          if (openConsoleRequestId !== undefined) onConsoleOpenRequestDismissed?.(openConsoleRequestId);
        }}
        manualResolution={{ answer: manualResolutionAnswer, question: formatVisibleBrainIdentity(state.pauseReason), submitting: isSubmittingResolution }}
        onManualResolution={handleSubmitManualResolution}
        onManualResolutionChange={setManualResolutionAnswer}
        mediaObservation={mediaObservation}
        mediaObservationAnswer={mediaObservationAnswer}
        mediaObservationSubmitting={isSubmittingMediaObservation}
        onMediaObservationChange={setMediaObservationAnswer}
        onMediaObservationSubmit={handleSubmitMediaObservation}
        theme="whatsapp-ios"
      />
    );
  }

  // VARIANTE INBOX (Lista de conversas - limpa e elegante)
  if (variant === "inbox") {
    return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] font-semibold", state.isEnabled ? "text-emerald-400" : "text-zinc-500")}>
      <ActivityIcon state={state} className="h-3 w-3 shrink-0" />
        <span className="truncate">{state.scheduledResponseAt && remainingSeconds > 0
          ? `IA responde em ${Math.floor(remainingSeconds / 60) > 0 ? `${Math.floor(remainingSeconds / 60)}m ` : ""}${String(remainingSeconds % 60).padStart(2, "0")}s`
          : remainingSeconds === 0 && (
              state.status === "waiting_delay" ||
              state.status === "waiting_debounce" ||
              state.status === "scheduled" ||
              activity?.phase === "waiting" ||
              activity?.phase === "scheduled"
            )
          ? "IA iniciando..."
          : copy.title}</span>
        {state.isEnabled && isWorking && <TypingDots compact />}
      </span>
    );
  }

  // VARIANTE BANNER (Topo estático opcional)
  if (variant === "banner") {
    return (
      <div className="mx-1 mb-2 overflow-hidden rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-gradient-to-r from-emerald-50 via-cyan-50 to-slate-50 dark:from-emerald-950/40 dark:via-cyan-950/30 dark:to-slate-900/50 p-2.5 text-emerald-900 dark:text-emerald-100 shadow-md backdrop-blur-md transition-all duration-300">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15">
              <ActivityIcon state={state} className="h-4 w-4 text-emerald-400" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-200">
                <span>{copy.title}</span>
                <TypingDots compact />
              </div>
              <p className="truncate text-[10px] text-zinc-600 dark:text-zinc-400">{copy.detail}</p>
            </div>
          </div>

          {(hasThoughts || isActivelyThinking) && (
            <button
              type="button"
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all cursor-pointer shrink-0"
              title="Alternar visão de pensamento da IA"
            >
              <BrainCircuit className="h-3 w-3 text-cyan-400" />
              <span className="hidden sm:inline">Raciocínio</span>
              {isThinkingExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
    );
  }

  // VARIANTE FLOATING (Cápsula Flutuante sobre o Chat - Estilo Antigravity Reativo)
  const isAudioPreview = currentPreview?.startsWith("[audio:");
  const shouldShowReasoningSection = Boolean(hasThoughts || isBrainActive || validBrainThought);

  return (
    <div className="w-full min-w-0 select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0d0d11]/95 p-3 text-zinc-900 dark:text-zinc-100 shadow-2xl shadow-black/90 backdrop-blur-2xl transition-all duration-300">
        
        {/* Cabeçalho do HUD Flutuante */}
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                isBrainActive
                  ? "bg-purple-500/20 border-purple-500/50 text-purple-700 dark:text-purple-300 shadow-sm shadow-purple-500/20"
                  : isTypingOrSending
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 shadow-sm shadow-emerald-500/20"
                  : isCompleted
                  ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                  : "bg-zinc-200/80 dark:bg-zinc-800/80 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
              )}
            >
              <ActivityIcon state={state} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {copy.title}
                </span>
                {!isCompleted && isWorking && <TypingDots compact />}
              </div>
              <p className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate">
                {copy.detail}
              </p>
            </div>
          </div>

          {/* Badges de Contagem & Controles Rápidos */}
          <div className="flex min-w-0 w-full flex-wrap items-center gap-1.5 border-t border-zinc-200 dark:border-zinc-800/70 pt-2">
            {isEditing ? (
              <span className="font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-500/40 animate-pulse flex items-center gap-1">
                <Pause className="h-2.5 w-2.5" />
                <span>Pausado p/ edição</span>
              </span>
            ) : (
              remainingSeconds > 0 || hasLiveScheduledWait
            ) && (
              <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/40 animate-pulse">
                {remainingSeconds > 0
                  ? remainingSeconds >= 60
                    ? `${Math.floor(remainingSeconds / 60)}m ${String(remainingSeconds % 60).padStart(2, "0")}s`
                    : `${remainingSeconds}s`
                  : "Iniciando..."}
              </span>
            )}

            {/* Botão Tentar Mais Uma Vez (quando tentativas esgotadas) */}
            {isRetryExhausted && (
              <button
                type="button"
                onClick={handleManualRetryOnce}
                disabled={isRetryingManual}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-700 dark:text-amber-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Autorizar exatamente uma nova tentativa manual para este lote"
              >
                {isRetryingManual ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Tentando...</span>
                  </>
                ) : (
                  <>
                    <FastForward className="h-3 w-3" />
                    <span className="whitespace-nowrap">Tentar mais uma vez</span>
                  </>
                )}
              </button>
            )}

            {/* Botão Responder Já (quando aguardando debounce de tempo) */}
            {(state.status === "waiting_delay" ||
              state.status === "waiting_debounce" ||
              state.status === "scheduled" ||
              activity?.phase === "waiting" ||
              activity?.phase === "scheduled") && (
              <button
                type="button"
                onClick={handleSendNow}
                disabled={isSendingNow}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Ignorar o tempo de espera e responder agora"
              >
                <FastForward className="h-3 w-3" />
                <span className="whitespace-nowrap">Responder Já</span>
              </button>
            )}

            {/* Cancelamento operacional: desativa a IA do chat e invalida o ciclo */}
            {isWorking && (
              <button
                type="button"
                onClick={handleCancelAction}
                disabled={isCancelling}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-700 dark:text-rose-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Cancelar apenas o ciclo atual; a IA continuará ligada para próximas mensagens"
              >
                <StopCircle className="h-3 w-3" />
                <span className="whitespace-nowrap">{isCancelling ? "Cancelando..." : "Cancelar ação"}</span>
              </button>
            )}

            <button type="button" onClick={() => setIsConsoleOpen(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-[10px] hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Abrir console operacional">
              <Maximize2 className="h-3 w-3" />
              <span className="whitespace-nowrap">Abrir console</span>
            </button>

            {/* Botão Alternar Raciocínio (Estilo Antigravity) */}
            {shouldShowReasoningSection && (
              <button
                type="button"
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold active:scale-95 transition-all cursor-pointer border",
                  isThinkingExpanded
                    ? "bg-zinc-200/80 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                    : "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35 hover:bg-purple-500/25"
                )}
                title="Alternar visão de raciocínio do Brain"
              >
                <BrainCircuit className="h-3 w-3 text-purple-400" />
                <span className="whitespace-nowrap">{isThinkingExpanded ? "Recolher" : "Raciocínio"}</span>
                {isThinkingExpanded ? (
                  <ChevronUp className="h-2.5 w-2.5 ml-0.5" />
                ) : (
                  <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Stepper Cognitivo do Brain - Fluxo Canônico Brain -> Envio */}
        {(isWorking || hasUnresolvedDelivery) && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/50 rounded-xl border border-zinc-200 dark:border-zinc-800/70 mt-2.5 text-[10px]">
            {/* Etapa 1: Brain */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isBrainActive
                  ? "bg-purple-500/20 text-purple-800 dark:text-purple-200 border border-purple-500/50 font-bold animate-pulse"
                  : isBrainDone
                  ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25"
                  : "text-zinc-500"
              )}
            >
              <BrainCircuit className="h-3 w-3 shrink-0" />
              <span className="truncate">1. Brain</span>
              {isBrainDone && !isBrainActive && (
                <Check className="h-2.5 w-2.5 text-purple-400 shrink-0 ml-0.5" />
              )}
            </div>

            {/* Etapa 2: Envio */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isSendingActive
                  ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border border-emerald-500/50 font-bold animate-pulse"
                  : isSendingDone
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
                  : deliveryProjection.status === "failed" || deliveryProjection.status === "uncertain"
                  ? "bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-500/30"
                  : deliveryProjection.status === "partially_sent"
                  ? "bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30"
                  : "text-zinc-500"
              )}
            >
              <Send className="h-3 w-3 shrink-0" />
              <span className="truncate">2. Envio</span>
              {deliveryProjection.actionCount > 0 && <span className="shrink-0 tabular-nums">{deliveryProjection.sentCount}/{deliveryProjection.actionCount}</span>}
              {isSendingDone && !isTypingOrSending && (
                <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0 ml-0.5" />
              )}
              {(deliveryProjection.status === "failed" || deliveryProjection.status === "uncertain") && <AlertTriangle className="h-2.5 w-2.5 text-rose-700 dark:text-rose-300 shrink-0 ml-0.5" />}
              {deliveryProjection.status === "partially_sent" && <AlertTriangle className="h-2.5 w-2.5 text-amber-700 dark:text-amber-300 shrink-0 ml-0.5" />}
            </div>
            {hasUnresolvedDelivery && deliveryProjection.actionCount > 0 && <p className={`col-span-2 px-1 text-center text-[9px] ${deliveryProjection.status === "failed" || deliveryProjection.status === "uncertain" ? "text-rose-800 dark:text-rose-200" : "text-zinc-600 dark:text-zinc-400"}`}>{deliveryProjection.label}</p>}
          </div>
        )}

        {showOperationalSummary && (
          <div className="mt-2.5 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-1.5 text-[10px]">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-200/80 dark:bg-black/30 px-2 py-1.5 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Objetivo</div>
              <div className="line-clamp-2 break-words font-medium leading-tight text-zinc-800 dark:text-zinc-200" title={currentObjectiveLabel || "Nenhum objetivo pendente"}>
                {currentObjectiveLabel || "Nenhum pendente"}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-200/80 dark:bg-black/30 px-2 py-1.5 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Plano</div>
              <div className="line-clamp-2 break-words font-medium leading-tight text-zinc-800 dark:text-zinc-200" title={planLabel}>{planLabel}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-200/80 dark:bg-black/30 px-2 py-1.5 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Próxima ação</div>
              <div className="line-clamp-2 break-words font-medium leading-tight text-zinc-800 dark:text-zinc-200" title={nextOperationalAction}>{nextOperationalAction}</div>
            </div>
          </div>
        )}

        {/* Prévia da Mensagem e Cadência de Digitação */}
        {isTypingOrSending && currentPreview && (
          <div className="mt-2.5 pt-2.5 border-t border-zinc-200 dark:border-zinc-800/80">
            <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <MessageSquare className="h-3 w-3" />
                <span>
                  {activity?.totalBalloons && activity.totalBalloons > 1
                    ? `Balão ${activity.currentBalloon || 1} de ${activity.totalBalloons}:`
                    : "Mensagem pronta para envio:"}
                </span>
              </span>

              {!isAudioPreview && !isEditing && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 active:scale-95 cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 transition-all"
                  >
                    <Edit3 className="h-2.5 w-2.5" />
                    <span>Editar</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendNow}
                    disabled={isSendingNow}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 active:scale-95 cursor-pointer text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 transition-all"
                  >
                    <FastForward className="h-2.5 w-2.5" />
                    <span>Enviar Já</span>
                  </button>
                </div>
              )}
            </div>

            {isAudioPreview ? (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs">
                <Mic className="h-4 w-4 animate-pulse text-emerald-400" />
                <span className="font-semibold text-[11px]">
                  Áudio gravado da Larissa sendo enviado...
                </span>
              </div>
            ) : isEditing ? (
              <div className="space-y-2 animate-in fade-in duration-150">
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full rounded-xl bg-white dark:bg-black border border-cyan-500/50 p-2 text-xs text-zinc-950 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none min-h-[55px]"
                  placeholder="Edite a resposta aqui antes do envio..."
                  rows={2}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] hover:bg-zinc-300 dark:hover:bg-zinc-700 active:scale-95 cursor-pointer flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    <span>Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-zinc-950 dark:text-white font-bold text-[10px] active:scale-95 cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <Check className="h-3 w-3" />
                    <span>Salvar Edição</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-zinc-100/90 dark:bg-zinc-900/90 border border-zinc-800/90 text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed font-normal whitespace-pre-wrap select-text">
                {currentPreview}
              </div>
            )}
          </div>
        )}

        {/* Pensamento Reativo do Brain (Estilo Antigravity) */}
        {shouldShowReasoningSection && isThinkingExpanded && (
          <div className="mt-2.5 space-y-2 border-t border-zinc-200 dark:border-zinc-800/80 pt-2.5 text-xs animate-in fade-in duration-200">
            {/* Bloco Brain (Raciocínio & Decisão) */}
            {(isBrainActive || validBrainThought) && (
              <div
                className={cn(
                  "rounded-xl border p-2.5 transition-all duration-200",
                  isBrainActive
                    ? "border-purple-300 dark:border-purple-500/40 bg-purple-50 dark:bg-purple-950/20 shadow-inner"
                    : "border-purple-200 dark:border-purple-500/25 bg-purple-50/70 dark:bg-purple-950/15"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-purple-700 dark:text-purple-300 text-[10px] uppercase tracking-wider">
                    <BrainCircuit className="h-3.5 w-3.5 text-purple-400" />
                    <span>Brain • Raciocínio & Decisão</span>
                  </div>
                  {isBrainActive ? (
                    <span className="text-[9px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {validBrainThought ? "Raciocinando ao vivo..." : "Processando..."}
                    </span>
                  ) : isFailed && validBrainThought ? (
                    <span className="text-[9px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <X className="h-2.5 w-2.5 text-rose-400" />
                      Falha na execução
                    </span>
                  ) : validBrainThought ? (
                    <span className="text-[9px] font-medium text-purple-400/90 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Check className="h-2.5 w-2.5 text-purple-400" />
                      Decisão formulada
                    </span>
                  ) : null}
                </div>

                {validBrainThought ? (
                  <div
                    ref={brainThoughtRef}
                    className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto pr-1 select-text scrollbar-thin scrollbar-thumb-zinc-700"
                  >
                    {validBrainThought}
                    {isBrainActive && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-purple-400 animate-pulse align-middle rounded-sm" />
                    )}
                  </div>
                ) : isBrainActive ? (
                  <p className="text-[11px] leading-relaxed text-purple-200/80 italic">
                    {phase === "search" ? (
                      <span className="flex items-center gap-1 text-purple-700 dark:text-purple-300">
                        <Search className="h-3 w-3 animate-spin" />
                        Consultando memórias remotas e contexto para fundamentar a decisão...
                      </span>
                    ) : (
                      "Analisando contexto, memórias e formulando resposta em turno único..."
                    )}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
      <BrainOperationalConsole
        open={consoleOpen}
        events={canonicalEvents}
        deliveryActions={canonicalDeliveryActions}
        runtimeState={{ activeCycleToken: state.activeCycleToken }}
        failedActions={failedConfirmedActions}
        isRetryExhausted={isRetryExhausted}
        isRetryingManual={isRetryingManual}
        retryingActionId={retryingActionId}
        onRetryAction={handleManualFailedAction}
        onManualRetry={handleManualRetryOnce}
        onClose={() => {
          setIsConsoleOpen(false);
          if (openConsoleRequestId !== undefined) onConsoleOpenRequestDismissed?.(openConsoleRequestId);
        }}
        manualResolution={{ answer: manualResolutionAnswer, question: formatVisibleBrainIdentity(state.pauseReason), submitting: isSubmittingResolution }}
        onManualResolution={handleSubmitManualResolution}
        onManualResolutionChange={setManualResolutionAnswer}
        mediaObservation={mediaObservation}
        mediaObservationAnswer={mediaObservationAnswer}
        mediaObservationSubmitting={isSubmittingMediaObservation}
        onMediaObservationChange={setMediaObservationAnswer}
        onMediaObservationSubmit={handleSubmitMediaObservation}
      />
    </div>
  );
}
