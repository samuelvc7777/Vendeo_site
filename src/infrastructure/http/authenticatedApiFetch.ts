import { getApiUrl } from "@/infrastructure/http/network";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export async function authenticatedApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Cliente Supabase indisponível.");

  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("É necessário entrar novamente para alterar o Piloto Automático.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(getApiUrl(path), { ...init, headers });
}
