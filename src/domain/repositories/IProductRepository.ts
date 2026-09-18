import { Product } from "../entities/Product";
import { Category } from "../entities/Category";

export interface ProductFilterParams {
  category?: string;
  search?: string;
}

export interface IProductRepository {
  getProducts(params?: ProductFilterParams): Promise<Product[]>;
  getProductById(id: string): Promise<Product | null>;
  getCategories(): Promise<Category[]>;
  createProduct(product: Omit<Product, "id" | "rating" | "reviewsCount">): Promise<Product>;
}
