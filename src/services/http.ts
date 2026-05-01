export class HttpRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown = null) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.payload = payload;
  }
}

type FetchJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryStatuses?: Set<number>;
};

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    if (typeof row.error === "string" && row.error.trim().length > 0) {
      return row.error;
    }
    if (typeof row.message === "string" && row.message.trim().length > 0) {
      return row.message;
    }
  }
  return fallback;
}

export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    retryDelayMs = 350,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    headers,
    ...requestInit
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...requestInit,
        headers: {
          Accept: "application/json",
          ...headers
        },
        signal: controller.signal
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        const message = errorMessageFromPayload(payload, `HTTP ${response.status}`);
        const error = new HttpRequestError(message, response.status, payload);
        if (attempt < retries && retryStatuses.has(response.status)) {
          lastError = error;
          await delay(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
      return payload as T;
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (attempt < retries && (isAbort || !(error instanceof HttpRequestError))) {
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Request failed"));
}
