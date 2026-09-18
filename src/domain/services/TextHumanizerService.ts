/**
 * Serviço de Domínio: TextHumanizerService
 * 
 * Responsável por auditar e refinar textos segundo padrões industriais de humanização anti-detecção
 * específicos para o dialeto coloquial brasileiro e as regras estritas de persona da Larissa.
 */

export interface HumanizationViolation {
  type: "forbidden_punctuation" | "ai_cliche" | "excessive_formality" | "forbidden_slang";
  description: string;
  match: string;
}

export interface HumanizationReport {
  score: number; // 0 a 100
  isCompliant: boolean;
  violations: HumanizationViolation[];
  metrics: {
    wordCount: number;
    forbiddenPunctuationCount: number;
    aiClicheCount: number;
    hasOnlyAllowedPunctuation: boolean;
  };
}

// Lista negra de termos sintéticos e clichês clássicos de modelos de linguagem (IA)
const AI_CLICHES = [
  "além disso",
  "em suma",
  "em conclusão",
  "vale ressaltar",
  "vale destacar",
  "é importante notar",
  "certamente",
  "com certeza",
  "de fato",
  "compreendo perfeitamente",
  "entendo perfeitamente",
  "sinto muito por isso",
  "fico muito feliz",
  "espero que seu dia",
  "espero que você esteja",
  "espero ter ajudado",
  "tenha um excelente",
  "tenha um ótimo",
  "não hesite em",
  "estou à disposição",
  "que interessante",
  "que bacana",
  "que legal",
  "adorei saber",
  "ótimo ponto",
  "faz total sentido",
  "deve ser muito gratificante",
];

// Termos e gírias caricatas ou muletas turísticas proibidas
const FORBIDDEN_SLANGS = [
  "minha terrinha",
  "chão pra mais de metro",
  "esses lados do interior",
  "já veio pra esses lados",
  "já veio passear aqui",
  "uai",
  "trem",
  "responsa",
  "galanteador",
  "moçoila",
  // Gírias masculinas de "parça/brother" inadequadas para mulher jovem
  "trocar ideia",
  "trocar uma ideia",
  "trocar ideias",
  "trocar ideia contigo",
  "trocar uma ideia contigo",
  "papo reto",
  "firmeza",
  "brother",
  "mano",
  "parça",
  "muleke",
  "trampo",
  "trampos",
  "trampar",
  "agitada boa",
  "dar uma agitada",
  "fechou",
  "tamo junto",
  "vamos conversando por aqui sim com calma",
  "vamos conversando com calma",
  "contigo",
];

