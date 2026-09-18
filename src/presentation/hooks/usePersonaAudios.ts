"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PersonaAudioAsset, AudioDeliveryHistory } from "@/domain/entities/ChatStage";
import { SupabasePersonaAudioRepository } from "@/infrastructure/repositories/SupabasePersonaAudioRepository";
import { ManagePersonaAudiosUseCase } from "@/application/use-cases/ManagePersonaAudiosUseCase";
import { toast } from "sonner";

export function usePersonaAudios(stageId?: string) {
  const [audios, setAudios] = useState<PersonaAudioAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const repository = useMemo(() => new SupabasePersonaAudioRepository(), []);
  const useCase = useMemo(() => new ManagePersonaAudiosUseCase(repository), [repository]);

  const loadAudios = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await useCase.getAudios(stageId);
      setAudios(data);
    } catch (err: any) {
      console.error("Erro ao carregar áudios da persona:", err);
      toast.error("Não foi possível carregar os áudios.");
    } finally {
      setIsLoading(false);
    }
  }, [useCase, stageId]);

  useEffect(() => {
    loadAudios();
  }, [loadAudios]);

  const addAudio = async (data: Omit<PersonaAudioAsset, "id" | "createdAt" | "updatedAt">) => {
    try {
      const created = await useCase.saveAudio(data);
      setAudios((prev) => [created, ...prev]);
      toast.success("Áudio salvo com sucesso!");
      return created;
    } catch (err: any) {
      toast.error("Erro ao salvar áudio: " + (err?.message || "Tente novamente"));
      throw err;
    }
  };

  const updateAudio = async (id: string, updates: Partial<PersonaAudioAsset>) => {
    try {
      const updated = await useCase.updateAudio(id, updates);
      setAudios((prev) => prev.map((a) => (a.id === id ? updated : a)));
      toast.success("Áudio atualizado!");
      return updated;
    } catch (err: any) {
      toast.error("Erro ao atualizar áudio.");
      throw err;
    }
  };

  const deleteAudio = async (id: string) => {
    try {
      await useCase.deleteAudio(id);
      setAudios((prev) => prev.filter((a) => a.id !== id));
      toast.success("Áudio excluído.");
    } catch (err: any) {
      toast.error("Erro ao excluir áudio.");
      throw err;
    }
  };

  const toggleAudioEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      const updated = await useCase.toggleAudioEnabled(id, currentEnabled);
      setAudios((prev) => prev.map((a) => (a.id === id ? updated : a)));
      toast.success(updated.enabled ? "Áudio ativado!" : "Áudio desativado.");
      return updated;
    } catch (err: any) {
      toast.error("Erro ao alterar estado do áudio.");
      throw err;
    }
  };

  const getDeliveryHistory = async (conversationId: string): Promise<AudioDeliveryHistory[]> => {
    return useCase.getDeliveryHistory(conversationId);
  };

  const recordDelivery = async (conversationId: string, audioId: string, providerMessageId?: string) => {
    return useCase.recordDelivery(conversationId, audioId, providerMessageId);
  };

  return {
    audios,
    isLoading,
    refreshAudios: loadAudios,
    addAudio,
    updateAudio,
    deleteAudio,
    toggleAudioEnabled,
    getDeliveryHistory,
    recordDelivery,
  };
}

