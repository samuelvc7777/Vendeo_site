import { IVaultRepository } from "@/domain/repositories/IVaultRepository";
import {
  VaultFolder,
  VaultItem,
  VaultFolderWithStats,
  VaultItemType,
} from "@/domain/entities/Vault";

export interface CreateItemInput {
  folderId: string;
  type: VaultItemType;
  title: string;
  content?: string;
  mediaBlob?: Blob;
  mediaUrl?: string;
  duration?: number;
  fileSize?: number;
  fileName?: string;
  mimeType?: string;
  linkedItemId?: string;
}

export class ManageVaultUseCase {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  async listFoldersWithStats(): Promise<VaultFolderWithStats[]> {
    return this.vaultRepository.getFoldersWithStats();
  }

  async createFolder(name: string, color?: string): Promise<VaultFolder> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("O nome da pasta não pode ser vazio.");
    }
    return this.vaultRepository.createFolder(trimmed, color);
  }

  async renameFolder(id: string, name: string): Promise<VaultFolder> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("O nome da pasta não pode ser vazio.");
    }
    return this.vaultRepository.updateFolder(id, { name: trimmed });
  }

  async deleteFolder(id: string): Promise<void> {
    return this.vaultRepository.deleteFolder(id);
  }

  async listItems(folderId: string): Promise<VaultItem[]> {
    const items = await this.vaultRepository.getItems(folderId);
    // Assegura que itens com mediaBlob possuam mediaUrl funcional
    return items.map((item) => {
      if (item.mediaBlob && !item.mediaUrl) {
        try {
          return {
            ...item,
            mediaUrl: URL.createObjectURL(item.mediaBlob),
          };
        } catch {
          return item;
        }
      }
      return item;
    });
  }

  async createItem(input: CreateItemInput): Promise<VaultItem> {
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) {
      throw new Error("O título do item não pode ser vazio.");
    }

    if (input.type === "text" && (!input.content || !input.content.trim())) {
      throw new Error("O conteúdo do texto não pode ser vazio.");
    }

    if ((input.type === "audio" || input.type === "image") && !input.mediaBlob) {
      throw new Error("É necessário fornecer o arquivo de mídia.");
    }

    return this.vaultRepository.saveItem({
      folderId: input.folderId,
      type: input.type,
      title: trimmedTitle,
      content: input.content?.trim(),
      mediaBlob: input.mediaBlob,
      mediaUrl: input.mediaUrl,
      duration: input.duration,
      fileSize: input.fileSize || input.mediaBlob?.size,
      fileName: input.fileName,
      mimeType: input.mimeType || input.mediaBlob?.type,
      linkedItemId: input.linkedItemId,
    });
  }

  async deleteItem(id: string): Promise<void> {
    return this.vaultRepository.deleteItem(id);
  }

  async updateItem(id: string, updates: Partial<VaultItem>): Promise<VaultItem> {
    return this.vaultRepository.updateItem(id, updates);
  }

  async reorderItems(folderId: string, orderedItems: VaultItem[]): Promise<void> {
    return this.vaultRepository.reorderItems(folderId, orderedItems);
  }

  async search(query: string): Promise<VaultItem[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.vaultRepository.searchItems(trimmed);
  }
}
