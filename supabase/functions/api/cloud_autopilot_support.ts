import { validateAtriaTurnDecision } from "./conversation_turn_policy.ts";
import {
  parseAtriaSpecMarkdown,
  AtriaSpecResult,
  buildAtriaDossierMarkdown,
} from "./atria_spec_engine.ts";

// Regras de decisão do AutoPilot isoladas do gateway do webhook.
export interface CloudAutoPilotSupportDeps {
  getGroqApiKey: (supabase: any) => Promise<string | null>;
  getKieApiKey: (supabase: any) => Promise<string | null>;
  getOpenAiApiKey: (supabase: any) => Promise<string | null>;
  getTokenHarborApiKey: (supabase: any) => Promise<string | null>;
  getAtriaApiKey: (supabase: any) => Promise<string | null>;
  extractKieResponseText: (value: any) => string;
  sanitizeResponses: (responses: string[], bannedEmojis?: string[]) => string[];
}

interface OrchestratorDirective {
  action:
    | "call_persona"
    | "send_checklist_batch"
    | "pause_handoff"
    | "pause_guardrail";
  isRaffleReady: boolean;
  nextItem: any | null;
  directiveForPersona: string;
  checklistBatch?: any[];
  mustIncludeAudioTag?: string;
  mustIncludeAudioTags?: string[];
  targetChecklistId?: string;
  targetChecklistIds?: string[];
  reconciledCompletedIds?: string[];
  shouldPauseAfterSend?: boolean;
  pauseReason?: string;
  decisionReason?: string;
  directMode?: boolean;
}

