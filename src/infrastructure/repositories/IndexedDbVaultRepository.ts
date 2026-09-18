import { IVaultRepository } from "@/domain/repositories/IVaultRepository";
import {
  VaultFolder,
  VaultItem,
  VaultFolderWithStats,
} from "@/domain/entities/Vault";

const DB_NAME = "vendeo_vault_db";
const DB_VERSION = 1;
const FOLDERS_STORE = "folders";
const ITEMS_STORE = "items";

export class IndexedDbVaultRepository implements IVaultRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (typeof window === "undefined") {
      throw new Error("IndexedDB não está disponível no ambiente de servidor.");
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          db.createObjectStore(FOLDERS_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(ITEMS_STORE)) {
          const itemStore = db.createObjectStore(ITEMS_STORE, { keyPath: "id" });
          itemStore.createIndex("folderId", "folderId", { unique: false });
          itemStore.createIndex("type", "type", { unique: false });
        }
      };

      request.onsuccess = async () => {
        const db = request.result;
        // Seed inicial caso não haja nenhuma pasta
        try {
          await this.seedInitialDataIfNeeded(db);
        } catch (e) {
          console.warn("Erro ao verificar seed inicial do cofre:", e);
        }
        resolve(db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  private async seedInitialDataIfNeeded(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FOLDERS_STORE, ITEMS_STORE], "readwrite");
      const folderStore = tx.objectStore(FOLDERS_STORE);
      const itemStore = tx.objectStore(ITEMS_STORE);

      const countReq = folderStore.count();
      countReq.onsuccess = () => {
        if (countReq.result === 0) {
          const now = new Date().toISOString();
          const defaultFolderId = "folder_default_geral";
          const defaultFolder: VaultFolder = {
            id: defaultFolderId,
            name: "Geral & Respostas Rápidas",
            color: "#0095f6",
            createdAt: now,
            updatedAt: now,
          };
          folderStore.add(defaultFolder);

          const sampleItem1: VaultItem = {
            id: "item_sample_1",
            folderId: defaultFolderId,
            type: "text",
            title: "Boas-vindas",
            content: "Olá! Tudo bem? Como posso te ajudar com o produto hoje?",
            createdAt: now,
          };

          const sampleItem2: VaultItem = {
            id: "item_sample_2",
            folderId: defaultFolderId,
            type: "text",
            title: "Chave PIX",
            content: "Nossa chave PIX para pagamento é: vendas@vendeo.com.br (confirme o nome do titular antes de enviar).",
            createdAt: now,
          };

          itemStore.add(sampleItem1);
          itemStore.add(sampleItem2);
        }
        resolve();
      };

      countReq.onerror = () => reject(countReq.error);
    });
  }

  async getFolders(): Promise<VaultFolder[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, "readonly");
      const store = tx.objectStore(FOLDERS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const folders: VaultFolder[] = req.result || [];
        folders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        resolve(folders);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getFoldersWithStats(): Promise<VaultFolderWithStats[]> {
    const folders = await this.getFolders();
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readonly");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const items: VaultItem[] = req.result || [];

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

        const result: VaultFolderWithStats[] = folders.map((f) => {
          const st = statsMap.get(f.id) || { total: 0, text: 0, audio: 0, image: 0 };
          return {
            ...f,
            totalItems: st.total,
            textCount: st.text,
            audioCount: st.audio,
            imageCount: st.image,
          };
        });

        resolve(result);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getFolderById(id: string): Promise<VaultFolder | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, "readonly");
      const store = tx.objectStore(FOLDERS_STORE);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async createFolder(name: string, color = "#0095f6"): Promise<VaultFolder> {
    const db = await this.getDB();
    const now = new Date().toISOString();
    const newFolder: VaultFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      color,
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, "readwrite");
      const store = tx.objectStore(FOLDERS_STORE);
      const req = store.add(newFolder);

      req.onsuccess = () => resolve(newFolder);
      req.onerror = () => reject(req.error);
    });
  }

  async updateFolder(
    id: string,
    updates: { name?: string; color?: string; icon?: string }
  ): Promise<VaultFolder> {
    const folder = await this.getFolderById(id);
    if (!folder) {
      throw new Error(`Pasta com ID ${id} não encontrada.`);
    }

    const updated: VaultFolder = {
      ...folder,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, "readwrite");
      const store = tx.objectStore(FOLDERS_STORE);
      const req = store.put(updated);

      req.onsuccess = () => resolve(updated);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFolder(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FOLDERS_STORE, ITEMS_STORE], "readwrite");
      const folderStore = tx.objectStore(FOLDERS_STORE);
      const itemStore = tx.objectStore(ITEMS_STORE);

      // Deletar pasta
      folderStore.delete(id);

      // Deletar todos os itens da pasta em cascata
      const index = itemStore.index("folderId");
      const req = index.openCursor(IDBKeyRange.only(id));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getItems(folderId: string): Promise<VaultItem[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readonly");
      const store = tx.objectStore(ITEMS_STORE);
      const index = store.index("folderId");
      const req = index.getAll(IDBKeyRange.only(folderId));

      req.onsuccess = () => {
        const items: VaultItem[] = req.result || [];
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getItemById(id: string): Promise<VaultItem | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readonly");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveItem(item: Omit<VaultItem, "id" | "createdAt">): Promise<VaultItem> {
    const db = await this.getDB();
    const now = new Date().toISOString();
    const newItem: VaultItem = {
      ...item,
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readwrite");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.add(newItem);

      req.onsuccess = () => resolve(newItem);
      req.onerror = () => reject(req.error);
    });
  }

  async updateItem(id: string, updates: Partial<VaultItem>): Promise<VaultItem> {
    const item = await this.getItemById(id);
    if (!item) throw new Error("Item não encontrado.");

    const updatedItem = { ...item, ...updates };
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readwrite");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.put(updatedItem);
      req.onsuccess = () => resolve(updatedItem);
      req.onerror = () => reject(req.error);
    });
  }

  async reorderItems(folderId: string, orderedItems: VaultItem[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readwrite");
      const store = tx.objectStore(ITEMS_STORE);
      orderedItems.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteItem(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readwrite");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async searchItems(query: string): Promise<VaultItem[]> {
    const db = await this.getDB();
    const q = query.toLowerCase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, "readonly");
      const store = tx.objectStore(ITEMS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const items: VaultItem[] = req.result || [];
        const filtered = items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            (item.content && item.content.toLowerCase().includes(q)) ||
            (item.fileName && item.fileName.toLowerCase().includes(q))
        );
        resolve(filtered);
      };
      req.onerror = () => reject(req.error);
    });
  }
}
