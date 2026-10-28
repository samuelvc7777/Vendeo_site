import { IPersonaImageRepository } from "@/domain/repositories/IPersonaImageRepository";
import { PersonaImageAsset, ImageDeliveryHistory } from "@/domain/entities/ChatStage";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

export class SupabasePersonaImageRepository implements IPersonaImageRepository {
  private customClient?: any;
  private cachedImages: PersonaImageAsset[] | null = null;
  private lastFetchImagesTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  constructor(client?: any) {
    if (client) {
      this.customClient = client;
    }
  }

  private getClient() {
    if (this.customClient) {
      return this.customClient;
    }
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private mapRowToImage(row: any): PersonaImageAsset {
    return {
      id: row.id,
      objectiveId: row.objective_id || undefined,
      title: row.title,
      imageUrl: row.image_url,
      whatsappImageUrl: row.whatsapp_image_url || undefined,
      caption: row.caption || "",
      description: row.description || "",
      usageInstruction: row.usage_instruction || "",
      enabled: row.enabled ?? true,
      isViewOnce: Boolean(row.is_view_once),
      allowedTimeStart: row.allowed_time_start || null,
      allowedTimeEnd: row.allowed_time_end || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToHistory(row: any): ImageDeliveryHistory {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      imageId: row.image_id,
      sentAt: row.sent_at,
      providerMessageId: row.provider_message_id || undefined,
    };
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
    const client = this.getClient();
    if (!client) return;
    try {
      this.realtimeSubscribed = true;
      client
        .channel("persona-images-db-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "persona_images",
          },
          () => {
            this.cachedImages = null;
            this.lastFetchImagesTime = 0;
          }
        )
        .subscribe();
    } catch {
      // Fail-safe silencioso
    }
  }

  async getImages(filters?: { objectiveId?: string; enabledOnly?: boolean }): Promise<PersonaImageAsset[]> {
    this.initRealtimeSubscription();
    const now = Date.now();
    let allImages: PersonaImageAsset[] = [];
    if (this.cachedImages && now - this.lastFetchImagesTime < this.cacheDurationMs) {
      allImages = this.cachedImages;
    } else {
      const client = this.getClient();
      if (client) {
        try {
          const { data, error } = await client
            .from("persona_images")
            .select("*")
            .order("title", { ascending: true });
          if (!error && data && Array.isArray(data)) {
            allImages = data.map((r: any) => this.mapRowToImage(r));
            this.cachedImages = allImages;
            this.lastFetchImagesTime = now;
          } else if (error) {
            console.error("[SupabasePersonaImageRepository] Erro ao buscar imagens:", error);
          }
        } catch (err) {
          console.error("[SupabasePersonaImageRepository] Exceção ao consultar persona_images:", err);
        }
      }
    }
    return allImages.filter((img) => {
      if (filters?.enabledOnly && !img.enabled) return false;
      if (filters?.objectiveId && img.objectiveId !== filters.objectiveId) return false;
      return true;
    });
  }

  async getImageById(id: string): Promise<PersonaImageAsset | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const { data, error } = await client
        .from("persona_images")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return this.mapRowToImage(data);
    } catch (err) {
      console.warn(`[SupabasePersonaImageRepository] Erro ao buscar imagem ${id}:`, err);
      return null;
    }
  }

  async saveImage(data: Omit<PersonaImageAsset, "id" | "createdAt" | "updatedAt">): Promise<PersonaImageAsset> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");
    const newId = "img_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();
    const rowPayload = {
      id: newId,
      objective_id: data.objectiveId || null,
      title: data.title.trim(),
      image_url: data.imageUrl,
      whatsapp_image_url: data.whatsappImageUrl || null,
      caption: data.caption?.trim() || "",
      description: data.description || "",
      usage_instruction: data.usageInstruction || "",
      enabled: data.enabled ?? true,
      is_view_once: Boolean(data.isViewOnce),
      allowed_time_start: data.allowedTimeStart || null,
      allowed_time_end: data.allowedTimeEnd || null,
      created_at: now,
      updated_at: now,
    };
    const { data: inserted, error } = await client
      .from("persona_images")
      .insert(rowPayload)
      .select()
      .single();
    if (error) {
      console.error("[SupabasePersonaImageRepository] Erro ao salvar imagem no Supabase:", error);
      throw new Error(error.message || "Falha ao gravar imagem no banco");
    }
    this.cachedImages = null;
    this.lastFetchImagesTime = 0;
    return this.mapRowToImage(inserted);
  }

  async updateImage(id: string, updates: Partial<PersonaImageAsset>): Promise<PersonaImageAsset> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");
    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: now,
    };
    if (updates.objectiveId !== undefined) updatePayload.objective_id = updates.objectiveId || null;
    if (updates.title !== undefined) updatePayload.title = updates.title.trim();
    if (updates.imageUrl !== undefined) updatePayload.image_url = updates.imageUrl;
    if (updates.whatsappImageUrl !== undefined) updatePayload.whatsapp_image_url = updates.whatsappImageUrl || null;
    if (updates.caption !== undefined) updatePayload.caption = updates.caption.trim();
    if (updates.description !== undefined) updatePayload.description = updates.description;
    if (updates.usageInstruction !== undefined) updatePayload.usage_instruction = updates.usageInstruction;
    if (updates.enabled !== undefined) updatePayload.enabled = Boolean(updates.enabled);
    if (updates.isViewOnce !== undefined) updatePayload.is_view_once = Boolean(updates.isViewOnce);
    if (updates.allowedTimeStart !== undefined) updatePayload.allowed_time_start = updates.allowedTimeStart || null;
    if (updates.allowedTimeEnd !== undefined) updatePayload.allowed_time_end = updates.allowedTimeEnd || null;

    const { data: updated, error } = await client
      .from("persona_images")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      console.error(`[SupabasePersonaImageRepository] Erro ao atualizar imagem ${id}:`, error);
      throw new Error(error.message || "Falha ao atualizar imagem no banco");
    }
    this.cachedImages = null;
    this.lastFetchImagesTime = 0;
    return this.mapRowToImage(updated);
  }

  async deleteImage(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");
    const { error } = await client.from("persona_images").delete().eq("id", id);
    if (error) {
      console.error(`[SupabasePersonaImageRepository] Erro ao excluir imagem ${id}:`, error);
      throw new Error(error.message || "Falha ao excluir imagem do banco");
    }
    this.cachedImages = null;
    this.lastFetchImagesTime = 0;
  }

  async searchImages(query: string, objectiveId?: string): Promise<PersonaImageAsset[]> {
    const all = await this.getImages({ enabledOnly: true });
    const q = query.trim().toLowerCase();
    return all.filter((image) => {
      if (objectiveId && image.objectiveId !== objectiveId) {
        return false;
      }
      if (!q) return true;
      const titleMatch = image.title.toLowerCase().includes(q);
      const descMatch = (image.description || "").toLowerCase().includes(q);
      const usageMatch = (image.usageInstruction || "").toLowerCase().includes(q);
      return titleMatch || descMatch || usageMatch;
    });
  }

  async getDeliveryHistory(conversationId: string): Promise<ImageDeliveryHistory[]> {
    const client = this.getClient();
    if (!client) return [];
    try {
      const { data, error } = await client
        .from("image_delivery_history")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });
      if (error || !data) return [];
      return data.map((r: any) => this.mapRowToHistory(r));
    } catch (err) {
      console.warn(`[SupabasePersonaImageRepository] Erro ao buscar histórico de entrega de imagem:`, err);
      return [];
    }
  }

  async recordDelivery(
    conversationId: string,
    imageId: string,
    providerMessageId?: string
  ): Promise<ImageDeliveryHistory> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");
    const newId = "img_deliv_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();
    const rowPayload = {
      id: newId,
      conversation_id: conversationId,
      image_id: imageId,
      sent_at: now,
      provider_message_id: providerMessageId || null,
    };
    const { data, error } = await client
      .from("image_delivery_history")
      .insert(rowPayload)
      .select()
      .single();
    if (error) {
      console.error("[SupabasePersonaImageRepository] Erro ao registrar entrega de imagem:", error);
      throw new Error(error.message || "Falha ao registrar entrega no banco");
    }
    return this.mapRowToHistory(data);
  }
}
