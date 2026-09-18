export type TurnPolicyAction =
  | "call_persona"
  | "send_checklist_batch"
  | "pause_handoff"
  | "pause_guardrail";

export interface TurnPolicyDecision {
  action: TurnPolicyAction;
  checklistGoalIds: string[];
  mediaItems: ChecklistPolicyItem[];
  reason: string;
  pauseReason?: string;
}

export interface ChecklistPolicyItem {
  id: string;
  type: "text" | "audio" | "image";
  title?: string;
  content?: string;
  mediaUrl?: string;
  linkedItemId?: string;
  isCompleted: boolean;
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mídia pessoal é irreversível e muito mais invasiva que texto. Por isso a
 * decisão semântica da Atria precisa ser acompanhada de evidência explícita na
 * última fala do contato. Em caso de dúvida, a conversa continua pelo Sol.
 */
export function hasExplicitPersonalMediaOpening(latestContactText: string): boolean {
  const text = normalize(latestContactText);
  if (!text) return false;
  return [
    /\be (?:vc|voce)\b/,
    /\b(?:e|mas e) (?:sobre|de) (?:vc|voce)\b/,
    /\b(?:vc|voce) (?:faz|trabalha|estuda|gosta|curte|mora|tem quantos anos|e de onde)\b/,
    /\b(?:o que|oq) (?:vc|voce) (?:faz|gosta|curte|estuda)\b/,
    /\b(?:me fala|fala|me conta|conta) (?:mais )?(?:de|sobre) (?:vc|voce)\b/,
    /\b(?:quem e|como e) (?:vc|voce)\b/,
    /\b(?:manda|envia|grava) (?:um )?audio\b/,
    /\b(?:quero|queria) (?:te )?(?:ouvir|conhecer)\b/,
    // Respostas afirmativas ou incentivo a falar sobre si (após provocação da Larissa):
    /\b(?:fala|conta|manda|diga) (?:ai|logo|ai entao|sobre vc|de vc|pra mim)?\b/,
    /\b(?:pode|deve|quero|queria) (?:falar|contar|mandar|saber|ouvir)\b/,
    /\b(?:sou todo ouvidos|fiquei curioso|curioso pra saber|quero saber)\b/,
    /\b(?:verdade|esqueci|foi mal|desculpa|nem perguntei) (?:kk+|rs+|ne)?\b/,
    /\b(?:manda ver|solta o verbo|claro|com certeza)\b/,
    /\b(?:pode mandar|manda ai|manda ai entao)\b/,
  ].some((pattern) => pattern.test(text));
}

function guardrail(reason: string): TurnPolicyDecision {
  return {
    action: "pause_guardrail",
    checklistGoalIds: [],
    mediaItems: [],
    reason,
    pauseReason: reason,
  };
}

/**
 * Normaliza o motivo estratégico gerado pela Atria ou por fallbacks.
 * Impede que strings vazias, reticências ('...'), pontuações ou textos vagos vazem
 * para o painel do operador ou para as diretrizes da persona.
 */
export function normalizeSemanticReason(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.trim();
  if (!cleaned || /^[\s.·…\-–—_~*#]+$/.test(cleaned) || cleaned.length < 5) {
    return fallback;
  }
  return cleaned.slice(0, 500);
}

/**
 * Resolve itens de texto vinculados (combo de perguntas) bidirecionalmente.
 * Se o item possui linkedItemId ou se outro item aponta para ele, ambos são agrupados.
 */
export function resolveLinkedTextGoals(
  primaryItem: ChecklistPolicyItem,
  allPending: ChecklistPolicyItem[],
): string[] {
  const goals: string[] = [primaryItem.id];
  const byId = new Map(allPending.map((it) => [it.id, it]));

  // 1. Vínculo direto pelo linkedItemId do item principal
  if (primaryItem.linkedItemId) {
    const linked = byId.get(primaryItem.linkedItemId);
    if (linked && linked.type === "text" && !linked.isCompleted && !goals.includes(linked.id)) {
      goals.push(linked.id);
    }
  }

  // 2. Vínculo reverso (outro item que aponta para o item principal)
  for (const it of allPending) {
    if (
      it.type === "text" &&
      !it.isCompleted &&
      it.linkedItemId === primaryItem.id &&
      !goals.includes(it.id)
    ) {
      goals.push(it.id);
    }
  }

  return goals;
}

/**
 * Fronteira de confiança entre o plano probabilístico da Atria e os efeitos
 * externos. Texto do cofre vira objetivo para o Sol; somente mídia aprovada
 * pode atravessar diretamente para o executor.
 */
export function validateAtriaTurnDecision(
  raw: unknown,
  checklist: ChecklistPolicyItem[],
  latestContactText: string,
): TurnPolicyDecision {
  const decision =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pending = checklist.filter((item) => !item.isCompleted);
  const next = pending[0] || null;
  const action = String(decision.action || "");

  const defaultSolReason = next && next.type === "audio"
    ? "O pretendente interagiu naturalmente mas ainda não perguntou sobre a Larissa. Responder ao que ele disse e soltar a isca sutil sobre ela antes de autorizar o áudio gravado."
    : next && next.type === "text"
      ? `Responder ao contato com calor humano autêntico e conduzir para o objetivo: ${next.title || "próximo tema"}.`
      : "Validar os assuntos recentes do contato com calor humano autêntico, mantendo o ritmo leve e autêntico.";

  const reason = normalizeSemanticReason(decision.reason, defaultSolReason);

  if (action === "pause_handoff" || action === "pause_guardrail") {
    const defaultPause = action === "pause_guardrail"
      ? "Situação sensível ou de risco detectada na conversa. Pausando piloto para intervenção humana."
      : "Marcos principais desta etapa concluídos com sucesso. Pausando para acompanhamento humano.";
    const pauseReason = normalizeSemanticReason(decision.pauseReason || decision.reason, defaultPause);
    return { action, checklistGoalIds: [], mediaItems: [], reason, pauseReason };
  }

  const requestedIds = decision.checklistGoalIds ?? decision.mediaItemIds ?? decision.checklistItemIds ?? [];
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== "string")) {
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: normalizeSemanticReason(reason, "IDs de checklist fora do padrão; Sol responderá naturalmente."),
    };
  }
  const knownIds = new Set(checklist.map((item) => item.id));
  if (requestedIds.some((id) => !knownIds.has(id))) {
    return guardrail("Atria selecionou um item inexistente do checklist.");
  }

  if (action === "call_persona") {
    if (requestedIds.length === 0) {
      return { action: "call_persona", checklistGoalIds: [], mediaItems: [], reason };
    }
    // Se o próximo item for texto e foi o solicitado, autoriza com itens vinculados
    if (next && next.type === "text" && requestedIds.includes(next.id)) {
      const goals = resolveLinkedTextGoals(next, pending);
      for (const reqId of requestedIds) {
        if (!goals.includes(reqId)) {
          const reqItem = pending.find((p) => p.id === reqId && p.type === "text");
          if (reqItem && (reqItem.linkedItemId === next.id || next.linkedItemId === reqId)) {
            goals.push(reqId);
          }
        }
      }
      return { action: "call_persona", checklistGoalIds: goals, mediaItems: [], reason };
    }
    // Se a Atria selecionou outro item de texto pendente, autoriza esse item de texto e seus vinculados
    const validTextGoal = pending.find((it) => it.type === "text" && requestedIds.includes(it.id));
    if (validTextGoal) {
      const goals = resolveLinkedTextGoals(validTextGoal, pending);
      for (const reqId of requestedIds) {
        if (!goals.includes(reqId)) {
          const reqItem = pending.find((p) => p.id === reqId && p.type === "text");
          if (reqItem && (reqItem.linkedItemId === validTextGoal.id || validTextGoal.linkedItemId === reqId)) {
            goals.push(reqId);
          }
        }
      }
      return { action: "call_persona", checklistGoalIds: goals, mediaItems: [], reason };
    }
    // Se a Atria indicou um áudio ou pulou a ordem, NUNCA trava o piloto com guardrail:
    // simplesmente chama o Sol com checklistGoalIds vazio para responder naturalmente com calor humano!
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: normalizeSemanticReason(reason, "Sol responderá de forma natural sem transformar mídia em texto."),
    };
  }

  if (action !== "send_approved_media" && action !== "send_checklist_batch") {
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: "Ação não mapeada convertida em resposta conversacional do Sol.",
    };
  }

  if (!next || requestedIds.length === 0 || !requestedIds.includes(next.id)) {
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: "Item fora da sequência estrita; Sol responderá de forma conversacional.",
    };
  }

  // Compatibilidade segura com decisões antigas: texto jamais é enviado cru.
  if (next.type === "text") {
    return {
      action: "call_persona",
      checklistGoalIds: resolveLinkedTextGoals(next, pending),
      mediaItems: [],
      reason: reason || "Texto do checklist convertido em objetivo invisível para o Sol.",
    };
  }

  if (!next.mediaUrl || (next.type !== "audio" && next.type !== "image")) {
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: "Mídia sem conteúdo aprovado; Sol responderá conversacionalmente.",
    };
  }

  if (!hasExplicitPersonalMediaOpening(latestContactText)) {
    return {
      action: "call_persona",
      checklistGoalIds: [],
      mediaItems: [],
      reason: "Mídia adiada: a última fala não abriu espaço para Larissa falar de si.",
    };
  }

  // Um conteúdo por turno. linkedItemId define relação, não autorização de lote.
  return {
    action: "send_checklist_batch",
    checklistGoalIds: [],
    mediaItems: [next],
    reason: normalizeSemanticReason(
      reason,
      "Pretendente deu abertura clara para o conteúdo; autorizando envio da mídia aprovada do cofre."
    ),
  };
}
