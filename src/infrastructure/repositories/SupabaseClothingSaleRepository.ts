import { ClothingSale } from "@/domain/entities/ClothingSale";
import {
  CreateClothingSaleInput,
  IClothingSaleRepository,
} from "@/domain/repositories/IClothingSaleRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const STORAGE_SALES_KEY = "vendeo_clothing_sales_v1";
const SUPABASE_SALES_DOCUMENT_ID = "__clothing_sales_data__";

interface StoredClothingSalesCloudPayload {
  sales: ClothingSale[];
  updated_at: string;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sale_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class SupabaseClothingSaleRepository implements IClothingSaleRepository {
  private inMemorySales: ClothingSale[] | null = null;
  private lastFetchTime = 0;
  private cacheDurationMs = 1500;

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  // ==========================================
  // CACHE LOCAL (FALLBACK OFFLINE)
  // ==========================================
  private getLocalSales(): ClothingSale[] {
    if (typeof window === "undefined") return [];
    try {
      const data = localStorage.getItem(STORAGE_SALES_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private saveLocalSales(sales: ClothingSale[]): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_SALES_KEY, JSON.stringify(sales));
    } catch (e) {
      console.warn("Erro ao salvar vendas no localStorage:", e);
    }
  }

  // ==========================================
  // PERSISTÊNCIA NA NUVEM (SUPABASE)
  // ==========================================
  private async fetchCloudPayload(force = false): Promise<StoredClothingSalesCloudPayload> {
    const now = Date.now();
    if (
      !force &&
      this.inMemorySales !== null &&
      now - this.lastFetchTime < this.cacheDurationMs
    ) {
      return {
        sales: this.inMemorySales,
        updated_at: new Date(this.lastFetchTime).toISOString(),
      };
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", SUPABASE_SALES_DOCUMENT_ID)
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const cloudPayload = data.stage_completed_rules as StoredClothingSalesCloudPayload;
          if (Array.isArray(cloudPayload.sales)) {
            this.inMemorySales = cloudPayload.sales;
            this.lastFetchTime = now;
            this.saveLocalSales(cloudPayload.sales);
            return cloudPayload;
          }
        }
      } catch (err) {
        console.warn("Falha ao buscar vendas de roupas do Supabase:", err);
      }
    }

    // Fallback: cache local
    const local = this.getLocalSales();
    this.inMemorySales = local;
    return {
      sales: local,
      updated_at: new Date().toISOString(),
    };
  }

  private async saveCloudPayload(sales: ClothingSale[]): Promise<void> {
    const now = new Date().toISOString();
    const payload: StoredClothingSalesCloudPayload = {
      sales,
      updated_at: now,
    };

    this.inMemorySales = sales;
    this.lastFetchTime = Date.now();
    this.saveLocalSales(sales);

    const client = this.getClient();
    if (client) {
      try {
        const { error } = await client.from("instagram_conversations").upsert({
          id: SUPABASE_SALES_DOCUMENT_ID,
          username: "__clothing_sales__",
          full_name: "Vendas de Roupas Vendeo",
          status: "system",
          unread: false,
          stage_completed_rules: payload,
          updated_at: now,
        });

        if (error) {
          console.error("Erro ao sincronizar vendas de roupas no Supabase:", error);
        }
      } catch (err) {
        console.error("Exceção ao persistir vendas de roupas no Supabase:", err);
      }
    }
  }

  // ==========================================
  // MÉTODOS PÚBLICOS DO REPOSITÓRIO
  // ==========================================

  async getSales(): Promise<ClothingSale[]> {
    const payload = await this.fetchCloudPayload();
    return payload.sales;
  }

  async getSaleById(id: string): Promise<ClothingSale | null> {
    const sales = await this.getSales();
    return sales.find((s) => s.id === id) || null;
  }

  async createSale(input: CreateClothingSaleInput): Promise<ClothingSale> {
    const payload = await this.fetchCloudPayload(true);
    const now = new Date().toISOString();

    const newSale: ClothingSale = {
      id: generateId(),
      customerName: input.customerName,
      customerCpf: input.customerCpf,
      customerPhone: input.customerPhone,
      address: input.address,
      productDescription: input.productDescription,
      saleAmount: input.saleAmount,
      shippingPaid: input.shippingPaid,
      shippingCost: input.shippingCost || 0,
      inStock: input.inStock,
      instagramBuyer: input.instagramBuyer,
      status: input.status || "paid",
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };

    const updatedList = [newSale, ...payload.sales];
    await this.saveCloudPayload(updatedList);
    return newSale;
  }

  async updateSale(
    id: string,
    updates: Partial<ClothingSale>
  ): Promise<ClothingSale> {
    const payload = await this.fetchCloudPayload(true);
    const index = payload.sales.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error("Venda não encontrada no servidor.");
    }

    const updated: ClothingSale = {
      ...payload.sales[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    payload.sales[index] = updated;
    await this.saveCloudPayload(payload.sales);
    return updated;
  }

  async deleteSale(id: string): Promise<void> {
    const payload = await this.fetchCloudPayload(true);
    const filtered = payload.sales.filter((s) => s.id !== id);
    await this.saveCloudPayload(filtered);
  }
}
