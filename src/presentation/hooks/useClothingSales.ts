"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClothingSale,
  ClothingSaleStats,
  calculateClothingStats,
} from "@/domain/entities/ClothingSale";
import { CreateClothingSaleInput } from "@/domain/repositories/IClothingSaleRepository";
import { manageClothingSaleUseCase } from "@/infrastructure/di/container";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export type ClothingFilterType =
  | "all"
  | "in_stock"
  | "out_of_stock"
  | "shipping_pending"
  | "shipping_paid";

export function useClothingSales() {
  const [sales, setSales] = useState<ClothingSale[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterType, setFilterType] = useState<ClothingFilterType>("all");

  // Carrega vendas do caso de uso
  const loadSales = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setIsLoading(true);
      setError(null);
      const list = await manageClothingSaleUseCase.getSales();
      setSales(list);
    } catch (err: any) {
      console.error("Erro ao carregar vendas de roupas:", err);
      if (!isSilent) setError(err?.message || "Não foi possível carregar as vendas.");
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  // Inscrição Supabase Realtime para sincronização automática entre múltiplos celulares
  useEffect(() => {
    loadSales(false);

    const client = getSupabaseBrowserClient();
    if (!client) return;

    const channel = client
      .channel("vendeo_clothing_sales_cloud_sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_conversations",
          filter: "id=eq.__clothing_sales_data__",
        },
        () => {
          loadSales(true);
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      loadSales(true);
    }, 8000);

    return () => {
      try {
        client.removeChannel(channel);
      } catch {}
      clearInterval(interval);
    };
  }, [loadSales]);

  // Estatísticas calculadas dinamicamente
  const stats: ClothingSaleStats = useMemo(() => {
    return calculateClothingStats(sales);
  }, [sales]);

  // Vendas filtradas por busca e tipo
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      // Filtro de status/tipo
      if (filterType === "in_stock" && !sale.inStock) return false;
      if (filterType === "out_of_stock" && sale.inStock) return false;
      if (filterType === "shipping_pending" && sale.shippingPaid) return false;
      if (filterType === "shipping_paid" && !sale.shippingPaid) return false;

      // Filtro de busca
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const cleanQDigits = q.replace(/\D/g, "");
        const nameMatch = sale.customerName.toLowerCase().includes(q);
        const cpfMatch = cleanQDigits && (sale.customerCpf || "").includes(cleanQDigits);
        const phoneMatch =
          cleanQDigits &&
          (sale.customerPhone || "").replace(/\D/g, "").includes(cleanQDigits);
        const productMatch = sale.productDescription.toLowerCase().includes(q);
        const cityMatch = (sale.address.city || "").toLowerCase().includes(q);
        const instaMatch = (sale.instagramBuyer || "").toLowerCase().includes(q);

        if (!nameMatch && !cpfMatch && !phoneMatch && !productMatch && !cityMatch && !instaMatch) {
          return false;
        }
      }

      return true;
    });
  }, [sales, filterType, searchQuery]);

  // Cria uma nova venda
  const createSale = useCallback(async (input: CreateClothingSaleInput) => {
    try {
      setIsSubmitting(true);
      const created = await manageClothingSaleUseCase.createSale(input);
      setSales((prev) => [created, ...prev]);
      return created;
    } catch (err: any) {
      throw new Error(err?.message || "Erro ao registrar venda de roupas.");
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // Atualiza uma venda existente
  const updateSale = useCallback(
    async (id: string, updates: Partial<ClothingSale>) => {
      try {
        setIsSubmitting(true);
        const updated = await manageClothingSaleUseCase.updateSale(id, updates);
        setSales((prev) => prev.map((s) => (s.id === id ? updated : s)));
        return updated;
      } catch (err: any) {
        throw new Error(err?.message || "Erro ao atualizar venda.");
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  // Exclui uma venda
  const deleteSale = useCallback(async (id: string) => {
    try {
      setIsSubmitting(true);
      await manageClothingSaleUseCase.deleteSale(id);
      setSales((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      throw new Error(err?.message || "Erro ao excluir venda.");
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    sales,
    filteredSales,
    stats,
    isLoading,
    isSubmitting,
    error,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    loadSales,
    createSale,
    updateSale,
    deleteSale,
  };
}
