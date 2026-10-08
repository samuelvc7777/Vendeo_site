"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Raffle,
  RaffleTicket,
  RaffleStats,
  RaffleBuyer,
  calculateRaffleStats,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import { CreateRaffleInput } from "@/domain/repositories/IRaffleRepository";
import { manageRaffleUseCase } from "@/infrastructure/di/container";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { resolveWhatsApp2PhoneNumbers } from "@/presentation/components/chat/whatsapp2-client";
import { toast } from "sonner";

export function useRaffles() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [activeRaffleId, setActiveRaffleId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<RaffleTicket[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Contatos reais do WhatsApp para vincular compradores pelo nome + telefone.
  // O seletor legado de Instagram continua no código, mas não é mais alimentado/renderizado.
  const [whatsappContacts, setWhatsAppContacts] = useState<RaffleBuyer[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState<boolean>(false);

  // Rifa ativa selecionada
  const activeRaffle = useMemo(() => {
    if (!activeRaffleId) return raffles[0] || null;
    return raffles.find((r) => r.id === activeRaffleId) || raffles[0] || null;
  }, [raffles, activeRaffleId]);

  // Estatísticas calculadas em tempo real
  const stats: RaffleStats = useMemo(() => {
    if (!activeRaffle) {
      return {
        total: 0,
        available: 0,
        reserved: 0,
        paid: 0,
        percentSold: 0,
        totalRevenue: 0,
        potentialRevenue: 0,
      };
    }
    return calculateRaffleStats(activeRaffle, tickets);
  }, [activeRaffle, tickets]);

  // Mapa rápido de status por número para performance máxima de renderização
  const ticketsMap = useMemo(() => {
    const map = new Map<number, RaffleTicket>();
    for (const ticket of tickets) {
      map.set(ticket.number, ticket);
    }
    return map;
  }, [tickets]);

  // Carrega rifas do repositório
  const loadRaffles = useCallback(
    async (isSilent = false) => {
      try {
        if (!isSilent) setIsLoading(true);
        setError(null);
        const list = await manageRaffleUseCase.getRaffles();
        setRaffles(list);

        if (list.length > 0) {
          const targetId =
            activeRaffleId && list.some((r) => r.id === activeRaffleId)
              ? activeRaffleId
              : list[0].id;

          if (targetId !== activeRaffleId) {
            setActiveRaffleId(targetId);
          }

          const details = await manageRaffleUseCase.getRaffleWithDetails(targetId);
          if (details) {
            setTickets(details.tickets);
          }
        }
      } catch (err: any) {
        console.error("Erro ao carregar rifas:", err);
        if (!isSilent) setError(err?.message || "Não foi possível carregar as rifas.");
      } finally {
        if (!isSilent) setIsLoading(false);
      }
    },
    [activeRaffleId]
  );

  // Carrega bilhetes quando troca a rifa ativa
  const selectRaffle = useCallback(async (id: string) => {
    setActiveRaffleId(id);
    setSelectedNumbers([]);
    try {
      const details = await manageRaffleUseCase.getRaffleWithDetails(id);
      if (details) {
        setTickets(details.tickets);
      }
    } catch (err: any) {
      console.error("Erro ao trocar rifa ativa:", err);
    }
  }, []);

  // Carrega conversas do WhatsApp do Supabase e resolve @lid -> telefone real
  // em uma única chamada ao gateway. IDs internos nunca são exibidos como telefone.
  const loadWhatsAppContacts = useCallback(async () => {
    try {
      setIsLoadingContacts(true);
      const client = getSupabaseBrowserClient();
      if (!client) {
        setWhatsAppContacts([]);
        return;
      }

      const pageSize = 500;
      const allConversations: any[] = [];

      for (let from = 0; ; from += pageSize) {
        const { data, error: conversationsError } = await client
          .from("instagram_conversations")
          .select("id, contact_id, full_name, display_name, avatar, avatar_url, last_message_at, status, is_converted, workflow_finalized_at")
          .like("id", "wa2:%")
          .eq("is_converted", true)
          .not("workflow_finalized_at", "is", null)
          .neq("status", "locked")
          .neq("status", "archived")
          .neq("status", "system")
          .neq("status", "vault")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .range(from, from + pageSize - 1);

        if (conversationsError) throw conversationsError;

        const page = Array.isArray(data) ? data : [];
        allConversations.push(...page);

        if (page.length < pageSize) break;
      }

      const rows = allConversations
        .filter((row: any) => {
          const id = String(row?.id || "");
          const providerId = String(row?.contact_id || id.replace(/^wa2:(?:account-[^:]+:)?/i, ""));
          return (
            id.startsWith("wa2:") &&
            providerId &&
            !providerId.endsWith("@g.us") &&
            providerId !== "status@broadcast"
          );
        });

      if (rows.length === 0) {
        setWhatsAppContacts([]);
        return;
      }

      const providerIds = rows.map((row: any) =>
        String(row.contact_id || row.id.replace(/^wa2:(?:account-[^:]+:)?/i, "")).trim()
      );
      const resolved = await resolveWhatsApp2PhoneNumbers(providerIds);
      const identityByProviderId = new Map(
        (resolved.contacts || []).map((item) => [item.chatId, item])
      );

      const contacts = new Map<string, RaffleBuyer>();
      for (const row of rows) {
        const providerId = String(
          row.contact_id || String(row.id || "").replace(/^wa2:(?:account-[^:]+:)?/i, "")
        ).trim();
        const identity = identityByProviderId.get(providerId);
        const phone = identity?.phoneNumber
          ? String(identity.phoneNumber)
          : undefined;
        const conversationId = String(row.id);
        const dedupeKey = phone ? `phone:${phone}` : `conversation:${conversationId}`;
        if (contacts.has(dedupeKey)) continue;

        const rawName = String(
          identity?.savedName ||
          row.full_name ||
          row.display_name ||
          ""
        ).trim();
        const internalLikeName =
          !rawName ||
          rawName === providerId ||
          rawName.endsWith("@lid") ||
          rawName.endsWith("@c.us") ||
          /^\+?[\d\s().-]{8,}$/.test(rawName);

        contacts.set(dedupeKey, {
          name: internalLikeName ? "Contato WhatsApp" : rawName,
          phone: phone || undefined,
          avatar: row.avatar_url || row.avatar || undefined,
          conversationId,
        });
      }

      setWhatsAppContacts(Array.from(contacts.values()));
    } catch (err) {
      console.warn("Erro ao buscar contatos do WhatsApp para rifa:", err);
      setWhatsAppContacts([]);
    } finally {
      setIsLoadingContacts(false);
    }
  }, []);

  // Carregamento inicial e sincronização em tempo real (Supabase Realtime)
  useEffect(() => {
    loadRaffles(false);
    loadWhatsAppContacts();

    const client = getSupabaseBrowserClient();
    if (!client) return;

    // Escuta em tempo real qualquer alteração feita em qualquer outro celular / navegador
    const channel = client
      .channel("vendeo_raffles_cloud_sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_conversations",
          filter: "id=eq.__raffle_data__",
        },
        () => {
          // Atualiza em tempo real de forma silenciosa sem recarregar a tela
          loadRaffles(true);
        }
      )
      .subscribe();

    // Polling de contingência a cada 8 segundos caso a rede do celular oscile
    const interval = setInterval(() => {
      loadRaffles(true);
    }, 8000);

    return () => {
      try {
        client.removeChannel(channel);
      } catch {}
      clearInterval(interval);
    };
  }, [loadRaffles, loadWhatsAppContacts]);

  // Alterna seleção de um número na grade
  const toggleNumberSelection = useCallback(
    (num: number) => {
      const ticket = ticketsMap.get(num);
      // Se já está pago, não permite selecionar para nova compra (já está liquidado)
      if (ticket && ticket.status === "paid") return;

      setSelectedNumbers((prev) => {
        if (prev.includes(num)) {
          return prev.filter((n) => n !== num);
        }
        return [...prev, num].sort((a, b) => a - b);
      });
    },
    [ticketsMap]
  );

  // Limpa seleção atual
  const clearSelection = useCallback(() => {
    setSelectedNumbers([]);
  }, []);

  // Seleciona X números aleatórios disponíveis
  const selectRandomNumbers = useCallback(
    (count: number) => {
      if (!activeRaffle) return;
      const total = activeRaffle.totalNumbers;
      const availableNumbers: number[] = [];

      for (let i = 1; i <= total; i++) {
        const ticket = ticketsMap.get(i);
        const isFree = !ticket || ticket.status === "available";
        if (isFree && !selectedNumbers.includes(i)) {
          availableNumbers.push(i);
        }
      }

      // Embaralha
      const shuffled = [...availableNumbers].sort(() => 0.5 - Math.random());
      const picked = shuffled.slice(0, count);

      setSelectedNumbers((prev) => [...prev, ...picked].sort((a, b) => a - b));
    },
    [activeRaffle, ticketsMap, selectedNumbers]
  );

  // Seleciona múltiplos números específicos (ex: [5, 12, 28])
  const selectMultipleNumbers = useCallback(
    (numbers: number[]) => {
      setSelectedNumbers((prev) => {
        const set = new Set(prev);
        for (const n of numbers) {
          const ticket = ticketsMap.get(n);
          if (!ticket || ticket.status !== "paid") {
            set.add(n);
          }
        }
        return Array.from(set).sort((a, b) => a - b);
      });
    },
    [ticketsMap]
  );

  // Seleciona N números sequenciais livres a partir do primeiro disponível
  const selectSequentialNumbers = useCallback(
    (count: number) => {
      if (!activeRaffle) return;
      const total = activeRaffle.totalNumbers;
      const picked: number[] = [];

      for (let i = 1; i <= total; i++) {
        const ticket = ticketsMap.get(i);
        const isFree = !ticket || ticket.status === "available";
        if (isFree && !selectedNumbers.includes(i)) {
          picked.push(i);
          if (picked.length >= count) break;
        }
      }

      setSelectedNumbers((prev) => [...prev, ...picked].sort((a, b) => a - b));
    },
    [activeRaffle, ticketsMap, selectedNumbers]
  );

  // Remove um número específico da seleção
  const removeSelectedNumber = useCallback((num: number) => {
    setSelectedNumbers((prev) => prev.filter((n) => n !== num));
  }, []);

  // Cria uma nova rifa
  const createRaffle = useCallback(
    async (input: CreateRaffleInput) => {
      try {
        setIsSubmitting(true);
        const created = await manageRaffleUseCase.createRaffle(input);
        setRaffles((prev) => [created, ...prev]);
        setActiveRaffleId(created.id);
        setTickets([]);
        setSelectedNumbers([]);
        return created;
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao criar rifa.");
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  // Registra compra ou reserva dos números selecionados
  const purchaseSelected = useCallback(
    async (params: {
      buyer: RaffleBuyer;
      status: "reserved" | "paid";
      notes?: string;
    }) => {
      if (!activeRaffle || selectedNumbers.length === 0) return;

      try {
        setIsSubmitting(true);
        const result = await manageRaffleUseCase.purchaseOrReserveTickets({
          raffleId: activeRaffle.id,
          numbers: selectedNumbers,
          buyer: params.buyer,
          status: params.status,
          notes: params.notes,
        });

        // Uma compra paga vinculada a uma conversa do WhatsApp também fecha o funil comercial.
        // Reserva não conta como compra para não inflar a conversão do relatório.
        if (params.status === "paid" && params.buyer.conversationId) {
          try {
            const syncResponse = await brainOperatorFetch("/operator/chat-progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: "raffle_purchase_confirmed",
                conversationId: params.buyer.conversationId,
              }),
            });
            const syncResult = await syncResponse.json().catch(() => ({}));
            if (!syncResponse.ok || syncResult?.success !== true) {
              throw new Error(syncResult?.error || "Falha ao sincronizar o status comercial.");
            }
          } catch (syncError) {
            console.warn("[Raffle] Compra paga salva, mas status do chat não sincronizou.", syncError);
            toast.warning("Compra salva, mas o status do chat não foi atualizado automaticamente.");
          }
        }

        // Atualiza a lista local de tickets
        const updatedNumbersMap = new Map<number, RaffleTicket>();
        for (const t of result.tickets) {
          updatedNumbersMap.set(t.number, t);
        }

        setTickets((prev) => {
          const next = prev.filter((t) => !updatedNumbersMap.has(t.number));
          return [...next, ...result.tickets];
        });

        setSelectedNumbers([]);
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao processar compra de cotas.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeRaffle, selectedNumbers]
  );

  // Libera cotas que estavam reservadas ou pagas
  const releaseNumbers = useCallback(
    async (numbers: number[]) => {
      if (!activeRaffle || numbers.length === 0) return;
      try {
        setIsSubmitting(true);
        await manageRaffleUseCase.releaseTickets(activeRaffle.id, numbers);
        const numSet = new Set(numbers);
        setTickets((prev) => prev.filter((t) => !numSet.has(t.number)));
        setSelectedNumbers((prev) => prev.filter((n) => !numSet.has(n)));
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao liberar cotas.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeRaffle]
  );

  // Atualiza dados de uma rifa
  const updateRaffle = useCallback(
    async (id: string, updates: Partial<Raffle>) => {
      try {
        setIsSubmitting(true);
        const updated = await manageRaffleUseCase.updateRaffle(id, updates);
        setRaffles((prev) => prev.map((r) => (r.id === id ? updated : r)));
        return updated;
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao atualizar rifa.");
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  // Exclui uma rifa
  const deleteRaffle = useCallback(
    async (id: string) => {
      try {
        setIsSubmitting(true);
        await manageRaffleUseCase.deleteRaffle(id);
        const nextRaffles = raffles.filter((r) => r.id !== id);
        setRaffles(nextRaffles);
        if (activeRaffleId === id) {
          const nextActiveId = nextRaffles.length > 0 ? nextRaffles[0].id : null;
          setActiveRaffleId(nextActiveId);
          if (nextActiveId) {
            const details = await manageRaffleUseCase.getRaffleWithDetails(nextActiveId);
            setTickets(details?.tickets || []);
          } else {
            setTickets([]);
          }
          setSelectedNumbers([]);
        }
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao excluir rifa.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeRaffleId, raffles]
  );

  return {
    raffles,
    activeRaffle,
    activeRaffleId,
    tickets,
    ticketsMap,
    stats,
    selectedNumbers,
    isLoading,
    isSubmitting,
    error,
    whatsappContacts,
    isLoadingContacts,
    loadRaffles,
    selectRaffle,
    toggleNumberSelection,
    clearSelection,
    selectRandomNumbers,
    selectMultipleNumbers,
    selectSequentialNumbers,
    removeSelectedNumber,
    createRaffle,
    updateRaffle,
    purchaseSelected,
    releaseNumbers,
    deleteRaffle,
  };
}
