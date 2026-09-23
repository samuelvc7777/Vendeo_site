// ============================================================================
// Modulo de Integracao de Contact Memory e Conversation Memory para MCP
// ============================================================================

export function stripAccents(s: any): string {
  if (s === null || s === undefined) return "";
  const str = typeof s === "string" ? s : (typeof s === "object" ? JSON.stringify(s) : String(s));
  return str
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Resolve o Capability Scope efêmero para obter o conversation_id autorizado.
 * Se o scope não existir, estiver expirado ou revogado: retorna null (FAIL-CLOSED).
 */
export async function resolveMemoryScope(
  supabase: any,
  scopeId: string
): Promise<{ conversationId: string; cycleId: string } | null> {
  const cleanScope = String(scopeId || "").trim();
  if (!cleanScope || !cleanScope.startsWith("scope_")) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("agent_memory_scopes")
      .select("conversation_id, cycle_id, expires_at, revoked_at")
      .eq("scope_id", cleanScope)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    if (data.revoked_at) return null;

    const expiresMs = new Date(data.expires_at).getTime();
    if (Date.now() > expiresMs) return null;

    return {
      conversationId: data.conversation_id,
      cycleId: data.cycle_id,
    };
  } catch (err) {
    console.error("[MCP-Scope] memory_scope_validation_failed");
    throw err;
  }
}

/**
 * Busca compacta em Contact Memory (Fatos e Citações do Pretendente)
 */
