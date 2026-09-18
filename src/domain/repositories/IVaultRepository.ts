import { VaultFolder, VaultItem, VaultFolderWithStats } from "../entities/Vault";

export interface IVaultRepository {
  getFolders(): Promise<VaultFolder[]>;
  getFoldersWithStats(): Promise<VaultFolderWithStats[]>;
  getFolderById(id: string): Promise<VaultFolder | null>;
  createFolder(name: string, color?: string): Promise<VaultFolder>;
  updateFolder(id: string, updates: { name?: string; color?: string; icon?: string }): Promise<VaultFolder>;
  deleteFolder(id: string): Promise<void>;

  getItems(folderId: string): Promise<VaultItem[]>;
  getItemById(id: string): Promise<VaultItem | null>;
  saveItem(item: Omit<VaultItem, "id" | "createdAt">): Promise<VaultItem>;
  updateItem(id: string, updates: Partial<VaultItem>): Promise<VaultItem>;
  deleteItem(id: string): Promise<void>;
  reorderItems(folderId: string, orderedItems: VaultItem[]): Promise<void>;
  searchItems(query: string): Promise<VaultItem[]>;
}
