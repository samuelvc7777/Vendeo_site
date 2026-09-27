const SESSION_STORAGE_KEY = "vendeo_brain_operator_token";

function operatorApiUrl(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${baseUrl}/functions/v1/api${path.startsWith("/") ? path : `/${path}`}`;
}

function readSessionToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(SESSION_STORAGE_KEY) || "";
}

export async function checkBrainOperatorSession() {
  const token = readSessionToken();
  const response = await fetch(operatorApiUrl("/operator/session"), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.authenticated !== true) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return result as { enabled: boolean; authenticated: boolean };
}

export async function loginBrainOperator(password: string) {
  const response = await fetch(operatorApiUrl("/operator/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível iniciar a sessão de operador.");
  if (typeof result.accessToken !== "string" || !result.accessToken) {
    throw new Error("O servidor não retornou uma sessão de operador válida.");
  }
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, result.accessToken);
}

export async function logoutBrainOperator() {
  const token = readSessionToken();
  if (token) {
    await fetch(operatorApiUrl("/operator/session"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
  }
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export function brainOperatorFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = readSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(operatorApiUrl(path), { ...init, headers, cache: init.cache || "no-store" });
}
