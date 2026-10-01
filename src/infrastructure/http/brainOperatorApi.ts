function operatorApiUrl(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${baseUrl}/functions/v1/api${path.startsWith("/") ? path : `/${path}`}`;
}

export function brainOperatorFetch(path: string, init: RequestInit = {}) {
  return fetch(operatorApiUrl(path), { ...init, cache: init.cache || "no-store" });
}
