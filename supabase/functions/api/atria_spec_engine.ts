export type AtriaSpecAction =
  | "CHAMAR_SOL"
  | "ENVIAR_AUDIO"
  | "ENVIAR_FOTO"
  | "PAUSAR_HUMANO"
  | "PAUSAR_RISCO";

export interface AtriaChecklistItem {
  id: string;
  type: "text" | "audio" | "image";
  title?: string;
  content?: string;
  mediaUrl?: string;
  linkedItemId?: string;
  duration?: number;
  isCompleted?: boolean;
}

export interface AtriaSpecResult {
  action: AtriaSpecAction;
  completedItemIds: string[];
  turnGoalIds: string[];
  mediaItemIds: string[];
  resolvedMediaItems: AtriaChecklistItem[];
  solDirective: string;
  reason: string;
  pauseReason?: string;
  rawMarkdown: string;
}

/**
 * Normaliza strings para comparações seguras sem acentos ou caracteres especiais.
 */
function normalizeString(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Normaliza o motivo analítico/estratégico, impedindo textos vazios ou reticências.
 */
export function normalizeSpecReason(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.trim();
  if (!cleaned || /^[\s.·…\-–—_~*#]+$/.test(cleaned) || cleaned.length < 5) {
    return fallback;
  }
  return cleaned.slice(0, 500);
}

/**
 * Normaliza a ação do Markdown para o tipo estrito AtriaSpecAction.
 */
export function normalizeSpecAction(rawAction: string): AtriaSpecAction {
  const norm = normalizeString(rawAction).replace(/[^a-z_]/g, "");
  if (norm.includes("audio") || norm.includes("enviar_audio")) return "ENVIAR_AUDIO";
  if (norm.includes("foto") || norm.includes("imagem") || norm.includes("enviar_foto")) return "ENVIAR_FOTO";
  if (norm.includes("risco") || norm.includes("guardrail") || norm.includes("pausar_risco")) return "PAUSAR_RISCO";
  if (norm.includes("humano") || norm.includes("handoff") || norm.includes("pausar_humano")) return "PAUSAR_HUMANO";
  return "CHAMAR_SOL";
}

/**
 * Extrai o texto de uma seção específica iniciada por cabeçalho Markdown (#+ SECAO).
 */
function extractSectionContent(markdown: string, sectionTitle: string): string {
  const normTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\n)#{1,4}\\s*${normTitle}[^\\n]*\\n+([\\s\\S]*?)(?=(?:\\n#{1,4}\\s+[^\\n]+)|$)`, "i");
  const match = markdown.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Extrai IDs de checklist em listas com bullets (- item_id: motivo, * item_id, 1. item_id).
 */
function extractBulletIds(sectionContent: string, knownChecklist: AtriaChecklistItem[]): string[] {
  if (!sectionContent) return [];
  const lower = sectionContent.toLowerCase();
  if (
    lower === "nenhum" ||
    lower === "nenhum." ||
    lower === "none" ||
    lower === "nao se aplica" ||
    lower === "n/a"
  ) {
    return [];
  }

  const lines = sectionContent.split("\n");
  const extractedIds: string[] = [];
  const knownIdMap = new Map(knownChecklist.map((item) => [item.id.toLowerCase(), item.id]));

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Se a linha isolada for "nenhum" ou similar
    const cleanLine = line.replace(/^[-*•\d.]+\s*/, "").trim();
    if (/^(?:nenhum|none|nao se aplica|n\/a)\b/i.test(cleanLine)) {
      continue;
    }

    // Procura id no formato "- id: motivo" ou "- id"
    const colonIdx = cleanLine.indexOf(":");
    const token = (colonIdx !== -1 ? cleanLine.slice(0, colonIdx) : cleanLine).trim();

    // Se o token for exatamente um ID do checklist conhecido
    const exactId = knownIdMap.get(token.toLowerCase());
    if (exactId && !extractedIds.includes(exactId)) {
      extractedIds.push(exactId);
      continue;
    }

    // Se o token antes do ':' for exatamente o título de um item do checklist (ex: "- Cidade: motivo")
    const normToken = token.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const itemByTokenTitle = knownChecklist.find((it) => {
      const itTitle = (it.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      return itTitle && itTitle === normToken;
    });
    if (itemByTokenTitle && !extractedIds.includes(itemByTokenTitle.id)) {
      extractedIds.push(itemByTokenTitle.id);
      continue;
    }

    // Se não for id ou título exato no token, só aceita se o ID exato constar como palavra inteira na linha
    for (const item of knownChecklist) {
      const escapedId = item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wordRegex = new RegExp(`\\b${escapedId}\\b`, "i");
      if (wordRegex.test(cleanLine) && !extractedIds.includes(item.id)) {
        extractedIds.push(item.id);
      }
    }
  }

  return extractedIds;
}

/**
 * Resolve itens de mídia vinculados (ex: Áudio 1 com Áudio 2 por linkedItemId).
 * Garante que ambos sejam incluídos em ordem sequencial na entrega do lote.
 */
export function resolveLinkedMediaItems(
  requestedMediaIds: string[],
  stageChecklist: AtriaChecklistItem[],
): AtriaChecklistItem[] {
  const result: AtriaChecklistItem[] = [];
  const byId = new Map(stageChecklist.map((it) => [it.id, it]));
  const addedIds = new Set<string>();

  for (const id of requestedMediaIds) {
    const item = byId.get(id);
    if (!item || addedIds.has(item.id)) continue;

    result.push(item);
    addedIds.add(item.id);

    // 1. Vínculo direto se item aponta para linkedItemId
    if (item.linkedItemId) {
      const linked = byId.get(item.linkedItemId);
      if (linked && !addedIds.has(linked.id)) {
        result.push(linked);
        addedIds.add(linked.id);
      }
    }

    // 2. Vínculo reverso se outro item aponta para este item
    for (const other of stageChecklist) {
      if (other.linkedItemId === item.id && !addedIds.has(other.id)) {
        result.push(other);
        addedIds.add(other.id);
      }
    }
  }

  return result;
}

/**
 * Resolve objetivos de texto vinculados para o Sol (perguntas em dupla).
 */
export function resolveLinkedTextGoalsFromList(
  goalIds: string[],
  stageChecklist: AtriaChecklistItem[],
): string[] {
  const goals = [...goalIds];
  const byId = new Map(stageChecklist.map((it) => [it.id, it]));

  for (const gId of goalIds) {
    const item = byId.get(gId);
    if (!item) continue;

    if (item.linkedItemId) {
      const linked = byId.get(item.linkedItemId);
      if (linked && linked.type === "text" && !goals.includes(linked.id)) {
        goals.push(linked.id);
      }
    }

    for (const other of stageChecklist) {
      if (other.type === "text" && other.linkedItemId === item.id && !goals.includes(other.id)) {
        goals.push(other.id);
      }
    }
  }

  return goals;
}

/**
 * Parser Determinístico de Markdown da Atria Spec.
 * Transforma o relatório .md em um objeto estruturado AtriaSpecResult.
 */
export function parseAtriaSpecMarkdown(
  rawMarkdown: string,
  stageChecklist: AtriaChecklistItem[],
): AtriaSpecResult {
  const content = String(rawMarkdown || "").trim();

  // 1. Extração da AÇÃO
  const actionRaw = extractSectionContent(content, "AÇÃO") ||
    extractSectionContent(content, "ACAO") ||
    extractSectionContent(content, "ACTION");
  let action = normalizeSpecAction(actionRaw || "CHAMAR_SOL");

  // 2. Extração dos ITENS CONCLUÍDOS
  const completedRaw = extractSectionContent(content, "ITENS CONCLUÍDOS NESTE TURNO") ||
    extractSectionContent(content, "ITENS CONCLUIDOS NESTE TURNO") ||
    extractSectionContent(content, "ITENS CONCLUIDOS");
  const completedItemIds = extractBulletIds(completedRaw, stageChecklist);

  // 3. Extração dos OBJETIVOS DESTE TURNO
  const goalsRaw = extractSectionContent(content, "OBJETIVOS DESTE TURNO") ||
    extractSectionContent(content, "OBJETIVOS");
  const extractedGoalIds = extractBulletIds(goalsRaw, stageChecklist);
  const turnGoalIds = resolveLinkedTextGoalsFromList(extractedGoalIds, stageChecklist);

  // 4. Extração dos ITENS DE MÍDIA
  const mediaRaw = extractSectionContent(content, "ITENS DE MÍDIA") ||
    extractSectionContent(content, "ITENS DE MIDIA") ||
    extractSectionContent(content, "MIDIA");
  const mediaItemIds = extractBulletIds(mediaRaw, stageChecklist);
  let resolvedMediaItems = resolveLinkedMediaItems(mediaItemIds, stageChecklist);

  // Fallback de resiliência: se a ação é ENVIAR_AUDIO ou ENVIAR_FOTO mas nenhum ID foi extraído
  if ((action === "ENVIAR_AUDIO" || action === "ENVIAR_FOTO") && resolvedMediaItems.length === 0) {
    const isAudio = action === "ENVIAR_AUDIO";
    const pendingMedia = stageChecklist.find(
      (it) => !it.isCompleted && (isAudio ? it.type === "audio" : it.type === "image" || it.type === "video"),
    );
    if (pendingMedia) {
      resolvedMediaItems = resolveLinkedMediaItems([pendingMedia.id], stageChecklist);
      console.log(`[TRACE-AUTOPILOT] AtriaSpecEngine: resolvido ${resolvedMediaItems.length} mídia(s) via fallback de itens pendentes`);
    } else {
      // Se não há nenhuma mídia pendente no cronograma, converte para CHAMAR_SOL sem travar o ciclo
      console.warn(`[TRACE-AUTOPILOT] AtriaSpecEngine: ${action} selecionada sem mídia pendente. Convertendo para CHAMAR_SOL.`);
      action = "CHAMAR_SOL";
    }
  }

  // 5. Extração da ESPECIFICAÇÃO PARA O SOL
  const solSpecRaw = extractSectionContent(content, "ESPECIFICAÇÃO PARA O SOL") ||
    extractSectionContent(content, "ESPECIFICACAO PARA O SOL") ||
    extractSectionContent(content, "DIRETRIZES PARA O SOL");
  const solDirective = solSpecRaw.trim();

  // 6. Extração do MOTIVO ESTRATÉGICO
  const reasonRaw = extractSectionContent(content, "MOTIVO ESTRATÉGICO") ||
    extractSectionContent(content, "MOTIVO ESTRATEGICO") ||
    extractSectionContent(content, "MOTIVO");
  const defaultReason = action === "ENVIAR_AUDIO"
    ? "Pretendente deu abertura para a Larissa falar de si; enviando áudio gravado no cofre."
    : action === "PAUSAR_HUMANO"
    ? "Missão da IA na etapa concluída. Pausando para intervenção humana."
    : "Sol responderá mantendo a conversa humana e alinhada ao cronograma.";
  const reason = normalizeSpecReason(reasonRaw, defaultReason);

  const pauseReason = action === "PAUSAR_HUMANO"
    ? reason
    : action === "PAUSAR_RISCO"
    ? (reason || "Situação sensível ou risco detectado na conversa.")
    : undefined;

  return {
    action,
    completedItemIds,
    turnGoalIds,
    mediaItemIds,
    resolvedMediaItems,
    solDirective,
    reason,
    pauseReason,
    rawMarkdown: content,
  };
}

export interface AtriaDossierMessage {
  id?: string;
  sender: "me" | "them";
  text: string;
  timestamp?: string | number | Date | null;
  sentDate?: string;
  mediaType?: "text" | "audio" | "image";
  mediaUrl?: string;
  audioTranscript?: string;
  replyToText?: string;
}

export interface AtriaDossierPretendente {
  id?: string;
  name: string;
  username?: string;
  city?: string;
  bio?: string;
  platform?: string;
  age?: number;
}

export interface AtriaDossierInput {
  stageName: string;
  checklist: AtriaChecklistItem[];
  pretendente: AtriaDossierPretendente;
  historyMessages: AtriaDossierMessage[];
  searchedWebContext?: string;
  now?: Date;
}

function parseTimestampMs(value?: string | number | Date | null): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const str = String(value).trim();
  const direct = new Date(str).getTime();
  if (!isNaN(direct)) return direct;
  return 0;
}

/**
 * Formata timestamps no fuso horário oficial de Brasília (America/Sao_Paulo).
 */
export function formatBrasiliaDateTime(
  dateInput?: string | number | Date | null,
  referenceNow?: Date,
): string {
  const ms = parseTimestampMs(dateInput);
  if (!ms) return "Recentemente";
  const date = new Date(ms);
  const now = referenceNow || new Date();

  const msgDayKey = date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = yesterday.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const timeStr = date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (msgDayKey === todayKey) return `hoje às ${timeStr}`;
  if (msgDayKey === yesterdayKey) return `ontem às ${timeStr}`;

  const dayMonthStr = date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  return `${dayMonthStr} às ${timeStr}`;
}

/**
 * Cabeçalho temporal formatado no fuso oficial de Brasília.
 */
export function formatBrasiliaNowHeader(nowInput?: Date): string {
  const now = nowInput || new Date();
  const weekday = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  });
  const dateStr = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  const capWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capWeekday}, ${dateStr} às ${timeStr} (Horário de Brasília)`;
}

function formatDossierMessage(
  msg: AtriaDossierMessage,
  pretendenteName: string,
  now?: Date,
): string {
  const senderLabel = msg.sender === "me" ? "[VOCÊ (Larissa)]" : `[ELE (${pretendenteName})]`;
  const timeLabel = formatBrasiliaDateTime(msg.sentDate || msg.timestamp, now);

  let body = String(msg.text || "").trim();
  const isAudio = msg.mediaType === "audio" || body.startsWith("[audio:");
  const isImage = msg.mediaType === "image" || body.startsWith("[image:");

  if (isAudio) {
    if (msg.audioTranscript && msg.audioTranscript.trim()) {
      body = `[áudio transcrito: "${msg.audioTranscript.trim()}"]`;
    } else {
      body = `🎙️ [áudio enviado/recebido]`;
    }
  } else if (isImage) {
    const captionMatch = body.match(/^\[image:[^\]]+\](?:\s*(.*))?$/);
    const caption = captionMatch?.[1]?.trim();
    body = caption ? `📷 [foto: "${caption}"]` : `📷 [foto enviada]`;
  }

  const reply = msg.replyToText ? ` [respondendo a: "${msg.replyToText}"]` : "";
  return `${senderLabel} - ${timeLabel}: "${body}"${reply}`;
}

/**
 * Gera o Dossiê Executivo de Turno em Markdown puro para a Atria.
 * Contém o checklist oficial completo (com conteúdos, transcrições e durações),
 * o histórico de até 500 mensagens no fuso de Brasília e o bloco de mensagens novas.
 */
export function buildAtriaDossierMarkdown(input: AtriaDossierInput): string {
  const { stageName, checklist, pretendente, historyMessages, searchedWebContext, now } = input;
  const nowRef = now || new Date();
  const name = pretendente.name || "Pretendente";

  // 1. Dados da Etapa e Pretendente
  const profileLines: string[] = [
    `# DOSSIÊ DO TURNO PARA AUDITORIA`,
    ``,
    `## 1. DADOS DA ETAPA E DO PRETENDENTE`,
    `- **Etapa Atual:** ${stageName || "Etapa Atual"}`,
    `- **Nome do Pretendente:** ${name}${pretendente.age ? `, ${pretendente.age} anos` : ""}`,
  ];
  if (pretendente.username) profileLines.push(`- **Username/Perfil:** @${pretendente.username}`);
  if (pretendente.city) profileLines.push(`- **Localização:** ${pretendente.city}`);
  if (pretendente.bio) profileLines.push(`- **Bio do Perfil:** "${pretendente.bio}"`);
  profileLines.push(`- **Momento da Análise:** ${formatBrasiliaNowHeader(nowRef)}`);

  // 2. Cronograma da Etapa (Checklist)
  const checklistLines: string[] = [
    ``,
    `## 2. CRONOGRAMA DA ETAPA (CHECKLIST OFICIAL COM CONTEÚDO INTEGRAL)`,
    `Audite cada item abaixo comparando o seu 'Conteúdo / O que pede' com o histórico completo de 500 mensagens:`,
  ];

  if (!checklist || checklist.length === 0) {
    checklistLines.push(`- (Nenhum item de checklist cadastrado para esta etapa)`);
  } else {
    for (const item of checklist) {
      const statusStr = item.isCompleted ? "[STATUS: CONCLUÍDO NO BANCO]" : "[STATUS: PENDENTE]";
      const typeLabel = item.type === "audio"
        ? "Áudio Gravado no Cofre"
        : item.type === "image"
        ? "Foto do Cofre"
        : "Texto";

      checklistLines.push(``);
      checklistLines.push(`### Item: \`${item.id}\` ${statusStr}`);
      checklistLines.push(`- **Tipo:** ${typeLabel}`);
      if (item.title) checklistLines.push(`- **Título:** ${item.title}`);
      if (item.content) {
        const contentHeader = item.type === "audio" ? "Conteúdo / O que o áudio fala:" : "Conteúdo / O que pede:";
        checklistLines.push(`- **${contentHeader}** "${item.content}"`);
      }
      if (item.duration && item.type === "audio") {
        checklistLines.push(`- **Duração do Áudio:** ${item.duration} segundos`);
      }
      if (item.linkedItemId) {
        checklistLines.push(`- **Vinculado a:** \`${item.linkedItemId}\` (Itens em combo obrigatório)`);
      }
    }
  }

  // 3. Histórico Completo da Conversa (até 500 mensagens, ordenadas cronologicamente)
  const rawHistory = [...(historyMessages || [])];
  // Ordena cronologicamente (da mais antiga para a mais recente)
  const sortedHistory = rawHistory.sort((a, b) => {
    const timeA = parseTimestampMs(a.sentDate || a.timestamp);
    const timeB = parseTimestampMs(b.sentDate || b.timestamp);
    return timeA - timeB;
  });
  const limitedHistory = sortedHistory.slice(-500);

  const historyLines: string[] = [
    ``,
    `## 3. HISTÓRICO COMPLETO DA CONVERSA (ÚLTIMAS ${limitedHistory.length} MENSAGENS - HORÁRIO DE BRASÍLIA)`,
  ];

  if (limitedHistory.length === 0) {
    historyLines.push(`(Iniciando a conversa agora; sem mensagens anteriores no histórico)`);
  } else {
    limitedHistory.forEach((msg, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      historyLines.push(`[${num}] ${formatDossierMessage(msg, name, nowRef)}`);
    });
  }

  // 4. Mensagens Novas Recebidas do Pretendente (bloco consecutivo não respondido)
  const reversedHistory = [...limitedHistory].reverse();
  const pendingThem: AtriaDossierMessage[] = [];
  for (const m of reversedHistory) {
    if (m.sender === "them") {
      pendingThem.unshift(m);
    } else {
      break;
    }
  }

  const newMessagesLines: string[] = [
    ``,
    `## 4. MENSAGENS NOVAS RECEBIDAS DO PRETENDENTE (A AUDITAR E RESPONDER NESTE TURNO)`,
  ];

  if (pendingThem.length === 0) {
    const lastThem = reversedHistory.find((m) => m.sender === "them");
    if (lastThem) {
      newMessagesLines.push(`• ${formatBrasiliaDateTime(lastThem.sentDate || lastThem.timestamp, nowRef)}: "${lastThem.text}"`);
    } else {
      newMessagesLines.push(`(Nenhuma mensagem nova detectada)`);
    }
  } else {
    pendingThem.forEach((m) => {
      newMessagesLines.push(`• ${formatBrasiliaDateTime(m.sentDate || m.timestamp, nowRef)}: "${m.text}"`);
    });
  }

  // 5. Contexto de Pesquisa na Internet / Entidades Identificadas (se houver)
  const webContextLines: string[] = [];
  if (searchedWebContext && searchedWebContext.trim()) {
    webContextLines.push(
      ``,
      `## 5. PESQUISA NA INTERNET / FATOS SOBRE O QUE ELE CITOU`,
      searchedWebContext.trim(),
    );
  }

  // 6. Diretrizes da Auditora Atria
  const directiveLines: string[] = [
    ``,
    `---`,
    `## ${webContextLines.length > 0 ? "6" : "5"}. DIRETRIZES DA AUDITORA ATRIA:`,
    `1. AUDITORIA RETROSPECTIVA OBRIGATÓRIA:`,
    `   - Compare o 'Conteúdo / O que pede' de cada item com as falas do pretendente em todo o histórico.`,
    `   - Se ele já tiver informado esse dado espontaneamente em qualquer momento, marque o item em '# ITENS CONCLUÍDOS NESTE TURNO' com a justificativa. O backend atualizará o banco de dados e nunca mais repetirá a pergunta!`,
    `2. GATILHO DE ÁUDIOS GRAVADOS NO COFRE:`,
    `   - SE ELE PERGUNTOU SOBRE ELA ('e vc?', 'oq vc faz?'): Escolha ENVIAR_AUDIO com o ID do áudio em '# ITENS DE MÍDIA'. No bloco '# ESPECIFICAÇÃO PARA O SOL', instrua o Sol a reagir com calor humano e naturalidade validando o que o pretendente acabou de dizer, sem prometer áudio para depois (pois os áudios gravados vão juntos agora), e proibindo contar biografia em texto.`,
    `   - SE ELE NÃO PERGUNTOU SOBRE ELA: Se já conversaram sobre a cidade dele e sobre o que ele faz/rotina dele, e o próximo item for o áudio pessoal, escolha ENVIAR_AUDIO com o ID do áudio em '# ITENS DE MÍDIA'. No bloco '# ESPECIFICAÇÃO PARA O SOL', instrua o Sol a validar o que ele falou e soltar o deboche meigo característico da Larissa puxando a vez dela com charme (ex: 'vou falar mais sobre mim também, já que vc não perguntou kkk' ou 'já que vc não me perguntou nada vou falar de mim também kkk'), e o backend despachará os áudios gravados logo em seguida no mesmo turno!`,
    `   - ⚠️ PROIBIÇÃO TERMINANTE DE ANUNCIAR ÁUDIO QUANDO A AÇÃO FOR CHAMAR_SOL: Se a ação for CHAMAR_SOL, é TERMINANTEMENTE PROIBIDO falar sobre áudio ou dizer que vai mandar áudio depois! Converse normalmente sobre o assunto dele em texto sem jamais prometer áudios futuros.`,
    `3. INSPIRAÇÃO DO CHECKLIST PARA O SOL (ZERO RESPOSTA ENGESSADA):`,
    `   - O checklist é uma lista de objetivos e metas da conversa, NUNCA um roteiro decorado ou engessado.`,
    `   - Ao escolher CHAMAR_SOL para conduzir uma pergunta do checklist, oriente o Sol no bloco '# ESPECIFICAÇÃO PARA O SOL' a conectar o objetivo à fala atual do pretendente, adaptando as palavras para soar natural e espontâneo (usando a formulação direta apenas se couber perfeitamente).`,
    `4. ENTIDADES DO MUNDO REAL E REGRA DA CURIOSIDADE MEIGA:`,
    `   - Se o pretendente citar artistas, eventos, festas, cidades, hobbies ou termos específicos:`,
    `     * SE FOR CONHECIDO (ou constar na seção de pesquisa acima): Use seu conhecimento de mundo para ditar a vibe correta no '# ESPECIFICAÇÃO PARA O SOL' (ex: Mumuzinho é pagode/samba -> Sol valida com alegria e sem efeito papagaio).`,
    `     * SE FOR DESCONHECIDO, LOCAL OU A PESQUISA NÃO ENCONTRAR NADA: NUNCA invente nem alucine que conhece! Aplique a REGRA DA CURIOSIDADE MEIGA: instrua o Sol a admitir com carinho e meiguice que nunca ouviu falar e perguntar pro pretendente explicar o que é / como é lá (ex: "Nossa, nunca ouvi falar kkk, toca o que por lá?"). Ninguém de 23 anos conhece tudo no mundo, e perguntar com curiosidade sincera gera conexão humana imediata e zero alucinação!`,
    `5. EMITA SUA ESPECIFICAÇÃO RIGOROSAMENTE NO FORMATO MARKDOWN (# AÇÃO, # ITENS CONCLUÍDOS NESTE TURNO, # OBJETIVOS DESTE TURNO, # ITENS DE MÍDIA, # ESPECIFICAÇÃO PARA O SOL, # MOTIVO ESTRATÉGICO).`,
  ];

  return [
    ...profileLines,
    ...checklistLines,
    ...historyLines,
    ...newMessagesLines,
    ...webContextLines,
    ...directiveLines,
  ].join("\n");
}
