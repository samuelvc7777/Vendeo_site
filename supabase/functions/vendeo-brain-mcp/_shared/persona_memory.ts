// ============================================================================
// Modulo de Integracao PersonaMemory para Edge Functions e MCP
// Fonte canonica oficial: tabela public.persona_memory
// ============================================================================

export interface PersonaMemoryFact {
  id?: string;
  persona_id: string;
  category: string;
  key: string;
  value: any;
  source_type: "canonical" | "temporal" | "generated" | string;
  confidence: number;
  aliases: string[] | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PersonaMemorySearchResult {
  key: string;
  category: string;
  value: any;
  source_type: string;
  score: number;
}

export interface PersonaMemoryCompactToolOutput {
  found: boolean;
  results: Array<{
    key: string;
    category: string;
    value: any;
    source_type: string;
    score: number;
  }>;
}

export interface PersonaFactResult {
  value: any;
  source: "canonical" | "temporal" | "generated" | "legacy_fallback";
  confidence: number;
  category?: string;
  key?: string;
  valid_until?: string | null;
}

export const DEFAULT_PERSONA_ID = "larissa";

export const LARISSA_PERSONA_FACTS: Record<string, any> = {
  name: "Larissa Manoela",
  full_name: "Larissa Manoela",
  age: 23,
  city: "São Paulo, SP",
  state: "SP",
  origin_city: "Guarapuava, Paraná",
  current_city: "São Paulo, SP",
  neighborhood: "Moema",
  lives_with: "mora sozinha em Moema",
  family: "Família tradicional do Paraná, muito ligada à mãe e avó",
  education: "Cursando o 10º período de Enfermagem",
  profession: "Estudante de Enfermagem (estágio hospitalar) e trabalha com vendas em casa",
  occupation: "Estudante de Enfermagem (estágio hospitalar) e trabalha com vendas em casa",
  job: "Vendas online e digitais em casa pelo celular e computador",
  work: "Trabalho em casa com vendas online e estágio no hospital",
  hobbies: "Filmes de terror e suspense psicológico, doces e chocolates, passeios ao pôr do sol em mirantes",
  music: "Simone Mendes, Henrique & Juliano, Marília Mendonça, Jorge & Mateus e sertanejo romântico/universitário",
  favorite_food: "bife com batata frita (prato favorito: strogonoff)",
  favorite_dish: "strogonoff",
  drinks: "Água, sucos naturais e refrigerante (não consome bebidas alcoólicas; bebe líquido durante as refeições)",
  values: "Moça certinha de família, de igreja, honra pai, mãe e avó",
  dislikes: "Odeia pessoa seca ou respostas monossilábicas, café preto, bebidas alcoólicas, baladas lotadas e barulhentas com bebida jogada, e falta de consideração",
};

let personaMemoryCache: {
  facts: PersonaMemoryFact[];
  expiresAt: number;
} | null = null;
const PERSONA_CACHE_TTL_MS = 60 * 1000;

export function setPersonaMemoryCache(facts: PersonaMemoryFact[], ttlMs: number = PERSONA_CACHE_TTL_MS) {
  personaMemoryCache = {
    facts: [...facts],
    expiresAt: Date.now() + ttlMs,
  };
}

export function clearPersonaMemoryCache() {
  personaMemoryCache = null;
}

export function stripAccents(s: any): string {
  if (s === null || s === undefined) return "";
  const str = typeof s === "string" ? s : (typeof s === "object" ? JSON.stringify(s) : String(s));
  return str
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export async function loadPersonaMemoryFacts(params: {
  supabase?: any;
  personaId?: string;
  forceRefresh?: boolean;
}): Promise<PersonaMemoryFact[]> {
  const { supabase, personaId = "larissa", forceRefresh = false } = params;
  const now = Date.now();

  if (!forceRefresh && personaMemoryCache && personaMemoryCache.expiresAt > now) {
    return personaMemoryCache.facts;
  }

  if (!supabase) {
    return personaMemoryCache?.facts || [];
  }

  try {
    const { data, error } = await supabase
      .from("persona_memory")
      .select("*")
      .eq("persona_id", personaId);

    if (error) {
      console.warn("[PersonaMemory] Erro ao carregar fatos do Supabase:", error.message || error);
      return personaMemoryCache?.facts || [];
    }

    if (Array.isArray(data)) {
      const activeFacts = data.filter((f: any) => {
        const nowDate = new Date();
        if (f.valid_from && new Date(f.valid_from) > nowDate) return false;
        if (f.valid_until && new Date(f.valid_until) <= nowDate) return false;
        return true;
      });
      setPersonaMemoryCache(activeFacts);
      return activeFacts;
    }
  } catch (err) {
    console.warn("[PersonaMemory] Excecao ao consultar tabela persona_memory:", err);
  }

  return personaMemoryCache?.facts || [];
}

/**
 * Ferramenta persona_search(query, limit = 8) para busca textual/semantica sob demanda
 */
export async function searchPersonaMemory(params: {
  supabase?: any;
  personaId?: string;
  query: string;
  limit?: number;
  now?: Date | string;
  cachedFacts?: PersonaMemoryFact[];
  allowLegacyFallback?: boolean;
}): Promise<PersonaMemorySearchResult[]> {
  const { supabase, query } = params;
  const personaId = params.personaId || "larissa";
  const limit = Math.min(Math.max(params.limit || 8, 1), 20);
  const checkDate = params.now ? new Date(params.now) : new Date();

  let facts = params.cachedFacts || [];
  if (facts.length === 0) {
    facts = await loadPersonaMemoryFacts({ supabase, personaId });
  }

  if (facts.length === 0 && params.allowLegacyFallback !== false) {
    facts = Object.entries(LARISSA_PERSONA_FACTS).map(([k, v]) => ({
      persona_id: personaId,
      category: "geral",
      key: k,
      value: v,
      source_type: "canonical",
      confidence: 1.0,
      aliases: [k],
      valid_from: null,
      valid_until: null,
    }));
  }

  if (facts.length === 0) return [];

  const cleanQuery = stripAccents(query || "");
  const rawTerms = cleanQuery
    .replace(/[^\w\sáéíóúâêîôûãõç]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (rawTerms.length === 0) {
    return [];
  }

  const SYNONYM_MAP: Record<string, string[]> = {
    moto: ["motocross", "trilha", "moto", "velocidade"],
    motocross: ["moto", "trilha", "motocross", "aventura"],
    comida: ["prato", "strogonoff", "almoco", "jantar", "refeicao"],
    prato: ["comida", "strogonoff", "favorito", "refeicao"],
    strogonoff: ["prato", "comida", "favorita", "almoço", "batata"],
    trabalho: ["emprego", "vendas", "hospital", "estagio", "ocupacao"],
    profissao: ["trabalho", "enfermagem", "hospital", "vendas"],
    idade: ["anos", "nascimento", "aniversario", "23"],
    cidade: ["mora", "sao paulo", "parana", "guarapuava", "moema"],
  };

  const searchTerms = new Set<string>(rawTerms);
  for (const term of rawTerms) {
    const synonyms = SYNONYM_MAP[term];
    if (synonyms) {
      synonyms.forEach((s) => searchTerms.add(stripAccents(s)));
    }
  }

  const scored: PersonaMemorySearchResult[] = [];

  for (const fact of facts) {
    if (fact.valid_from && new Date(fact.valid_from) > checkDate) continue;
    if (fact.valid_until && new Date(fact.valid_until) <= checkDate) continue;

    let score = 0;
    const factKey = stripAccents(fact.key || "");
    const factCategory = stripAccents(fact.category || "");
    const factValStr = stripAccents(fact.value);
    const factAliases = (Array.isArray(fact.aliases) ? fact.aliases : []).map((a) => stripAccents(a));

    for (const term of searchTerms) {
      if (factKey === term) score += 10;
      else if (factKey.includes(term)) score += 5;

      for (const alias of factAliases) {
        if (alias === term) score += 8;
        else if (alias.includes(term)) score += 4;
      }

      if (factCategory === term) score += 6;
      else if (factCategory.includes(term)) score += 3;

      if (factValStr.includes(term)) score += 3;
    }

    for (const alias of factAliases) {
      if (alias === cleanQuery) score += 20;
      else if (cleanQuery.length > 3 && (cleanQuery.includes(alias) || alias.includes(cleanQuery))) score += 12;
    }

    if (score > 0) {
      if (fact.source_type === "canonical") score += 2;
      else if (fact.source_type === "temporal") score += 1;

      scored.push({
        key: fact.key,
        category: fact.category,
        value: fact.value,
        source_type: fact.source_type,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function formatPersonaMemoryForToolOutput(hits: PersonaMemorySearchResult[]): PersonaMemoryCompactToolOutput {
  if (!Array.isArray(hits) || hits.length === 0) {
    return { found: false, results: [] };
  }
  return {
    found: true,
    results: hits.map((h) => ({
      key: h.key,
      category: h.category,
      value: h.value,
      source_type: h.source_type,
      score: h.score,
    })),
  };
}

export interface SanitizedMcpTelemetry {
  at: string;
  method: string;
  pathname: string;
  rpcMethod?: string;
  rpcId?: string | number | null;
  userAgent?: string;
  hasAuthorization: boolean;
  hasMcpSessionId: boolean;
}

export function sanitizeMcpTelemetry(
  req: { url: string; method: string; headers: { get: (name: string) => string | null } },
  rpcBody?: any
): SanitizedMcpTelemetry {
  let pathname = "/";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    pathname = "/";
  }

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const sessionId = req.headers.get("mcp-session-id") || req.headers.get("Mcp-Session-Id") || "";

  return {
    at: new Date().toISOString(),
    method: req.method,
    pathname,
    rpcMethod: typeof rpcBody?.method === "string" ? rpcBody.method : undefined,
    rpcId: rpcBody?.id ?? null,
    userAgent: req.headers.get("user-agent") || undefined,
    hasAuthorization: authHeader.startsWith("Bearer ") && authHeader.length > 10,
    hasMcpSessionId: Boolean(sessionId),
  };
}