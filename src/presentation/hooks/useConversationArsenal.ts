"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConversationArsenalItem } from "@/domain/entities/ConversationArsenal";
import { SupabaseConversationArsenalRepository } from "@/infrastructure/repositories/SupabaseConversationArsenalRepository";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

const repository = new SupabaseConversationArsenalRepository();

export function useConversationArsenal(scheduleId?: string | null) {
  const [items, setItems] = useState<ConversationArsenalItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!scheduleId) {
      setItems([]);
      return [];
    }
    setIsLoading(true);
    try {
      const next = await repository.getItems(scheduleId);
      setItems(next);
      return next;
    } catch (error) {
      console.warn("[ConversationArsenal] Falha ao carregar:", error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    void refresh();
    const client = getSupabaseBrowserClient();
    if (!client || !scheduleId) return;
    const channel = client
      .channel(`conversation-arsenal-${scheduleId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "conversation_arsenal_items",
        filter: `schedule_id=eq.${scheduleId}`,
      }, () => void refresh())
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [scheduleId, refresh]);

  const addItem = useCallback(async (
    data: Omit<ConversationArsenalItem, "id" | "createdAt" | "updatedAt" | "scheduleId">
  ) => {
    if (!scheduleId) throw new Error("Cronograma não selecionado.");
    try {
      const created = await repository.createItem({ ...data, scheduleId });
      toast.success("Recurso adicionado ao arsenal.");
      await refresh();
      return created;
    } catch (error: any) {
      toast.error(error?.message || "Falha ao adicionar recurso.");
      throw error;
    }
  }, [scheduleId, refresh]);

  const updateItem = useCallback(async (
    id: string,
    data: Partial<Omit<ConversationArsenalItem, "id" | "scheduleId" | "createdAt" | "updatedAt">>
  ) => {
    try {
      const updated = await repository.updateItem(id, data);
      toast.success("Recurso atualizado.");
      await refresh();
      return updated;
    } catch (error: any) {
      toast.error(error?.message || "Falha ao atualizar recurso.");
      throw error;
    }
  }, [refresh]);

  const deleteItem = useCallback(async (id: string) => {
    try {
      await repository.deleteItem(id);
      toast.success("Recurso removido do arsenal.");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao remover recurso.");
      throw error;
    }
  }, [refresh]);

  const activeItems = useMemo(() => items.filter((item) => item.enabled), [items]);
  return { items, activeItems, isLoading, refresh, addItem, updateItem, deleteItem };
}
