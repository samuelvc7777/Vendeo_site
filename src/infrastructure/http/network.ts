/**
 * Módulo de Resiliência de Rede
 * Clean Architecture - Camada de Infraestrutura
 *
 * Fornece classes de erro customizadas, fetch com timeout configurável via AbortController,
 * e estratégias de repetição com backoff exponencial para requisições idempotentes.
 */

export class NetworkTimeoutError extends Error {
  public readonly status: number = 408;
  public readonly timeoutMs: number;

  constructor(
    message = "A requisição excedeu o tempo limite de resposta.",
    timeoutMs = 6000
  ) {
    super(message);
    this.name = "NetworkTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, NetworkTimeoutError.prototype);
  }
}

export class RateLimitError extends Error {
  public readonly status: number = 429;
  public readonly retryAfter?: number;

  constructor(
    message = "Limite de requisições atingido. Reduza a frequência.",
    retryAfter?: number
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class UnauthorizedError extends Error {
  public readonly status: number = 401;

  constructor(message = "Autenticação inválida ou token expirado.") {
    super(message);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ServiceUnavailableError extends Error {
  public readonly status: number = 503;

  constructor(message = "Serviço temporariamente indisponível.") {
    super(message);
    this.name = "ServiceUnavailableError";
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

/**
 * Executa uma requisição HTTP com timeout seguro utilizando AbortController.
 *
 * @param url Destino da requisição
 * @param options Opções de RequestInit
 * @param timeoutMs Tempo limite em milissegundos (padrão: 6000ms)
 */
export async function fetchWithTimeout(
  url: string | URL | Request,
  options: RequestInit = {},
  timeoutMs = 6000
): Promise<Response> {
  const controller = new AbortController();
  let isTimeout = false;

  const timeoutId = setTimeout(() => {
    isTimeout = true;
    controller.abort();
  }, timeoutMs);

  const externalSignal = options.signal;
  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: unknown) {
    if (isTimeout) {
      throw new NetworkTimeoutError(
        `Tempo limite esgotado (${timeoutMs}ms) ao conectar com o serviço.`,
        timeoutMs
      );
    }

    if (externalSignal?.aborted) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new NetworkTimeoutError(
        `Operação abortada após ${timeoutMs}ms.`,
        timeoutMs
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Retorna a URL canônica para chamadas de API, roteando para a rota local do Next.js em desenvolvimento
 * ou para a Edge Function de produção no Supabase quando em produção/Firebase Hosting.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/api/")
    ? path.replace(/^\/api\//, "/")
    : path.startsWith("/")
    ? path
    : `/${path}`;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  if (isLocal) {
    return `/api${cleanPath}`;
  }
  return `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api${cleanPath}`;
}

