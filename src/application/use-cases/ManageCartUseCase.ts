import { ICartRepository } from "@/domain/repositories/ICartRepository";
import { Product } from "@/domain/entities/Product";
import { Cart, CartItem, calculateCart } from "@/domain/entities/Cart";

export class ManageCartUseCase {
  constructor(private cartRepository: ICartRepository) {}

  getCart(): Cart {
    const items = this.cartRepository.getCartItems();
    return calculateCart(items);
  }

  addItem(product: Product, quantity = 1): Cart {
    const currentItems = this.cartRepository.getCartItems();
    const existingIndex = currentItems.findIndex((item) => item.product.id === product.id);

    let updatedItems: CartItem[];
    if (existingIndex > -1) {
      updatedItems = currentItems.map((item, index) =>
        index === existingIndex
          ? { ...item, quantity: item.quantity + quantity }
          : item
      );
    } else {
      updatedItems = [...currentItems, { product, quantity }];
    }

    this.cartRepository.saveCartItems(updatedItems);
    return calculateCart(updatedItems);
  }

  updateQuantity(productId: string, delta: number): Cart {
    const currentItems = this.cartRepository.getCartItems();
    const updatedItems = currentItems
      .map((item) => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter(Boolean) as CartItem[];

    this.cartRepository.saveCartItems(updatedItems);
    return calculateCart(updatedItems);
  }

  removeItem(productId: string): Cart {
    const currentItems = this.cartRepository.getCartItems();
    const updatedItems = currentItems.filter((item) => item.product.id !== productId);
    this.cartRepository.saveCartItems(updatedItems);
    return calculateCart(updatedItems);
  }

  clear(): Cart {
    this.cartRepository.clearCart();
    return calculateCart([]);
  }
}
