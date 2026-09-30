import type { RaffleCommercialStatus } from "./RaffleStatus";

function normalizeReportStatus(value: unknown): RaffleCommercialStatus {
  return value === "offered" || value === "bought" || value === "not_bought"
    ? value
    : null;
}

export type RaffleReportPreset = "day" | "week" | "month" | "year" | "custom";
export type RaffleReportListFilter = "all" | "not_offered" | "offered" | "bought" | "not_bought";

export interface RaffleReportPerson {
  id: string;
  username: string;
  fullName: string;
  avatar?: string | null;
  raffleStatus: RaffleCommercialStatus;
  raffleStatusUpdatedAt?: string | null;
  finalizedAt?: string | null;
}

export interface RaffleCommercialEvent {
  id: string;
  conversationId: string;
  previousStatus: RaffleCommercialStatus;
  status: RaffleCommercialStatus;
  changedAt: string;
}

export interface RaffleReportSummary {
  totalFinalized: number;
  notOffered: number;
  offered: number;
  bought: number;
  notBought: number;
  offersReached: number;
  offerRate: number;
  purchaseRate: number;
  resolvedPurchaseRate: number;
}

export interface RaffleReportRange {
  start: Date;
  end: Date;
  label: string;
}

export interface RaffleReportSeriesPoint {
  key: string;
  label: string;
  offered: number;
  bought: number;
  notBought: number;
  total: number;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateInputToLocalStart(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveRaffleReportRange(
  preset: RaffleReportPreset,
  now = new Date(),
  customStart?: string,
  customEnd?: string,
): RaffleReportRange {
  const today = startOfLocalDay(now);

  if (preset === "day") {
    return { start: today, end: addDays(today, 1), label: "Hoje" };
  }

  if (preset === "week") {
    const day = today.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const start = addDays(today, -daysFromMonday);
    return { start, end: addDays(start, 7), label: "Esta semana" };
  }

  if (preset === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return {
      start,
      end,
      label: now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    };
  }

  if (preset === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear() + 1, 0, 1);
    return { start, end, label: String(today.getFullYear()) };
  }

  const start = dateInputToLocalStart(customStart || "") || today;
  const rawEnd = dateInputToLocalStart(customEnd || "") || start;
  const normalizedEnd = rawEnd.getTime() < start.getTime() ? start : rawEnd;
  return {
    start,
    end: addDays(normalizedEnd, 1),
    label: `${start.toLocaleDateString("pt-BR")} a ${normalizedEnd.toLocaleDateString("pt-BR")}`,
  };
}

export function summarizeRaffleReport(people: RaffleReportPerson[]): RaffleReportSummary {
  let notOffered = 0;
  let offered = 0;
  let bought = 0;
  let notBought = 0;

  for (const person of people) {
    const status = normalizeReportStatus(person.raffleStatus);
    if (status === "offered") offered += 1;
    else if (status === "bought") bought += 1;
    else if (status === "not_bought") notBought += 1;
    else notOffered += 1;
  }

  const totalFinalized = people.length;
  const offersReached = offered + bought + notBought;
  const resolved = bought + notBought;

  return {
    totalFinalized,
    notOffered,
    offered,
    bought,
    notBought,
    offersReached,
    offerRate: totalFinalized > 0 ? (offersReached / totalFinalized) * 100 : 0,
    purchaseRate: offersReached > 0 ? (bought / offersReached) * 100 : 0,
    resolvedPurchaseRate: resolved > 0 ? (bought / resolved) * 100 : 0,
  };
}

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildRaffleReportSeries(
  events: RaffleCommercialEvent[],
  range: RaffleReportRange,
): RaffleReportSeriesPoint[] {
  const durationDays = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  const monthly = durationDays > 62;
  const buckets = new Map<string, RaffleReportSeriesPoint>();

  if (monthly) {
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    while (cursor.getTime() < range.end.getTime()) {
      const key = monthKey(cursor);
      buckets.set(key, {
        key,
        label: cursor.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        offered: 0,
        bought: 0,
        notBought: 0,
        total: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    let cursor = startOfLocalDay(range.start);
    while (cursor.getTime() < range.end.getTime()) {
      const key = dateKey(cursor);
      buckets.set(key, {
        key,
        label: cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        offered: 0,
        bought: 0,
        notBought: 0,
        total: 0,
      });
      cursor = addDays(cursor, 1);
    }
  }

  for (const event of events) {
    const changedAt = new Date(event.changedAt);
    if (!Number.isFinite(changedAt.getTime())) continue;
    const key = monthly ? monthKey(changedAt) : dateKey(changedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    if (event.status === "offered") bucket.offered += 1;
    else if (event.status === "bought") bucket.bought += 1;
    else if (event.status === "not_bought") bucket.notBought += 1;
    else continue;
    bucket.total += 1;
  }

  return Array.from(buckets.values());
}

export function personMatchesRaffleFilter(
  person: RaffleReportPerson,
  filter: RaffleReportListFilter,
): boolean {
  if (filter === "all") return true;
  const status = normalizeReportStatus(person.raffleStatus);
  if (filter === "not_offered") return status === null;
  return status === filter;
}
