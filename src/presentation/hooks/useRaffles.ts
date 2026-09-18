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
import { InstagramConversation } from "@/domain/entities/Instagram";
import { getApiUrl } from "@/infrastructure/http/network";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export function useRaffles() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [activeRaffleId, setActiveRaffleId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<RaffleTicket[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de conversas do Instagram para busca rápida
  const [instagramConversations, setInstagramConversations] = useState<
    InstagramConversation[]
  >([]);
  const [isLoadingConversations, setIsLoadingConversations] =
    useState<boolean>(false);

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

  // Busca conversas do Instagram para autocompletar na vinculação de clientes
  const loadInstagramConversations = useCallback(async () => {
    try {
      setIsLoadingConversations(true);
      let list: InstagramConversation[] = [];

      // 1. Tenta carregar do Supabase direto
      const client = getSupabaseBrowserClient();
      if (client) {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("*")
          .neq("id", "__vault_data__")
          .neq("status", "vault")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(300);

        if (!error && data && data.length > 0) {
          list = data
            .filter(
              (c: any) =>
                !c.id?.startsWith("__") &&
                c.status !== "system" &&
                c.status !== "vault"
            )
            .map((c: any) => ({
              id: c.id,
              username: c.username?.startsWith("ig_")
                ? "instagram_user"
                : c.username || "",
              fullName: c.full_name || undefined,
              avatar: c.avatar || undefined,
              lastMessage: c.last_message || undefined,
              lastMessageAt: c.last_message_at || undefined,
              lastDirection: c.last_direction || "in",
              unread: Boolean(c.unread),
              status: c.status || "active",
              isRestricted: Boolean(c.is_restricted),
            }));
        }
      }

      // 2. Fallback via API se lista estiver vazia
      if (list.length === 0) {
        const res = await fetch(getApiUrl("/api/instagram/conversations"));
        if (res.ok) {
          const data = await res.json();
          const raw = Array.isArray(data)
            ? data
            : data.conversations || [];

          list = raw.map((c: any) => ({
            id: c.id,
            username: c.username || "",
            fullName: c.fullName || c.full_name || undefined,
            avatar: c.avatar || undefined,
            lastMessage: c.lastMessage || c.last_message || undefined,
            lastMessageAt: c.lastMessageAt || c.last_message_at || undefined,
            lastDirection: c.lastDirection || c.last_direction || "in",
            unread: Boolean(c.unread),
            status: c.status || "active",
          }));
        }
      }

      if (list.length > 0) {
        setInstagramConversations(list);
      }
    } catch (err) {
      console.warn("Erro ao buscar conversas do Instagram para rifa:", err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  // Carregamento inicial e sincronização em tempo real (Supabase Realtime)
  useEffect(() => {
    loadRaffles(false);
    loadInstagramConversations();

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
  }, [loadRaffles, loadInstagramConversations]);

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
    instagramConversations,
    isLoadingConversations,
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
