import { Product } from "./Product";

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
  isMine: boolean;
}

export interface Conversation {
  id: string;
  participant: {
    id: string;
    name: string;
    avatar: string;
    verified: boolean;
    isOnline?: boolean;
  };
  product?: {
    id: string;
    title: string;
    price: number;
    image: string;
  };
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}
