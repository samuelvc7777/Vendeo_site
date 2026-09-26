import { getApiUrl } from "@/infrastructure/http/network";

export function autopilotApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(getApiUrl(path), init);
}
