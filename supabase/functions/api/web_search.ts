// Módulo de pesquisa na internet para enriquecer o contexto da IA com fatos reais (artistas, eventos, cidades, etc.)

/**
 * Extrai possíveis tópicos ou entidades de interesse da mensagem do pretendente.
 * Ex: "teve mumuzinho", "fui no show do alok", "aqui em Barretos", etc.
 */
export function extractSearchCandidates(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const clean = text
    .replace(/[^\w\sáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates: string[] = [];

  // Padrões de menção: "show do X", "teve X", "fui no X", "conhece X", "música do X"
  const patterns = [
    /(?:show|showzaço|evento|festival|festa)\s+(?:do|da|de)?\s*([A-Za-zÀ-ÿ0-9\s]{3,30})/gi,
    /(?:teve|rolou|fui no|fui na)\s+([A-Za-zÀ-ÿ0-9\s]{3,30})/gi,
    /(?:cantor|cantora|banda|grupo|dj)\s+([A-Za-zÀ-ÿ0-9\s]{3,30})/gi,
    /(?:música|ouvir|escutar)\s+([A-Za-zÀ-ÿ0-9\s]{3,30})/gi,
    /(?:em|aqui em|lá em|na cidade de)\s+([A-Za-zÀ-ÿ0-9\s]{3,30})/gi,
  ];

  for (const regex of patterns) {
    const matches = Array.from(clean.matchAll(regex));
    for (const m of matches) {
      if (m[1]) {
        const candidate = m[1].trim().split(/\b(?:e|mas|pq|porque|que|quando|onde|aí|ai|kkk|kk)\b/i)[0].trim();
        if (candidate.length >= 3 && candidate.length <= 30) {
          candidates.push(candidate);
        }
      }
    }
  }

  // Palavras com inicial maiúscula ou termos únicos relevantes (ex: Mumuzinho)
  const tokens = text.split(/\s+/);
  for (const t of tokens) {
    const rawWord = t.replace(/[^\w]/g, "");
    if (/^[A-Z][a-z]{3,}$/.test(rawWord)) {
      const stopWords = new Set(["Hoje", "Ontem", "Amanhã", "Você", "Tudo", "Nossa", "Então", "Muito", "Bom", "Boa", "Quem", "Como", "Qual", "Onde"]);
      if (!stopWords.has(rawWord) && !candidates.includes(rawWord)) {
        candidates.push(rawWord);
      }
    }
  }

  return Array.from(new Set(candidates)).slice(0, 2);
}

/**
 * Pesquisa informações resumidas sobre o tópico na internet usando a API pública da Wikipedia PT e DuckDuckGo.
 */
export async function searchContextInfo(query: string): Promise<string | null> {
  if (!query || query.trim().length < 3) return null;
  const term = query.trim();

  try {
    const wikiUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
    const wikiRes = await fetch(wikiUrl, {
      headers: { "User-Agent": "VendeoApp/1.0 (social-ai-bot)" },
      signal: AbortSignal.timeout(3500),
    });

    if (wikiRes.ok) {
      const data = await wikiRes.json();
      if (data?.extract && typeof data.extract === "string" && data.type !== "disambiguation") {
        const summary = data.extract.slice(0, 260).trim();
        return `${data.title || term}: ${summary}`;
      }
    }
  } catch (_wikiErr) {}

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(term)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgUrl, {
      signal: AbortSignal.timeout(3000),
    });

    if (ddgRes.ok) {
      const data = await ddgRes.json();
      const text = data?.AbstractText || data?.Abstract;
      if (text && typeof text === "string" && text.trim().length > 10) {
        return `${data.Heading || term}: ${text.slice(0, 260).trim()}`;
      }
    }
  } catch (_ddgErr) {}

  return null;
}
