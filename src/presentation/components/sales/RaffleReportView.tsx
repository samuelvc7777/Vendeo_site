"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Target,
  TrendingUp,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
import {
  RaffleCommercialStatus,
  normalizeRaffleCommercialStatus,
  raffleCommercialStatusLabel,
} from "@/domain/entities/RaffleStatus";
import {
  RaffleCommercialEvent,
  RaffleReportListFilter,
  RaffleReportPerson,
  RaffleReportPreset,
  buildRaffleReportSeries,
  formatDateInputValue,
  personMatchesRaffleFilter,
  resolveRaffleReportRange,
  summarizeRaffleReport,
} from "@/domain/entities/RaffleReport";

interface ReportPayload {
  success: boolean;
  startAt: string;
  endAt: string;
  people: RaffleReportPerson[];
  events: RaffleCommercialEvent[];
}

function statusTone(status: RaffleCommercialStatus) {
  if (status === "bought") {
    return "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "offered") {
    return "border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300";
  }
  if (status === "not_bought") {
    return "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300";
}

function formatMoment(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RaffleReportView() {
  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<RaffleReportPreset>("month");
  const [customStart, setCustomStart] = useState(() =>
    formatDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1))
  );
  const [customEnd, setCustomEnd] = useState(() => formatDateInputValue(today));
  const [people, setPeople] = useState<RaffleReportPerson[]>([]);
  const [events, setEvents] = useState<RaffleCommercialEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingConversationId, setUpdatingConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<RaffleReportListFilter>("all");

  const range = useMemo(
    () => resolveRaffleReportRange(preset, today, customStart, customEnd),
    [customEnd, customStart, preset, today],
  );
  const startAt = range.start.toISOString();
  const endAt = range.end.toISOString();

  const loadReport = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const response = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "raffle_report",
          startAt,
          endAt,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as Partial<ReportPayload> & { error?: string };
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Não foi possível carregar o relatório.");
      }

      setPeople(
        (Array.isArray(result.people) ? result.people : []).map((person) => ({
          ...person,
          raffleStatus: normalizeRaffleCommercialStatus(person.raffleStatus),
        }))
      );
      setEvents(
        (Array.isArray(result.events) ? result.events : []).map((event) => ({
          ...event,
          previousStatus: normalizeRaffleCommercialStatus(event.previousStatus),
          status: normalizeRaffleCommercialStatus(event.status),
        }))
      );
    } catch (error: any) {
      console.error("[Raffle Report] Falha:", error);
      toast.error(error?.message || "Não foi possível carregar o relatório.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [endAt, startAt]);

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  const summary = useMemo(() => summarizeRaffleReport(people), [people]);
  const series = useMemo(() => buildRaffleReportSeries(events, range), [events, range]);
  const maxSeriesValue = useMemo(
    () => Math.max(1, ...series.flatMap((point) => [point.offered, point.bought, point.notBought])),
    [series],
  );

  const visiblePeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return people.filter((person) => {
      if (!personMatchesRaffleFilter(person, listFilter)) return false;
      if (!query) return true;
      return (
        String(person.fullName || "").toLowerCase().includes(query) ||
        String(person.username || "").toLowerCase().includes(query)
      );
    });
  }, [listFilter, people, search]);

  const updateStatus = useCallback(async (
    person: RaffleReportPerson,
    nextStatus: RaffleCommercialStatus,
  ) => {
    if (updatingConversationId) return;
    const previousStatus = person.raffleStatus;
    setUpdatingConversationId(person.id);
    setPeople((current) =>
      current.map((item) =>
        item.id === person.id ? { ...item, raffleStatus: nextStatus } : item
      )
    );

    try {
      const response = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "raffle_status",
          conversationId: person.id,
          raffleStatus: nextStatus,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Não foi possível alterar o status.");
      }
      toast.success(`${person.fullName || person.username}: ${raffleCommercialStatusLabel(nextStatus)}`);
      await loadReport(true);
    } catch (error: any) {
      setPeople((current) =>
        current.map((item) =>
          item.id === person.id ? { ...item, raffleStatus: previousStatus } : item
        )
      );
      toast.error(error?.message || "Não foi possível alterar o status.");
    } finally {
      setUpdatingConversationId(null);
    }
  }, [loadReport, updatingConversationId]);

  const cards = [
    {
      label: "Finalizados",
      value: summary.totalFinalized,
      detail: "chats no período",
      icon: Users,
      tone: "border-violet-500/20 bg-violet-500/8 text-violet-700 dark:text-violet-300",
    },
    {
      label: "Não oferecido",
      value: summary.notOffered,
      detail: "ainda sem oferta",
      icon: Clock3,
      tone: "border-zinc-300/70 bg-zinc-100/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    },
    {
      label: "Oferecido",
      value: summary.offered,
      detail: "aguardando decisão",
      icon: Sparkles,
      tone: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300",
    },
    {
      label: "Comprou",
      value: summary.bought,
      detail: "conversões",
      icon: UserRoundCheck,
      tone: "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Não comprou",
      value: summary.notBought,
      detail: "ofertas recusadas",
      icon: UserRoundX,
      tone: "border-rose-500/20 bg-rose-500/8 text-rose-700 dark:text-rose-300",
    },
    {
      label: "Alcance da oferta",
      value: `${summary.offerRate.toFixed(1).replace(".", ",")}%`,
      detail: `${summary.offersReached} de ${summary.totalFinalized}`,
      icon: Target,
      tone: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
  ];

  const listFilters: Array<{ value: RaffleReportListFilter; label: string; count: number }> = [
    { value: "all", label: "Todos", count: summary.totalFinalized },
    { value: "not_offered", label: "Não oferecido", count: summary.notOffered },
    { value: "offered", label: "Oferecido", count: summary.offered },
    { value: "bought", label: "Comprou", count: summary.bought },
    { value: "not_bought", label: "Não comprou", count: summary.notBought },
  ];

  const presetOptions: Array<{ value: RaffleReportPreset; label: string }> = [
    { value: "day", label: "Hoje" },
    { value: "week", label: "Semana" },
    { value: "month", label: "Mês" },
    { value: "year", label: "Ano" },
    { value: "custom", label: "Personalizado" },
  ];

  return (
    <div className="pb-28">
      <section className="px-3 sm:px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl border border-zinc-200 dark:border-[#232d3d] bg-white dark:bg-[#0d1016] shadow-sm">
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-amber-400/20 via-orange-400/8 to-transparent pointer-events-none" />
          <div className="relative p-4 sm:p-5">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Relatório comercial
                </div>
                <h2 className="mt-2 text-xl sm:text-2xl font-black tracking-tight text-zinc-950 dark:text-white">
                  Funil da rifa
                </h2>
                <p className="mt-1 max-w-xl text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                  Acompanhe quem recebeu a oferta, quem decidiu e como as conversões evoluem ao longo do tempo.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadReport(true)}
                disabled={isRefreshing}
                className="self-start lg:self-auto inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 px-3 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-5 gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/90 dark:bg-black/30 p-1">
              {presetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPreset(option.value)}
                  className={`min-w-0 rounded-xl px-1.5 sm:px-3 py-2 text-[10px] sm:text-xs font-bold transition-all ${
                    preset === option.value
                      ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {preset === "custom" && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 p-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">De</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-amber-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Até</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-amber-500"
                  />
                </label>
                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    <CalendarRange className="inline w-3.5 h-3.5 mr-1.5" />
                    {range.label}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Período: <strong className="text-zinc-700 dark:text-zinc-200">{range.label}</strong></span>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-zinc-500">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <p className="text-xs font-semibold">Montando relatório...</p>
        </div>
      ) : (
        <>
          <section className="px-3 sm:px-4 mt-3 grid grid-cols-2 xl:grid-cols-3 gap-2.5">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`rounded-2xl border p-3.5 sm:p-4 ${card.tone}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wide opacity-80">
                      {card.label}
                    </span>
                    <Icon className="w-4 h-4 shrink-0 opacity-80" />
                  </div>
                  <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">
                    {card.value}
                  </div>
                  <div className="mt-0.5 text-[10px] sm:text-[11px] font-semibold opacity-70">
                    {card.detail}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="px-3 sm:px-4 mt-3">
            <div className="rounded-3xl border border-zinc-200 dark:border-[#232d3d] bg-white dark:bg-[#0d1016] p-4 sm:p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-amber-500" />
                    <h3 className="text-sm font-black text-zinc-950 dark:text-white">Performance do período</h3>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Alcance e conversão calculados sobre as pessoas finalizadas no intervalo.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 min-w-[240px]">
                  <div className="rounded-xl bg-zinc-100 dark:bg-zinc-900 px-3 py-2">
                    <p className="text-[9px] uppercase font-black tracking-wide text-zinc-500">Compra / ofertas</p>
                    <p className="text-lg font-black text-zinc-900 dark:text-white">
                      {summary.purchaseRate.toFixed(1).replace(".", ",")}%
                    </p>
                  </div>
                  <div className="rounded-xl bg-zinc-100 dark:bg-zinc-900 px-3 py-2">
                    <p className="text-[9px] uppercase font-black tracking-wide text-zinc-500">Compra / decididos</p>
                    <p className="text-lg font-black text-zinc-900 dark:text-white">
                      {summary.resolvedPurchaseRate.toFixed(1).replace(".", ",")}%
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-500">
                  <span>Alcance da oferta</span>
                  <span>{summary.offersReached}/{summary.totalFinalized}</span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, summary.offerRate)}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="px-3 sm:px-4 mt-3">
            <div className="rounded-3xl border border-zinc-200 dark:border-[#232d3d] bg-white dark:bg-[#0d1016] p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-black text-zinc-950 dark:text-white">Movimentações comerciais</h3>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                    Cada mudança fica registrada. Se alguém passa de Oferecido para Comprou, os dois acontecimentos permanecem no histórico.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-sky-600 dark:text-sky-300"><i className="w-2 h-2 rounded-full bg-sky-500" />Oferecido</span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300"><i className="w-2 h-2 rounded-full bg-emerald-500" />Comprou</span>
                  <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-300"><i className="w-2 h-2 rounded-full bg-rose-500" />Não comprou</span>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto no-scrollbar">
                <div className="h-52 min-w-max flex items-end gap-2 sm:gap-3 border-b border-zinc-200 dark:border-zinc-800 px-1">
                  {series.map((point) => (
                    <div key={point.key} className="w-10 sm:w-12 h-full flex flex-col justify-end items-center gap-1.5">
                      <div className="w-full flex-1 flex items-end justify-center gap-1" title={`Oferecido: ${point.offered} • Comprou: ${point.bought} • Não comprou: ${point.notBought}`}>
                        <div
                          className="w-2.5 sm:w-3 rounded-t-md bg-sky-500/85 transition-all min-h-0"
                          style={{ height: point.offered ? `${Math.max(5, (point.offered / maxSeriesValue) * 100)}%` : "0%" }}
                        />
                        <div
                          className="w-2.5 sm:w-3 rounded-t-md bg-emerald-500/85 transition-all min-h-0"
                          style={{ height: point.bought ? `${Math.max(5, (point.bought / maxSeriesValue) * 100)}%` : "0%" }}
                        />
                        <div
                          className="w-2.5 sm:w-3 rounded-t-md bg-rose-500/85 transition-all min-h-0"
                          style={{ height: point.notBought ? `${Math.max(5, (point.notBought / maxSeriesValue) * 100)}%` : "0%" }}
                        />
                      </div>
                      <span className="h-5 text-[9px] font-semibold text-zinc-500 whitespace-nowrap">{point.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {events.length === 0 && (
                <div className="mt-3 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 py-3 text-center text-[11px] text-zinc-500">
                  Nenhuma movimentação comercial registrada neste período.
                </div>
              )}
            </div>
          </section>

          <section className="px-3 sm:px-4 mt-3">
            <div className="rounded-3xl border border-zinc-200 dark:border-[#232d3d] bg-white dark:bg-[#0d1016] overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-amber-500" />
                      <h3 className="text-sm font-black text-zinc-950 dark:text-white">Pessoas finalizadas</h3>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Controle o resultado da oferta direto pelo relatório.
                    </p>
                  </div>

                  <div className="relative w-full lg:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar nome ou @..."
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 pl-9 pr-3 py-2.5 text-xs text-zinc-900 dark:text-white outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {listFilters.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setListFilter(filter.value)}
                      className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-all ${
                        listFilter === filter.value
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-black"
                          : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                      }`}
                    >
                      {filter.label} <span className="opacity-60 ml-1">{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {visiblePeople.length === 0 ? (
                  <div className="py-14 px-4 text-center">
                    <Filter className="w-7 h-7 mx-auto text-zinc-300 dark:text-zinc-700" />
                    <p className="mt-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">Nenhuma pessoa neste filtro</p>
                    <p className="mt-1 text-[10px] text-zinc-400">Tente outro período, status ou busca.</p>
                  </div>
                ) : (
                  visiblePeople.map((person) => {
                    const status = normalizeRaffleCommercialStatus(person.raffleStatus);
                    const isUpdating = updatingConversationId === person.id;
                    return (
                      <div
                        key={person.id}
                        className="p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-zinc-50/80 dark:hover:bg-white/[0.025] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shrink-0 flex items-center justify-center">
                            {person.avatar ? (
                              <img src={person.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Users className="w-4 h-4 text-zinc-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="truncate text-xs sm:text-sm font-black text-zinc-900 dark:text-white">
                                {person.fullName || person.username || "Instagram"}
                              </p>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusTone(status)}`}>
                                {raffleCommercialStatusLabel(status)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                              {person.username && <span>@{person.username}</span>}
                              <span>Finalizado {formatMoment(person.finalizedAt)}</span>
                              {person.raffleStatusUpdatedAt && (
                                <span>• Rifa atualizada {formatMoment(person.raffleStatusUpdatedAt)}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 md:justify-end">
                          <select
                            value={status || ""}
                            disabled={Boolean(updatingConversationId)}
                            onChange={(event) => {
                              const nextStatus = normalizeRaffleCommercialStatus(event.target.value || null);
                              void updateStatus(person, nextStatus);
                            }}
                            className={`min-w-[150px] flex-1 md:flex-none rounded-xl border px-3 py-2 text-[11px] font-bold outline-none disabled:opacity-50 ${statusTone(status)}`}
                            aria-label={`Status da rifa de ${person.fullName || person.username}`}
                          >
                            <option value="">Não oferecido</option>
                            <option value="offered">Oferecido</option>
                            <option value="bought">Comprou</option>
                            <option value="not_bought">Não comprou</option>
                          </select>
                          <div className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-400">
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : status === "bought" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : status === "not_bought" ? (
                              <UserRoundX className="w-3.5 h-3.5 text-rose-500" />
                            ) : status === "offered" ? (
                              <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                            ) : (
                              <Clock3 className="w-3.5 h-3.5 text-zinc-400" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-3 bg-zinc-50/80 dark:bg-zinc-900/40 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{visiblePeople.length} exibido{visiblePeople.length === 1 ? "" : "s"}</span>
                <span>{summary.totalFinalized} finalizado{summary.totalFinalized === 1 ? "" : "s"} no período</span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
