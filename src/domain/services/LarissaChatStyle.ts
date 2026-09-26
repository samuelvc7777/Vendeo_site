/**
 * LARISSA_CHAT_STYLE_V2
 * Bloco canônico compacto com a forma de DIGITAR da Larissa (~240 tokens).
 * Baseado estritamente em .agents/LARISSA_CHAT_STYLE_V2.md e .agents/LARISSA_LINGUISTIC_DNA.md.
 */

export const LARISSA_CHAT_STYLE_V2 = `=== FORMA DE DIGITAR & LINGUAGEM DE CELULAR (LARISSA_CHAT_STYLE_V2) ===
1. LINGUAGEM DE SMARTPHONE: Português coloquial real do dia a dia. Use: vc, tô, tá, pra, tbm, né, ué. NUNCA use "cê". NUNCA use "trampando", "trampo" ou "trampar" (use trabalho ou serviço).
2. UAI RARO: "uai" é muito raro e opcional (máx 1 a cada 15 turnos). Nunca use como bordão ou muleta.
3. HIERARQUIA DE RISADAS: Apenas "kkk" ou "kkkk" quando houver graça real. Proibido: hahaha, rs, rsrs, hehe. Proibido kkk em: graças a Deus, bênção, cansaço, problema, desabafo ou assunto sério. Maioria das falas sem risada.
4. PONTUAÇÃO DE CELULAR: PROIBIDO terminar balão com ponto final (.). Preserve "?" em perguntas. Proibida pontuação formal de redação. A maioria das falas termina solta com a palavra ou risada.
5. ESTRUTURA DOS BALÕES (responses: []):
   - Mensagem simples: 1 a 2 balões curtos.
   - Mensagem maior: 2 a 4 balões rápidos e proporcionais.
   - Densidade: 3 a 18 palavras por balão. Evite textão em bloco único.
6. ZERO SUJEIRA: Proibido markdown (negrito, itálico), prefixos ("Resposta:", "Larissa:") e explicações internas de IA.`;

export const LARISSA_COMPACT_BRAIN_PROMPT = `=== DIRETRIZES CONVERSACIONAIS DA LARISSA ===
Você conduz uma conversa natural como Larissa (23 anos, moça meiga de Minas Gerais).
1. ESCUTA & EMPATIA: Acolha o que ele disse antes de qualquer objetivo. Reaja com personalidade e carinho.
2. BÚSSOLA, NÃO INTERROGATÓRIO: Objetivos são bússola orgânica, não questionário. Se ele revelou algo espontaneamente, considere concluído sem perguntar de novo.
3. SEM PERGUNTA OBRIGATÓRIA: Nem todo turno precisa de pergunta. Comente, reaja, brinque com meiguice ou conte algo breve sobre você.
4. ESPAÇO: Deixe ele perguntar e conduzir também. Não faça interrogatórios mecânicos.
5. ÁUDIO PRIORITÁRIO: Se houver áudio adequado no Cofre (cofre_search), prefira send_audio SEM texto espelho.
6. ANTI-REPETIÇÃO: Nunca repita perguntas, histórias ou reações consecutivas ("que bom", "legal demais").
7. FERRAMENTAS SOB DEMANDA: Use ferramentas só quando precisar de fatos ausentes. Em saudações e empatia, responda direto.`;

export function getLarissaChatStyleBlock(): string {
  return LARISSA_CHAT_STYLE_V2;
}

export function getLarissaCompactPrompt(): string {
  return LARISSA_COMPACT_BRAIN_PROMPT;
}

// Regex aprimorada e abrangente para captura de emojis Unicode (incluindo variações e modificadores de tom de pele)
export const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]|\uD83D[\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF])/gu;

export interface RecentStyleState {
  recent_reactions: string[];
  recent_emojis: string[];
  recent_questions: string[];
  last_response_shape: string;
  emoji_recent_history: Array<string | null>;
}

export interface EmojiBudgetResult {
  budget: number; // 0 ou 1
  allowEmoji: boolean;
  blockedEmojis: string[];
  recentEmojis: string[];
  emojiRecentHistory: Array<string | null>;
  promptSnippet: string;
}

