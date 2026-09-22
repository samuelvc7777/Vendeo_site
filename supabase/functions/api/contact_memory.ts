/**
 * supabase/functions/api/contact_memory.ts
 * 
 * Módulo Canônico de Contact Memory (01 - Sobre).
 * 
 * Responsabilidades:
 * 1. Gerenciamento estrito de Capability Scopes efêmeros (agent_memory_scopes).
 * 2. Cálculo determinístico de fingerprints de idempotência.
 * 3. Busca compacta e estruturada em contact_memory_facts e contact_memory_quotes.
 * 4. Persistência idempotente e resolução semântica de supersede (sem conflito com dedup).
 */

export type TemporalStatus = "durable" | "temporal" | "event" | "plan" | "superseded";
export type SourceActor = "pretendente" | "larissa";

export interface ContactFactInput {
  entity?: string; // "self", "mae", "amigo_joao", "carro", etc.
  field: string;   // "age", "city", "profession", "car_model", etc.
  value: any;      // 27, "Belo Horizonte", "Enfermeiro", etc.
  temporalStatus?: TemporalStatus;
  validFrom?: string | null;
  validUntil?: string | null;
  sourceMessageIds: string[];
  sourceActor?: SourceActor;
  confidence?: number;
  importance?: number;
  metadata?: Record<string, any>;
}

export interface ContactQuoteInput {
  quoteText: string;
  contextOrReason?: string | null;
  sourceMessageId: string;
  speaker?: SourceActor;
  importance?: number;
  metadata?: Record<string, any>;
}

