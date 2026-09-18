import { IProductRepository, ProductFilterParams } from "@/domain/repositories/IProductRepository";
import { Product } from "@/domain/entities/Product";
import { Category } from "@/domain/entities/Category";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const CATEGORY_IMAGE_MAP: Record<string, string> = {
  camisetas: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=80",
  camisas: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80",
  bermudas: "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=500&auto=format&fit=crop&q=80",
  calcas: "https://images.unsplash.com/photo-1542272604-780c96856592?w=500&auto=format&fit=crop&q=80",
};

const CATEGORY_ICON_MAP: Record<string, { icon: string; color: string }> = {
  camisetas: { icon: "Shirt", color: "bg-blue-500" },
  camisas: { icon: "Tag", color: "bg-purple-500" },
  bermudas: { icon: "Scissors", color: "bg-emerald-500" },
  calcas: { icon: "Layers", color: "bg-amber-500" },
  acessorios: { icon: "Watch", color: "bg-rose-500" },
};

export class SupabaseProductRepository implements IProductRepository {
  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  async getCategories(): Promise<Category[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error || !data || data.length === 0) {
        return [];
      }

      return (data as any[]).map((c) => {
        const iconConfig = CATEGORY_ICON_MAP[c.slug] || { icon: "Tag", color: "bg-zinc-600" };
        return {
          id: c.slug,
          name: c.name,
          icon: iconConfig.icon,
          color: iconConfig.color,
        };
      });
    } catch (err) {
      console.error("Erro ao buscar categorias no Supabase:", err);
      return [];
    }
  }

  async getProducts(params?: ProductFilterParams): Promise<Product[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      let query = client
        .from("products")
        .select(`
          *,
          product_images (*),
          categories (id, name, slug)
        `)
        .eq("is_active", true);

      if (params?.search) {
        query = query.ilike("name", `%${params.search}%`);
      }

      const { data, error } = await query;

      if (error || !data) {
        console.error("Erro na query de produtos:", error);
        return [];
      }

      const products: Product[] = (data as any[])
        .filter((row) => {
          if (!params?.category || params.category === "all") return true;
          const categorySlug = row.categories?.slug;
          return categorySlug === params.category;
        })
        .map((row) => {
          const cat = row.categories || {};
          const catSlug = cat.slug || "geral";
          const catName = cat.name || "Geral";

          const images = (row.product_images as any[]) || [];
          const mainImageObj = images.find((i) => i.is_main) || images[0];
          let imageUrl = mainImageObj?.image_url;

          if (!imageUrl || imageUrl.startsWith("product-images/")) {
            imageUrl =
              CATEGORY_IMAGE_MAP[catSlug] ||
              "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=80";
          }

          return {
            id: row.id,
            title: row.name,
            price: Number(row.price),
            originalPrice: row.promotional_price ? Number(row.promotional_price) : undefined,
            category: catName,
            image: imageUrl,
            rating: 4.9,
            reviewsCount: 18,
            seller: {
              id: "vendeo-official",
              name: "Lari Modas",
              avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
              verified: true,
              rating: 5.0,
            },
            location: "São Paulo, SP",
            isFeatured: row.is_featured,
            stock: 12,
            description: row.description || row.short_description || "",
          };
        });

      return products;
    } catch (err) {
      console.error("Erro ao buscar produtos no Supabase:", err);
      return [];
    }
  }

  async getProductById(id: string): Promise<Product | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("products")
        .select(`
          *,
          product_images (*),
          categories (id, name, slug)
        `)
        .eq("id", id)
        .single();

      if (error || !data) return null;

      const row = data as any;
      const cat = row.categories || {};
      const catSlug = cat.slug || "geral";
      const catName = cat.name || "Geral";

      const images = (row.product_images as any[]) || [];
      const mainImageObj = images.find((i: any) => i.is_main) || images[0];
      let imageUrl = mainImageObj?.image_url;

      if (!imageUrl || imageUrl.startsWith("product-images/")) {
        imageUrl =
          CATEGORY_IMAGE_MAP[catSlug] ||
          "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=80";
      }

      return {
        id: row.id,
        title: row.name,
        price: Number(row.price),
        originalPrice: row.promotional_price ? Number(row.promotional_price) : undefined,
        category: catName,
        image: imageUrl,
        rating: 4.9,
        reviewsCount: 18,
        seller: {
          id: "vendeo-official",
          name: "Lari Modas",
          avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
          verified: true,
          rating: 5.0,
        },
        location: "São Paulo, SP",
        isFeatured: row.is_featured,
        stock: 12,
        description: row.description || row.short_description || "",
      };
    } catch (err) {
      console.error("Erro ao buscar produto por ID no Supabase:", err);
      return null;
    }
  }

  async createProduct(productData: Omit<Product, "id" | "rating" | "reviewsCount">): Promise<Product> {
    const client = this.getClient();
    if (!client) {
      throw new Error("Supabase client indisponível");
    }

    const { data: newProd, error } = await client
      .from("products")
      .insert({
        name: productData.title,
        slug: productData.title.toLowerCase().replace(/\s+/g, "-"),
        description: productData.description,
        price: productData.price,
        promotional_price: productData.originalPrice || null,
        is_active: true,
        is_featured: Boolean(productData.isFeatured),
        is_new: true,
      })
      .select()
      .single();

    if (error || !newProd) {
      throw new Error(`Erro ao salvar produto no Supabase: ${error?.message}`);
    }

    if (productData.image) {
      await client.from("product_images").insert({
        product_id: (newProd as any).id,
        image_url: productData.image,
        alt_text: productData.title,
        sort_order: 0,
        is_main: true,
      });
    }

    return {
      id: (newProd as any).id,
      title: (newProd as any).name,
      price: Number((newProd as any).price),
      originalPrice: (newProd as any).promotional_price ? Number((newProd as any).promotional_price) : undefined,
      category: productData.category,
      image: productData.image,
      rating: 5.0,
      reviewsCount: 1,
      seller: productData.seller,
      location: productData.location,
      isFeatured: (newProd as any).is_featured,
      stock: productData.stock,
      description: (newProd as any).description || "",
    };
  }
}
