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
