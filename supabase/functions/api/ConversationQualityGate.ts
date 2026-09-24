export type TurnResponseShape =
  | "answer_only"
  | "answer_and_reciprocate"
  | "react_only"
  | "react_and_question"
  | "free_conversation";

export type DirectAnswerKind =
  | "wellbeing"
  | "current_activity"
  | "persona_fact"
  | "yes_no"
  | "preference"
  | "location"
  | "age"
  | "freeform";

export interface DirectQuestionContract {
  id: string;
  text: string;
  mustAnswer: boolean;
  answerIntent: string;
  answerKind: DirectAnswerKind;
  requiredFacts?: string[];
}

export interface TurnContract {
  directQuestions: DirectQuestionContract[];
  mustAnswerFirst: boolean;
  reactionTarget?: string | null;
  newQuestionBudget: 0 | 1;
  responseShape: TurnResponseShape;
  avoidEchoPhrases: string[];
  avoidTopics?: string[];
  maxBalloons: number;
  preferNoEmoji: boolean;
}

export type ConversationQualityIssueCode =
  | "DIRECT_QUESTION_UNANSWERED"
  | "PARROT_RESPONSE"
  | "QUESTION_ONLY_WHEN_ANSWER_REQUIRED"
  | "QUESTION_BUDGET_EXCEEDED"
  | "UNRELATED_FOLLOWUP"
  | "MISSING_REQUIRED_FACT"
  | "TOO_MANY_BALLOONS_FOR_SIMPLE_TURN"
  | "GENERIC_ASSISTANT_RESPONSE"
  | "MISSING_WELLBEING_QUESTION"
  | "ACCEPTED_OUTING_INVITE"
  | "PHONE_NUMBER_LEAK"
  | "TEXT_DUPLICATES_AUDIO_TRANSCRIPT";

export interface ConversationQualityIssue {
  code: ConversationQualityIssueCode;
  message: string;
}

export interface ConversationQualityResult {
  passed: boolean;
  requiresRetry: boolean;
  issues: ConversationQualityIssue[];
  parrotScore: number;
  newQuestionCount: number;
  directQuestionsDetected: number;
  directQuestionsAnswered: number;
}

const STOPWORDS = new Set([
  "a", "as", "o", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "um", "uma", "que", "com", "pra", "para", "por", "vc", "voce", "eu", "ele", "ela", "me", "te",
]);

function rawNormalize(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:oi+e*|ola|bom dia|boa tarde|boa noite|ah+|nossa|entendi)\b/g, " ")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(value: string): string[] {
  return normalize(value).replace(/\?/g, " ").split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token))
    .map((token) => token.length > 4 ? token.replace(/(?:ando|endo|indo|ou|am|em|o|a)$/i, "") : token);
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / new Set([...a, ...b]).size;
}

export function isGreeting(text: string): boolean {
  const value = rawNormalize(text);
  return /^(?:oi+e*|ola+|opa|e ai|bom dia|boa tarde|boa noite)(?:\s|\?|$)/i.test(value);
}

export function isGreetingOrWellbeing(text: string): boolean {
  return isGreeting(text) || isWellbeingQuestion(text);
}

export const EMOJI_DETECTION_REGEX = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;

