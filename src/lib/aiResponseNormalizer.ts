/**
 * Normaliza os índices retornados pela IA para garantir correspondência 1-to-1 perfeita com os balões de resposta.
 * Previne erros de modelos que agrupam "indices" por tópicos de pergunta (ex: 2 tópicos para 3 balões) em vez de por balão.
 */
export function normalizeIndices(
  responses: string[],
  rawIndices: any,
  clientMessages?: { text?: string; index?: number }[]
): number[][] {
  if (!Array.isArray(responses) || responses.length === 0) return [];

  // Lista de índices de todas as mensagens do cliente recebidas nesta rodada
  const allClientIndices = Array.isArray(clientMessages) && clientMessages.length > 0
    ? clientMessages.map((m, i) => (typeof m.index === "number" ? m.index : i))
    : [0];

  const validClientIndices = new Set(allClientIndices);
  const hasPerResponseIndices = Array.isArray(rawIndices) && rawIndices.some((group: any) => Array.isArray(group));

  // Mantém o vínculo 1:1 entre cada balão gerado e os índices retornados pela IA.
  // Nunca achate todos os grupos: isso fazia todos os cards exibirem a mesma mensagem.
  return responses.map((_, responseIndex) => {
    const rawGroup = hasPerResponseIndices && Array.isArray(rawIndices[responseIndex])
      ? rawIndices[responseIndex]
      : [];
    const group = Array.from(new Set(
      rawGroup
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && validClientIndices.has(n))
    )).sort((a, b) => a - b);

    if (group.length > 0) return group;
    if (allClientIndices.length === 1) return [allClientIndices[0]];

    // JSON incompleto: associa o balão ao índice mais próximo, preservando a ordem.
    return [allClientIndices[Math.min(responseIndex, allClientIndices.length - 1)]];
  });
}

/**
 * Substitui todos os pontos (.) por vírgulas (,), mantendo estritamente os pontos de interrogação (?)
 * para simular a digitação jovem, fluida e informal do Instagram Direct / WhatsApp.
 */
export function replaceDotsWithCommas(text: string): string {
  if (!text || typeof text !== "string") return text;
  if (text.startsWith("[audio:") || text.startsWith("[image:") || text.startsWith("[video:")) return text;

  // Substitui ponto seguido de espaço e letra por vírgula + espaço + letra minúscula
  let res = text.replace(/\s*\.\s*([A-Za-zÀ-ÖØ-öø-ÿ])/g, (_, letter) => `, ${letter.toLowerCase()}`);

  // Substitui qualquer outro ponto restante por vírgula
  res = res.replace(/\.+/g, ",");

  // Remove espaços antes de vírgula
  res = res.replace(/\s+,/g, ",");

  // Remove vírgulas coladas ou próximas de ponto de interrogação (ex: "né,?" ou "né?," -> "né?")
  res = res.replace(/,+\s*\?+/g, "?");
  res = res.replace(/\?+\s*,+/g, "?");

  // Remove vírgulas duplicadas (ex: ",," -> ",")
  res = res.replace(/,+/g, ",");

  return res.trim();
}

export const EMOJI_REGEX = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

/**
 * Extrai a lista de emojis únicos já usados pela Larissa nas mensagens recentes do chat.
 */
export function extractUsedEmojis(
  messages?: { sender?: string; isMine?: boolean; text?: string }[]
): string[] {
  if (!Array.isArray(messages)) return [];
  const myMessages = messages
    .filter((m) => m.isMine === true || m.sender === "me")
    .slice(-8);

  const used: string[] = [];
  for (const m of myMessages) {
    const text = m.text || "";
    const matches = text.match(EMOJI_REGEX);
    if (matches) {
      for (const em of matches) {
        if (!used.includes(em)) used.push(em);
      }
    }
  }
  return used;
}

/**
 * Remove repetições de emojis no mesmo lote de respostas geradas (máximo 1 emoji no total para toda a resposta)
 * e elimina emojis que estão na lista de banidos (ex: emojis que a Larissa acabou de usar no histórico recente).
 */
export function deduplicateAndCleanEmojis(
  responses: string[],
  bannedEmojis: string[] = []
): string[] {
  if (!Array.isArray(responses)) return [];
  const banned = new Set(bannedEmojis);
  let batchAlreadyHasEmoji = false;

  return responses.map((text) => {
    if (!text || typeof text !== "string") return text;
    if (text.startsWith("[audio:") || text.startsWith("[image:") || text.startsWith("[video:")) return text;

    let modified = text.replace(EMOJI_REGEX, (match) => {
      if (banned.has(match) || batchAlreadyHasEmoji) {
        return "";
      }
      batchAlreadyHasEmoji = true;
      return match;
    });

    // Limpa vírgula solta colada imediatamente antes do emoji (ex: "uai, 🥰" -> "uai 🥰")
    modified = modified.replace(/,\s*([\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, " $1");

    // Limpa espaços duplicados e pontuações estranhas após a remoção de emojis
    modified = modified
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+\?/g, "?")
      .trim();

    return modified;
  });
}

/**
 * Aplica a sanitização de pontuação (trocar todos os pontos por vírgulas, exceto interrogações)
 * e sanitização anti-repetição de emojis em uma lista de respostas.
 */
export function sanitizeResponsesPunctuation(
  responses: string[],
  bannedEmojis: string[] = []
): string[] {
  if (!Array.isArray(responses)) return [];
  const withoutRepeatedEmojis = deduplicateAndCleanEmojis(responses, bannedEmojis);
  return withoutRepeatedEmojis.map((r) => replaceDotsWithCommas(r));
}
