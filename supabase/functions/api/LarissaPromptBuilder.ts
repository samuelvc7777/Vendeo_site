import { LARISSA_CONVERSATION_STYLE } from "./LarissaConversationStyle.ts";
import { LARISSA_CANONICAL_PROMPT } from "./larissa_canonical_prompt.generated.ts";

export { LARISSA_CONVERSATION_STYLE };

export interface AiPretendenteInfo {
  id: string;
  name: string;
  age?: number;
  city?: string;
  bio?: string;
  platform: "tinder" | "instagram";
  username?: string;
}

export interface AiMessageItem {
  id: string;
  sender: "me" | "them";
  text: string;
  timestamp?: string;
  sentDate?: string;
  replyToText?: string;
  audioTranscript?: string;
  mediaType?: "text" | "audio" | "image";
  mediaUrl?: string;
}

export interface AiRaffleReadiness {
  shouldOffer: boolean;
  confidence: number;
  stage: string;
  reason: string;
  signals?: string[];
}

export interface AiStructuredResponse {
  responses: string[];
  indices: number[][];
  raffle_readiness?: AiRaffleReadiness;
}

export interface AiPersonaReferenceItem {
  category: string;
  them_message: string;
  larissa_response: string;
  notes?: string;
}

export interface StageChecklistItemPrompt {
  id: string;
  type: "text" | "audio" | "image";
  title: string;
  content?: string;
  mediaUrl?: string;
  duration?: number;
  linkedItemId?: string;
  isCompleted: boolean;
}

export interface AiPromptGenerateRequest {
  pretendente: AiPretendenteInfo;
  tinderHistory?: AiMessageItem[];
  instagramHistory?: AiMessageItem[];
  messagesToRespond?: AiMessageItem[];
  personaReferences?: AiPersonaReferenceItem[];
  mode?: "markdown" | "direct_api";
  historyLimit?: number;
  stageContext?: {
    stageName: string;
    stageIndex: number;
    totalStages: number;
    checklist: StageChecklistItemPrompt[];
    /** IDs escolhidos pela Atria para serem incorporados naturalmente neste turno. */
    turnGoalIds?: string[];
    /** Diretiva estratégica ditada pela Atria ou orquestrador para este turno. */
    turnDirective?: string;
    /** Informações reais pesquisadas na internet sobre temas, eventos ou artistas citados. */
    searchedWebContext?: string;
  };
  includeChecklistContext?: boolean;
}

export interface AiPromptGenerateResult {
  prompt: string;
  /**
   * DNA da persona (identidade + regras + few-shot). No modo direct_api viaja
   * como mensagem de "system" para o motor de IA ganhar peso de persona.
   */
  systemPrompt?: string;
  pretendente: AiPretendenteInfo;
  newMessagesCount: number;
  newMessages: { index: number; text: string }[];
  temporalContext: {
    dateStr: string;
    timeStr: string;
    period: "MANHÃ" | "TARDE" | "NOITE" | "MADRUGADA";
    dayOfWeek: string;
  };
  usedEmojis?: string[];
  lastHadEmoji?: boolean;
}