export async function searchMcpContactMemory(params: {
  supabase: any;
  conversationId: string;
  query: string;
  scopes?: string[];
  limit?: number;
}): Promise<{ found: boolean; results: any[] }> {
  const { supabase, conversationId, query, scopes = ["facts", "entities", "quotes"] } = params;
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 8);
  const cleanQuery = stripAccents(query);
  if (!cleanQuery || !conversationId) return { found: false, results: [] };

  const queryTokens = cleanQuery.split(/\s+/).filter((t) => t.length >= 2);
  const results: any[] = [];

  // 1. Fatos ativos em contact_memory_facts
  if (scopes.includes("facts") || scopes.includes("entities")) {
    try {
      const { data: facts, error } = await supabase
        .from("contact_memory_facts")
        .select("entity, field, value, normalized_value, temporal_status, created_at, source_message_ids")
        .eq("conversation_id", conversationId)
        .neq("temporal_status", "superseded")
        .order("importance", { ascending: false })
        .limit(25);

      if (error) throw error;

      if (!error && Array.isArray(facts)) {
        for (const f of facts) {
          const valNorm = f.normalized_value || stripAccents(f.value);
          const fldNorm = stripAccents(f.field);
          const entNorm = stripAccents(f.entity);

          let score = 0;
          if (valNorm.includes(cleanQuery) || fldNorm.includes(cleanQuery) || entNorm.includes(cleanQuery)) {
            score += 50;
          }
          for (const token of queryTokens) {
            if (valNorm.includes(token)) score += 15;
            if (fldNorm.includes(token)) score += 20;
            if (entNorm.includes(token)) score += 25;
          }

          if (score > 0) {
            const displayEntity = f.entity === "self" ? "Pretendente" : f.entity;
            results.push({
              type: "fact",
              entity: f.entity,
              field: f.field,
              value: f.value,
              summary: `${displayEntity} -> ${f.field}: ${JSON.stringify(f.value)}`,
              temporalStatus: f.temporal_status,
              sourceMessageId: f.source_message_ids?.[0] || undefined,
              occurredAt: f.created_at,
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (err) {
      console.warn("[MCP] memory_search_failed: source=contact_memory_facts");
      throw err;
    }
  }

  // 2. Citações em contact_memory_quotes
  if (results.length < limit && scopes.includes("quotes")) {
    try {
      const { data: quotes, error } = await supabase
        .from("contact_memory_quotes")
        .select("speaker, quote_text, normalized_quote, context_or_reason, source_message_id, created_at")
        .eq("conversation_id", conversationId)
        .order("importance", { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!error && Array.isArray(quotes)) {
        for (const q of quotes) {
          const qNorm = q.normalized_quote || stripAccents(q.quote_text);
          let score = 0;
          if (qNorm.includes(cleanQuery)) score += 40;
          for (const token of queryTokens) {
            if (qNorm.includes(token)) score += 15;
          }

          if (score > 0) {
            results.push({
              type: "quote",
              entity: q.speaker,
              value: q.quote_text,
              summary: `"${q.quote_text}" (${q.context_or_reason || q.speaker})`,
              sourceMessageId: q.source_message_id,
              occurredAt: q.created_at,
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (err) {
      console.warn("[MCP] memory_search_failed: source=contact_memory_quotes");
      throw err;
    }
  }

  return {
    found: results.length > 0,
    results: results.slice(0, limit),
  };
}

/**
 * Busca compacta em Conversation Memory (Episódios, Atos de Fala, Open Loops e Histórico Bruto)
 */
export async function searchMcpConversationMemory(params: {
  supabase: any;
  conversationId: string;
  query: string;
  scopes?: string[];
  limit?: number;
}): Promise<{ found: boolean; results: any[] }> {
  const { supabase, conversationId, query, scopes = ["episodes", "speech_acts", "open_loops", "history"] } = params;
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 8);
  const cleanQuery = stripAccents(query);
  if (!cleanQuery || !conversationId) return { found: false, results: [] };

  const queryTokens = cleanQuery.split(/\s+/).filter((t) => t.length >= 2);
  const results: any[] = [];

  // 1. Busca na memória episódica
  if (scopes.includes("episodes") || scopes.includes("speech_acts") || scopes.includes("open_loops")) {
    try {
      const { data: episodes, error } = await supabase
        .from("conversation_episodic_memory")
        .select("actor, event_type, topic, summary, source_message_id, created_at, loop_status, metadata")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;

      if (!error && Array.isArray(episodes)) {
        for (const ep of episodes) {
          const sumNorm = stripAccents(ep.summary);
          const topNorm = stripAccents(ep.topic || "");

          let score = 0;
          if (sumNorm.includes(cleanQuery) || topNorm.includes(cleanQuery)) {
            score += 50;
          }
          for (const token of queryTokens) {
            if (sumNorm.includes(token)) score += 15;
            if (topNorm.includes(token)) score += 20;
          }

          if (score > 0) {
            const isOpenLoop = ep.loop_status === "open" || ep.event_type === "plan";
            const isSpeechAct = ["question", "answer", "self_disclosure", "fact_reveal"].includes(ep.event_type);
            const hitType = isOpenLoop ? "open_loop" : isSpeechAct ? "speech_act" : "episode";

            if (
              (hitType === "episode" && !scopes.includes("episodes")) ||
              (hitType === "speech_act" && !scopes.includes("speech_acts")) ||
              (hitType === "open_loop" && !scopes.includes("open_loops"))
            ) {
              continue;
            }

            results.push({
              type: hitType,
              actor: ep.actor,
              topic: ep.topic,
              summary: ep.summary,
              sourceMessageId: ep.source_message_id,
              occurredAt: ep.created_at,
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (err) {
      console.warn("[MCP] memory_search_failed: source=conversation_episodic_memory");
      throw err;
    }
  }

  // 2. Fallback de histórico bruto (último recurso) se houver espaço e "history" nos scopes
  if (results.length < limit && scopes.includes("history")) {
    try {
      const { data: messages, error } = await supabase
        .from("instagram_messages")
        .select("id, text, audio_transcript, is_mine, sender_id, direction, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(60);

      if (error) throw error;

      if (!error && Array.isArray(messages)) {
        for (const msg of messages) {
          const text = msg.text || msg.audio_transcript || "";
          const normText = stripAccents(text);
          if (!normText) continue;

          let score = 0;
          if (normText.includes(cleanQuery)) score += 40;
          for (const token of queryTokens) {
            if (normText.includes(token)) score += 10;
          }

          if (score > 0) {
            const isMine = msg.is_mine || msg.sender_id === "me" || msg.direction === "outbound";
            results.push({
              type: "raw_message",
              actor: isMine ? "larissa" : "pretendente",
              summary: msg.audio_transcript ? `[Áudio]: "${msg.audio_transcript}"` : `"${text}"`,
              sourceMessageId: String(msg.id),
              occurredAt: msg.created_at,
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (err) {
      console.warn("[MCP] memory_search_failed: source=instagram_messages");
      throw err;
    }
  }

  return {
    found: results.length > 0,
    results: results.slice(0, limit),
  };
}
