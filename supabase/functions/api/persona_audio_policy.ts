export type PersonaAudioTopic = "hobbies" | "work_study" | "relationship" | "age" | "origin_city";

export interface PersonaAudioContextMessage {
  sender?: string;
  isMine?: boolean;
  text?: string;
  createdAt?: string | number | Date | null;
}

export interface PersonaAudioTopicIntent {
  topic: PersonaAudioTopic;
  searchQuery: string;
}

const TOPIC_SEARCH_QUERIES: Record<PersonaAudioTopic, string> = {
  hobbies: "hobbies gostos o que gosto de fazer tempo livre passeios viagens filmes",
  work_study: "profissão trabalho estudos faculdade curso enfermagem rotina",
  relationship: "relacionamento namorei namoro experiência amorosa",
  age: "idade quantos anos aniversário",
  origin_city: "cidade origem onde moro de onde sou",
};

function normalize(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function messageIsFromPersona(message: PersonaAudioContextMessage): boolean {
  const sender = normalize(message.sender || "");
  return message.isMine === true || ["larissa", "assistant", "out", "me"].includes(sender);
}

function inferTopicFromQuestion(text: string): PersonaAudioTopic | null {
  const value = normalize(text);
  if (/\b(quanto(s)? anos|qual sua idade|que idade|faz aniversario)\b/.test(value)) return "age";
  if (/\b(namorou|relacionamento|ex namorado|ja teve namorado|estado civil)\b/.test(value)) return "relationship";
  if (/\b(o que faz da vida|com o que trabalha|trabalha|profissao|estuda|faculdade|curso|estagio|rotina de trabalho)\b/.test(value)) return "work_study";
  if (/\b(de onde voce e|de onde vc e|onde voce mora|onde vc mora|sua cidade|qual sua cidade)\b/.test(value)) return "origin_city";
  if (/\b(o que gosta de fazer|oq gosta de fazer|gosta de fazer|tempo livre|hobbies|hobby|o que voce curte|oq vc curte|o que curte fazer)\b/.test(value)) return "hobbies";
  return null;
}

function isReciprocalQuestion(text: string): boolean {
  const value = normalize(text);
  return /(^|\s)(e vc|e voce|e tu|e voce\?)(\s|\?|$)/.test(value);
}

function timestampMs(value: PersonaAudioContextMessage["createdAt"]): number | null {
  if (value == null) return null;
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

/**
 * Finds a clear reciprocal turn where the prospect answered a personal question
 * and returned it with "e você?". Only recent questions count, so stale topics
 * never trigger an unrelated voice message.
 */
export function inferReciprocalPersonaAudioIntent(params: {
  inboundTexts: string[];
  recentMessages: PersonaAudioContextMessage[];
  now?: Date | number;
}): PersonaAudioTopicIntent | null {
  const inbound = normalize(params.inboundTexts.join(" "));
  if (!inbound || !isReciprocalQuestion(inbound)) return null;

  const nowMs = params.now instanceof Date ? params.now.getTime() : Number(params.now ?? Date.now());
  const cutoff = nowMs - 48 * 60 * 60 * 1000;
  const recentPersonaQuestions = params.recentMessages
    .filter((message) => messageIsFromPersona(message) && typeof message.text === "string")
    .filter((message) => {
      const at = timestampMs(message.createdAt);
      return at == null || (at <= nowMs && at >= cutoff);
    })
    .map((message) => ({ message, topic: inferTopicFromQuestion(message.text || "") }))
    .filter((item): item is { message: PersonaAudioContextMessage; topic: PersonaAudioTopic } => item.topic !== null);

  const topic = recentPersonaQuestions.at(-1)?.topic;
  return topic ? { topic, searchQuery: TOPIC_SEARCH_QUERIES[topic] } : null;
}

/** Selects only a candidate whose recorded usage instruction explicitly matches the inferred topic. */
export function isPersonaAudioInstructionMatch(topic: PersonaAudioTopic, usageInstruction: string): boolean {
  const instruction = normalize(usageInstruction);
  if (!instruction) return false;

  const patterns: Record<PersonaAudioTopic, RegExp> = {
    hobbies: /\b(hobb|gosto(s)? de fazer|tempo livre|passatempo|o que gosto de fazer)\b/,
    work_study: /\b(profissao|trabalh|faculdade|estud|curso|enfermagem|estagio|rotina)\b/,
    relationship: /\b(relacionamento|namor|estado civil)\b/,
    age: /\b(idade|anos|aniversario)\b/,
    origin_city: /\b(cidade|origem|onde moro|de onde sou|moro)\b/,
  };
  return patterns[topic].test(instruction);
}
