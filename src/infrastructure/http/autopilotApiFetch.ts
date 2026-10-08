import { getApiUrl } from "@/infrastructure/http/network";

export function autopilotApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (anonKey) {
    if (!headers.has("apikey")) headers.set("apikey", anonKey);
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${anonKey}`);
  }
  return fetch(getApiUrl(path), {
    ...init,
    headers,
  });
}
