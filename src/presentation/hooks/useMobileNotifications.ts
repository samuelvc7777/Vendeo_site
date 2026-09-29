"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ensureCriticalPushSubscription,
  registerCriticalPushServiceWorker,
} from "@/infrastructure/firebase/firebaseClient";
import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";

export function useMobileNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [remoteRegistered, setRemoteRegistered] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setIsSupported(supported);
    if (supported) setPermission(Notification.permission);
  }, []);

  const ensureRemoteSubscription = useCallback(async (interactive = false) => {
    try {
      const registration = await registerCriticalPushServiceWorker();
      if (!registration) throw new Error("Service Worker indisponível.");

      const configResponse = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "push_config" }),
      });
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || config?.enabled !== true || !config?.publicKey) {
        if (configResponse.status === 401) {
          throw new Error("Entre em Operações do Brain uma vez para vincular este celular.");
        }
        throw new Error(config?.error || "Push remoto não está disponível.");
      }

      const subscription = await ensureCriticalPushSubscription(registration, String(config.publicKey));

      const registerResponse = await brainOperatorFetch("/operator/chat-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "register_device",
          payload: subscription.toJSON(),
        }),
      });

      const registered = await registerResponse.json().catch(() => ({}));
      if (!registerResponse.ok || registered?.success !== true) {
        throw new Error(registered?.error || "Não foi possível vincular este celular.");
      }

      setRemoteRegistered(true);
      return true;
    } catch (error: any) {
      setRemoteRegistered(false);
      if (interactive) {
        toast.error(error?.message || "Não foi possível ativar o push remoto.");
      }
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isSupported || permission !== "granted") return;
    void ensureRemoteSubscription(false);
  }, [isSupported, permission, ensureRemoteSubscription]);

  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast.error("Notificações móveis não são suportadas neste navegador.");
      return false;
    }

    try {
      setIsLoading(true);
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        toast.info("Permissão de notificação não foi concedida.");
        return false;
      }

      const registered = await ensureRemoteSubscription(true);
      if (!registered) return false;

      toast.success("Push remoto ativado. Os alertas chegam mesmo com o Vendeo fechado.");
      return true;
    } finally {
      setIsLoading(false);
    }
  }, [ensureRemoteSubscription, isSupported]);

  return {
    permission,
    isSupported,
    isLoading,
    remoteRegistered,
    requestPermission,
    notifyBrainNeedsAnswer: async (_contactName: string, _conversationId: string, _question?: string | null) => false,
    notifyConversationFinalized: async (_contactName: string, _conversationId: string) => false,
  };
}
