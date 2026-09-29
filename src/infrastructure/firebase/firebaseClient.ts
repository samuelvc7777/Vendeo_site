import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, isSupported, Messaging } from "firebase/messaging";

export const firebaseConfig = {
  apiKey: "AIzaSyBbotUfwf-cjufDlWeJOmSYChrP9_7XNwE",
  projectId: "vendeo-e755e",
  storageBucket: "vendeo-e755e.firebasestorage.app",
  messagingSenderId: "497512130312",
  appId: "1:497512130312:web:258277786eb13664632ebd",
  measurementId: "G-YLPP65ZEKT",
};

// Inicializa ou reaproveita o app do Firebase
export function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(firebaseConfig);
}

// Inicializa o Messaging se suportado pelo navegador
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;

  try {
    const app = getFirebaseApp();
    return getMessaging(app);
  } catch (err) {
    console.warn("Aviso ao inicializar Firebase Messaging:", err);
    return null;
  }
}

// Registra o Service Worker do Firebase no navegador
export async function registerFirebaseServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    // Registra o worker dedicado de notificações
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/",
    });
    return registration;
  } catch (err) {
    console.warn("Aviso ao registrar firebase-messaging-sw.js:", err);
    return null;
  }
}

export type MobileNotificationEventType =
  | "manual_resolution_required"
  | "workflow_finalized";

export interface MobileNotificationPayload {
  eventType: MobileNotificationEventType;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  requireInteraction?: boolean;
}

const ALLOWED_MOBILE_NOTIFICATION_EVENTS = new Set<MobileNotificationEventType>([
  "manual_resolution_required",
  "workflow_finalized",
]);

// Dispara somente os dois alertas críticos autorizados pelo produto.
export async function sendNativeMobileNotification(payload: MobileNotificationPayload): Promise<boolean> {
  if (!ALLOWED_MOBILE_NOTIFICATION_EVENTS.has(payload.eventType)) {
    console.warn("Notificação móvel ignorada: evento não autorizado.", payload.eventType);
    return false;
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const options: any = {
    body: payload.body,
    icon: payload.icon || "/images/default-avatar.svg",
    badge: payload.badge || "/images/default-avatar.svg",
    tag: payload.tag || `vendeo_${Date.now()}`,
    data: {
      ...(payload.data || { url: window.location.href }),
      eventType: payload.eventType,
    },
    requireInteraction: payload.requireInteraction || false,
    // Vibração real no celular Android: vibra 200ms, pausa 100ms, vibra 200ms
    vibrate: [200, 100, 200],
  };

  try {
    // 1. Tenta disparar através do Service Worker (garante exibição em segundo plano e com tela bloqueada)
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(payload.title, options);
        return true;
      }
    }

    // 2. Fallback para Notification API direta
    const notif = new Notification(payload.title, options);
    notif.onclick = (e) => {
      e.preventDefault();
      window.focus();
      if (payload.data?.conversationId) {
        window.location.hash = `#chat=${payload.data.conversationId}`;
      }
      notif.close();
    };
    return true;
  } catch (err) {
    console.warn("Aviso ao disparar notificação móvel nativa:", err);
    return false;
  }
}
