const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function nominatimViewbox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const longitudeScale = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusKm / (111.32 * longitudeScale);
  return [lon - lonDelta, lat + latDelta, lon + lonDelta, lat - latDelta].join(",");
}

function nominatimRowToElement(row) {
  if (!row || typeof row !== "object") return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const id = Number(row.osm_id);
  const typeMap = { N: "node", W: "way", R: "relation" };
  const type = typeMap[row.osm_type] || row.osm_type;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(id)) return null;
  if (!(type === "node" || type === "way" || type === "relation")) return null;

  const extra = row.extratags && typeof row.extratags === "object" ? row.extratags : {};
  const religion = String(extra.religion || "").toLowerCase();
  const denomination = String(extra.denomination || "").toLowerCase();
  const name = String(row.name || row.namedetails?.name || row.display_name?.split(",")[0] || "").trim();
  const looksMuslim =
    religion === "muslim" ||
    /(^|[;, ])(sunni|shia|shiite|alevi)([;, ]|$)/.test(denomination) ||
    /\b(mosque|masjid|moskee|cami|camii)\b/i.test(name);
  if (!looksMuslim) return null;

  return {
    type,
    id,
    lat,
    lon,
    tags: {
      name: name || "Mosque",
      religion: "muslim"
    }
  };
}

async function fetchNominatim(fetchImpl, endpoint, lat, lon, radiusKm, timeoutMs) {
  const url = new URL(endpoint);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", "[place_of_worship]");
  url.searchParams.set("viewbox", nominatimViewbox(lat, lon, radiusKm));
  url.searchParams.set("bounded", "1");
  url.searchParams.set("limit", "50");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("extratags", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "GoToGo-Prayer/1.0 mosque-proxy"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Nominatim response is not a list");
    const elements = payload.map(nominatimRowToElement).filter(Boolean).slice(0, 50);
    if (elements.length === 0) throw new Error("Nominatim returned no matching mosques");
    return elements;
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
  const nominatimEnabled = options.nominatimEnabled !== false;
  const nominatimUrl = options.nominatimUrl || DEFAULT_NOMINATIM_URL;
  const nominatimDelayMs = options.nominatimDelayMs ?? 3_000;
  const now = options.now || Date.now;
  const cache = new Map();
  const inFlight = new Map();
  let nominatimQueue = Promise.resolve();
  let lastNominatimRequestAt = 0;

  function scheduleNominatim(task) {
    const scheduled = nominatimQueue.then(async () => {
      const waitMs = Math.max(0, 1_000 - (Date.now() - lastNominatimRequestAt));
      if (waitMs > 0) await delay(waitMs);
      lastNominatimRequestAt = Date.now();
      return task();
    });
    nominatimQueue = scheduled.catch(() => undefined);
    return scheduled;
  }

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
        let settled = false;
        const attempts = endpoints.map(async (endpoint) => ({
          elements: await fetchEndpoint(fetchImpl, endpoint, query, timeoutMs),
          provider: "overpass"
        }));
        if (nominatimEnabled) {
          attempts.push(
            delay(nominatimDelayMs).then(() =>
              settled
                ? Promise.reject(new Error("Nominatim fallback was not needed"))
                : scheduleNominatim(async () => ({
                    elements: await fetchNominatim(fetchImpl, nominatimUrl, lat, lon, radiusKm, timeoutMs),
                    provider: "nominatim"
                  }))
            )
          );
        }
        const winner = await Promise.any(attempts);
        settled = true;
        const result = {
          elements: winner.elements,
          fetchedAt: now(),
          source: "network",
          stale: false,
          provider: winner.provider
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
      return { cacheEntries: cache.size, endpointCount: endpoints.length + (nominatimEnabled ? 1 : 0) };
    }
  };
}