export const COMMON_REACTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "que_bom", regex: /^(?:que bom+[^\w\s]*|bomm+[^\w\s]*)/i },
  { name: "nossa", regex: /^(?:nossa+[^\w\s]*|nossa senhora[^\w\s]*)/i },
  { name: "tadinho", regex: /^(?:tadinho(?: meu bem)?[^\w\s]*|que d[oó][^\w\s]*|coitado[^\w\s]*)/i },
  { name: "credo", regex: /^(?:credo[^\w\s]*)/i },
  { name: "uai", regex: /^(?:uai[^\w\s]*)/i },
  { name: "sim", regex: /^(?:sim+[^\w\s]*)/i },
  { name: "olha_so", regex: /^(?:olha s[oó][^\w\s]*|olha pra vc ver[^\w\s]*)/i },
  { name: "legal_demais", regex: /^(?:legal demais[^\w\s]*|que legal[^\w\s]*|bacana[^\w\s]*)/i },
  { name: "eita", regex: /^(?:eita[^\w\s]*|aff+[^\w\s]*)/i },
  { name: "misericordia", regex: /^(?:mds[^\w\s]*|miseric[oó]rdia[^\w\s]*)/i },
  { name: "risada", regex: /^(?:kkk+[^\w\s]*)/i },
  { name: "eu_em", regex: /^(?:eu em[^\w\s]*)/i },
  { name: "blz", regex: /^(?:blz[^\w\s]*|ata[^\w\s]*|entendi[^\w\s]*)/i },
  { name: "adorei", regex: /^(?:adorei+[^\w\s]*|amei+[^\w\s]*)/i },
  { name: "saudacao", regex: /^(?:boa noite|bom dia|boa tarde|oie?|oi)[^\w\s]*/i },
];

/**
 * Identifica a reação de abertura em um texto da Larissa.
 */
export function extractOpeningReaction(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();
  for (const { name, regex } of COMMON_REACTION_PATTERNS) {
    if (regex.test(clean)) {
      const match = clean.match(regex);
      if (match) {
        return match[0].replace(/[.,;:!?\s]+$/g, "").trim().toLowerCase();
      }
      return name;
    }
  }
  return null;
}

/**
 * Infere a estrutura/shape da resposta da Larissa.
 */
export function inferResponseShape(text: string): string {
  if (!text || typeof text !== "string") return "short acknowledgement";
  const clean = text.trim();
  const hasQuestion = clean.includes("?");
  const hasReaction = Boolean(extractOpeningReaction(clean));
  const words = clean.split(/\s+/).filter(Boolean).length;

  if (clean.startsWith("[audio:") || clean.includes("send_audio")) {
    return "audio";
  }
  if (hasReaction && hasQuestion) {
    return "reaction + question";
  }
  if (hasReaction && words > 8) {
    return "reaction + disclosure";
  }
  if (hasReaction) {
    return "reaction";
  }
  if (hasQuestion && words > 8) {
    return "disclosure + question";
  }
  if (hasQuestion) {
    return "question";
  }
  if (/\bkkk+\b/i.test(clean) && words <= 6) {
    return "humor";
  }
  if (words <= 4) {
    return "short acknowledgement";
  }
  return "disclosure";
}

/**
 * Extrai o recent_style_state compacto a partir dos outbounds recentes da Larissa.
 */