export function createCloudAutoPilotSupport(deps: CloudAutoPilotSupportDeps) {
  const {
    getGroqApiKey,
    getKieApiKey,
    getOpenAiApiKey,
    getTokenHarborApiKey,
    getAtriaApiKey,
    extractKieResponseText,
    sanitizeResponses,
  } = deps;

  function normalizeOperatorText(str: string): string {
    return (str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAtriaAction(value: unknown): string {
    const action = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const aliases: Record<string, string> = {
      responder: "call_persona",
      respond: "call_persona",
      call_sol: "call_persona",
      sol: "call_persona",
      gerar_resposta: "call_persona",
      generate_response: "call_persona",
      send_media: "send_approved_media",
      enviar_midia: "send_approved_media",
      handoff: "pause_handoff",
      guardrail: "pause_guardrail",
    };
    if (action.includes("call_persona") && (action.includes("|") || action.includes("send_approved_media"))) {
      return "call_persona";
    }
    return aliases[action] || action;
  }

  function parseAtriaJson(content: unknown): Record<string, unknown> {
    const text = Array.isArray(content)
      ? content.map((part: any) => typeof part === "string" ? part : part?.text || "").join("")
      : String(content || "");
    const rawCleaned = text.trim()
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
      .replace(/```(?:json|text|markdown)?/gi, "")
      .trim();

    let cleaned = rawCleaned;
    // Tenta encontrar o bloco JSON que realmente contenha o campo "action"
    const actionJsonMatch = rawCleaned.match(/\{[\s\S]*?"action"\s*:[\s\S]*?\}/);
    if (actionJsonMatch) {
      cleaned = actionJsonMatch[0];
    } else {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
      }
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      // Fallback 1: se JSON.parse falhou por aspas internas sem escape ou markdown solto,
      // resgata os campos conhecidos via regex inteligente antes de desistir
      const actionMatch = cleaned.match(/"action"\s*:\s*"([^"]+)"/i);
      const reasonMatch = cleaned.match(/"reason"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+"|\s*})/i) ||
                          cleaned.match(/"reason"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i) ||
                          cleaned.match(/"analise_do_pretendente"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[a-zA-Z_]+"|\s*})/i) ||
                          cleaned.match(/"analise_do_pretendente"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      const mediaMatch = cleaned.match(/"mediaItemIds"\s*:\s*\[([\s\S]*?)\]/i);
      const goalsMatch = cleaned.match(/"checklistGoalIds"\s*:\s*\[([\s\S]*?)\]/i);
      if (actionMatch && actionMatch[1]) {
        parsed = {
          action: actionMatch[1].trim(),
          reason: reasonMatch ? reasonMatch[1].trim() : "",
          mediaItemIds: mediaMatch ? (mediaMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, "")) : [],
          checklistGoalIds: goalsMatch ? (goalsMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, "")) : [],
        };
      }
    }

    if (parsed && typeof parsed === "object") {
      // Se a Atria alucinou o formato do Sol com analise_do_pretendente, extrai como reason
      if ((!parsed.reason || typeof parsed.reason !== "string" || !parsed.reason.trim()) && typeof parsed.analise_do_pretendente === "string") {
        parsed.reason = parsed.analise_do_pretendente.trim();
      }
      // NUNCA permita que a chave responses da persona permaneça no resultado da Atria
      if ("responses" in parsed) {
        delete parsed.responses;
      }
    }

    // Fallback 2 (Tolerância Total a Falhas - Zero Throw):
    // Se a Atria respondeu em texto livre ou raciocínio corrido sem JSON, aproveita a intenção
    if (!parsed || typeof parsed !== "object") {
      let fallbackText = rawCleaned.slice(0, 1000).trim();

      // Se a Atria devolveu JSON quebrado da persona contendo analise_do_pretendente:
      const analiseMatch = rawCleaned.match(/"analise_do_pretendente"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"responses|"|\n|$)/i);
      if (analiseMatch && analiseMatch[1]) {
        fallbackText = analiseMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      } else {
        // Remove qualquer menção à chave "responses" e fragmentos de JSON
        fallbackText = fallbackText.replace(/"responses"\s*:\s*\[[\s\S]*/i, "")
          .replace(/^[{\s]*"?analise_do_pretendente"?\s*:\s*"?/i, "")
          .replace(/["\s,{}]+$/i, "")
          .trim();
      }

      // Se for meta-raciocínio interno em inglês sobre as instruções, sanitiza para diretriz em português
      if (/The user is asking me|I need to analyze|act as the "Atria"|one of 4 actions/i.test(fallbackText)) {
        fallbackText = "Atria analisou o pretendente e recomendou resposta conversacional calorosa e natural.";
      }
      // Por padrão em texto livre, a ação é SEMPRE responder com a persona (call_persona).
      // NUNCA deduz guardrail por palavras como "pause_guardrail" que pertencem ao system prompt!
      let deducedAction = "call_persona";
      if (/conteudo\s+explicito|foto\s+intima|ameaca\s+real/i.test(rawCleaned)) {
        deducedAction = "pause_guardrail";
      }

      parsed = {
        action: deducedAction,
        reason: fallbackText || "Atria analisou o pretendente e recomendou resposta conversacional natural.",
        checklistGoalIds: [],
        mediaItemIds: [],
      };
    }

    // Garante que qualquer resquício de JSON cru ou chave responses seja limpo de parsed.reason
    if (typeof parsed.reason === "string") {
      parsed.reason = parsed.reason
        .replace(/"responses"\s*:\s*\[[\s\S]*/i, "")
        .replace(/^[{\s]*"?analise_do_pretendente"?\s*:\s*"?/i, "")
        .replace(/["\s,{}]+$/i, "")
        .trim();
    }

    // Se a Atria devolveu reason com meta-instrução em inglês, limpa para texto humano
    if (typeof parsed.reason === "string") {
      if (/The user is asking me|I need to analyze|act as the "Atria"|one of 4 actions/i.test(parsed.reason)) {
        parsed.reason = "Atria analisou o pretendente e recomendou resposta conversacional calorosa e natural.";
      }
    }

    // Se a Atria devolveu reason com reticências, apenas pontuação ou muito curto, descarta para acionar o fallback semântico da política
    if (typeof parsed.reason === "string") {
      const trimmedReason = parsed.reason.trim();
      if (!trimmedReason || /^[\s.·…\-–—_~*#]+$/.test(trimmedReason) || trimmedReason.length < 5) {
        delete parsed.reason;
      }
    }

    // Se o Atria retornar o payload de persona (ex: analise_do_pretendente e responses) em vez de action,
    // normaliza automaticamente para call_persona preservando a análise como motivo estratégico.
    if (!parsed.action && (parsed.responses || parsed.analise_do_pretendente || parsed.analisePretendente)) {
      parsed.action = "call_persona";
      parsed.reason = String(
        parsed.analise_do_pretendente ||
        parsed.analisePretendente ||
        "Atria analisou o pretendente e recomendou resposta conversacional."
      );
      if (Array.isArray(parsed.completed_checklist_ids) && !parsed.checklistGoalIds) {
        parsed.checklistGoalIds = parsed.completed_checklist_ids;
      }
    }

    return parsed;
  }

  function parseSolResponse(content: string): {
    responses: string[];
    completedItemIds: unknown[];
    analisePretendente?: string;
  } {
    let thoughtFromThinkTag = "";
    const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
    if (thinkMatch && thinkMatch[1]) {
      thoughtFromThinkTag = thinkMatch[1].trim();
    }

    let clean = content
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
      .replace(/^```(?:json|text|markdown)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // Remove prefixos avulsos como "json\n{" ou "json {" comuns em respostas sem crases
    clean = clean.replace(/^(?:json|text|markdown)\s+/i, "").trim();

    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1).trim();
    }

    try {
      const parsed = JSON.parse(clean);
      if (parsed?.error) throw new Error("Sol retornou erro no corpo da resposta.");
      if (Array.isArray(parsed?.responses)) {
        const analise = String(parsed.analise_do_pretendente || parsed.analisePretendente || thoughtFromThinkTag || "").trim();
        return {
          responses: parsed.responses,
          completedItemIds: Array.isArray(parsed.completedItemIds)
            ? parsed.completedItemIds
            : Array.isArray(parsed.completed_checklist_ids)
            ? parsed.completed_checklist_ids
            : [],
          analisePretendente: analise || undefined,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("corpo da resposta")) throw error;
      const responseMatch = clean.match(/"responses"\s*:\s*\[([\s\S]*?)\]/);
      if (responseMatch?.[1]) {
        const extracted = Array.from(
          responseMatch[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g),
        ).map((match) => match[1]);
        if (extracted.length > 0) {
          const analiseMatch = clean.match(/"analise_do_pretendente"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
          const analise = (analiseMatch?.[1] || thoughtFromThinkTag || "").trim();
          return {
            responses: extracted,
            completedItemIds: [],
            analisePretendente: analise || undefined,
          };
        }
      }
    }

    // Trava de segurança: se a resposta contiver chaves de controle e não pôde ser parseada,
    // NUNCA retorne a string bruta como balão de texto para não vazar JSON no chat
    if (/"(?:analise_do_pretendente|responses|completed_checklist_ids)"\s*:/i.test(clean)) {
      throw new Error("Sol retornou estrutura de controle corrompida.");
    }

    if (clean && !clean.startsWith("{") && !clean.startsWith("[")) {
      return {
        responses: [clean],
        completedItemIds: [],
        analisePretendente: thoughtFromThinkTag || undefined,
      };
    }
    throw new Error("Sol retornou uma resposta sem texto utilizável.");
  }

  function isLarissaPersonalAudio(item: any): boolean {
    if (!item || item.type !== "audio") return false;
    const haystack = normalizeOperatorText(
      `${item.title || ""} ${item.content || ""}`,
    );
    return (
      haystack.includes("larissa") ||
      haystack.includes("sobre mim") ||
      haystack.includes("sobre ela") ||
      haystack.includes("sobre si") ||
      haystack.includes("quem sou") ||
      haystack.includes("01") ||
      haystack.includes("02")
    );
  }

  function buildChecklistBatch(stageChecklist: any[], nextItem: any): any[] {
    if (!nextItem) return [];
    const byId = new Map(stageChecklist.map((item: any) => [item.id, item]));
    const batch: any[] = [nextItem];

    const linked =
      (nextItem.linkedItemId && byId.get(nextItem.linkedItemId)) ||
      stageChecklist.find((item: any) => item.linkedItemId === nextItem.id);

    if (
      linked &&
      !linked.isCompleted &&
      !batch.some((item) => item.id === linked.id)
    ) {
      batch.push(linked);
    }

    const personalAudios = stageChecklist
      .filter(
        (item: any) =>
          item.type === "audio" &&
          !item.isCompleted &&
          isLarissaPersonalAudio(item),
      )
      .sort((a: any, b: any) =>
        String(a.title || "").localeCompare(String(b.title || "")),
      );

    if (
      nextItem.type === "audio" &&
      isLarissaPersonalAudio(nextItem) &&
      personalAudios.length >= 2
    ) {
      return personalAudios.slice(0, 2);
    }

    return batch;
  }

  function shouldPauseAfterPersonalAudioBatch(
    stageChecklist: any[],
    batch: any[],
  ): boolean {
    const completedOrSending = new Set([
      ...stageChecklist
        .filter((item: any) => item.isCompleted)
        .map((item: any) => item.id),
      ...batch.map((item: any) => item.id),
    ]);
    const personalAudios = stageChecklist.filter(
      (item: any) => item.type === "audio" && isLarissaPersonalAudio(item),
    );
    return (
      personalAudios.length > 0 &&
      personalAudios.every((item: any) => completedOrSending.has(item.id))
    );
  }

  function checklistBatchToResponses(batch: any[]): string[] {
    return batch
      .map((item: any) => {
        if (item.type === "audio" && item.mediaUrl)
          return `[audio:${item.mediaUrl}]`;
        if (item.type === "image" && item.mediaUrl)
          return `[image:${item.mediaUrl}]`;
        if (item.type === "text" && item.content) return String(item.content);
        return "";
      })
      .filter(Boolean);
  }

  function buildTextChecklistDirective(
    nextItem: any,
    lastThemText: string,
  ): string {
    const approvedText = String(nextItem?.content || "").trim();
    const itemTitle = String(nextItem?.title || "próximo item").trim();
    return `OBJETIVO DO CHECKLIST ATUAL: "${itemTitle}".
  Referência aprovada (não copie literalmente): "${approvedText}".
  Responda primeiro à última fala dele ("${lastThemText.slice(0, 120)}") com naturalidade e conecte o objetivo do checklist apenas se fizer sentido neste turno.
  Preserve a intenção e os fatos aprovados, mas escreva com palavras próprias, como uma conversa real. A naturalidade tem prioridade sobre a reprodução do roteiro.
  Não pule itens importantes do funil, mas pode adiar o checklist se a fala dele exigir uma reação genuína. Não invente fatos nem perguntas desconectadas do contexto.`;
  }

  async function pauseCloudAutoPilotForHandoff(
    supabase: any,
    conversationId: string,
    states: Record<string, any>,
    chatState: any,
    pauseReason: string,
    status: "paused_handoff" | "paused_guardrail" = "paused_handoff",
  ) {
    chatState.isEnabled = false;
    chatState.status = status;
    chatState.pauseReason = pauseReason;
    chatState.pausedAt = new Date().toISOString();
    chatState.activity = null;
    states[conversationId] = chatState;

    const { error: stateError } = await supabase.from("instagram_conversations").upsert({
      id: "__autopilot_states__",
      username: "system_autopilot",
      full_name: "Estados do Piloto Automático",
      status: "system",
      last_direction: "in",
      stage_completed_rules: { states, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    if (stateError) {
      console.error(
        `[TRACE-AUTOPILOT] state:persist_failure conversation=${conversationId} code=${stateError.code || "unknown"} message=${stateError.message || "unknown"}`,
      );
    }

    try {
      const realtimeChannel = supabase.channel("vendeo_realtime_chat");
      await realtimeChannel.send({
        type: "broadcast",
        event: "autopilot_state_update",
        payload: {
          conversationId,
          status,
          pauseReason,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (bErr) {
      console.warn("Aviso ao emitir broadcast de handoff:", bErr);
    }
  }

  /**
   * Orquestrador de Controle Estratégico (Custo Zero via Groq Llama-3.3-70b / Qwen-27b).
   * Inspeciona o checklist, detecta se atingiu o Ponto de Parada da Rifa e dita a Regra do Bumerangue para a Persona.
   */
  async function orchestrateConversationStep(
    supabase: any,
    stageChecklist: any[],
    formattedHistory: any[],
    pretendenteName: string,
    currentStageName: string,
  ): Promise<OrchestratorDirective> {
    // 1. Ponto de Parada: Se todos os áudios pessoais da etapa já foram enviados
    const personalAudios = stageChecklist.filter(
      (it: any) => it.type === "audio" && isLarissaPersonalAudio(it),
    );
    if (
      personalAudios.length > 0 &&
      personalAudios.every((it: any) => it.isCompleted)
    ) {
      return {
        action: "pause_handoff",
        isRaffleReady: true,
        nextItem: null,
        directiveForPersona:
          "Momento dos áudios sobre a Larissa concluído. Parada estratégica no Silêncio de Fechamento.",
        pauseReason:
          "Serviço da IA concluído: os áudios sobre a Larissa foram enviados com sucesso. Assuma a conversa manualmente.",
      };
    }

    // 2. Próximo item obrigatório do checklist
    const pendingItems = stageChecklist.filter((it: any) => !it.isCompleted);
    const nextItem = pendingItems[0] || null;

    // Se o próximo item for explicitamente sobre Rifa/Pix e já tiver cumprido áudios
    if (nextItem) {
      const titleLower = (nextItem.title || "").toLowerCase();
      const contentLower = (nextItem.content || "").toLowerCase();
      if (titleLower.includes("rifa") || contentLower.includes("rifa")) {
        const completedAudios = stageChecklist.filter(
          (it: any) => it.isCompleted && it.type === "audio",
        );
        if (completedAudios.length >= 2) {
          return {
            action: "pause_handoff",
            isRaffleReady: true,
            nextItem: null,
            directiveForPersona:
              "Momento da Rifa atingido após áudios pessoais. Parada no Silêncio de Fechamento.",
            pauseReason:
              "Momento da Rifa atingido após os áudios pessoais. Assuma o fechamento manual.",
          };
        }
      }
    }

    // Se não há itens pendentes nesta etapa
    if (!nextItem) {
      return {
        action: "call_persona",
        isRaffleReady: false,
        nextItem: null,
        directiveForPersona:
          "Continue a conversa de forma meiga e autêntica mantendo a conexão humana.",
        decisionReason: "Não há item pendente no checklist desta etapa.",
      };
    }

    // Mensagem mais recente do pretendente
    const themMessages = formattedHistory.filter(
      (m: any) => m.sender === "them",
    );
    const lastThem = themMessages[themMessages.length - 1];
    const lastThemText = lastThem
      ? lastThem.audioTranscript || lastThem.text || ""
      : "Oi";
    const lastThemNorm = normalizeOperatorText(lastThemText);
    const mustPauseForHuman =
      /\b(pix|pagamento|pagar|comprei|comprar|numero da rifa|número da rifa|cota|rifa|valor|preco|preço|chave|deposito|depósito)\b/i.test(
        lastThemNorm,
      ) &&
      stageChecklist.filter(
        (it: any) =>
          it.type === "audio" && it.isCompleted && isLarissaPersonalAudio(it),
      ).length >= 2;

    if (mustPauseForHuman) {
      return {
        action: "pause_handoff",
        isRaffleReady: true,
        nextItem: null,
        directiveForPersona:
          "Pedido de venda/pagamento detectado depois dos áudios pessoais. A IA deve parar.",
        pauseReason:
          "Cliente entrou em assunto de rifa/pagamento após os áudios pessoais. Assuma o fechamento manual.",
        decisionReason:
          "Assunto comercial sensível pertence ao operador humano.",
      };
    }

    // Saudação simples não deve inventar rotina, mas ainda precisa soar humana e puxar dado dele.
    // Por isso texto vai para a Persona com regra forte; áudio continua determinístico.
    const isSimpleWellbeing =
      /^(?:(?:oi|ola|bom dia|boa tarde|boa noite|opa|e ai)\s+)*(?:(?:tudo|ta tudo|esta tudo)\s+(?:bem|bom|otimo|certo|tranquilo)(?:\s+(?:e\s+)?(?:com\s+)?(?:voce|vc|contigo))?|(?:como\s+(?:voce\s+|vc\s+)?(?:esta|ta|vai))(?:\s+(?:voce|vc))?|(?:e\s+)?(?:voce|vc))$/.test(
        lastThemNorm,
      );
    const isGreetingItem =
      nextItem.type === "text" &&
      (normalizeOperatorText(nextItem.title) === "saudacao" ||
        normalizeOperatorText(nextItem.content) === "estou otima");
    const checklistBatch = buildChecklistBatch(stageChecklist, nextItem);
    const wellbeingTextBatchIds = [nextItem.id];
    if (isSimpleWellbeing && isGreetingItem) {
      const nextPending = pendingItems[1];
      if (
        nextPending?.type === "text" &&
        normalizeOperatorText(nextPending.title) === "cidade"
      ) {
        wellbeingTextBatchIds.push(nextPending.id);
      }
    }
    const checklistBatchResponses = checklistBatchToResponses(checklistBatch);
    const isPersonalAudio = nextItem.type === "audio" && isLarissaPersonalAudio(nextItem);
    const hasOpening = hasExplicitPersonalMediaOpening(lastThemText);

    // Regra de Ouro: Áudios sobre a Larissa NUNCA são enviados sem abertura explícita do pretendente.
    if (isPersonalAudio && !hasOpening) {
      return {
        action: "call_persona",
        isRaffleReady: false,
        nextItem: null,
        targetChecklistIds: [],
        directiveForPersona:
          "O pretendente ainda não perguntou sobre você. Primeiro valorize e comente o que ELE falou com curiosidade genuína. Em seguida, solte uma provocação meiga de abertura (ex: 'vc nem perguntou sobre mim né kkk' ou 'vou falar um pouquinho sobre mim rs') e pare por aí. NÃO envie o áudio agora e NÃO conte a sua história em texto: espere a resposta dele.",
        decisionReason:
          "Áudio pessoal retido: pretendente não perguntou sobre a Larissa. Sol orientado a provocar abertura natural.",
      };
    }

    const shouldSendChecklistBatch =
      nextItem.type === "audio" &&
      checklistBatch.length > 0 &&
      checklistBatchResponses.length === checklistBatch.length;

    if (shouldSendChecklistBatch) {
      const shouldPauseAfterSend = shouldPauseAfterPersonalAudioBatch(
        stageChecklist,
        checklistBatch,
      );
      const audioTags = checklistBatch
        .filter((item: any) => item.type === "audio" && item.mediaUrl)
        .map((item: any) => item.mediaUrl);

      return {
        action: "send_checklist_batch",
        isRaffleReady: false,
        nextItem,
        checklistBatch,
        targetChecklistId: nextItem.id,
        targetChecklistIds: checklistBatch.map((item: any) => item.id),
        directiveForPersona: `PROTOCOLO OPERACIONAL: envie os itens exatos deste bloco do checklist na mesma rodada, sem improvisar texto.`,
        mustIncludeAudioTag: audioTags[0],
        mustIncludeAudioTags: audioTags,
        shouldPauseAfterSend,
        pauseReason: shouldPauseAfterSend
          ? "Serviço da IA concluído: os áudios sobre a Larissa foram enviados com sucesso. Assuma a conversa manualmente."
          : undefined,
        decisionReason: shouldPauseAfterSend
          ? "Bloco obrigatório de áudios pessoais concluído; handoff imediato."
          : "Bloco obrigatório do checklist com conteúdo aprovado.",
      };
    }

    if (isSimpleWellbeing && isGreetingItem) {
      return {
        action: "call_persona",
        isRaffleReady: false,
        nextItem,
        targetChecklistId: nextItem.id,
        targetChecklistIds: wellbeingTextBatchIds,
        directiveForPersona: `PERGUNTA DE BEM-ESTAR: responda com a saudação aprovada "Estou ótima" e, se a etapa "Cidade" estiver pendente, pergunte sobre ele usando o objetivo do checklist ("Você é de onde ??") de forma natural. Não fale de estágio, hospital, correria ou rotina. Não trate isso como pergunta sobre o dia.`,
        decisionReason:
          "Saudação precisa de resposta humana controlada: sem inventar rotina, mas conduzindo para coletar dado do pretendente.",
      };
    }

    if (nextItem.type === "text") {
      return {
        action: "call_persona",
        isRaffleReady: false,
        nextItem,
        targetChecklistId: nextItem.id,
        targetChecklistIds: [nextItem.id],
        directiveForPersona: buildTextChecklistDirective(
          nextItem,
          lastThemText,
        ),
        decisionReason:
          "Item de texto do checklist deve ser conduzido pela Persona com conteúdo aprovado, sem perguntas laterais.",
      };
    }

    // 3. Chamada rápida e gratuita ao Groq (Orquestrador)
    const groqKey = await getGroqApiKey(supabase);
    let directive = "";

    if (groqKey) {
      try {
        const orchestratorPrompt = `Você é o Orquestrador Estratégico do Vendeo.
  Sua missão NÃO é falar com o cliente, mas formular a DIRETRIZ OBRIGATÓRIA DA REGRA DO BUMERANGUE para a Persona da Larissa.

  DADOS DA CONVERSA:
  - Pretendente: ${pretendenteName}
  - Última fala dele: "${lastThemText.slice(0, 160)}"
  - Etapa Atual: "${currentStageName}"
  - Próximo Item Obrigatório do Checklist:
    * Título: "${nextItem.title}"
    * Tipo: ${nextItem.type}
    * Descrição/Tema: "${nextItem.content || "Sem descrição"}"
    ${nextItem.type === "audio" && nextItem.mediaUrl ? `* Link do Áudio obrigatório: [audio:${nextItem.mediaUrl}]` : ""}

  REGRA DO BUMERANGUE:
  1. Anti-Papagaio: Não repita nem resuma o que ele disse.
  2. Reação Autêntica: A Larissa deve reagir com personalidade meiga/mineira ao tema dele.
  3. Conexão Imediata: Puxar o gancho obrigatório de volta para o próximo item do checklist ("${nextItem.title}").

  PROTOCOLO DO OPERADOR AUTÔNOMO:
  1. A IA gratuita controla a operação; a Persona/Astra só deve ser chamada quando for preciso escrever uma resposta humana.
  2. Se o próximo item for áudio ou mídia de checklist, mande o item exato do checklist; não peça para a Persona inventar uma versão.
  3. Se houver itens vinculados por linkedItemId, eles pertencem ao mesmo bloco e devem sair na mesma rodada.
  4. Depois dos 2 áudios pessoais da Larissa, a IA deve parar, marcar handoff e avisar o operador humano.
  5. Nunca avance para rifa, Pix, preço ou fechamento automático. Isso é trabalho humano.
  6. Se faltar contexto, houver risco, foto, nudez, agressividade ou pedido comercial sensível, pause em vez de improvisar.
  7. "Tudo bem?", "como você está?" e "e você?" são perguntas de bem-estar: use a saudação aprovada ("Estou ótima") e conduza à pergunta da cidade se ela for o próximo item pendente. Não fale de estágio, hospital ou correria.
  8. Só autorize falar da rotina do estágio quando ele perguntar explicitamente como foi/está o dia. Mesmo nesse caso, não invente acontecimentos e mantenha o próximo passo do checklist.

  Retorne EXCLUSIVAMENTE em formato JSON:
  {
    "pretendenteTopic": "tópico dele",
    "directiveForPersona": "diretriz clara para a Larissa: reaja a X e conecte com Y"
  }`;

        const orchRes = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${groqKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: orchestratorPrompt }],
              temperature: 0.3,
              max_tokens: 250,
              response_format: { type: "json_object" },
            }),
            signal: AbortSignal.timeout(4000),
          },
        );

        if (orchRes.ok) {
          const oData = await orchRes.json();
          const oContent = oData?.choices?.[0]?.message?.content;
          if (oContent) {
            const parsedOrch = JSON.parse(oContent);
            directive = parsedOrch.directiveForPersona || "";
          }
        }
      } catch (orchErr) {
        console.warn("[Orchestrator Groq] Fallback heurístico:", orchErr);
      }
    }

    // Fallback determinístico caso o Groq falhe
    if (!directive) {
      const isAudio = nextItem.type === "audio";
      directive = `REGRA DO BUMERANGUE: Reaja de forma autêntica e meiga à fala dele ("${lastThemText.slice(0, 50)}..."), sem papagaiar, e arremate imediatamente puxando o gancho para ${isAudio ? `mandar o áudio sobre "${nextItem.title}"` : `falar sobre "${nextItem.title}" (${nextItem.content || ""})`}.`;
    }

    return {
      action: "call_persona",
      isRaffleReady: false,
      nextItem,
      targetChecklistId: nextItem.id,
      targetChecklistIds: [nextItem.id],
      directiveForPersona: directive,
      mustIncludeAudioTag:
        nextItem.type === "audio" ? nextItem.mediaUrl : undefined,
      mustIncludeAudioTags:
        nextItem.type === "audio" && nextItem.mediaUrl
          ? [nextItem.mediaUrl]
          : undefined,
      decisionReason:
        "Resposta humana necessária; encaminhar para Persona/Astra com a diretriz do operador.",
    };
  }

  /**
   * Utilitário resiliente para consumir ReadableStream (SSE / Chunks) ou fallbacks síncronos
   */
  async function readStreamOrText(
    res: any,
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<{ raw: string; text: string }> {
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const DecoderClass = typeof TextDecoder !== "undefined" ? TextDecoder : (globalThis as any).TextDecoder;
      const decoder = new DecoderClass();
      let buffer = "";
      let rawBody = "";
      let accumulatedText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const decodedChunk = decoder.decode(value, { stream: true });
          rawBody += decodedChunk;
          buffer += decodedChunk;

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              const jsonStr = trimmed.slice(6).trim();
              if (jsonStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(jsonStr);
                // 1. OpenAI / DeepSeek (TokenHarbor, Atria-ASI, Groq)
                const delta = parsed?.choices?.[0]?.delta;
                const piece = delta?.content || delta?.reasoning_content || "";
                if (piece) {
                  accumulatedText += piece;
                  if (onStreamChunk) {
                    try { await onStreamChunk(piece, accumulatedText); } catch {}
                  }
                }
                // 2. Gemini / Kie
                if (Array.isArray(parsed?.candidates)) {
                  for (const cand of parsed.candidates) {
                    const parts = cand?.content?.parts;
                    if (Array.isArray(parts)) {
                      for (const p of parts) {
                        if (typeof p?.text === "string" && p.text) {
                          accumulatedText += p.text;
                          if (onStreamChunk) {
                            try { await onStreamChunk(p.text, accumulatedText); } catch {}
                          }
                        }
                      }
                    }
                  }
                }
              } catch {
                // buffer parcial segue
              }
            }
          }
        }

        // Processa qualquer resíduo restante no buffer após encerramento do stream
        const remaining = buffer.trim();
        if (remaining && remaining.startsWith("data: ")) {
          const jsonStr = remaining.slice(6).trim();
          if (jsonStr && jsonStr !== "[DONE]") {
            try {
              const parsed = JSON.parse(jsonStr);
              const piece = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.delta?.reasoning_content || "";
              if (piece) {
                accumulatedText += piece;
                if (onStreamChunk) {
                  try { await onStreamChunk(piece, accumulatedText); } catch {}
                }
              }
              if (Array.isArray(parsed?.candidates)) {
                for (const cand of parsed.candidates) {
                  for (const p of (cand?.content?.parts || [])) {
                    if (typeof p?.text === "string" && p.text) {
                      accumulatedText += p.text;
                      if (onStreamChunk) {
                        try { await onStreamChunk(p.text, accumulatedText); } catch {}
                      }
                    }
                  }
                }
              }
            } catch {}
          }
        }

        // Fallback defensivo: se acumulou vazio mas o corpo bruto contém partes de texto SSE, extrai via regex
        if (!accumulatedText.trim() && rawBody.includes('"parts"')) {
          const matches = rawBody.matchAll(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g);
          for (const m of matches) {
            try {
              const unescaped = JSON.parse(`"${m[1]}"`);
              accumulatedText += unescaped;
            } catch {
              accumulatedText += m[1];
            }
          }
        }
      } catch (readErr) {
        console.warn("[StreamReader] Erro lendo stream:", readErr);
      }
      return { raw: rawBody, text: accumulatedText || rawBody };
    }

    // Fallback sem ReadableStream (ex: mocks de teste com res.json/res.text)
    let rawText = "";
    if (typeof res.text === "function") {
      rawText = await res.text();
    }
    let extractedContent = rawText;
    try {
      const parsed = JSON.parse(rawText);
      const msg = parsed?.choices?.[0]?.message;
      if (typeof msg?.content === "string") {
        extractedContent = msg.content;
      }
    } catch {}

    if (onStreamChunk && extractedContent) {
      try { await onStreamChunk(extractedContent, extractedContent); } catch {}
    }
    return { raw: rawText, text: extractedContent };
  }

  async function generateGroqFallbackResponse(
    supabase: any,
    promptText: string,
    allowedChecklistIds: string[] = [],
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }> {
    const groqKey = await getGroqApiKey(supabase);
    if (!groqKey) throw new Error("Chave da Groq não configurada.");
    console.log("[TRACE-AUTOPILOT] Sol:groq_fallback_start");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.7,
        response_format: { type: "json_object" },
        stream: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Groq fallback indisponível (HTTP ${res.status}).`);
    }
    const streamResult = await readStreamOrText(res, onStreamChunk);
    const content = streamResult.text || "";
    const parsed = parseSolResponse(content);
    if (
      !Array.isArray(parsed.responses) ||
      parsed.responses.length < 1 ||
      parsed.responses.some(
        (text: unknown) =>
          typeof text !== "string" ||
          !text.trim() ||
          /\[(?:audio|image|video):/i.test(text),
      )
    ) {
      throw new Error("Groq fallback retornou respostas inválidas.");
    }
    const completedItemIds = (parsed.completedItemIds || []).filter(
      (id: unknown) => typeof id === "string" && allowedChecklistIds.includes(id),
    );
    console.log(`[TRACE-AUTOPILOT] Groq:fallback_success responses=${parsed.responses.length}`);
    return {
      responses: parsed.responses,
      modelUsed: "Groq (llama-3.3-70b-versatile, fallback Sol)",
      completedItemIds: Array.from(new Set(completedItemIds)),
      analisePretendente: parsed.analisePretendente,
    };
  }

  async function generateOpenAiPersonaResponse(
    supabase: any,
    promptText: string,
    allowedChecklistIds: string[] = [],
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }> {
    const openAiKey = await getOpenAiApiKey(supabase);
    if (!openAiKey) throw new Error("Chave da OpenAI não configurada.");
    console.log(`[TRACE-AUTOPILOT] OpenAI:start promptChars=${promptText.length}`);

    const primaryModel = "gpt-5.6-terra";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: primaryModel,
        messages: [{ role: "user", content: promptText }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1500,
        stream: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      let errBody = "";
      try { errBody = await res.text(); } catch {}
      throw new Error(`OpenAI indisponível (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
    }

    const streamResult = await readStreamOrText(res, onStreamChunk);
    const content = streamResult.text || "";
    const parsed = parseSolResponse(content);
    if (
      !Array.isArray(parsed.responses) ||
      parsed.responses.length < 1 ||
      parsed.responses.some(
        (text: unknown) =>
          typeof text !== "string" ||
          !text.trim() ||
          /\[(?:audio|image|video):/i.test(text),
      )
    ) {
      throw new Error("OpenAI retornou respostas em formato inválido.");
    }
    const completedItemIds = (parsed.completedItemIds || []).filter(
      (id: unknown) => typeof id === "string" && allowedChecklistIds.includes(id),
    );
    console.log(`[TRACE-AUTOPILOT] OpenAI:success responses=${parsed.responses.length} model=${primaryModel}`);
    return {
      responses: parsed.responses,
      modelUsed: `OpenAI (${primaryModel}, Sol)`,
      completedItemIds: Array.from(new Set(completedItemIds)),
      analisePretendente: parsed.analisePretendente,
    };
  }

  /**
   * Sol recebe exatamente o prompt copiável. Atria controla o fluxo e o backend
   * envia os itens do cofre; nenhum deles reescreve os balões gerados pelo Sol.
   */
  async function generatePersonaResponse(
    supabase: any,
    promptText: string,
    allowedChecklistIds: string[] = [],
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }> {
    // 1. Provedor Primário Sol: OpenAI direta oficial (gpt-4o-mini)
    try {
      const openAiKey = await getOpenAiApiKey(supabase);
      if (openAiKey) {
        return await generateOpenAiPersonaResponse(
          supabase,
          promptText,
          allowedChecklistIds,
          onStreamChunk,
        );
      }
    } catch (openAiErr) {
      console.warn(
        "[TRACE-AUTOPILOT] OpenAI indisponível para o Sol. Acionando fallback Gemini:",
        openAiErr instanceof Error ? openAiErr.message : String(openAiErr),
      );
    }

    // 2. Provedor Secundário (Fallback): Kie.ai Gemini (gemini-3-8-flash)
    const key = await getKieApiKey(supabase);
    if (!key) {
      console.warn("[TRACE-AUTOPILOT] Chave Kie não configurada. Ativando fallback Atria imediato...");
      return await generateAtriaFallbackResponse(supabase, promptText, onStreamChunk);
    }
    console.log(`[TRACE-AUTOPILOT] Gemini:start promptChars=${promptText.length}`);
    let raw = "";
    let lastProviderError = "";
    const maxAttempts = 3;
    const perAttemptTimeoutMs = 18000; // Timeout de 18s por tentativa para não estourar o limite de 150s da Edge Function
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch("https://api.kie.ai/gemini/v1/models/gemini-3-8-flash:streamGenerateContent", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                analise_do_pretendente: { type: "STRING" },
                responses: { type: "ARRAY", items: { type: "STRING" } },
                completedItemIds: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["analise_do_pretendente", "responses"],
            },
          },
        }),
        signal: AbortSignal.timeout(perAttemptTimeoutMs),
      });
      console.log(`[TRACE-AUTOPILOT] Gemini:http status=${res.status} attempt=${attempt}`);
      
      let responseBody = "";
      if (res.ok) {
        const streamResult = await readStreamOrText(res, onStreamChunk);
        responseBody = streamResult.raw || streamResult.text;
        raw = (streamResult.text.trim() && !streamResult.text.startsWith("data: "))
          ? streamResult.text.trim()
          : extractKieResponseText(responseBody).trim();
      } else {
        responseBody = await res.text();
        raw = extractKieResponseText(responseBody).trim();
      }

      // O Kie pode responder HTTP 200 e só depois emitir `event: error` no SSE ou JSON de erro como {"code":500,"msg":"Server exception"}
      const streamError = responseBody.match(
        /(?:event:\s*error[\s\S]*?data:\s*)?(\{[^\r\n]*"(?:type|code|msg|error)"\s*:\s*(?:500|502|503|504|"(?:server_error|error|upstream_error|Server exception)")[^\r\n]*\})/i,
      )?.[1];
      let providerDetail = "";
      if (streamError) {
        try {
          const parsedError = JSON.parse(streamError);
          providerDetail = String(parsedError?.msg || parsedError?.message || parsedError?.error?.message || streamError);
        } catch {
          providerDetail = streamError;
        }
      } else if (!res.ok) {
        providerDetail = responseBody.replace(/\s+/g, " ").trim().slice(0, 400);
      }

      if (res.ok && raw && !providerDetail) {
        lastProviderError = "";
        break;
      }
      lastProviderError = providerDetail || "resposta vazia do provedor";
      console.warn(
        `[TRACE-AUTOPILOT] Gemini:retryable_failure attempt=${attempt} status=${res.status} detail=${lastProviderError.slice(0, 400)}`,
      );
      if (attempt < maxAttempts) {
        const delayMs = 1000;
        console.log(`[TRACE-AUTOPILOT] Gemini:aguardando ${delayMs}ms para próxima tentativa...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    if (!raw || lastProviderError) {
      // Se o Kie falhar, tenta contingência rápida com Groq antes de desistir
      try {
        const groqKey = await getGroqApiKey(supabase);
        if (groqKey) {
          console.warn(
            `[TRACE-AUTOPILOT] Sol indisponível no Kie (${lastProviderError}). Acionando fallback Groq...`,
          );
          return await generateGroqFallbackResponse(
            supabase,
            promptText,
            allowedChecklistIds,
            onStreamChunk,
          );
        }
      } catch (fallbackErr) {
        console.warn(
          "[TRACE-AUTOPILOT] Falha no fallback Groq:",
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        );
      }
      throw new Error(`Sol indisponível no Kie${lastProviderError ? `: ${lastProviderError}` : ""}.`);
    }
    const parsed = parseSolResponse(raw);
    if (!Array.isArray(parsed.responses) || parsed.responses.length < 1 ||
        parsed.responses.some((text: unknown) => typeof text !== "string" || !text.trim() ||
          /\[(?:audio|image|video):/i.test(text))) {
      throw new Error("Sol deve retornar apenas balões de texto válidos.");
    }
    const completedItemIds = parsed.completedItemIds;
    if (
      completedItemIds.some(
        (id: unknown) =>
          typeof id !== "string" || !allowedChecklistIds.includes(id),
      )
    ) {
      throw new Error("Sol retornou checklist inválido ou não autorizado.");
    }
    console.log(`[TRACE-AUTOPILOT] Gemini:success responses=${parsed.responses.length}`);
    return {
      responses: parsed.responses,
      modelUsed: "Kie.ai (gemini-3-8-flash)",
      completedItemIds: Array.from(new Set(completedItemIds)),
      analisePretendente: parsed.analisePretendente,
    };
  }

  async function generateAtriaFallbackResponse(
    supabase: any,
    promptText: string,
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }> {
    const key = await getAtriaApiKey(supabase);
    if (!key) throw new Error("Chave do fallback Atria não configurada.");
    const res = await fetch("https://api.atria-asi.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "Atria-Dawn-Preview",
        messages: [
          // O fallback recebe exatamente o mesmo prompt integral enviado ao Sol.
          { role: "user", content: promptText },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Atria fallback indisponível (HTTP ${res.status}): ${errText}`);
    }
    const streamResult = await readStreamOrText(res, onStreamChunk);
    const content = streamResult.text || "";
    const parsedFallback = parseSolResponse(content);
    const responses = parsedFallback.responses
      .filter((text: unknown): text is string => typeof text === "string" && Boolean(text.trim()))
      .map((text) => text.trim());
    if (!responses.length || responses.some((text) => /\[(?:audio|image|video):/i.test(text))) {
      throw new Error("Atria fallback retornou uma mensagem inválida.");
    }
    console.log(`[TRACE-AUTOPILOT] Atria:fallback_success responses=${responses.length}`);
    return {
      responses,
      modelUsed: "Atria-Dawn-Preview (fallback do Sol)",
      completedItemIds: [],
      analisePretendente: parsedFallback.analisePretendente,
    };
  }

  /**
   * Atria recebe o prompt integral da conversa e todo o checklist da etapa.
   * Retorna somente uma decisão. Textos e URLs de mídia vêm do cofre, nunca do LLM.
   */
  async function atriaControlStep(
    base: OrchestratorDirective,
    context: {
      conversationPrompt: string;
      stageName: string;
      checklist: any[];
      latestContactText?: string;
      pretendente?: any;
      historyMessages?: any[];
      searchedWebContext?: string;
    },
    supabase: any,
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ): Promise<OrchestratorDirective> {
    const pause = (reason: string): OrchestratorDirective => ({
      action: "pause_guardrail", isRaffleReady: false, nextItem: null,
      directiveForPersona: "", pauseReason: reason,
    });
    const naturalFallback = (reason: string): OrchestratorDirective => {
      const nextPending = context.checklist.find((it: any) => !it.isCompleted && it.type === "text") || null;
      const targetIds = nextPending ? [nextPending.id] : [];
      const itemDirective = nextPending?.content
        ? `\n\n# OBJETIVO OBRIGATÓRIO DO CHECKLIST\nFaça a pergunta baseada neste item do cronograma: "${nextPending.content}". Seja autêntica, meiga e espontânea.`
        : "";
      return {
        action: "call_persona",
        isRaffleReady: false,
        nextItem: nextPending,
        targetChecklistIds: targetIds,
        directiveForPersona: `Mantenha a resposta breve e calorosa. Se o pretendente perguntou sobre você ou sua vida ('e vc?'), NUNCA descreva sua biografia, idade ou curso em texto; isso pertence exclusivamente aos áudios gravados no cofre. Apenas solte uma reação rápida e meiga (ex: 'já vou te contar kkk').${itemDirective}`,
        decisionReason: reason,
      };
    };
    if (base.action === "pause_handoff" || base.action === "pause_guardrail") return base;
    const openAiKey = await getOpenAiApiKey(supabase);
    const tokenHarborKey = await getTokenHarborApiKey(supabase);
    const atriaKey = await getAtriaApiKey(supabase);
    if (!openAiKey && !tokenHarborKey && !atriaKey) {
      return pause("Nenhuma chave configurada para o orquestrador (OpenAI, TokenHarbor ou Atria-ASI). Revise a configuração.");
    }
    console.log(`[TRACE-AUTOPILOT] Atria:start promptChars=${context.conversationPrompt.length} checklist=${context.checklist.length}`);
    let sanitizedPromptForAtria = context.conversationPrompt
      .replace(/# FORMATO DE SAÍDA OBRIGATÓRIO[\s\S]*$/i, "")
      .replace(/Retorne EXCLUSIVAMENTE um objeto JSON[\s\S]*$/i, "")
      .trim();

    if (
      sanitizedPromptForAtria.includes("Exemplo 1 (") ||
      sanitizedPromptForAtria.includes("DNA LINGUÍSTICO") ||
      sanitizedPromptForAtria.includes("BIOGRAFIA REAL")
    ) {
      sanitizedPromptForAtria = sanitizedPromptForAtria
        .replace(/=== EXEMPLOS REAIS DE DIÁLOGOS[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .replace(/• DIRETRIZES DE DIGITAÇÃO DE CELULAR[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .replace(/• DNA LINGUÍSTICO[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .replace(/• BIOGRAFIA REAL OFICIAL DA LARISSA[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .replace(/• ⚠️ TRAVA DETERMINÍSTICA ANTI-ROBÔ DE EMOJIS[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .replace(/• ⚠️ TRAVA DE REPETIÇÃO DE EMOJIS[\s\S]*?(?=(?:=== HISTÓRICO|Bio dele:|Cidade dele:|=== CRONOGRAMA|=== MENSAGENS NOVAS))/i, "")
        .trim();
    }

    // Gera o Dossiê Executivo de Turno em Markdown puro para a Atria
    let userPromptContent: string;
    if (context.historyMessages && Array.isArray(context.historyMessages) && context.historyMessages.length > 0) {
      userPromptContent = buildAtriaDossierMarkdown({
        stageName: context.stageName,
        checklist: context.checklist,
        pretendente: context.pretendente || { name: "Contato" },
        historyMessages: context.historyMessages,
        searchedWebContext: context.searchedWebContext,
      });
    } else {
      userPromptContent = buildAtriaDossierMarkdown({
        stageName: context.stageName,
        checklist: context.checklist,
        pretendente: context.pretendente || { name: "Contato" },
        historyMessages: [
          {
            sender: "them",
            text: context.latestContactText || "Oi",
            timestamp: new Date().toISOString(),
          },
        ],
        searchedWebContext: context.searchedWebContext,
      }) + `\n\n## CONTEXTO HISTÓRICO ADICIONAL\n${sanitizedPromptForAtria}`;
    }

    const systemPromptContent = `Você é a ATRIA, estrategista sênior de conversa e auditora de cronograma do Vendeo.
Você NUNCA é a Larissa e NUNCA responde mensagens diretamente para o pretendente. Toda mensagem textual enviada ao pretendente é redigida exclusivamente pelo Sol.

IDIOMA E COMUNICAÇÃO OBRIGATÓRIOS:
- Você deve raciocinar, analisar, auditar e gerar ABSOLUTAMENTE TUDO em português brasileiro fluente.
- Todos os títulos (# AÇÃO, # ITENS CONCLUÍDOS NESTE TURNO, # OBJETIVOS DESTE TURNO, # ITENS DE MÍDIA, # ESPECIFICAÇÃO PARA O SOL, # MOTIVO ESTRATÉGICO) e seus conteúdos devem ser produzidos 100% em português brasileiro. Nenhuma palavra em inglês.

Sua missão é ler o Dossiê do Turno recebido (contendo o checklist oficial com conteúdo real e o histórico de até 500 mensagens com horário de Brasília) e emitir uma ESPECIFICAÇÃO DE TURNO em Markdown puro.

=== DIRETRIZES FUNDAMENTAIS DA AUDITORA ===

1. AUDITORIA RETROSPECTIVA RIGOROSA (RECONHECIMENTO EXCLUSIVO DE DADOS FORNECIDOS PELO PRETENDENTE):
   - Um item de checklist (ex: Cidade do pretendente, O que ele faz da vida, Idade, Hobbies) SÓ PODE SER DADO COMO CONCLUÍDO se o pretendente EFETIVAMENTE INFORMOU o dado dele no histórico (ex: "sou de Petrópolis", "trabalho com vendas", "tenho 28 anos")!
   - ⚠️ PERGUNTAS ESPELHADAS FEITAS PELO PRETENDENTE ("De onde vc é?", "O que vc faz?", "Vc tem quantos anos?") NÃO CONCLUEM O ITEM:
     Se o pretendente perguntou de onde a Larissa é ("De onde vc é?"), a informação sobre a cidade DELE continua 100% PENDENTE e desconhecida!
     * É TERMINANTEMENTE PROIBIDO marcar o item de cidade como concluído nesse caso!
     * O item de cidade DELE DEVE constar em '# OBJETIVOS DESTE TURNO'.
     * Na '# ESPECIFICAÇÃO PARA O SOL': ordene que o Sol responda à pergunta dele (dizendo que é de São João del Rei / MG) E OBRIGATORIAMENTE DEVOLVA A PERGUNTA para saber a cidade DELE ("e vc, é de onde?" / "mora por onde?").
     * É TERMINANTEMENTE PROIBIDO pular para a etapa seguinte (trabalho, idade ou hobbies) antes de saber a cidade dele e trocar assunto sobre a cidade dele!
   - Se o pretendente realmente já tiver informado ou adiantado um dado no histórico anterior, aí sim você lista o item em '# ITENS CONCLUÍDOS NESTE TURNO' com a justificativa.

2. GATILHO DE ÁUDIOS GRAVADOS NO COFRE (ÁUDIOS PESSOAIS DA LARISSA):
   - Os áudios gravados no cofre (ex: Áudio 01 - Quem é a Larissa / Faculdade e Áudio 02 - Trabalho com vendas online) NUNCA devem ser prometidos para o futuro ("depois te mando áudio").
   - O Sol NUNCA deve falar em texto o que pertence a um áudio gravado!
   - Se o próximo item for áudio pessoal:
     * SE ELE PERGUNTOU SOBRE ELA ("e vc?", "o que vc faz?", "me conta de vc", "trabalha com oq?"): Escolha a ação ENVIAR_AUDIO e liste o ID do áudio em '# ITENS DE MÍDIA'. O Sol fará uma reação afetuosa e o backend despacha os áudios logo em seguida na Meta com cadência humana.
     * SE ELE NÃO PERGUNTOU SOBRE ELA: Se a conversa sobre a cidade dele e o trabalho/rotina dele já rendeu, escolha ENVIAR_AUDIO com o ID do áudio em '# ITENS DE MÍDIA'. Na '# ESPECIFICAÇÃO PARA O SOL', dite que o Sol solte o deboche meigo característico da Larissa puxando a vez dela com charme (ex: "vou falar mais sobre mim também, já que vc não perguntou kkk" / "já que vc não me perguntou nada vou falar de mim também kkk"), e o backend despachará os áudios logo em seguida no mesmo turno!
     * ⚠️ PROIBIÇÃO TERMINANTE DE PROMETER ÁUDIOS EM AÇÕES DE TEXTO (CHAMAR_SOL): É TERMINANTEMENTE PROIBIDO instruir o Sol a falar "depois te mando um áudio" ou "já vou te mandar um áudio". Se a ação for CHAMAR_SOL, a conversa flui exclusivamente em texto natural sem jamais mencionar áudios futuros!

3. CADÊNCIA HUMANA E DESENVOLVIMENTO DE ASSUNTO (NUNCA ATROPELAR COM QUESTIONÁRIOS):
   A Atria NUNCA deve tratar a conversa como um formulário para preencher às pressas! Conversas reais no Direct/WhatsApp precisam respirar, criar empatia e intimidade antes de mudar de assunto:
   a) QUANDO O PRETENDENTE FALAR A CIDADE DELE:
      - NUNCA empurre imediatamente a próxima etapa de "Perguntar sobre ele" (trabalho/idade/hobbies) no mesmo turno!
      - Escolha SEMPRE a ação CHAMAR_SOL com '# OBJETIVOS DESTE TURNO: NENHUM'.
      - Na '# ESPECIFICAÇÃO PARA O SOL': dite que o Sol converse sobre a cidade dele! Comentar o clima (serra/frio/praia/calor), distância em relação a Minas Gerais (São João del Rei / BH), elogiar a cidade ou perguntar com curiosidade meiga se ele nasceu lá ou se mudou pra lá depois.
      - Deixe o pretendente responder e trocar sobre a cidade antes de introduzir novos temas do cronograma.
   b) QUANDO O PRETENDENTE FALAR SOBRE ELE (TRABALHO / CLT / ROTINA / IDADE / ESTILO CASEIRO OU BALADEIRO):
      - NUNCA pule de imediato para envio de áudios do cofre nem dispare mais perguntas frias de checklist!
      - Escolha SEMPRE a ação CHAMAR_SOL com '# OBJETIVOS DESTE TURNO: NENHUM'.
      - Na '# ESPECIFICAÇÃO PARA O SOL': dite que o Sol gere identificação, conexão e afeto sobre o que ele acabou de contar:
        * Se falou de trabalho / CLT: comentar que vida de CLT é correria e que a Larissa também rala muito com estágio em hospital e vendas online.
        * Se falou que é caseiro / não é de sair: conectar com entusiasmo com o jeito da Larissa (ela odeia baladas tumultuadas e ama ficar deitada na cama de pijama vendo filme sob o cobertor).
        * Se falou a idade: brincar carinhosamente com a idade dele.
      - Aprofundar esse assunto gera conexão emocional genuína, essencial para o pretendente se apaixonar e confiar nela.
   c) PROIBIÇÃO TERMINANTE DE METRALHADORA DE PERGUNTAS (MÁXIMO 1 PERGUNTA POR TURNO):
      - É TERMINANTEMENTE PROIBIDO autorizar ou sugerir perguntas múltiplas no mesmo turno (ex: 'o que faz da vida, quantos anos tem e o que gosta de fazer' juntos).
      - Toda pergunta deve ser única, natural e acolhedora.

4. INSPIRAÇÃO DO CHECKLIST PARA O SOL:
   - Ao escolher CHAMAR_SOL para conduzir uma pergunta do checklist, cite o 'Conteúdo / O que pede' do item no bloco '# ESPECIFICAÇÃO PARA O SOL'.
   - Isso serve de inspiração direta para o Sol redigir perguntas ricas e naturais no tom autêntico da Larissa.

5. TRANSIÇÃO OBRIGATÓRIA DE ASSUNTO MASSIVO:
   - Se a conversa já tiver rendido bem e estiver há 2 turnos ou mais no mesmo tema lateral (ex: trabalho dele, cachorro, praia), esse assunto ficou massivo.
   - Escolha CHAMAR_SOL e instrua o Sol a validar o assunto brevemente em 1 frase curta com carinho e fazer a ponte suave para o próximo objetivo do checklist ou isca da Larissa.

6. ENTIDADES DO MUNDO REAL E REGRA DA CURIOSIDADE MEIGA:
   - Se o pretendente citar artistas, eventos, festas, cidades, hobbies ou termos específicos:
     * SE FOR CONHECIDO (ou constar na seção de pesquisa do Dossiê): Use seu conhecimento de mundo para ditar a vibe correta no '# ESPECIFICAÇÃO PARA O SOL' (ex: Mumuzinho é pagode/samba -> Sol valida a vibe animada de pagode; Barretos é rodeio -> Sol valida a cultura sertaneja), proibindo o efeito papagaio.
     * SE FOR DESCONHECIDO, LOCAL OU A PESQUISA NÃO ENCONTRAR NADA: NUNCA invente nem alucine que conhece! Aplique a REGRA DA CURIOSIDADE MEIGA: instrua o Sol a admitir com carinho e meiguice que nunca ouviu falar e perguntar com curiosidade autêntica pro pretendente explicar o que é / como é lá (ex: "Nossa, nunca ouvi falar kkk, toca o que por lá?"). Ninguém de 23 anos conhece tudo no mundo, e perguntar com curiosidade sincera gera conexão humana imediata e zero alucinação!

7. ENCERRAMENTO E PAUSA HUMANA (PAUSAR_HUMANO):
   - Se os áudios pessoais sobre a Larissa já foram entregues e o pretendente respondeu, a missão da IA na etapa foi cumprida. Emita PAUSAR_HUMANO para que o operador assuma o fechamento.
   - Se o contato pedir Pix, rifa, pagamento ou cota após os áudios, emita PAUSAR_HUMANO imediatamente.

8. REGRA DE OURO DE FORMATO (ZERO PREÂMBULO / NUNCA RETORNE JSON):
   - Você NUNCA deve retornar JSON e NUNCA deve divagar em inglês ou adicionar explicações antes dos títulos.
   - NUNCA use tags <think> ou raciocínio solto.
   - Sua resposta DEVE começar IMEDIATAMENTE na primeira linha com o cabeçalho '# AÇÃO'.
   - Responda EXCLUSIVAMENTE em Português no formato Markdown oficial com as 6 seções canônicas:

# AÇÃO
[CHAMAR_SOL | ENVIAR_AUDIO | ENVIAR_FOTO | PAUSAR_HUMANO | PAUSAR_RISCO]

# ITENS CONCLUÍDOS NESTE TURNO
- [ID_DO_ITEM]: [Explicação de por que foi concluído pelo pretendente no histórico ou na última mensagem]
(Ou NENHUM se nenhum item novo foi concluído)

# OBJETIVOS DESTE TURNO
- [ID_DO_ITEM]: [Pergunta ou tema a ser abordado nesta rodada]
(Ou NENHUM se a ação for de áudio, foto ou pausa)

# ITENS DE MÍDIA
- [ID_DO_AUDIO_OU_FOTO_DO_COFRE]
(Ou NENHUM se for resposta textual ou pausa)

# ESPECIFICAÇÃO PARA O SOL
- O que responder: [Instrução direta validando o que o pretendente falou]
- O que perguntar: [Perguntas do checklist a fazer, inspirando-se no conteúdo cadastrado no cofre]
- Balões recomendados: [1 a 3]
- Restrições: [Regras de ouro: não falar biografia em texto se houver áudios pendentes, tom meigo mineiro, sem ponto final]
(Se a ação for ENVIAR_AUDIO, coloque: NÃO SE APLICA)

# MOTIVO ESTRATÉGICO
[1 a 3 frases explicando o raciocínio analítico para o operador]`;

    try {
      let content = "";
      let providerUsed = "";

      // 1. Tenta prioritariamente OpenAI com GPT-4o-mini (orquestrador econômico e veloz em português)
      if (openAiKey) {
        try {
          console.log(`[TRACE-AUTOPILOT] Atria:call provider=OpenAI model=gpt-4o-mini`);
          const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openAiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPromptContent },
                { role: "user", content: userPromptContent },
              ],
              temperature: 0.2,
              max_tokens: 1800,
              stream: true,
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (oaiRes.ok) {
            const streamResult = await readStreamOrText(oaiRes, onStreamChunk);
            content = streamResult.text.trim();
            if (content) providerUsed = "gpt-4o-mini (OpenAI)";
          } else {
            console.warn(`[TRACE-AUTOPILOT] OpenAI GPT-4o-Mini HTTP ${oaiRes.status}: ${await oaiRes.text()}`);
          }
        } catch (oaiErr) {
          console.warn(`[TRACE-AUTOPILOT] OpenAI GPT-4o-Mini error:`, oaiErr);
        }
      }

      // 2. Fallback para TokenHarbor com DeepSeek V4.1 Flash
      if (!content && tokenHarborKey) {
        try {
          console.log(`[TRACE-AUTOPILOT] Atria:call fallback provider=TokenHarbor model=deepseek-v4.1-flash:free`);
          const thRes = await fetch("https://tokenharbor.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenHarborKey}`,
              "Content-Type": "application/json",
              "User-Agent": "Vendeo-Ai-Edge/1.0",
            },
            body: JSON.stringify({
              model: "deepseek-v4.1-flash:free",
              messages: [
                { role: "system", content: systemPromptContent },
                { role: "user", content: userPromptContent },
              ],
              temperature: 0.15,
              max_tokens: 1500,
              stream: true,
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (thRes.ok) {
            const streamResult = await readStreamOrText(thRes, onStreamChunk);
            content = streamResult.text.trim();
            if (content) providerUsed = "deepseek-v4.1-flash:free (TokenHarbor)";
          } else {
            console.warn(`[TRACE-AUTOPILOT] TokenHarbor HTTP ${thRes.status}: ${await thRes.text()}`);
          }
        } catch (thErr) {
          console.warn(`[TRACE-AUTOPILOT] TokenHarbor error:`, thErr);
        }
      }

      // 3. Fallback para Atria-ASI caso TokenHarbor falhe ou não tenha chave
      if (!content && atriaKey) {
        try {
          console.log(`[TRACE-AUTOPILOT] Atria:call fallback provider=Atria-ASI model=Atria-Dawn-Preview`);
          const atriaRes = await fetch("https://api.atria-asi.ai/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${atriaKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "Atria-Dawn-Preview",
              messages: [
                { role: "system", content: systemPromptContent },
                { role: "user", content: userPromptContent },
              ],
              temperature: 0.2,
              max_tokens: 1500,
              stream: true,
            }),
            signal: AbortSignal.timeout(35000),
          });
          if (atriaRes.ok) {
            const streamResult = await readStreamOrText(atriaRes, onStreamChunk);
            content = streamResult.text.trim();
            if (content) providerUsed = "Atria-Dawn-Preview (Atria-ASI)";
          } else {
            console.warn(`[TRACE-AUTOPILOT] Atria-ASI HTTP ${atriaRes.status}: ${await atriaRes.text()}`);
          }
        } catch (atriaErr) {
          console.warn(`[TRACE-AUTOPILOT] Atria-ASI error:`, atriaErr);
        }
      }

      if (!content) {
        console.warn(`[TRACE-AUTOPILOT] Orquestrador sem resposta; ativando fallback determinístico.`);
        return naturalFallback("Orquestrador temporariamente indisponível; Sol seguirá alinhado ao cronograma.");
      }

      console.log(`[TRACE-AUTOPILOT] Atria:response_received provider=${providerUsed} length=${content.length}`);

      // Sanitiza tags <think> e fatiamento direto no cabeçalho # AÇÃO se houver preâmbulo vazado
      content = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      const actionHeaderIdx = content.search(/#+\s*(?:AÇÃO|ACAO|ACTION)/i);
      if (actionHeaderIdx > 0) {
        content = content.slice(actionHeaderIdx).trim();
      }

      // Detecção de formato Markdown da Atria Spec (.md)
      const isMarkdownSpec =
        /#+\s*(?:AÇÃO|ACAO|ACTION|OBJETIVOS|ITENS|MOTIVO)/i.test(content) ||
        content.startsWith("# ");

      if (isMarkdownSpec) {
        const spec = parseAtriaSpecMarkdown(content, context.checklist);
        console.log(`[TRACE-AUTOPILOT] Atria:markdown_spec action=${spec.action} goals=${spec.turnGoalIds.length} media=${spec.resolvedMediaItems.length}`);

        if (spec.action === "PAUSAR_HUMANO" || spec.action === "PAUSAR_RISCO") {
          return {
            ...pause(spec.pauseReason || spec.reason),
            action: spec.action === "PAUSAR_RISCO" ? "pause_guardrail" : "pause_handoff",
            decisionReason: spec.reason,
            reconciledCompletedIds: spec.completedItemIds,
          };
        }

        if (spec.action === "ENVIAR_AUDIO" || spec.action === "ENVIAR_FOTO") {
          const batch = spec.resolvedMediaItems;
          const nextItem = batch[0] || null;
          const shouldPauseAfterSend = shouldPauseAfterPersonalAudioBatch(
            context.checklist,
            batch,
          );
          return {
            action: "send_checklist_batch",
            isRaffleReady: false,
            nextItem,
            checklistBatch: batch,
            targetChecklistIds: batch.map((item) => item.id),
            directiveForPersona: spec.solDirective || spec.reason || "",
            shouldPauseAfterSend,
            pauseReason: shouldPauseAfterSend
              ? "Serviço da IA concluído: os áudios sobre a Larissa foram enviados com sucesso. Assuma a conversa manualmente."
              : undefined,
            decisionReason: spec.reason,
            reconciledCompletedIds: spec.completedItemIds,
            directMode: true,
          };
        }

        // CHAMAR_SOL com resgate determinístico de checklist para nunca deixar metas zeradas
        const nextPendingText = context.checklist.find((item: any) => !item.isCompleted && item.type === "text");
        const resolvedGoalIds = spec.turnGoalIds.length > 0
          ? spec.turnGoalIds
          : (nextPendingText ? [nextPendingText.id] : []);
        const resolvedNextItem = resolvedGoalIds.length > 0
          ? context.checklist.find((item: any) => item.id === resolvedGoalIds[0]) || null
          : null;

        let enrichedDirective = spec.solDirective
          ? (spec.solDirective.startsWith("#") ? spec.solDirective : `# ESPECIFICAÇÃO PARA O SOL\n${spec.solDirective}`)
          : spec.reason;

        if (resolvedNextItem?.content && !enrichedDirective.includes(resolvedNextItem.content)) {
          enrichedDirective += `\n\n- O que perguntar do checklist: Conduza com carinho a pergunta deste item: "${resolvedNextItem.content}".`;
        }

        const hasMedia = spec.resolvedMediaItems && spec.resolvedMediaItems.length > 0;
        return {
          action: hasMedia ? "send_checklist_batch" : "call_persona",
          isRaffleReady: false,
          nextItem: resolvedNextItem,
          checklistBatch: hasMedia ? spec.resolvedMediaItems : undefined,
          targetChecklistIds: [
            ...resolvedGoalIds,
            ...(hasMedia ? spec.resolvedMediaItems.map((item: any) => item.id) : []),
          ],
          directiveForPersona: enrichedDirective,
          decisionReason: spec.reason,
          reconciledCompletedIds: spec.completedItemIds,
        };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = parseAtriaJson(content);
      } catch {
        console.warn("[TRACE-AUTOPILOT] Atria:parse_unexpected_error fallback=call_persona");
        return naturalFallback("Atria analisou o contexto; Sol seguirá com uma resposta natural.");
      }
      const normalizedAction = normalizeAtriaAction(parsed.action);
      const supportedActions = new Set([
        "call_persona",
        "send_approved_media",
        "pause_handoff",
        "pause_guardrail",
        "send_checklist_batch",
      ]);
      if (supportedActions.has(normalizedAction)) {
        parsed.action = normalizedAction;
      } else {
        console.warn(
          `[TRACE-AUTOPILOT] Atria:unsupported_action value=${String(parsed.action || "vazia").slice(0, 120)} fallback=call_persona`,
        );
        parsed.action = "call_persona";
        if (!parsed.reason || typeof parsed.reason !== "string" || !parsed.reason.trim()) {
          parsed.reason = "Atria sugeriu prosseguir a conversa de forma autêntica e natural.";
        }
      }
      console.log(`[TRACE-AUTOPILOT] Atria:decision action=${String(parsed.action || "unknown")}`);
      const policy = validateAtriaTurnDecision(
        parsed,
        context.checklist,
        context.latestContactText || "",
      );
      if (policy.action === "pause_handoff" || policy.action === "pause_guardrail") {
        return {
          ...pause(policy.pauseReason || policy.reason),
          action: policy.action,
          decisionReason: policy.reason,
        };
      }
      if (policy.action === "call_persona") {
        return {
          action: "call_persona",
          isRaffleReady: false,
          nextItem: policy.checklistGoalIds.length
            ? context.checklist.find((item) => item.id === policy.checklistGoalIds[0]) || null
            : null,
          targetChecklistIds: policy.checklistGoalIds,
          directiveForPersona: policy.reason,
          decisionReason: policy.reason,
        };
      }
      const batch = policy.mediaItems;
      const nextItem = batch[0] || null;
      const shouldPauseAfterSend = shouldPauseAfterPersonalAudioBatch(
        context.checklist,
        batch,
      );
      return {
        action: "send_checklist_batch",
        isRaffleReady: false,
        nextItem,
        checklistBatch: batch,
        targetChecklistIds: batch.map((item) => item.id),
        directiveForPersona: "",
        shouldPauseAfterSend,
        pauseReason: shouldPauseAfterSend
          ? "Serviço da IA concluído: os áudios sobre a Larissa foram enviados com sucesso. Assuma a conversa manualmente."
          : undefined,
        decisionReason: policy.reason,
      };
    } catch (atriaErr: unknown) {
      console.warn("[TRACE-AUTOPILOT] Atria:exception fallback=call_persona", atriaErr);
      return naturalFallback("Atria indisponível ou tempo limite atingido; Sol responderá diretamente.");
    }
  }

  function decideConversationStep(
    stageChecklist: any[],
    nextItem: any | null,
  ): OrchestratorDirective {
    const personalAudios = stageChecklist.filter(
      (it: any) => it.type === "audio" && isLarissaPersonalAudio(it),
    );
    if (
      personalAudios.length > 0 &&
      personalAudios.every((it: any) => it.isCompleted)
    ) {
      return {
        action: "pause_handoff",
        isRaffleReady: true,
        nextItem: null,
        directiveForPersona:
          "Momento dos áudios sobre a Larissa concluído. Parada estratégica no Silêncio de Fechamento.",
        pauseReason:
          "Serviço da IA concluído: os áudios sobre a Larissa foram enviados com sucesso. Assuma a conversa manualmente.",
        decisionReason: "Áudios pessoais já concluídos nesta etapa.",
      };
    }

    const checklistBatch = buildChecklistBatch(stageChecklist, nextItem);
    const checklistBatchResponses = checklistBatchToResponses(checklistBatch);
    const shouldSendChecklistBatch =
      nextItem?.type === "audio" &&
      checklistBatch.length > 0 &&
      checklistBatchResponses.length === checklistBatch.length;

    const audioTags: string[] = shouldSendChecklistBatch
      ? checklistBatch
          .filter((item: any) => item.type === "audio" && item.mediaUrl)
          .map((item: any) => item.mediaUrl)
      : nextItem?.type === "audio" && nextItem.mediaUrl
        ? [nextItem.mediaUrl]
        : [];

    if (shouldSendChecklistBatch) {
      const shouldPauseAfterSend = shouldPauseAfterPersonalAudioBatch(
        stageChecklist,
        checklistBatch,
      );
      return {
        action: "send_checklist_batch",
        isRaffleReady: false,
        nextItem,
        checklistBatch,
        targetChecklistId: nextItem?.id,
        targetChecklistIds: checklistBatch.map((item: any) => item.id),
        directiveForPersona:
          "PROTOCOLO OPERACIONAL: envie os itens exatos deste bloco do checklist na mesma rodada, sem improvisar texto.",
        mustIncludeAudioTag: audioTags[0],
        mustIncludeAudioTags: audioTags,
        shouldPauseAfterSend,
        pauseReason: shouldPauseAfterSend
          ? "Serviço da IA concluído: os 2 áudios sobre a Larissa foram enviados. Assuma a conversa manualmente."
          : undefined,
        decisionReason: shouldPauseAfterSend
          ? "Bloco obrigatório de áudios pessoais concluído; handoff imediato."
          : "Bloco obrigatório do checklist com conteúdo aprovado.",
      };
    }

    return {
      action: "call_persona",
      isRaffleReady: false,
      nextItem,
      targetChecklistId: nextItem?.id,
      targetChecklistIds: nextItem?.id ? [nextItem.id] : [],
      mustIncludeAudioTag: audioTags[0],
      mustIncludeAudioTags: audioTags,
      directiveForPersona: nextItem?.content
        ? `OBJETIVO DO TURNO: conduza naturalmente para "${nextItem.title}" (${nextItem.content}). Reaja de forma autêntica à fala dele, sem papagaiar, e puxe o gancho deste objetivo quando soar natural.`
        : "Continue a conversa de forma meiga e autêntica mantendo a conexão humana.",
      decisionReason: nextItem
        ? "Item pendente do checklist conduzido pela persona com conteúdo aprovado."
        : "Não há item pendente; manter conversa natural.",
    };
  }

  return {
    pauseCloudAutoPilotForHandoff,
    orchestrateConversationStep,
    generatePersonaResponse,
    generateAtriaFallbackResponse,
    generateGroqFallbackResponse,
    checklistBatchToResponses,
    decideConversationStep,
    atriaControlStep,
  };
}
