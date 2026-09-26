"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  registerFirebaseServiceWorker,
  sendNativeMobileNotification,
  getFirebaseMessaging,
} from "@/infrastructure/firebase/firebaseClient";
import { getToken } from "firebase/messaging";

export function useMobileNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Verifica o suporte e o status atual da permissão no navegador
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setIsSupported(true);
      setPermission(Notification.permission);

      // Se já estiver concedido, registra o Service Worker silenciosamente
      if (Notification.permission === "granted") {
        registerFirebaseServiceWorker().catch(() => {});
      }
    }
  }, []);

  // Escuta mensagens do Service Worker (ex: navegação ao clicar na notificação)
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE_TO_CHAT" && event.data?.conversationId) {
        window.location.hash = `#chat=${event.data.conversationId}`;
      }
    };

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  // Solicita permissão explícita ao usuário (com gesto do clique)
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast.error("Notificações móveis não são suportadas neste navegador.");
      return false;
    }

    try {
      setIsLoading(true);

      // 1. Registra o Service Worker do Firebase
      const registration = await registerFirebaseServiceWorker();

      // 2. Solicita a permissão do sistema
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm === "granted") {
        toast.success("🔔 Notificações no celular ativadas com sucesso!");

        // 3. Tenta obter o Token FCM do Firebase
        try {
          const messaging = await getFirebaseMessaging();
          if (messaging && registration) {
            const token = await getToken(messaging, {
              serviceWorkerRegistration: registration,
            });
            if (token) {
              setFcmToken(token);
              localStorage.setItem("vendeo_fcm_token", token);
            }
          }
        } catch (fcmErr) {
          console.warn("Aviso ao obter FCM token (Web Push padrão ativo):", fcmErr);
        }

        // 4. Dispara notificação de boas-vindas de teste no sistema
        await sendNativeMobileNotification({
          title: "🎉 Notificações Ativadas!",
          body: "Você receberá alertas de mensagens e aprovações do AutoPilot em tempo real como um app no celular.",
          tag: "welcome_notification",
        });

        return true;
      } else if (perm === "denied") {
        toast.error("Permissão de notificação foi bloqueada nas configurações do seu navegador.");
        return false;
      } else {
        toast.info("Permissão de notificação não foi concedida.");
        return false;
      }
    } catch (err: any) {
      console.error("Erro ao ativar notificações móveis:", err);
      toast.error("Erro ao ativar notificações: " + (err.message || "Tente novamente"));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Dispara uma notificação para proposta do AutoPilot pronta
  const notifyProposalReady = useCallback(
    async (contactName: string, conversationId: string) => {
      if (permission !== "granted") return false;

      return await sendNativeMobileNotification({
        title: `🤖 Proposta da IA: ${contactName}`,
        body: "A IA preparou uma resposta com áudios e textos. Toque para revisar e aprovar antes do envio!",
        tag: `approval_${conversationId}`,
        data: { conversationId, url: window.location.href },
        requireInteraction: true,
      });
    },
    [permission]
  );

  // Dispara uma notificação para nova mensagem do cliente (quando não estiver no chat)
  const notifyClientMessage = useCallback(
    async (contactName: string, messageText: string, conversationId: string) => {
      if (permission !== "granted") return false;

      return await sendNativeMobileNotification({
        title: contactName,
        body: messageText || "Nova mensagem recebida",
        tag: `msg_${conversationId}`,
        data: { conversationId, url: window.location.href },
      });
    },
    [permission]
  );

  // Dispara notificação crítica de hand-off da Rifa
  const notifyHandoffRaffle = useCallback(
    async (contactName: string, conversationId: string) => {
      if (permission !== "granted") return false;

      return await sendNativeMobileNotification({
        title: `🚨 Rifa Atingida: ${contactName}`,
        body: "Momento da Rifa atingido após áudios pessoais! Assuma o fechamento agora.",
        tag: `handoff_${conversationId}`,
        data: { conversationId, url: window.location.href },
        requireInteraction: true,
      });
    },
    [permission]
  );

  const notifyObjectivesCompleted = useCallback(
    async (contactName: string, conversationId: string) => {
      if (permission !== "granted") return false;

      return await sendNativeMobileNotification({
        title: `🏁 Objetivos concluídos: ${contactName}`,
        body: "A IA terminou os objetivos do funil. Abra a conversa para finalizar.",
        tag: `objectives_completed_${conversationId}`,
        data: { conversationId, url: window.location.href },
        requireInteraction: true,
      });
    },
    [permission]
  );

  // Teste manual de disparo de notificação
  const sendTestNotification = useCallback(async () => {
    if (permission !== "granted") {
      const ok = await requestPermission();
      if (!ok) return;
    }

    await sendNativeMobileNotification({
      title: "🤖 Teste do AutoPilot (Larissa)",
      body: "Notificação móvel funcionando perfeitamente! Vibração e alerta nativo ativos.",
      tag: `test_${Date.now()}`,
    });
    toast.success("Notificação de teste disparada no sistema!");
  }, [permission, requestPermission]);

  return {
    permission,
    isSupported,
    fcmToken,
    isLoading,
    requestPermission,
    notifyProposalReady,
    notifyClientMessage,
    notifyHandoffRaffle,
    notifyObjectivesCompleted,
    sendTestNotification,
  };
}
