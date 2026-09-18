import { IProductRepository } from "@/domain/repositories/IProductRepository";
import { Product } from "@/domain/entities/Product";

export interface CreateListingDTO {
  title: string;
  price: number;
  category: string;
  description?: string;
  location?: string;
  image?: string;
}

export class PublishProductUseCase {
  constructor(private productRepository: IProductRepository) {}

  async execute(dto: CreateListingDTO): Promise<Product> {
    if (!dto.title || dto.title.trim().length < 3) {
      throw new Error("O título do produto deve ter pelo menos 3 caracteres.");
    }
    if (dto.price <= 0) {
      throw new Error("O preço do produto deve ser maior que zero.");
    }

    const newProduct = {
      title: dto.title.trim(),
      price: dto.price,
      category: dto.category,
      image:
        dto.image ||
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
      description: dto.description || "Produto anunciado através do aplicativo Vendeo.",
      location: dto.location || "São Paulo, SP",
      seller: {
        id: "user-current",
        name: "Samuel Vitor (Você)",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
        verified: true,
        rating: 5.0,
      },
      stock: 1,
      isFeatured: false,
    };

    return this.productRepository.createProduct(newProduct);
  }
}
