import * as Location from "expo-location";
import { PrayerName, Timings } from "@/types/prayer";

const BASE_URL = "https://awqatsalah.diyanet.gov.tr";
const REQUIRED_PRAYERS: PrayerName[] = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

type TokenState = {
  accessToken: string;
  expiresAtMs: number;
} | null;

type DiyanetCity = {
  id: number;
  name: string;
  country?: string;
  lat?: number;
  lon?: number;
};

let tokenState: TokenState = null;
let cityCache: DiyanetCity[] | null = null;
const cityDetailCache = new Map<number, string>();

function toDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function parseHHmm(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseDateLike(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const ddmmyyyy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[1]}-${ddmmyyyy[2]}-${ddmmyyyy[3]}`;
  }

  const yyyymmdd = raw.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[3]}-${yyyymmdd[2]}-${yyyymmdd[1]}`;
  }

  return null;
}

function maybeExtractNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toFiniteNumber(raw: unknown): number | undefined {
  const n = maybeExtractNumber(raw);
  return n !== null && Number.isFinite(n) ? n : undefined;
}

function firstNumberFromPayload(payload: unknown, preferredKeys: string[]): number | null {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of preferredKeys) {
      const fromPreferred = maybeExtractNumber(record[key]);
      if (fromPreferred !== null) {
        return fromPreferred;
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return null;
}

function collectPossibleDayRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const directCandidates = ["prayerTimeList", "data", "result", "items", "list", "value"];
  for (const key of directCandidates) {
    if (Array.isArray(root[key])) {
      return root[key].filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
    }
  }

  return [root];
}

function buildNormalizedRowIndex(row: Record<string, unknown>): Record<string, { rawKey: string; value: unknown }> {
  const index: Record<string, { rawKey: string; value: unknown }> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const normalizedKey = normalizeText(rawKey);
    if (!normalizedKey || index[normalizedKey]) {
      continue;
    }
    index[normalizedKey] = { rawKey, value };
  }
  return index;
}

function getValueByCandidates(row: Record<string, unknown>, candidates: string[]): unknown {
  const index = buildNormalizedRowIndex(row);
  for (const candidate of candidates) {
    const hit = index[normalizeText(candidate)];
    if (hit) {
      return hit.value;
    }
  }
  return undefined;
}

function pickTime(
  index: Record<string, { rawKey: string; value: unknown }>,
  candidates: string[]
): { time: string; field: string } | null {
  for (const candidate of candidates) {
    const entry = index[normalizeText(candidate)];
    if (!entry) {
      continue;
    }
    const parsed = parseHHmm(entry.value);
    if (parsed) {
      return { time: parsed, field: entry.rawKey };
    }
  }
  return null;
}

