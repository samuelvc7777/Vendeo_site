export type VaultItemType = "text" | "audio" | "image";

export interface VaultFolder {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItem {
  id: string;
  folderId: string;
  type: VaultItemType;
  title: string;
  content?: string; // Para mensagens de texto ou legendas
  mediaBlob?: Blob; // Armazenado no IndexedDB
  mediaUrl?: string; // URL efêmera (URL.createObjectURL) ou persistente
  duration?: number; // Duração em segundos (para áudio)
  fileSize?: number; // Tamanho em bytes
  fileName?: string;
  mimeType?: string;
  linkedItemId?: string; // ID de outro item para envio em conjunto (combo)
  createdAt: string;
}

export interface VaultFolderWithStats {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  textCount: number;
  audioCount: number;
  imageCount: number;
}
