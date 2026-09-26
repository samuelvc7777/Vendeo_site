/**
 * Utilitário legado exclusivo de simulações e scripts de piloto.
 * Não importar no runtime do Brain: objetivo e evidência são decisões do Brain.
 */
export interface SpontaneousObjectiveMatch {
  objectiveId: string;
  memoryEntity: string; // Sempre "self" para dados do pretendente
  memoryField: string;  // Campo canônico: "job", "city", "age", "has_children", "wants_children", "relationship_status"
  field: string;        // Compatibilidade
  value: any;
  evidenceMessageId?: string;
  summary: string;
}

/** Converte uma heurística em contexto para o Brain, sem qualquer mutação de estado. */
export function buildObjectiveCandidateEvidence(matches: SpontaneousObjectiveMatch[]): Array<{
  objectiveId: string;
  evidenceMessageId: string;
  summary: string;
}> {
  return matches.map((match) => ({
    objectiveId: match.objectiveId,
    evidenceMessageId: match.evidenceMessageId || "",
    summary: match.summary || `${match.field}: ${String(match.value).slice(0, 120)}`,
  }));
}

/**
 * Detecta conclusões espontâneas de objetivos a partir do texto do pretendente
 * (ex: "trabalho com mineração, sou solteiro e não tenho filhos").
 * Não dispara checklist nem perguntas sobre fatos já revelados.
 */
