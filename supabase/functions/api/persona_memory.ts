// ============================================================================
// PERSONA MEMORY SERVICE — fonte canônica independente do orquestrador
// Fonte Oficial de Verdade: Supabase (public.persona_memory)
// Suporta resolução canônica com precedência temporal e fallback seguro.
// ============================================================================

export interface PersonaMemoryFact {
  id?: string;
  persona_id: string;
  category: string;
  key: string;
  value: any;
  source_type: "canonical" | "temporal" | "generated";
  confidence: number;
  aliases: string[];
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

export function isTemporalFactActive(fact: PersonaMemoryFact, checkDate: Date = new Date()): boolean {
  if (fact.source_type !== "temporal") return true;
  const t = checkDate.getTime();
  if (fact.valid_from && new Date(fact.valid_from).getTime() > t) return false;
  if (fact.valid_until && new Date(fact.valid_until).getTime() < t) return false;
  return true;
}

export async function loadPersonaMemoryFacts(params: {
  supabase?: any;
  personaId?: string;
  forceRefresh?: boolean;
}): Promise<PersonaMemoryFact[]> {
  const personaId = params.personaId || "larissa";
  const now = Date.now();
  if (
    !params.forceRefresh &&
    personaMemoryCache &&
    personaMemoryCache.expiresAt > now &&
    personaMemoryCache.facts.length > 0
  ) {
    return personaMemoryCache.facts;
  }

  if (params.supabase) {
    try {
      const { data, error } = await params.supabase
        .from("persona_memory")
        .select("*")
        .eq("persona_id", personaId);

      if (!error && Array.isArray(data) && data.length > 0) {
        personaMemoryCache = {
          facts: data as PersonaMemoryFact[],
          expiresAt: now + PERSONA_CACHE_TTL_MS,
        };
        return data as PersonaMemoryFact[];
      }
    } catch (err) {
      console.warn("[PersonaMemory] Falha ao carregar fatos de persona_memory:", err);
    }
  }

  return personaMemoryCache?.facts || [];
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

/**
 * Ferramenta persona_search(query, limit = 8) para busca textual/semântica sob demanda
 */
export async function searchPersonaMemory(params: {
  supabase?: any;
  personaId?: string;
  query: string;
  limit?: number;
  now?: Date | string;
  cachedFacts?: PersonaMemoryFact[];
}): Promise<PersonaMemorySearchResult[]> {
  const { supabase, query } = params;
  const personaId = params.personaId || "larissa";
  const limit = Math.min(Math.max(params.limit || 8, 1), 20);
  const checkDate = params.now ? new Date(params.now) : new Date();

  let facts = params.cachedFacts || [];
  if (facts.length === 0) {
    facts = await loadPersonaMemoryFacts({ supabase, personaId });
  }

  if (facts.length === 0) return [];

  const rawTerms = (query || "")
    .toLowerCase()
    .replace(/[^\w\sáéíóúâêîôûãõç]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (rawTerms.length === 0) {
    return [];
  }

  const SYNONYM_MAP: Record<string, string[]> = {
    singer: ["cantora", "cantor", "artista"],
    singers: ["cantoras", "cantores", "artistas"],
    subject: ["materia", "disciplina"],
    subjects: ["materias", "disciplinas"],
    disliked: ["menos gosta", "odeia", "chata", "dislikes"],
    dislikes: ["menos gosta", "odeia", "chata"],
    hardest: ["dificil", "sofreu", "dificuldade"],
    easiest: ["facil", "tranquila"],
    food: ["comida", "prato", "comer"],
    dish: ["prato", "comida"],
    drink: ["bebida", "beber", "bebe"],
    drinks: ["bebidas", "beber", "bebe", "alcool"],
    alcohol: ["alcool", "bebida", "cerveja", "vinho"],
    movie: ["filme", "cinema"],
    movies: ["filmes", "cinema"],
    music: ["musica", "estilo musical", "gosto musical", "cantora", "cantor"],
    city: ["cidade", "onde mora", "onde nasceu"],
    neighborhood: ["bairro", "matosinhos", "mora"],
    period: ["periodo", "semestre"],
    course: ["curso", "faculdade", "enfermagem"],
    graduation: ["formatura", "formar", "forma"],
    trabalho: ["profissao", "ocupacao", "emprego", "servico", "trampo", "estagio", "vendas"],
    trabalha: ["profissao", "ocupacao", "estagio", "vendas"],
    profissao: ["trabalho", "ocupacao", "carreira", "estudo", "estagio", "vendas"],
    ocupacao: ["trabalho", "profissao", "estagio", "vendas"],
    estagio: ["hospital", "hospitalar", "enfermagem", "trabalho"],
    work: ["trabalho", "profissao", "job", "occupation"],
    job: ["trabalho", "profissao", "work", "occupation"],
    profession: ["profissao", "trabalho", "occupation"],
    occupation: ["ocupacao", "profissao", "trabalho"],
  };

  const searchTermsSet = new Set<string>(rawTerms);
  for (const t of rawTerms) {
    const tClean = stripAccents(t);
    if (SYNONYM_MAP[tClean]) {
      for (const syn of SYNONYM_MAP[tClean]) {
        for (const part of syn.split(/\s+/)) {
          if (part.length >= 2) searchTermsSet.add(stripAccents(part));
        }
      }
    }
  }
  const searchTerms = Array.from(searchTermsSet);

  const scored: PersonaMemorySearchResult[] = [];

  for (const fact of facts) {
    if (!isTemporalFactActive(fact, checkDate)) {
      continue;
    }

    let score = 0;
    const factKey = (fact.key || "").toLowerCase();
    const factCategory = (fact.category || "").toLowerCase();
    const factValStr =
      typeof fact.value === "string" ? fact.value.toLowerCase() : JSON.stringify(fact.value).toLowerCase();
    const factAliases = (fact.aliases || []).map((a) => (a || "").toLowerCase());

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

    const fullQueryClean = stripAccents(query || "");
    for (const alias of factAliases) {
      const aliasClean = stripAccents(alias);
      if (aliasClean === fullQueryClean) score += 20;
      else if (fullQueryClean.length > 3 && (fullQueryClean.includes(aliasClean) || aliasClean.includes(fullQueryClean))) score += 12;
    }

    const narrativeKeywords = ["historia", "perrengue", "aconteceu", "lembra", "porque", "por que", "motivacao", "experiencia", "sofreu", "dificil", "dificuldade"];
    const isNarrativeQuery = narrativeKeywords.some((w) => fullQueryClean.includes(w));
    if (isNarrativeQuery && (factCategory === "stories" || factCategory === "education")) {
      score += 10;
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

export function formatPersonaMemoryHitsForBrain(hits: any[], limit = 8): string {
  const formatted = (hits || []).slice(0, limit).map((fact: any) => {
    const key = fact.key || fact.field || fact.category || "fato";
    const value = fact.value ?? fact.summary;
    return value === undefined || value === null || value === ""
      ? ""
      : `• ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`;
  }).filter(Boolean).join("\n");
  return formatted || "Nenhum fato encontrado na PersonaMemory.";
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
