import { brainOperatorFetch } from "@/infrastructure/http/brainOperatorApi";
export type { ReciprocityCategory, ReciprocityAttempt as ReciprocityAttemptView, ReciprocityView as ReciprocitySnapshotView } from "@/domain/entities/Reciprocity";
export interface ReciprocityContextMessage {
  id: string;
  role: "contact" | "larissa";
  text: string;
  at: string;
  mediaMissing: boolean;
}
const KEY_STORAGE = "vendeo-reciprocity-access";
export const RECIPROCITY_ACCESS_EVENT = "vendeo-reciprocity-access-change";
export function readReciprocityAccess(): string { return typeof window === "undefined" ? "" : window.sessionStorage.getItem(KEY_STORAGE) || ""; }
export function saveReciprocityAccess(key: string): void {
  if (key.trim())
    window.sessionStorage.setItem(KEY_STORAGE, key.trim());
  else
    window.sessionStorage.removeItem(KEY_STORAGE);
  window.dispatchEvent(new Event(RECIPROCITY_ACCESS_EVENT));
}
export async function reciprocityFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const key = readReciprocityAccess();
  if (!key)
    throw new Error("Informe sua chave de acesso à análise em Configurações.");
  headers.set("X-Reciprocity-Key", key);
  return brainOperatorFetch(`/operator/reciprocity${path}`, { ...init, headers });
}
export async function reciprocityJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await reciprocityFetch(path, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(typeof body.error === "string" ? body.error : "Não foi possível acessar a análise.");
  return body as T;
}
