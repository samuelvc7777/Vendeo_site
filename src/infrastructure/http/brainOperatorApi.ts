function operatorApiUrl(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${baseUrl}/functions/v1/api${path.startsWith("/") ? path : `/${path}`}`;
}

export function brainOperatorFetch(path: string, init: RequestInit = {}) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const headers = new Headers(init.headers || {});
  if (!headers.has("apikey") && anonKey) {
    headers.set("apikey", anonKey);
  }
  if (!headers.has("Authorization") && anonKey) {
    headers.set("Authorization", `Bearer ${anonKey}`);
  }
  return fetch(operatorApiUrl(path), { ...init, headers, cache: init.cache || "no-store" });
}
