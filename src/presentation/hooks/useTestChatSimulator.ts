"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { DirectMessage, DirectConversation } from "@/presentation/components/chat/InstagramDirect";

export const TEST_CONVERSATION_ID = "test_larissa_sandbox";

export const TEST_CONVERSATION: DirectConversation = {
  id: TEST_CONVERSATION_ID,
  username: "pretendente_sandbox",
  fullName: "🧪 Simulador IA (Pretendente)",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
  isOnline: true,
  type: "instagram",
  lastMessage: "Toque para testar a IA autônoma em tempo real",
  // Sempre no topo da lista (timestamp atual forçado na composição da lista).
  lastMessageAt: new Date().toISOString(),
  lastActive: "Agora",
  unread: false,
  lastSender: "them",
};

const STORAGE_KEY = "vendeo_test_sandbox_messages";

function getInitialStoredMessages(): DirectMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn("Erro ao carregar mensagens do chat de teste:", err);
  }

  // Mensagens padrão de boas-vindas para o ambiente de teste
  const nowIso = new Date().toISOString();
  return [
    {
      id: "msg_test_welcome_1",
      senderId: "me",
      text: "Olá! Este é o ambiente de teste da IA Autônoma (Larissa). Ative o Piloto Automático e envie mensagens como Pretendente para ver a IA responder e avançar as etapas do funil automaticamente!",
      createdAt: "Agora",
      timestamp: Date.now() - 10000,
      sentDate: nowIso,
      isMine: true,
      status: "sent",
    },
  ];
}

export function isTestConversationId(id?: string | null): boolean {
  if (!id) return false;
  return id === TEST_CONVERSATION_ID || id.startsWith("test_");
}

export function useTestChatSimulator() {
  const [senderRole, setSenderRole] = useState<"them" | "me">("them"); // Padrão: "them" (Pretendente)
  const [testMessages, setTestMessages] = useState<DirectMessage[]>([]);
  const [isTurboMode, setIsTurboMode] = useState<boolean>(true); // Padrão: turbo ligado para testes ágeis

  // Carrega mensagens do localStorage na inicialização
  useEffect(() => {
    setTestMessages(getInitialStoredMessages());
  }, []);

  // Persiste mensagens sempre que mudar
  const persistMessages = useCallback((msgs: DirectMessage[]) => {
    setTestMessages(msgs);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
      } catch (err) {
        console.warn("Erro ao salvar mensagens do chat de teste:", err);
      }
    }
  }, []);

  // Limpa o histórico de mensagens e restaura para o estado inicial
  const resetTestMessages = useCallback(() => {
    const nowIso = new Date().toISOString();
    const initial: DirectMessage[] = [
      {
        id: `msg_test_welcome_${Date.now()}`,
        senderId: "me",
        text: "Ambiente de teste resetado! O histórico está limpo e pronto para um novo teste. Envie uma mensagem como Pretendente para começar.",
        createdAt: "Agora",
        timestamp: Date.now(),
        sentDate: nowIso,
        isMine: true,
        status: "sent",
      },
    ];
    persistMessages(initial);
    toast.success("Histórico do chat de teste limpo com sucesso!");
    return initial;
  }, [persistMessages]);

  return {
    senderRole,
    setSenderRole,
    testMessages,
    setTestMessages: persistMessages,
    resetTestMessages,
    isTurboMode,
    setIsTurboMode,
    isTestConversationId,
  };
}
