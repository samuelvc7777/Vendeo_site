import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import { IVaultRepository } from "@/domain/repositories/IVaultRepository";
import { ChatStage, ChatProgress, StageChecklistItem } from "@/domain/entities/ChatStage";

export interface ChatStageDetail {
  conversationId: string;
  stage: ChatStage | null;
  stageIndex: number;
  totalStages: number;
  isFirstStage: boolean;
  isLastStage: boolean;
  nextStage: ChatStage | null;
  checklist: StageChecklistItem[];
  totalItems: number;
  completedItemsCount: number;
  is100Percent: boolean;
  isConverted: boolean;
  allStages: ChatStage[];
}

export class ManageChatProgressUseCase {
  constructor(
    private stageRepository: IChatStageRepository,
    private vaultRepository: IVaultRepository
  ) {}

  async getChatStageDetail(conversationId: string): Promise<ChatStageDetail> {
    const stages = await this.stageRepository.getStages();
    let progress = await this.stageRepository.getChatProgress(conversationId);

    // Se não há etapas cadastradas no sistema
    if (stages.length === 0) {
      return {
        conversationId,
        stage: null,
        stageIndex: -1,
        totalStages: 0,
        isFirstStage: false,
        isLastStage: false,
        nextStage: null,
        checklist: [],
        totalItems: 0,
        completedItemsCount: 0,
        is100Percent: false,
        isConverted: progress?.isConverted || false,
        allStages: [],
      };
    }

    // Se a conversa ainda não tem progresso salvo, inicializa na primeira etapa
    if (!progress || !progress.currentStageId) {
      progress = {
        conversationId,
        currentStageId: stages[0].id,
        completedItemIds: [],
        isConverted: false,
        updatedAt: new Date().toISOString(),
      };
      await this.stageRepository.saveChatProgress(progress);
    }

    // Encontra a etapa atual
    let stageIndex = stages.findIndex((s) => s.id === progress!.currentStageId);
    if (stageIndex === -1) {
      // Se a etapa que estava salva foi deletada, volta para a primeira
      stageIndex = 0;
      progress.currentStageId = stages[0].id;
      await this.stageRepository.saveChatProgress(progress);
    }

    const currentStage = stages[stageIndex];
    const isFirstStage = stageIndex === 0;
    const isLastStage = stageIndex === stages.length - 1;
    const nextStage = !isLastStage ? stages[stageIndex + 1] : null;

    // Busca os itens reais da pasta do cofre vinculada
    const vaultItems = await this.vaultRepository.getItems(currentStage.folderId);
    const completedSet = new Set(progress.completedItemIds || []);

    const checklist: StageChecklistItem[] = vaultItems.map((item) => ({
      id: item.id,
      folderId: item.folderId,
      type: item.type,
      title: item.title,
      content: item.content,
      mediaUrl: item.mediaUrl,
      duration: item.duration,
      linkedItemId: item.linkedItemId,
      isCompleted: completedSet.has(item.id),
    }));

    const totalItems = checklist.length;
    const completedItemsCount = checklist.filter((i) => i.isCompleted).length;
    const is100Percent = totalItems > 0 && completedItemsCount === totalItems;

    return {
      conversationId,
      stage: currentStage,
      stageIndex,
      totalStages: stages.length,
      isFirstStage,
      isLastStage,
      nextStage,
      checklist,
      totalItems,
      completedItemsCount,
      is100Percent,
      isConverted: progress.isConverted || false,
      allStages: stages,
    };
  }

  async toggleItem(
    conversationId: string,
    itemId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    return this.stageRepository.toggleItemCompletion(conversationId, itemId, isCompleted);
  }

  async markItemCompletedByVaultItem(
    conversationId: string,
    vaultItemId: string
  ): Promise<ChatProgress | null> {
    const detail = await this.getChatStageDetail(conversationId);
    if (!detail.stage) return null;

    // Verifica se o item pertence ao checklist da etapa atual
    const itemInChecklist = detail.checklist.find((i) => i.id === vaultItemId);
    if (itemInChecklist && !itemInChecklist.isCompleted) {
      return this.stageRepository.toggleItemCompletion(conversationId, vaultItemId, true);
    }
    return null;
  }

