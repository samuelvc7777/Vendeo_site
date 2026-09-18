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

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
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
 * Executa uma operação assíncrona com retry e exponential backoff com jitter.
 *
 * @param operation Função assíncrona a ser executada
 * @param options Configurações de retries, limites e critério de repetição
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const backoffFactor = options.backoffFactor ?? 2;

  const defaultShouldRetry = (err: unknown): boolean => {
    if (err instanceof UnauthorizedError) return false;
    if (err instanceof RateLimitError) return false;
    if (err instanceof NetworkTimeoutError) return true;
    if (err instanceof ServiceUnavailableError) return true;
    if (err instanceof TypeError) return true; // Erros típicos de falha de conexão/DNS no fetch
    return false;
  };

  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      lastError = err;

      if (attempt > maxRetries || !shouldRetry(err, attempt)) {
        throw err;
      }

      // Cálculo de delay exponencial com jitter de +/- 10%
      const rawDelay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      const cappedDelay = Math.min(rawDelay, maxDelayMs);
      const jitterFactor = Math.random() * 0.2 - 0.1;
      const delay = Math.max(100, Math.floor(cappedDelay * (1 + jitterFactor)));

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Wrapper de fetch com timeout e retry automático para requisições idempotentes.
 */
export async function fetchWithRetry(
  url: string | URL | Request,
  options: RequestInit = {},
  timeoutMs = 6000,
  retryOptions?: RetryOptions
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  const isIdempotent = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method);

  if (!isIdempotent && !retryOptions?.shouldRetry) {
    return fetchWithTimeout(url, options, timeoutMs);
  }

  return retryWithBackoff(async () => {
    const res = await fetchWithTimeout(url, options, timeoutMs);

    if (res.status === 401) {
      throw new UnauthorizedError("Autenticação inválida ou token expirado na chamada.");
    }
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      throw new RateLimitError(
        "Limite de requisições atingido.",
        isNaN(Number(retryAfter)) ? undefined : retryAfter
      );
    }
    if (res.status === 503 || res.status === 502 || res.status === 504) {
      throw new ServiceUnavailableError(`Serviço temporariamente indisponível (HTTP ${res.status}).`);
    }

    return res;
  }, retryOptions);
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

