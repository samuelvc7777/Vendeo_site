// Motor autônomo do Instagram: executa o ciclo completo sem depender da tela aberta.
import { GenerateAiPromptUseCase } from "./instagram_ai.ts";
import { recordAutoPilotTrace } from "./autopilot_trace.ts";
import { extractSearchCandidates, searchContextInfo } from "./web_search.ts";

const CHAT_PROGRESS_ROW_ID = "__chat_progress__";

/**
 * Consulta mensagens recentes do pretendente para detectar concorrência em tempo real.
 * Se o pretendente enviou nova mensagem enquanto a IA pensava ou digitava, retorna os dados.
 */
async function checkForNewerThemMessage(
  supabase: any,
  conversationId: string,
  currentTriggerId: string,
  currentTriggerTimestamp: string,
): Promise<{ id: string; text: string; timestamp: string } | null> {
  try {
    const { data: latestMsgs } = await supabase
      .from("instagram_messages")
      .select("id, text, timestamp, is_mine, sender_id")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(5);

    if (!latestMsgs || latestMsgs.length === 0) return null;
    const currentMs = new Date(currentTriggerTimestamp).getTime();

    for (const msg of latestMsgs) {
      if (msg.is_mine || msg.sender_id === "me") continue;
      const msgMs = new Date(msg.timestamp).getTime();
      // Mensagem do pretendente com ID diferente e timestamp posterior
      if (msg.id !== currentTriggerId && msgMs > currentMs) {
        return {
          id: msg.id,
          text: msg.text || "",
          timestamp: msg.timestamp,
        };
      }
    }
  } catch (err) {
    console.warn("[Cloud AutoPilot] Falha ao verificar mensagens concorrentes:", err);
  }
  return null;
}

/**
 * A tabela de conversas possui campos obrigatórios além do JSON de progresso.
 * Sempre envie a identidade da linha-sistema para que o upsert também seja
 * seguro quando a linha ainda não existir no banco de destino.
 */
async function persistChatProgress(supabase: any, progresses: Record<string, any>) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("instagram_conversations").upsert({
    id: CHAT_PROGRESS_ROW_ID,
    username: "system_progress",
    full_name: "Progresso das Conversas",
    status: "system",
    last_direction: "in",
    stage_completed_rules: {
      progresses,
      updated_at: now,
    },
    updated_at: now,
  });
  if (error) throw error;
}

export interface CloudAutoPilotRuntime {
  apiBase: string;
  transcribeAudio: (mediaUrl: string) => Promise<string | null>;
  pauseCloudAutoPilotForHandoff: (
    supabase: any,
    conversationId: string,
    states: Record<string, any>,
    chatState: any,
    pauseReason: string,
    status?: "paused_handoff" | "paused_guardrail",
  ) => Promise<void>;
  orchestrateConversationStep: (
    supabase: any,
    stageChecklist: any[],
    formattedHistory: any[],
    pretendenteName: string,
    currentStageName: string,
  ) => Promise<any>;
  generatePersonaResponse: (
    supabase: any,
    promptText: string,
    allowedChecklistIds?: string[],
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ) => Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }>;
  generateAtriaFallbackResponse: (
    supabase: any,
    promptText: string,
    onStreamChunk?: (chunk: string, accumulated: string) => Promise<void> | void,
  ) => Promise<{
    responses: string[];
    modelUsed: string;
    completedItemIds: string[];
    analisePretendente?: string;
  }>;
  checklistBatchToResponses: (batch: any[]) => string[];
  /**
   * Controlador determinístico do site (sem LLM).
   * Código puro decide a estrutura do turno; a IA só redige o texto.
   */
  decideConversationStep: (
    stageChecklist: any[],
    nextItem: any | null,
  ) => any;
  /** Atria escolhe a ação com o contexto integral; código valida os itens. */
  atriaControlStep: (
    base: any,
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
  ) => Promise<any>;
}

export interface RunCloudAutoPilotInput {
  supabase: any;
  conversationId: string;
  triggerMessageId: string;
  triggerTimestamp: string;
  triggerText: string;
  runtime: CloudAutoPilotRuntime;
  skipDebounce?: boolean;
}

export function extractStreamingSolThought(raw: string): string {
  if (!raw) return "";
  const analiseMatch = raw.match(/"analise_do_pretendente"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"responses|"|\n|$)/i);
  if (analiseMatch && analiseMatch[1]) {
    return analiseMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  }
  return raw.replace(/^[{\s]*"?analise_do_pretendente"?\s*:\s*"?/i, "").slice(0, 400).trim();
}

export function createThrottledBroadcaster(
  supabase: any,
  conversationId: string,
  phase: "atria" | "sol",
  minIntervalMs: number = 250,
) {
  let lastBroadcastTime = 0;
  let latestPayload: any = null;
  let timer: any = null;

  const flush = async () => {
    if (!latestPayload) return;
    const toSend = latestPayload;
    latestPayload = null;
    lastBroadcastTime = Date.now();
    try {
      const channel = supabase.channel("vendeo_realtime_chat");
      await channel.send({
        type: "broadcast",
        event: "autopilot_state_update",
        payload: toSend,
      });
    } catch (e) {
      console.warn("[Cloud AutoPilot] Erro no broadcast de streaming:", e);
    }
  };

  return {
    broadcast: async (activityData: Record<string, any>) => {
      const now = Date.now();
      const stateUpdatedAt = new Date().toISOString();
      latestPayload = {
        conversationId,
        status: "processing",
        activity: {
          phase,
          updatedAt: stateUpdatedAt,
          ...activityData,
        },
        stateUpdatedAt,
        timestamp: stateUpdatedAt,
      };

      if (now - lastBroadcastTime >= minIntervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          void flush();
        }, minIntervalMs - (now - lastBroadcastTime));
      }
    },
    flush,
  };
}