export function isPureEmojiMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const raw = String(text).trim();
  if (!raw) return false;

  if (raw.startsWith("[audio:") || raw.startsWith("[image:") || raw.startsWith("[video:") || raw.startsWith("[file:")) {
    return false;
  }

  const withoutEmojis = raw.replace(EMOJI_DETECTION_REGEX, "");
  const remaining = withoutEmojis.replace(/[\s\r\n\t.,!?~_–—\-:;()'"*#@]/g, "");
  const hasEmoji = EMOJI_DETECTION_REGEX.test(raw);
  return hasEmoji && remaining.length === 0;
}

export function isActionableInboundMessage(msg: {
  text?: string | null;
  mediaType?: string | null;
  media_type?: string | null;
  type?: string | null;
  audioTranscript?: string | null;
  audio_transcript?: string | null;
}): boolean {
  const mediaType = String(msg.mediaType || msg.media_type || msg.type || "").toLowerCase();
  const text = String(msg.text || "").trim();
  const transcript = String(msg.audioTranscript || msg.audio_transcript || "").trim();

  // 1. Mensagens de voz/áudio são sempre acionáveis
  if (mediaType === "audio" || text.startsWith("[audio:") || transcript.length > 0) {
    return true;
  }

  // 2. Fotos / Imagens isoladas NÃO são acionáveis
  if (mediaType === "image" || text.startsWith("[image:")) {
    return false;
  }

  // 3. Vídeos ou arquivos isolados NÃO são acionáveis
  if (mediaType === "video" || text.startsWith("[video:") || mediaType === "file" || text.startsWith("[file:")) {
    return false;
  }

  // 4. Mensagens vazias NÃO são acionáveis
  if (!text) {
    return false;
  }

  // 5. Emojis isolados / sozinhos NÃO são acionáveis
  if (isPureEmojiMessage(text)) {
    return false;
  }

  // 6. Texto com conteúdo substantivo real
  return true;
}

function isWellbeingQuestion(text: string): boolean {
  const norm = rawNormalize(text);
  return /\b(?:tudo bem|ta bem|como (?:vc|voce|c|ce) ta|tudo certo|ta tudo bem)\b/.test(norm)
    || /\b(?:bem|tudo|otim[oa]|tranquil[oa]|beleza)\s+e\s+(?:vc|voce)\b/.test(norm)
    || /\be\s+(?:vc|voce)\s+(?:como\s+ta|ta\s+bem)\b/.test(norm);
}

export function isOutingInvite(text: string): boolean {
  const norm = rawNormalize(text);
  return /\b(?:vamos|bora|quer|topa|afim de|animar|anima)\s+(?:sair|tomar|beber|comer|dar uma volta|se ver|ir no cinema|jantar|almocar|marcar|encontrar)\b/i.test(norm)
    || /\b(?:quando|que dia)\s+(?:a gente|vamos)\s+(?:se ver|sair|encontrar)\b/i.test(norm)
    || /\b(?:vamos nos ver|bora se ver|quer sair comigo|vamos sair comigo)\b/i.test(norm);
}

export function detectAcceptedOutingInvite(outbound: string): boolean {
  const norm = rawNormalize(outbound);
  const hasAccept = /\b(?:vamos sim|bora sim|topo sim|vamos marcar sim|onde a gente vai|que horas a gente|posso ir sim|fechado entao|combinado entao|passa aqui|vem aqui)\b/i.test(norm);
  const hasPoliteRefusal = /\b(?:hoje nao consigo|nao dou conta|plantao|estagio|hospital|faculdade|correria|cansad|moida|acabada|outro dia a gente|outra hora|deixar pra outra)\b/i.test(norm);
  return hasAccept && !hasPoliteRefusal;
}

export function isPhoneRequest(text: string): boolean {
  const norm = rawNormalize(text);
  return /\b(?:passa|manda|tem|qual)\s+(?:o|seu)?\s*(?:whats|whatsapp|zap|numero|telefone|contato)\b/i.test(norm)
    || /\b(?:me passa seu|me manda seu|me da seu)\s+(?:whats|whatsapp|zap|numero|telefone)\b/i.test(norm);
}

export function detectPhoneNumberLeak(outbound: string): boolean {
  const norm = rawNormalize(outbound);
  const hasPhonePhrase = /\b(?:meu (?:whats|whatsapp|zap|numero|celular|telefone) e|anota ai|chama la no zap|me chama no zap)\b/i.test(norm);
  const hasPhoneNumberPattern = /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9\d{4}[-\s]?\d{4}\b/.test(outbound);
  return hasPhonePhrase || hasPhoneNumberPattern;
}

/**
 * Detecta determinísticamente se um balão de texto duplica o conteúdo já dito em um áudio do Cofre.
 * Evita a gafe de mandar o áudio falando da faculdade/trabalho e um texto repetindo a mesma coisa.
 */
export function isTextRedundantWithAudioTranscript(text: string, transcript: string): boolean {
  if (!text || !transcript) return false;

  const normalizeForComparison = (s: string) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normText = normalizeForComparison(text);
  const normTranscript = normalizeForComparison(transcript);

  const STOPWORDS = new Set([
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "e", "ou", "que", "com", "por", "pra", "para", "se", "seu", "sua",
    "vc", "voce", "eu", "ele", "ela", "me", "te", "tbm", "tb", "ja",
    "sim", "nao", "mas", "so", "so", "bem", "mais", "muito", "muita"
  ]);

  const textTokens = normText
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  if (textTokens.length === 0) return false;

  let matches = 0;
  for (const token of textTokens) {
    if (normTranscript.includes(token)) {
      matches++;
    }
  }

  const matchRatio = matches / textTokens.length;

  const isFirstPersonStatement = /\b(?:eu|moro|sou|estudo|faco|tenho|trabalho|estagio|plantao|curso|vendo|vendas|minha|meu)\b/i.test(normText);

  // Se mais da metade dos termos substantivos do texto já estão no áudio E é declaração em 1ª pessoa:
  // ou se a sobreposição for extrema (>= 70%):
  if ((isFirstPersonStatement && matchRatio >= 0.45) || matchRatio >= 0.70) {
    return true;
  }

  return false;
}

function extractQuestions(text: string): string[] {
  return String(text || "")
    .split(/(?<=\?)/)
    .map((part) => part.trim())
    .filter((part) => part.includes("?") && normalize(part).replace(/[^a-z0-9]/g, "").trim().length > 0);
}

const DIRECT_ANSWER_KINDS = new Set<DirectAnswerKind>([
  "wellbeing", "current_activity", "persona_fact", "yes_no", "preference", "location", "age", "freeform",
]);

function inferDirectAnswerKind(questionText: string, inbound: string): DirectAnswerKind {
  const question = normalize(questionText);
  const context = normalize(inbound);
  const combined = `${context} ${question}`;
  const elliptical = /\b(?:e vc|e voce)\b/.test(question) || /\b(?:e vc|e voce)\b/.test(context);

  if (isWellbeingQuestion(questionText) || (elliptical && (/\b(?:to|estou|ta|esta)\s+bem\b/.test(context) || isWellbeingQuestion(context)))) return "wellbeing";
  if (/\b(?:quantos anos|qual (?:a )?sua idade|idade)\b/.test(combined) || (elliptical && /\btenho\s+\d{1,3}\s+anos\b/.test(context))) return "age";
  if (/\b(?:onde (?:vc |voce )?mora|mora onde|qual (?:a )?sua cidade)\b/.test(combined) || (elliptical && /\b(?:moro|sou)\s+(?:em|de)\b/.test(context))) return "location";
  if (/\b(?:ja visitou|ja foi|conhece|vc ja|voce ja)\b/.test(question)) return "yes_no";
  if (/\b(?:gosta|curte|prefere|ama)\b/.test(question) || (elliptical && /\b(?:gosto|amo|adoro|prefiro|curto|nao gosto|nao curto)\b/.test(context))) return "preference";
  if (/\b(?:faz estagio de que|estagio de que|qual (?:a )?area do (?:seu )?estagio|qual (?:o )?seu curso|trabalha com o que)\b/.test(combined)) return "persona_fact";
  if (
    /\b(?:ta fazendo o que|esta fazendo o que|fazendo oq|o que vc ta fazendo|o que voce esta fazendo)\b/.test(combined)
    || (elliptical && /\b(?:indo|vou|to|estou|saindo|chegando|trabalhar|academia|estagio|hospital)\b/.test(context))
  ) return "current_activity";
  if (/^(?:vc |voce )?(?:gosta|tem|quer|vai|pode|consegue|faz|e|eh)\b/.test(question)) return "yes_no";
  return "freeform";
}

export function buildTurnContract(
  inboundMessages: string[],
  requested?: Partial<TurnContract> | null
): TurnContract {
  const inbound = inboundMessages.filter(Boolean).join("\n").trim();
  const greeting = isGreetingOrWellbeing(inbound);
  const explicitQuestions = extractQuestions(inbound);
  const detectedQuestions = explicitQuestions.length === 0 && isWellbeingQuestion(inbound) ? [inbound] : explicitQuestions;
  const requestedQuestions = Array.isArray(requested?.directQuestions) ? requested!.directQuestions! : [];
  const directQuestions = requestedQuestions.length > 0
    ? requestedQuestions.map((question, index) => {
        const text = String(question.text || detectedQuestions[index] || "").trim();
        const requestedKind = String(question.answerKind || "") as DirectAnswerKind;
        const inferredKind = inferDirectAnswerKind(text, inbound);
        const answerKind = inferredKind !== "freeform"
          ? inferredKind
          : (DIRECT_ANSWER_KINDS.has(requestedKind) ? requestedKind : "freeform");
        return {
          id: String(question.id || `direct_${index + 1}`),
          text,
          mustAnswer: question.mustAnswer !== false,
          answerIntent: String(question.answerIntent || "Responder diretamente ao que o pretendente perguntou"),
          answerKind,
          requiredFacts: Array.isArray(question.requiredFacts) ? question.requiredFacts.map(String) : [],
        };
      })
    : detectedQuestions.map((text, index) => ({
        id: `direct_${index + 1}`,
        text,
        mustAnswer: true,
        answerIntent: greeting ? "Confirmar como Larissa está" : "Responder diretamente ao que foi perguntado",
        answerKind: inferDirectAnswerKind(text, inbound),
        requiredFacts: [],
      }));

  const shape = requested?.responseShape;
  const hasDirectQuestions = directQuestions.some((question) => question.mustAnswer);
  const mustAnswerFirst = hasDirectQuestions ? true : (requested?.mustAnswerFirst ?? false);

  return {
    directQuestions,
    mustAnswerFirst,
    reactionTarget: requested?.reactionTarget ?? (directQuestions.length === 0 ? inbound || null : null),
    newQuestionBudget: greeting
      ? 1
      : (requested?.newQuestionBudget === 0 || requested?.newQuestionBudget === 1
          ? requested.newQuestionBudget
          : 1),
    responseShape: shape && ["answer_only", "answer_and_reciprocate", "react_only", "react_and_question", "free_conversation"].includes(shape) && !(greeting && shape === "react_only")
      ? (greeting ? (directQuestions.length > 0 ? "answer_and_reciprocate" : "react_and_question") : shape)
      : directQuestions.length > 0
        ? (greeting ? "answer_and_reciprocate" : "answer_only")
        : (greeting || ((requested as any)?.objectiveDirective === "pursue" && requested?.newQuestionBudget !== 0) ? "react_and_question" : "react_only"),
    avoidEchoPhrases: Array.isArray(requested?.avoidEchoPhrases) ? requested!.avoidEchoPhrases!.map(String) : detectedQuestions,
    avoidTopics: Array.isArray(requested?.avoidTopics) ? requested!.avoidTopics!.map(String) : [],
    maxBalloons: Math.max(1, Math.min(4, Number(requested?.maxBalloons || (greeting ? 2 : 4)))),
    preferNoEmoji: requested?.preferNoEmoji ?? false,
  };
}

/** Normaliza um contrato já decidido pelo Brain, sem inferir estratégia conversacional. */
export function normalizeBrainTurnContract(
  requested: Partial<TurnContract> | null | undefined,
  technicalMaxBalloons = 4,
): TurnContract {
  const raw = requested || {};
  return {
    directQuestions: Array.isArray(raw.directQuestions) ? raw.directQuestions.map((question, index) => ({
      id: String(question.id || `direct_${index + 1}`),
      text: String(question.text || ""),
      mustAnswer: question.mustAnswer !== false,
      answerIntent: String(question.answerIntent || "Responder à pergunta direta"),
      answerKind: DIRECT_ANSWER_KINDS.has(question.answerKind as DirectAnswerKind)
        ? question.answerKind as DirectAnswerKind : "freeform",
      requiredFacts: Array.isArray(question.requiredFacts) ? question.requiredFacts.map(String) : [],
    })) : [],
    mustAnswerFirst: raw.mustAnswerFirst === true,
    reactionTarget: raw.reactionTarget ?? null,
    newQuestionBudget: raw.newQuestionBudget === 0 ? 0 : 1,
    responseShape: typeof raw.responseShape === "string" ? raw.responseShape as TurnResponseShape : "free_conversation",
    avoidEchoPhrases: Array.isArray(raw.avoidEchoPhrases) ? raw.avoidEchoPhrases.map(String) : [],
    avoidTopics: Array.isArray(raw.avoidTopics) ? raw.avoidTopics.map(String) : [],
    maxBalloons: Math.max(1, Math.min(technicalMaxBalloons, Number(raw.maxBalloons) || technicalMaxBalloons)),
    preferNoEmoji: raw.preferNoEmoji === true,
  };
}

export function detectParrotResponse(inboundMessages: string[], candidateBalloons: string[]): number {
  const inbound = inboundMessages.join(" ");
  const outbound = candidateBalloons.join(" ");
  const lexicalScore = jaccard(contentTokens(inbound), contentTokens(outbound));
  const inboundNormalized = normalize(inbound).replace(/\?/g, "");
  const outboundNormalized = normalize(outbound).replace(/\?/g, "");
  const sameQuestion = inbound.includes("?") && outbound.includes("?")
    && (inboundNormalized === outboundNormalized
      || inboundNormalized.includes(outboundNormalized)
      || outboundNormalized.includes(inboundNormalized));
  return Math.min(1, sameQuestion ? Math.max(0.95, lexicalScore) : lexicalScore);
}

function containsWellbeingAnswer(text: string): boolean {
  return /\b(?:to|estou|tô)\s+(?:bem|otima|ótima|tranquila|tranquilo)\b/i.test(text)
    || /\b(?:bem sim|tudo certo comigo|ta tudo bem comigo)\b/i.test(text);
}

function containsCurrentActivityAnswer(text: string): boolean {
  const value = normalize(text);
  const firstPerson = /\b(?:to|estou|vou|acabei|cheguei|fico|fiquei|trabalho|estudo|faco|resolvo)\b/.test(value);
  const activity = /\b(?:fazendo|indo|saindo|voltando|trabalh|estagi|estud|resolv|arrum|cheg|casa|hospital|academia|ocupad|descans)\w*\b/.test(value);
  return firstPerson && activity;
}

function containsPersonaFactAnswer(text: string, facts: string[]): boolean {
  if (facts.length > 0) return facts.every((fact) => normalize(text).includes(normalize(fact)));
  return false;
}

function containsYesNoAnswer(text: string): boolean {
  return /\b(?:sim|nao|gosto|nao gosto|tenho|nao tenho|quero|nao quero|vou|nao vou|posso|nao posso|conheco|visitei|ja fui|fui|vou la)\b/.test(normalize(text));
}

function containsPreferenceAnswer(text: string): boolean {
  return /\b(?:eu )?(?:gosto|amo|adoro|prefiro|curto|nao gosto|nao curto)\b/.test(normalize(text));
}

function containsLocationAnswer(text: string, facts: string[]): boolean {
  if (facts.length > 0) return facts.every((fact) => normalize(text).includes(normalize(fact)));
  return /\b(?:moro|sou)\s+(?:em|de)\b/.test(normalize(text)) || /\bfico\s+em\b/.test(normalize(text));
}

function containsAgeAnswer(text: string, facts: string[]): boolean {
  if (facts.length > 0) return facts.every((fact) => normalize(text).includes(normalize(fact)));
  return /\b(?:tenho|fiz)\s+\d{1,3}(?:\s+anos)?\b/.test(normalize(text));
}

function answersDirectQuestion(question: DirectQuestionContract, outbound: string, parrotScore: number): boolean {
  const facts = question.requiredFacts || [];
  switch (question.answerKind) {
    case "wellbeing": return containsWellbeingAnswer(outbound);
    case "current_activity": return containsCurrentActivityAnswer(outbound);
    case "persona_fact": return containsPersonaFactAnswer(outbound, facts);
    case "yes_no": return containsYesNoAnswer(outbound);
    case "preference": return containsPreferenceAnswer(outbound);
    case "location": return containsLocationAnswer(outbound, facts);
    case "age": return containsAgeAnswer(outbound, facts);
    case "freeform":
    default:
      return facts.every((fact) => normalize(outbound).includes(normalize(fact)))
        && !hasOnlyQuestions(outbound)
        && parrotScore < 0.85;
  }
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) || []).length;
}