function parseTimingsFromRow(
  row: Record<string, unknown>
): { times: Record<PrayerName, string>; fields: Record<PrayerName, string> } | null {
  const index = buildNormalizedRowIndex(row);

  const fajr = pickTime(index, ["imsakVakti", "ImsakVakti", "imsak", "fajr"]);
  const sunrise = pickTime(index, ["gunesVakti", "GunesVakti", "gunes", "sunrise"]);
  const dhuhr = pickTime(index, ["ogleVakti", "OgleVakti", "ogle", "dhuhr", "zuhr"]);
  const asr = pickTime(index, ["ikindiVakti", "IkindiVakti", "ikindi", "asr"]);
  const maghrib = pickTime(index, ["aksamVakti", "AksamVakti", "aksam", "maghrib"]);
  const isha = pickTime(index, ["yatsiVakti", "YatsiVakti", "yatsi", "isha"]);

  if (!fajr || !sunrise || !dhuhr || !asr || !maghrib || !isha) {
    return null;
  }

  return {
    times: {
      Fajr: fajr.time,
      Sunrise: sunrise.time,
      Dhuhr: dhuhr.time,
      Asr: asr.time,
      Maghrib: maghrib.time,
      Isha: isha.time
    },
    fields: {
      Fajr: fajr.field,
      Sunrise: sunrise.field,
      Dhuhr: dhuhr.field,
      Asr: asr.field,
      Maghrib: maghrib.field,
      Isha: isha.field
    }
  };
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (!response.ok) {
    let details = "";
    try {
      const bodyText = await response.text();
      if (bodyText) {
        details = ` - ${bodyText.slice(0, 250)}`;
      }
    } catch {
      // Ignore parse errors and keep status-only message.
    }
    throw new Error(`Diyanet API error: ${response.status}${details}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Diyanet API returned non-JSON response.");
  }
}

async function login(): Promise<void> {
  if (tokenState && Date.now() < tokenState.expiresAtMs - 60_000) {
    return;
  }

  const username = process.env.EXPO_PUBLIC_DIYANET_USERNAME?.trim();
  const password = process.env.EXPO_PUBLIC_DIYANET_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error("Diyanet credentials missing. Set EXPO_PUBLIC_DIYANET_USERNAME and EXPO_PUBLIC_DIYANET_PASSWORD.");
  }

  const paths = ["/api/Auth/Login", "/Auth/Login"];
  const payloadCandidates = [
    { email: username, password },
    { Email: username, Password: password },
    { username, password },
    { Username: username, Password: password }
  ];
  let lastError: unknown = null;

  for (const path of paths) {
    for (const requestBody of payloadCandidates) {
      try {
        const payload = (await fetchJson(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(requestBody)
        })) as Record<string, unknown>;

        const container = (payload?.data ?? payload) as Record<string, unknown>;
        const token = String(container?.accessToken ?? container?.token ?? "").trim();
        const expiresInSeconds =
          maybeExtractNumber(container?.expiresIn ?? container?.expires ?? container?.expireIn) ?? 3600;
        if (!token) {
          throw new Error("Diyanet login succeeded but token is missing.");
        }

        tokenState = {
          accessToken: token,
          expiresAtMs: Date.now() + expiresInSeconds * 1000
        };
        return;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(`Diyanet login failed: ${String(lastError)}`);
}

async function authedJson(path: string): Promise<unknown> {
  await login();
  if (!tokenState?.accessToken) {
    throw new Error("Diyanet token unavailable.");
  }

  return fetchJson(path, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${tokenState.accessToken}`
    }
  });
}

async function resolveCityIdByGeocode(lat: number, lon: number): Promise<number | null> {
  const variants = [
    `/api/AwqatSalah/CityIdByGeoCode?lat=${lat}&lon=${lon}`,
    `/api/AwqatSalah/CityIdByGeoCode?lat=${lat}&lng=${lon}`,
    `/api/AwqatSalah/CityIdByGeoCode?latitude=${lat}&longitude=${lon}`
  ];

  for (const path of variants) {
    try {
      const payload = await authedJson(path);
      const cityId = firstNumberFromPayload(payload, ["cityId", "cityID", "id"]);
      if (cityId !== null && cityId > 0) {
        return cityId;
      }
    } catch {
      // Try next variant.
    }
  }

  return null;
}

