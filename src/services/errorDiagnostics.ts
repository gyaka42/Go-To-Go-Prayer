import { HttpRequestError } from "@/services/http";

export type AppErrorKind =
  | "network"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "not_found"
  | "misconfigured"
  | "invalid_response"
  | "unknown";

export type AppErrorDiagnostic = {
  kind: AppErrorKind;
  message: string;
  status?: number;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function diagnoseAppError(error: unknown): AppErrorDiagnostic {
  const message = messageOf(error);
  const normalized = message.toLowerCase();

  if (error instanceof HttpRequestError) {
    const payloadKind =
      error.payload && typeof error.payload === "object" ? String((error.payload as Record<string, unknown>).kind || "") : "";
    if (
      payloadKind === "network" ||
      payloadKind === "timeout" ||
      payloadKind === "rate_limited" ||
      payloadKind === "unavailable" ||
      payloadKind === "not_found" ||
      payloadKind === "misconfigured" ||
      payloadKind === "invalid_response"
    ) {
      return { kind: payloadKind, message, status: error.status };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: "misconfigured", message, status: error.status };
    }
    if (error.status === 404) {
      return { kind: "not_found", message, status: error.status };
    }
    if (error.status === 408) {
      return { kind: "timeout", message, status: error.status };
    }
    if (error.status === 429) {
      return { kind: "rate_limited", message, status: error.status };
    }
    if (error.status >= 500) {
      return { kind: "unavailable", message, status: error.status };
    }
    return { kind: "unknown", message, status: error.status };
  }

  if (normalized.includes("abort") || normalized.includes("timeout")) {
    return { kind: "timeout", message };
  }
  if (normalized.includes("network") || normalized.includes("fetch failed") || normalized.includes("failed to fetch")) {
    return { kind: "network", message };
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("empty") ||
    normalized.includes("parse") ||
    normalized.includes("repeated")
  ) {
    return { kind: "invalid_response", message };
  }

  return { kind: "unknown", message };
}

export function quranErrorTranslationKey(error: unknown): string {
  const diagnostic = diagnoseAppError(error);
  switch (diagnostic.kind) {
    case "network":
      return "quran.error_network";
    case "timeout":
      return "quran.error_timeout";
    case "rate_limited":
      return "quran.error_rate_limited";
    case "unavailable":
      return "quran.error_unavailable";
    case "not_found":
      return "quran.error_not_found";
    case "misconfigured":
      return "quran.error_misconfigured";
    case "invalid_response":
      return "quran.error_invalid_response";
    default:
      return "quran.error_load";
  }
}

export function logDiagnostic(scope: string, error: unknown, context?: Record<string, unknown>): void {
  if (!__DEV__) {
    return;
  }
  const diagnostic = diagnoseAppError(error);
  console.warn(`[diagnostic:${scope}]`, {
    kind: diagnostic.kind,
    status: diagnostic.status,
    message: diagnostic.message,
    context
  });
}
