import { IChatStageRepository } from "@/domain/repositories/IChatStageRepository";
import {
  ChatStage,
  ChatProgress,
  StageObjective,
  ConversationObjectiveProgress,
} from "@/domain/entities/ChatStage";

export interface StageObjectiveItem extends StageObjective {
  status: "pending" | "completed" | "skipped";
  value?: string | number | boolean | null;
  evidenceMessageId?: string;
  completedAt?: string;
}

export interface ChatStageDetail {
  conversationId: string;
  stage: ChatStage | null;
  stageIndex: number;
  totalStages: number;
  isFirstStage: boolean;
  isLastStage: boolean;
  nextStage: ChatStage | null;
  // Nova coleção canônica de objetivos da etapa
  objectives: StageObjectiveItem[];
  totalObjectives: number;
  completedObjectivesCount: number;
  requiredPendingCount: number;
  optionalPendingCount: number;
  // Compatibilidade legada transitória
  is100Percent: boolean;
  isConverted: boolean;
  allStages: ChatStage[];
}

export class ManageChatProgressUseCase {
  private stageRepository: IChatStageRepository;

  constructor(stageRepository: IChatStageRepository) {
    this.stageRepository = stageRepository;
  }

  async getChatStageDetail(conversationId: string): Promise<ChatStageDetail> {
    const allConfiguredStages = await this.stageRepository.getStages();
    let progress = await this.stageRepository.getChatProgress(conversationId);

    // Se não há etapas cadastradas no sistema
    if (allConfiguredStages.length === 0) {
      return {
        conversationId,
        stage: null,
        stageIndex: -1,
        totalStages: 0,
        isFirstStage: false,
        isLastStage: false,
        nextStage: null,
        objectives: [],
        totalObjectives: 0,
        completedObjectivesCount: 0,
        requiredPendingCount: 0,
        optionalPendingCount: 0,
        is100Percent: false,
        isConverted: progress?.isConverted || false,
        allStages: [],
      };
    }

    const fallbackStage =
      allConfiguredStages.find((stage) => stage.scheduleId === "schedule_sales") ||
      allConfiguredStages[0];

    // Se a conversa ainda não tem progresso salvo, inicializa fallback em memória (100% READ-ONLY)
    const effectiveProgress: ChatProgress = progress && progress.currentStageId
      ? progress
      : {
          conversationId,
          currentStageId: fallbackStage.id,
          completedGoalIds: progress?.completedGoalIds || [],
          objectiveProgress: progress?.objectiveProgress,
          isConverted: progress?.isConverted || false,
          updatedAt: progress?.updatedAt || new Date().toISOString(),
        };

    const configuredCurrentStage =
      allConfiguredStages.find((stage) => stage.id === effectiveProgress.currentStageId) ||
      fallbackStage;
    const activeScheduleId = configuredCurrentStage.scheduleId;
    const stages = allConfiguredStages
      .filter((stage) => stage.scheduleId === activeScheduleId)
      .sort((a, b) => a.order - b.order);

    // Encontra a etapa atual dentro do cronograma ativo
    let stageIndex = stages.findIndex((s) => s.id === configuredCurrentStage.id);
    if (stageIndex === -1) {
      // Se a etapa que estava salva foi deletada ou não consta na tabela chat_stages,
      // utiliza a primeira etapa como fallback estritamente em memória (SEM mutação no banco em leitura).
      stageIndex = 0;
    }

    const currentStage = stages[stageIndex];
    const isFirstStage = stageIndex === 0;
    const isLastStage = stageIndex === stages.length - 1;
    const nextStage = !isLastStage ? stages[stageIndex + 1] : null;

    // Resolução dos Objetivos Semânticos da Etapa
    const rawObjectives = (currentStage.objectives || currentStage.goals || [])
      .filter((o) => o.enabled !== false)
      .sort((a, b) => a.order - b.order);

    const completedGoalSet = new Set(effectiveProgress.completedGoalIds || []);
    const objectivesProgressMap = effectiveProgress.objectiveProgress || {};

    const objectives: StageObjectiveItem[] = rawObjectives.map((obj) => {
      const prog = objectivesProgressMap[obj.id];
      const isCompleted = completedGoalSet.has(obj.id) || prog?.status === "completed";
      return {
        ...obj,
        required: obj.required !== false,
        title: obj.title || obj.label || "Objetivo",
        status: isCompleted ? "completed" : "pending",
        value: prog?.value ?? null,
        evidenceMessageId: prog?.evidenceMessageId,
        completedAt: prog?.completedAt,
      };
    });

    const totalObjectives = objectives.length;
    const completedObjectivesCount = objectives.filter((o) => o.status === "completed").length;
    const requiredPendingCount = objectives.filter(
      (o) => o.required !== false && o.status !== "completed"
    ).length;
    const optionalPendingCount = objectives.filter(
      (o) => o.required === false && o.status !== "completed"
    ).length;

    // Objetivos opcionais não bloqueiam a etapa. Se não houver objetivo
    // obrigatório, a etapa está apta a avançar quando o Brain decidir.
    const is100Percent = totalObjectives > 0 && requiredPendingCount === 0;

    return {
      conversationId,
      stage: currentStage,
      stageIndex,
      totalStages: stages.length,
      isFirstStage,
      isLastStage,
      nextStage,
      objectives,
      totalObjectives,
      completedObjectivesCount,
      requiredPendingCount,
      optionalPendingCount,
      is100Percent,
      isConverted: effectiveProgress.isConverted || false,
      allStages: stages,
    };
  }

  async toggleObjective(
    conversationId: string,
    objectiveId: string,
    isCompleted: boolean
  ): Promise<ChatProgress> {
    if (this.stageRepository.toggleGoalCompletion) {
      return this.stageRepository.toggleGoalCompletion(conversationId, objectiveId, isCompleted);
    }
    throw new Error("Método toggleGoalCompletion não disponível no repositório.");
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

  /** Lê o progresso de uma única conversa. Usado para merge incremental após ações CRUD. */
  async getChatProgress(conversationId: string): Promise<ChatProgress | null> {
    return this.stageRepository.getChatProgress(conversationId);
  }
}
