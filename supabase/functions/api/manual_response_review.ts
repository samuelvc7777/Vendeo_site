/**
 * Defesa final: frases de incerteza factual não devem chegar ao cliente.
 * O caminho principal é needsHumanReview explícito do Brain; este detector
 * cobre respostas ambíguas que escaparem desse contrato.
 */
export function detectUnsupportedUncertainty(text: unknown): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  return /\b(?:nao sei|nao faco ideia|nao lembro|nao recordo|nao tenho certeza|nao consigo confirmar|nao conheco)\b/.test(normalized);
}

export type ProtectedInboundIntent = "invitation" | "phone_contact_request" | "photo_or_attachment";

/**
 * Situações que exigem decisão humana antes de qualquer resposta automática.
 * O detector é intencionalmente conservador: só identifica pedidos explícitos
 * de contato/convite e mídia recebida; mensagens comuns seguem para o Brain.
 */
export function detectProtectedInboundIntent(input: {
  text?: unknown;
  mediaType?: unknown;
}): { intent: ProtectedInboundIntent; reason: string } | null {
  const text = typeof input.text === "string"
    ? input.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    : "";
  const mediaType = typeof input.mediaType === "string" ? input.mediaType.toLocaleLowerCase("pt-BR") : "";
  const hasAttachment = Boolean(mediaType && mediaType !== "audio")
    || /^\[(?:image|photo|video|file):/i.test(text);

  if (hasAttachment) {
    return { intent: "photo_or_attachment", reason: "Chegou uma foto ou mídia que precisa da sua avaliação." };
  }

  const asksForContact = /\b(?:me passa|passa|manda|me manda|envia|me envia|me da|da|qual|me fala|fala|me chama|chama|vamos pro|vamos para o|bora pro|bora para o|me adiciona|adiciona|posso pegar|pode me passar|pode mandar|vamos trocar|trocar|te passa|te passo)\b/.test(text);
  const mentionsPersonalContact = /\b(?:whats(?:app)?|zap|telefone|numero|contato|celular)\b/.test(text);
  if (asksForContact && mentionsPersonalContact) {
    return { intent: "phone_contact_request", reason: "A pessoa pediu telefone, número ou contato fora do Direct." };
  }

  const invitation = /\b(?:vamos sair|bora sair|topa sair|aceita sair|quer sair comigo|vamos nos ver|bora se ver|vamo se ver|vamos nos encontrar|bora se encontrar|vamos encontrar|quer me encontrar|me encontra|vem me ver|vamos tomar (?:um )?(?:cafe|cafezinho|almoco|jantar|uma cerveja)|bora tomar (?:um )?(?:cafe|cafezinho|almoco|jantar)|(?:vamos|bora|quer|topa|aceita) (?:almo(car|c)|jantar|passear|dar uma volta|tomar um cafe)|vem (?:aqui|pra|para)|quer vir|te busco|posso te buscar|quando posso te ver|vamos marcar|sair comigo|encontro presencial)\b/.test(text);
  const explicitOutingInvitation = /\b(?:convite|convido|convidar|me convida|te convido)\b.{0,35}\b(?:sair|encontrar|cafe|cafezinho|almoco|jantar|passear|cinema|dar uma volta)\b/.test(text);
  if (invitation || explicitOutingInvitation) {
    return { intent: "invitation", reason: "Chegou um convite para sair ou se encontrar pessoalmente." };
  }

  return null;
}

export function createPendingManualResponse(input: {
  inboundMessages: string[];
  inboundMessageIds: string[];
  reason?: string;
  source?: "protected_inbound" | "brain_review" | "uncertain_response";
  candidateResponse?: string;
  now?: Date;
}) {
  const messages = input.inboundMessages.map((message) => message.trim()).filter(Boolean);
  return {
    inboundMessage: messages[messages.length - 1] || "Mensagem recebida",
    inboundMessages: messages,
    inboundMessageIds: input.inboundMessageIds,
    reason: input.reason?.trim() || "A IA não encontrou informação segura para responder sem adivinhar.",
    ...(input.source ? { source: input.source } : {}),
    ...(input.candidateResponse?.trim() ? { candidateResponse: input.candidateResponse.trim() } : {}),
    createdAt: (input.now || new Date()).toISOString(),
  };
}
