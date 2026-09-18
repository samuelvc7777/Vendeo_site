import { ICartRepository } from "@/domain/repositories/ICartRepository";
import { CartItem } from "@/domain/entities/Cart";

const STORAGE_KEY = "vendeo_cart_v1";

export class LocalStorageCartRepository implements ICartRepository {
  private memoryItems: CartItem[] = [];

  getCartItems(): CartItem[] {
    if (typeof window === "undefined") {
      return this.memoryItems;
    }
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.memoryItems = JSON.parse(data);
      }
    } catch {
      // Fallback em caso de erro no parse do storage
    }
    return this.memoryItems;
  }

  saveCartItems(items: CartItem[]): void {
    this.memoryItems = items;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch {
        // Fallback para quota excedida
      }
    }
  }

  clearCart(): void {
    this.memoryItems = [];
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Fallback
      }
    }
  }
}