export interface AgentMemoryScopeRecord {
  scope_id: string;
  conversation_id: string;
  cycle_id: string;
  agent_id: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

export function stripAccents(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeFactValue(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    try {
      return stripAccents(JSON.stringify(val));
    } catch {
      return "";
    }
  }
  return stripAccents(String(val));
}

/**
 * Fingerprint determinístico para ContactFact.
 * Garante que a mesma revelação reprocessada gere exatamente o mesmo hash e não duplique no banco.
 */
export function generateContactFactFingerprint(params: {
  conversation_id: string;
  entity: string;
  field: string;
  normalized_value: string;
  source_message_ids: string[];
}): string {
  const cId = (params.conversation_id || "").trim();
  const ent = stripAccents(params.entity || "self");
  const fld = stripAccents(params.field || "");
  const normVal = stripAccents(params.normalized_value || "");
  const sortedIds = [...(params.source_message_ids || [])].map((s) => String(s).trim()).sort().join(",");
  return `${cId}::${ent}::${fld}::${normVal}::${sortedIds}`;
}

/**
 * Fingerprint determinístico para ContactQuote.
 */
export function generateContactQuoteFingerprint(params: {
  conversation_id: string;
  speaker: string;
  normalized_quote: string;
  source_message_id: string;
}): string {
  const cId = (params.conversation_id || "").trim();
  const spk = (params.speaker || "pretendente").trim().toLowerCase();
  const normQuote = stripAccents(params.normalized_quote || "");
  const msgId = String(params.source_message_id || "").trim();
  return `${cId}::${spk}::${normQuote}::${msgId}`;
}

/**
 * Cria Capability Scope efêmero (10 min) vinculado a um ciclo de orquestração.
 */
export async function createAgentMemoryScope(params: {
  supabase: any;
  conversationId: string;
  cycleId: string;
  agentId: string;
  durationMinutes?: number;
}): Promise<string> {
  const { supabase, conversationId, cycleId, agentId } = params;
  const duration = params.durationMinutes || 10;
  const scopeId = `scope_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 60 * 1000).toISOString();

  const { error } = await supabase.from("agent_memory_scopes").insert({
    scope_id: scopeId,
    conversation_id: conversationId,
    cycle_id: cycleId,
    agent_id: agentId,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[MemoryScope] Erro ao registrar scope efêmero:", error.message);
    throw new Error(`Falha ao registrar scope de memória: ${error.message}`);
  }

  return scopeId;
}

/**
 * Resolve e valida o Capability Scope (Fail-Closed).
 * Rejeita se inexistente, expirado ou revogado.
 */
export async function resolveAgentMemoryScope(params: {
  supabase: any;
  scopeId: string;
}): Promise<{ conversationId: string; cycleId: string; agentId: string } | null> {
  const { supabase, scopeId } = params;
  if (!scopeId || typeof scopeId !== "string" || !scopeId.startsWith("scope_")) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("agent_memory_scopes")
      .select("conversation_id, cycle_id, agent_id, expires_at, revoked_at")
      .eq("scope_id", scopeId)
      .maybeSingle();

    if (error || !data) return null;
    if (data.revoked_at) return null;

    const expiresMs = new Date(data.expires_at).getTime();
    if (Date.now() > expiresMs) return null;

    return {
      conversationId: data.conversation_id,
      cycleId: data.cycle_id,
      agentId: data.agent_id,
    };
  } catch (err) {
    console.error("[MemoryScope] Exceção ao resolver scope:", err);
    return null;
  }
}

/**
 * Revoga um Capability Scope pós-ciclo para invalidar reutilizações futuras.
 */
export async function revokeAgentMemoryScope(params: {
  supabase: any;
  scopeId: string;
}): Promise<void> {
  const { supabase, scopeId } = params;
  if (!scopeId) return;
  try {
    await supabase
      .from("agent_memory_scopes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("scope_id", scopeId);
  } catch (err) {
    console.warn("[MemoryScope] Aviso ao revogar scope:", err);
  }
}

export interface ContactMemoryCompactHit {
  type: "fact" | "quote";
  entity: string;
  field?: string;
  value: any;
  summary: string;
  temporalStatus?: string;
  sourceMessageId?: string;
  occurredAt?: string;
}

export interface ContactMemoryCompactToolOutput {
  found: boolean;
  results: ContactMemoryCompactHit[];
}

/**
 * Busca compacta na Contact Memory (Fatos e Citações) para tools MCP.
 */
export async function searchContactMemory(params: {
  supabase: any;
  conversationId: string;
  query: string;
  scopes?: Array<"facts" | "entities" | "quotes">;
  limit?: number;
}): Promise<ContactMemoryCompactToolOutput> {
  const { supabase, conversationId, query, scopes = ["facts", "entities", "quotes"] } = params;
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 8);
  const cleanQuery = (query || "").trim();
  if (!cleanQuery || !conversationId) {
    return { found: false, results: [] };
  }

  const normQuery = stripAccents(cleanQuery);
  const queryTokens = normQuery.split(/\s+/).filter((t) => t.length >= 2);
  const results: ContactMemoryCompactHit[] = [];

  // 1. Busca fatos ativos (não superseded) em contact_memory_facts
  if (scopes.includes("facts") || scopes.includes("entities")) {
    try {
      const { data: facts, error } = await supabase
        .from("contact_memory_facts")
        .select("id, entity, field, value, normalized_value, temporal_status, source_message_ids, created_at, confidence, importance")
        .eq("conversation_id", conversationId)
        .neq("temporal_status", "superseded")
        .order("importance", { ascending: false })
        .limit(30);

      if (!error && Array.isArray(facts)) {
        for (const f of facts) {
          const entNorm = stripAccents(f.entity);
          const fldNorm = stripAccents(f.field);
          const valNorm = f.normalized_value || "";

          let score = 0;
          if (valNorm.includes(normQuery) || fldNorm.includes(normQuery) || entNorm.includes(normQuery)) {
            score += 50;
          }
          for (const token of queryTokens) {
            if (valNorm.includes(token)) score += 15;
            if (fldNorm.includes(token)) score += 20;
            if (entNorm.includes(token)) score += 25;
          }

          if (score > 0) {
            const displayEntity = f.entity === "self" ? "Pretendente" : f.entity;
            const summary = `${displayEntity} -> ${f.field}: ${JSON.stringify(f.value)}`;
            results.push({
              type: "fact",
              entity: f.entity,
              field: f.field,
              value: f.value,
              summary,
              temporalStatus: f.temporal_status,
              sourceMessageId: f.source_message_ids?.[0] || undefined,
              occurredAt: f.created_at,
            });
            if (results.length >= limit) break;
          }
        }
      }
    } catch (err) {
      console.warn("[ContactMemory] Erro ao buscar fatos:", err);
    }
  }

  // 2. Busca citações marcantes em contact_memory_quotes se ainda houver espaço
  if (results.length < limit && scopes.includes("quotes")) {
    try {
      const { data: quotes, error } = await supabase
        .from("contact_memory_quotes")
        .select("id, speaker, quote_text, normalized_quote, context_or_reason, source_message_id, created_at, importance")
        .eq("conversation_id", conversationId)
        .order("importance", { ascending: false })
        .limit(15);

      if (!error && Array.isArray(quotes)) {
        for (const q of quotes) {
          const quoteNorm = q.normalized_quote || "";
          const ctxNorm = stripAccents(q.context_or_reason || "");

          let score = 0;
          if (quoteNorm.includes(normQuery) || ctxNorm.includes(normQuery)) {
            score += 40;
          }
          for (const token of queryTokens) {
            if (quoteNorm.includes(token)) score += 15;
            if (ctxNorm.includes(token)) score += 10;
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
      console.warn("[ContactMemory] Erro ao buscar quotes:", err);
    }
  }

  return {
    found: results.length > 0,
    results: results.slice(0, limit),
  };
}

/**
 * Persiste propostas de memória (fatos e citações) com IDEMPOTÊNCIA e SUPERSEDE semântico.
 * Executado estritamente pós-envio de balões.
 */
export async function commitContactMemoryWrites(params: {
  supabase: any;
  conversationId: string;
  cycleId: string;
  facts?: ContactFactInput[];
  quotes?: ContactQuoteInput[];
  validMessageIds: Set<string>;
}): Promise<{ factsCommitted: number; quotesCommitted: number; supersededCount: number }> {
  const { supabase, conversationId, cycleId, facts = [], quotes = [], validMessageIds } = params;
  let factsCommitted = 0;
  let quotesCommitted = 0;
  let supersededCount = 0;

  // 1. Processamento de Fatos
  for (const rawFact of facts) {
    if (!rawFact.field || rawFact.value === undefined || rawFact.value === null) continue;

    // Validação estrita de proveniência para mensagens do pretendente
    const sourceActor = rawFact.sourceActor || "pretendente";
    const filteredSourceIds = (rawFact.sourceMessageIds || []).filter((id) =>
      validMessageIds.has(String(id))
    );

    if (sourceActor === "pretendente" && filteredSourceIds.length === 0) {
      console.warn(
        `[ContactMemory] Fato rejeitado por falta de sourceMessageId válido na conversa ${conversationId}: field=${rawFact.field}`
      );
      continue;
    }

    const entity = (rawFact.entity || "self").toLowerCase().trim();
    let field = rawFact.field.toLowerCase().trim();
    const normalizedVal = normalizeFactValue(rawFact.value);
    const temporalStatus = rawFact.temporalStatus || "durable";

    // Proteção Semântica Cidade vs Bairro:
    // Se o campo for city/cidade mas o valor for claramente um bairro/localidade (ex: "centro", "matosinhos"),
    // redireciona o campo para "neighborhood" para não superseder nem sobrescrever a cidade real.
    const isNeighborhoodValue = /^(centro|matosinhos|colonia|colônia|vila|zona sul|zona norte|zona leste|zona oeste|bairro\b)/i.test(normalizedVal);
    if ((field === "city" || field === "cidade") && isNeighborhoodValue) {
      field = "neighborhood";
    }

    const factFingerprint = generateContactFactFingerprint({
      conversation_id: conversationId,
      entity,
      field,
      normalized_value: normalizedVal,
      source_message_ids: filteredSourceIds.length > 0 ? filteredSourceIds : [cycleId],
    });

    try {
      // 1.1. Verifica se já existe registro idêntico (Dedup / Idempotência estrita)
      const { data: existingExact } = await supabase
        .from("contact_memory_facts")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("fact_fingerprint", factFingerprint)
        .maybeSingle();

      if (existingExact) {
        // Já existe exatamente esse fato: idempotente
        continue;
      }

      // 1.2. Verifica se existe fato anterior ATIVO para a mesma (entity, field) com valor diferente (Supersede)
      let supersededId: string | null = null;
      if (temporalStatus === "durable") {
        const { data: previousActive } = await supabase
          .from("contact_memory_facts")
          .select("id, normalized_value")
          .eq("conversation_id", conversationId)
          .eq("entity", entity)
          .eq("field", field)
          .neq("temporal_status", "superseded")
          .maybeSingle();

        if (previousActive && previousActive.normalized_value !== normalizedVal) {
          // Marca o anterior como superseded
          await supabase
            .from("contact_memory_facts")
            .update({
              temporal_status: "superseded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", previousActive.id);

          supersededId = previousActive.id;
          supersededCount++;
        }
      }

      // 1.3. Insere o novo fato
      const { error: insertErr } = await supabase
        .from("contact_memory_facts")
        .insert({
          conversation_id: conversationId,
          entity,
          field,
          value: rawFact.value,
          normalized_value: normalizedVal,
          temporal_status: temporalStatus,
          valid_from: rawFact.validFrom || null,
          valid_until: rawFact.validUntil || null,
          source_message_ids: filteredSourceIds.length > 0 ? filteredSourceIds : [cycleId],
          source_actor: sourceActor,
          confidence: rawFact.confidence ?? 1.0,
          importance: rawFact.importance ?? 0.5,
          fact_fingerprint: factFingerprint,
          superseded_by_id: null,
          metadata: {
            ...(rawFact.metadata || {}),
            cycle_id: cycleId,
            superseded_from: supersededId,
          },
        });

      if (!insertErr) {
        factsCommitted++;
      } else {
        console.warn(`[ContactMemory] Erro ao inserir fato (${field}):`, insertErr.message);
      }
    } catch (err: any) {
      console.warn(`[ContactMemory] Exceção ao gravar fato (${field}):`, err.message || err);
    }
  }

  // 2. Processamento de Citações / Frases Marcantes
  for (const rawQuote of quotes) {
    if (!rawQuote.quoteText || !rawQuote.sourceMessageId) continue;
    if (!validMessageIds.has(String(rawQuote.sourceMessageId))) {
      console.warn(
        `[ContactMemory] Quote rejeitado por sourceMessageId inválido na conversa ${conversationId}: ${rawQuote.sourceMessageId}`
      );
      continue;
    }

    const speaker = rawQuote.speaker || "pretendente";
    const quoteText = rawQuote.quoteText.trim();
    const normalizedQuote = stripAccents(quoteText);

    const quoteFingerprint = generateContactQuoteFingerprint({
      conversation_id: conversationId,
      speaker,
      normalized_quote: normalizedQuote,
      source_message_id: rawQuote.sourceMessageId,
    });

    try {
      const { error: insertErr } = await supabase
        .from("contact_memory_quotes")
        .insert({
          conversation_id: conversationId,
          speaker,
          quote_text: quoteText,
          normalized_quote: normalizedQuote,
          context_or_reason: rawQuote.contextOrReason || null,
          source_message_id: rawQuote.sourceMessageId,
          importance: rawQuote.importance ?? 0.5,
          quote_fingerprint: quoteFingerprint,
          metadata: {
            ...(rawQuote.metadata || {}),
            cycle_id: cycleId,
          },
        });

      if (!insertErr) {
        quotesCommitted++;
      } else if (insertErr.code !== "23505") {
        // Ignora duplicata (23505 = unique_violation)
        console.warn(`[ContactMemory] Erro ao inserir quote:`, insertErr.message);
      }
    } catch (err: any) {
      console.warn(`[ContactMemory] Exceção ao gravar quote:`, err.message || err);
    }
  }

  return { factsCommitted, quotesCommitted, supersededCount };
}