function getMessageTimestampMs(
  dateInput?: string | number | Date | null,
): number {
  if (!dateInput) return 0;
  if (typeof dateInput === "number" && !isNaN(dateInput)) {
    return dateInput < 10000000000 ? dateInput * 1000 : dateInput;
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.getTime();
  }
  if (typeof dateInput === "string" && dateInput.trim()) {
    const trimmed = dateInput.trim();
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) return num < 10000000000 ? num * 1000 : num;

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

function formatMessageDateTime(
  dateInput?: string | number | Date | null,
): string {
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

export class GenerateAiPromptUseCase {
  execute(request: AiPromptGenerateRequest): AiPromptGenerateResult {
    const {
      pretendente,
      tinderHistory = [],
      instagramHistory = [],
      personaReferences = [],
      mode = "markdown",
      stageContext,
    } = request;

    const isDirectApi = mode === "direct_api";

    const limit = typeof request.historyLimit === "number" && request.historyLimit > 0
      ? request.historyLimit
      : 500;

    // Ordenação estritamente cronológica garantida (mais antigas no topo, mais recentes no fim)
    const sortedTinder = [...tinderHistory].sort(
      (a, b) => getMessageTimestampMs(a.sentDate || a.timestamp) - getMessageTimestampMs(b.sentDate || b.timestamp)
    ).slice(-limit);
    const sortedInstagram = [...instagramHistory].sort(
      (a, b) => getMessageTimestampMs(a.sentDate || a.timestamp) - getMessageTimestampMs(b.sentDate || b.timestamp)
    ).slice(-limit);

    let dynamicPersonaRefsSection = "";
    if (personaReferences && personaReferences.length > 0) {
      const formattedRefs = personaReferences
        .map(
          (ref) =>
            `• [${ref.category.toUpperCase()}] Ele: "${ref.them_message}" ➔ Larissa: "${ref.larissa_response}"${
              ref.notes ? ` (${ref.notes})` : ""
            }`
        )
        .join("\n");
      dynamicPersonaRefsSection = `\n• REFERÊNCIAS EXTRAS DINÂMICAS DO BANCO:\n${formattedRefs}\n`;
    }

    // 1. Determina as mensagens novas a responder
    const combinedHistory =
      pretendente.platform === "tinder" ? sortedTinder : sortedInstagram;

    let targetHandle = (pretendente.username || "").replace(/^@/, "").trim();
    if (!targetHandle && pretendente.platform === "instagram") {
      targetHandle = (pretendente.name || pretendente.id || "").replace(/^@/, "").trim();
    }
    const directChatUrl =
      pretendente.platform === "instagram"
        ? `https://ig.me/m/${targetHandle || "direct"}`
        : `https://tinder.com/app/messages/${pretendente.id}`;
    const platformLabel = pretendente.platform === "instagram" ? "Instagram Direct" : "Tinder";

    // Análise determinística de emojis usados pela Larissa nas mensagens anteriores
    const emojiRegex = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const myRecentMessages = combinedHistory.filter((m) => m.sender === "me").slice(-6);
    const usedEmojis: string[] = [];
    for (const m of myRecentMessages) {
      const text = m.text || "";
      const matches = text.match(emojiRegex);
      if (matches) {
        for (const em of matches) {
          if (!usedEmojis.includes(em)) usedEmojis.push(em);
        }
      }
    }
    const lastMyMessage = myRecentMessages[myRecentMessages.length - 1];
    const lastHadEmoji = lastMyMessage ? Boolean((lastMyMessage.text || "").match(emojiRegex)) : false;

    let emojiDirective = "";
    if (lastHadEmoji) {
      emojiDirective = `• ⚠️ TRAVA DETERMINÍSTICA ANTI-ROBÔ DE EMOJIS (ZERO EMOJIS NESTE TURNO):
   - Você já usou emoji na sua mensagem anterior recente: [ ${usedEmojis.slice(-2).join(" ")} ].
   - ❌ DIRETIVA OBRIGATÓRIA: EXATAMENTE ZERO (0) EMOJIS NESTA RESPOSTA!
   - É TERMINANTEMENTE PROIBIDO colocar qualquer emoji neste turno (especialmente ${usedEmojis.join(", ")}).
   - Pessoas reais não carimbam emoji no final de toda mensagem; isso é marca de robô. Termine as falas de forma solta apenas com palavras, vírgula (,) ou risada ("kkk") se couber!`;
    } else if (usedEmojis.length > 0) {
      emojiDirective = `• ⚠️ TRAVA DE REPETIÇÃO DE EMOJIS (ANTI-VÍCIO):
   - Emojis já usados por você recentemente nas mensagens anteriores: [ ${usedEmojis.join(" ")} ].
   - ❌ É TERMINANTEMENTE PROIBIDO REPETIR esses emojis (especialmente ${usedEmojis.join(", ")})!
   - Em pelo menos 70% das mensagens, NÃO use nenhum emoji.
   - Se for usar algum emoji pontual para demonstrar carinho, use NO MÁXIMO 1 emoji em toda a resposta, e DEVE ser um emoji diferente e variado (ex: ✨, 🫶🏻, ☕, 🙈, 😂, 👀, 🤍), NUNCA repita o que já foi usado!`;
    } else {
      emojiDirective = `• ⚠️ REGRA CRÍTICA DE USO DE EMOJIS (NÃO VICIAR EM EMOJIS):
   - Em pelo menos 70% das mensagens, NÃO use nenhum emoji!
   - No MÁXIMO 1 emoji no total para todo o conjunto de balões. NUNCA use mais de 1 emoji por resposta.
   - É PROIBIDO usar sempre "🥰". Varie sutilmente quando fizer sentido (ex: ✨, 🫶🏻, ☕, 🙈, 😂, 👀, 🤍) ou simplesmente termine sem emoji (com vírgula ou "kkk").`;
    }

    let newMessagesItems: AiMessageItem[] = [];

    if (request.messagesToRespond && request.messagesToRespond.length > 0) {
      newMessagesItems = request.messagesToRespond;
    } else {
      // Pega o bloco final contínuo de mensagens enviadas por 'them' (o pretendente)
      const reversed = [...combinedHistory].reverse();
      const pending: AiMessageItem[] = [];

      for (const msg of reversed) {
        if (msg.sender === "them") {
          pending.unshift(msg);
        } else {
          break;
        }
      }

      // Se todas forem 'me' ou histórico vazio, pega pelo menos a última mensagem dele se houver
      if (pending.length === 0) {
        const lastThem = [...combinedHistory].reverse().find((m) => m.sender === "them");
        if (lastThem) {
          pending.push(lastThem);
        }
      }

      newMessagesItems = pending;
    }

    // Se ainda assim não houver mensagens, cria um placeholder genérico
    if (newMessagesItems.length === 0) {
      newMessagesItems = [
        {
          id: "msg_fallback",
          sender: "them",
          text: "Oii, tudo bem?",
          timestamp: "Agora",
        },
      ];
    }

    // Helper para converter mídias (especialmente áudios com transcrição) no texto inteligível para a IA
    const formatPromptMessageText = (m: { text: string; audioTranscript?: string; mediaType?: string }): string => {
      const isAudio = m.mediaType === "audio" || (typeof m.text === "string" && m.text.startsWith("[audio:"));
      const isImage = m.mediaType === "image" || (typeof m.text === "string" && m.text.startsWith("[image:"));

      if (isAudio) {
        if (m.audioTranscript && m.audioTranscript.trim()) {
          return `[áudio transcrito: "${m.audioTranscript.trim()}"]`;
        }
        return "[áudio recebido]";
      }

      if (isImage) {
        const captionMatch = typeof m.text === "string" ? m.text.match(/^\[image:[^\]]+\](?:\s*(.*))?$/) : null;
        const caption = captionMatch?.[1]?.trim();
        return caption ? `[foto: "${caption}"]` : "📷 [foto enviada]";
      }

      return m.text || "";
    };

    const indexedNewMessages = newMessagesItems.map((m, idx) => ({
      index: idx,
      text: formatPromptMessageText(m),
    }));

    // 2. Contexto Temporal no Fuso de Brasília
    const now = new Date();
    const brDateOptions: Intl.DateTimeFormatOptions = {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const brTimeOptions: Intl.DateTimeFormatOptions = {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    const brWeekdayOptions: Intl.DateTimeFormatOptions = {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
    };

    const dateStr = new Intl.DateTimeFormat("pt-BR", brDateOptions).format(now);
    const timeStr = new Intl.DateTimeFormat("pt-BR", brTimeOptions).format(now);
    const dayOfWeek = new Intl.DateTimeFormat("pt-BR", brWeekdayOptions).format(now);

    const hour = parseInt(timeStr.split(":")[0], 10);
    let period: "MANHÃ" | "TARDE" | "NOITE" | "MADRUGADA" = "MANHÃ";
    if (hour >= 5 && hour < 12) period = "MANHÃ";
    else if (hour >= 12 && hour < 18) period = "TARDE";
    else if (hour >= 18 && hour < 24) period = "NOITE";
    else period = "MADRUGADA";

    // 3. Montagem das seções de histórico
    const tinderHistorySection =
      sortedTinder.length > 0
        ? sortedTinder
            .map((m) => {
              const senderLabel =
                m.sender === "me"
                  ? "[VOCÊ (Larissa)]"
                  : `[ELE (${pretendente.name})]`;
              const timeLabel = (m.sentDate || m.timestamp) ? ` - ${formatMessageDateTime(m.sentDate || m.timestamp)}` : "";
              const formattedText = formatPromptMessageText(m);
              return `${senderLabel}${timeLabel}: ${formattedText}`;
            })
            .join("\n")
        : "Nenhuma mensagem anterior registrada no Tinder.";

    const currentChatHistorySection =
      pretendente.platform === "tinder"
        ? tinderHistorySection
        : (sortedInstagram.length > 0
            ? sortedInstagram
                .map((m) => {
                  const senderLabel =
                    m.sender === "me"
                      ? "[VOCÊ (Larissa)]"
                      : `[ELE (${pretendente.name})]`;
                  const timeLabel = (m.sentDate || m.timestamp) ? ` - ${formatMessageDateTime(m.sentDate || m.timestamp)}` : "";
                  const replyInfo = m.replyToText
                    ? ` [respondendo a "${m.replyToText}"]`
                    : "";
                  const formattedText = formatPromptMessageText(m);
                  return `${senderLabel}${timeLabel}: ${formattedText}${replyInfo}`;
                })
                .join("\n")
            : "Iniciando a conversa no Instagram Direct.");

    // 4. Seção das Novas Mensagens
    const newMessagesListStr = indexedNewMessages
      .map((item) => `• [Índice ${item.index}]: "${item.text}"`)
      .join("\n");

    const platformIntro =
      pretendente.platform === "tinder"
        ? `Você está no celular conversando pelo TINDER com um rapaz (${pretendente.name}${pretendente.age ? `, ${pretendente.age} anos` : ""}) com quem deu match.`
        : `Você está no celular conversando pelo Direct do INSTAGRAM com um rapaz (${pretendente.name}${pretendente.age ? `, ${pretendente.age} anos` : ""}) que está conhecendo.`;

    const chatHistoryHeader =
      pretendente.platform === "tinder"
        ? "=== HISTÓRICO DA CONVERSA NO TINDER ==="
        : "=== HISTÓRICO DA CONVERSA NO DIRECT ===";

    const crossPlatformSection =
      pretendente.platform === "instagram" && tinderHistory.length > 0
        ? `=== HISTÓRICO ANTERIOR NO TINDER ===\n${tinderHistorySection}\n`
        : "";

    const turnGoalIds = new Set(stageContext?.turnGoalIds || []);
    const turnGoals = (stageContext?.checklist || []).filter((item) =>
      turnGoalIds.has(item.id),
    );
    let turnDirectiveBlock = "";
    if (stageContext?.turnDirective?.trim()) {
      let formattedDirective = stageContext.turnDirective.trim();
      if (!formattedDirective.includes("# ESPECIFICAÇÃO PARA O SOL") && !formattedDirective.startsWith("===")) {
        formattedDirective = `# ESPECIFICAÇÃO PARA O SOL\n${formattedDirective}`;
      }
      turnDirectiveBlock = `=== ESPECIFICAÇÃO OFICIAL DESTE TURNO (ATRIA SPEC .md) ===
ORIENTAÇÃO ESTRATÉGICA DESTE TURNO:
${formattedDirective}

`;
    }

    const stageScheduleList = (stageContext?.checklist || []).map((item, idx) => {
      const isTarget = turnGoalIds.has(item.id);
      const tag = item.isCompleted
        ? "[JÁ CONCLUÍDO]"
        : isTarget
        ? "[OBJETIVO ATUAL DESTE TURNO]"
        : "[PRÓXIMO NO CRONOGRAMA]";
      const typeLabel = item.type === "audio"
        ? "Áudio gravado no cofre (NÃO falar em texto)"
        : item.type === "image"
        ? "Foto do cofre"
        : "Texto natural (incorporar com suas palavras)";
      return `${idx + 1}. ${tag} ${item.title} — ${typeLabel}`;
    }).join("\n");

    const checklistTurnSection = stageContext
      ? `ETAPA ATUAL: ${stageContext.stageName} (${stageContext.stageIndex + 1}/${stageContext.totalStages})

CHECKLIST DA ETAPA:
${stageScheduleList}

OBJETIVOS AUTORIZADOS NESTE TURNO:
${turnGoals.length > 0
  ? turnGoals.map((item) => `- [${item.id}] ${item.title}: ${item.content || item.title}`).join("\n")
  : "Nenhum objetivo selecionado."}

${turnDirectiveBlock}`
      : "";
    const searchedWebSection = stageContext?.searchedWebContext?.trim()
      ? `=== PESQUISA NA INTERNET (FATOS REAIS SOBRE O QUE ELE CITOU) ===
${stageContext.searchedWebContext.trim()}
⚠️ Use os fatos acima para contextualizar sua resposta com naturalidade sem alucinar e SEM repetir como papagaio a frase dele!

`
      : "";

    // A geração manual e o Brain compartilham a mesma instrução fixa.
    // Abaixo entram apenas os dados variáveis da conversa e o contrato da interface.
    const systemPrompt = LARISSA_CANONICAL_PROMPT;

    let prompt = `${platformIntro}
${pretendente.bio ? `Bio dele: "${pretendente.bio}"\n` : ""}${pretendente.city ? `Cidade dele: ${pretendente.city}\n` : ""}
${crossPlatformSection}
${chatHistoryHeader}
${currentChatHistorySection}
${dynamicPersonaRefsSection}
${checklistTurnSection}
${searchedWebSection}=== MENSAGENS NOVAS DELE PARA VOCÊ RESPONDER AGORA (${indexedNewMessages.length}): ===
${newMessagesListStr}

Agora pense como a Larissa e responda às mensagens dele.
⚠️ CAMPOS OBRIGATÓRIOS (preencha TODOS, nunca deixe vazio):
- "analise_do_pretendente": frase completa (obrigatório, nunca vazio) — o que ele disse, quais perguntas fez e como você vai reagir de forma calorosa, meiga e espontânea.
- "responses": lista com 1 ou 2 balões curtos no seu jeito mineiro de falar (se houver perguntas vinculadas, separe-as em balões distintos para manter a conversa leve e dinâmica).
- "indices": lista de listas ligando cada balão às mensagens dele (ex: [[0],[0]]).
- "completed_checklist_ids": IDs dos objetivos invisíveis realmente cobertos; use [] quando nenhum objetivo foi coberto.

Retorne ESTRITAMENTE o objeto JSON, sem markdown, sem comentários e sem texto fora do JSON:
{
  "analise_do_pretendente": "Pensamento rápido: o que ele disse, quais perguntas fez e como vou reagir de forma calorosa, meiga e espontânea, respondendo às dúvidas dele e valorizando os assuntos que ele trouxe.",
  "action": "reply",
  "objectiveDecision": "pursue",
  "satisfiedObjectiveId": null,
  "evidenceMessageId": null,
  "reasoning": "justificativa sucinta",
  "liveStatePatch": { "currentTopic": "tópico atual" },
  "turnContract": { "mustAnswerFirst": true, "newQuestionBudget": 1, "responseShape": "natural", "directQuestions": [], "maxBalloons": 2 },
  "resolvedQuestionIntentIds": [],
  "questionIntents": [],
  "responses": ["balão 1", "balão 2"],
  "outboundActions": [],
  "indices": [[0], [0]],
  "completed_checklist_ids": []
}`;

    // Todas as chamadas recebem a instrução fixa canônica seguida do contexto do turno.
    prompt = `${systemPrompt}\n\n${prompt}`;

    if (!isDirectApi) {
      // Modo markdown (botão "Copiar Prompt"): formato vai no prompt monolítico.
      prompt += `
=== FORMATO DE RESPOSTA OBRIGATÓRIO (RETORNE ESTRITAMENTE O BLOCO JSON): ===
Retorne ESTRITAMENTE o bloco JSON delimitado por \`\`\`json (sem links, sem atalhos, sem mensagens de texto fora do JSON, pronto para ser lido e organizado pelo site):
\`\`\`json
{
  "analise_do_pretendente": "Pensamento rápido: o que ele falou, quais perguntas fez e como você demonstrou calor humano, respondeu ao que ele quis saber e valorizou os tópicos dele.",
  "responses": ["primeiro balão", "segundo balão", "terceiro balão se houver múltiplos tópicos/perguntas"],
  "indices": [[0], [0]],
  "completed_checklist_ids": []
}
\`\`\``;
    }

    return {
      prompt,
      systemPrompt,
      pretendente,
      newMessagesCount: indexedNewMessages.length,
      newMessages: indexedNewMessages,
      temporalContext: {
        dateStr,
        timeStr,
        period,
        dayOfWeek,
      },
      usedEmojis,
      lastHadEmoji,
    };
  }
}
