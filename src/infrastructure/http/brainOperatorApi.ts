function operatorApiUrl(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${baseUrl}/functions/v1/api${path.startsWith("/") ? path : `/${path}`}`;
}

// Compatibilidade com telas antigas: o site agora é público e não mantém sessão de operador.
export async function checkBrainOperatorSession() {
  return { enabled: false, authenticated: true };
}

export async function loginBrainOperator(..._unused: unknown[]) {
  return { success: true };
}

export async function logoutBrainOperator() {
  return { success: true };
}

export function brainOperatorFetch(path: string, init: RequestInit = {}) {
  return fetch(operatorApiUrl(path), { ...init, cache: init.cache || "no-store" });
}
