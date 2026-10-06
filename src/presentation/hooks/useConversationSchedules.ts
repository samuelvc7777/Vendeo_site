"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConversationSchedule } from "@/domain/entities/ConversationSchedule";
import { SupabaseConversationScheduleRepository } from "@/infrastructure/repositories/SupabaseConversationScheduleRepository";
import { ManageConversationSchedulesUseCase } from "@/application/use-cases/ManageConversationSchedulesUseCase";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

const repository = new SupabaseConversationScheduleRepository();
const useCase = new ManageConversationSchedulesUseCase(repository);

export function useConversationSchedules() {
  const [schedules, setSchedules] = useState<ConversationSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await useCase.getSchedules();
      setSchedules(next);
      return next;
    } catch (error) {
      console.warn("[Schedules] Falha ao carregar cronogramas:", error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client
      .channel("conversation-schedules-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_schedules" }, () => void refresh())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [refresh]);

  const createSchedule = useCallback(async (
    data: Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt" | "order">
  ) => {
    try {
      const created = await useCase.createSchedule(data);
      toast.success(`Cronograma "${created.name}" criado.`);
      await refresh();
      return created;
    } catch (error: any) {
      toast.error(error?.message || "Falha ao criar cronograma.");
      throw error;
    }
  }, [refresh]);

  const updateSchedule = useCallback(async (
    id: string,
    data: Partial<Omit<ConversationSchedule, "id" | "createdAt" | "updatedAt">>
  ) => {
    try {
      const updated = await useCase.updateSchedule(id, data);
      toast.success("Cronograma atualizado.");
      await refresh();
      return updated;
    } catch (error: any) {
      toast.error(error?.message || "Falha ao atualizar cronograma.");
      throw error;
    }
  }, [refresh]);

  const deleteSchedule = useCallback(async (id: string) => {
    try {
      await useCase.deleteSchedule(id);
      toast.success("Cronograma excluído.");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao excluir cronograma.");
      throw error;
    }
  }, [refresh]);

  const moveSchedule = useCallback(async (id: string, direction: -1 | 1) => {
    await useCase.moveSchedule(id, direction);
    await refresh();
  }, [refresh]);

  const activeSchedules = useMemo(() => schedules.filter((item) => item.isActive), [schedules]);

  return { schedules, activeSchedules, isLoading, refresh, createSchedule, updateSchedule, deleteSchedule, moveSchedule };
}
