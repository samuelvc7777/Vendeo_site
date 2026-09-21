export type TurnResponseShape =
  | "answer_only"
  | "answer_and_reciprocate"
  | "react_only"
  | "react_and_question"
  | "free_conversation";

export interface DirectQuestionContract {
  id: string;
  text: string;
  mustAnswer: boolean;
  answerIntent: string;
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
  | "GENERIC_ASSISTANT_RESPONSE";

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

export function isGreetingOrWellbeing(text: string): boolean {
  const value = normalize(text);
  return isWellbeingQuestion(text)
    || /^(?:oi+e*|ola)(?:\s|\?|$)/.test(String(text || "").trim().toLowerCase());
}

function isWellbeingQuestion(text: string): boolean {
  return /\b(?:tudo bem|ta bem|como vc ta|como voce ta|tudo certo|ta tudo bem)\b/.test(normalize(text));
}

function extractQuestions(text: string): string[] {
  return String(text || "").split(/(?<=\?)/).map((part) => part.trim()).filter((part) => part.includes("?"));
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
    ? requestedQuestions.map((question, index) => ({
        id: String(question.id || `direct_${index + 1}`),
        text: String(question.text || detectedQuestions[index] || "").trim(),
        mustAnswer: question.mustAnswer !== false,
        answerIntent: String(question.answerIntent || "Responder diretamente ao que o pretendente perguntou"),
        requiredFacts: Array.isArray(question.requiredFacts) ? question.requiredFacts.map(String) : [],
      }))
    : detectedQuestions.map((text, index) => ({
        id: `direct_${index + 1}`,
        text,
        mustAnswer: true,
        answerIntent: greeting ? "Confirmar como Larissa está" : "Responder diretamente ao que foi perguntado",
        requiredFacts: [],
      }));

  const shape = requested?.responseShape;
  return {
    directQuestions,
    mustAnswerFirst: requested?.mustAnswerFirst ?? directQuestions.some((question) => question.mustAnswer),
    reactionTarget: requested?.reactionTarget ?? (directQuestions.length === 0 ? inbound || null : null),
    newQuestionBudget: requested?.newQuestionBudget === 0 || requested?.newQuestionBudget === 1
      ? requested.newQuestionBudget
      : 1,
    responseShape: shape && ["answer_only", "answer_and_reciprocate", "react_only", "react_and_question", "free_conversation"].includes(shape)
      ? shape
      : directQuestions.length > 0
        ? (greeting ? "answer_and_reciprocate" : "answer_only")
        : "react_only",
    avoidEchoPhrases: Array.isArray(requested?.avoidEchoPhrases) ? requested!.avoidEchoPhrases!.map(String) : detectedQuestions,
    avoidTopics: Array.isArray(requested?.avoidTopics) ? requested!.avoidTopics!.map(String) : [],
    maxBalloons: Math.max(1, Math.min(4, Number(requested?.maxBalloons || (greeting ? 1 : 4)))),
    preferNoEmoji: requested?.preferNoEmoji ?? greeting,
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
    const questionAnswered = wellbeing
      ? containsWellbeingAnswer(outbound)
      : missingFacts.length === 0 && !hasOnlyQuestions(outbound) && parrotScore < 0.85;
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
  if (isGreetingOrWellbeing(inbound) && turnContract.mustAnswerFirst) return ["Oii, tô bem sim, e vc?"];
  return null;
}
