"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { SupabaseChatStageRepository } from "@/infrastructure/repositories/SupabaseChatStageRepository";
import { SupabaseVaultRepository } from "@/infrastructure/repositories/SupabaseVaultRepository";
import { ManageChatStagesUseCase } from "@/application/use-cases/ManageChatStagesUseCase";
import { ManageChatProgressUseCase, ChatStageDetail } from "@/application/use-cases/ManageChatProgressUseCase";
import { ChatStage, ChatProgress } from "@/domain/entities/ChatStage";
import { toast } from "sonner";

const stageRepository = new SupabaseChatStageRepository();
const vaultRepository = new SupabaseVaultRepository();
const stagesUseCase = new ManageChatStagesUseCase(stageRepository);
const progressUseCase = new ManageChatProgressUseCase(stageRepository, vaultRepository);

export function useChatStages(activeConversationId?: string) {
  const [stages, setStages] = useState<ChatStage[]>([]);
  const [allProgresses, setAllProgresses] = useState<Record<string, ChatProgress>>({});
  const [chatDetail, setChatDetail] = useState<ChatStageDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStages = useCallback(async () => {
    try {
      const data = await stagesUseCase.getStages();
      setStages(data);
      return data;
    } catch (e) {
      console.warn("Erro ao buscar etapas:", e);
      return [];
    }
  }, []);

  const fetchAllProgresses = useCallback(async () => {
    try {
      const data = await progressUseCase.getAllProgresses();
      setAllProgresses(data);
      return data;
    } catch (e) {
      console.warn("Erro ao buscar progressos:", e);
      return {};
    }
  }, []);

  const fetchChatDetail = useCallback(async (convId: string) => {
    try {
      const detail = await progressUseCase.getChatStageDetail(convId);
      setChatDetail(detail);
      return detail;
    } catch (e) {
      console.warn("Erro ao buscar detalhes da etapa do chat:", e);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchStages();
      await fetchAllProgresses();
      if (activeConversationId) {
        await fetchChatDetail(activeConversationId);
      }
    } finally {
      setIsLoading(false);
    }
  }, [fetchStages, fetchAllProgresses, fetchChatDetail, activeConversationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeConversationId) {
      fetchChatDetail(activeConversationId);
    } else {
      setChatDetail(null);
    }
  }, [activeConversationId, fetchChatDetail]);

  // Ações de Gestão de Etapas
  const createStage = async (data: {
    name: string;
    folderId: string;
    color?: string;
    icon?: string;
    description?: string;
  }) => {
    try {
      const created = await stagesUseCase.createStage(data);
      toast.success(`Etapa "${created.name}" criada com sucesso!`);
      await refresh();
      return created;
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar etapa.");
      throw err;
    }
  };

  const updateStage = async (
    id: string,
    data: {
      name?: string;
      folderId?: string;
      color?: string;
      icon?: string;
      description?: string;
    }
  ) => {
    try {
      const updated = await stagesUseCase.updateStage(id, data);
      toast.success("Etapa atualizada com sucesso!");
      await refresh();
      return updated;
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar etapa.");
      throw err;
    }
  };

  const deleteStage = async (id: string) => {
    try {
      await stagesUseCase.deleteStage(id);
      toast.success("Etapa excluída.");
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir etapa.");
      throw err;
    }
  };

  const moveStageUp = async (id: string) => {
    try {
      const updated = await stagesUseCase.moveStageUp(id);
      setStages(updated);
      await fetchAllProgresses();
      if (activeConversationId) await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error(err.message || "Erro ao reordenar etapa.");
    }
  };

  const moveStageDown = async (id: string) => {
    try {
      const updated = await stagesUseCase.moveStageDown(id);
      setStages(updated);
      await fetchAllProgresses();
      if (activeConversationId) await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error(err.message || "Erro ao reordenar etapa.");
    }
  };

  // Ações de Objetivos da Conversa (Goals)
  const addGoal = async (
    stageId: string,
    data: {
      label: string;
      memoryEntity?: string;
      memoryField: string;
      description?: string;
      required?: boolean;
      enabled?: boolean;
    }
  ) => {
    try {
      const created = await stagesUseCase.addGoal(stageId, data);
      toast.success(`Objetivo "${created.label}" adicionado à etapa!`);
      await refresh();
      return created;
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar objetivo.");
      throw err;
    }
  };

  const updateGoal = async (
    stageId: string,
    goalId: string,
    updates: Partial<import("@/domain/entities/ChatStage").ConversationGoal>
  ) => {
    try {
      await stagesUseCase.updateGoal(stageId, goalId, updates);
      toast.success("Objetivo atualizado com sucesso!");
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar objetivo.");
      throw err;
    }
  };

  const deleteGoal = async (stageId: string, goalId: string) => {
    try {
      await stagesUseCase.deleteGoal(stageId, goalId);
      toast.success("Objetivo excluído.");
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir objetivo.");
      throw err;
    }
  };

  const moveGoalUp = async (stageId: string, goalId: string) => {
    try {
      await stagesUseCase.moveGoalUp(stageId, goalId);
      await fetchStages();
    } catch (err: any) {
      toast.error(err.message || "Erro ao reordenar objetivo.");
    }
  };

  const moveGoalDown = async (stageId: string, goalId: string) => {
    try {
      await stagesUseCase.moveGoalDown(stageId, goalId);
      await fetchStages();
    } catch (err: any) {
      toast.error(err.message || "Erro ao reordenar objetivo.");
    }
  };

  // Ações na Conversa Ativa
  const toggleItem = async (itemId: string, isCompleted: boolean) => {
    if (!activeConversationId) return;
    try {
      // Otimista na UI
      if (chatDetail) {
        setChatDetail((prev) => {
          if (!prev) return prev;
          const newChecklist = prev.checklist.map((item) =>
            item.id === itemId ? { ...item, isCompleted } : item
          );
          const totalItems = newChecklist.length;
          const completedCount = newChecklist.filter((i) => i.isCompleted).length;
          return {
            ...prev,
            checklist: newChecklist,
            completedItemsCount: completedCount,
            is100Percent: totalItems > 0 && completedCount === totalItems,
          };
        });
      }

      await progressUseCase.toggleItem(activeConversationId, itemId, isCompleted);
      await fetchAllProgresses();
      await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error("Erro ao atualizar item do checklist.");
      if (activeConversationId) await fetchChatDetail(activeConversationId);
    }
  };

  const advanceStage = async () => {
    if (!activeConversationId) return;
    try {
      await progressUseCase.advanceStage(activeConversationId);
      toast.success("Avançado para a próxima etapa com sucesso!");
      await fetchAllProgresses();
      await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error(err.message || "Erro ao avançar etapa.");
    }
  };

  const setStage = async (stageId: string) => {
    if (!activeConversationId) return;
    try {
      await progressUseCase.setStage(activeConversationId, stageId);
      toast.success("Etapa da conversa alterada.");
      await fetchAllProgresses();
      await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar etapa.");
    }
  };

  const toggleConverted = async (isConverted: boolean) => {
    if (!activeConversationId) return;
    try {
      await progressUseCase.toggleConverted(activeConversationId, isConverted);
      toast.success(
        isConverted ? "🎉 Conversa marcada como Convertida / Objetivo Concluído!" : "Status de conversão removido."
      );
      await fetchAllProgresses();
      await fetchChatDetail(activeConversationId);
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar status de conversão.");
    }
  };

  const markItemCompletedByVaultItem = async (vaultItemId: string) => {
    if (!activeConversationId) return;
    try {
      const res = await progressUseCase.markItemCompletedByVaultItem(activeConversationId, vaultItemId);
      if (res) {
        await fetchAllProgresses();
        await fetchChatDetail(activeConversationId);
      }
    } catch (e) {
      console.warn("Erro ao marcar item por envio de ativo:", e);
    }
  };

  const markItemCompletedByExactText = async (sentText: string) => {
    if (!activeConversationId) return;
    try {
      const res = await progressUseCase.markItemCompletedByExactText(activeConversationId, sentText);
      if (res) {
        await fetchAllProgresses();
        await fetchChatDetail(activeConversationId);
      }
    } catch (e) {
      console.warn("Erro ao marcar item por texto exato:", e);
    }
  };

  return {
    stages,
    allProgresses,
    chatDetail,
    isLoading,
    refresh,
    createStage,
    updateStage,
    deleteStage,
    moveStageUp,
    moveStageDown,
    addGoal,
    updateGoal,
    deleteGoal,
    moveGoalUp,
    moveGoalDown,
    toggleItem,
    advanceStage,
    setStage,
    toggleConverted,
    markItemCompletedByVaultItem,
    markItemCompletedByExactText,
  };
}
