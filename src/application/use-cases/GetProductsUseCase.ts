import { IProductRepository, ProductFilterParams } from "@/domain/repositories/IProductRepository";
import { Product } from "@/domain/entities/Product";

export class GetProductsUseCase {
  constructor(private productRepository: IProductRepository) {}

  async execute(params?: ProductFilterParams): Promise<Product[]> {
    return this.productRepository.getProducts(params);
  }
}
