import { PrayerName, Timings } from "@/types/prayer";

const REQUIRED_PRAYERS: PrayerName[] = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const DEFAULT_DIYANET_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";

type ProxyTimingsResponse = {
  dateKey?: unknown;
  cityId?: unknown;
  source?: unknown;
  times?: unknown;
  error?: unknown;
  details?: unknown;
};

type ProxyMonthlyTimingsResponse = {
  year?: unknown;
  month?: unknown;
  cityId?: unknown;
  source?: unknown;
  days?: unknown;
  error?: unknown;
  details?: unknown;
};

function toDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function normalizeProxyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function parseHHmm(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

function parseTimes(raw: unknown): Record<PrayerName, string> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const Fajr = parseHHmm(row.Fajr);
  const Sunrise = parseHHmm(row.Sunrise);
  const Dhuhr = parseHHmm(row.Dhuhr);
  const Asr = parseHHmm(row.Asr);
  const Maghrib = parseHHmm(row.Maghrib);
  const Isha = parseHHmm(row.Isha);

  if (!Fajr || !Sunrise || !Dhuhr || !Asr || !Maghrib || !Isha) {
    return null;
  }

  return { Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha };
}

function parseMonthlyTimes(raw: unknown): Record<string, Record<PrayerName, string>> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Record<string, Record<PrayerName, string>> = {};
  const rows = raw as Record<string, unknown>;
  for (const [dateKey, value] of Object.entries(rows)) {
    if (!/^\d{2}-\d{2}-\d{4}$/.test(dateKey)) {
      continue;
    }
    const parsed = parseTimes(value);
    if (!parsed) {
      continue;
    }
    result[dateKey] = parsed;
  }
  return result;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function getTimingsByCoordinates(
  date: Date,
  lat: number,
  lon: number,
  cityHint?: string
): Promise<Timings> {
  const baseUrlRaw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;

  const dateKey = toDateKey(date);
  const baseUrl = normalizeProxyBaseUrl(baseUrlRaw);
  const url = new URL(`${baseUrl}/timings`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("date", dateKey);
  if (cityHint && cityHint.trim().length > 0) {
    const parts = cityHint
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts[0]) {
      url.searchParams.set("city", parts[0]);
    }
    if (parts.length > 1) {
      url.searchParams.set("country", parts[parts.length - 1]);
    }
  }

  const forcedCityId = toFiniteNumber(process.env.EXPO_PUBLIC_DIYANET_FORCE_CITY_ID);
  if (forcedCityId && forcedCityId > 0) {
    url.searchParams.set("cityId", String(forcedCityId));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  const payload = (await safeJson(response)) as ProxyTimingsResponse | null;

  if (!response.ok) {
    const apiError = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    const details =
      typeof payload?.details === "string" ? ` (${payload.details})` : "";
    throw new Error(`Diyanet proxy error: ${apiError}${details}`);
  }

  const times = parseTimes(payload?.times);
  if (!times) {
    throw new Error("Diyanet proxy response is missing one or more prayer times.");
  }

  if (__DEV__) {
    const cityId = toFiniteNumber(payload?.cityId);
    const source = typeof payload?.source === "string" ? payload.source : "diyanet-proxy";
    console.log(
      `[diyanet] source=${source} cityId=${cityId ?? "unknown"} date=${dateKey} times=${JSON.stringify(times)}`
    );
  }

  return {
    dateKey,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    times
  };
}

export async function getMonthlyTimingsByCoordinates(
  year: number,
  month: number,
  lat: number,
  lon: number,
  cityHint?: string
): Promise<Record<string, Timings>> {
  const baseUrlRaw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;
  const baseUrl = normalizeProxyBaseUrl(baseUrlRaw);
  const url = new URL(`${baseUrl}/timings/monthly`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("year", String(year));
  url.searchParams.set("month", String(month));

  if (cityHint && cityHint.trim().length > 0) {
    const parts = cityHint
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts[0]) {
      url.searchParams.set("city", parts[0]);
    }
    if (parts.length > 1) {
      url.searchParams.set("country", parts[parts.length - 1]);
    }
  }

  const forcedCityId = toFiniteNumber(process.env.EXPO_PUBLIC_DIYANET_FORCE_CITY_ID);
  if (forcedCityId && forcedCityId > 0) {
    url.searchParams.set("cityId", String(forcedCityId));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  const payload = (await safeJson(response)) as ProxyMonthlyTimingsResponse | null;

  if (!response.ok) {
    const apiError = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    const details = typeof payload?.details === "string" ? ` (${payload.details})` : "";
    throw new Error(`Diyanet monthly proxy error: ${apiError}${details}`);
  }

  const monthly = parseMonthlyTimes(payload?.days);
  const keys = Object.keys(monthly);
  if (keys.length === 0) {
    throw new Error("Diyanet monthly proxy response is missing daily timing rows.");
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const mapped: Record<string, Timings> = {};
  for (const dateKey of keys) {
    mapped[dateKey] = {
      dateKey,
      timezone,
      times: monthly[dateKey]
    };
  }

  if (__DEV__) {
    const cityId = toFiniteNumber(payload?.cityId);
    const source = typeof payload?.source === "string" ? payload.source : "diyanet-proxy";
    console.log(`[diyanet] monthly source=${source} cityId=${cityId ?? "unknown"} month=${month}-${year} days=${keys.length}`);
  }

  return mapped;
}
