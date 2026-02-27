import { buildMosquesCacheKey, getCachedJson, saveCachedJson } from "@/services/storage";
import { Mosque } from "@/types/mosque";
import { haversineDistanceKm } from "@/utils/geo";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MOSQUE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_RETRY_DELAYS_MS = [1000, 2000];
const UNKNOWN_MOSQUE_NAME = "Moskee (onbekend)";
const inFlightMosqueRequests = new Map<string, Promise<GetMosquesResult>>();

type GetMosquesParams = {
  lat: number;
  lon: number;
  radiusKm: number;
  forceRefresh?: boolean;
};

type GetMosquesResult = {
  mosques: Mosque[];
  source: "cache" | "network";
  staleFallback?: boolean;
};

type CachedMosquesPayload = {
  fetchedAt: number;
  mosques: Mosque[];
};

type OverpassElement = {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

function normalizeMosqueName(tags?: Record<string, string>): string {
  const rawName = tags?.name?.trim() ?? "";
  return rawName.length > 0 ? rawName : UNKNOWN_MOSQUE_NAME;
}

function getElementCoordinates(element: OverpassElement): { lat: number; lon: number } | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center && typeof element.center.lat === "number" && typeof element.center.lon === "number") {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

function mapOverpassElementsToMosques(elements: OverpassElement[], userLat: number, userLon: number): Mosque[] {
  const now = Date.now();
  const seenIds = new Set<string>();
  const mosques: Mosque[] = [];

  for (const element of elements) {
    const coords = getElementCoordinates(element);
    if (!coords) {
      continue;
    }

    const id = `${element.type}/${element.id}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const distanceKm = haversineDistanceKm(userLat, userLon, coords.lat, coords.lon);
    mosques.push({
      id,
      name: normalizeMosqueName(element.tags),
      lat: coords.lat,
      lon: coords.lon,
      distanceKm: Number(distanceKm.toFixed(3)),
      lastUpdated: now
    });
  }

  mosques.sort((a, b) => a.distanceKm - b.distanceKm);
  return mosques;
}

function buildOverpassQuery(lat: number, lon: number, radiusMeters: number): string {
  return `
[out:json][timeout:25];
(
  node["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
  way["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
);
out center;
`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchMosquesFromOverpassOnce(lat: number, lon: number, radiusKm: number): Promise<Mosque[]> {
  const radiusMeters = Math.max(100, Math.round(radiusKm * 1000));
  const query = buildOverpassQuery(lat, lon, radiusMeters);
  const response = await fetchWithTimeout(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: `data=${encodeURIComponent(query)}`
  }, OVERPASS_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Overpass request failed (${response.status})`);
  }

  const json = (await response.json()) as OverpassResponse;
  const elements = Array.isArray(json.elements) ? json.elements : [];
  return mapOverpassElementsToMosques(elements, lat, lon);
}

async function fetchMosquesFromOverpass(lat: number, lon: number, radiusKm: number): Promise<Mosque[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= OVERPASS_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await delay(OVERPASS_RETRY_DELAYS_MS[attempt - 1]);
    }

    try {
      return await fetchMosquesFromOverpassOnce(lat, lon, radiusKm);
    } catch (error) {
      lastError = error;
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Overpass request timed out (${OVERPASS_TIMEOUT_MS}ms)`
          : String(error);
      console.log(`[mosques] network attempt=${attempt + 1} failed error=${message}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Overpass request failed"));
}

export async function getMosques(params: GetMosquesParams): Promise<GetMosquesResult> {
  const startedAt = Date.now();
  const forceRefresh = params.forceRefresh === true;
  const cacheKey = buildMosquesCacheKey(params.lat, params.lon, params.radiusKm);
  const existingInFlight = inFlightMosqueRequests.get(cacheKey);
  if (existingInFlight) {
    console.log(`[mosques] in-flight reuse key=${cacheKey}`);
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<GetMosquesResult> => {
    const cached = await getCachedJson<CachedMosquesPayload>(cacheKey);
    const hasUsableCache =
      cached && Array.isArray(cached.mosques) && Date.now() - cached.fetchedAt <= MOSQUE_CACHE_TTL_MS;

    if (!forceRefresh) {
      if (hasUsableCache) {
        console.log(
          `[mosques] cache hit key=${cacheKey} count=${cached.mosques.length} durationMs=${Date.now() - startedAt}`
        );
        return { mosques: cached.mosques, source: "cache" };
      }
      console.log(`[mosques] cache miss key=${cacheKey}`);
    } else {
      console.log(`[mosques] force refresh key=${cacheKey}`);
    }

    try {
      const mosques = await fetchMosquesFromOverpass(params.lat, params.lon, params.radiusKm);
      const payload: CachedMosquesPayload = {
        fetchedAt: Date.now(),
        mosques
      };
      await saveCachedJson(cacheKey, payload);

      console.log(
        `[mosques] network success key=${cacheKey} count=${mosques.length} source=network durationMs=${Date.now() - startedAt}`
      );
      return { mosques, source: "network" };
    } catch (error) {
      if (hasUsableCache) {
        console.log(
          `[mosques] stale cache fallback key=${cacheKey} count=${cached.mosques.length} durationMs=${Date.now() - startedAt}`
        );
        return {
          mosques: cached.mosques,
          source: "cache",
          staleFallback: true
        };
      }
      throw error;
    }
  })();

  inFlightMosqueRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightMosqueRequests.delete(cacheKey);
  }
}

export async function devTestGetMosquesAmsterdam(radiusKm = 5): Promise<GetMosquesResult> {
  return getMosques({
    lat: 52.3676,
    lon: 4.9041,
    radiusKm,
    forceRefresh: true
  });
}
