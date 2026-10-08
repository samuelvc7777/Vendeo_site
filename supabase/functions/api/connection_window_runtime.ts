export type ConnectionWindowCandidateType = "topic" | "question" | "story" | "audio" | "photo" | "video";
export type ArsenalRoutineContext =
  | "memory"
  | "weekday_home_morning"
  | "internship"
  | "college"
  | "weekday_home_evening"
  | "weekend_home"
  | "weekend_outing"
  | "specific_moment";

export interface ConnectionWindowArsenalCandidate {
  itemId: string;
  type: ConnectionWindowCandidateType;
  title: string;
  description?: string | null;
  semanticContent?: string | null;
  usageInstruction?: string | null;
  socialFunction?: string | null;
  assetId?: string | null;
  mediaUrl?: string | null;
  whatsappMediaUrl?: string | null;
  transcript?: string | null;
  visualDescription?: string | null;
  routineContext?: ArsenalRoutineContext | null;
  validityType: "evergreen" | "recurring" | "moment";
  priority: number;
  maxUsesPerConversation?: number | null;
  sentUseCount: number;
  lastUsedAt?: string | null;
}

export interface ConnectionWindowTemporalPhase {
  id: string;
  label: string;
  fromPercent: number;
  toPercent: number;
  guidance: string;
}

export interface ConnectionWindowFinalActionRuntime {
  type: "send_audio";
  assetId: string;
  title?: string | null;
  transcript?: string | null;
  usageInstruction?: string | null;
  required: true;
  opportunityRequired: true;
  activationThresholdPercent: number;
  persistedStatus?: string | null;
  effectiveStatus: "pending" | "available" | "delivered" | "manual_required" | "failed";
  availableNow: boolean;
  deliveredAt?: string | null;
  providerMessageId?: string | null;
}

const DEFAULT_PHASES: ConnectionWindowTemporalPhase[] = [
  {
    id: "opening",
    label: "Início",
    fromPercent: 0,
    toPercent: 30,
    guidance: "Retomar proximidade e conversa leve sem forçar recursos.",
  },
  {
    id: "middle",
    label: "Meio",
    fromPercent: 30,
    toPercent: 75,
    guidance: "Manter conexão, aprofundar assuntos e usar o arsenal apenas quando encaixar naturalmente.",
  },
  {
    id: "closing",
    label: "Fechamento",
    fromPercent: 75,
    toPercent: 100,
    guidance: "Preservar naturalidade e procurar oportunidade real para a ação final.",
  },
];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function computeScheduleElapsedPercent(params: {
  startedAt?: string | null;
  expiresAt?: string | null;
  durationMinutes?: number | null;
  now?: Date;
}): number {
  const nowMs = (params.now || new Date()).getTime();
  const startMs = params.startedAt ? new Date(params.startedAt).getTime() : NaN;
  let totalMs = params.durationMinutes && params.durationMinutes > 0
    ? params.durationMinutes * 60_000
    : NaN;
  if (!Number.isFinite(totalMs) && params.expiresAt && Number.isFinite(startMs)) {
    totalMs = new Date(params.expiresAt).getTime() - startMs;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return clampPercent(((nowMs - startMs) / totalMs) * 100);
}

export function resolveTemporalPhase(
  rawPhases: unknown,
  elapsedPercent: number,
): ConnectionWindowTemporalPhase {
  const phases = (Array.isArray(rawPhases) ? rawPhases : [])
    .map((phase: any) => ({
      id: String(phase?.id || ""),
      label: String(phase?.label || ""),
      fromPercent: Number(phase?.fromPercent ?? phase?.from_percent ?? 0),
      toPercent: Number(phase?.toPercent ?? phase?.to_percent ?? 100),
      guidance: String(phase?.guidance || ""),
    }))
    .filter((phase) =>
      phase.id &&
      Number.isFinite(phase.fromPercent) &&
      Number.isFinite(phase.toPercent) &&
      phase.toPercent >= phase.fromPercent
    );

  const catalog = phases.length ? phases : DEFAULT_PHASES;
  const pct = clampPercent(elapsedPercent);
  return catalog.find((phase, index) =>
    pct >= phase.fromPercent &&
    (pct < phase.toPercent || (index === catalog.length - 1 && pct <= phase.toPercent))
  ) || catalog[catalog.length - 1];
}

function localDateParts(date: Date, timezone: string) {
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { weekday: weekdayMap[weekdayShort] ?? 0, time };
}

function recurringRuleAllowsNow(rules: any, now: Date): boolean {
  if (!rules || typeof rules !== "object") return true;
  const timezone = typeof rules.timezone === "string" && rules.timezone
    ? rules.timezone
    : "America/Sao_Paulo";
  const local = localDateParts(now, timezone);
  const weekdays = Array.isArray(rules.weekdays)
    ? rules.weekdays.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6)
    : [];
  if (weekdays.length && !weekdays.includes(local.weekday)) return false;

  const start = typeof rules.startTime === "string" ? rules.startTime : "";
  const end = typeof rules.endTime === "string" ? rules.endTime : "";
  if (!start || !end) return true;
  if (start <= end) return local.time >= start && local.time <= end;
  return local.time >= start || local.time <= end;
}

function routineContextAllowsNow(context: unknown, now: Date): boolean {
  const value = String(context || "");
  if (!value || value === "memory") return true;
  if (value === "specific_moment") return true; // a validade moment já restringe a data e o horário.

  const local = localDateParts(now, "America/Sao_Paulo");
  const weekdays = new Set([1, 2, 3, 4, 5]);
  const weekdayRoutine = weekdays.has(local.weekday);
  const inRange = (start: string, end: string) => local.time >= start && local.time < end;

  switch (value) {
    case "weekday_home_morning":
      return weekdayRoutine && inRange("06:00", "11:00");
    case "internship":
      return weekdayRoutine && inRange("12:00", "17:00");
    case "college":
      return weekdayRoutine && inRange("19:00", "22:00");
    case "weekday_home_evening":
      return weekdayRoutine && inRange("22:00", "24:00");
    case "weekend_home":
      return local.weekday === 0 || local.weekday === 6;
    case "weekend_outing":
      return local.weekday === 0 || local.weekday === 6;
    default:
      return false;
  }
}

