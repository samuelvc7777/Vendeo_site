import { IVaultRepository } from "@/domain/repositories/IVaultRepository";
import {
  VaultFolder,
  VaultItem,
  VaultFolderWithStats,
} from "@/domain/entities/Vault";
import { IndexedDbVaultRepository } from "./IndexedDbVaultRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";
import { getApiUrl } from "../http/network";

interface StoredVaultPayload {
  folders: VaultFolder[];
  items: VaultItem[];
  updated_at: string;
}

export class SupabaseVaultRepository implements IVaultRepository {
  private localFallback = new IndexedDbVaultRepository();
  private cachedFolders: VaultFolder[] | null = null;
  private cachedItems: VaultItem[] | null = null;
  private lastFetchTime = 0;
  private cacheDurationMs = 2500;
  private realtimeSubscribed = false;

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  private initRealtimeSubscription() {
    if (this.realtimeSubscribed || typeof window === "undefined") return;
    const client = this.getClient();
    if (!client) return;

    try {
      this.realtimeSubscribed = true;
      client
        .channel("vault-cloud-sync")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "instagram_conversations",
            filter: "id=eq.__vault_data__",
          },
          (payload: any) => {
            const rules = payload?.new?.stage_completed_rules as StoredVaultPayload | undefined;
            if (rules && Array.isArray(rules.folders) && Array.isArray(rules.items)) {
              this.cachedFolders = rules.folders;
              this.cachedItems = rules.items;
              this.lastFetchTime = Date.now();
            }
          }
        )
        .subscribe();
    } catch {
      // Falha silenciosa de realtime se websocket não conectar
    }
  }

  private async fetchCloudData(force = false): Promise<{ folders: VaultFolder[]; items: VaultItem[] }> {
    this.initRealtimeSubscription();
    const now = Date.now();
    if (!force && this.cachedFolders && this.cachedItems && now - this.lastFetchTime < this.cacheDurationMs) {
      return { folders: this.cachedFolders, items: this.cachedItems };
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", "__vault_data__")
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const rules = data.stage_completed_rules as StoredVaultPayload;
          if (Array.isArray(rules.folders) && Array.isArray(rules.items)) {
            this.cachedFolders = rules.folders;
            this.cachedItems = rules.items;
            this.lastFetchTime = now;

            // Espelha silenciosamente os itens da nuvem para o armazenamento local
            try {
              for (const it of rules.items) {
                await this.localFallback.saveItem(it);
              }
            } catch {}

            return { folders: rules.folders, items: rules.items };
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar cofre do Supabase:", err);
      }
    }

    // Se a nuvem estiver inacessível temporariamente, lê do armazenamento local sem NUNCA sobrescrever a nuvem
    const localFolders = await this.localFallback.getFolders();
    const allItems: VaultItem[] = [];
    for (const f of localFolders) {
      const fItems = await this.localFallback.getItems(f.id);
      allItems.push(...fItems);
    }

    this.cachedFolders = localFolders;
    this.cachedItems = allItems;
    this.lastFetchTime = now;
    return { folders: localFolders, items: allItems };
  }

  private async persistToCloud(data: StoredVaultPayload): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      await client.from("instagram_conversations").upsert({
        id: "__vault_data__",
        username: "__vault__",
        full_name: "Cofre Compartilhado Vendeo",
        stage_completed_rules: data,
        unread: false,
        status: "vault",
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Aviso ao persistir cofre na nuvem Supabase:", err);
    }
  }

  async getFolders(): Promise<VaultFolder[]> {
    const { folders } = await this.fetchCloudData();
    return folders;
  }

  async getFoldersWithStats(): Promise<VaultFolderWithStats[]> {
    const { folders, items } = await this.fetchCloudData();

    const statsMap = new Map<string, { total: number; text: number; audio: number; image: number }>();
    folders.forEach((f) => {
      statsMap.set(f.id, { total: 0, text: 0, audio: 0, image: 0 });
    });

    items.forEach((item) => {
      const stats = statsMap.get(item.folderId);
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
  }

  async getFolderById(id: string): Promise<VaultFolder | null> {
    const { folders } = await this.fetchCloudData();
    return folders.find((f) => f.id === id) || null;
  }

  async createFolder(name: string, color?: string): Promise<VaultFolder> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();
    const newFolder: VaultFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      color: color || "#0095f6",
      createdAt: now,
      updatedAt: now,
    };

    const updatedFolders = [newFolder, ...folders];
    this.cachedFolders = updatedFolders;
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders: updatedFolders,
      items,
      updated_at: now,
    });

    void this.localFallback.createFolder(name, color).catch(() => {});
    return newFolder;
  }

  async updateFolder(id: string, updates: { name?: string; color?: string; icon?: string }): Promise<VaultFolder> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();
    const idx = folders.findIndex((f) => f.id === id);
    if (idx === -1) {
      return this.localFallback.updateFolder(id, updates);
    }

    folders[idx] = {
      ...folders[idx],
      ...updates,
      updatedAt: now,
    };

    this.cachedFolders = [...folders];
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders,
      items,
      updated_at: now,
    });

    void this.localFallback.updateFolder(id, updates).catch(() => {});
    return folders[idx];
  }

  async deleteFolder(id: string): Promise<void> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();

    const filteredFolders = folders.filter((f) => f.id !== id);
    const filteredItems = items.filter((i) => i.folderId !== id);

    this.cachedFolders = filteredFolders;
    this.cachedItems = filteredItems;
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders: filteredFolders,
      items: filteredItems,
      updated_at: now,
    });

    void this.localFallback.deleteFolder(id).catch(() => {});
  }

  async getItems(folderId: string): Promise<VaultItem[]> {
    const { items } = await this.fetchCloudData();
    return items.filter((i) => i.folderId === folderId);
  }

  async getItemById(id: string): Promise<VaultItem | null> {
    const { items } = await this.fetchCloudData();
    return items.find((i) => i.id === id) || null;
  }

  async saveItem(item: Omit<VaultItem, "id" | "createdAt">): Promise<VaultItem> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();

    let finalMediaUrl = item.mediaUrl;

    // Se houver mediaBlob e não tiver URL remota pública, envia via API para o bucket vendeo_vault
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

        const uploadRes = await fetch(getApiUrl("/api/instagram/upload"), {
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
        console.warn("Aviso ao fazer upload do blob para o Storage via API:", uploadErr);
      }

      // Se falhou o upload e o arquivo for pequeno (< 200KB), permite fallback data URL
      if (!finalMediaUrl || finalMediaUrl.startsWith("blob:")) {
        if (item.mediaBlob.size < 200 * 1024) {
          try {
            finalMediaUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => resolve(item.mediaUrl || "");
              reader.readAsDataURL(item.mediaBlob!);
            });
          } catch {
            finalMediaUrl = item.mediaUrl;
          }
        }
      }
    }

    const newItem: VaultItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      folderId: item.folderId,
      type: item.type,
      title: item.title.trim(),
      content: item.content,
      mediaUrl: finalMediaUrl,
      duration: item.duration,
      fileSize: item.fileSize,
      fileName: item.fileName,
      mimeType: item.mimeType,
      linkedItemId: item.linkedItemId,
      createdAt: now,
    };

    const updatedItems = [newItem, ...items];
    this.cachedItems = updatedItems;
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders,
      items: updatedItems,
      updated_at: now,
    });

    void this.localFallback.saveItem({ ...item, mediaUrl: finalMediaUrl }).catch(() => {});
    return newItem;
  }

  async deleteItem(id: string): Promise<void> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();

    const filteredItems = items.filter((i) => i.id !== id);
    this.cachedItems = filteredItems;
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders,
      items: filteredItems,
      updated_at: now,
    });

    void this.localFallback.deleteItem(id).catch(() => {});
  }

  async updateItem(id: string, updates: Partial<VaultItem>): Promise<VaultItem> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) {
      return this.localFallback.updateItem(id, updates);
    }

    items[idx] = {
      ...items[idx],
      ...updates,
    };

    this.cachedItems = [...items];
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders,
      items,
      updated_at: now,
    });

    void this.localFallback.updateItem(id, updates).catch(() => {});
    return items[idx];
  }

  async reorderItems(folderId: string, orderedItems: VaultItem[]): Promise<void> {
    const { folders, items } = await this.fetchCloudData(true);
    const now = new Date().toISOString();

    const otherItems = items.filter((i) => i.folderId !== folderId);
    const newItems = [...orderedItems, ...otherItems];

    this.cachedItems = newItems;
    this.lastFetchTime = Date.now();

    await this.persistToCloud({
      folders,
      items: newItems,
      updated_at: now,
    });

    void this.localFallback.reorderItems(folderId, orderedItems).catch(() => {});
  }

  async searchItems(query: string): Promise<VaultItem[]> {
    const { items } = await this.fetchCloudData();
    const q = query.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.content && item.content.toLowerCase().includes(q)) ||
        (item.fileName && item.fileName.toLowerCase().includes(q))
    );
  }
}