export function detectSpontaneousObjectiveCompletions(
  messages: Array<{ id: string; text?: string; sender?: string }>,
  pendingGoalIds: string[]
): SpontaneousObjectiveMatch[] {
  const matches: SpontaneousObjectiveMatch[] = [];
  const joinedText = messages
    .filter((m) => m.sender === "pretendente" || !m.sender)
    .map((m) => m.text || "")
    .join(" ");

  if (!joinedText.trim()) return matches;

  const textLower = joinedText.toLowerCase();

  // Helper para checar se o trecho refere-se a terceira pessoa (irmão, ex, amigo, pai, etc.)
  const isThirdParty = (fullText: string, matchIndex: number) => {
    const prefix = fullText.slice(Math.max(0, matchIndex - 35), matchIndex);
    return /\b(?:meu|minha|um|uma|meus|minhas|dele|dela|esse|essa)\s+(?:irmão|irmã|amigo|amiga|ex|namorada|esposa|marido|pai|mãe|filho|filha|primo|prima|colega|chefe|parente)\b|\b(?:ele|ela)\s+/i.test(prefix);
  };

  // Helper para checar negação anterior
  const hasNegationPrefix = (fullText: string, matchIndex: number) => {
    const prefix = fullText.slice(Math.max(0, matchIndex - 20), matchIndex);
    return /\b(?:não|nao|nem|nunca|jamais)\s*$/i.test(prefix);
  };

  // 1. Trabalho / Profissão (com distinção estrita de tempo: passado vs presente, e entidade)
  const isWorkGoal = (id: string) => /work|profession|profissao|trabalho|emprego|job/i.test(id);
  const targetWorkGoal = pendingGoalIds.find(isWorkGoal);
  if (targetWorkGoal) {
    // Primeiro prioriza declaração clara de presente ("hoje sou motorista", "atualmente trabalho como...", "sou motorista")
    const presentJobMatch = textLower.match(
      /(?:(?:hoje|atualmente|agora)\s+)?(?:sou\s+(?:médico|médica|engenheiro|engenheira|advogado|advogada|motorista|autônomo|autônoma|empresário|empresária|enfermeiro|enfermeira|professor|professora|pedreiro|estudante|programador|programadora|dev|analista|minerador|mineradora|técnico|técnica|policial|bancário|bancária|vendedor|vendedora)[^,.;!?\n]*|(?:hoje|atualmente|agora)\s+trabalho\s+(?:com|em|na|no|de|como)\s+([^,.;!?\n]+))/i
    );

    const generalWorkMatch = textLower.match(
      /(?:trabalho\s+(?:com|em|na|no|de|como)\s+([^,.;!?\n]+)|sou\s+(?:médico|médica|engenheiro|engenheira|advogado|advogada|motorista|autônomo|autônoma|empresário|empresária|enfermeiro|enfermeira|professor|professora|pedreiro|estudante|programador|programadora|dev|analista|minerador|mineradora|técnico|técnica|policial|bancário|bancária|vendedor|vendedora)[^,.;!?\n]*)/i
    );

    const pastWorkMatch = textLower.match(
      /(?:trabalhava\s+(?:com|em|na|no|de)\s+([^,.;!?\n]+)|era\s+(?:médico|engenheiro|advogado|motorista|minerador|bancário)[^,.;!?\n]*)/i
    );

    let chosenMatch: RegExpMatchArray | null = null;

    if (presentJobMatch) {
      const idx = textLower.indexOf(presentJobMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        chosenMatch = presentJobMatch;
      }
    } else if (generalWorkMatch) {
      const idx = textLower.indexOf(generalWorkMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        chosenMatch = generalWorkMatch;
      }
    }

    if (chosenMatch) {
      let val = chosenMatch[0].trim();
      val = val.replace(/^(?:(?:hoje|atualmente|agora)\s+)?(?:sou|trabalho\s+(?:com|em|na|no|de))\s+/i, "").trim();
      val = val.replace(/\s+e\s+.*$/i, "").trim();
      if (val.length >= 3) {
        matches.push({
          objectiveId: targetWorkGoal,
          memoryEntity: "self",
          memoryField: "job",
          field: "job",
          value: val,
          evidenceMessageId: messages[0]?.id,
          summary: `trabalho: ${val}`,
        });
      }
    }
  }

  // 2. Relacionamento / Estado Civil (com verificação estrita de negação e entidade)
  const isRelGoal = (id: string) => /relationship|status|estado_civil|relacionamento|solteiro/i.test(id);
  const targetRelGoal = pendingGoalIds.find(isRelGoal);
  if (targetRelGoal) {
    const relMatch = textLower.match(
      /\b(?:tô|sou|estou|fiquei)\s+(?:solteiro|divorciado|separado|viúvo)\b|\b(?:sou|tô)\s+livre\b/i
    );
    if (relMatch) {
      const matchIdx = textLower.indexOf(relMatch[0]);
      const negated = hasNegationPrefix(textLower, matchIdx);
      const thirdParty = isThirdParty(textLower, matchIdx);

      if (!thirdParty) {
        if (negated) {
          // "não sou solteiro" -> não atribui solteiro
          matches.push({
            objectiveId: targetRelGoal,
            memoryEntity: "self",
            memoryField: "relationship_status",
            field: "relationship_status",
            value: "não é solteiro",
            evidenceMessageId: messages[0]?.id,
            summary: "estado civil: não é solteiro",
          });
        } else {
          matches.push({
            objectiveId: targetRelGoal,
            memoryEntity: "self",
            memoryField: "relationship_status",
            field: "relationship_status",
            value: "solteiro",
            evidenceMessageId: messages[0]?.id,
            summary: "estado civil: solteiro",
          });
        }
      }
    }
  }

  // 3. Filhos (has_children vs wants_children)
  const isChildGoal = (id: string) => /has_children|children|filhos|filho|kids/i.test(id) && !/wants_children/i.test(id);
  const isWantsChildGoal = (id: string) => /wants_children|quer_filhos|desejo_filhos/i.test(id);
  const targetChildGoal = pendingGoalIds.find(isChildGoal);
  const targetWantsChildGoal = pendingGoalIds.find(isWantsChildGoal);

  // A. Situação atual sobre ter filhos
  if (targetChildGoal) {
    const noKidsMatch = textLower.match(
      /\b(?:não tenho filhos?|sem filhos?|nem filho|zero filhos?|não sou pai)\b/i
    );
    const hasKidsMatch = textLower.match(
      /\b(?:tenho\s+(?:um|\d+)\s+filhos?|sou pai)\b/i
    );

    if (noKidsMatch) {
      const idx = textLower.indexOf(noKidsMatch[0]);
      if (!isThirdParty(textLower, idx)) {
        matches.push({
          objectiveId: targetChildGoal,
          memoryEntity: "self",
          memoryField: "has_children",
          field: "has_children",
          value: "sem filhos",
          evidenceMessageId: messages[0]?.id,
          summary: "filhos: não tem filhos",
        });
      }
    } else if (hasKidsMatch) {
      const idx = textLower.indexOf(hasKidsMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetChildGoal,
          memoryEntity: "self",
          memoryField: "has_children",
          field: "has_children",
          value: hasKidsMatch[0].trim(),
          evidenceMessageId: messages[0]?.id,
          summary: `filhos: ${hasKidsMatch[0].trim()}`,
        });
      }
    }
  }

  // B. Desejo futuro de ter filhos
  if (targetWantsChildGoal) {
    const wantsKidsMatch = textLower.match(
      /\b(?:quero\s+(?:ter\s+)?(?:filhos?|\d+|um|uma|dois|duas|três|tres|quatro|alguns)|penso\s+em\s+ter\s+filhos?|pretendo\s+ter\s+filhos?)\b/i
    );
    if (wantsKidsMatch) {
      const idx = textLower.indexOf(wantsKidsMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetWantsChildGoal,
          memoryEntity: "self",
          memoryField: "wants_children",
          field: "wants_children",
          value: wantsKidsMatch[0].trim(),
          evidenceMessageId: messages[0]?.id,
          summary: `desejo de filhos: ${wantsKidsMatch[0].trim()}`,
        });
      }
    }
  }

  // 4. Cidade / Localização (sem terceiros e sem locais genéricos)
  const isCityGoal = (id: string) => /city|cidade|local|mora|onde_mora|bairro/i.test(id);
  const targetCityGoal = pendingGoalIds.find(isCityGoal);
  if (targetCityGoal) {
    const cityMatch = textLower.match(
      /\b(?:moro\s+em|sou\s+de|vivo\s+em|aqui\s+em)\s+([^,.;!?\n]+?)(?:\s+(?:e\s+tenho|e\s+trabalho|e\s+sou|e\s+faço|e\s+vivo|mas|há|desde)|[,.;!?\n]|$)/i
    );
    if (cityMatch && !/\b(?:casa|cama|hospital|serviço|trabalho|hotel)\b/i.test(cityMatch[1])) {
      const idx = textLower.indexOf(cityMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        let cityVal = cityMatch[1].trim();
        cityVal = cityVal.replace(/\s+e\s+.*$/i, "").trim();
        if (cityVal.length >= 3) {
          matches.push({
            objectiveId: targetCityGoal,
            memoryEntity: "self",
            memoryField: "city",
            field: "city",
            value: cityVal,
            evidenceMessageId: messages[0]?.id,
            summary: `cidade: ${cityVal}`,
          });
        }
      }
    }
  }

  // 5. Idade (estritamente primeira pessoa no presente, rejeitando passado e terceiros)
  const isAgeGoal = (id: string) => /age|idade|quantos_anos/i.test(id);
  const targetAgeGoal = pendingGoalIds.find(isAgeGoal);
  if (targetAgeGoal) {
    const isPastAge = /\b(?:tinha|era|quando comecei|na época|antigamente|anos atrás)\b/i.test(textLower);
    const ageMatch = textLower.match(/\b(?:tenho|faço|tô com|estou com)\s+(\d{2})\s*(?:anos)?\b/i);
    if (ageMatch && !isPastAge) {
      const idx = textLower.indexOf(ageMatch[0]);
      if (!isThirdParty(textLower, idx) && !hasNegationPrefix(textLower, idx)) {
        matches.push({
          objectiveId: targetAgeGoal,
          memoryEntity: "self",
          memoryField: "age",
          field: "age",
          value: parseInt(ageMatch[1], 10),
          evidenceMessageId: messages[0]?.id,
          summary: `idade: ${ageMatch[1]} anos`,
        });
      }
    }
  }

  return matches;
}
