import type { PersonaMemoryCandidate } from "./jev_memory_selector.ts";

/** persona_memory is a global persona catalog, not a contact/session table. */
export async function loadPersonaMemoryCatalog(params: {
  supabase: any;
  personaId: string;
  now?: Date;
  signal?: AbortSignal;
}): Promise<PersonaMemoryCandidate[]> {
  if (params.personaId !== "larissa") throw new Error("unsupported_persona");
  const now = (params.now || new Date()).getTime();
  if (!Number.isFinite(now)) throw new Error("invalid_time");
  const memories: PersonaMemoryCandidate[] = [];
  const seen = new Set<string>();
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    if (params.signal?.aborted) throw new Error("catalog_cancelled");
    let query: any = params.supabase.from("persona_memory")
      .select("id, persona_id, key, value, source_type, confidence, aliases, valid_from, valid_until, updated_at")
      .eq("persona_id", params.personaId).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (params.signal) query = query.abortSignal(params.signal);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw new Error("catalog_unavailable");
    for (const row of data) {
      if (row.persona_id !== params.personaId || !row.id || seen.has(row.id)) throw new Error("catalog_inconsistent");
      seen.add(row.id);
      const from = row.valid_from == null ? -Infinity : Date.parse(row.valid_from);
      const until = row.valid_until == null ? Infinity : Date.parse(row.valid_until);
      if (Number.isNaN(from) || Number.isNaN(until) || from > until) throw new Error("catalog_invalid_validity");
      if (now < from || now >= until) continue;
      // Preserve original JSON including explicit negatives and provenance.
      // No lexical, category or tag relevance filter.
      memories.push({
        id: `persona:${row.id}`,
        text: JSON.stringify({ key: row.key, value: row.value, aliases: row.aliases, confidence: row.confidence }),
        source: `persona_memory:${row.source_type}`, revision: String(row.updated_at || ""),
        validFrom: row.valid_from, validUntil: row.valid_until,
      });
    }
    if (data.length < pageSize) return memories;
  }
}