function validityAllowsNow(item: any, now: Date): boolean {
  const validity = String(item.validity_type || "evergreen");
  if (validity === "moment") {
    const nowMs = now.getTime();
    const fromMs = item.valid_from ? new Date(item.valid_from).getTime() : NaN;
    const untilMs = item.valid_until ? new Date(item.valid_until).getTime() : NaN;
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) return false;
    if (Number.isFinite(fromMs) && nowMs < fromMs) return false;
    if (Number.isFinite(untilMs) && nowMs > untilMs) return false;
    return true;
  }
  if (validity === "recurring") {
    return recurringRuleAllowsNow(item.recurring_rules, now);
  }
  return true;
}

export async function loadConnectionWindowArsenal(params: {
  supabase: any;
  conversationId: string;
  runId: string;
  scheduleId: string;
  now?: Date;
}): Promise<ConnectionWindowArsenalCandidate[]> {
  const now = params.now || new Date();
  const { data: rows, error } = await params.supabase
    .from("conversation_arsenal_items")
    .select("*")
    .eq("schedule_id", params.scheduleId)
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("connection_window_arsenal_unavailable:" + error.message);
  }
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return [];

  const { data: usageRows, error: usageError } = await params.supabase
    .from("conversation_arsenal_usage")
    .select("arsenal_item_id,status,used_at,created_at")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: false });

  if (usageError) {
    throw new Error("connection_window_usage_unavailable:" + usageError.message);
  }

  const usage = Array.isArray(usageRows) ? usageRows : [];
  const nowMs = now.getTime();

  return items.flatMap((item: any) => {
    if (!validityAllowsNow(item, now)) return [];
    const rules = item.recurring_rules && typeof item.recurring_rules === "object"
      ? item.recurring_rules
      : {};
    const routineContext = String(rules.routineContext || "");
    if ((item.item_type === "audio" || item.item_type === "photo" || item.item_type === "video") && !routineContext) return [];
    if (item.item_type === "video" && !String(item.visual_description || "").trim()) return [];
    if (routineContext === "specific_moment" && item.validity_type !== "moment") return [];
    if (!routineContextAllowsNow(routineContext, now)) return [];

    const sent = usage.filter((row: any) =>
      String(row.arsenal_item_id) === String(item.id) &&
      row.status === "sent"
    );
    const maxUses = item.max_uses_per_conversation == null
      ? null
      : Number(item.max_uses_per_conversation);
    if (maxUses != null && sent.length >= maxUses) return [];

    const lastUsedAt = sent
      .map((row: any) => row.used_at || row.created_at)
      .filter(Boolean)
      .map((value: string) => new Date(value))
      .filter((value: Date) => Number.isFinite(value.getTime()))
      .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];

    const cooldownMinutes = Math.max(0, Number(item.cooldown_minutes || 0));
    if (lastUsedAt && cooldownMinutes > 0) {
      const eligibleAt = lastUsedAt.getTime() + cooldownMinutes * 60_000;
      if (nowMs < eligibleAt) return [];
    }

    return [{
      itemId: String(item.id),
      type: String(item.item_type) as ConnectionWindowCandidateType,
      title: String(item.title || ""),
      description: item.description || null,
      semanticContent: item.semantic_content || null,
      usageInstruction: item.usage_instruction || null,
      socialFunction: item.social_function || null,
      assetId: item.asset_id || null,
      mediaUrl: item.media_url || null,
      whatsappMediaUrl: item.whatsapp_media_url || null,
      transcript: item.transcript || null,
      visualDescription: item.visual_description || null,
      routineContext: (routineContext || null) as ArsenalRoutineContext | null,
      validityType: String(item.validity_type || "evergreen") as "evergreen" | "recurring" | "moment",
      priority: Number(item.priority ?? 50),
      maxUsesPerConversation: maxUses,
      sentUseCount: sent.length,
      lastUsedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
    }];
  });
}

export function resolveFinalActionRuntime(params: {
  rawFinalAction: unknown;
  elapsedPercent: number;
  persistedStatus?: string | null;
  deliveredAt?: string | null;
  providerMessageId?: string | null;
}): ConnectionWindowFinalActionRuntime | null {
  const raw = params.rawFinalAction;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const action = raw as Record<string, any>;
  if (action.type !== "send_audio" || !String(action.assetId || "").trim()) return null;

  const threshold = clampPercent(Number(action.activationThresholdPercent ?? 75));
  const persisted = String(params.persistedStatus || "pending");
  const delivered = persisted === "delivered";
  const manual = persisted === "manual_required";
  const failed = persisted === "failed";
  const availableNow = !delivered && !manual && !failed && params.elapsedPercent >= threshold;
  const effectiveStatus: ConnectionWindowFinalActionRuntime["effectiveStatus"] =
    delivered ? "delivered" :
    manual ? "manual_required" :
    failed ? "failed" :
    availableNow ? "available" :
    "pending";

  return {
    type: "send_audio",
    assetId: String(action.assetId),
    title: action.title ? String(action.title) : null,
    required: true,
    opportunityRequired: true,
    activationThresholdPercent: threshold,
    persistedStatus: params.persistedStatus || null,
    effectiveStatus,
    availableNow,
    deliveredAt: params.deliveredAt || null,
    providerMessageId: params.providerMessageId || null,
  };
}