export function extractRecentStyleState(
  recentOutbounds: Array<{ text?: string; content?: string; message?: string } | string>
): RecentStyleState {
  const normalizedOutbounds: string[] = [];

  for (const item of recentOutbounds || []) {
    if (typeof item === "string") {
      if (item.trim()) normalizedOutbounds.push(item.trim());
    } else if (item && typeof item === "object") {
      const text = item.text || item.content || item.message || "";
      if (typeof text === "string" && text.trim()) {
        normalizedOutbounds.push(text.trim());
      }
    }
  }

  const recentReactions: string[] = [];
  const recentEmojisSet = new Set<string>();
  const recentQuestions: string[] = [];
  const emojiRecentHistory: Array<string | null> = [];

  for (let i = 0; i < normalizedOutbounds.length && i < 5; i++) {
    const text = normalizedOutbounds[i];
    const rx = extractOpeningReaction(text);
    if (rx && !recentReactions.includes(rx)) {
      recentReactions.push(rx);
    }

    const matches = text.match(EMOJI_REGEX);
    if (matches && matches.length > 0) {
      emojiRecentHistory.push(matches[0]);
      for (const em of matches) {
        recentEmojisSet.add(em);
      }
    } else {
      emojiRecentHistory.push(null);
    }

    if (text.includes("?")) {
      const sentences = text.split(/[.!;\n]+/).map((s) => s.trim()).filter((s) => s.includes("?"));
      for (const q of sentences) {
        if (!recentQuestions.includes(q)) {
          recentQuestions.push(q);
        }
      }
    }
  }

  const lastText = normalizedOutbounds.length > 0 ? normalizedOutbounds[0] : "";
  const lastResponseShape = inferResponseShape(lastText);

  return {
    recent_reactions: recentReactions.slice(0, 3),
    recent_emojis: Array.from(recentEmojisSet).slice(0, 3),
    recent_questions: recentQuestions.slice(0, 2),
    last_response_shape: lastResponseShape,
    emoji_recent_history: emojiRecentHistory.slice(0, 3),
  };
}

export interface EmojiBudgetOptions {
  isSeriousContext?: boolean;
  isAffectionateOrFlirtyOrComplex?: boolean;
  emojiRecentHistory?: Array<string | null>;
}

/**
 * Calcula deterministicamente o orçamento de emoji com base no contexto do turno e histórico recente.
 * Regras:
 * A. Se contexto for sério/delicado: budget = 0
 * B. Se contexto for afetivo, flerte leve ou lote composto (2 a 4 balões): budget = 2 (teto máximo)
 * C. Contexto normal: budget = 1 (padrão)
 * D. REMOVIDO o hard block do turno anterior: ter emoji no último outbound NÃO zera o budget
 * E. recentEmojis é mantido para garantir VARIEDADE (evitar repetir mecanicamente o mesmo emoji)
 */
export function computeDynamicEmojiBudget(
  recentOutbounds: Array<{ text?: string; content?: string; message?: string } | string>,
  options?: EmojiBudgetOptions
): EmojiBudgetResult {
  const styleState = extractRecentStyleState(recentOutbounds);

  let budget = 1;
  if (options?.isSeriousContext) {
    budget = 0;
  } else if (options?.isAffectionateOrFlirtyOrComplex) {
    budget = 2;
  } else {
    budget = 1;
  }

  let promptSnippet = `EMOJI_BUDGET=${budget}`;
  if (styleState.recent_emojis.length > 0) {
    promptSnippet += `\nRECENT_EMOJIS=[${styleState.recent_emojis.join(", ")}] (varie; evite repetir mecanicamente os mesmos emojis)`;
  }
  promptSnippet += `\nEMOJI_RECENT_HISTORY=${JSON.stringify(styleState.emoji_recent_history)}`;
  if (budget === 0) {
    promptSnippet += `\nContexto sério ou delicado: zero emoji neste turno.`;
  } else if (budget >= 2) {
    promptSnippet += `\nEmoji é opcional neste turno. Podem aparecer até 2 emojis no turno se for momento afetivo, brincadeira, flerte leve ou lote composto de 2-4 balões. Não force e varie em relação aos recentes.`;
  } else {
    promptSnippet += `\nEmoji é opcional neste turno. Máximo 1 se combinar naturalmente com a emoção/contexto. Varie em relação aos recentes.`;
  }

  return {
    budget,
    allowEmoji: budget > 0,
    blockedEmojis: styleState.recent_emojis,
    recentEmojis: styleState.recent_emojis,
    emojiRecentHistory: styleState.emoji_recent_history,
    promptSnippet,
  };
}

export interface StyleLintIssue {
  type: "mechanical" | "violating";
  rule: string;
  message: string;
}

export interface StyleLintResult {
  passed: boolean;
  requiresRetry: boolean;
  retryReason?: string;
  issues: StyleLintIssue[];
  cleanedBalloons: string[];
}

export interface StyleLintOptions {
  emojiBudget?: number;
  recentEmojis?: string[];
  recentReactions?: string[];
  lastOutboundReaction?: string;
  isSeriousContext?: boolean;
  isRetry?: boolean;
}

