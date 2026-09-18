"use client";

import { useState, useEffect, useCallback } from "react";
import { Product } from "@/domain/entities/Product";
import { Cart } from "@/domain/entities/Cart";
import { manageCartUseCase } from "@/infrastructure/di/container";

export function useCart() {
  const [cart, setCart] = useState<Cart>({
    items: [],
    totalPrice: 0,
    totalQuantity: 0,
    freeShippingQualified: false,
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    // Inicializa estado a partir do repositório
    setCart(manageCartUseCase.getCart());
  }, []);

  const addItem = useCallback((product: Product, quantity = 1) => {
    const updated = manageCartUseCase.addItem(product, quantity);
    setCart(updated);
  }, []);

  const updateQuantity = useCallback((productId: string, delta: number) => {
    const updated = manageCartUseCase.updateQuantity(productId, delta);
    setCart(updated);
  }, []);

  const removeItem = useCallback((productId: string) => {
    const updated = manageCartUseCase.removeItem(productId);
    setCart(updated);
  }, []);

  const checkout = useCallback(() => {
    const emptyCart = manageCartUseCase.clear();
    setCart(emptyCart);
    setIsCartOpen(false);
  }, []);

  return {
    cart,
    isCartOpen,
    setIsCartOpen,
    addItem,
    updateQuantity,
    removeItem,
    checkout,
  };
}
