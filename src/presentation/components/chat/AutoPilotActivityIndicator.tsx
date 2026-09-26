"use client";

import React, { useState, useEffect, useRef } from "react";
import { autopilotApiFetch } from "@/infrastructure/http/autopilotApiFetch";
import {
  AlertTriangle,
  BrainCircuit,
  Clock3,
  Loader2,
  Send,
  ChevronDown,
  ChevronUp,
  Mic,
  MessageSquare,
  Bot,
  Pause,
  StopCircle,
  Maximize2,
  Edit3,
  Check,
  X,
  FastForward,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AutoPilotChatState, AutoPilotCycleEvent } from "@/domain/entities/AutoPilot";

export type Variant = "banner" | "inbox" | "bubble" | "floating";

function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
}

export function isAutoPilotWorking(state?: AutoPilotChatState | null): boolean {
  if (!state) return false;
  if (state.status === "paused_guardrail" || state.status === "paused_handoff") return true;

  // Proteção contra atividades que ficaram congeladas no visual se a rede ou worker oscilar
  if (state.activity) {
    const actUpdatedAt = state.activity.updatedAt || state.stateUpdatedAt;
    const updatedAtMs = actUpdatedAt ? Date.parse(actUpdatedAt) : 0;
    
    // Para fase de espera / agendamento de debounce:
    if (state.activity.phase === "waiting" || state.status === "waiting_delay") {
      const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
      // Só é zumbi se já passou do horário agendado há mais de 120s
      if (scheduledMs > 0 && Date.now() - scheduledMs > 120_000) {
        return false;
      }
    } else if (state.activity.phase === "completed") {
      // Fase completed NUNCA é zumbi! Representa o histórico preservado da última resposta enviada.
      // Continua disponível até a IA começar a responder outra mensagem.
    } else {
      // Fases ativas de geração (sol, atria, reanalyzing): se tiver mais de 90s sem atualização, é zumbi
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
      state.status === "in_queue" ||
      state.status === "processing"
  );
  if (hasActiveProgress) return true;

  return Boolean(state.isEnabled);
}

export function isAutoPilotActivelyWorking(state?: AutoPilotChatState | null): boolean {
  if (!isAutoPilotWorking(state)) return false;
  if (state?.status === "paused_guardrail" || state?.status === "paused_handoff") return false;
  return (
    !["waiting", "completed", undefined].includes(state?.activity?.phase) &&
    state?.status !== "activation_wait" &&
    state?.status !== "waiting_delay" &&
    state?.status !== "waiting_debounce"
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
  const labels: Record<string, string> = {
    "gpt-6-luna": "GPT-6 Luna",
    "gpt-6-sol": "GPT-6 Sol",
    "gpt-5.6-luna": "GPT-5.6 Luna (legado)",
    "gpt-5.6-terra": "GPT-5.6 Terra (legado)",
    "gpt-5.6-sol": "GPT-5.6 Sol (legado)",
  };
  return labels[model] || model;
}

function formatConsoleSetting(value: string | null): string | null {
  if (!value) return null;
  if (value === "xhigh") return "XHigh";
  if (value === "none") return "None";
  if (value === "max") return "Max";
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
    ["Input total", input], ["Cacheado", cached], ["Não cacheado", uncached],
    ["Output", output], ["↳ Reasoning", reasoning], ["Total", total],
  ] as const;

  return (
    <section className="mt-3 rounded-lg border border-cyan-900/50 bg-cyan-950/10 p-2.5" aria-label="Uso OpenAI neste ciclo">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">Usage OpenAI</div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-[10px] text-zinc-300">
        <span>{modelNames}{reasoningEffort ? ` · Reasoning ${reasoningEffort}` : ""}</span>
        <span>{requests === null ? "Requests indisponíveis" : `${formatUsageTokens(requests)} requests`}</span>
      </div>
      <div className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
        {tokenRows.map(([label, value]) => <div key={label} className={`flex justify-between gap-3 text-[10px] ${label.startsWith("↳") ? "pl-2 text-zinc-500" : "text-zinc-300"}`}><span>{label}</span><span>{formatUsageTokens(value)}</span></div>)}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 border-t border-zinc-800 pt-2 text-[10px] text-zinc-300">
        <span>Cache hit</span><span>{cacheHitRate === null ? "Indisponível" : `${cacheHitRate.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</span>
      </div>
      <div className="mt-2 border-t border-zinc-800 pt-2">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Custo estimado · tarifa Standard</div>
        <div className="mt-0.5 text-[12px] font-medium text-zinc-100">{usd === null ? "Indisponível" : `US$ ${usd.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}</div>
        {brl !== null && <div className="text-[10px] text-zinc-400">≈ R$ {brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
        {fx !== null && <div className="mt-0.5 text-[9px] text-zinc-600">Câmbio estimado: R${fx.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/US$</div>}
        {usage.cacheWriteTokens === null && <div className="mt-1 text-[9px] text-zinc-600">Cache write não informado pela API.</div>}
        {typeof usage.serviceTier === "string" && <div className="mt-1 text-[9px] text-zinc-600">Tier: {usage.serviceTier}</div>}
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
      <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function ConsoleCycleEventCard({ event }: { event: AutoPilotCycleEvent }) {
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
    <article className={`rounded-xl border p-3 ${isBrainDecision ? "border-purple-500/40 bg-purple-950/20" : isResponseReady ? "border-emerald-500/30 bg-emerald-950/15" : "border-zinc-800 bg-zinc-950/70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] text-zinc-500">{new Date(event.timestamp).toLocaleTimeString("pt-BR")} · #{event.sequence} · {event.phase}</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-100">{event.label}</div>
        </div>
        {isBrainDecision && <BrainCircuit className="h-4 w-4 shrink-0 text-purple-300" />}
      </div>

      {isBrainStarted && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ConsoleEventField label="Modelo">
            {hasModelDivergence ? (
              <span>
                <span className="text-amber-400">Cfg: {configuredModel}</span>
                <span className="mx-1 text-zinc-500">·</span>
                <span className="text-emerald-400">Exec: {executedModel}</span>
              </span>
            ) : (
              executedModel || model
            )}
          </ConsoleEventField>
          <ConsoleEventField label="Reasoning">
            {hasReasoningDivergence ? (
              <span>
                <span className="text-amber-400">Cfg: {configuredReasoning}</span>
                <span className="mx-1 text-zinc-500">·</span>
                <span className="text-emerald-400">Exec: {executedReasoning}</span>
              </span>
            ) : (
              executedReasoning || reasoningEffort
            )}
          </ConsoleEventField>
          <ConsoleEventField label="Verbosity">{verbosity}</ConsoleEventField>
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
            <details className="rounded-lg border border-cyan-900/50 bg-cyan-950/10 p-2.5 text-[10px] text-zinc-300">
              <summary className="cursor-pointer font-semibold uppercase tracking-wider text-cyan-300">Contexto enviado ao Brain</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <ConsoleEventField label="Mensagens candidatas">{eventMetadataNumber(contextWindow, "candidateCount")}</ConsoleEventField>
                <ConsoleEventField label="Após deduplicação">{eventMetadataNumber(contextWindow, "deduplicatedCount")}</ConsoleEventField>
                <ConsoleEventField label="Após budget">{eventMetadataNumber(contextWindow, "budgetedCount")}</ConsoleEventField>
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
                <ConsoleEventField label="Corte por token budget">{contextWindowCuts.tokenBudget === true ? "Sim" : "Não"}</ConsoleEventField>
                <ConsoleEventField label="Corte por caracteres">{contextWindow.cutByCharLimit === true || contextWindowCuts.finalCharacters === true ? "Sim" : "Não"}</ConsoleEventField>
                {contextWindowCuts.mandatoryTokenOverflow === true && <ConsoleEventField label="Observação de budget">Mensagens obrigatórias excederam o budget</ConsoleEventField>}
              </div>
              {contextWindowMessages.length > 0 && (
                <details className="mt-2 border-t border-zinc-800 pt-2">
                  <summary className="cursor-pointer">Mensagens incluídas ({contextWindowMessages.length})</summary>
                  {Array.isArray(contextWindow.finalMandatoryMessageIds) && contextWindow.finalMandatoryMessageIds.length > 0 && (
                    <div className="mt-2 break-all text-cyan-300">Obrigatórias preservadas: {contextWindow.finalMandatoryMessageIds.filter((id): id is string => typeof id === "string").join(" · ")}</div>
                  )}
                  <ol className="mt-2 space-y-1">
                    {contextWindowMessages.map((item, index) => (
                      <li key={`${String(item.id || "message")}-${index}`} className="break-all text-zinc-400">
                        {typeof item.sender === "string" ? item.sender : "Mensagem"}
                        {typeof item.timestamp === "string" ? ` · ${item.timestamp}` : ""}
                        {typeof item.id === "string" ? ` · ${item.id}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {contextWindowPreviews.length > 0 && (
                <div className="mt-2 border-t border-zinc-800 pt-2">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">Prévia segura · últimas mensagens</div>
                  <ol className="mt-1 space-y-1 text-zinc-300">
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
          <div className="rounded-lg bg-black/20 p-2 text-[10px] text-zinc-300">
            {hasDivergence ? (
              <div className="space-y-1">
                <div>
                  <span className="font-semibold text-amber-400">Configurado:</span> {configuredModel || model || "Modelo não informado"}
                  {(configuredReasoning || reasoningEffort) && <span className="text-zinc-500"> · Reasoning: {configuredReasoning || reasoningEffort}</span>}
                </div>
                <div>
                  <span className="font-semibold text-emerald-400">Executado:</span> {executedModel || model || "Modelo não informado"}
                  {(executedReasoning || reasoningEffort) && <span className="text-zinc-500"> · Reasoning: {executedReasoning || reasoningEffort}</span>}
                </div>
              </div>
            ) : (
              <>
                {executedModel || model || "Modelo não informado"}
                {(reasoningEffort || verbosity) && <span className="text-zinc-500"> · Reasoning: {reasoningEffort || "—"} · Verbosity: {verbosity || "—"}</span>}
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
              <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-200">
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
            <div className="text-[11px] text-zinc-200">Áudio autorizado para envio</div>
          ) : responses.length > 0 ? (
            <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-100">
              {responses.map((response, index) => <li key={`${index}-${response}`}>{response}</li>)}
            </ol>
          ) : null}
        </div>
      )}

      {!isDiagnostic && event.detail && <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">{event.detail}</div>}
      <OpenAiUsagePanel metadata={metadata} />
    </article>
  );
}

function getCopy(state: AutoPilotChatState) {
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
  const isWaiting = state.activity?.phase === "waiting" || state.status === "waiting_delay";
  const scheduledMs = state.scheduledResponseAt ? Date.parse(state.scheduledResponseAt) : 0;
  const isCompleted = state.activity?.phase === "completed";
  const isStale = isCompleted
    ? false
    : isWaiting
    ? (scheduledMs > 0 && Date.now() - scheduledMs > 120_000)
    : (updatedAtMs > 0 && Date.now() - updatedAtMs > 90_000);
  if (state.activity && !isStale) {
    return {
      title: state.activity.label,
      detail: state.activity.detail || "A IA está trabalhando nesta conversa.",
    };
  }
  if (state.status === "activation_wait") {
    return {
      title: "IA preparando o atendimento",
      detail: "Aguardando o período de segurança após a ativação.",
    };
  }
  if (state.status === "waiting_delay") {
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
  if (state.lastThoughts?.atriaThought || state.lastThoughts?.solThought) {
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
  if (state.status === "paused_guardrail" || state.status === "paused_handoff") {
    return <AlertTriangle className={className} />;
  }
  const phase = state.activity?.phase;
  if (phase === "completed") return <Check className={className} />;
  if (phase === "waiting" || !phase) return <Clock3 className={className} />;
  if (phase === "brain" || phase === "atria" || phase === "context") return <BrainCircuit className={`${className} animate-pulse text-purple-400`} />;
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

  // Se o pensamento contiver JSON cru ou chaves técnicas da persona/Atria
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
  state,
  variant,
  conversationId,
}: {
  state: AutoPilotChatState;
  variant: Variant;
  conversationId?: string;
}) {
  const shouldRender = variant === "floating" ? state.isEnabled : isAutoPilotWorking(state);
  const copy = getCopy(state);
  const activity = state.activity;
  const targetId = conversationId || state.conversationId;

  // Contagem regressiva suave para prévia e delay (recalcula com precisão mesmo em caso de F5/refresh)
  const calcInitialCountdown = () => {
    if (state.scheduledResponseAt && (state.status === "waiting_delay" || activity?.phase === "waiting")) {
      const diffSec = Math.round((Date.parse(state.scheduledResponseAt) - Date.now()) / 1000);
      return Math.max(0, diffSec);
    }
    return activity?.countdownSeconds ?? 0;
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number>(calcInitialCountdown);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedText, setEditedText] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isSendingNow, setIsSendingNow] = useState<boolean>(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [isRetryingManual, setIsRetryingManual] = useState<boolean>(false);

  // Fases e Stepper Cognitivo
  const phase = activity?.phase;
  const isFailed = phase === "failed" || state.status === "failed";
  const isRetryExhausted =
    isFailed &&
    (state.lastError === "technical_retry_exhausted" ||
      copy.title.toLowerCase().includes("esgotadas") ||
      Boolean(state.cycleEvents?.some((e) => e.event === "technical_retry_exhausted")) ||
      (activity?.phase === "failed" && Boolean(activity?.label?.toLowerCase().includes("esgotadas"))));

  // Pensamento/raciocínio único do Brain (com tolerância a chaves legadas preservadas no histórico)
  const rawBrainThought =
    activity?.brainThought ||
    activity?.atriaThought ||
    activity?.solThought ||
    (!isFailed
      ? state.lastThoughts?.brainThought ||
        state.lastThoughts?.atriaThought ||
        state.lastThoughts?.solThought
      : undefined);
  const validBrainThought = getValidThought(rawBrainThought);
  const hasThoughts = Boolean(validBrainThought);
  const isCompleted = phase === "completed" || (!isAutoPilotActivelyWorking(state) && hasThoughts);

  const isBrainActive =
    phase === "brain" ||
    phase === "atria" ||
    phase === "context" ||
    phase === "sol" ||
    (phase as string) === "search" ||
    (phase as string) === "analyzing" ||
    (phase as string) === "reanalyzing";

  const isTypingOrSending = phase === "typing" || phase === "sending";
  const isSendingDone = isCompleted;
  const isBrainDone = isCompleted || (!isBrainActive && (Boolean(validBrainThought) || isTypingOrSending));

  const isWorking = isAutoPilotWorking(state);
  const isActivelyThinking = isBrainActive || (phase as string) === "search";

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
      (currentPhase && currentPhase !== lastPhaseRef.current && ["brain", "atria", "sol", "search", "typing"].includes(currentPhase)) ||
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
      if (state.scheduledResponseAt && (state.status === "waiting_delay" || activity?.phase === "waiting")) {
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
        body: JSON.stringify({ conversationId: targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success === true && data.isEnabled === false) {
        toast.success("Ação cancelada. IA desativada.");
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
      const res = await fetch(getApiUrl("/api/autopilot/retry-once"), {
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

  if (!shouldRender) return null;

  // VARIANTE INBOX (Lista de conversas - limpa e elegante)
  if (variant === "inbox") {
    return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px] font-semibold", state.isEnabled ? "text-emerald-400" : "text-zinc-500")}>
      <ActivityIcon state={state} className="h-3 w-3 shrink-0" />
        <span className="truncate">{state.scheduledResponseAt && remainingSeconds > 0 ? `IA responde em ${remainingSeconds}s` : remainingSeconds === 0 && (state.status === "waiting_delay" || activity?.phase === "waiting") ? "IA iniciando..." : copy.title}</span>
        {state.isEnabled && isWorking && <TypingDots compact />}
      </span>
    );
  }

  // VARIANTE BANNER (Topo estático opcional)
  if (variant === "banner") {
    return (
      <div className="mx-1 mb-2 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-cyan-950/30 to-slate-900/50 p-2.5 text-emerald-100 shadow-md backdrop-blur-md transition-all duration-300">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15">
              <ActivityIcon state={state} className="h-4 w-4 text-emerald-400" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-200">
                <span>{copy.title}</span>
                <TypingDots compact />
              </div>
              <p className="truncate text-[10px] text-zinc-400">{copy.detail}</p>
            </div>
          </div>

          {(hasThoughts || isActivelyThinking) && (
            <button
              type="button"
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all cursor-pointer shrink-0"
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
    <div className="w-full select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="rounded-2xl border border-zinc-800/90 bg-[#0d0d11]/95 shadow-2xl shadow-black/90 backdrop-blur-2xl p-3 text-zinc-100 transition-all duration-300">
        
        {/* Cabeçalho do HUD Flutuante */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                isBrainActive
                  ? "bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-sm shadow-purple-500/20"
                  : isTypingOrSending
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/20"
                  : isCompleted
                  ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                  : "bg-zinc-800/80 border-zinc-700 text-zinc-400"
              )}
            >
              <ActivityIcon state={state} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-100 truncate">
                  {copy.title}
                </span>
                {!isCompleted && isWorking && <TypingDots compact />}
              </div>
              <p className="text-[10px] text-zinc-400 truncate">
                {copy.detail}
              </p>
            </div>
          </div>

          {/* Badges de Contagem & Controles Rápidos */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isEditing ? (
              <span className="font-mono text-[10px] font-bold text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-500/40 animate-pulse flex items-center gap-1">
                <Pause className="h-2.5 w-2.5" />
                <span>Pausado p/ edição</span>
              </span>
            ) : remainingSeconds > 0 && (
              <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/40 animate-pulse">
                {remainingSeconds >= 60
                  ? `${Math.floor(remainingSeconds / 60)}m ${String(remainingSeconds % 60).padStart(2, "0")}s`
                  : `${remainingSeconds}s`}
              </span>
            )}

            {/* Botão Tentar Mais Uma Vez (quando tentativas esgotadas) */}
            {isRetryExhausted && (
              <button
                type="button"
                onClick={handleManualRetryOnce}
                disabled={isRetryingManual}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
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
                    <span className="hidden sm:inline">Tentar mais uma vez</span>
                  </>
                )}
              </button>
            )}

            {/* Botão Responder Já (quando aguardando debounce de tempo) */}
            {(state.status === "waiting_delay" || activity?.phase === "waiting") && (
              <button
                type="button"
                onClick={handleSendNow}
                disabled={isSendingNow}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Ignorar o tempo de espera e responder agora"
              >
                <FastForward className="h-3 w-3" />
                <span className="hidden sm:inline">Responder Já</span>
              </button>
            )}

            {/* Cancelamento operacional: desativa a IA do chat e invalida o ciclo */}
            {isWorking && (
              <button
                type="button"
                onClick={handleCancelAction}
                disabled={isCancelling}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                title="Cancelar ação e desativar a IA neste chat"
              >
                <StopCircle className="h-3 w-3" />
                <span className="hidden sm:inline">{isCancelling ? "Cancelando..." : "Cancelar ação"}</span>
              </button>
            )}

            <button type="button" onClick={() => setIsConsoleOpen(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300 text-[10px] hover:bg-zinc-800" title="Abrir console operacional">
              <Maximize2 className="h-3 w-3" />
              <span className="hidden sm:inline">Abrir console</span>
            </button>

            {/* Botão Alternar Raciocínio (Estilo Antigravity) */}
            {shouldShowReasoningSection && (
              <button
                type="button"
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold active:scale-95 transition-all cursor-pointer border",
                  isThinkingExpanded
                    ? "bg-zinc-800/80 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                    : "bg-purple-500/15 text-purple-300 border-purple-500/35 hover:bg-purple-500/25"
                )}
                title="Alternar visão de raciocínio do Brain"
              >
                <BrainCircuit className="h-3 w-3 text-purple-400" />
                <span>{isThinkingExpanded ? "Recolher" : "Raciocínio"}</span>
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
        {isWorking && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/50 rounded-xl border border-zinc-800/70 mt-2.5 text-[10px]">
            {/* Etapa 1: Brain */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg font-medium transition-all text-center truncate",
                isBrainActive
                  ? "bg-purple-500/20 text-purple-200 border border-purple-500/50 font-bold animate-pulse"
                  : isBrainDone
                  ? "bg-purple-500/10 text-purple-300 border border-purple-500/25"
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
                isTypingOrSending
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/50 font-bold animate-pulse"
                  : isSendingDone
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                  : "text-zinc-500"
              )}
            >
              <Send className="h-3 w-3 shrink-0" />
              <span className="truncate">2. Envio</span>
              {isSendingDone && !isTypingOrSending && (
                <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0 ml-0.5" />
              )}
            </div>
          </div>
        )}

        {/* Prévia da Mensagem e Cadência de Digitação */}
        {isTypingOrSending && currentPreview && (
          <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80">
            <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px] font-semibold text-zinc-400">
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
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-emerald-500/30 text-emerald-300 text-xs">
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
                  className="w-full rounded-xl bg-black border border-cyan-500/50 p-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none min-h-[55px]"
                  placeholder="Edite a resposta aqui antes do envio..."
                  rows={2}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-[10px] hover:bg-zinc-700 active:scale-95 cursor-pointer flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    <span>Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] active:scale-95 cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <Check className="h-3 w-3" />
                    <span>Salvar Edição</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800/90 text-xs text-zinc-200 leading-relaxed font-normal whitespace-pre-wrap select-text">
                {currentPreview}
              </div>
            )}
          </div>
        )}

        {/* Pensamento Reativo do Brain (Estilo Antigravity) */}
        {shouldShowReasoningSection && isThinkingExpanded && (
          <div className="mt-2.5 space-y-2 border-t border-zinc-800/80 pt-2.5 text-xs animate-in fade-in duration-200">
            {/* Bloco Brain (Raciocínio & Decisão) */}
            {(isBrainActive || validBrainThought) && (
              <div
                className={cn(
                  "rounded-xl border p-2.5 transition-all duration-200",
                  isBrainActive
                    ? "border-purple-500/40 bg-purple-950/20 shadow-inner"
                    : "border-purple-500/25 bg-purple-950/15"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-purple-300 text-[10px] uppercase tracking-wider">
                    <BrainCircuit className="h-3.5 w-3.5 text-purple-400" />
                    <span>Brain • Raciocínio & Decisão</span>
                  </div>
                  {isBrainActive ? (
                    <span className="text-[9px] font-semibold text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse">
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
                    className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto pr-1 select-text scrollbar-thin scrollbar-thumb-zinc-700"
                  >
                    {validBrainThought}
                    {isBrainActive && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-purple-400 animate-pulse align-middle rounded-sm" />
                    )}
                  </div>
                ) : isBrainActive ? (
                  <p className="text-[11px] leading-relaxed text-purple-200/80 italic">
                    {phase === "search" ? (
                      <span className="flex items-center gap-1 text-purple-300">
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
      {isConsoleOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm p-2 sm:p-6" role="dialog" aria-modal="true">
          <div className="h-full w-full rounded-2xl border border-zinc-700 bg-[#0b0b0f] text-zinc-100 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0"><div className="text-sm font-bold truncate">Brain • Console operacional</div><div className="text-[10px] text-zinc-500 font-mono">{(state.cycleId || state.activeCycleToken || "sem ciclo").slice(0, 28)} • {state.status}</div></div>
              <button type="button" onClick={() => setIsConsoleOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {isRetryExhausted && (
              <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="text-[11px] text-amber-200">
                  <span className="font-semibold">Tentativas técnicas esgotadas:</span> Você pode autorizar uma única tentativa manual para este lote.
                </div>
                <button
                  type="button"
                  onClick={handleManualRetryOnce}
                  disabled={isRetryingManual}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {isRetryingManual ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Tentando novamente...</span>
                    </>
                  ) : (
                    <>
                      <FastForward className="h-3.5 w-3.5" />
                      <span>Tentar mais uma vez</span>
                    </>
                  )}
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px]">
              {(state.cycleEvents || []).map((event) => <ConsoleCycleEventCard key={`${event.cycleId}-${event.sequence}`} event={event} />)}
              {(!state.cycleEvents || state.cycleEvents.length === 0) && <div className="text-zinc-500">Nenhum evento operacional persistido neste ciclo.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