export class TextHumanizerService {
  /**
   * Avalia a conformidade de um texto com as métricas de humanização e a persona da Larissa
   */
  static evaluate(text: string): HumanizationReport {
    const trimmed = text.trim();
    const violations: HumanizationViolation[] = [];

    if (!trimmed) {
      return {
        score: 100,
        isCompliant: true,
        violations: [],
        metrics: {
          wordCount: 0,
          forbiddenPunctuationCount: 0,
          aiClicheCount: 0,
          hasOnlyAllowedPunctuation: true,
        },
      };
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // 1. Verificação de Pontuações Proibidas (. ! ; : ...)
    let forbiddenPunctuationCount = 0;

    // Ponto final (.) não permitido
    const periodMatches = trimmed.match(/\./g);
    if (periodMatches) {
      forbiddenPunctuationCount += periodMatches.length;
      violations.push({
        type: "forbidden_punctuation",
        description: "Contém ponto final (.), que quebra a regra de pontuação estrita",
        match: `${periodMatches.length} ponto(s) final(is)`,
      });
    }

    // Ponto de exclamação (!) não permitido
    const exclamationMatches = trimmed.match(/!/g);
    if (exclamationMatches) {
      forbiddenPunctuationCount += exclamationMatches.length;
      violations.push({
        type: "forbidden_punctuation",
        description: "Contém ponto de exclamação (!), soa formal ou artificial",
        match: `${exclamationMatches.length} exclamação(ões)`,
      });
    }

    // Reticências (...) ou ponto e vírgula (;) ou dois pontos (:)
    const otherPunctuationMatches = trimmed.match(/[;:…]/g);
    if (otherPunctuationMatches) {
      forbiddenPunctuationCount += otherPunctuationMatches.length;
      violations.push({
        type: "forbidden_punctuation",
        description: "Contém pontuação proibida (; ou : ou …)",
        match: otherPunctuationMatches.join(", "),
      });
    }

    // 2. Verificação de Clichês de IA
    const lower = trimmed.toLowerCase();
    let aiClicheCount = 0;

    for (const cliche of AI_CLICHES) {
      if (lower.includes(cliche)) {
        aiClicheCount++;
        violations.push({
          type: "ai_cliche",
          description: `Expressão com forte marca sintética de IA: "${cliche}"`,
          match: cliche,
        });
      }
    }

    // 3. Verificação de Gírias Forçadas / Muletas
    let forbiddenSlangCount = 0;
    for (const slang of FORBIDDEN_SLANGS) {
      if (lower.includes(slang)) {
        forbiddenSlangCount++;
        violations.push({
          type: "forbidden_slang",
          description: `Gíria ou expressão proibida: "${slang}"`,
          match: slang,
        });
      }
    }

    // 4. Cálculo de Deduções
    let deductions = 0;

    // 4.1 Verificação de "kkk" fora de contexto em cumprimentos ou dados neutros
    const inappropriateKkkRegex = /(?:bom dia|boa tarde|boa noite|tudo bem|sou de|moro em|tenho \d+ anos|faço enfermagem|descansando)\s*,?\s*kkk+/i;
    if (inappropriateKkkRegex.test(lower)) {
      violations.push({
        type: "ai_cliche",
        description: "Contém risada ('kkk') fora de contexto em cumprimento ou frase neutra",
        match: "kkk em momento neutro",
      });
      deductions += 15;
    }

    // 5. Cálculo de Score Ponderado (0 a 100)
    deductions += forbiddenPunctuationCount * 15; // Cada pontuação errada tira 15 pts
    deductions += aiClicheCount * 25; // Cada clichê tira 25 pts
    deductions += forbiddenSlangCount * 25; // Cada termo proibido tira 25 pts
    if (wordCount > 40) deductions += 15; // Frase excessivamente longa tira 15 pts

    const score = Math.max(0, Math.min(100, 100 - deductions));
    const isCompliant = score >= 90 && forbiddenPunctuationCount === 0 && aiClicheCount === 0 && forbiddenSlangCount === 0;

    return {
      score,
      isCompliant,
      violations,
      metrics: {
        wordCount,
        forbiddenPunctuationCount,
        aiClicheCount,
        hasOnlyAllowedPunctuation: forbiddenPunctuationCount === 0,
      },
    };
  }

  /**
   * Higieniza e humaniza o texto automaticamente:
   * - Converte pontos finais e exclamações em vírgula ou remove no final
   * - Remove reticências e pontuações formais
   * - Ajusta inicial para estilo natural
   * - Elimina clichês de IA residuais
   * - Remove "kkk" fora de contexto em cumprimentos ou frases neutras
   */
  static sanitize(text: string): string {
    if (!text) return "";

    let result = text.trim();

    // 1. Remove aspas externas se houver
    result = result.replace(/^[\"']+|[\"']+$/g, "");

    // 2. Remove pontuações finais rígidas
    result = result.replace(/[.!;:]+$/g, "");

    // 3. Substitui reticências no meio por vírgula
    result = result.replace(/\.{2,}|…/g, ",");

    // 4. Substitui pontos finais e exclamações internos seguidos de espaço por vírgula
    result = result.replace(/[.!;:]\s+/g, ", ");

    // 5. Remove "kkk" fora de contexto em cumprimentos e relatos cotidianos neutros
    result = result.replace(/(?<=\b(?:bom dia|boa tarde|boa noite|oii?|tudo bem|tudo bom|(?:sou|moro)\s+(?:daqui\s+de|de|em)\s+[^,!?]+|tenho \d+ anos|faço enfermagem|descansando[^,!?]*|trabalhando[^,!?]*|estudando[^,!?]*))\s*,?\s*kkk+/gi, "");
    result = result.replace(/^(sim|não|simm|nao)\s*,?\s*kkk+$/gi, "$1");

    // 5.1 Substitui jargões masculinos de "parça" e burocracias de IA por linguagem feminina jovem
    result = result.replace(/\b(nossa\s+)?que\s+legal\s+que\b/gi, "que bom que");
    result = result.replace(/\bque\s+legal\b/gi, "que bom");
    result = result.replace(/\bque\s+bacana\b/gi, "que bom");
    result = result.replace(/\btrampo\s+novo\b/gi, "serviço novo");
    result = result.replace(/\btrampos?\b/gi, "serviço");
    result = result.replace(/\btrampar\b/gi, "trabalhar");
    result = result.replace(/\b(dar\s+uma\s+)?agitada\s+boa\b/gi, "ser bem puxado");
    result = result.replace(/\bdar\s+uma\s+agitada\b/gi, "ser bem puxado");
    result = result.replace(/\btrocar\s+uma?\s+ideia\s+contigo\b/gi, "bater um papo com vc");
    result = result.replace(/\btrocar\s+uma?\s+ideia\s+com\s+voc[eê]\b/gi, "bater um papo com vc");
    result = result.replace(/\btrocar\s+uma?\s+ideia\b/gi, "conversar");
    result = result.replace(/\btrocar\s+ideias?\b/gi, "conversar");
    result = result.replace(/\bvamos\s+conversando\s+por\s+aqui\s+sim\s+com\s+calma\b/gi, "vamos nos falando por aqui simm");
    result = result.replace(/\bvamos\s+conversando\s+com\s+calma\b/gi, "vamos nos conhecendo aos pouquinhos");
    result = result.replace(/\bcontigo\b/gi, "com vc");
    result = result.replace(/\b(mano|parça|brother|muleke)\b/gi, "");

    // 6. Normaliza múltiplas vírgulas
    result = result.replace(/,\s*,+/g, ",");

    // 7. Remove vírgula antes de interrogação
    result = result.replace(/,\s*\?/g, "?");

    // 8. Remove vírgula solta no início ou fim
    result = result.replace(/^,\s*/, "").replace(/,\s*$/, "");

    // 9. Limpa espaços duplos
    result = result.replace(/\s{2,}/g, " ").trim();

    return result;
  }
}
