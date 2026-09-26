/**
 * src/infrastructure/repositories/SupabaseVaultRepository.ts
 * Repositório Oficial do Cofre Compartilhado Vendeo via Supabase.
 * 
 * Regra Arquitetural Absoluta:
 * - As tabelas 'public.vault_folders' e 'public.vault_items' são as ÚNICAS fontes de verdade.
 * - Zero IndexedDB.
 * - Zero localStorage.
 * - Zero pseudo-registros globais (__vault_data__).
 * - Sincronização em tempo real via canais do Supabase Realtime.
 */

import { IVaultRepository } from "@/domain/repositories/IVaultRepository";
import {
  VaultFolder,
  VaultItem,
  VaultFolderWithStats,
} from "@/domain/entities/Vault";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";
import { getApiUrl } from "../http/network";
import { apiFetch } from "@/infrastructure/http/apiFetch";

export class SupabaseVaultRepository implements IVaultRepository {
  private customClient?: any;
  private cachedFolders: VaultFolder[] | null = null;
  private cachedItems: VaultItem[] | null = null;
  private lastFetchTime = 0;
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

  private mapRowToFolder(row: any): VaultFolder {
    return {
      id: row.id,
      name: row.name,
      color: row.color || undefined,
      icon: row.icon || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToItem(row: any): VaultItem {
    return {
      id: row.id,
      folderId: row.folder_id,
      type: row.type,
      title: row.title,
      content: row.content || undefined,
      mediaUrl: row.media_url || undefined,
      duration: row.duration != null ? Number(row.duration) : undefined,
      fileSize: row.file_size != null ? Number(row.file_size) : undefined,
      fileName: row.file_name || undefined,
      mimeType: row.mime_type || undefined,
      linkedItemId: row.linked_item_id || undefined,
      createdAt: row.created_at,
    };
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || (typeof window === "undefined" && !this.customClient)) return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("vault-db-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vault_folders",
          },
          () => {
            this.cachedFolders = null;
            this.lastFetchTime = 0;
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vault_items",
          },
          () => {
            this.cachedItems = null;
            this.lastFetchTime = 0;
          }
        )
        .subscribe();
    } catch {
      // Fail-safe silencioso
    }
  }

  async getFolders(): Promise<VaultFolder[]> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (this.cachedFolders && now - this.lastFetchTime < this.cacheDurationMs) {
      return [...this.cachedFolders];
    }

    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("vault_folders")
        .select("*")
        .order("name", { ascending: true });

      if (error || !data) {
        console.error("[SupabaseVaultRepository] Erro ao carregar pastas do cofre:", error);
        return this.cachedFolders || [];
      }

      const folders = data.map((r: any) => this.mapRowToFolder(r));
      this.cachedFolders = folders;
      this.lastFetchTime = now;
      return folders;
    } catch (err) {
      console.error("[SupabaseVaultRepository] Exceção ao buscar pastas:", err);
      return this.cachedFolders || [];
    }
  }

  async getFoldersWithStats(): Promise<VaultFolderWithStats[]> {
    const folders = await this.getFolders();
    const client = this.getClient();
    if (!client) {
      return folders.map((f) => ({
        ...f,
        totalItems: 0,
        textCount: 0,
        audioCount: 0,
        imageCount: 0,
      }));
    }

    try {
      const { data: itemsData } = await client.from("vault_items").select("folder_id, type");
      const items = itemsData || [];

      const statsMap = new Map<string, { total: number; text: number; audio: number; image: number }>();
      folders.forEach((f) => {
        statsMap.set(f.id, { total: 0, text: 0, audio: 0, image: 0 });
      });

      items.forEach((item: any) => {
        const stats = statsMap.get(item.folder_id);
        if (stats) {
          stats.total++;
          if (item.type === "text") stats.text++;
          if (item.type === "audio") stats.audio++;
          if (item.type === "image") stats.image++;
        }
      });

      return folders.map((f) => {
        const st = statsMap.get(f.id) || { total: 0, text: 0, audio: 0, image: 0 };
        return {
          ...f,
          totalItems: st.total,
          textCount: st.text,
          audioCount: st.audio,
          imageCount: st.image,
        };
      });
    } catch (err) {
      console.warn("[SupabaseVaultRepository] Erro ao calcular estatísticas das pastas:", err);
      return folders.map((f) => ({
        ...f,
        totalItems: 0,
        textCount: 0,
        audioCount: 0,
        imageCount: 0,
      }));
    }
  }

  async getFolderById(id: string): Promise<VaultFolder | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("vault_folders")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;
      return this.mapRowToFolder(data);
    } catch (err) {
      console.warn(`[SupabaseVaultRepository] Erro ao buscar pasta ${id}:`, err);
      return null;
    }
  }

  async createFolder(name: string, color?: string): Promise<VaultFolder> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const newId = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const rowPayload = {
      id: newId,
      name: name.trim(),
      color: color || "#0095f6",
      icon: null,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await client
      .from("vault_folders")
      .insert(rowPayload)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseVaultRepository] Erro ao criar pasta no cofre:", error);
      throw new Error(error.message || "Falha ao criar pasta");
    }

    this.cachedFolders = null;
    this.lastFetchTime = 0;
    return this.mapRowToFolder(data);
  }

  async updateFolder(id: string, updates: { name?: string; color?: string; icon?: string }): Promise<VaultFolder> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) updatePayload.name = updates.name.trim();
    if (updates.color !== undefined) updatePayload.color = updates.color;
    if (updates.icon !== undefined) updatePayload.icon = updates.icon;

    const { data, error } = await client
      .from("vault_folders")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[SupabaseVaultRepository] Erro ao atualizar pasta ${id}:`, error);
      throw new Error(error.message || "Falha ao atualizar pasta");
    }

    this.cachedFolders = null;
    this.lastFetchTime = 0;
    return this.mapRowToFolder(data);
  }

  async deleteFolder(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const { error } = await client.from("vault_folders").delete().eq("id", id);
    if (error) {
      console.error(`[SupabaseVaultRepository] Erro ao excluir pasta ${id}:`, error);
      throw new Error(error.message || "Falha ao excluir pasta");
    }

    this.cachedFolders = null;
    this.cachedItems = null;
    this.lastFetchTime = 0;
  }

  async getItems(folderId: string): Promise<VaultItem[]> {
    this.initRealtimeSubscription();
    const client = this.getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from("vault_items")
        .select("*")
        .eq("folder_id", folderId)
        .order("created_at", { ascending: false });

      if (error || !data) return [];
      return data.map((r: any) => this.mapRowToItem(r));
    } catch (err) {
      console.warn(`[SupabaseVaultRepository] Erro ao buscar itens da pasta ${folderId}:`, err);
      return [];
    }
  }

  async getItemById(id: string): Promise<VaultItem | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from("vault_items")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;
      return this.mapRowToItem(data);
    } catch (err) {
      console.warn(`[SupabaseVaultRepository] Erro ao buscar item ${id}:`, err);
      return null;
    }
  }

  async saveItem(item: Omit<VaultItem, "id" | "createdAt">): Promise<VaultItem> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const newId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    let finalMediaUrl = item.mediaUrl;

    // Se houver mediaBlob e não tiver URL remota pública, faz upload via API para o bucket
    if (item.mediaBlob && (!finalMediaUrl || finalMediaUrl.startsWith("blob:"))) {
      try {
        const formData = new FormData();
        const file =
          item.mediaBlob instanceof File
            ? item.mediaBlob
            : new File([item.mediaBlob], item.fileName || `${item.type}_${Date.now()}.${item.type === "audio" ? "wav" : "jpg"}`, {
                type: item.mimeType || (item.type === "audio" ? "audio/wav" : "image/jpeg"),
              });
        formData.append("file", file);
        formData.append("type", item.type);

        const uploadRes = await apiFetch(getApiUrl("/api/instagram/upload"), {
          method: "POST",
          body: formData,
        });

        if (uploadRes.ok) {
          const upData = await uploadRes.json();
          if (upData?.url) {
            finalMediaUrl = upData.url;
          }
        }
      } catch (uploadErr) {
        console.warn("[SupabaseVaultRepository] Aviso ao fazer upload do arquivo para Storage:", uploadErr);
      }
    }

    const rowPayload = {
      id: newId,
      folder_id: item.folderId,
      type: item.type,
      title: item.title.trim(),
      content: item.content || null,
      media_url: finalMediaUrl || null,
      duration: item.duration != null ? Math.round(item.duration) : null,
      file_size: item.fileSize != null ? Math.round(item.fileSize) : null,
      file_name: item.fileName || null,
      mime_type: item.mimeType || null,
      linked_item_id: item.linkedItemId || null,
      created_at: now,
    };

    const { data, error } = await client
      .from("vault_items")
      .insert(rowPayload)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseVaultRepository] Erro ao salvar item no cofre:", error);
      throw new Error(error.message || "Falha ao salvar item no banco");
    }

    this.cachedItems = null;
    this.lastFetchTime = 0;
    return this.mapRowToItem(data);
  }

  async updateItem(id: string, updates: Partial<VaultItem>): Promise<VaultItem> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const updatePayload: Record<string, any> = {};
    if (updates.folderId !== undefined) updatePayload.folder_id = updates.folderId;
    if (updates.title !== undefined) updatePayload.title = updates.title.trim();
    if (updates.content !== undefined) updatePayload.content = updates.content || null;
    if (updates.mediaUrl !== undefined) updatePayload.media_url = updates.mediaUrl || null;
    if (updates.duration !== undefined) updatePayload.duration = updates.duration != null ? Math.round(updates.duration) : null;
    if (updates.fileSize !== undefined) updatePayload.file_size = updates.fileSize != null ? Math.round(updates.fileSize) : null;
    if (updates.fileName !== undefined) updatePayload.file_name = updates.fileName || null;
    if (updates.mimeType !== undefined) updatePayload.mime_type = updates.mimeType || null;
    if (updates.linkedItemId !== undefined) updatePayload.linked_item_id = updates.linkedItemId || null;

    const { data, error } = await client
      .from("vault_items")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[SupabaseVaultRepository] Erro ao atualizar item ${id}:`, error);
      throw new Error(error.message || "Falha ao atualizar item no banco");
    }

    this.cachedItems = null;
    this.lastFetchTime = 0;
    return this.mapRowToItem(data);
  }

  async deleteItem(id: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Cliente Supabase indisponível");

    const { error } = await client.from("vault_items").delete().eq("id", id);
    if (error) {
      console.error(`[SupabaseVaultRepository] Erro ao excluir item ${id}:`, error);
      throw new Error(error.message || "Falha ao excluir item no banco");
    }

    this.cachedItems = null;
    this.lastFetchTime = 0;
  }

  async reorderItems(_folderId: string, _orderedItems: VaultItem[]): Promise<void> {
    // Ordem no Supabase preservada por criação/atualização
    this.cachedItems = null;
    this.lastFetchTime = 0;
  }

  async searchItems(query: string): Promise<VaultItem[]> {
    const client = this.getClient();
    if (!client) return [];

    const q = query.trim().toLowerCase();
    if (!q) return [];

    try {
      const { data, error } = await client
        .from("vault_items")
        .select("*")
        .or(`title.ilike.%${q}%,content.ilike.%${q}%,file_name.ilike.%${q}%`);

      if (error || !data) return [];
      return data.map((r: any) => this.mapRowToItem(r));
    } catch (err) {
      console.warn("[SupabaseVaultRepository] Erro ao pesquisar itens do cofre:", err);
      return [];
    }
  }
}
