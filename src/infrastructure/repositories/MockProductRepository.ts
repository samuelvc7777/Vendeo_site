import { IProductRepository, ProductFilterParams } from "@/domain/repositories/IProductRepository";
import { Product } from "@/domain/entities/Product";
import { Category } from "@/domain/entities/Category";

const INITIAL_CATEGORIES: Category[] = [
  { id: "all", name: "Todos", icon: "Sparkles", color: "from-blue-500 to-indigo-600" },
  { id: "tech", name: "Eletrônicos", icon: "Smartphone", color: "from-purple-500 to-pink-500" },
  { id: "fashion", name: "Moda & Estilo", icon: "Shirt", color: "from-amber-500 to-orange-600" },
  { id: "home", name: "Casa & Vida", icon: "Home", color: "from-emerald-500 to-teal-600" },
  { id: "auto", name: "Automotivo", icon: "Car", color: "from-red-500 to-rose-600" },
  { id: "games", name: "Games", icon: "Gamepad2", color: "from-violet-500 to-purple-700" },
];

const INITIAL_PRODUCTS: Product[] = [
  {
    id: "prod-1",
    title: "iPhone 15 Pro Max 256GB Titânio Natural",
    price: 6890,
    originalPrice: 7999,
    category: "tech",
    image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
    rating: 4.9,
    reviewsCount: 142,
    seller: {
      id: "seller-1",
      name: "TechStore Oficial",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      verified: true,
      rating: 4.95,
    },
    location: "São Paulo, SP",
    isFeatured: true,
    stock: 8,
    description: "Aparelho impecável, estado de novo com bateria 100%, caixa e garantia ativa de 8 meses. Entrega rápida via express.",
  },
  {
    id: "prod-2",
    title: "Sony WH-1000XM5 Fone Bluetooth Cancelamento Ativo",
    price: 1850,
    originalPrice: 2299,
    category: "tech",
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
    rating: 4.8,
    reviewsCount: 89,
    seller: {
      id: "seller-2",
      name: "Áudio Premium",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
      verified: true,
      rating: 4.9,
    },
    location: "Curitiba, PR",
    isFeatured: true,
    stock: 12,
    description: "Som cristalino com cancelamento de ruído líder de mercado. Acompanha estojo original e todos os acessórios.",
  },
  {
    id: "prod-3",
    title: "Tênis Nike Air Jordan 1 High Retro Chicago (41)",
    price: 1290,
    originalPrice: 1599,
    category: "fashion",
    image: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&auto=format&fit=crop&q=80",
    rating: 5.0,
    reviewsCount: 63,
    seller: {
      id: "seller-3",
      name: "Sneakers Hub",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
      verified: true,
      rating: 4.88,
    },
    location: "Belo Horizonte, MG",
    isFeatured: false,
    stock: 3,
    description: "Edição especial colecionador, certificado de originalidade incluído. Envio imediato para todo o Brasil.",
  },
  {
    id: "prod-4",
    title: "PlayStation 5 Slim 1TB Edição Digital + 2 Jogos",
    price: 3399,
    originalPrice: 3899,
    category: "games",
    image: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&auto=format&fit=crop&q=80",
    rating: 4.9,
    reviewsCount: 210,
    seller: {
      id: "seller-4",
      name: "Nexus Games",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
      verified: true,
      rating: 4.97,
    },
    location: "Campinas, SP",
    isFeatured: true,
    stock: 5,
    description: "Console novo lacrado na caixa. Nota fiscal e 1 ano de garantia Sony Brasil.",
  },
  {
    id: "prod-5",
    title: "MacBook Air M2 13.6\" 8GB 256GB Meia-Noite",
    price: 6199,
    originalPrice: 7499,
    category: "tech",
    image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
    rating: 4.95,
    reviewsCount: 78,
    seller: {
      id: "seller-5",
      name: "Apple Store Express",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
      verified: true,
      rating: 5.0,
    },
    location: "Florianópolis, SC",
    isFeatured: false,
    stock: 4,
    description: "Leveza extrema e performance incomparável do chip M2. Apenas 15 ciclos de bateria.",
  },
  {
    id: "prod-6",
    title: "Cafeteira Espresso Automática De'Longhi Magnifica S",
    price: 2490,
    originalPrice: 2990,
    category: "home",
    image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80",
    rating: 4.7,
    reviewsCount: 45,
    seller: {
      id: "seller-6",
      name: "Café & Design",
      avatar: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&auto=format&fit=crop&q=80",
      verified: false,
      rating: 4.65,
    },
    location: "Rio de Janeiro, RJ",
    isFeatured: false,
    stock: 6,
    description: "Mói o grão na hora. Cafés cremosos com vaporizador para cappuccino perfeito.",
  },
];

export class MockProductRepository implements IProductRepository {
  private products: Product[] = [...INITIAL_PRODUCTS];
  private categories: Category[] = [...INITIAL_CATEGORIES];

  async getProducts(params?: ProductFilterParams): Promise<Product[]> {
    // Simula micro-latência de rede realista
    await new Promise((resolve) => setTimeout(resolve, 50));

    return this.products.filter((product) => {
      const matchesCategory =
        !params?.category || params.category === "all" || product.category === params.category;

      const matchesSearch =
        !params?.search ||
        product.title.toLowerCase().includes(params.search.toLowerCase()) ||
        product.description.toLowerCase().includes(params.search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }

  async getProductById(id: string): Promise<Product | null> {
    const found = this.products.find((p) => p.id === id);
    return found || null;
  }

  async getCategories(): Promise<Category[]> {
    return [...this.categories];
  }

  async createProduct(
    productData: Omit<Product, "id" | "rating" | "reviewsCount">
  ): Promise<Product> {
    const newProduct: Product = {
      ...productData,
      id: `prod-${Date.now()}`,
      rating: 5.0,
      reviewsCount: 1,
    };

    this.products.unshift(newProduct);
    return newProduct;
  }
}
