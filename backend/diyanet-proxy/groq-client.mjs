const DEFAULT_GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEFAULT_GROQ_TIMEOUT_MS = 15000;
const DEFAULT_MAX_COMPLETION_TOKENS = 700;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 12000;
const MAX_TOTAL_MESSAGE_CHARS = 32000;
const MAX_SCHEMA_CHARS = 16000;

export class GroqClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "GroqClientError";
    this.code = options.code || "groq_error";
    this.status = options.status || 502;
    this.retryable = options.retryable === true;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.requestId = options.requestId || null;
  }
}

export function resolveGroqConfig(env = process.env) {
  const apiKey = String(env.GROQ_API_KEY || "").trim();
  const apiBaseUrl = normalizeHttpsBaseUrl(env.GROQ_API_BASE_URL || DEFAULT_GROQ_API_BASE_URL);
  const model = String(env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim() || DEFAULT_GROQ_MODEL;
  const timeoutMs = clampInteger(env.GROQ_TIMEOUT_MS, DEFAULT_GROQ_TIMEOUT_MS, 3000, 30000);
  const maxCompletionTokens = clampInteger(
    env.GROQ_MAX_COMPLETION_TOKENS,
    DEFAULT_MAX_COMPLETION_TOKENS,
    128,
    1600
  );

  return {
    apiKey,
    apiBaseUrl,
    model,
    timeoutMs,
    maxCompletionTokens,
    configured: apiKey.length > 0
  };
}

export function groqPublicStatus(config = resolveGroqConfig()) {
  return {
    configured: config.configured,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxCompletionTokens: config.maxCompletionTokens
  };
}

export function createGroqClient(options = {}) {
  const config = options.config || resolveGroqConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  return {
    status() {
      return groqPublicStatus(config);
    },

    async createStructuredCompletion(input) {
      if (!config.configured) {
        throw new GroqClientError("Groq is not configured.", {
          code: "groq_not_configured",
          status: 503
        });
      }

      const messages = validateMessages(input?.messages);
      const schemaName = validateSchemaName(input?.schemaName);
      const schema = validateJsonSchema(input?.schema);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const response = await fetchImpl(`${config.apiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: schemaName,
                strict: true,
                schema
              }
            },
            citation_options: "disabled",
            reasoning_effort: "low",
            temperature: 0.1,
            max_completion_tokens: config.maxCompletionTokens,
            stream: false,
            store: false,
            tool_choice: "none"
          }),
          signal: controller.signal
        });

        const requestId = response.headers?.get?.("x-request-id") || response.headers?.get?.("x-groq-request-id") || null;
        const retryAfterSeconds = parseRetryAfter(response.headers?.get?.("retry-after"));
        const payload = await readResponseJson(response);

        if (!response.ok) {
          throw mapGroqHttpError(response.status, retryAfterSeconds, requestId);
        }

        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new GroqClientError("Groq returned an empty response.", {
            code: "groq_empty_response",
            status: 502,
            requestId
          });
        }

        let data;
        try {
          data = JSON.parse(content);
        } catch {
          throw new GroqClientError("Groq returned invalid JSON.", {
            code: "groq_invalid_json",
            status: 502,
            requestId
          });
        }

        return {
          data,
          meta: {
            requestId,
            model: String(payload?.model || config.model),
            usage: normalizeUsage(payload?.usage),
            rateLimit: readRateLimitHeaders(response.headers)
          }
        };
      } catch (error) {
        if (error instanceof GroqClientError) {
          throw error;
        }
        if (error?.name === "AbortError") {
          throw new GroqClientError("Groq request timed out.", {
            code: "groq_timeout",
            status: 504,
            retryable: true
          });
        }
        throw new GroqClientError("Groq request failed.", {
          code: "groq_network_error",
          status: 502,
          retryable: true
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function normalizeHttpsBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError("GROQ_API_BASE_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError("GROQ_API_BASE_URL must use HTTPS.");
  }
  return normalized;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw new TypeError(`messages must contain between 1 and ${MAX_MESSAGES} entries.`);
  }

  let totalChars = 0;
  const messages = value.map((message) => {
    const role = String(message?.role || "").trim();
    const content = String(message?.content || "").trim();
    if (!new Set(["system", "user", "assistant"]).has(role)) {
      throw new TypeError("messages contain an unsupported role.");
    }
    if (content.length === 0 || content.length > MAX_MESSAGE_CHARS) {
      throw new TypeError(`message content must contain between 1 and ${MAX_MESSAGE_CHARS} characters.`);
    }
    totalChars += content.length;
    return { role, content };
  });

  if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
    throw new TypeError(`messages exceed the ${MAX_TOTAL_MESSAGE_CHARS} character limit.`);
  }
  return messages;
}

function validateSchemaName(value) {
  const name = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    throw new TypeError("schemaName must use lowercase letters, digits and underscores.");
  }
  return name;
}

function validateJsonSchema(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("schema must be a JSON object.");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_SCHEMA_CHARS) {
    throw new TypeError(`schema exceeds the ${MAX_SCHEMA_CHARS} character limit.`);
  }
  return value;
}

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapGroqHttpError(status, retryAfterSeconds, requestId) {
  if (status === 429) {
    return new GroqClientError("Groq rate limit reached.", {
      code: "groq_rate_limited",
      status: 429,
      retryable: true,
      retryAfterSeconds,
      requestId
    });
  }
  if (status === 401 || status === 403) {
    return new GroqClientError("Groq authentication failed.", {
      code: "groq_auth_failed",
      status: 502,
      requestId
    });
  }
  if (status >= 500) {
    return new GroqClientError("Groq is temporarily unavailable.", {
      code: "groq_unavailable",
      status: 503,
      retryable: true,
      retryAfterSeconds,
      requestId
    });
  }
  return new GroqClientError("Groq rejected the request.", {
    code: "groq_request_rejected",
    status: 502,
    requestId
  });
}

function parseRetryAfter(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  return {
    promptTokens: finiteNumberOrNull(value.prompt_tokens),
    completionTokens: finiteNumberOrNull(value.completion_tokens),
    totalTokens: finiteNumberOrNull(value.total_tokens)
  };
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readRateLimitHeaders(headers) {
  if (!headers?.get) return null;
  return {
    remainingRequests: finiteNumberOrNull(headers.get("x-ratelimit-remaining-requests")),
    remainingTokens: finiteNumberOrNull(headers.get("x-ratelimit-remaining-tokens")),
    resetRequests: headers.get("x-ratelimit-reset-requests") || null,
    resetTokens: headers.get("x-ratelimit-reset-tokens") || null
  };
}
