"use client";

import { useState, useEffect, useCallback } from "react";
import { Conversation, ChatMessage } from "@/domain/entities/Chat";
import {
  getConversationsUseCase,
  getChatMessagesUseCase,
  sendMessageUseCase,
} from "@/infrastructure/di/container";

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Carrega lista de conversas
  const loadConversations = useCallback(async () => {
    const data = await getConversationsUseCase.execute();
    setConversations(data);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Abre uma conversa e carrega o histórico
  const openConversation = useCallback(async (conv: Conversation) => {
    setActiveConversation(conv);
    setIsLoadingMessages(true);
    try {
      const msgs = await getChatMessagesUseCase.execute(conv.id);
      setMessages(msgs);
      // Atualiza contador de não lidas localmente
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
      );
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const closeConversation = useCallback(() => {
    setActiveConversation(null);
    setMessages([]);
    loadConversations();
  }, [loadConversations]);

  // Envia mensagem
  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeConversation) return;

      const sent = await sendMessageUseCase.execute(activeConversation.id, text);
      setMessages((prev) => [...prev, sent]);

      // Atualiza a prévia na lista de conversas
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? { ...c, lastMessage: text, lastMessageTime: "Agora" }
            : c
        )
      );
    },
    [activeConversation]
  );

  const totalUnread = conversations.reduce((acc, c) => acc + c.unreadCount, 0);

  return {
    conversations,
    activeConversation,
    messages,
    isLoadingMessages,
    openConversation,
    closeConversation,
    sendMessage,
    totalUnread,
    refreshConversations: loadConversations,
  };
}