/**
 * Style Lint determinístico da Larissa:
 * 1. Aplica correções mecânicas seguras (cê -> vc, hahaha -> kkk, remoção de ponto final final, etc.)
 * 2. Detecta violações que demandam retry (trampando, estouro de emojis, textão, formalismo, etc.)
 * 3. Se for retry final (isRetry: true), aplica saneamento defensivo para não quebrar o envio.
 */
export function runStyleLint(
  balloons: string[],
  options: StyleLintOptions = {}
): StyleLintResult {
  const {
    emojiBudget = 1,
    recentEmojis = [],
    recentReactions = [],
    lastOutboundReaction,
    isSeriousContext = false,
    isRetry = false,
  } = options;

  const issues: StyleLintIssue[] = [];
  const cleaned: string[] = [];

  let totalEmojiCount = 0;
  const emojisFoundInTurn: string[] = [];
  let uaiCount = 0;
  let hasQuestion = false;

  for (let b of balloons) {
    if (!b || typeof b !== "string") continue;
    let text = b.trim();

    // 1. Correções Mecânicas Seguras
    // Remover prefixos "Resposta:" ou "Larissa:"
    if (/^(?:Resposta|Sugestão|Larissa|Mensagem)\s*:\s*/i.test(text)) {
      text = text.replace(/^(?:Resposta|Sugestão|Larissa|Mensagem)\s*:\s*/i, "").trim();
      issues.push({
        type: "mechanical",
        rule: "PREFIXO_ARTIFICIAL",
        message: 'Prefixo artificial "Resposta:" ou "Larissa:" removido.',
      });
    }

    // Remover formatações de markdown básicas (**texto**, *texto*, _texto_)
    if (/\*\*([^*]+)\*\*/.test(text)) {
      text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
      issues.push({ type: "mechanical", rule: "MARKDOWN", message: "Markdown negrito removido." });
    }
    if (/\*([^*]+)\*/.test(text)) {
      text = text.replace(/\*([^*]+)\*/g, "$1");
      issues.push({ type: "mechanical", rule: "MARKDOWN", message: "Markdown itálico removido." });
    }

    // Substituição segura: "cê" -> "vc", "Cê" -> "Vc"
    const ceRegex = /(^|[^\p{L}\p{N}])cê(?=[^\p{L}\p{N}]|$)/giu;
    if (ceRegex.test(text)) {
      text = text.replace(ceRegex, (match, prefix) => {
        const isCapitalized = match.trim().startsWith("C");
        return prefix + (isCapitalized ? "Vc" : "vc");
      });
      issues.push({ type: "mechanical", rule: "CE_PROIBIDO", message: '"cê" substituído por "vc".' });
    }

    // Risadas proibidas -> kkk
    if (/\b(?:ha){2,}h?\b/i.test(text)) {
      text = text.replace(/\b(?:ha){2,}h?\b/gi, "kkk");
      issues.push({ type: "mechanical", rule: "HAHAHA_PROIBIDO", message: '"hahaha" normalizado para "kkk".' });
    }
    if (/\b(?:rs){2,}\b/i.test(text)) {
      text = text.replace(/\b(?:rs){2,}\b/gi, "kkk");
      issues.push({ type: "mechanical", rule: "RSRS_PROIBIDO", message: '"rsrs" normalizado para "kkk".' });
    }
    if (/\b(?:he){2,}h?\b/i.test(text)) {
      text = text.replace(/\b(?:he){2,}h?\b/gi, "kkk");
      issues.push({ type: "mechanical", rule: "HEHE_PROIBIDO", message: '"hehe" normalizado para "kkk".' });
    }
    // rs isolado: normaliza ou remove
    if (/\brs\b/i.test(text)) {
      text = text.replace(/\brs\b/gi, "kkk");
      issues.push({ type: "mechanical", rule: "RS_ISOLADO", message: '"rs" isolado normalizado para "kkk".' });
    }

    // Ponto final SOMENTE no final do balão (preservando ?, !, ...)
    if (/\.$/.test(text) && !/\.\.\.$/.test(text)) {
      text = text.replace(/\.+$/, "");
      issues.push({
        type: "mechanical",
        rule: "PONTO_FINAL_FINAL",
        message: "Ponto final no fim do balão removido.",
      });
    }

    // Contabiliza emojis
    const emMatches = text.match(EMOJI_REGEX);
    if (emMatches) {
      totalEmojiCount += emMatches.length;
      emojisFoundInTurn.push(...emMatches);
    }

    // Contabiliza uai
    const uaiMatches = text.match(/\buai\b/gi);
    if (uaiMatches) {
      uaiCount += uaiMatches.length;
    }

    if (text.includes("?")) {
      hasQuestion = true;
    }

    cleaned.push(text);
  }

  // 2. Detecções que exigem RETRY (se não corrigíveis com 100% de segurança)
  let requiresRetry = false;
  let retryReason: string | undefined;

  function markRetry(rule: string, reason: string) {
    requiresRetry = true;
    if (!retryReason) retryReason = `${rule}: ${reason}`;
    issues.push({ type: "violating", rule, message: reason });
  }

  const fullText = cleaned.join(" ");

  // Regra 1: "trampando", "trampo", "trampar"
  if (/\btramp(?:ando|o|ar|am)\b/i.test(fullText)) {
    markRetry("TRAMPANDO_PROIBIDO", 'Detectado "trampando/trampo". A Larissa fala serviço ou trabalho.');
  }

  // Regra 2: Violações de Emoji
  const maxAllowedEmojis = Math.min(2, Math.max(1, emojiBudget));
  if (emojiBudget === 0 && totalEmojiCount > 0) {
    markRetry("EMOJI_BUDGET_ZERO", `Emoji usado (${emojisFoundInTurn.join(", ")}) com EMOJI_BUDGET=0.`);
  } else if (totalEmojiCount > maxAllowedEmojis) {
    markRetry("EXCESSO_EMOJIS", `Mais de ${maxAllowedEmojis} emoji(s) detectado no turno (total: ${totalEmojiCount}; teto do turno: ${maxAllowedEmojis}).`);
  }

  // Regra 3: Emoji recente repetido (evitar repetição mecânica do mesmo emoji)
  if (recentEmojis.length > 0 && emojisFoundInTurn.length > 0) {
    for (const em of emojisFoundInTurn) {
      if (recentEmojis.includes(em)) {
        markRetry("EMOJI_REPETIDO", `Emoji recente repetido detectado: ${em} (varie o emoji ou envie sem emoji).`);
        break;
      }
    }
  }

  // Regra 3.1: Reação textual imediatamente repetida (remoção limpa sem substituição semântica cega)
  const currentReaction = cleaned.length > 0 ? extractOpeningReaction(cleaned[0]) : null;
  if (currentReaction && lastOutboundReaction && currentReaction === lastOutboundReaction) {
    let firstBalloon = cleaned[0];
    const reactionPrefixRegex = new RegExp(`^${currentReaction}(?:\\s+que|,\\s*que|,|\\s+)*`, "i");
    firstBalloon = firstBalloon.replace(reactionPrefixRegex, "").trim();

    if (/^que\s+/i.test(firstBalloon)) {
      firstBalloon = firstBalloon.replace(/^que\s+/i, "").trim();
    }

    if (firstBalloon.length > 0) {
      cleaned[0] = firstBalloon.charAt(0).toLowerCase() + firstBalloon.slice(1);
    } else if (cleaned.length > 1) {
      cleaned.shift();
    }

    issues.push({
      type: "mechanical",
      rule: "REACAO_CONSECUTIVA_REMOVIDA",
      message: `Reação repetida "${currentReaction}" removida de forma limpa sem substituição semântica cega.`,
    });
  }

  // Regra 4: Uai excessivo (> 1 em todo o turno)
  if (uaiCount > 1) {
    markRetry("UAI_EXCESSIVO", `"uai" repetido ${uaiCount}x no mesmo turno (máx 1 e raro).`);
  }

  // Regra 5: Excesso de balões (> 4 balões)
  if (cleaned.length > 4) {
    markRetry("EXCESSO_BALOES", `Mensagem dividida em ${cleaned.length} balões (máximo permitido: 4).`);
  }

  // Regra 6: Textão em balão único (> 25 palavras)
  for (let i = 0; i < cleaned.length; i++) {
    const wordCount = cleaned[i].split(/\s+/).filter(Boolean).length;
    if (wordCount > 25) {
      markRetry("TEXTAO_BALAO", `Balão #${i + 1} longo demais (${wordCount} palavras; máx natural: 18-25).`);
      break;
    }
  }

  // Regra 7: Linguagem formal de assistente
  const assistantPatterns = [
    /como posso (?:te )?ajudar/i,
    /em que posso (?:ser útil|ajudar)/i,
    /olá!? (?:eu )?sou a larissa/i,
    /compreendo perfeitamente/i,
    /certamente posso/i,
    /de fato,/i,
    /por conseguinte/i,
  ];
  for (const pat of assistantPatterns) {
    if (pat.test(fullText)) {
      markRetry("FORMALISMO_ASSISTENTE", "Detectado padrão de assistente virtual corporativo.");
      break;
    }
  }

  // Regra 8: Risada em contexto sério (graças a Deus, bênção, cansaço, perda, luto, dor)
  const seriousPatterns = [
    /graças a deus/i,
    /deus abençoe/i,
    /se deus quiser/i,
    /fique com deus/i,
    /faleciment/i,
    /perda/i,
    /luto/i,
    /descanse em paz/i,
    /doente/i,
    /hospital difícil/i,
  ];
  const hasSeriousContent = isSeriousContext || seriousPatterns.some((p) => p.test(fullText));
  if (hasSeriousContent && /\bkkk+\b/i.test(fullText)) {
    markRetry("RISADA_CONTEXTO_SERIO", "Risada 'kkk' utilizada em contexto de Deus, fé, cansaço, perda ou assunto sério.");
  }

  // Regra 9: Múltiplas perguntas independentes em sequência
  let questionCount = 0;
  for (const b of cleaned) {
    if (b.includes("?")) questionCount++;
  }
  if (questionCount > 1) {
    markRetry("MULTIPLAS_PERGUNTAS", `Detectadas ${questionCount} perguntas no mesmo turno (máx: 1 pergunta).`);
  }

  // 3. Saneamento Defensivo Final (caso isRetry seja true e ainda reste violação)
  if (requiresRetry && isRetry) {
    // Aplica correção defensiva de segurança máxima para que a Outbox não receba lixo
    for (let i = 0; i < cleaned.length; i++) {
      let b = cleaned[i];
      // Remove trampando
      b = b.replace(/\btrampando\b/gi, "trabalhando")
           .replace(/\btrampo\b/gi, "trabalho")
           .replace(/\btrampar\b/gi, "trabalhar");

      // Remove emojis se budget = 0 ou limpa emojis que estejam em recentEmojis
      if (emojiBudget === 0) {
        b = b.replace(EMOJI_REGEX, "").trim();
      } else if (recentEmojis.length > 0) {
        for (const em of recentEmojis) {
          b = b.split(em).join("").trim();
        }
      }

      // Saneamento de reação consecutiva repetida
      if (i === 0 && currentReaction && lastOutboundReaction && currentReaction === lastOutboundReaction) {
        if (/^que bom+[^\w\s]*/i.test(b)) {
          b = b.replace(/^que bom+[^\w\s]*/i, "simm").trim();
        } else if (/^legal demais[^\w\s]*/i.test(b)) {
          b = b.replace(/^legal demais[^\w\s]*/i, "bacana").trim();
        }
      }

      // Se contexto sério, remove kkk
      if (hasSeriousContent) {
        b = b.replace(/\bkkk+\b/gi, "").trim();
      }

      cleaned[i] = b;
    }

    // Se mais de 4 balões no retry, compacta mantendo os 4 primeiros
    if (cleaned.length > 4) {
      cleaned.splice(4);
    }

    // No retry final, aceitamos passar com saneamento defensivo
    requiresRetry = false;
  }

  return {
    passed: !requiresRetry,
    requiresRetry,
    retryReason,
    issues,
    cleanedBalloons: cleaned.filter(Boolean),
  };
}
