import type { AppLanguage } from "@/i18n/translations";
import { fetchJson, HttpRequestError } from "@/services/http";
import { getFaithInstallationId, getLatestCachedTimings } from "@/services/storage";
import type {
  FaithAnswer,
  FaithAnswerMode,
  FaithCitation,
  FaithHealth,
  FaithOutcome,
  FaithPerspective,
  FaithRateLimit
} from "@/types/faith";

const DEFAULT_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";
const VALID_OUTCOMES = new Set<FaithOutcome>([
  "answer",
  "clarification_needed",
  "insufficient_sources",
  "out_of_scope",
  "qualified_referral"
]);

export class FaithAssistantError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly resetAt: string | null;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      retryAfterSeconds?: number | null;
      resetAt?: string | null;
    } = {}
  ) {
    super(message);
    this.name = "FaithAssistantError";
    this.code = options.code || "faith_request_failed";
    this.status = options.status || 0;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.resetAt = options.resetAt ?? null;
  }
}

function getProxyBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_PROXY_URL).replace(/\/+$/, "");
}

export async function getFaithHealth(): Promise<FaithHealth> {
  const payload = await fetchJson<unknown>(`${getProxyBaseUrl()}/faith/health`, {
    method: "GET",
    timeoutMs: 8000,
    retries: 1
  });
  const row = asRecord(payload);
  const abuse = asRecord(row.abuseProtection);
  return {
    enabled: row.enabled === true,
    ready: row.ready === true,
    policyId: cleanString(row.policyId, 80) || "faith-assistant-v1",
    provider: cleanString(row.provider, 40) || "groq",
    dailyLimit: finiteInteger(abuse.installDailyLimit, 1, 100)
  };
}

export async function askFaithAssistant(input: {
  question: string;
  language: AppLanguage;
  perspective: FaithPerspective;
}): Promise<FaithAnswer> {
  const installationId = await getFaithInstallationId();
  const cachedTimings = looksLikePrayerTimeQuestion(input.question)
    ? await getLatestCachedTimings()
    : null;
  const appContext = cachedTimings
    ? {
        dateKey: cachedTimings.timings.dateKey,
        times: cachedTimings.timings.times
      }
    : undefined;
  try {
    const payload = await fetchJson<unknown>(`${getProxyBaseUrl()}/faith/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, installationId, ...(appContext ? { appContext } : {}) }),
      timeoutMs: 22000,
      retries: 0
    });
    return parseFaithAnswer(payload);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      const payload = asRecord(error.payload);
      throw new FaithAssistantError(error.message, {
        code: cleanString(payload.code, 100) || "faith_request_failed",
        status: error.status,
        retryAfterSeconds: finiteInteger(payload.retryAfterSeconds, 1, 86400),
        resetAt: validIsoDate(payload.resetAt)
      });
    }
    if (error instanceof FaithAssistantError) {
      throw error;
    }
    throw new FaithAssistantError(error instanceof Error ? error.message : String(error));
  }
}

function looksLikePrayerTimeQuestion(question: string): boolean {
  const normalized = question
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase();
  const prayerTerms = [
    "prayer", "fajr", "dhuhr", "zuhr", "asr", "maghrib", "isha",
    "gebed", "bidden", "namaz", "imsak", "sabah", "ogle", "oglen", "ikindi", "aksam", "yatsi"
  ];
  const timeTerms = [
    "time", "when", "today", "hoe laat", "wanneer", "vandaag", "gebedstijd",
    "vakit", "vakti", "saat", "bugun", "simdi"
  ];
  return prayerTerms.some((term) => normalized.includes(term)) && timeTerms.some((term) => normalized.includes(term));
}

function parseFaithAnswer(value: unknown): FaithAnswer {
  const row = asRecord(value);
  const outcome = cleanString(row.outcome, 60) as FaithOutcome;
  const perspective = cleanString(row.perspective, 60) as FaithPerspective;
  const answer = cleanString(row.answer, 3000);
  const rateLimit = parseRateLimit(row.rateLimit);
  const meta = asRecord(row.meta);
  const citations = Array.isArray(row.citations)
    ? row.citations.map(parseCitation).filter((item): item is FaithCitation => item !== null).slice(0, 8)
    : [];
  if (
    !VALID_OUTCOMES.has(outcome) ||
    (perspective !== "general_sunni" && perspective !== "hanafi") ||
    !answer ||
    !rateLimit
  ) {
    throw new FaithAssistantError("Invalid Faith Assistant response.", { code: "faith_invalid_response" });
  }

  return {
    outcome,
    perspective,
    topicId: cleanNullableString(meta.topicId, 120),
    answerMode: parseAnswerMode(meta.answerMode, outcome, citations.length),
    answer,
    citations,
    caveat: cleanNullableString(row.caveat, 600),
    followUpQuestion: cleanNullableString(row.followUpQuestion, 500),
    rateLimit
  };
}

function parseAnswerMode(value: unknown, outcome: FaithOutcome, citationCount: number): FaithAnswerMode {
  const mode = cleanString(value, 40) as FaithAnswerMode;
  if (new Set<FaithAnswerMode>(["sourced", "general_ai", "app_data", "clarification", "referral", "boundary"]).has(mode)) {
    return mode;
  }
  if (citationCount > 0) return "sourced";
  if (outcome === "clarification_needed") return "clarification";
  if (outcome === "qualified_referral") return "referral";
  if (outcome === "answer") return "general_ai";
  return "boundary";
}

function parseCitation(value: unknown): FaithCitation | null {
  const row = asRecord(value);
  const id = cleanString(row.id, 160);
  const title = cleanString(row.title, 300);
  const url = cleanString(row.url, 1000);
  if (!id || !title || !/^https:\/\//i.test(url)) {
    return null;
  }
  return {
    id,
    sourceId: cleanString(row.sourceId, 160),
    title,
    locator: cleanString(row.locator, 300),
    url,
    sourceLanguage: cleanString(row.sourceLanguage, 20),
    sourceDate: cleanNullableString(row.sourceDate, 40)
  };
}

function parseRateLimit(value: unknown): FaithRateLimit | null {
  const row = asRecord(value);
  const limit = finiteInteger(row.limit, 1, 100);
  const remaining = finiteInteger(row.remaining, 0, limit ?? 100);
  const resetAt = cleanString(row.resetAt, 80);
  if (limit === null || remaining === null || !resetAt || !Number.isFinite(new Date(resetAt).getTime())) {
    return null;
  }
  return { limit, remaining, resetAt };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNullableString(value: unknown, maxLength: number): string | null {
  const result = cleanString(value, maxLength);
  return result || null;
}

function finiteInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= minimum && rounded <= maximum ? rounded : null;
}

function validIsoDate(value: unknown): string | null {
  const normalized = cleanString(value, 80);
  return normalized && Number.isFinite(new Date(normalized).getTime()) ? normalized : null;
}
