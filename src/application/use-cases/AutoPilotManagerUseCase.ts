import { IAutoPilotRepository } from "@/domain/repositories/IAutoPilotRepository";
import { ManageChatProgressUseCase } from "./ManageChatProgressUseCase";
import {
  AutoPilotConfig,
  AutoPilotChatState,
} from "@/domain/entities/AutoPilot";
export interface AutoPilotMessageLike {
  id?: string;
  senderId?: string;
  sender?: "me" | "them";
  isMine?: boolean;
  text?: string;
  timestamp?: any;
  sentDate?: string;
  createdAt?: string;
  mediaType?: string;
  mediaUrl?: string;
  audioUrl?: string;
  audioTranscript?: string;
}

export interface EligibilityResult {
  isEligible: boolean;
  reason?: string;
  isPaused?: boolean;
  pauseReason?: string;
  isHandOff?: boolean;
  remainingWaitSeconds?: number;
}

export interface ProcessResponseResult {
  success: boolean;
  responses: string[];
  autoCompletedItemIds: string[];
  isHandOff: boolean;
  handOffReason?: string;
  error?: string;
}

export class AutoPilotManagerUseCase {
  constructor(
    private autoPilotRepository: IAutoPilotRepository,
    private progressUseCase: ManageChatProgressUseCase
  ) {}

  /**
   * Avalia rigorosamente se um chat específico está pronto para ser atendido pela IA autônoma
   */
  async checkChatEligibility(
    conversationId: string,
    chatMessages: AutoPilotMessageLike[]
  ): Promise<EligibilityResult> {
    const config = await this.autoPilotRepository.getConfig();
    if (!config.isEnabledGlobally) {
      return { isEligible: false, reason: "Piloto Automático desativado globalmente." };
    }

    const state = await this.autoPilotRepository.getChatState(conversationId);
    if (!state || !state.isEnabled) {
      return { isEligible: false, reason: "Piloto Automático desligado neste chat." };
    }

    if (state.status === "paused_handoff") {
      return { isEligible: false, isHandOff: true, isPaused: true, pauseReason: state.pauseReason };
    }

    if (state.status === "paused_guardrail") {
      return { isEligible: false, isPaused: true, pauseReason: state.pauseReason };
    }

    // 1. Verifica tempo mínimo de 1 minuto após ativar antes de começar (ignorado em chats de teste)
    const isTestChat = conversationId.startsWith("test_");
    if (state.enabledAt && !isTestChat) {
      const activationTime = new Date(state.enabledAt).getTime();
      const now = Date.now();
      const minActivationWaitMs = (config.activationWaitMinutes || 1) * 60 * 1000;
      if (now - activationTime < minActivationWaitMs) {
        const remainingSec = Math.ceil((minActivationWaitMs - (now - activationTime)) / 1000);
        return {
          isEligible: false,
          reason: `Aguardando ativação inicial (${remainingSec}s restantes)`,
          remainingWaitSeconds: remainingSec,
        };
      }
    }

    // 2. Se não há mensagens no chat, fica em repouso
    if (!chatMessages || chatMessages.length === 0) {
      return { isEligible: false, reason: "Sem mensagens no chat." };
    }

    // 3. Verifica a última mensagem trocada
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage.isMine || lastMessage.sender === "me" || lastMessage.senderId === "me") {
      // Já respondido por nós
      return { isEligible: false, reason: "Última mensagem já foi enviada pela Larissa." };
    }

    // 4. GUARDRAILS DE SEGURANÇA: Foto recebida ou conteúdo suspeito
    if (config.pauseOnPhotoReceived) {
      const hasImage =
        lastMessage.mediaType === "image" ||
        Boolean(lastMessage.mediaUrl && !lastMessage.audioUrl && !lastMessage.audioTranscript);
      if (hasImage) {
        await this.autoPilotRepository.saveChatState(conversationId, {
          status: "paused_guardrail",
          pauseReason: "Foto recebida do pretendente. Permissão necessária do dono.",
          pausedAt: new Date().toISOString(),
        });
        return {
          isEligible: false,
          isPaused: true,
          pauseReason: "Foto recebida do pretendente. Permissão necessária do dono.",
        };
      }
    }

    // 5. GUARDRAIL: Conteúdo agressivo/explícito/suspeito
    if (config.pauseOnSensitiveContent && lastMessage.text) {
      const textLower = lastMessage.text.toLowerCase();
      const suspiciousTriggers = [
        "nude",
        "pelada",
        "foto íntima",
        "safada",
        "golpe",
        "processo",
        "policia",
        "polícia",
        "advogado",
        "cadela",
        "vagabunda",
        "puta",
      ];
      const foundTrigger = suspiciousTriggers.find((trigger) => textLower.includes(trigger));
      if (foundTrigger) {
        await this.autoPilotRepository.saveChatState(conversationId, {
          status: "paused_guardrail",
          pauseReason: `Conteúdo sensível detectado ("${foundTrigger}"). Permissão necessária do dono.`,
          pausedAt: new Date().toISOString(),
        });
        return {
          isEligible: false,
          isPaused: true,
          pauseReason: `Conteúdo sensível detectado ("${foundTrigger}").`,
        };
      }
    }

    // 6. TIMER DE ESPERA (DEBOUNCE da última mensagem do cliente)
    const clientMessageTime = lastMessage.timestamp
      ? new Date(lastMessage.timestamp).getTime()
      : lastMessage.sentDate
      ? new Date(lastMessage.sentDate).getTime()
      : Date.now();

    const delayMs = isTestChat ? 3000 : config.responseDelayMinutes * 60 * 1000;
    const scheduledResponseMs = clientMessageTime + delayMs;
    const now = Date.now();

    if (now < scheduledResponseMs) {
      const remainingSec = Math.ceil((scheduledResponseMs - now) / 1000);
      return {
        isEligible: false,
        reason: `Aguardando timer de resposta (${remainingSec}s)`,
        remainingWaitSeconds: remainingSec,
      };
    }

    // Elegível para responder!
    return { isEligible: true };
  }

  /**
   * Avalia o ponto de corte do cronograma: verifica se o chat atingiu a etapa da Rifa
   * após os áudios sobre si mesma
   */
  async isRaffleHandoffTriggered(conversationId: string): Promise<boolean> {
    const detail = await this.progressUseCase.getChatStageDetail(conversationId);
    if (!detail || !detail.stage) return false;

    const stageNameLower = (detail.stage.name || "").toLowerCase();
    const stageDescLower = (detail.stage.description || "").toLowerCase();

    // Se o nome da etapa contiver "rifa"
    if (stageNameLower.includes("rifa") || stageDescLower.includes("rifa")) {
      // Verifica se a etapa anterior (ou os itens anteriores sobre si mesma) já foram concluídos
      if (detail.stageIndex > 0) {
        return true;
      }
    }

    // Verifica itens do checklist pendentes nesta etapa
    const pendingItems = detail.checklist.filter((it) => !it.isCompleted);
    const completedItems = detail.checklist.filter((it) => it.isCompleted);

    // Se já cumpriu pelo menos 2 itens (áudios sobre si) e o próximo item é áudio/texto sobre rifa
    const nextItem = pendingItems[0];
    if (nextItem) {
      const titleLower = (nextItem.title || "").toLowerCase();
      const contentLower = (nextItem.content || "").toLowerCase();
      if (titleLower.includes("rifa") || contentLower.includes("rifa")) {
        if (completedItems.length >= 2) {
          return true;
        }
      }
    }

    return false;
  }
}
