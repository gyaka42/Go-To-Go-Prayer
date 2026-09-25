const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_ELEMENTS = 2_000;

export function validateMosqueSearchParams({ lat, lon, radiusKm }) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: "Invalid lat" };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: "Invalid lon" };
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 25) {
    return { ok: false, error: "Invalid radiusKm; expected 0.5 through 25" };
  }
  return { ok: true, value: { lat, lon, radiusKm } };
}

export function buildMosqueQuery(lat, lon, radiusKm) {
  const radiusMeters = Math.max(100, Math.round(radiusKm * 1000));
  return `[out:json][timeout:25];(
  node["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
  way["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="place_of_worship"]["religion"="muslim"](around:${radiusMeters},${lat},${lon});
);out center;`;
}

function cacheKey(lat, lon, radiusKm) {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}:${Number(radiusKm.toFixed(1))}`;
}

function sanitizeElement(value) {
  if (!value || typeof value !== "object") return null;
  const type = value.type;
  const id = Number(value.id);
  if (!(["node", "way", "relation"].includes(type)) || !Number.isFinite(id)) return null;

  const result = { type, id };
  if (Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lon))) {
    result.lat = Number(value.lat);
    result.lon = Number(value.lon);
  }
  if (value.center && Number.isFinite(Number(value.center.lat)) && Number.isFinite(Number(value.center.lon))) {
    result.center = { lat: Number(value.center.lat), lon: Number(value.center.lon) };
  }
  if (value.tags && typeof value.tags === "object") {
    result.tags = Object.fromEntries(
      Object.entries(value.tags)
        .filter(([key, item]) => typeof key === "string" && typeof item === "string")
        .slice(0, 100)
    );
  }
  return result;
}

async function fetchEndpoint(fetchImpl, endpoint, query, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "GoToGo-Prayer/1.0 mosque-proxy"
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Overpass HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.elements)) {
      throw new Error("Overpass response is missing elements");
    }
    return payload.elements.map(sanitizeElement).filter(Boolean).slice(0, MAX_ELEMENTS);
  } finally {
    clearTimeout(timeout);
  }
}

export function createMosqueService(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const endpoints = options.endpoints || DEFAULT_ENDPOINTS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs || DEFAULT_CACHE_TTL_MS;
  const staleTtlMs = options.staleTtlMs || DEFAULT_STALE_TTL_MS;
  const now = options.now || Date.now;
  const cache = new Map();
  const inFlight = new Map();

  async function search({ lat, lon, radiusKm, forceRefresh = false }) {
    const key = cacheKey(lat, lon, radiusKm);
    const cached = cache.get(key);
    const ageMs = cached ? now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
    if (!forceRefresh && cached && ageMs <= cacheTtlMs) {
      return { ...cached, source: "cache", stale: false };
    }

    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = (async () => {
      const query = buildMosqueQuery(lat, lon, radiusKm);
      try {
        const elements = await Promise.any(
          endpoints.map((endpoint) => fetchEndpoint(fetchImpl, endpoint, query, timeoutMs))
        );
        const result = {
          elements,
          fetchedAt: now(),
          source: "network",
          stale: false
        };
        cache.set(key, result);
        return result;
      } catch (error) {
        if (cached && ageMs <= staleTtlMs) {
          return { ...cached, source: "cache", stale: true };
        }
        const failures = error instanceof AggregateError ? error.errors.map(String) : [String(error)];
        throw new Error(`Mosque providers unavailable: ${failures.join(" | ")}`);
      }
    })();

    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    search,
    status() {
      return { cacheEntries: cache.size, endpointCount: endpoints.length };
    }
  };
}
