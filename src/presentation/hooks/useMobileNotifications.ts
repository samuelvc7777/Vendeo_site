"use client";

import { useState, useEffect, useCallback } from "react";
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

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setIsSupported(true);
    setPermission(Notification.permission);

    if (Notification.permission === "granted") {
      registerFirebaseServiceWorker().catch(() => {});
      const storedToken = localStorage.getItem("vendeo_fcm_token");
      if (storedToken) setFcmToken(storedToken);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE_TO_CHAT" && event.data?.conversationId) {
        window.location.hash = `#chat=${event.data.conversationId}`;
      }
    };

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast.error("Notificações móveis não são suportadas neste navegador.");
      return false;
    }

    try {
      setIsLoading(true);
      const registration = await registerFirebaseServiceWorker();
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm === "granted") {
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
          console.warn("Aviso ao obter FCM token:", fcmErr);
        }

        toast.success("Alertas críticos ativados.");
        return true;
      }

      if (perm === "denied") {
        toast.error("Permissão de notificação foi bloqueada nas configurações do navegador.");
      } else {
        toast.info("Permissão de notificação não foi concedida.");
      }
      return false;
    } catch (err: any) {
      console.error("Erro ao ativar notificações móveis:", err);
      toast.error("Erro ao ativar notificações: " + (err.message || "Tente novamente"));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const notifyBrainNeedsAnswer = useCallback(
    async (contactName: string, conversationId: string, question?: string | null) => {
      if (permission !== "granted") return false;

      const cleanQuestion = String(question || "")
        .replace(/^Brain precisa saber:\s*/i, "")
        .trim();

      return await sendNativeMobileNotification({
        eventType: "manual_resolution_required",
        title: `Brain precisa de você • ${contactName}`,
        body: cleanQuestion || "O Brain precisa de uma informação sua para continuar a conversa.",
        tag: `brain_manual_${conversationId}`,
        data: {
          conversationId,
          eventType: "manual_resolution_required",
          url: window.location.href,
        },
        requireInteraction: true,
      });
    },
    [permission],
  );

  const notifyConversationFinalized = useCallback(
    async (contactName: string, conversationId: string) => {
      if (permission !== "granted") return false;

      return await sendNativeMobileNotification({
        eventType: "workflow_finalized",
        title: `Conversa finalizada • ${contactName}`,
        body: "Todos os objetivos foram concluídos. A IA foi desligada automaticamente neste chat.",
        tag: `workflow_finalized_${conversationId}`,
        data: {
          conversationId,
          eventType: "workflow_finalized",
          url: window.location.href,
        },
      });
    },
    [permission],
  );

  return {
    permission,
    isSupported,
    fcmToken,
    isLoading,
    requestPermission,
    notifyBrainNeedsAnswer,
    notifyConversationFinalized,
  };
}
