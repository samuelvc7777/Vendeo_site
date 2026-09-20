/**
 * src/presentation/hooks/useSubagents.ts
 * Hook React para Gerenciamento do Catálogo de Subagentes.
 */

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { SubagentDefinition, generateSubagentId } from "@/domain/entities/Subagent";
import { getSubagentRepository } from "@/infrastructure/repositories/SupabaseSubagentRepository";
import { toast } from "sonner";

export function useSubagents() {
  const [subagents, setSubagents] = useState<SubagentDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const repo = useMemo(() => getSubagentRepository(), []);

  const refreshSubagents = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await repo.listSubagents();
      setSubagents(list);
    } catch (err: any) {
      console.error("Erro ao carregar subagentes:", err);
      toast.error("Falha ao carregar catálogo de subagentes.");
    } finally {
      setIsLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    refreshSubagents();
    const unsubscribe = (repo as any).subscribeToChanges?.(() => {
      refreshSubagents();
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [repo, refreshSubagents]);

  const activeSubagents = useMemo(() => {
    return subagents.filter((s) => s.enabled !== false);
  }, [subagents]);

  const createSubagent = async (data: {
    name: string;
    mission: string;
    enabled?: boolean;
    description?: string;
  }) => {
    const trimmedName = data.name.trim();
    const trimmedMission = data.mission.trim();

    if (!trimmedName) {
      toast.error("O nome do subagente é obrigatório.");
      throw new Error("Nome obrigatório");
    }
    if (!trimmedMission) {
      toast.error("A missão conversacional é obrigatória.");
      throw new Error("Missão obrigatória");
    }

    const generatedId = generateSubagentId(trimmedName);
    const existing = subagents.find((s) => s.id === generatedId);
    const finalId = existing ? `${generatedId}_${Date.now().toString(36)}` : generatedId;

    const newSubagent: SubagentDefinition = {
      id: finalId,
      name: trimmedName,
      mission: trimmedMission,
      enabled: data.enabled !== false,
      isSystem: false,
      description: data.description?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const saved = await repo.saveSubagent(newSubagent);
      setSubagents((prev) => [...prev.filter((s) => s.id !== saved.id), saved]);
      toast.success(`Subagente "${saved.name}" criado com sucesso!`);
      return saved;
    } catch (err: any) {
      toast.error(`Erro ao criar subagente: ${err.message}`);
      throw err;
    }
  };

  const updateSubagent = async (id: string, updates: Partial<SubagentDefinition>) => {
    const target = subagents.find((s) => s.id === id);
    if (!target) {
      toast.error("Subagente não encontrado.");
      throw new Error("Subagente não encontrado");
    }

    const merged: SubagentDefinition = {
      ...target,
      ...updates,
      id: target.id, // ID é sempre imutável
      isSystem: target.isSystem, // isSystem é protegido
      updatedAt: new Date().toISOString(),
    };

    try {
      const saved = await repo.saveSubagent(merged);
      setSubagents((prev) => prev.map((s) => (s.id === id ? saved : s)));
      toast.success(`Subagente "${saved.name}" atualizado!`);
      return saved;
    } catch (err: any) {
      toast.error(`Erro ao atualizar subagente: ${err.message}`);
      throw err;
    }
  };

  const toggleSubagent = async (id: string, enabled: boolean) => {
    try {
      const saved = await repo.toggleSubagent(id, enabled);
      setSubagents((prev) => prev.map((s) => (s.id === id ? saved : s)));
      toast.success(`Subagente "${saved.name}" ${enabled ? "ativado" : "desativado"}.`);
      return saved;
    } catch (err: any) {
      toast.error(`Erro ao alternar status do subagente: ${err.message}`);
      throw err;
    }
  };

  const checkLinkedObjectives = async (id: string): Promise<number> => {
    return await repo.countLinkedObjectives(id);
  };

  const deleteSubagent = async (id: string) => {
    const target = subagents.find((s) => s.id === id);
    if (!target) return { success: false, error: "Subagente não encontrado" };

    if (target.isSystem) {
      toast.error("Agentes de sistema não podem ser excluídos.");
      return { success: false, error: "Agente de sistema protegido" };
    }

    const linkedCount = await repo.countLinkedObjectives(id);
    if (linkedCount > 0) {
      return {
        success: false,
        linkedCount,
        error: `Este subagente está vinculado a ${linkedCount} objetivo(s). Remova os vínculos ou desative-o primeiro.`,
      };
    }

    try {
      await repo.deleteSubagent(id);
      setSubagents((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Subagente "${target.name}" excluído.`);
      return { success: true };
    } catch (err: any) {
      toast.error(`Erro ao excluir subagente: ${err.message}`);
      return { success: false, error: err.message };
    }
  };

  return {
    subagents,
    activeSubagents,
    isLoading,
    createSubagent,
    updateSubagent,
    toggleSubagent,
    checkLinkedObjectives,
    deleteSubagent,
    refreshSubagents,
  };
}
