"use client";

import { useState, useEffect, useCallback } from "react";
import { Product } from "@/domain/entities/Product";
import { Category } from "@/domain/entities/Category";
import {
  getProductsUseCase,
  getCategoriesUseCase,
  publishProductUseCase,
} from "@/infrastructure/di/container";
import { CreateListingDTO } from "@/application/use-cases/PublishProductUseCase";

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Carrega categorias iniciais
  useEffect(() => {
    getCategoriesUseCase.execute().then(setCategories);
  }, []);

  // Busca produtos filtrados através do Caso de Uso
  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getProductsUseCase.execute({
        category: selectedCategory,
        search: searchQuery,
      });
      setProducts(data);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Publicar anúncio usando o Caso de Uso de publicação
  const publishProduct = async (dto: CreateListingDTO): Promise<Product> => {
    const created = await publishProductUseCase.execute(dto);
    await loadProducts(); // Recarrega lista
    return created;
  };

  return {
    products,
    categories,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    isLoading,
    publishProduct,
    refreshProducts: loadProducts,
  };
}