  async markItemCompletedByExactText(
    conversationId: string,
    sentText: string
  ): Promise<ChatProgress | null> {
    const detail = await this.getChatStageDetail(conversationId);
    if (!detail.stage) return null;

    const trimmedSent = sentText.trim().toLowerCase();
    const isAudioMsg = sentText.startsWith("[audio:");
    const audioUrl = isAudioMsg
      ? sentText.match(/^\[audio:(https?:\/\/[^\]]+)\]/)?.[1]?.trim().toLowerCase()
      : undefined;

    const matchingItem = detail.checklist.find((item) => {
      if (isAudioMsg && item.type === "audio") {
        const itemMedia = (item.mediaUrl || "").trim().toLowerCase();
        if (audioUrl && itemMedia && (itemMedia === audioUrl || itemMedia.includes(audioUrl) || audioUrl.includes(itemMedia))) {
          return true;
        }
        if (item.content && item.content.trim().toLowerCase() === trimmedSent) return true;
        if (item.title && item.title.trim().toLowerCase() === trimmedSent) return true;
        // Se a mensagem enviada for áudio, reconcilia com o próximo áudio pendente da etapa
        if (!item.isCompleted) return true;
      }
      if (item.type === "text") {
        const itemContent = (item.content || "").trim().toLowerCase();
        const itemTitle = (item.title || "").trim().toLowerCase();
        if (itemContent && (itemContent === trimmedSent || trimmedSent.includes(itemContent) || itemContent.includes(trimmedSent))) return true;
        if (itemTitle && (itemTitle === trimmedSent || trimmedSent.includes(itemTitle) || itemTitle.includes(trimmedSent))) return true;

        // Semântica inteligente de localização / cidade (São João del Rei, matozinhos, centro, etc.)
        const isCityItem = /sao joao|sjdr|cidade|mora|onde voce mora/i.test(itemTitle + " " + itemContent);
        const mentionsCity = /sao joao|sjdr|del rei|matozinhos|centro/i.test(trimmedSent);
        if (isCityItem && mentionsCity) return true;
      }
      return false;
    });

    if (matchingItem && !matchingItem.isCompleted) {
      let result = await this.stageRepository.toggleItemCompletion(conversationId, matchingItem.id, true);

      // Resolução de item vinculado bidirecional
      const partner = detail.checklist.find(
        (other) =>
          other.id !== matchingItem.id &&
          (Boolean(matchingItem.linkedItemId && other.id === matchingItem.linkedItemId) ||
           Boolean(other.linkedItemId && other.linkedItemId === matchingItem.id))
      );
      if (partner && !partner.isCompleted) {
        const partnerContent = (partner.content || "").trim().toLowerCase();
        const partnerTitle = (partner.title || "").trim().toLowerCase();
        if (
          partnerContent && (trimmedSent.includes(partnerContent) || partnerContent.includes(trimmedSent)) ||
          partnerTitle && (trimmedSent.includes(partnerTitle) || partnerTitle.includes(trimmedSent))
        ) {
          result = await this.stageRepository.toggleItemCompletion(conversationId, partner.id, true);
        }
      }
      return result;
    }
    return null;
  }

  async advanceStage(conversationId: string): Promise<ChatProgress> {
    const detail = await this.getChatStageDetail(conversationId);
    if (!detail.stage) {
      throw new Error("Nenhuma etapa ativa encontrada.");
    }

    if (detail.isLastStage) {
      // Se já é a última etapa, marca como Convertido / Objetivo Concluído
      return this.stageRepository.markAsConverted(conversationId, true);
    }

    if (detail.nextStage) {
      return this.stageRepository.advanceStage(conversationId, detail.nextStage.id);
    }

    throw new Error("Não foi possível avançar para a próxima etapa.");
  }

  async setStage(conversationId: string, stageId: string): Promise<ChatProgress> {
    return this.stageRepository.advanceStage(conversationId, stageId);
  }

  async toggleConverted(conversationId: string, isConverted: boolean): Promise<ChatProgress> {
    return this.stageRepository.markAsConverted(conversationId, isConverted);
  }

  async getAllProgresses(): Promise<Record<string, ChatProgress>> {
    return this.stageRepository.getAllChatProgresses();
  }
}
