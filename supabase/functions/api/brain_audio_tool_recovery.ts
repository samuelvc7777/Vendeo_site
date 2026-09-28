export const AUDIO_TOOL_RECOVERY_TTL_MS = 15 * 60 * 1000;

export interface RecoveredAudioToolCandidate {
  audioId: string;
  title: string;
  transcript: string;
  whenToUse: string;
  duration?: number;
}

export interface RecoveredAudioToolState {
  objectiveId: string;
  candidates: RecoveredAudioToolCandidate[];
  recoveredAt: string;
  sourceTurnId?: string | null;
  sourceCycleId?: string | null;
}

function normalizeCandidate(value: unknown): RecoveredAudioToolCandidate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const audioId = String(candidate.audioId || "").trim();
  const title = String(candidate.title || "").trim();
  const transcript = String(candidate.transcript || "").trim();
  const whenToUse = String(candidate.whenToUse || "").trim();
  if (!audioId || !title || !transcript) return null;
  return {
    audioId,
    title,
    transcript,
    whenToUse,
    ...(typeof candidate.duration === "number" && Number.isFinite(candidate.duration)
      ? { duration: candidate.duration }
      : {}),
  };
}

export function readRecoverableAudioToolState(
  value: unknown,
  objectiveId: string,
  nowMs = Date.now(),
): RecoveredAudioToolState | null {
  if (!value || typeof value !== "object" || !objectiveId.trim()) return null;
  const recovery = value as Record<string, unknown>;
  if (recovery.objectiveId !== objectiveId) return null;
  const recoveredAt = typeof recovery.recoveredAt === "string" ? recovery.recoveredAt : "";
  const recoveredAtMs = Date.parse(recoveredAt);
  if (!Number.isFinite(recoveredAtMs) || nowMs - recoveredAtMs > AUDIO_TOOL_RECOVERY_TTL_MS || recoveredAtMs > nowMs + 60_000) {
    return null;
  }
  const candidates = Array.isArray(recovery.candidates)
    ? recovery.candidates.map(normalizeCandidate).filter((candidate): candidate is RecoveredAudioToolCandidate => Boolean(candidate))
    : [];
  if (!candidates.length) return null;
  return {
    objectiveId,
    candidates,
    recoveredAt,
    sourceTurnId: typeof recovery.sourceTurnId === "string" ? recovery.sourceTurnId : null,
    sourceCycleId: typeof recovery.sourceCycleId === "string" ? recovery.sourceCycleId : null,
  };
}

export async function loadRecoverableAudioToolState(params: {
  supabase: any;
  conversationId: string;
  objectiveId: string;
  nowMs?: number;
}): Promise<RecoveredAudioToolState | null> {
  const { data, error } = await params.supabase
    .from("brain_sessions")
    .select("bootstrap_context, context_version")
    .eq("conversation_id", params.conversationId)
    .eq("provider", "openai")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return readRecoverableAudioToolState(
    data?.bootstrap_context?.audioToolRecovery,
    params.objectiveId,
    params.nowMs,
  );
}

export async function loadAndRevalidateRecoverableAudioToolState(params: {
  supabase: any;
  conversationId: string;
  objectiveId: string;
  searchCofreAudios: (input: { supabase: any; conversationId: string; query: string; objective_id: string }) => Promise<Array<{
    audio_id: string;
    title: string;
    full_transcript: string;
    when_to_use: string;
    duration?: number;
  }>>;
  nowMs?: number;
}): Promise<RecoveredAudioToolState | null> {
  const state = await loadRecoverableAudioToolState(params);
  if (!state) return null;
  const currentlyEligible = await params.searchCofreAudios({
    supabase: params.supabase,
    conversationId: params.conversationId,
    query: params.objectiveId,
    objective_id: params.objectiveId,
  });
  const previouslyAuthorizedIds = new Set(state.candidates.map((candidate) => candidate.audioId));
  const candidates = currentlyEligible
    .filter((candidate) => previouslyAuthorizedIds.has(candidate.audio_id))
    .map((candidate) => ({
      audioId: candidate.audio_id,
      title: candidate.title,
      transcript: candidate.full_transcript,
      whenToUse: candidate.when_to_use,
      ...(candidate.duration !== undefined ? { duration: candidate.duration } : {}),
    }));
  return candidates.length > 0 ? { ...state, candidates } : null;
}

export async function persistRecoverableAudioToolState(params: {
  supabase: any;
  conversationId: string;
  sessionId: string;
  objectiveId: string;
  candidates: RecoveredAudioToolCandidate[];
  sourceTurnId?: string | null;
  sourceCycleId?: string | null;
  now?: Date;
}): Promise<void> {
  const now = params.now || new Date();
  const sessionRowId = `bs_${params.sessionId}`;
  const { data: existing, error: readError } = await params.supabase
    .from("brain_sessions")
    .select("bootstrap_context, context_version")
    .eq("id", sessionRowId)
    .maybeSingle();
  if (readError) throw readError;

  const safeCandidates = params.candidates.map(normalizeCandidate).filter((candidate): candidate is RecoveredAudioToolCandidate => Boolean(candidate));
  if (!params.objectiveId.trim() || !safeCandidates.length) return;
  const bootstrapContext = {
    ...(existing?.bootstrap_context && typeof existing.bootstrap_context === "object" ? existing.bootstrap_context : {}),
    audioToolRecovery: {
      objectiveId: params.objectiveId,
      candidates: safeCandidates,
      recoveredAt: now.toISOString(),
      sourceTurnId: params.sourceTurnId || null,
      sourceCycleId: params.sourceCycleId || null,
    },
  };

  const { error: writeError } = await params.supabase.from("brain_sessions").upsert({
    id: sessionRowId,
    conversation_id: params.conversationId,
    provider: "openai",
    provider_session_id: params.sessionId,
    context_version: existing?.context_version ?? 1,
    status: "active",
    bootstrap_context: bootstrapContext,
    updated_at: now.toISOString(),
  }, { onConflict: "id" });
  if (writeError) throw writeError;
}
