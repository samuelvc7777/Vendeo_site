import { TinderProfile, TinderRawMatch, TinderRawMessage } from "@/domain/entities/Tinder";
import {
  fetchWithTimeout,
  RateLimitError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "@/infrastructure/http/network";

const TINDER_API_BASE = "https://api.gotinder.com";
const TIMEOUT_MS = 6000;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Content-Type": "application/json",
  platform: "web",
  "app-version": "1040800",
  Origin: "https://tinder.com",
  Referer: "https://tinder.com/",
};

/**
 * Valida o status HTTP da resposta e lança exceções de domínio / infraestrutura tipadas.
 */
function checkResponseStatus(res: Response, context: string): void {
  if (res.status === 401) {
    throw new UnauthorizedError(`Autenticação recusada pelo Tinder (${context}): token expirado ou inválido.`);
  }
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
    throw new RateLimitError(
      `Limite de requisições excedido no Tinder (${context}).`,
      isNaN(Number(retryAfter)) ? undefined : retryAfter
    );
  }
  if (res.status === 503 || res.status === 502 || res.status === 504) {
    throw new ServiceUnavailableError(`Serviço do Tinder temporariamente indisponível (${context}, HTTP ${res.status}).`);
  }
}

interface RawPhotoItem {
  id?: string;
  url?: string;
  processedFiles?: Array<{ url?: string }>;
}

export class TinderApiClient {
  /**
   * Valida o token de autenticação buscando o perfil do usuário logado
   */
  static async getProfile(token: string): Promise<TinderProfile> {
    const res = await fetchWithTimeout(
      `${TINDER_API_BASE}/v2/profile?include=user`,
      {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          "X-Auth-Token": token,
        },
        cache: "no-store",
      },
      TIMEOUT_MS
    );

    checkResponseStatus(res, "getProfile");

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `Falha ao autenticar no Tinder (${res.status}): ${errorText || res.statusText}`
      );
    }

    const data = await res.json();
    const user = data?.data?.user;

    if (!user) {
      throw new Error("Resposta da API do Tinder não continha dados de usuário válidos.");
    }

    const photos = (user.photos || []).map((p: RawPhotoItem) => ({
      id: p.id || String(Math.random()),
      url: p.url || p.processedFiles?.[0]?.url || "",
    }));

    return {
      id: user._id || user.id,
      name: user.name || "Usuário Tinder",
      bio: user.bio,
      birthDate: user.birth_date,
      photos,
      isVerified: Boolean(user.is_tinder_u || user.badges?.length),
    };
  }

  /**
   * Busca os matches reais e últimas mensagens com timeout seguro
   */
  static async getMatches(token: string, count = 60): Promise<TinderRawMatch[]> {
    const res = await fetchWithTimeout(
      `${TINDER_API_BASE}/v2/matches?count=${count}&is_tinder_u=false`,
      {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          "X-Auth-Token": token,
        },
        cache: "no-store",
      },
      TIMEOUT_MS
    );

    checkResponseStatus(res, "getMatches");

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `Falha ao buscar matches do Tinder (${res.status}): ${errorText || res.statusText}`
      );
    }

    const data = await res.json();
    return data?.data?.matches || [];
  }

  /**
   * Busca as mensagens de uma conversa específica com timeout seguro
   */
  static async getMessages(token: string, matchId: string, count = 100): Promise<TinderRawMessage[]> {
    const res = await fetchWithTimeout(
      `${TINDER_API_BASE}/v2/matches/${matchId}/messages?count=${count}`,
      {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          "X-Auth-Token": token,
        },
        cache: "no-store",
      },
      TIMEOUT_MS
    );

    checkResponseStatus(res, "getMessages");

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `Falha ao buscar mensagens do Tinder (${res.status}): ${errorText || res.statusText}`
      );
    }

    const data = await res.json();
    return data?.data?.messages || [];
  }

  /**
   * Envia uma mensagem real para o match com suporte a fallback de endpoints e timeout seguro
   */
  static async sendMessage(token: string, matchId: string, message: string): Promise<unknown> {
    // Tentativa 1: Endpoint oficial padrão do Tinder Web
    const res = await fetchWithTimeout(
      `${TINDER_API_BASE}/user/matches/${matchId}`,
      {
        method: "POST",
        headers: {
          ...DEFAULT_HEADERS,
          "X-Auth-Token": token,
        },
        body: JSON.stringify({ message }),
        cache: "no-store",
      },
      TIMEOUT_MS
    );

    if (res.ok) {
      return await res.json();
    }

    checkResponseStatus(res, "sendMessage [v1]");

    // Se falhou com 404 ou 405, tenta endpoint alternativo v2
    if (res.status === 404 || res.status === 405) {
      const resV2 = await fetchWithTimeout(
        `${TINDER_API_BASE}/v2/matches/${matchId}/messages`,
        {
          method: "POST",
          headers: {
            ...DEFAULT_HEADERS,
            "X-Auth-Token": token,
          },
          body: JSON.stringify({
            message,
            temp_id: `temp_${Date.now()}`,
          }),
          cache: "no-store",
        },
        TIMEOUT_MS
      );

      if (resV2.ok) {
        return await resV2.json();
      }

      checkResponseStatus(resV2, "sendMessage [v2]");

      const errorTextV2 = await resV2.text();
      throw new Error(
        `Falha ao enviar mensagem no Tinder via fallback v2 (${resV2.status}): ${errorTextV2 || resV2.statusText}`
      );
    }

    const errorText = await res.text();
    throw new Error(
      `Falha ao enviar mensagem no Tinder (${res.status}): ${errorText || res.statusText}`
    );
  }
}