export async function publishAutoPilotState(
  supabase: any,
  conversationId: string,
  patch: Record<string, any>,
) {
  try {
    const { data: row } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle();
    const states = row?.stage_completed_rules?.states || {};
    const current = states[conversationId] || {
      conversationId,
      isEnabled: true,
      status: "idle",
    };
    const stateUpdatedAt = new Date().toISOString();
    const updated = {
      ...current,
      isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : true,
      ...patch,
      conversationId,
      stateUpdatedAt,
    };
    states[conversationId] = updated;

    await supabase.from("instagram_conversations").upsert({
      id: "__autopilot_states__",
      username: "system_autopilot_states",
      stage_completed_rules: { states, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });

    const realtimeChannel = supabase.channel("vendeo_realtime_chat");
    await realtimeChannel.send({
      type: "broadcast",
      event: "autopilot_state_update",
      payload: { ...updated, timestamp: stateUpdatedAt },
    });
  } catch (error) {
    // O indicador é observabilidade: uma falha visual nunca deve interromper o atendimento.
    console.warn("[Cloud AutoPilot] Falha ao publicar estado visual:", error);
  }
}

export function activity(
  phase: string,
  label: string,
  detail: string,
  extra: Record<string, any> = {},
) {
  return { phase, label, detail, updatedAt: new Date().toISOString(), ...extra };
}

function parseCycleTimestamp(token?: string | null): number {
  if (!token) return 0;
  const match = String(token).match(/^cycle_(\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

function isOtherCycleNewer(otherToken: string | null | undefined, myToken: string): boolean {
  if (!otherToken || otherToken === myToken) return false;
  const otherTime = parseCycleTimestamp(otherToken);
  const myTime = parseCycleTimestamp(myToken);

  // Se o outro token tem timestamp e é MAIS ANTIGO que o meu ciclo atual,
  // ele é apenas um resquício obsoleto no banco e NÃO deve abortar o meu ciclo.
  if (otherTime > 0 && myTime > 0 && otherTime < myTime) {
    return false;
  }

  // Se o outro token tem timestamp e já tem mais de 3 minutos, expirou
  if (otherTime > 0 && (Date.now() - otherTime) > 180000) {
    return false;
  }

  return true;
}

export async function runCloudAutoPilot({
  supabase,
  conversationId,
  triggerMessageId,
  triggerTimestamp,
  triggerText,
  runtime,
  skipDebounce = false,
}: RunCloudAutoPilotInput) {
  const {
    apiBase: API_BASE,
    pauseCloudAutoPilotForHandoff,
    orchestrateConversationStep,
    generatePersonaResponse,
    checklistBatchToResponses,
    decideConversationStep,
    atriaControlStep,
    transcribeAudio,
  } = runtime;
  const functionStartTime = Date.now();
  try {
    console.log(`[TRACE-AUTOPILOT] cycle:start conversation=${conversationId} trigger=${triggerMessageId}`);
    await recordAutoPilotTrace(supabase, "cycle:start", conversationId, `trigger=${triggerMessageId}`);
    console.log(
      `[Cloud AutoPilot] Iniciando ciclo em nuvem para conversa ${conversationId}...`,
    );

    // 1. Busca configurações gerais do Piloto Automático
    const { data: cfgRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_config__")
      .maybeSingle();

    const config = cfgRow?.stage_completed_rules?.config;
    if (config && config.isEnabledGlobally === false) {
      await recordAutoPilotTrace(supabase, "cycle:global_disabled", conversationId);
      console.log(
        "[Cloud AutoPilot] Piloto Automático desativado globalmente.",
      );
      return;
    }

    // 2. Busca estados individuais dos chats
    const { data: statesRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle();

    const states = statesRow?.stage_completed_rules?.states || {};
    const chatState = states[conversationId];

    if (!chatState || !chatState.isEnabled) {
      await recordAutoPilotTrace(supabase, "cycle:chat_disabled", conversationId);
      console.log(
        `[Cloud AutoPilot] Chat ${conversationId} não possui Piloto ativado.`,
      );
      return;
    }

    // Se o chat tinha um lock de envio zumbi ou atividade zumbi de um ciclo anterior, limpa para destrancar
    const sendingStartedMs = chatState.sendingStartedAt ? Date.parse(chatState.sendingStartedAt) : 0;
    if (chatState.isSending && (sendingStartedMs === 0 || Date.now() - sendingStartedMs > 25000)) {
      console.log(`[Cloud AutoPilot] Destrancando lock de envio zumbi para ${conversationId}`);
      chatState.isSending = false;
      chatState.sendingStartedAt = null;
      chatState.sendingCycleToken = null;
    }

    if (chatState.activity && chatState.activity.phase !== "completed") {
      const lastUpdateStr = chatState.activity.updatedAt || chatState.stateUpdatedAt;
      const lastUpdateMs = lastUpdateStr ? Date.parse(lastUpdateStr) : 0;
      if (lastUpdateMs > 0 && Date.now() - lastUpdateMs > 45000) {
        console.log(`[Cloud AutoPilot] Limpando atividade zumbi (${chatState.activity.phase}) para ${conversationId}`);
        chatState.activity = null;
        if (chatState.status === "processing" || chatState.status === "waiting_delay") {
          chatState.status = "idle";
        }
      }
    }

    if (
      chatState.status === "paused_handoff" ||
      chatState.status === "paused_guardrail"
    ) {
      console.log(
        `[Cloud AutoPilot] Chat ${conversationId} pausado: ${chatState.pauseReason}`,
      );
      return;
    }

    // 3. Guardrail: Pausa por foto recebida
    const isImage =
      triggerText.startsWith("[image:") || triggerText.includes("📷");
    if (config?.pauseOnPhotoReceived !== false && isImage) {
      console.log(
        `[Cloud AutoPilot] Foto recebida em ${conversationId}. Pausando por guardrail.`,
      );
      chatState.status = "paused_guardrail";
      chatState.pauseReason =
        "Foto recebida do pretendente. Avalie manualmente.";
      chatState.pausedAt = new Date().toISOString();
      states[conversationId] = chatState;
      await supabase.from("instagram_conversations").upsert({
        id: "__autopilot_states__",
        username: "system_autopilot_states",
        stage_completed_rules: { states, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // 3.5. Trava Canônica do Instagram: Se a última mensagem da conversa for nossa (Larissa/Vendeo),
    // a IA NÃO DEVE CONTINUAR nem falar sozinha. Deve aguardar a resposta ou interação do pretendente.
    const { data: initialCheckMsgs } = await supabase
      .from("instagram_messages")
      .select("id, text, timestamp, is_mine, sender_id")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(1);

    if (initialCheckMsgs && initialCheckMsgs.length > 0) {
      const topMsg = initialCheckMsgs[0];
      if (topMsg.is_mine || topMsg.sender_id === "me") {
        console.log(
          `[Cloud AutoPilot] A última mensagem da conversa ${conversationId} foi enviada por nós. Abortando ciclo para não falar sozinha (regra canônica do Instagram).`,
        );
        await publishAutoPilotState(supabase, conversationId, {
          status: "idle",
          scheduledResponseAt: null,
          activity: null,
        });
        return;
      }
    }

    let currentTriggerId = triggerMessageId;
    let currentTriggerTimestamp = triggerTimestamp;
    let currentTriggerText = triggerText;

    // 4. Tempo de espera / Debounce fiel às configurações do usuário
    // Converte minutos configurados para segundos reais (ex: 1 min -> 60s, 2 min -> 120s).
    // Na nuvem (Edge Runtime), impõe teto de segurança de 120s para proteger contra timeout do servidor serverless.
    const delayMinutes =
      typeof config?.responseDelayMinutes === "number"
        ? config.responseDelayMinutes
        : 1;
    const targetWaitSeconds = Math.round(delayMinutes * 60);
    const waitSeconds = Math.min(Math.max(targetWaitSeconds, 15), 120);

    // Lock atômico de concorrência: registra um token único para este ciclo.
    // Qualquer ciclo anterior é automaticamente invalidado.
    const cycleToken = `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    chatState.activeCycleToken = cycleToken;
    states[conversationId] = chatState;
    await supabase.from("instagram_conversations").upsert({
      id: "__autopilot_states__",
      username: "system_autopilot_states",
      stage_completed_rules: { states, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });

    // Registra o token também na linha individual da própria conversa para isolamento absoluto contra sobrescrita de estado
    try {
      const { data: convRow } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", conversationId)
        .maybeSingle();
      const rawRules = (convRow?.stage_completed_rules && typeof convRow.stage_completed_rules === "object")
        ? convRow.stage_completed_rules
        : {};
      const currentRules = { ...rawRules };
      delete currentRules.cancel_current_cycle;
      if (currentRules.status === "paused_manual") {
        delete currentRules.status;
      }
      await supabase
        .from("instagram_conversations")
        .update({
          stage_completed_rules: {
            ...currentRules,
            active_cycle_token: cycleToken,
            active_cycle_at: new Date().toISOString(),
          },
        })
        .eq("id", conversationId);
    } catch (_cErr) {}

    if (skipDebounce) {
      console.log(
        `[Cloud AutoPilot] Disparo imediato (skipDebounce=true) para ${conversationId}. Iniciando análise agora!`,
      );
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activeCycleToken: cycleToken,
        activity: activity(
          "atria",
          "IA analisando conversa...",
          "Lendo histórico e planejando a melhor resposta.",
        ),
      });
    } else {
      const waitDisplay = waitSeconds >= 60
        ? `${Math.round(waitSeconds / 60)} min (${waitSeconds}s)`
        : `${waitSeconds}s`;

      console.log(
        `[Cloud AutoPilot] Aguardando debounce de ${waitDisplay} para ${conversationId}...`,
      );
      await publishAutoPilotState(supabase, conversationId, {
        status: "waiting_delay",
        activeCycleToken: cycleToken,
        scheduledResponseAt: new Date(Date.now() + waitSeconds * 1000).toISOString(),
        activity: activity(
          "waiting",
          "IA aguardando tempo pra agir",
          `Aguardando ${waitDisplay} para o cliente terminar de escrever.`,
          { countdownSeconds: waitSeconds },
        ),
      });
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    }

    // 5. Verificação pós-debounce de concorrência: se outra mensagem chegou durante o debounce,
    // um ciclo mais novo assumiu o activeCycleToken. Este ciclo morre aqui para não responder em dobro.
    const { data: convAfterDebounce } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();
    const tokenOnConv = convAfterDebounce?.stage_completed_rules?.active_cycle_token;
    if (tokenOnConv && tokenOnConv !== cycleToken && isOtherCycleNewer(tokenOnConv, cycleToken)) {
      console.log(
        `[Cloud AutoPilot] Ciclo ${cycleToken} descartado para ${conversationId}. Ciclo mais recente ativo na conversa: ${tokenOnConv}. Abortando para evitar resposta duplicada.`,
      );
      await publishAutoPilotState(supabase, conversationId, {
        status: "idle",
        activity: null,
      });
      await recordAutoPilotTrace(
        supabase,
        "cycle:stale_aborted",
        conversationId,
        `stale=${cycleToken};active=${tokenOnConv}`,
      );
      return;
    }

    const { data: statesAfterDebounce } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle();
    const liveStates = statesAfterDebounce?.stage_completed_rules?.states || {};
    const liveChatState = liveStates[conversationId];

    if (liveChatState?.activeCycleToken && liveChatState.activeCycleToken !== cycleToken && isOtherCycleNewer(liveChatState.activeCycleToken, cycleToken)) {
      console.log(
        `[Cloud AutoPilot] Ciclo ${cycleToken} descartado para ${conversationId}. Ciclo mais recente ativo: ${liveChatState.activeCycleToken}. Abortando para evitar resposta duplicada.`,
      );
      await publishAutoPilotState(supabase, conversationId, {
        status: "idle",
        activity: null,
      });
      await recordAutoPilotTrace(
        supabase,
        "cycle:stale_aborted",
        conversationId,
        `stale=${cycleToken};active=${liveChatState.activeCycleToken}`,
      );
      return;
    }

    // 5.1. Verificação pós-debounce: Se o humano ou o frontend já responderam no intervalo
    const { data: latestMsgs } = await supabase
      .from("instagram_messages")
      .select("id, text, timestamp, is_mine, sender_id")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(3);

    if (latestMsgs && latestMsgs.length > 0) {
      const newest = latestMsgs[0];
      if (newest.is_mine || newest.sender_id === "me") {
        console.log(
          `[Cloud AutoPilot] Mensagem já respondida para ${conversationId}. Abortando ciclo.`,
        );
        await publishAutoPilotState(supabase, conversationId, {
          status: "idle",
          scheduledResponseAt: null,
          activity: null,
        });
        return;
      }
      if (
        newest.id !== currentTriggerId &&
        new Date(newest.timestamp).getTime() > new Date(currentTriggerTimestamp).getTime()
      ) {
        console.log(
          `[Cloud AutoPilot] Cliente enviou mensagem mais recente (${newest.id}) durante o debounce. Atualizando gatilho para não perder nada.`,
        );
        currentTriggerId = newest.id;
        currentTriggerTimestamp = newest.timestamp;
        currentTriggerText = newest.text || currentTriggerText;
      }
    }

    await publishAutoPilotState(supabase, conversationId, {
      status: "processing",
      scheduledResponseAt: null,
      activity: activity(
        "context",
        "Preparando contexto",
        "Lendo o histórico e conferindo a etapa atual do checklist.",
      ),
    });

    // 6. Carrega progresso, etapas e itens do cofre
    const { data: progRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__chat_progress__")
      .maybeSingle();

    const progresses = progRow?.stage_completed_rules?.progresses || {};
    const chatProg = progresses[conversationId] || {
      currentStageId: "stage_1",
      completedItemIds: [],
      isConverted: false,
    };

    const { data: vaultRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__vault_data__")
      .maybeSingle();

    const vaultFolders = vaultRow?.stage_completed_rules?.folders || [];
    const vaultItems = vaultRow?.stage_completed_rules?.items || [];

    const { data: stagesRow, error: stagesError } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__chat_stages__")
      .maybeSingle();
    if (stagesError) throw stagesError;

    const sortedFolders = [...vaultFolders].sort((a: any, b: any) =>
      (a.name || "").localeCompare(b.name || ""),
    );
    const configuredStages = [
      ...(stagesRow?.stage_completed_rules?.stages || []),
    ].sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));
    const stageSequence = configuredStages.length > 0
      ? configuredStages
      : sortedFolders.map((folder: any, index: number) => ({
          id: `legacy-stage-${index + 1}`,
          name: folder.name,
          order: index + 1,
          folderId: folder.id,
        }));
    // Carrega histórico antecipadamente para reconciliação inteligente de mídia e progresso
    const { data: historyRows, error: historyError } = await supabase
      .from("instagram_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(500);
    if (historyError) throw historyError;

    // Reconciliação inteligente de áudios nossos já enviados na conversa
    const completedSet = new Set(chatProg.completedItemIds || []);
    let autoReconciledProgress = false;

    const ourAudioMessages = (historyRows || []).filter((m: any) =>
      (m.is_from_me || m.sender_id === "me" || m.sender === "me" || m.is_mine) &&
      (Boolean(m.media_type === "audio") || (typeof m.text === "string" && m.text.includes("[audio:")))
    );
    const ourAudioCount = ourAudioMessages.length;

    // Itens de áudio pessoal da Larissa no cofre
    const personalAudio1Item = vaultItems.find((it: any) =>
      it.type === "audio" && (
        it.title?.toLowerCase().includes("mim 01") ||
        it.title?.toLowerCase().includes("sobre mim 1") ||
        it.title?.toLowerCase().includes("larissa 01") ||
        it.title?.toLowerCase().includes("audio 01")
      )
    );
    const personalAudio2Item = vaultItems.find((it: any) =>
      it.type === "audio" && (
        it.title?.toLowerCase().includes("mim 02") ||
        it.title?.toLowerCase().includes("sobre mim 2") ||
        it.title?.toLowerCase().includes("larissa 02") ||
        it.title?.toLowerCase().includes("audio 02")
      )
    );

    if (ourAudioCount >= 1 && personalAudio1Item && !completedSet.has(personalAudio1Item.id)) {
      completedSet.add(personalAudio1Item.id);
      autoReconciledProgress = true;
    }
    if (ourAudioCount >= 2 && personalAudio2Item && !completedSet.has(personalAudio2Item.id)) {
      completedSet.add(personalAudio2Item.id);
      autoReconciledProgress = true;
    }

    // Se os áudios já foram enviados e pertencem a uma etapa posterior (ex: Etapa 02), promove a etapa automaticamente
    if (ourAudioCount >= 1 && personalAudio1Item) {
      const audioStage = stageSequence.find((s: any) => s.folderId === personalAudio1Item.folderId);
      if (audioStage) {
        const audioStageIdx = stageSequence.indexOf(audioStage);
        const curIdx = stageSequence.findIndex(
          (s: any) => s.id === chatProg.currentStageId || s.folderId === chatProg.currentStageId,
        );
        if (curIdx < audioStageIdx) {
          console.log(`[Cloud AutoPilot] Reconciliação: promovendo ${conversationId} para etapa ${audioStage.name} pois áudios já foram enviados.`);
          chatProg.currentStageId = audioStage.id;
          for (let si = 0; si < audioStageIdx; si++) {
            const prevStage = stageSequence[si];
            const prevItems = vaultItems.filter((it: any) => it.folderId === prevStage.folderId);
            for (const pi of prevItems) completedSet.add(pi.id);
          }
          autoReconciledProgress = true;
        }
      }
    }

    let currentStageIndex = stageSequence.findIndex(
      (stage: any) => stage.id === chatProg.currentStageId,
    );
    // Migração transparente de progressos antigos que salvaram folderId no campo stageId.
    if (currentStageIndex < 0) {
      currentStageIndex = stageSequence.findIndex(
        (stage: any) => stage.folderId === chatProg.currentStageId,
      );
    }
    if (currentStageIndex < 0) currentStageIndex = 0;
    let currentStage = stageSequence[currentStageIndex];
    let currentFolder = sortedFolders.find(
      (folder: any) => folder.id === currentStage?.folderId,
    );
    if (!currentStage || !currentFolder) {
      throw new Error("Configuração de etapas inválida: etapa sem pasta do cofre.");
    }
    chatProg.currentStageId = currentStage.id;

    if (autoReconciledProgress) {
      chatProg.completedItemIds = Array.from(completedSet);
      progresses[conversationId] = chatProg;
      await persistChatProgress(supabase, progresses);
    }

    let stageChecklist = vaultItems
      .filter((it: any) => !currentFolder || it.folderId === currentFolder.id)
      .map((it: any) => ({
        id: it.id,
        type: it.type,
        title: it.title,
        content: it.content,
        mediaUrl: it.mediaUrl,
        duration: it.duration,
        linkedItemId: it.linkedItemId,
        isCompleted: completedSet.has(it.id),
      }));

    // Promoção preventiva: se a etapa atual já estiver 100% cumprida, avança imediatamente antes de acionar a Atria
    if (
      stageChecklist.length > 0 &&
      stageChecklist.every((it: any) => it.isCompleted) &&
      stageSequence.length > currentStageIndex + 1
    ) {
      currentStageIndex += 1;
      const nextStage = stageSequence[currentStageIndex];
      const nextFolder = sortedFolders.find(
        (folder: any) => folder.id === nextStage?.folderId,
      );
      if (nextStage && nextFolder) {
        console.log(
          `[Cloud AutoPilot] Etapa ${currentStage?.name || "atual"} 100% concluída. Promovendo preventivamente para ${nextStage.name} antes de consultar a Atria.`,
        );
        currentStage = nextStage;
        currentFolder = nextFolder;
        chatProg.currentStageId = nextStage.id;
        stageChecklist = vaultItems
          .filter((it: any) => !nextFolder || it.folderId === nextFolder.id)
          .map((it: any) => ({
            id: it.id,
            type: it.type,
            title: it.title,
            content: it.content,
            mediaUrl: it.mediaUrl,
            duration: it.duration,
            linkedItemId: it.linkedItemId,
            isCompleted: completedSet.has(it.id),
          }));
        chatProg.completedItemIds = Array.from(completedSet);
        chatProg.updatedAt = new Date().toISOString();
        progresses[conversationId] = chatProg;
        await persistChatProgress(supabase, progresses);
      }
    }

    // Verifica hand-off da rifa (se os 2 áudios pessoais já foram enviados e o handoff está ativado)
    const isPersonalAudio1Completed = personalAudio1Item ? completedSet.has(personalAudio1Item.id) : false;
    const isPersonalAudio2Completed = personalAudio2Item ? completedSet.has(personalAudio2Item.id) : false;
    const shouldHandoffAtRaffle = config?.handOffAtRaffleStep !== false;
    if (shouldHandoffAtRaffle && isPersonalAudio1Completed && isPersonalAudio2Completed) {
      // Se o operador já reativou este chat após o handoff da rifa, não volta a pausar compulsoriamente a cada mensagem
      const alreadyHandedOff = Boolean(chatProg?.raffleHandedOffAt || chatState?.raffleHandedOff);
      if (!alreadyHandedOff) {
        const lastMsg = historyRows?.[0];
        const themResponded = lastMsg && !lastMsg.is_from_me && lastMsg.sender_id !== "me" && !lastMsg.is_mine;
        if (themResponded) {
          console.log(
            `[Cloud AutoPilot] Ponto da Rifa atingido para ${conversationId}. Áudios enviados e pretendente respondeu. Pausando para handoff.`,
          );
          if (chatProg) {
            chatProg.raffleHandedOffAt = new Date().toISOString();
            progresses[conversationId] = chatProg;
            await persistChatProgress(supabase, progresses);
          }
          await pauseCloudAutoPilotForHandoff(
            supabase,
            conversationId,
            states,
            chatState,
            "Serviço da IA concluído: os 2 áudios sobre a Larissa já foram enviados e o pretendente respondeu. Assuma a conversa manualmente.",
            "paused_handoff",
          );
          return;
        }
      }
    }

    const { data: convData, error: conversationError } = await supabase
      .from("instagram_conversations")
      .select("username, full_name, contact_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) throw conversationError;

    const chronRows = historyRows ? [...historyRows].reverse() : [];
    // Cache de transcrições compartilhado com o modo de copiar prompt.
    // Limita a concorrência para não abrir centenas de requisições de áudio.
    const audioRows = chronRows.filter((row: any) =>
      !row.audio_transcript && !row.is_mine && row.sender_id !== "me" &&
      (row.media_type === "audio" || row.text?.startsWith("[audio:")),
    );
    let audioCursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, audioRows.length) }, async () => {
      while (audioCursor < audioRows.length) {
        const row = audioRows[audioCursor++];
        const url = row.media_url || row.text?.match(/\[audio:([^\]]+)\]/)?.[1];
        if (!url) continue;
        const transcript = await transcribeAudio(url);
        if (!transcript) continue;
        row.audio_transcript = transcript;
        await supabase.from("instagram_messages").update({
          audio_transcript: transcript,
          audio_transcribed_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }));
    const formattedHistory = chronRows.map((m: any) => {
      let transcript = m.audio_transcript;
      if (!transcript && (m.is_mine || m.sender_id === "me")) {
        const audioUrl =
          m.media_url ||
          (typeof m.text === "string"
            ? m.text.match(/\[audio:(.*?)\]/)?.[1]
            : null);
        if (audioUrl) {
          const matchingVaultItem = vaultItems.find(
            (vi: any) =>
              vi.mediaUrl === audioUrl ||
              (vi.mediaUrl && audioUrl.includes(vi.mediaUrl)),
          );
          if (matchingVaultItem) {
            transcript = matchingVaultItem.content || matchingVaultItem.title;
          }
        }
      }
      let cleanText = m.text || "";
      if (typeof cleanText === "string" && /"(?:analise_do_pretendente|responses)"\s*:/i.test(cleanText)) {
        try {
          const match = cleanText.match(/"responses"\s*:\s*\[([\s\S]*?)\]/);
          if (match?.[1]) {
            const extracted = Array.from(match[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)).map((x) => x[1]);
            if (extracted.length > 0) cleanText = extracted.join("\n");
          }
        } catch {}
      }
      return {
        id: m.id,
        sender: (m.is_mine || m.sender_id === "me" ? "me" : "them") as
          "me" | "them",
        text: cleanText,
        timestamp: m.timestamp,
        sentDate: m.timestamp,
        audioTranscript: transcript,
        replyToText: m.reply_to_message_id
          ? historyRows?.find((row: any) => row.id === m.reply_to_message_id)?.text
          : undefined,
        mediaType: m.media_type,
        mediaUrl: m.media_url,
      };
    });

    // Reconciliação automática com o histórico real da conversa:
    // Qualquer item que a Larissa já tenha enviado no histórico é marcado como [JÁ CUMPRIDO]
    const normalizeChecklistText = (str: string): string => {
      return (str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    };

    let reconciledAny = false;
    for (const m of formattedHistory) {
      if (m.sender === "me") {
        const normMsg = normalizeChecklistText(m.text);
        for (const it of stageChecklist) {
          if (completedSet.has(it.id)) continue;
          if (
            it.type === "audio" &&
            (
              (it.mediaUrl && (m.text?.includes(it.mediaUrl) || m.mediaUrl === it.mediaUrl)) ||
              (m.mediaType === "audio" || m.text?.startsWith("[audio:"))
            )
          ) {
            completedSet.add(it.id);
            it.isCompleted = true;
            reconciledAny = true;
            break;
          } else if (it.type === "text") {
            const normContent = normalizeChecklistText(it.content || it.title);
            if (
              normContent && normMsg &&
              normMsg === normContent
            ) {
              completedSet.add(it.id);
              it.isCompleted = true;
              reconciledAny = true;
            }
          }
        }
      }
    }

    if (reconciledAny) {
      chatProg.completedItemIds = Array.from(completedSet);
      progresses[conversationId] = chatProg;
      await persistChatProgress(supabase, progresses);
    }

    const pretendenteName =
      convData?.full_name || convData?.username || "Pretendente";

    let personaReferences: any[] = [];
    try {
      const { data: pData } = await supabase
        .from("ai_persona_references")
        .select("category, them_message, larissa_response, notes")
        .eq("is_active", true)
        .limit(20);
      if (pData && Array.isArray(pData)) {
        personaReferences = pData;
      }
    } catch (pErr) {
      console.warn(
        "Aviso ao buscar ai_persona_references no Cloud AutoPilot:",
        pErr,
      );
    }

    let tinderHistory: any[] = [];
    if (convData?.contact_id) {
      const { data: tinderRows, error: tinderError } = await supabase
        .from("tinder_messages").select("*")
        .eq("match_id", convData.contact_id)
        .order("sent_date", { ascending: false }).limit(500);
      if (tinderError) throw tinderError;
      tinderHistory = [...(tinderRows || [])].reverse().map((row: any) => ({
        id: row.id,
        sender: row.sender_id === "me" ? "me" : "them",
        text: row.message || "",
        timestamp: row.sent_date || row.created_at,
        sentDate: row.sent_date || row.created_at,
      }));
    }
    const igUseCase = new GenerateAiPromptUseCase();

    // Pesquisa na Internet: identifica entidades, artistas, shows ou lugares citados
    const latestThemText =
      [...formattedHistory].reverse().find((message: any) => message.sender === "them")?.text ||
      currentTriggerText ||
      "";

    let searchedWebContext = "";
    try {
      const searchCandidates = extractSearchCandidates(latestThemText);
      if (searchCandidates.length > 0) {
        console.log(
          `[Cloud AutoPilot] Termos identificados para pesquisa na internet: ${searchCandidates.join(", ")}`,
        );
        await publishAutoPilotState(supabase, conversationId, {
          status: "processing",
          activity: activity(
            "search",
            "Pesquisando na internet",
            `Buscando informações reais sobre: ${searchCandidates.join(", ")}`,
          ),
        });
        const searchPromises = searchCandidates.map((term) => searchContextInfo(term));
        const searchResults = await Promise.all(searchPromises);
        const validResults = searchResults.filter((r): r is string => Boolean(r && r.trim()));
        if (validResults.length > 0) {
          searchedWebContext = validResults.join("\n\n");
          console.log(
            `[Cloud AutoPilot] Pesquisa na internet encontrou contexto:\n${searchedWebContext}`,
          );
          await recordAutoPilotTrace(
            supabase,
            "web_search:success",
            conversationId,
            searchCandidates.join(", "),
          );
        }
      }
    } catch (searchErr) {
      console.warn("[Cloud AutoPilot] Erro na pesquisa web (não impeditivo):", searchErr);
    }

    const promptInput = {
      pretendente: {
        id: conversationId,
        name: pretendenteName,
        city: convData?.city || "não informada",
        bio: convData?.bio || "sem bio",
        platform: "instagram",
        username: convData?.username,
      },
      instagramHistory: formattedHistory,
      tinderHistory,
      personaReferences,
      mode: "markdown" as const,
      stageContext: {
        stageName: currentStage.name || currentFolder.name || "Etapa Atual",
        stageIndex: currentStageIndex,
        totalStages: stageSequence.length,
        checklist: stageChecklist,
        searchedWebContext: searchedWebContext || undefined,
      },
    };
    const promptRes = igUseCase.execute(promptInput);

    // Concorrência / Não perder nada: checa se chegou mensagem nova antes de acionar a Atria
    const newerBeforeAtria = await checkForNewerThemMessage(
      supabase,
      conversationId,
      currentTriggerId,
      currentTriggerTimestamp,
    );
    if (newerBeforeAtria) {
      console.log(
        `[Cloud AutoPilot] Mensagem nova (${newerBeforeAtria.id}) recebida antes de consultar a Atria. Interrompendo para reanalisar!`,
      );
      await recordAutoPilotTrace(supabase, "cycle:reanalyze", conversationId, `interrupted_by=${newerBeforeAtria.id}`);
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "reanalyzing",
          "Reanalisando conversa",
          "O cliente enviou uma mensagem nova. Interrompendo para reanalisar o histórico atualizado.",
        ),
      });
      return runCloudAutoPilot({
        supabase,
        conversationId,
        triggerMessageId: newerBeforeAtria.id,
        triggerTimestamp: newerBeforeAtria.timestamp,
        triggerText: newerBeforeAtria.text,
        runtime,
      });
    }

    // Atria analisa o contexto integral e escolhe Sol ou conteúdo do cofre.
    const nextPendingItem = stageChecklist.find((it: any) => !it.isCompleted) || null;
    const deterministicDirective = decideConversationStep(
      stageChecklist,
      nextPendingItem,
    );
    await publishAutoPilotState(supabase, conversationId, {
      status: "processing",
      lastThoughts: null,
      activity: activity(
        "atria",
        "Atria analisando",
        "Decidindo se usa o checklist ou chama o Sol para responder.",
      ),
    });
    const atriaBroadcaster = createThrottledBroadcaster(supabase, conversationId, "atria", 250);
    const orchestrator = await atriaControlStep(
      deterministicDirective,
      {
        conversationPrompt: promptRes.prompt,
        stageName: currentStage.name || currentFolder.name || "Etapa Atual",
        checklist: stageChecklist,
        latestContactText: latestThemText,
        pretendente: promptInput.pretendente,
        historyMessages: formattedHistory,
        searchedWebContext: searchedWebContext || undefined,
      },
      supabase,
      async (_chunk: string, accumulated: string) => {
        await atriaBroadcaster.broadcast({
          label: "Atria analisando ao vivo",
          detail: "Traçando estratégia de turno em tempo real...",
          atriaThought: accumulated,
        });
      },
    );
    await atriaBroadcaster.flush();
    console.log(`[TRACE-AUTOPILOT] cycle:orchestrator action=${orchestrator.action}`);
    await recordAutoPilotTrace(
      supabase,
      "atria:decision",
      conversationId,
      `action=${orchestrator.action};reason=${String(orchestrator.decisionReason || "").slice(0, 300)}`,
    );

    if (orchestrator.action === "pause_handoff" || orchestrator.action === "pause_guardrail") {
      if (orchestrator.reconciledCompletedIds && orchestrator.reconciledCompletedIds.length > 0) {
        chatProg.completedItemIds = Array.from(
          new Set([...(chatProg.completedItemIds || []), ...orchestrator.reconciledCompletedIds])
        );
        chatProg.updatedAt = new Date().toISOString();
        progresses[conversationId] = chatProg;
        await persistChatProgress(supabase, progresses);
      }
      await pauseCloudAutoPilotForHandoff(
        supabase, conversationId, states, chatState,
        orchestrator.pauseReason || "Intervenção humana solicitada.",
        orchestrator.action === "pause_guardrail" ? "paused_guardrail" : "paused_handoff",
      );
      return;
    }

    // Concorrência / Não perder nada: checa se chegou mensagem nova durante a análise da Atria
    const newerBeforeSol = await checkForNewerThemMessage(
      supabase,
      conversationId,
      currentTriggerId,
      currentTriggerTimestamp,
    );
    if (newerBeforeSol) {
      console.log(
        `[Cloud AutoPilot] Mensagem nova (${newerBeforeSol.id}) recebida durante a análise da Atria. Interrompendo para reanalisar!`,
      );
      await recordAutoPilotTrace(supabase, "cycle:reanalyze", conversationId, `interrupted_by=${newerBeforeSol.id}`);
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "reanalyzing",
          "Reanalisando conversa",
          "O cliente enviou uma mensagem nova durante a análise. Interrompendo para reanalisar tudo.",
        ),
      });
      return runCloudAutoPilot({
        supabase,
        conversationId,
        triggerMessageId: newerBeforeSol.id,
        triggerTimestamp: newerBeforeSol.timestamp,
        triggerText: newerBeforeSol.text,
        runtime,
      });
    }

    const atriaThought = orchestrator.decisionReason || orchestrator.directiveForPersona || "";
    // 9. CÉREBRO DE PERSONA OU BLOCO DIRETO DO CHECKLIST
    await publishAutoPilotState(supabase, conversationId, {
      status: "processing",
      activity: orchestrator.action === "send_checklist_batch"
        ? activity(
            "checklist",
            "Atria escolheu o checklist",
            "Preparando os conteúdos aprovados para esta etapa.",
            { atriaThought },
          )
        : activity(
            "sol",
            "Sol escrevendo",
            "Gerando uma resposta nova com o histórico completo da conversa.",
            { atriaThought },
          ),
    });
    const solInstagramHistory = (promptInput.instagramHistory || []).slice(-20);
    const solTinderHistory = (promptInput.tinderHistory || []).slice(-20);
    const solPrompt = orchestrator.action === "call_persona"
      ? igUseCase.execute({
          ...promptInput,
          instagramHistory: solInstagramHistory,
          tinderHistory: solTinderHistory,
          historyLimit: 20,
          stageContext: {
            ...promptInput.stageContext,
            turnGoalIds: orchestrator.targetChecklistIds || [],
            turnDirective: orchestrator.directiveForPersona || orchestrator.decisionReason || "",
            searchedWebContext: searchedWebContext || undefined,
          },
        }).prompt
      : promptRes.prompt;
    let solFailureReason = "";
    let personaResult;
    const solBroadcaster = createThrottledBroadcaster(supabase, conversationId, "sol", 250);
    try {
      if (orchestrator.action === "send_checklist_batch") {
        const mediaBatch = orchestrator.checklistBatch || [];
        const mediaResponses = checklistBatchToResponses(mediaBatch);
        const hasMedia = mediaBatch.some((it: any) => it.type === "audio" || it.type === "image");

        if (hasMedia) {
          console.log(
            `[Cloud AutoPilot] Combo Sol + Mídia (${mediaResponses.length} mídia(s)): acionando o Sol para reação afetuosa antes do envio.`,
          );
          const solMediaDirective = orchestrator.directiveForPersona ||
            `O pretendente acabou de falar ("${latestThemText.slice(0, 120)}"). Responda com calor humano e naturalidade em 1 ou 2 balões curtos validando o que ele disse ou puxando com deboche meigo se ele não perguntou sobre você (ex: "vou falar mais sobre mim também, já que vc não perguntou kkk"), MAS NÃO conte sua biografia nem detalhes em texto, pois seus áudios gravados serão despachados logo em seguida no mesmo turno. PROIBIDO terminantemente dizer "depois te mando áudio" ou "já vou te mandar áudio". Proibido ponto final.`;

          const solMediaPrompt = igUseCase.execute({
            ...promptInput,
            instagramHistory: solInstagramHistory,
            tinderHistory: solTinderHistory,
            historyLimit: 20,
            stageContext: {
              ...promptInput.stageContext,
              turnGoalIds: [],
              turnDirective: solMediaDirective,
              searchedWebContext: searchedWebContext || undefined,
            },
          }).prompt;

          let solBalloons: string[] = [];
          try {
            const solResult = await generatePersonaResponse(
              supabase,
              solMediaPrompt,
              [],
              async (_chunk: string, accumulated: string) => {
                const liveThought = extractStreamingSolThought(accumulated);
                await solBroadcaster.broadcast({
                  label: "Sol redigindo ao vivo",
                  detail: "Preparando a conversa antes dos áudios...",
                  atriaThought,
                  solThought: liveThought,
                });
              },
            );
            solBalloons = (solResult.responses || []).filter(
              (b: string) => !b.startsWith("[audio:") && !b.startsWith("[image:"),
            );
          } catch (solErr) {
            console.warn(
              "[Cloud AutoPilot] Sol falhou na introdução da mídia. Despachando mídias diretamente por contingência:",
              solErr,
            );
          }

          personaResult = {
            responses: [...solBalloons, ...mediaResponses],
            modelUsed: solBalloons.length > 0 ? "Sol + Mídia do Cofre" : "Mídia do Cofre",
            completedItemIds: orchestrator.targetChecklistIds || [],
          };
        } else {
          personaResult = {
            responses: mediaResponses,
            modelUsed: "Checklist selecionado pela Atria",
            completedItemIds: orchestrator.targetChecklistIds || [],
          };
        }
      } else {
        personaResult = await generatePersonaResponse(
          supabase,
          solPrompt,
          orchestrator.targetChecklistIds || [],
          async (_chunk: string, accumulated: string) => {
            const liveThought = extractStreamingSolThought(accumulated);
            await solBroadcaster.broadcast({
              label: "Sol redigindo ao vivo",
              detail: "Incorporando a voz da Larissa ao vivo...",
              atriaThought,
              solThought: liveThought,
            });
          },
        );
        if (orchestrator.checklistBatch && orchestrator.checklistBatch.length > 0) {
          const extraMedia = checklistBatchToResponses(orchestrator.checklistBatch);
          if (extraMedia.length > 0) {
            personaResult.responses = [...personaResult.responses, ...extraMedia];
            personaResult.modelUsed = `${personaResult.modelUsed} + Mídia do Cofre`;
          }
        }
      }
      await solBroadcaster.flush();
    } catch (error: unknown) {
      solFailureReason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[TRACE-AUTOPILOT] Sol:failed reason=${solFailureReason.slice(0, 300)}`,
      );
      await recordAutoPilotTrace(
        supabase,
        "sol:failed",
        conversationId,
        solFailureReason.slice(0, 500),
      );
      await pauseCloudAutoPilotForHandoff(
        supabase,
        conversationId,
        states,
        chatState,
        `Sol indisponível ou resposta inválida (${solFailureReason.slice(0, 120)}). Pausado por segurança.`,
        "paused_guardrail",
      );
      return;
    }

    let responses = personaResult.responses;
    const hasControlPayload = responses.some((balloon: unknown) => {
      if (typeof balloon !== "string") return true;
      const sample = balloon.trim().replace(/^```(?:json)?\s*/i, "");
      return /(?:^json\s*\n?\s*)?\{[\s\S]*"(?:responses|indices|completed_checklist_ids|analise_do_pretendente)"\s*:/.test(sample);
    });
    if (hasControlPayload) {
      console.warn("[TRACE-AUTOPILOT] generation:control_payload detected");
      await recordAutoPilotTrace(
        supabase,
        "sol:control_payload_blocked",
        conversationId,
        "Payload continha JSON bruto. Pausando por segurança sem enviar para a Meta.",
      );
      await pauseCloudAutoPilotForHandoff(
        supabase,
        conversationId,
        states,
        chatState,
        "Resposta gerada continha JSON bruto em vez de fala humana. Pausado por segurança.",
        "paused_guardrail",
      );
      return;
    }
    console.log(`[TRACE-AUTOPILOT] cycle:generated model=${personaResult.modelUsed} responses=${responses?.length || 0}`);
    await recordAutoPilotTrace(supabase, "generation:success", conversationId, `model=${personaResult.modelUsed};responses=${responses?.length || 0}`);
    if (!responses || responses.length === 0) {
      console.warn(
        "[Cloud AutoPilot] Lote do checklist vazio ou sem respostas. Acionando Sol para formular resposta e não travar o chat.",
      );
      try {
        const fallbackPersona = await generatePersonaResponse(
          supabase,
          solPrompt,
          orchestrator.targetChecklistIds || [],
        );
        responses = fallbackPersona.responses;
        personaResult = fallbackPersona;
      } catch (err) {
        console.error("[Cloud AutoPilot] Falha na contingência do Sol:", err);
      }
      if (!responses || responses.length === 0) {
        console.error(
          "[Cloud AutoPilot] Nenhuma resposta gerada pela Persona da IA após contingência.",
        );
        return;
      }
    }

    const solThought = (personaResult as any)?.analisePretendente || "";
    await publishAutoPilotState(supabase, conversationId, {
      status: "processing",
      activity: activity(
        "sol",
        "Larissa formulou a resposta",
        "Raciocínio concluído. Preparando cadência de digitação dos balões...",
        {
          atriaThought,
          solThought,
          previewResponses: responses,
        },
      ),
    });

    // 10. Busca token de envio da Meta Graph API
    const { data: igConfig } = await supabase
      .from("instagram_config")
      .select("access_token, username")
      .eq("id", "default")
      .maybeSingle();

    if (!igConfig?.access_token) {
      console.error(
        "[Cloud AutoPilot] Access token do Instagram não encontrado.",
      );
      return;
    }

    // Resolve destinatário numérico
    let recipientIgsid = conversationId;
    if (!/^\d+$/.test(conversationId)) {
      const foundRow = (historyRows || []).find(
        (r: any) =>
          !r.is_mine && r.sender_id !== "me" && /^\d+$/.test(r.sender_id),
      );
      if (foundRow) recipientIgsid = foundRow.sender_id;
    }

    let newerMessagePendingAfterSend: { id: string; text: string; timestamp: string } | null = null;

    // Lock atômico de envio: garante que apenas o ciclo mais recente transmita e impede transmissões paralelas
    const { data: convCheckPreSend } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", conversationId)
      .maybeSingle();
    const tokenPreSendOnConv = convCheckPreSend?.stage_completed_rules?.active_cycle_token;
    if (tokenPreSendOnConv && tokenPreSendOnConv !== cycleToken) {
      console.log(
        `[Cloud AutoPilot] Abortando envio para ${conversationId}: ciclo ${cycleToken} foi superado por ${tokenPreSendOnConv} na conversa.`,
      );
      await recordAutoPilotTrace(
        supabase,
        "cycle:stale_aborted",
        conversationId,
        `stale=${cycleToken};active=${tokenPreSendOnConv}`,
      );
      return;
    }

    // Trava Canônica de Mensagens Recentes: se já respondemos nos últimos 45 segundos, aborta imediatamente para impedir duplicidade
    const { data: lastSentCheck } = await supabase
      .from("instagram_messages")
      .select("id, is_mine, sender_id, timestamp")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: false })
      .limit(1);

    if (lastSentCheck && lastSentCheck.length > 0) {
      const lastMsg = lastSentCheck[0];
      const isMine = lastMsg.is_mine || lastMsg.sender_id === "me";
      if (isMine) {
        const elapsedSec = (Date.now() - new Date(lastMsg.timestamp).getTime()) / 1000;
        if (elapsedSec < 45) {
          console.log(
            `[Cloud AutoPilot] Abortando envio para ${conversationId}: mensagem recente enviada por nós há ${elapsedSec.toFixed(1)}s. Evitando resposta duplicada.`,
          );
          await recordAutoPilotTrace(
            supabase,
            "cycle:duplicate_prevented",
            conversationId,
            `elapsed=${elapsedSec.toFixed(1)}s;mid=${lastMsg.id}`,
          );
          return;
        }
      }
    }

    const { data: preSendStatesRow } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle();
    const preSendStates = preSendStatesRow?.stage_completed_rules?.states || {};
    const preSendChatState = preSendStates[conversationId];

    if (preSendChatState?.activeCycleToken && preSendChatState.activeCycleToken !== cycleToken && isOtherCycleNewer(preSendChatState.activeCycleToken, cycleToken)) {
      console.log(
        `[Cloud AutoPilot] Abortando envio para ${conversationId}: ciclo ${cycleToken} foi superado por ${preSendChatState.activeCycleToken}.`,
      );
      return;
    }
    const lockStartedMs = preSendChatState?.sendingStartedAt ? Date.parse(preSendChatState.sendingStartedAt) : 0;
    const isLockExpired = lockStartedMs > 0 ? (Date.now() - lockStartedMs > 25000) : true;
    const isCurrentCycleOwner = preSendChatState?.sendingCycleToken === cycleToken;

    if (preSendChatState?.isSending && !isLockExpired && !isCurrentCycleOwner) {
      console.log(
        `[Cloud AutoPilot] Abortando envio para ${conversationId}: outro ciclo (${preSendChatState.sendingCycleToken || "desconhecido"}) já está transmitindo mensagens ativamente há ${((Date.now() - lockStartedMs) / 1000).toFixed(1)}s.`,
      );
      return;
    }

    preSendStates[conversationId] = {
      ...preSendChatState,
      isSending: true,
      sendingStartedAt: new Date().toISOString(),
      sendingCycleToken: cycleToken,
    };
    await supabase.from("instagram_conversations").upsert({
      id: "__autopilot_states__",
      username: "system_autopilot_states",
      stage_completed_rules: { states: preSendStates, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });

    // 11. Disparo de cada balão na Meta respeitando a cadência de envio humana (áudio = duração, texto = 4-8s)
    for (let i = 0; i < responses.length; i++) {
      const balloon = responses[i];
      if (!balloon || !balloon.trim()) continue;

      // Concorrência / Não perder nada: checa se o pretendente mandou mensagem nova durante o envio dos balões
      const newerDuringTyping = await checkForNewerThemMessage(
        supabase,
        conversationId,
        currentTriggerId,
        currentTriggerTimestamp,
      );
      if (newerDuringTyping) {
        console.log(
          `[Cloud AutoPilot] Nova mensagem (${newerDuringTyping.id}) recebida durante o envio do balão ${i + 1}. Marcada para resposta imediata após conclusão!`,
        );
        newerMessagePendingAfterSend = newerDuringTyping;
      }

      const isAudio = balloon.startsWith("[audio:");
      const audioMatch = isAudio
        ? balloon.match(/^\[audio:(https?:\/\/[^\]]+)\]/)
        : null;
      const audioUrl = audioMatch ? audioMatch[1] : undefined;
      const imageUrl = balloon.match(/^\[image:(https?:\/\/[^\]]+)\]/)?.[1];

      // Cadência humana: respeita o tempo de digitação configurado (ex: 10s por balão) ou duração real do áudio gravado
      const configuredTypingDelay =
        typeof config?.typingDelaySecondsPerBalloon === "number" && config.typingDelaySecondsPerBalloon > 0
          ? config.typingDelaySecondsPerBalloon
          : 8;

      let delaySeconds = configuredTypingDelay;
      if (isAudio && audioUrl) {
        const matchingVaultItem = stageChecklist.find(
          (it: any) =>
            it.mediaUrl === audioUrl ||
            (it.mediaUrl && audioUrl.includes(it.mediaUrl)),
        );
        delaySeconds = Math.max(Math.round(matchingVaultItem?.duration || 12), 4);
      } else {
        delaySeconds = configuredTypingDelay;
      }

      const elapsedTotalMs = Date.now() - functionStartTime;
      const remainingSafeBudgetMs = 120000 - elapsedTotalMs;
      if (elapsedTotalMs > 55000 || remainingSafeBudgetMs < 30000) {
        console.log(
          `[Cloud AutoPilot] Tempo de execução elevado (${(elapsedTotalMs / 1000).toFixed(1)}s). Acelerando cadência do balão ${i + 1} para 2s para entrega segura.`,
        );
        delaySeconds = Math.min(delaySeconds, 2);
      }

      console.log(
        `[Cloud AutoPilot] Simulando cadência humana (${delaySeconds}s) para balão ${i + 1}/${responses.length}...`,
      );

      let currentBalloonText = balloon;
      let wasCancelled = false;

      // Publica o início da digitação uma única vez com o countdownSeconds inicial.
      // O front-end (AutoPilotActivityIndicator) decrementa suavemente segundo a segundo no navegador,
      // evitando dezenas de requisições desnecessárias a cada segundo que estouravam o timeout da Edge Function.
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "typing",
          `IA digitando ${i + 1}/${responses.length}`,
          isAudio ? "Gravando/preparando o áudio da Larissa..." : `Simulando digitação natural (${delaySeconds}s)...`,
          {
            currentBalloon: i + 1,
            totalBalloons: responses.length,
            atriaThought,
            solThought,
            previewResponses: responses,
            currentResponsePreview: currentBalloonText,
            countdownSeconds: delaySeconds,
          },
        ),
      });

      for (let s = delaySeconds; s > 0; s--) {
        // Checagem de cancelamento (pausar) ou edição pelo operador a cada segundo
        try {
          const { data: checkConv } = await supabase
            .from("instagram_conversations")
            .select("stage_completed_rules")
            .eq("id", conversationId)
            .maybeSingle();
          const rules = checkConv?.stage_completed_rules || {};

          if (rules.cancel_current_cycle === true || rules.status === "paused_manual") {
            console.log(`[Cloud AutoPilot] Ciclo cancelado pelo operador no chat ${conversationId}.`);
            await recordAutoPilotTrace(supabase, "cycle:cancelled_by_user", conversationId, `balloon=${i + 1}`);
            await publishAutoPilotState(supabase, conversationId, {
              status: "idle",
              activity: null,
            });
            await supabase.from("instagram_conversations").update({
              stage_completed_rules: { ...rules, cancel_current_cycle: null, status: null },
            }).eq("id", conversationId);
            wasCancelled = true;
            break;
          }

          // Se o operador está editando este balão na tela, PAUSA a contagem regressiva
          if (rules.editing_in_progress === true) {
            console.log(`[Cloud AutoPilot] Operador está editando o balão ${i + 1}. Pausando contagem regressiva...`);
            let editWaitCount = 0;
            while (editWaitCount < 180) {
              await new Promise((r) => setTimeout(r, 1000));
              editWaitCount++;
              const { data: pollConv } = await supabase
                .from("instagram_conversations")
                .select("stage_completed_rules")
                .eq("id", conversationId)
                .maybeSingle();
              const pollRules = pollConv?.stage_completed_rules || {};

              if (pollRules.cancel_current_cycle === true || pollRules.status === "paused_manual") {
                rules.cancel_current_cycle = true;
                break;
              }

              // Se o operador salvou o texto editado
              if (pollRules.edited_balloon_text && typeof pollRules.edited_balloon_text === "string") {
                currentBalloonText = pollRules.edited_balloon_text;
                console.log(`[Cloud AutoPilot] Edição salva pelo operador: "${currentBalloonText}". Retomando contagem (${s}s restantes)...`);
                await supabase.from("instagram_conversations").update({
                  stage_completed_rules: { ...pollRules, edited_balloon_text: null, editing_in_progress: null },
                }).eq("id", conversationId);

                // Atualiza a prévia visual e transmite os segundos restantes
                await publishAutoPilotState(supabase, conversationId, {
                  status: "processing",
                  activity: activity(
                    "typing",
                    `IA digitando ${i + 1}/${responses.length}`,
                    `Texto editado! Retomando envio (${s}s)...`,
                    {
                      currentBalloon: i + 1,
                      totalBalloons: responses.length,
                      atriaThought,
                      solThought,
                      previewResponses: responses,
                      currentResponsePreview: currentBalloonText,
                      countdownSeconds: s,
                    },
                  ),
                });
                break;
              }

              // Se o operador cancelou a edição sem salvar
              if (!pollRules.editing_in_progress) {
                console.log(`[Cloud AutoPilot] Edição cancelada pelo operador. Retomando contagem (${s}s restantes)...`);
                break;
              }
            }
          }

          if (rules.edited_balloon_text && typeof rules.edited_balloon_text === "string") {
            currentBalloonText = rules.edited_balloon_text;
            console.log(`[Cloud AutoPilot] Balão ${i + 1} editado pelo operador: "${currentBalloonText}"`);
            await supabase.from("instagram_conversations").update({
              stage_completed_rules: { ...rules, edited_balloon_text: null, editing_in_progress: null },
            }).eq("id", conversationId);

            // Atualiza a prévia visual caso tenha havido edição humana
            await publishAutoPilotState(supabase, conversationId, {
              status: "processing",
              activity: activity(
                "typing",
                `IA digitando ${i + 1}/${responses.length}`,
                "Texto editado pelo operador.",
                {
                  currentBalloon: i + 1,
                  totalBalloons: responses.length,
                  atriaThought,
                  solThought,
                  previewResponses: responses,
                  currentResponsePreview: currentBalloonText,
                  countdownSeconds: s,
                },
              ),
            });
          }

          if (rules.send_immediately === true) {
            console.log(`[Cloud AutoPilot] Operador solicitou envio imediato do balão ${i + 1}.`);
            await supabase.from("instagram_conversations").update({
              stage_completed_rules: { ...rules, send_immediately: null },
            }).eq("id", conversationId);
            break;
          }
        } catch (_chkErr) {}

        await new Promise((r) => setTimeout(r, 1000));
      }

      if (wasCancelled) {
        return;
      }

      const metaMsgPayload =
        isAudio && audioUrl
          ? { attachment: { type: "audio", payload: { url: audioUrl } } }
          : imageUrl
          ? { attachment: { type: "image", payload: { url: imageUrl } } }
          : { text: currentBalloonText };

      let metaMid = `cloud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "sending",
          `Enviando ${i + 1}/${responses.length}`,
          "Entregando a mensagem pelo Instagram.",
          {
            currentBalloon: i + 1,
            totalBalloons: responses.length,
            atriaThought,
            solThought,
            previewResponses: responses,
            currentResponsePreview: balloon,
            countdownSeconds: 0,
          },
        ),
      });
      console.log(`[TRACE-AUTOPILOT] meta:send conversation=${conversationId} index=${i + 1}`);
      const metaRes = await fetch(
          `${API_BASE}/me/messages?access_token=${igConfig.access_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: recipientIgsid },
              message: metaMsgPayload,
            }),
          },
        );
        const metaData = await metaRes.json();
      if (!metaRes.ok || !metaData?.message_id) {
          await recordAutoPilotTrace(supabase, "meta:failed", conversationId, `status=${metaRes.status}`);
          throw new Error(`Envio recusado pela Meta (HTTP ${metaRes.status}).`);
        }
        metaMid = metaData.message_id;
      } catch (sendErr) {
        console.error("[Cloud AutoPilot] Erro ao enviar na Meta:", sendErr);
        throw sendErr;
      }
      console.log(`[TRACE-AUTOPILOT] meta:success index=${i + 1}`);
      await recordAutoPilotTrace(supabase, "meta:success", conversationId, `index=${i + 1}`);

      const nowIso = new Date().toISOString();
      await supabase.from("instagram_messages").upsert({
        id: metaMid,
        conversation_id: conversationId,
        sender_id: "me",
        text: balloon,
        timestamp: nowIso,
        is_mine: true,
        status: "sent",
        media_url: audioUrl || imageUrl || null,
        media_type: isAudio ? "audio" : imageUrl ? "image" : null,
      });

      await supabase
        .from("instagram_conversations")
        .update({
          last_message: isAudio ? "🎙️ Mensagem de voz" : balloon,
          last_message_preview: isAudio ? "🎙️ Mensagem de voz" : balloon,
          last_message_at: nowIso,
          last_direction: "out",
          last_status: "sent",
          seen_at: null,
          unread: false,
          updated_at: nowIso,
        })
        .eq("id", conversationId);

      // Emite broadcast da mensagem enviada e do status da conversa para telas conectadas
      try {
        const realtimeChannel = supabase.channel("vendeo_realtime_chat");
        await realtimeChannel.send({
          type: "broadcast",
          event: "instagram_message",
          payload: {
            id: metaMid,
            conversationId,
            senderId: "me",
            text: balloon,
            timestamp: nowIso,
            isMine: true,
            status: "sent",
            mediaUrl: audioUrl || imageUrl || null,
            mediaType: isAudio ? "audio" : imageUrl ? "image" : undefined,
          },
        });
        await realtimeChannel.send({
          type: "broadcast",
          event: "instagram_conversation_update",
          payload: {
            id: conversationId,
            lastMessage: isAudio ? "🎙️ Mensagem de voz" : balloon,
            lastMessageAt: nowIso,
            lastDirection: "out",
            lastStatus: "sent",
            seenAt: null,
            unread: false,
          },
        });
      } catch (bErr) {
        console.warn("Aviso broadcast mensagem:", bErr);
      }
    }

    // 12. Atualiza checklist e avanço de etapa no banco de dados
    const completedIds: string[] = [
      ...personaResult.completedItemIds,
      ...(orchestrator.reconciledCompletedIds || []),
    ];
    for (const b of responses) {
      for (const it of stageChecklist) {
        if (
          it.type === "audio" &&
          b.startsWith("[audio:") &&
          it.mediaUrl &&
          b.includes(it.mediaUrl)
        ) {
          completedIds.push(it.id);
        }
      }
    }

    const newCompleted = Array.from(
      new Set([
        ...(chatProg.completedItemIds || []),
        ...completedSet,
        ...completedIds,
      ]),
    );
    chatProg.completedItemIds = newCompleted;

    const totalInStage = stageChecklist.length;
    const completedCount = stageChecklist.filter((it: any) =>
      newCompleted.includes(it.id),
    ).length;
    if (
      totalInStage > 0 &&
      completedCount >= totalInStage &&
      stageSequence.length > currentStageIndex + 1
    ) {
      const nextStage = stageSequence[currentStageIndex + 1];
      chatProg.currentStageId = nextStage.id;
      console.log(
        `[Cloud AutoPilot] Etapa 100% concluída! Avançando para ${nextStage.name}...`,
      );
    }

    chatProg.updatedAt = new Date().toISOString();
    progresses[conversationId] = chatProg;
    await persistChatProgress(supabase, progresses);

    // Se uma nova mensagem foi recebida do pretendente durante a entrega dos balões,
    // nós NÃO vamos parar nem deixar no vácuo: atendemos imediatamente a nova mensagem!
    if (newerMessagePendingAfterSend) {
      console.log(
        `[Cloud AutoPilot] Atendendo imediatamente à mensagem nova (${newerMessagePendingAfterSend.id}) recebida durante o envio! Não deixando nada no vácuo.`,
      );
      await recordAutoPilotTrace(
        supabase,
        "cycle:followup_new_message",
        conversationId,
        `trigger=${newerMessagePendingAfterSend.id}`,
      );
      await publishAutoPilotState(supabase, conversationId, {
        status: "processing",
        activity: activity(
          "context",
          "Atendendo mensagem nova",
          "Respondendo à mensagem recebida enquanto os balões anteriores eram entregues.",
        ),
      });
      return runCloudAutoPilot({
        supabase,
        conversationId,
        triggerMessageId: newerMessagePendingAfterSend.id,
        triggerTimestamp: newerMessagePendingAfterSend.timestamp,
        triggerText: newerMessagePendingAfterSend.text,
        runtime,
      });
    }

    if (orchestrator.shouldPauseAfterSend) {
      chatState.lastThoughts = {
        atriaThought: atriaThought || undefined,
        solThought: solThought || undefined,
        previewResponses: responses,
        sentAt: new Date().toISOString(),
      };
      await pauseCloudAutoPilotForHandoff(
        supabase,
        conversationId,
        states,
        chatState,
        orchestrator.pauseReason ||
          "Serviço da IA concluído: os áudios obrigatórios foram enviados. Assuma a conversa manualmente.",
      );
    } else {
      const lastThoughts = {
        atriaThought: atriaThought || undefined,
        solThought: solThought || undefined,
        previewResponses: responses,
        sentAt: new Date().toISOString(),
      };
      await publishAutoPilotState(supabase, conversationId, {
        status: "idle",
        activity: activity(
          "completed",
          "Última resposta enviada",
          "Aguardando nova mensagem do pretendente para iniciar novo ciclo.",
          {
            atriaThought,
            solThought,
            previewResponses: responses,
          },
        ),
        lastThoughts,
        scheduledResponseAt: null,
        lastResponseSentAt: new Date().toISOString(),
        isSending: false,
        sendingStartedAt: null,
        sendingCycleToken: null,
      });
    }

    console.log(
      `[Cloud AutoPilot] Atendimento em nuvem finalizado com sucesso para ${conversationId} usando ${personaResult.modelUsed}!`,
    );
  } catch (cloudErr) {
    const errorDetail = cloudErr instanceof Error
      ? cloudErr.message
      : typeof cloudErr === "object" && cloudErr
        ? JSON.stringify(cloudErr)
        : String(cloudErr);
    await recordAutoPilotTrace(supabase, "cycle:error", conversationId, errorDetail);
    console.error(
      `[Cloud AutoPilot] Erro durante atendimento em nuvem para ${conversationId}:`,
      cloudErr,
    );
  } finally {
    try {
      const { data: finalRow } = await supabase
        .from("instagram_conversations")
        .select("stage_completed_rules")
        .eq("id", "__autopilot_states__")
        .maybeSingle();
      const finalStates = finalRow?.stage_completed_rules?.states || {};
      const current = finalStates[conversationId];
      if (current) {
        let changed = false;
        // Preserva o histórico de pensamentos se o ciclo foi concluído (phase === "completed" ou se tem lastThoughts)
        if (current.activity && current.activity.phase !== "completed") {
          if (current.lastThoughts?.atriaThought || current.lastThoughts?.solThought) {
            current.activity = activity(
              "completed",
              "Última resposta enviada",
              "Aguardando nova mensagem do pretendente para iniciar novo ciclo.",
              {
                atriaThought: current.lastThoughts.atriaThought,
                solThought: current.lastThoughts.solThought,
                previewResponses: current.lastThoughts.previewResponses,
              },
            );
          } else {
            current.activity = null;
          }
          changed = true;
        }
        if (current.status === "processing" || current.status === "waiting_delay") {
          current.status = "idle";
          changed = true;
        }
        if (current.isSending || current.sendingCycleToken) {
          current.isSending = false;
          current.sendingStartedAt = null;
          current.sendingCycleToken = null;
          changed = true;
        }
        const activeTime = parseCycleTimestamp(current.activeCycleToken);
        if (current.activeCycleToken === cycleToken || (activeTime > 0 && (Date.now() - activeTime) > 60000)) {
          current.activeCycleToken = null;
          changed = true;
        }
        if (changed) {
          current.stateUpdatedAt = new Date().toISOString();
          finalStates[conversationId] = current;
          await supabase.from("instagram_conversations").upsert({
            id: "__autopilot_states__",
            username: "system_autopilot_states",
            stage_completed_rules: { states: finalStates, updated_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          });
          const realtimeChannel = supabase.channel("vendeo_realtime_chat");
          await realtimeChannel.send({
            type: "broadcast",
            event: "autopilot_state_update",
            payload: { ...current, timestamp: current.stateUpdatedAt },
          });
        }
      }
    } catch (_fErr) {}
  }
}
