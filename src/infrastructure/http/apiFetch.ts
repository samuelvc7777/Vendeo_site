import { getApiUrl } from "@/infrastructure/http/network";

const API_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Chama a API do Vendeo sem exigir sessão de usuário. */
export async function apiFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const isRelative = rawUrl.startsWith("/");
  const isApiRoute = isRelative || rawUrl.includes("/functions/v1/api/");
  const url = isRelative ? getApiUrl(rawUrl) : rawUrl;

  if (!isApiRoute) return fetch(input, init);

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (API_KEY) headers.set("apikey", API_KEY);

  return fetch(url, { ...init, headers });
}
