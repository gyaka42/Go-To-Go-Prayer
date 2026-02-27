import { PrayerName, Timings } from "@/types/prayer";

const REQUIRED_PRAYERS: PrayerName[] = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const DEFAULT_DIYANET_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";
const runtimeCityIdByLocation = new Map<string, number>();

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

function locationRuntimeKey(lat: number, lon: number): string {
  const latRounded = Number(lat.toFixed(2));
  const lonRounded = Number(lon.toFixed(2));
  return `${latRounded}|${lonRounded}`;
}

function buildCityHintParams(cityHint?: string): { city?: string; country?: string } {
  if (!cityHint || cityHint.trim().length === 0) {
    return {};
  }
  const parts = cityHint
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return {
    city: parts[0],
    country: parts.length > 1 ? parts[parts.length - 1] : undefined
  };
}

async function resolveCityIdProbe(
  lat: number,
  lon: number,
  cityHint?: string
): Promise<number | null> {
  const baseUrlRaw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;
  const baseUrl = normalizeProxyBaseUrl(baseUrlRaw);
  const now = new Date();
  const probeDate = new Date(now.getFullYear(), now.getMonth(), Math.min(15, now.getDate()));
  const dateKey = toDateKey(probeDate);
  const hint = buildCityHintParams(cityHint);

  const url = new URL(`${baseUrl}/timings`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("date", dateKey);
  if (hint.city) {
    url.searchParams.set("city", hint.city);
  }
  if (hint.country) {
    url.searchParams.set("country", hint.country);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const payload = (await safeJson(response)) as ProxyTimingsResponse | null;
    if (!response.ok) {
      return null;
    }
    return toFiniteNumber(payload?.cityId);
  } catch {
    return null;
  }
}

export async function getTimingsByCoordinates(
  date: Date,
  lat: number,
  lon: number,
  cityHint?: string
): Promise<Timings> {
  const baseUrlRaw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;

  const runtimeKey = locationRuntimeKey(lat, lon);
  const dateKey = toDateKey(date);
  const baseUrl = normalizeProxyBaseUrl(baseUrlRaw);
  const url = new URL(`${baseUrl}/timings`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("date", dateKey);
  const hint = buildCityHintParams(cityHint);
  if (hint.city) {
    url.searchParams.set("city", hint.city);
  }
  if (hint.country) {
    url.searchParams.set("country", hint.country);
  }

  const forcedCityId = toFiniteNumber(process.env.EXPO_PUBLIC_DIYANET_FORCE_CITY_ID);
  const runtimeCityId = runtimeCityIdByLocation.get(runtimeKey) ?? null;
  const cityIdToUse = forcedCityId && forcedCityId > 0 ? forcedCityId : runtimeCityId;
  if (cityIdToUse && cityIdToUse > 0) {
    url.searchParams.set("cityId", String(cityIdToUse));
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

  const resolvedCityId = toFiniteNumber(payload?.cityId);
  if (cityIdToUse && resolvedCityId && resolvedCityId !== cityIdToUse) {
    throw new Error(`Diyanet proxy returned different cityId (${resolvedCityId}) than requested (${cityIdToUse}).`);
  }
  if (resolvedCityId && resolvedCityId > 0) {
    runtimeCityIdByLocation.set(runtimeKey, resolvedCityId);
  }

  if (__DEV__) {
    const cityId = resolvedCityId;
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
  const runtimeKey = locationRuntimeKey(lat, lon);
  const baseUrlRaw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;
  const baseUrl = normalizeProxyBaseUrl(baseUrlRaw);
  const url = new URL(`${baseUrl}/timings/monthly`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("year", String(year));
  url.searchParams.set("month", String(month));

  const hint = buildCityHintParams(cityHint);
  if (hint.city) {
    url.searchParams.set("city", hint.city);
  }
  if (hint.country) {
    url.searchParams.set("country", hint.country);
  }

  const forcedCityId = toFiniteNumber(process.env.EXPO_PUBLIC_DIYANET_FORCE_CITY_ID);
  const runtimeCityId = runtimeCityIdByLocation.get(runtimeKey) ?? null;
  let cityIdToUse = forcedCityId && forcedCityId > 0 ? forcedCityId : runtimeCityId;
  if (!cityIdToUse) {
    const probed = await resolveCityIdProbe(lat, lon, cityHint);
    if (probed && probed > 0) {
      cityIdToUse = probed;
      runtimeCityIdByLocation.set(runtimeKey, probed);
    }
  }
  if (cityIdToUse && cityIdToUse > 0) {
    url.searchParams.set("cityId", String(cityIdToUse));
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

  const resolvedCityId = toFiniteNumber(payload?.cityId);
  if (cityIdToUse && resolvedCityId && resolvedCityId !== cityIdToUse) {
    throw new Error(`Diyanet monthly proxy returned different cityId (${resolvedCityId}) than requested (${cityIdToUse}).`);
  }
  if (resolvedCityId && resolvedCityId > 0) {
    runtimeCityIdByLocation.set(runtimeKey, resolvedCityId);
  }

  if (__DEV__) {
    const cityId = resolvedCityId;
    const source = typeof payload?.source === "string" ? payload.source : "diyanet-proxy";
    console.log(`[diyanet] monthly source=${source} cityId=${cityId ?? "unknown"} month=${month}-${year} days=${keys.length}`);
  }

  return mapped;
}
