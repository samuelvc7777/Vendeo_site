// Firebase Cloud Messaging Service Worker — alertas críticos do Vendeo.
// Somente dois eventos podem gerar notificação:
// 1) manual_resolution_required
// 2) workflow_finalized

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

const ALLOWED_NOTIFICATION_EVENTS = new Set([
  "manual_resolution_required",
  "workflow_finalized",
]);

function extractEventType(payload) {
  return (
    payload?.data?.eventType ||
    payload?.data?.event_type ||
    payload?.eventType ||
    payload?.event_type ||
    payload?.FCM_MSG?.data?.eventType ||
    payload?.FCM_MSG?.data?.event_type ||
    null
  );
}

function isAllowedNotification(payload) {
  return ALLOWED_NOTIFICATION_EVENTS.has(String(extractEventType(payload) || ""));
}

function notificationFromPayload(payload) {
  const eventType = extractEventType(payload);
  const data = payload?.data || payload?.FCM_MSG?.data || {};
  const notification = payload?.notification || payload?.FCM_MSG?.notification || {};

  if (eventType === "manual_resolution_required") {
    return {
      title: notification.title || data.title || "Brain precisa de você",
      options: {
        body: notification.body || data.body || "O Brain precisa de uma informação sua para continuar.",
        icon: notification.icon || data.icon || "/images/logo.png",
        badge: "/images/logo.png",
        vibrate: [200, 100, 200],
        tag: data.tag || `brain_manual_${data.conversationId || "unknown"}`,
        data: { ...data, eventType },
        requireInteraction: true,
      },
    };
  }

  return {
    title: notification.title || data.title || "Conversa finalizada",
    options: {
      body: notification.body || data.body || "Todos os objetivos foram concluídos e a IA foi desligada neste chat.",
      icon: notification.icon || data.icon || "/images/logo.png",
      badge: "/images/logo.png",
      vibrate: [200, 100, 200],
      tag: data.tag || `workflow_finalized_${data.conversationId || "unknown"}`,
      data: { ...data, eventType },
      requireInteraction: false,
    },
  };
}

// Este listener é registrado ANTES do Firebase Messaging.
// Qualquer push antigo/genérico é bloqueado antes de chegar ao SDK.
self.addEventListener("push", (event) => {
  if (!event.data) {
    event.stopImmediatePropagation();
    return;
  }

  let payload = null;
  try {
    payload = event.data.json();
  } catch {
    event.stopImmediatePropagation();
    return;
  }

  if (!isAllowedNotification(payload)) {
    event.stopImmediatePropagation();
    return;
  }

  // FCM_MSG é tratado pelo Firebase Messaging abaixo.
  if (payload?.FCM_MSG) return;

  // Web Push genérico permitido: mostramos aqui e impedimos outro handler.
  event.stopImmediatePropagation();
  const rendered = notificationFromPayload(payload);
  event.waitUntil(self.registration.showNotification(rendered.title, rendered.options));
});

firebase.initializeApp({
  apiKey: "AIzaSyBbotUfwf-cjufDlWeJOmSYChrP9_7XNwE",
  authDomain: "vendeo-e755e.firebaseapp.com",
  projectId: "vendeo-e755e",
  storageBucket: "vendeo-e755e.firebasestorage.app",
  messagingSenderId: "497512130312",
  appId: "1:497512130312:web:258277786eb13664632ebd",
});

let messaging = null;
try {
  messaging = firebase.messaging();
} catch (err) {
  console.warn("[SW] Firebase Messaging não suportado:", err);
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    if (!isAllowedNotification(payload)) return;
    const rendered = notificationFromPayload(payload);
    self.registration.showNotification(rendered.title, rendered.options);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const conversationId = event.notification.data?.conversationId;
  const targetUrl = conversationId ? `/#chat=${conversationId}` : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          if (conversationId && "postMessage" in client) {
            client.postMessage({
              type: "NAVIGATE_TO_CHAT",
              conversationId,
            });
          }
          return client.focus();
        }
      }

      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
