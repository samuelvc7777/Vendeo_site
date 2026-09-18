export interface Seller {
  id: string;
  name: string;
  avatar: string;
  verified: boolean;
  rating: number;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  category: string;
  image: string;
  rating: number;
  reviewsCount: number;
  seller: Seller;
  location: string;
  isFeatured?: boolean;
  stock: number;
  description: string;
}

/**
 * Funções de domínio com regras de negócio puras
 */
export function calculateDiscount(price: number, originalPrice?: number): number {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}