function collectObjectTree(payload: unknown): Array<Record<string, unknown>> {
  const queue: unknown[] = [payload];
  const rows: Array<Record<string, unknown>> = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    const row = current as Record<string, unknown>;
    rows.push(row);
    for (const value of Object.values(row)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return rows;
}

function parseCityFromRecord(row: Record<string, unknown>): DiyanetCity | null {
  const id = maybeExtractNumber(
    row.id ?? row.cityId ?? row.cityID ?? row.placeId ?? row.locationId
  );
  const name = String(
    row.cityName ?? row.name ?? row.city ?? row.locationName ?? ""
  ).trim();

  if (!id || !name) {
    return null;
  }

  const country = String(
    row.countryName ?? row.country ?? row.countryTitle ?? ""
  ).trim();
  const lat = toFiniteNumber(row.latitude ?? row.lat ?? row.enlem);
  const lon = toFiniteNumber(row.longitude ?? row.lon ?? row.lng ?? row.boylam);

  return {
    id,
    name,
    country: country || undefined,
    lat,
    lon
  };
}

function toHintCandidates(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const raw = text.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function cityNameMatchScore(city: DiyanetCity, hints: string[]): number {
  const cityNorm = normalizeText(city.name);
  if (!cityNorm) {
    return 0;
  }

  let best = 0;
  for (const hint of hints) {
    const hintNorm = normalizeText(hint);
    if (!hintNorm) {
      continue;
    }
    if (cityNorm === hintNorm) {
      best = Math.max(best, 3);
      continue;
    }
    if (cityNorm.startsWith(hintNorm) || hintNorm.startsWith(cityNorm)) {
      best = Math.max(best, 2);
      continue;
    }
    if (cityNorm.includes(hintNorm) || hintNorm.includes(cityNorm)) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

function resolveCityIdByHints(
  cities: DiyanetCity[],
  hintCandidates: string[],
  countryHint: string | undefined,
  lat: number,
  lon: number
): number | null {
  const countryNorm = countryHint ? normalizeText(countryHint) : "";

  const scored = cities
    .map((city) => {
      const score = cityNameMatchScore(city, hintCandidates);
      const countryScore =
        countryNorm && city.country
          ? (normalizeText(city.country).includes(countryNorm) || countryNorm.includes(normalizeText(city.country)) ? 1 : 0)
          : 0;
      const distance =
        city.lat !== undefined && city.lon !== undefined
          ? haversineKm(lat, lon, city.lat, city.lon)
          : Number.POSITIVE_INFINITY;
      return { city, score, countryScore, distance };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.countryScore !== a.countryScore) {
        return b.countryScore - a.countryScore;
      }
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return a.city.id - b.city.id;
    });

  return scored[0]?.city.id ?? null;
}

function bestNearestCityId(cities: DiyanetCity[], lat: number, lon: number): number | null {
  const withCoords = cities.filter((city) => city.lat !== undefined && city.lon !== undefined);
  if (withCoords.length === 0) {
    return null;
  }
  const sorted = withCoords
    .map((city) => ({
      city,
      distance: haversineKm(lat, lon, city.lat as number, city.lon as number)
    }))
    .sort((a, b) => a.distance - b.distance);

  // Avoid wild matches across countries/continents.
  if (sorted[0].distance > 150) {
    return null;
  }
  return sorted[0].city.id;
}

function cityMatchesHints(city: DiyanetCity, hintCandidates: string[]): boolean {
  return cityNameMatchScore(city, hintCandidates) > 0;
}

async function listCities(): Promise<DiyanetCity[]> {
  if (cityCache) {
    return cityCache;
  }

  const payload = await authedJson("/api/Place/Cities");
  const parsed = collectObjectTree(payload)
    .map((row) => parseCityFromRecord(row))
    .filter((item): item is DiyanetCity => item !== null);

  cityCache = parsed.filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index);
  return cityCache;
}

async function resolveCityIdByReverseGeocode(
  lat: number,
  lon: number,
  explicitCityHint?: string
): Promise<number | null> {
  const cities = await listCities();
  if (cities.length === 0) {
    return null;
  }

  let reverse: Location.LocationGeocodedAddress[] = [];
  try {
    reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
  } catch {
    reverse = [];
  }
  const first = reverse[0];
  const nameCandidates = [
    ...toHintCandidates(explicitCityHint),
    first?.city ?? "",
    first?.subregion ?? "",
    first?.region ?? ""
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  if (nameCandidates.length === 0) {
    return null;
  }

  const countryHint = [first?.country, first?.isoCountryCode]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .join(" ");

  const fromHints = resolveCityIdByHints(cities, nameCandidates, countryHint || undefined, lat, lon);
  if (fromHints) {
    return fromHints;
  }

  return bestNearestCityId(cities, lat, lon);
}

async function resolveCityId(lat: number, lon: number, cityHint?: string): Promise<number> {
  const forced = maybeExtractNumber(process.env.EXPO_PUBLIC_DIYANET_FORCE_CITY_ID);
  if (forced && forced > 0) {
    return forced;
  }

  const cities = await listCities();
  if (cities.length > 0) {
    const hintCandidates = toHintCandidates(cityHint);
    const hintOnly = resolveCityIdByHints(cities, hintCandidates, undefined, lat, lon);
    if (hintOnly) {
      return hintOnly;
    }
  }

  const fromReverse = await resolveCityIdByReverseGeocode(lat, lon, cityHint);
  if (fromReverse) {
    return fromReverse;
  }

  const fromGeo = await resolveCityIdByGeocode(lat, lon);
  if (fromGeo) {
    if (cities.length > 0 && cityHint) {
      const hinted = toHintCandidates(cityHint);
      const geoCity = cities.find((city) => city.id === fromGeo);
      if (geoCity && !cityMatchesHints(geoCity, hinted)) {
        const hintMatch = resolveCityIdByHints(cities, hinted, undefined, lat, lon);
        if (hintMatch) {
          return hintMatch;
        }
      }
    }
    return fromGeo;
  }

  const configured = maybeExtractNumber(process.env.EXPO_PUBLIC_DIYANET_CITY_ID);
  if (configured && configured > 0) {
    return configured;
  }

  throw new Error("Diyanet cityId could not be resolved. Set EXPO_PUBLIC_DIYANET_CITY_ID.");
}

async function fetchDailyRows(cityId: number): Promise<{ rows: Array<Record<string, unknown>>; usedPath: string }> {
  const paths = [`/api/PrayerTime/Daily/${cityId}`, `/api/AwqatSalah/Daily/${cityId}`];
  let lastError: unknown = null;

  for (const path of paths) {
    try {
      const payload = await authedJson(path);
      const rows = collectPossibleDayRows(payload);
      if (rows.length > 0) {
        return { rows, usedPath: path };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Diyanet daily timings unavailable: ${String(lastError)}`);
}

async function getCityDetailLabel(cityId: number): Promise<string> {
  const cached = cityDetailCache.get(cityId);
  if (cached) {
    return cached;
  }
  try {
    const payload = (await authedJson(`/api/Place/CityDetail/${cityId}`)) as Record<string, unknown>;
    const data = (payload?.data ?? payload) as Record<string, unknown>;
    const name = String(data?.name ?? "").trim();
    const city = String(data?.city ?? "").trim();
    const country = String(data?.country ?? "").trim();
    const parts = [name, city, country].filter((item) => item.length > 0);
    const label = parts.length > 0 ? parts.join(", ") : `cityId=${cityId}`;
    cityDetailCache.set(cityId, label);
    return label;
  } catch {
    const fallback = `cityId=${cityId}`;
    cityDetailCache.set(cityId, fallback);
    return fallback;
  }
}

export async function getTimingsByCoordinates(
  date: Date,
  lat: number,
  lon: number,
  cityHint?: string
): Promise<Timings> {
  const cityId = await resolveCityId(lat, lon, cityHint);
  const { rows, usedPath } = await fetchDailyRows(cityId);
  const wantedDateKey = toDateKey(date);

  const datedRows = rows
    .map((row) => {
      const rawDate =
        getValueByCandidates(row, [
          "gregorianDateShortIso8601",
          "gregorianDateShort",
          "gregorianDateLongIso8601",
          "gregorianDateLong",
          "gregorianDate",
          "date",
          "day",
          "miladiTarihUzunIso8601"
        ]) ?? "";
      const dateKey = parseDateLike(
        String(rawDate)
      );
      return { row, dateKey };
    })
    .filter((item) => item.dateKey !== null);

  const selected =
    datedRows.find((item) => item.dateKey === wantedDateKey)?.row ??
    rows.find((row) => parseTimingsFromRow(row) !== null);

  if (!selected) {
    throw new Error("Diyanet response does not contain a usable day entry.");
  }

  const parsed = parseTimingsFromRow(selected);
  if (!parsed || REQUIRED_PRAYERS.some((prayer) => !parsed.times[prayer])) {
    throw new Error("Diyanet response is missing one or more prayer times.");
  }

  if (__DEV__) {
    const cityLabel = await getCityDetailLabel(cityId);
    console.log(
      `[diyanet] cityId=${cityId} city="${cityLabel}" hint="${cityHint ?? ""}" date=${wantedDateKey} endpoint=${usedPath} matchedDate=${datedRows.find((item) => item.row === selected)?.dateKey ?? "fallback-first-row"} fields=${JSON.stringify(parsed.fields)} times=${JSON.stringify(parsed.times)}`
    );
  }

  return {
    dateKey: wantedDateKey,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    times: parsed.times
  };
}
