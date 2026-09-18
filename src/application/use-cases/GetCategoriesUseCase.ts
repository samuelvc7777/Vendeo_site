import { IProductRepository } from "@/domain/repositories/IProductRepository";
import { Category } from "@/domain/entities/Category";

export class GetCategoriesUseCase {
  constructor(private productRepository: IProductRepository) {}

  async execute(): Promise<Category[]> {
    return this.productRepository.getCategories();
  }
}
