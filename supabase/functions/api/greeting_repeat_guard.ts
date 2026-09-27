export const GREETING_REPEAT_WINDOW_MINUTES = 90;
export const GREETING_TIME_ZONE = "America/Sao_Paulo";

export type GreetingType = "oi" | "bom_dia" | "boa_tarde" | "boa_noite";

export interface ConfirmedLarissaOutbound {
  text: string;
  timestamp: string;
  status: string;
}

export interface RecentGreetingState {
  larissaAlreadyGreeted: boolean;
  greetingType: GreetingType | null;
  greetedAt: string | null;
  minutesAgo: number | null;
  sameConversationWindow: boolean;
  greetingPeriodChanged: boolean;
  lastConfirmedTurnAskedWellbeing: boolean;
  lastConfirmedLarissaTurn: string[];
}

export interface GreetingRepeatGuardResult {
  blocked: boolean;
  greetingType: GreetingType | null;
  code: "GREETING_REPEAT_GUARD" | null;
}

const CONFIRMED_STATUSES = new Set(["sent", "delivered"]);
const GREETING_PREFIX = /^(oi+e*|oie+|ola+|bom\s+dia+|boa\s+tarde+|boa\s+noite+)(?=$|[\s,.!?;:])/i;

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeGreetingPrefix(value: string): GreetingType | null {
  const normalized = normalizeText(value);
  const match = normalized.match(GREETING_PREFIX);
  if (!match) return null;
  const prefix = match[1].replace(/\s+/g, " ");
  if (prefix.startsWith("bom dia")) return "bom_dia";
  if (prefix.startsWith("boa tarde")) return "boa_tarde";
  if (prefix.startsWith("boa noite")) return "boa_noite";
  return "oi";
}

function localSocialPeriod(value: string): "morning" | "afternoon" | "night" | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GREETING_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!Number.isFinite(hour)) return null;
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "night";
}

function localCalendarDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GREETING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
}

function hasWellbeingQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return /\b(?:tudo bem|ta bem|como (?:vc|voce|c|ce) ta|tudo certo)\b/.test(normalized);
}

function inboundAnswersWellbeing(inboundMessages: string[]): boolean {
  const normalized = normalizeText(inboundMessages.join(" "));
  return /\b(?:to|estou|ta|tudo)\s+(?:bem|otim[oa]|tranquil[oa])\b/.test(normalized)
    && /\be\s+(?:vc|voce)\b/.test(normalized);
}

export function deriveRecentGreetingState(params: {
  confirmedOutbounds: ConfirmedLarissaOutbound[];
  referenceAt: string | null | undefined;
  inboundMessages?: string[];
  confirmedLastTurn?: string[];
}): RecentGreetingState {
  const referenceDate = new Date(String(params.referenceAt || ""));
  const eligible = (params.confirmedOutbounds || [])
    .filter((outbound) => CONFIRMED_STATUSES.has(String(outbound.status || "").toLowerCase()))
    .map((outbound) => ({ ...outbound, timestamp: String(outbound.timestamp || "") }))
    .filter((outbound) => Number.isFinite(new Date(outbound.timestamp).getTime()))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  const recentGreeting = eligible.find((outbound) => normalizeGreetingPrefix(outbound.text));
  let minutesAgo: number | null = null;
  let sameConversationWindow = false;
  let greetingPeriodChanged = false;
  let greetingType: GreetingType | null = null;
  let greetedAt: string | null = null;
  if (recentGreeting && Number.isFinite(referenceDate.getTime())) {
    minutesAgo = Math.max(0, Math.floor((referenceDate.getTime() - Date.parse(recentGreeting.timestamp)) / 60_000));
    const greetingPeriod = localSocialPeriod(recentGreeting.timestamp);
    const currentPeriod = localSocialPeriod(referenceDate.toISOString());
    greetingPeriodChanged = Boolean(greetingPeriod && currentPeriod && greetingPeriod !== currentPeriod);
    sameConversationWindow = minutesAgo <= GREETING_REPEAT_WINDOW_MINUTES
      && localCalendarDate(recentGreeting.timestamp) === localCalendarDate(referenceDate.toISOString());
    if (sameConversationWindow) {
      greetingType = normalizeGreetingPrefix(recentGreeting.text);
      greetedAt = recentGreeting.timestamp;
    }
  }

  const lastConfirmedLarissaTurn = (params.confirmedLastTurn || [])
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  const lastConfirmedTurnAskedWellbeing = (lastConfirmedLarissaTurn.length > 0
    ? lastConfirmedLarissaTurn
    : eligible.slice(0, 4).map((outbound) => outbound.text))
    .some(hasWellbeingQuestion);
  const wellbeingAnswered = Boolean(params.inboundMessages?.length)
    && inboundAnswersWellbeing(params.inboundMessages || []);

  return {
    larissaAlreadyGreeted: sameConversationWindow,
    greetingType,
    greetedAt,
    minutesAgo: sameConversationWindow ? minutesAgo : null,
    sameConversationWindow,
    greetingPeriodChanged,
    lastConfirmedTurnAskedWellbeing: lastConfirmedTurnAskedWellbeing && wellbeingAnswered,
    lastConfirmedLarissaTurn,
  };
}

export function shouldRequireGreetingReciprocity(state: RecentGreetingState | null | undefined): boolean {
  return !state?.larissaAlreadyGreeted;
}

export function detectGreetingRepeat(params: {
  candidateBalloons: string[];
  state: RecentGreetingState | null | undefined;
}): GreetingRepeatGuardResult {
  if (!params.state?.larissaAlreadyGreeted) {
    return { blocked: false, greetingType: null, code: null };
  }
  for (const balloon of params.candidateBalloons || []) {
    const greetingType = normalizeGreetingPrefix(balloon);
    if (greetingType) {
      return { blocked: true, greetingType, code: "GREETING_REPEAT_GUARD" };
    }
  }
  return { blocked: false, greetingType: null, code: null };
}

export function formatRecentGreetingStateForPrompt(state: RecentGreetingState): string {
  return [
    "[SAUDAÇÃO JÁ FEITA NESTA TROCA]",
    `larissaAlreadyGreeted=${state.larissaAlreadyGreeted ? "true" : "false"}`,
    `greetingType=${state.greetingType || "nenhum"}`,
    `greetedAt=${state.greetedAt || "indisponível"}`,
    `minutesAgo=${state.minutesAgo ?? "indisponível"}`,
    `sameConversationWindow=${state.sameConversationWindow ? "true" : "false"}`,
    `greetingPeriodChanged=${state.greetingPeriodChanged ? "true" : "false"}`,
    `wellbeingAlreadyExchanged=${state.lastConfirmedTurnAskedWellbeing ? "true" : "false"}`,
    "ÚLTIMA FALA CONFIRMADA DA LARISSA:",
    ...(state.lastConfirmedLarissaTurn.length > 0
      ? state.lastConfirmedLarissaTurn.map((text) => `"${text.slice(0, 400)}"`)
      : ["[indisponível]"]),
    "Se já cumprimentou nesta troca, não repita o cumprimento nem repita pergunta de bem-estar já respondida. Trate a saudação espelhada do pretendente como acknowledgement social e responda ao delta novo substantivo do lote.",
  ].join("\n");
}
