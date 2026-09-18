import { CartItem } from "../entities/Cart";

export interface ICartRepository {
  getCartItems(): CartItem[];
  saveCartItems(items: CartItem[]): void;
  clearCart(): void;
}
