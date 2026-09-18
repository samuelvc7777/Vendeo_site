/**
 * Entidades de Domínio - Instagram Direct (Clean Architecture)
 * Camada de Domínio: Isenta de frameworks externos e estritamente tipada.
 */

export interface InstagramAccount {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  isConnected: boolean;
  pageId?: string;
  updatedAt?: string;
}

export interface InstagramConversation {
  id: string; // IG Scoped ID do usuário ou thread ID
  username: string;
  fullName?: string;
  avatar?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastDirection?: "in" | "out";
  lastStatus?: string;
  seenAt?: string;
  unread?: boolean;
  status?: "active" | "archived" | "blocked" | "restricted" | "pending";
  isRestricted?: boolean;
  createdAt?: string;
  updatedAt?: string;
  recentMessages?: InstagramMessage[];
}

export interface InstagramMessage {
  id: string; // MID oficial da Meta ou ID gerado localmente
  conversationId: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video";
  timestamp: string;
  isMine: boolean;
  status?: "sending" | "sent" | "seen" | "failed";
  seenAt?: string;
  deliverAt?: number;
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
  };
}

export interface InstagramConfig {
  id: string;
  accessToken: string;
  instagramAccountId: string;
  pageId?: string;
  appSecret?: string;
  verifyToken: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  isConnected: boolean;
  updatedAt?: string;
}
