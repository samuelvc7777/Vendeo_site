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

export function getLarissaChatStyleBlock(): string {
  return LARISSA_CHAT_STYLE_V2;
}

// Regex aprimorada e abrangente para captura de emojis Unicode (incluindo variações e modificadores de tom de pele)
export const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]|\uD83D[\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF])/gu;

export interface EmojiBudgetResult {
  budget: number; // 0 ou 1
  recentEmojis: string[];
  promptSnippet: string;
}

/**
 * Calcula deterministicamente o orçamento de emoji com base nos últimos envios confirmados da Larissa.
 * Regras:
 * A. Se o último outbound contém emoji: budget = 0
 * B. Se o último outbound não contém emoji: budget = 1 no máximo
 * C. Coleta recentEmojis dos turnos recentes
 * D. Se budget = 1, evita repetir emoji recente
 * E. Na maioria dos turnos, zero emoji continua sendo o comportamento padrão
 */
export function computeDynamicEmojiBudget(
  recentOutbounds: Array<{ text?: string; content?: string; message?: string } | string>
): EmojiBudgetResult {
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

  const recentEmojisSet = new Set<string>();
  for (const text of normalizedOutbounds) {
    const matches = text.match(EMOJI_REGEX);
    if (matches) {
      for (const em of matches) {
        recentEmojisSet.add(em);
      }
    }
  }

  const recentEmojis = Array.from(recentEmojisSet);

  // Considera o primeiro elemento como o mais recente (se array ordenado desc), ou o último se asc.
  // Convenção: se recentOutbounds for passado, assume que [0] é o mais recente.
  const latestOutbound = normalizedOutbounds.length > 0 ? normalizedOutbounds[0] : "";
  const latestHasEmoji = Boolean(latestOutbound && EMOJI_REGEX.test(latestOutbound));

  const budget = latestHasEmoji ? 0 : 1;

  let promptSnippet = `EMOJI_BUDGET=${budget}`;
  if (budget === 1 && recentEmojis.length > 0) {
    promptSnippet += `\nRECENT_EMOJIS=[${recentEmojis.join(", ")}]`;
  }

  return {
    budget,
    recentEmojis,
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
    // Exemplo: "oi." -> "oi", mas "oi?." -> "oi?", "oi!" -> "oi!"
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
  if (emojiBudget === 0 && totalEmojiCount > 0) {
    markRetry("EMOJI_BUDGET_ZERO", `Emoji usado (${emojisFoundInTurn.join(", ")}) com EMOJI_BUDGET=0.`);
  } else if (totalEmojiCount > 1) {
    markRetry("EXCESSO_EMOJIS", `Mais de 1 emoji detectado no turno (total: ${totalEmojiCount}).`);
  }

  // Regra 3: Emoji recente repetido
  if (recentEmojis.length > 0 && emojisFoundInTurn.length > 0) {
    for (const em of emojisFoundInTurn) {
      if (recentEmojis.includes(em)) {
        markRetry("EMOJI_REPETIDO", `Emoji recente repetido detectado: ${em}`);
        break;
      }
    }
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

      // Remove emojis se budget = 0 ou excessivos
      if (emojiBudget === 0 || i > 0) {
        b = b.replace(EMOJI_REGEX, "").trim();
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
