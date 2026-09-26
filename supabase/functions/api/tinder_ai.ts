import { LARISSA_CANONICAL_PROMPT } from "./larissa_canonical_prompt.generated.ts";

export interface TinderMatchData {
  match_id: string;
  name: string;
  birth_date?: string | null;
  city?: string | null;
  bio?: string | null;
  person_id?: string | null;
  last_message_preview?: string | null;
}

export interface TinderMessageData {
  id: string;
  match_id: string;
  sender_id: string;
  message: string;
  sent_date?: string | null;
}

export interface TinderConfigData {
  instagram_handle?: string | null;
  user_id?: string | null;
}

export interface SaoPauloDateTime {
  formattedDate: string;
  formattedTime: string;
  weekday: string;
  period: "manhã" | "tarde" | "noite";
  greeting: "Bom dia" | "Boa tarde" | "Boa noite";
  greetingInformal: "Bom diaa" | "Boa tardee" | "Boa noitee";
}

export function getSaoPauloDateTime(input?: Date | string | number | null): SaoPauloDateTime {
  const d = input ? new Date(input) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  });

  const parts = formatter.formatToParts(validDate);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const year = Number(partMap.year) || validDate.getUTCFullYear();
  const month = Number(partMap.month) || (validDate.getUTCMonth() + 1);
  const day = Number(partMap.day) || validDate.getUTCDate();
  const hour = Number(partMap.hour) || 0;
  const minute = Number(partMap.minute) || 0;
  const weekday = partMap.weekday || "hoje";

  const formattedDate = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  const formattedTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  let period: "manhã" | "tarde" | "noite" = "manhã";
  let greeting: "Bom dia" | "Boa tarde" | "Boa noite" = "Bom dia";
  let greetingInformal: "Bom diaa" | "Boa tardee" | "Boa noitee" = "Bom diaa";

  if (hour >= 5 && hour < 12) {
    period = "manhã";
    greeting = "Bom dia";
    greetingInformal = "Bom diaa";
  } else if (hour >= 12 && hour < 18) {
    period = "tarde";
    greeting = "Boa tarde";
    greetingInformal = "Boa tardee";
  } else {
    period = "noite";
    greeting = "Boa noite";
    greetingInformal = "Boa noitee";
  }

  return { formattedDate, formattedTime, weekday, period, greeting, greetingInformal };
}

export function calculateAge(birthDateStr?: string | null): number | null {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return null;
  const diff = Date.now() - birth.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export function sanitizeResponseText(raw: string): string {
  return raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/[.;!]+$/, "") // remove ponto final ou exclamação no final para manter o estilo de direct
    .trim();
}

export function parseFirstJsonObject(text: string): any {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      const slice = text.slice(start, index + 1);
      const sanitized = slice
        .replace(/"indices"\s*:\s*\[\s*,+\s*\]/g, '"indices": []')
        .replace(/,\s*([\]}])/g, "$1")
        .replace(/\[\s*,+/g, "[")
        .replace(/,\s*,+/g, ",");
      try {
        return JSON.parse(sanitized);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildTinderAiPromptForBackend(
  match: TinderMatchData,
  messages: TinderMessageData[],
  config: TinderConfigData | null
): string {
  const age = calculateAge(match.birth_date);
  const nowSp = getSaoPauloDateTime(new Date());
  const isOutbound = (message: TinderMessageData) => message.sender_id === "me" ||
    (config?.user_id ? message.sender_id === config.user_id :
      (match.person_id ? message.sender_id !== match.person_id : false));
  const history = messages.slice(-500).map((message) =>
    `[${isOutbound(message) ? "Larissa" : match.name} | ${message.sent_date || "sem data"}]: ${message.message}`
  ).join("\n");
  const lastInbound = [...messages].reverse().find((message) => !isOutbound(message));

  return `${LARISSA_CANONICAL_PROMPT}

## CONTEXTO VARIÁVEL DESTA CONVERSA
Plataforma: Tinder
Nome: ${match.name}
Idade conhecida: ${age ?? "não informada"}
Cidade conhecida: ${match.city || "não informada"}
Bio: ${match.bio || "não informada"}
Horário local: ${nowSp.weekday}, ${nowSp.formattedDate}, ${nowSp.formattedTime} (${nowSp.period})

## HISTÓRICO EM ORDEM CRONOLÓGICA
${history || "Ainda não há mensagens trocadas."}

## MENSAGEM MAIS RECENTE DO PRETENDENTE
${lastInbound?.message || match.last_message_preview || "Novo match no Tinder"}

Responda usando o contrato JSON definido nas instruções canônicas. Considere todo o histórico acima e não invente informações ausentes.
`;
}
