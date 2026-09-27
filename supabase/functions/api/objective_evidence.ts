export type ObjectiveEvidenceType = "message" | "contact_fact" | "contact_quote" | "episode" | "manual_fact";

export interface ObjectiveEvidence {
  type: ObjectiveEvidenceType;
  id: string;
}

const EVIDENCE_TABLES: Record<Exclude<ObjectiveEvidenceType, "manual_fact">, string> = {
  message: "instagram_messages",
  contact_fact: "contact_memory_facts",
  contact_quote: "contact_memory_quotes",
  episode: "conversation_episodic_memory",
};

export function normalizeObjectiveEvidence(value: unknown, legacyMessageId?: unknown): ObjectiveEvidence | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    const type = String(candidate.type || "") as ObjectiveEvidenceType;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id || (!Object.hasOwn(EVIDENCE_TABLES, type) && type !== "manual_fact")) return null;
    return { type, id };
  }
  const messageId = typeof legacyMessageId === "string" ? legacyMessageId.trim() : "";
  return messageId ? { type: "message", id: messageId } : null;
}

/** Verifica apenas existência e escopo técnico da referência; não julga seu significado. */
export async function objectiveEvidenceExists(
  supabase: any,
  conversationId: string,
  evidence: ObjectiveEvidence,
  providerSessionId?: string | null,
): Promise<boolean> {
  if (!conversationId.trim() || !evidence.id.trim()) return false;
  if (evidence.type === "manual_fact") {
    if (!providerSessionId) return false;
    const { data: session, error: sessionError } = await supabase.from("brain_sessions")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("provider_session_id", providerSessionId)
      .maybeSingle();
    if (sessionError || !session?.id) return false;
    const { data, error } = await supabase.from("brain_manual_facts")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("session_id", session.id)
      .eq("id", evidence.id)
      .maybeSingle();
    return !error && Boolean(data?.id);
  }

  const table = EVIDENCE_TABLES[evidence.type];
  if (!table) return false;
  const { data, error } = await supabase.from(table)
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("id", evidence.id)
    .maybeSingle();
  return !error && Boolean(data?.id);
}
