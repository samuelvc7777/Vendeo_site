// Firebase Cloud Messaging Service Worker (Mobile & Web Push)
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Inicialização do Firebase no Service Worker
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

// Manipulador de mensagens em segundo plano via Firebase Cloud Messaging
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log("[SW] Mensagem recebida em segundo plano:", payload);
    const notificationTitle = payload.notification?.title || payload.data?.title || "Vendeo Direct";
    const notificationOptions = {
      body: payload.notification?.body || payload.data?.body || "Nova mensagem recebida.",
      icon: payload.notification?.icon || payload.data?.icon || "/images/logo.png",
      badge: "/images/logo.png",
      vibrate: [200, 100, 200],
      tag: payload.data?.tag || `msg_${Date.now()}`,
      data: payload.data || {},
      requireInteraction: payload.data?.requireInteraction === "true",
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

// Manipulador de Web Push Genérico
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || "Vendeo Direct";
    const options = {
      body: data.body || "",
      icon: data.icon || "/images/logo.png",
      badge: "/images/logo.png",
      vibrate: [200, 100, 200],
      tag: data.tag || `push_${Date.now()}`,
      data: data.data || {},
      requireInteraction: Boolean(data.requireInteraction),
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification("Vendeo Direct", {
        body: text,
        vibrate: [200, 100, 200],
      })
    );
  }
});

// Ao clicar na notificação: foca a janela aberta ou abre o chat correspondente
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const conversationId = event.notification.data?.conversationId;
  const targetUrl = conversationId ? `/#chat=${conversationId}` : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Se já houver uma aba aberta do Vendeo, foca nela
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

      // Se não houver nenhuma aba aberta, abre uma nova
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
