import { Product } from "./Product";

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  totalPrice: number;
  totalQuantity: number;
  freeShippingQualified: boolean;
}

export const FREE_SHIPPING_THRESHOLD = 150; // R$ 150 para frete grátis

export function calculateCart(items: CartItem[]): Cart {
  const totalPrice = items.reduce(
    (acc, item) => acc + item.product.price * item.quantity,
    0
  );
  const totalQuantity = items.reduce((acc, item) => acc + item.quantity, 0);
  const freeShippingQualified = totalPrice >= FREE_SHIPPING_THRESHOLD;

  return {
    items,
    totalPrice,
    totalQuantity,
    freeShippingQualified,
  };
}
