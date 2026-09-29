export const notificationWorkerPath = "/firebase-messaging-sw.js";

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function bytesEqual(left: ArrayBuffer | null, right: Uint8Array) {
  if (!left) return false;
  const a = new Uint8Array(left);
  if (a.length !== right.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== right[i]) return false;
  }
  return true;
}

export async function registerCriticalPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(notificationWorkerPath, { scope: "/" });
  } catch (error) {
    console.warn("Falha ao registrar service worker de push crítico:", error);
    return null;
  }
}

export async function ensureCriticalPushSubscription(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  if (subscription && !bytesEqual(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
    });
  }

  return subscription;
}
