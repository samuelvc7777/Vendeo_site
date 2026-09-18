import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
  * Formata timestamps com precisão garantindo o fuso horário oficial do Brasil (Horário de Brasília - UTC-3)
  */
export function formatMessageTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "Recentemente";

  // Se já for uma hora pura (ex: "08:53" ou "14:20"), retorna direto
  if (typeof dateInput === "string" && /^\d{2}:\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }

  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      return typeof dateInput === "string" ? dateInput : "Recentemente";
    }

    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "Recentemente";
  }
}

/**
 * Converte qualquer formato de timestamp (ISO string, SQL timestamp, epoch ms, epoch s, Date) para milissegundos numéricos.
 * Garante que ordenações (tA - tB) NUNCA resultem em NaN e preservem a cronologia real entre dias diferentes.
 */
export function getMessageTimestampMs(dateInput?: string | number | Date | null): number {
  if (!dateInput) return 0;
  if (typeof dateInput === "number" && !isNaN(dateInput)) {
    return dateInput < 10000000000 ? dateInput * 1000 : dateInput;
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.getTime();
  }
  if (typeof dateInput === "string" && dateInput.trim()) {
    const trimmed = dateInput.trim();
    // Se for string numérica pura (ex: "1787071416000" ou "1787071416")
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) {
      return num < 10000000000 ? num * 1000 : num;
    }

    // Normaliza formato SQL "2026-09-13 19:51:50+00" ou com microssegundos para ISO-8601 compatível
    let isoCandidate = trimmed;
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(isoCandidate)) {
      isoCandidate = isoCandidate.replace(" ", "T");
      if (/[+-]\d{2}$/.test(isoCandidate)) {
        isoCandidate = isoCandidate + ":00";
      }
    }

    const parsed = new Date(isoCandidate).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }

    // Se for apenas formato "HH:mm", calcula a data de hoje explicitamente no fuso de Brasília
    const timeMatch = trimmed.match(/^(\d{2}):(\d{2})$/);
    if (timeMatch) {
      const now = new Date();
      const brDayStr = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
      const brIso = `${brDayStr}T${timeMatch[1]}:${timeMatch[2]}:00-03:00`;
      const t = new Date(brIso).getTime();
      if (!isNaN(t)) return t;
    }
  }
  return 0;
}

/**
 * Formata data e hora contextual com inteligência de dias ("hoje às 14:42", "ontem às 17:42", "13/09 às 16:51")
 * respeitando estritamente o fuso horário oficial de Brasília (America/Sao_Paulo - UTC-3).
 */
export function formatMessageDateTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "Recentemente";
  const ms = getMessageTimestampMs(dateInput);
  if (!ms) return typeof dateInput === "string" ? dateInput : "Recentemente";

  const date = new Date(ms);
  const now = new Date();

  const msgDayKey = date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = yesterday.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const timeStr = date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (msgDayKey === todayKey) {
    return `hoje às ${timeStr}`;
  }
  if (msgDayKey === yesterdayKey) {
    return `ontem às ${timeStr}`;
  }

  const dayMonthStr = date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });

  return `${dayMonthStr} às ${timeStr}`;
}

/**
 * Retorna a chave do dia no formato "YYYY-MM-DD" com base no fuso de Brasília (America/Sao_Paulo).
 */
export function getMessageDayKey(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "";
  const ms = getMessageTimestampMs(dateInput);
  if (!ms) return "";
  const date = new Date(ms);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Formata o divisor de data no estilo nativo do Instagram:
 * - "Hoje"
 * - "Ontem"
 * - "Sábado, 5 de set." (se nos últimos 6 dias)
 * - "5 de setembro" (se no mesmo ano)
 * - "5 de setembro de 2025" (se em outro ano)
 */
export function formatChatDateDivider(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "";
  const ms = getMessageTimestampMs(dateInput);
  if (!ms) return "";
  const date = new Date(ms);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const dateKey = getMessageDayKey(date);
  const todayKey = getMessageDayKey(now);

  if (dateKey === todayKey) {
    return "Hoje";
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = getMessageDayKey(yesterday);
  if (dateKey === yesterdayKey) {
    return "Ontem";
  }

  // Diferença em dias baseado nas datas YYYY-MM-DD
  const diffDays = Math.round((new Date(todayKey).getTime() - new Date(dateKey).getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays > 1 && diffDays < 7) {
    const weekday = date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
    });
    const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    const dayAndMonth = date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "short",
    });
    return `${capitalizedWeekday}, ${dayAndMonth}`;
  }

  const dateYear = date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
  const currentYear = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });

  if (dateYear === currentYear) {
    return date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "long",
    });
  }

  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Formata o divisor de data para os blocos da caixa de entrada (lista de conversas):
 * - "Hoje"
 * - "Ontem"
 * - "Terça-feira", "Segunda-feira", etc. (dias recentes da semana)
 * - "5 de setembro" (mesmo ano)
 * - "5 de setembro de 2025" (anos anteriores)
 */
export function formatInboxDateDivider(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "";
  const ms = getMessageTimestampMs(dateInput);
  if (!ms) return "";
  const date = new Date(ms);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const dateKey = getMessageDayKey(date);
  const todayKey = getMessageDayKey(now);

  if (dateKey === todayKey) {
    return "Hoje";
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = getMessageDayKey(yesterday);
  if (dateKey === yesterdayKey) {
    return "Ontem";
  }

  const diffDays = Math.round((new Date(todayKey).getTime() - new Date(dateKey).getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays > 1 && diffDays < 7) {
    const weekday = date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
    });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }

  const dateYear = date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
  const currentYear = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });

  if (dateYear === currentYear) {
    return date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "long",
    });
  }

  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Retorna o tempo de cadência humana em segundos para uma mensagem:
 * - Se for áudio ([audio:URL]), obtém a duração exata do arquivo de áudio (entre 2s e 60s, fallback de 10s).
 * - Se for texto ou imagem, adota 10 segundos de digitação/leitura humana.
 */
export async function getMessageCadenceSeconds(text?: string | null): Promise<number> {
  if (!text) return 10;
  const trimmed = text.trim();
  const audioMatch = trimmed.match(/^\[audio:(.+?)\]$/);
  if (audioMatch && audioMatch[1]) {
    const audioUrl = audioMatch[1].trim();
    if (typeof window !== "undefined" && (audioUrl.startsWith("http") || audioUrl.startsWith("/"))) {
      try {
        return await new Promise<number>((resolve) => {
          const audio = new Audio();
          audio.preload = "metadata";
          const timeout = setTimeout(() => resolve(10), 2000);
          audio.onloadedmetadata = () => {
            clearTimeout(timeout);
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              resolve(Math.min(Math.max(Math.round(audio.duration), 2), 60));
            } else {
              resolve(10);
            }
          };
          audio.onerror = () => {
            clearTimeout(timeout);
            resolve(10);
          };
          audio.src = audioUrl;
        });
      } catch {
        return 10;
      }
    }
    return 10;
  }
  // Para texto ou foto: sempre 10 segundos de cadência humana
  return 10;
}



