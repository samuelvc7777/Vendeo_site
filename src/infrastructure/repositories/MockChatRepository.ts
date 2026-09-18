import { IChatRepository } from "@/domain/repositories/IChatRepository";
import { Conversation, ChatMessage } from "@/domain/entities/Chat";

const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    participant: {
      id: "seller-1",
      name: "TechStore Oficial",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      verified: true,
      isOnline: true,
    },
    product: {
      id: "prod-1",
      title: "iPhone 15 Pro Max 256GB Titânio",
      price: 6890,
      image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
    },
    lastMessage: "Consigo fazer por R$ 6.700 no PIX se fechar hoje!",
    lastMessageTime: "10:42",
    unreadCount: 1,
  },
  {
    id: "conv-2",
    participant: {
      id: "buyer-2",
      name: "Lucas Ferreira",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
      verified: true,
      isOnline: false,
    },
    product: {
      id: "prod-4",
      title: "PlayStation 5 Slim 1TB Edição Digital",
      price: 3399,
      image: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&auto=format&fit=crop&q=80",
    },
    lastMessage: "Tem garantia de quanto tempo ainda?",
    lastMessageTime: "Ontem",
    unreadCount: 0,
  },
  {
    id: "conv-3",
    participant: {
      id: "seller-3",
      name: "Sneakers Hub",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
      verified: true,
      isOnline: true,
    },
    product: {
      id: "prod-3",
      title: "Nike Air Jordan 1 High Retro Chicago",
      price: 1290,
      image: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&auto=format&fit=crop&q=80",
    },
    lastMessage: "Envio postado! Segue o código de rastreio.",
    lastMessageTime: "Seg",
    unreadCount: 0,
  },
];

const INITIAL_MESSAGES: Record<string, ChatMessage[]> = {
  "conv-1": [
    {
      id: "m-1",
      conversationId: "conv-1",
      senderId: "user-me",
      senderName: "Você",
      text: "Olá! O iPhone ainda está disponível para envio imediato?",
      createdAt: "10:35",
      isMine: true,
    },
    {
      id: "m-2",
      conversationId: "conv-1",
      senderId: "seller-1",
      senderName: "TechStore Oficial",
      text: "Bom dia! Sim, está lacrado e com nota fiscal em mãos.",
      createdAt: "10:38",
      isMine: false,
    },
    {
      id: "m-3",
      conversationId: "conv-1",
      senderId: "user-me",
      senderName: "Você",
      text: "Tem como dar um desconto à vista no PIX?",
      createdAt: "10:40",
      isMine: true,
    },
    {
      id: "m-4",
      conversationId: "conv-1",
      senderId: "seller-1",
      senderName: "TechStore Oficial",
      text: "Consigo fazer por R$ 6.700 no PIX se fechar hoje!",
      createdAt: "10:42",
      isMine: false,
    },
  ],
};

export class MockChatRepository implements IChatRepository {
  private conversations: Conversation[] = [...INITIAL_CONVERSATIONS];
  private messages: Record<string, ChatMessage[]> = { ...INITIAL_MESSAGES };

  async getConversations(): Promise<Conversation[]> {
    return [...this.conversations];
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.messages[conversationId] || [];
  }

  async sendMessage(conversationId: string, text: string): Promise<ChatMessage> {
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversationId,
      senderId: "user-me",
      senderName: "Você",
      text,
      createdAt: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      isMine: true,
    };

    if (!this.messages[conversationId]) {
      this.messages[conversationId] = [];
    }
    this.messages[conversationId].push(newMessage);

    // Atualiza conversa
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.lastMessage = text;
      conv.lastMessageTime = "Agora";
    }

    return newMessage;
  }

  async markAsRead(conversationId: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.unreadCount = 0;
    }
  }
}