function hasOnlyQuestions(text: string): boolean {
  const withoutQuestions = normalize(text).replace(/\?/g, " ");
  const declarative = withoutQuestions
    .replace(/\b(?:e vc|e voce|vc|voce|oq|o que|como|qual|onde|quando|porque|por que)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return countQuestions(text) > 0 && contentTokens(declarative).length === 0;
}

export function runConversationQualityGate(params: {
  inboundMessages: string[];
  candidateBalloons: string[];
  turnContract: TurnContract;
}): ConversationQualityResult {
  const { inboundMessages, candidateBalloons, turnContract } = params;
  const inbound = inboundMessages.join(" ");
  const outbound = candidateBalloons.join(" ").trim();
  const issues: ConversationQualityIssue[] = [];
  const add = (code: ConversationQualityIssueCode, message: string) => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
  };
  const questionCount = countQuestions(outbound);
  const parrotScore = detectParrotResponse(inboundMessages, candidateBalloons);
  const wellbeing = isWellbeingQuestion(inbound);
  const requiredQuestions = turnContract.directQuestions.filter((question) => question.mustAnswer);
  let answered = 0;

  for (const question of requiredQuestions) {
    const facts = question.requiredFacts || [];
    const missingFacts = facts.filter((fact) => !normalize(outbound).includes(normalize(fact)));
    const questionAnswered = missingFacts.length === 0 && answersDirectQuestion(question, outbound, parrotScore);
    if (questionAnswered) answered++;
    else add("DIRECT_QUESTION_UNANSWERED", `A pergunta direta não foi respondida: ${question.text}`);
    if (missingFacts.length > 0) {
      add("MISSING_REQUIRED_FACT", `Fato obrigatório ausente: ${missingFacts.join(", ")}`);
    }
  }

  if (requiredQuestions.length > 0 && hasOnlyQuestions(outbound)) {
    add("QUESTION_ONLY_WHEN_ANSWER_REQUIRED", "A resposta contém apenas outra pergunta quando era obrigatório responder primeiro.");
  }
  if (parrotScore >= 0.72) add("PARROT_RESPONSE", "A resposta apenas ecoa ou reformula a fala anterior.");
  if (questionCount > turnContract.newQuestionBudget) {
    add("QUESTION_BUDGET_EXCEEDED", `Foram feitas ${questionCount} perguntas; o limite do turno é ${turnContract.newQuestionBudget}.`);
  }
  if (candidateBalloons.length > turnContract.maxBalloons) {
    add("TOO_MANY_BALLOONS_FOR_SIMPLE_TURN", `Foram usados ${candidateBalloons.length} balões; o limite do turno é ${turnContract.maxBalloons}.`);
  }
  if (isGreetingOrWellbeing(inbound) && questionCount === 0) {
    add("MISSING_WELLBEING_QUESTION", "Toda saudação exige perguntar se o pretendente está bem ou devolver a pergunta reciprocamente.");
  }
  if (isOutingInvite(inbound) && detectAcceptedOutingInvite(outbound)) {
    add("ACCEPTED_OUTING_INVITE", "Larissa nunca aceita convites para sair; deve desviar com gentileza usando sua rotina.");
  }
  if (detectPhoneNumberLeak(outbound)) {
    add("PHONE_NUMBER_LEAK", "Larissa nunca fornece número de telefone ou WhatsApp; deve manter a conversa no Direct.");
  }
  if (wellbeing && /\b(?:como ta seu dia|fez o que hoje|vai fazer o que|ta fazendo o que)\b/i.test(normalize(outbound))) {
    add("UNRELATED_FOLLOWUP", "Saudação simples recebeu uma pergunta genérica não relacionada.");
  }
  if (/\b(?:como posso ajudar|espero que (?:seu|o seu) dia|que bom saber disso|tenha um otimo dia)\b/i.test(normalize(outbound))) {
    add("GENERIC_ASSISTANT_RESPONSE", "A resposta usa fórmula genérica de atendimento sem reação contextual.");
  }
  for (const topic of turnContract.avoidTopics || []) {
    if (normalize(outbound).includes(normalize(topic))) add("UNRELATED_FOLLOWUP", `A resposta introduziu tópico adiado: ${topic}`);
  }

  return {
    passed: issues.length === 0,
    requiresRetry: issues.length > 0,
    issues,
    parrotScore,
    newQuestionCount: questionCount,
    directQuestionsDetected: requiredQuestions.length,
    directQuestionsAnswered: answered,
  };
}

export function safeHighConfidenceFallback(inboundMessages: string[], turnContract: TurnContract): string[] | null {
  const inbound = inboundMessages.join(" ");
  if (isOutingInvite(inbound)) {
    return [
      "ah hoje não consigo sair, o plantão do hospital me deixou moída kkk",
      "mas quem sabe outra hora com calma"
    ];
  }
  if (isPhoneRequest(inbound)) {
    return [
      "vamos continuar conversando por aqui no direct primeiro kkk",
      "pra gente ir se conhecendo melhor, o que vc acha?"
    ];
  }
  if (isGreetingOrWellbeing(inbound)) {
    if (turnContract.mustAnswerFirst || isWellbeingQuestion(inbound)) {
      if (/\b(?:bem|tudo|otim[oa]|tranquil[oa]|beleza)\s+e\s+(?:vc|voce)\b/i.test(rawNormalize(inbound))) {
        return turnContract.newQuestionBudget === 0
          ? ["Tô bem tbm"]
          : ["Tô bem simm, e vc como tá?"];
      }
      return ["Oiii, tô bem simm e vc?"];
    }
    return ["Oiii", "tudo bem com vc?"];
  }
  return null;
}
