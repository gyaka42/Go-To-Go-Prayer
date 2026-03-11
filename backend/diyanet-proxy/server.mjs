import http from "node:http";

const DIYANET_BASE = "https://awqatsalah.diyanet.gov.tr";
const DIYANET_QURAN_DEFAULT_BASE = "https://api.diyanet.gov.tr";
const QURAN_AUDIO_FALLBACK_ENABLED = String(process.env.QURAN_AUDIO_FALLBACK_ENABLED || "true")
  .trim()
  .toLowerCase() !== "false";
const QURAN_AUDIO_FALLBACK_RECITER = String(process.env.QURAN_AUDIO_FALLBACK_RECITER || "ar.alafasy").trim();
const QURAN_AUDIO_FALLBACK_BITRATE = Number(process.env.QURAN_AUDIO_FALLBACK_BITRATE || 128);
const PORT = Number(process.env.PORT || 3000);
const TIMINGS_CACHE_TTL_MS = Number(process.env.TIMINGS_CACHE_TTL_MS || 12 * 60 * 60 * 1000);
const QURAN_CACHE_TTL_MS = Number(process.env.QURAN_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const QURAN_CACHE_SCHEMA_VERSION = "v3";
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000);

let tokenState = null; // { token: string, expMs: number }
let citiesState = null; // { items: Array<City>, atMs: number }
const timingsCache = new Map(); // key -> { payload, expMs }
const quranCache = new Map(); // key -> { payload, expMs }
const countriesCache = new Map(); // lang -> { atMs, items }
const statesCache = new Map(); // countryId -> { atMs, items }
const districtsCache = new Map(); // stateId -> { atMs, items }

const countryAliases = {
  DE: ["germany", "deutschland", "almanya"],
  NL: ["netherlands", "nederland", "holland", "hollanda"],
  TR: ["turkey", "turkiye", "tuerkiye"],
  GB: ["uk", "unitedkingdom", "england", "birlesikkrallik"],
  US: ["usa", "unitedstates", "amerika"]
};

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendJson(res, 500, { error: "Internal error", details: String(error) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[diyanet-proxy] listening on :${PORT}`);
});

async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (!req.url) {
    sendJson(res, 400, { error: "Missing URL" });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const lang = normalizeLang(url.searchParams.get("lang"));

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "diyanet-proxy",
      at: new Date().toISOString(),
      quranApiConfigured: Boolean(process.env.DIYANET_QURAN_API_KEY?.trim())
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/quran/surahs") {
    const quranConfig = resolveQuranConfig();
    if (!quranConfig.ok) {
      sendJson(res, 503, { error: quranConfig.error });
      return;
    }

    try {
      const items = await fetchQuranSurahs(quranConfig, lang);
      sendJson(res, 200, { items });
    } catch (error) {
      sendJson(res, 502, { error: "Quran upstream failure", details: String(error) });
    }
    return;
  }

  const surahMatch = url.pathname.match(/^\/quran\/surahs\/(\d+)$/);
  if (req.method === "GET" && surahMatch) {
    const surahId = Number(surahMatch[1]);
    if (!Number.isFinite(surahId) || surahId <= 0) {
      sendJson(res, 400, { error: "Invalid surahId" });
      return;
    }

    const quranConfig = resolveQuranConfig();
    if (!quranConfig.ok) {
      sendJson(res, 503, { error: quranConfig.error });
      return;
    }

    try {
      const detail = await fetchQuranSurahDetail(quranConfig, surahId, lang);
      if (!detail || !Array.isArray(detail.verses) || detail.verses.length === 0) {
        sendJson(res, 404, { error: "Surah not found" });
        return;
      }
      sendJson(res, 200, detail);
    } catch (error) {
      sendJson(res, 502, { error: "Quran upstream failure", details: String(error) });
    }
    return;
  }

  const ayahMatch = url.pathname.match(/^\/quran\/ayah\/([^/]+)$/);
  if (req.method === "GET" && ayahMatch) {
    const verseKey = decodeURIComponent(ayahMatch[1] || "").trim();
    if (!isValidVerseKey(verseKey)) {
      sendJson(res, 400, { error: "Invalid verseKey. Expected format like 2:255." });
      return;
    }

    const quranConfig = resolveQuranConfig();
    if (!quranConfig.ok) {
      sendJson(res, 503, { error: quranConfig.error });
      return;
    }

    try {
      const verse = await fetchQuranAyah(quranConfig, verseKey, lang);
      if (!verse) {
        sendJson(res, 404, { error: "Ayah not found" });
        return;
      }
      sendJson(res, 200, verse);
    } catch (error) {
      sendJson(res, 502, { error: "Quran upstream failure", details: String(error) });
    }
    return;
  }

  const audioMatch = url.pathname.match(/^\/quran\/audio\/(\d+)$/);
  if (req.method === "GET" && audioMatch) {
    const surahId = Number(audioMatch[1]);
    if (!Number.isFinite(surahId) || surahId <= 0) {
      sendJson(res, 400, { error: "Invalid surahId" });
      return;
    }

    const quranConfig = resolveQuranConfig();
    if (!quranConfig.ok) {
      sendJson(res, 503, { error: quranConfig.error });
      return;
    }

    try {
      const reciter = String(url.searchParams.get("reciter") || "").trim();
      const audio = await fetchQuranAudio(quranConfig, surahId, reciter || null, lang);
      sendJson(res, 200, audio);
    } catch {
      // Audio is optional for V1; keep the endpoint non-breaking.
      sendJson(res, 200, { available: false });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/locations/countries") {
    const countries = await getImsakiyemCountries(lang);
    sendJson(res, 200, { items: countries });
    return;
  }

  if (req.method === "GET" && url.pathname === "/locations/states") {
    const countryIdQuery = Number(url.searchParams.get("countryId"));
    const countryCode = String(url.searchParams.get("countryCode") || "").trim().toUpperCase();
    const countryName = String(url.searchParams.get("country") || "").trim();

    let countryId = Number.isFinite(countryIdQuery) && countryIdQuery > 0 ? countryIdQuery : null;
    if (!countryId && (countryCode || countryName)) {
      const countries = await getImsakiyemCountries(lang);
      const codeNorm = normalizeText(countryCode);
      const nameNorm = normalizeText(countryName);
      const hit =
        countries.find((item) => normalizeText(item.code) === codeNorm) ||
        countries.find((item) => normalizeText(item.name) === nameNorm) ||
        countries.find((item) => normalizeText(item.name).includes(nameNorm));
      if (hit) {
        countryId = hit.id;
      }
    }

    if (!countryId) {
      sendJson(res, 400, { error: "Missing countryId or resolvable countryCode/country" });
      return;
    }

    const states = await getImsakiyemStates(countryId, lang);
    sendJson(res, 200, { countryId, items: states });
    return;
  }

  if (req.method === "GET" && url.pathname === "/locations/districts") {
    const stateId = Number(url.searchParams.get("stateId"));
    if (!Number.isFinite(stateId) || stateId <= 0) {
      sendJson(res, 400, { error: "Missing stateId" });
      return;
    }

    const districts = await getImsakiyemDistricts(stateId, lang);
    sendJson(res, 200, { stateId, items: districts });
    return;
  }

  if (req.method === "GET" && url.pathname === "/locations/resolve-coordinates") {
    const districtId = Number(url.searchParams.get("districtId"));
    const district = String(url.searchParams.get("district") || "").trim();
    const stateId = Number(url.searchParams.get("stateId"));
    const state = String(url.searchParams.get("state") || "").trim();
    const country = String(url.searchParams.get("country") || "").trim();
    const countryCode = String(url.searchParams.get("countryCode") || "").trim().toUpperCase();

    const resolved = await resolveCoordinatesFromLocationSelection({
      districtId: Number.isFinite(districtId) ? districtId : null,
      district,
      stateId: Number.isFinite(stateId) ? stateId : null,
      state,
      country,
      countryCode,
      lang
    });
    if (!resolved) {
      sendJson(res, 404, { error: "Coordinates not found" });
      return;
    }
    sendJson(res, 200, resolved);
    return;
  }

  if (req.method === "GET" && url.pathname === "/timings/monthly") {
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    const cityIdParam = Number(url.searchParams.get("cityId"));
    const cityQuery = String(url.searchParams.get("city") || "").trim();
    const countryQuery = String(url.searchParams.get("country") || "").trim();
    const countryCodeQuery = String(url.searchParams.get("countryCode") || "").trim().toUpperCase();

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      sendJson(res, 400, { error: "Invalid lat/lon" });
      return;
    }
    if (!Number.isFinite(year) || year < 2000 || year > 2100 || !Number.isFinite(month) || month < 1 || month > 12) {
      sendJson(res, 400, { error: "Invalid year/month" });
      return;
    }

    const requestCacheKey = buildMonthlyRequestCacheKey({
      lat,
      lon,
      year,
      month,
      cityId: cityIdParam,
      city: cityQuery,
      country: countryQuery,
      countryCode: countryCodeQuery
    });
    const cached = getCachedTimingsResponse(requestCacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    const username = process.env.DIYANET_USERNAME?.trim();
    const password = process.env.DIYANET_PASSWORD?.trim();
    if (!username || !password) {
      sendJson(res, 500, { error: "Server not configured (missing DIYANET_USERNAME / DIYANET_PASSWORD)" });
      return;
    }

    const reverse = await reverseGeocode(lat, lon);
    const resolvedCity = cityQuery || reverse.city || "";
    const resolvedCountryCode = countryCodeQuery || reverse.countryCode || "";
    const resolvedCountryName = countryQuery || reverse.country || "";

    let token = null;
    try {
      token = await login(username, password);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[diyanet-proxy] login failed, trying fallback", String(error));
    }

    const cityResolution = token
      ? await resolveCityCandidates({
          token,
          lat,
          lon,
          cityIdParam,
          resolvedCity,
          resolvedCountryCode,
          resolvedCountryName
        })
      : { candidates: [], citiesLoaded: 0 };
    const candidates = cityResolution.candidates.slice(0, 8);

    const ymdStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const attempts = [];
    for (const c of candidates) {
      const monthly = await fetchMonthlyRows(token, c.cityId, ymdStart);
      attempts.push({
        cityId: c.cityId,
        source: c.source,
        endpoint: monthly.endpoint,
        status: monthly.status,
        rows: monthly.rows.length
      });
      if (monthly.rows.length === 0) {
        continue;
      }
      const days = toMonthlyTimesMap(monthly.rows, year, month);
      if (Object.keys(days).length === 0) {
        continue;
      }

      const payload = {
        year,
        month,
        cityId: c.cityId,
        citySource: c.source,
        source: "diyanet-proxy",
        days
      };
      cacheTimingsResponse(requestCacheKey, payload);
      sendJson(res, 200, payload);
      return;
    }

    const fallback = await tryImsakiyemMonthlyFallback({
      lat,
      lon,
      year,
      month,
      city: resolvedCity,
      countryCode: resolvedCountryCode,
      countryName: resolvedCountryName
    });

    if (fallback?.days && Object.keys(fallback.days).length > 0) {
      const payload = {
        year,
        month,
        cityId: fallback.districtId,
        citySource: "imsakiyem-fallback",
        source: "diyanet-proxy",
        days: fallback.days
      };
      cacheTimingsResponse(requestCacheKey, payload);
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 502, {
      error: "No monthly timing rows returned",
      details: {
        lat,
        lon,
        year,
        month,
        resolvedCity,
        resolvedCountryCode,
        resolvedCountryName,
        citiesLoaded: cityResolution.citiesLoaded,
        attempts: attempts.slice(0, 12)
      }
    });
    return;
  }

  if (req.method !== "GET" || url.pathname !== "/timings") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const dateKey = String(url.searchParams.get("date") || "");
  const cityIdParam = Number(url.searchParams.get("cityId"));
  const cityQuery = String(url.searchParams.get("city") || "").trim();
  const countryQuery = String(url.searchParams.get("country") || "").trim();
  const countryCodeQuery = String(url.searchParams.get("countryCode") || "").trim().toUpperCase();

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    sendJson(res, 400, { error: "Invalid lat/lon" });
    return;
  }
  if (!/^\d{2}-\d{2}-\d{4}$/.test(dateKey)) {
    sendJson(res, 400, { error: "Invalid date, expected dd-mm-yyyy" });
    return;
  }

  const requestCacheKey = buildRequestCacheKey({
    lat,
    lon,
    dateKey,
    cityId: cityIdParam,
    city: cityQuery,
    country: countryQuery,
    countryCode: countryCodeQuery
  });
  const cached = getCachedTimingsResponse(requestCacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  const username = process.env.DIYANET_USERNAME?.trim();
  const password = process.env.DIYANET_PASSWORD?.trim();
  if (!username || !password) {
    sendJson(res, 500, { error: "Server not configured (missing DIYANET_USERNAME / DIYANET_PASSWORD)" });
    return;
  }

    const reverse = await reverseGeocode(lat, lon);
    const resolvedCity = cityQuery || reverse.city || "";
    const resolvedCountryCode = countryCodeQuery || reverse.countryCode || "";
    const resolvedCountryName = countryQuery || reverse.country || "";

    let token = null;
    try {
      token = await login(username, password);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[diyanet-proxy] login failed, trying fallback", String(error));
    }

    const cityResolution = token
      ? await resolveCityCandidates({
          token,
          lat,
          lon,
          cityIdParam,
          resolvedCity,
          resolvedCountryCode,
          resolvedCountryName
        })
      : { candidates: [], citiesLoaded: 0 };
    const candidates = cityResolution.candidates.slice(0, 8);

  if (candidates.length === 0) {
    const fallback = await tryImsakiyemFallback({
      lat,
      lon,
      dateKey,
      city: resolvedCity,
      countryCode: resolvedCountryCode,
      countryName: resolvedCountryName
    });

    if (fallback?.times) {
      const payload = {
        dateKey,
        cityId: fallback.districtId,
        citySource: "imsakiyem-fallback",
        source: "diyanet-proxy",
        times: fallback.times
      };
      cacheTimingsResponse(requestCacheKey, payload);
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 502, {
      error: "Could not resolve cityId",
      details: {
        lat,
        lon,
        date: dateKey,
        resolvedCity,
        resolvedCountryCode,
        resolvedCountryName,
        citiesLoaded: cityResolution.citiesLoaded,
        fallback: fallback?.debug ?? null
      }
    });
    return;
  }

  const attempts = [];
  for (const c of candidates) {
    const daily = await fetchDailyRows(token, c.cityId, dateKey);
    attempts.push({
      cityId: c.cityId,
      source: c.source,
      endpoint: daily.endpoint,
      status: daily.status,
      rows: daily.rows.length
    });

    const row = daily.row || (daily.rows.length > 0 ? findByDate(daily.rows, dateKey) : null);
    if (!row) {
      continue;
    }
    const times = mapTimings(row);
    if (!times) {
      continue;
    }

    const payload = {
      dateKey,
      cityId: c.cityId,
      citySource: c.source,
      source: "diyanet-proxy",
      times
    };
    cacheTimingsResponse(requestCacheKey, payload);
    sendJson(res, 200, payload);
    return;
  }

  const fallback = await tryImsakiyemFallback({
    lat,
    lon,
    dateKey,
    city: resolvedCity,
    countryCode: resolvedCountryCode,
    countryName: resolvedCountryName
  });

  if (fallback?.times) {
    const payload = {
      dateKey,
      cityId: fallback.districtId,
      citySource: "imsakiyem-fallback",
      source: "diyanet-proxy",
      times: fallback.times
    };
    cacheTimingsResponse(requestCacheKey, payload);
    sendJson(res, 200, payload);
    return;
  }

  sendJson(res, 502, {
    error: "No timing rows returned",
    details: {
      lat,
      lon,
      date: dateKey,
      resolvedCity,
      resolvedCountryCode,
      resolvedCountryName,
      attempts: attempts.slice(0, 12),
      fallback: fallback?.debug ?? null
    }
  });
}

async function login(username, password) {
  if (tokenState && Date.now() < tokenState.expMs - 60_000) {
    return tokenState.token;
  }

  const paths = ["/api/Auth/Login", "/Auth/Login"];
  const bodies = [
    { email: username, password },
    { Email: username, Password: password },
    { username, password },
    { Username: username, Password: password }
  ];

  let lastStatus = null;
  let lastBody = null;
  for (const path of paths) {
    for (const body of bodies) {
      const response = await fetchWithTimeout(`${DIYANET_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await safeJson(response);
      const token = payload?.data?.accessToken || payload?.accessToken || payload?.token || "";
      const expiresInRaw = Number(payload?.data?.expiresIn || payload?.expiresIn || 3600);
      const expiresIn = Number.isFinite(expiresInRaw) ? expiresInRaw : 3600;
      if (token) {
        tokenState = { token, expMs: Date.now() + expiresIn * 1000 };
        return token;
      }
      lastStatus = response.status;
      lastBody = payload;
    }
  }

  throw new Error(`Diyanet login failed: ${lastStatus} body=${JSON.stringify(lastBody)}`);
}

async function resolveCityIdByGeo(token, lat, lon) {
  const urls = [
    `${DIYANET_BASE}/api/AwqatSalah/CityIdByGeoCode?lat=${lat}&lon=${lon}`,
    `${DIYANET_BASE}/api/AwqatSalah/CityIdByGeoCode?lat=${lat}&lng=${lon}`,
    `${DIYANET_BASE}/api/AwqatSalah/CityIdByGeoCode?latitude=${lat}&longitude=${lon}`
  ];
  for (const url of urls) {
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    const payload = await safeJson(response);
    const id = firstNumber(payload, ["cityId", "cityID", "id"]);
    if (id) {
      return id;
    }
  }
  return null;
}

async function getCities(token) {
  const ttlMs = 6 * 60 * 60 * 1000;
  if (citiesState && Date.now() - citiesState.atMs < ttlMs) {
    return citiesState.items;
  }

  const response = await fetchWithTimeout(`${DIYANET_BASE}/api/Place/Cities`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
  });
  const payload = await safeJson(response);
  const rows = collectObjects(payload);
  const map = new Map();

  for (const row of rows) {
    const id = Number(row?.id || row?.cityId || row?.cityID || row?._id || 0);
    const name = String(row?.name || row?.cityName || row?.city || "").trim();
    const country = String(row?.country || row?.countryName || row?.countryTitle || "").trim();
    const latRaw = Number(row?.latitude ?? row?.lat ?? row?.enlem ?? NaN);
    const lonRaw = Number(row?.longitude ?? row?.lon ?? row?.lng ?? row?.boylam ?? NaN);
    const lat = Number.isFinite(latRaw) ? latRaw : null;
    const lon = Number.isFinite(lonRaw) ? lonRaw : null;

    if (!(id > 0) || !name) {
      continue;
    }
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        country,
        nameNorm: normalizeText(name),
        countryNorm: normalizeText(country),
        lat,
        lon
      });
    }
  }

  const items = Array.from(map.values());
  citiesState = { items, atMs: Date.now() };
  return items;
}

function matchCities(cities, context) {
  const cityNorm = normalizeText(context.city || "");
  const countryNorms = normalizedCountryHints(context.countryCode || "", context.countryName || "");

  const scored = [];
  for (const city of cities) {
    let score = 0;
    if (cityNorm) {
      if (city.nameNorm === cityNorm) {
        score += 100;
      } else if (city.nameNorm.startsWith(cityNorm) || cityNorm.startsWith(city.nameNorm)) {
        score += 60;
      } else if (city.nameNorm.includes(cityNorm) || cityNorm.includes(city.nameNorm)) {
        score += 30;
      }
    }

    for (const cNorm of countryNorms) {
      if (!cNorm || !city.countryNorm) {
        continue;
      }
      if (city.countryNorm === cNorm) {
        score += 25;
      } else if (city.countryNorm.includes(cNorm) || cNorm.includes(city.countryNorm)) {
        score += 10;
      }
    }

    if (Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
      const d = haversineKm(context.lat, context.lon, city.lat, city.lon);
      if (d < 20) {
        score += 20;
      } else if (d < 60) {
        score += 10;
      }
    }

    if (score > 0) {
      scored.push({ cityId: city.id, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map((item) => item.cityId);
}

function nearestCities(cities, lat, lon, limit = 20) {
  return cities
    .filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lon))
    .map((city) => ({ ...city, distKm: haversineKm(lat, lon, city.lat, city.lon) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, limit);
}

async function reverseGeocode(lat, lon) {
  const fromOpenMeteo = async () => {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en&count=1`;
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    return {
      city: String(first?.city || first?.name || first?.admin2 || first?.admin1 || "").trim(),
      country: String(first?.country || "").trim(),
      countryCode: String(first?.country_code || "").trim().toUpperCase()
    };
  };

  const fromNominatim = async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=en`;
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "go-to-go-prayer-diyanet-proxy/1.0"
      }
    });
    const payload = await safeJson(response);
    const address = payload?.address && typeof payload.address === "object" ? payload.address : {};
    const cityRaw =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      payload?.name ||
      "";
    return {
      city: String(cityRaw || "").trim(),
      country: String(address.country || payload?.display_name || "").trim(),
      countryCode: String(address.country_code || "").trim().toUpperCase()
    };
  };

  try {
    const primary = await fromOpenMeteo();
    if (primary.city || primary.countryCode || primary.country) {
      return primary;
    }
  } catch {
    // ignore and try fallback provider
  }

  try {
    const fallback = await fromNominatim();
    if (fallback.city || fallback.countryCode || fallback.country) {
      return fallback;
    }
  } catch {
    // ignore and return empty
  }

  return { city: "", country: "", countryCode: "" };
}

function normalizedCountryHints(countryCode, countryName) {
  const hints = new Set();
  const cc = normalizeText(countryCode);
  const cn = normalizeText(countryName);
  if (cc) {
    hints.add(cc);
    const aliases = countryAliases[countryCode.toUpperCase()] || [];
    for (const alias of aliases) {
      hints.add(normalizeText(alias));
    }
  }
  if (cn) {
    hints.add(cn);
  }
  return Array.from(hints);
}

async function fetchDailyRows(token, cityId, dateKey) {
  const parsedDate = parseDateKey(dateKey);
  const ymdDate = toYmd(dateKey);
  const ymdMonthStart =
    parsedDate && Number.isFinite(parsedDate.year) && Number.isFinite(parsedDate.month)
      ? `${parsedDate.year}-${String(parsedDate.month).padStart(2, "0")}-01`
      : null;

  const endpoints = [
    ymdDate ? `${DIYANET_BASE}/api/PrayerTime/Daily/${cityId}?date=${ymdDate}` : null,
    ymdDate ? `${DIYANET_BASE}/api/AwqatSalah/Daily/${cityId}?date=${ymdDate}` : null,
    ymdMonthStart ? `${DIYANET_BASE}/api/PrayerTime/Monthly/${cityId}?startDate=${ymdMonthStart}` : null,
    ymdMonthStart ? `${DIYANET_BASE}/api/AwqatSalah/Monthly/${cityId}?startDate=${ymdMonthStart}` : null
  ].filter(Boolean);

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
      });
      const payload = await safeJson(response);
      const rows = extractRows(payload);
      if (rows.length === 0) {
        continue;
      }

      const matched = findByDate(rows, dateKey);
      if (!matched) {
        continue;
      }

      return { rows: [matched], row: matched, endpoint, status: response.status };
    } catch {
      continue;
    }
  }

  return { rows: [], row: null, endpoint: null, status: 0 };
}

async function fetchMonthlyRows(token, cityId, ymdStart) {
  const endpoints = [
    `${DIYANET_BASE}/api/PrayerTime/Monthly/${cityId}?startDate=${ymdStart}`,
    `${DIYANET_BASE}/api/AwqatSalah/Monthly/${cityId}?startDate=${ymdStart}`,
    `${DIYANET_BASE}/api/PrayerTime/Monthly/${cityId}`,
    `${DIYANET_BASE}/api/AwqatSalah/Monthly/${cityId}`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
      });
      const payload = await safeJson(response);
      const rows = extractRows(payload);
      if (rows.length > 0) {
        return { rows, endpoint, status: response.status };
      }
    } catch {
      continue;
    }
  }

  return { rows: [], endpoint: null, status: 0 };
}

async function resolveCityCandidates(params) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (id, source) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      candidates.push({ cityId: n, source });
    }
  };

  if (Number.isFinite(params.cityIdParam) && params.cityIdParam > 0) {
    addCandidate(params.cityIdParam, "query-cityId");
  }

  try {
    const byGeo = await resolveCityIdByGeo(params.token, params.lat, params.lon);
    if (byGeo) {
      addCandidate(byGeo, "diyanet-geocode");
    }
  } catch {
    // ignore geocode upstream failures
  }

  let cities = [];
  try {
    cities = await getCities(params.token);
  } catch {
    cities = [];
  }
  const matched = matchCities(cities, {
    lat: params.lat,
    lon: params.lon,
    city: params.resolvedCity,
    countryCode: params.resolvedCountryCode,
    countryName: params.resolvedCountryName
  });
  for (const id of matched) {
    addCandidate(id, "cities-match");
  }

  for (const item of nearestCities(cities, params.lat, params.lon, 30)) {
    addCandidate(item.id, "nearest");
  }

  return {
    candidates: candidates.slice(0, 12),
    citiesLoaded: Array.isArray(cities) ? cities.length : 0
  };
}

async function tryImsakiyemMonthlyFallback(params) {
  const debug = {
    provider: "imsakiyem",
    city: params.city,
    countryCode: params.countryCode,
    countryName: params.countryName
  };

  if (!params.city) {
    return { debug: { ...debug, reason: "missing-city" } };
  }

  const districtCandidates = [];
  const seenDistricts = new Set();
  const addDistrict = (item, source) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const districtId = Number(
      item.districtId ||
        item.DistrictId ||
        item._id ||
        item.id ||
        item.ID ||
        item.placeId ||
        0
    );
    if (!(districtId > 0) || seenDistricts.has(districtId)) {
      return;
    }
    seenDistricts.add(districtId);
    districtCandidates.push({
      districtId,
      name: String(item.districtName || item.name || item.DistrictName || "").trim(),
      stateName: String(item.stateName || item.cityName || item.StateName || "").trim(),
      countryName: String(item.countryName || item.CountryName || "").trim(),
      source
    });
  };

  const districtsSearch = await imsakiyemGet(
    `/api/locations/search/districts?q=${encodeURIComponent(params.city)}`,
    "en"
  );
  for (const item of collectAnyRows(districtsSearch)) {
    addDistrict(item, "search-districts");
  }

  const statesSearch = await imsakiyemGet(
    `/api/locations/search/states?q=${encodeURIComponent(params.city)}`,
    "en"
  );
  const states = collectAnyRows(statesSearch);
  for (const state of states.slice(0, 8)) {
    const stateId = Number(state.stateId || state.state_id || state.id || state.StateId || state._id || 0);
    if (!(stateId > 0)) {
      continue;
    }
    const districtsByState = await imsakiyemGet(`/api/locations/districts?stateId=${stateId}`, "en");
    for (const item of collectAnyRows(districtsByState)) {
      addDistrict(item, "state->districts");
    }
  }

  const countryHints = normalizedCountryHints(params.countryCode, params.countryName);
  const cityNorm = normalizeText(params.city);

  const scored = districtCandidates
    .map((row) => {
      let score = 0;
      const districtNorm = normalizeText(row.name);
      const stateNorm = normalizeText(row.stateName);
      const countryNorm = normalizeText(row.countryName);

      if (districtNorm === cityNorm || stateNorm === cityNorm) {
        score += 100;
      } else if (
        districtNorm.includes(cityNorm) ||
        cityNorm.includes(districtNorm) ||
        stateNorm.includes(cityNorm) ||
        cityNorm.includes(stateNorm)
      ) {
        score += 50;
      }

      for (const hint of countryHints) {
        if (!hint) continue;
        if (countryNorm === hint) {
          score += 25;
        } else if (countryNorm.includes(hint) || hint.includes(countryNorm)) {
          score += 10;
        }
      }

      return { ...row, score };
    })
    .sort((a, b) => b.score - a.score || a.districtId - b.districtId);

  const ymdMonthStart = `${params.year}-${String(params.month).padStart(2, "0")}-01`;
  for (const candidate of scored.slice(0, 8)) {
    const timingsData = await imsakiyemGet(
      `/api/prayer-times/${candidate.districtId}/monthly?startDate=${ymdMonthStart}`,
      "en"
    );
    const timingsRows = collectAnyRows(timingsData);
    if (!Array.isArray(timingsRows) || timingsRows.length === 0) {
      continue;
    }

    const days = toMonthlyTimesMap(timingsRows, params.year, params.month);
    if (Object.keys(days).length === 0) {
      continue;
    }

    return {
      districtId: candidate.districtId,
      days,
      debug: {
        ...debug,
        chosen: candidate.districtId,
        candidateCount: scored.length
      }
    };
  }

  return { debug: { ...debug, reason: "no-usable-monthly-times" } };
}

async function tryImsakiyemFallback(params) {
  const debug = {
    provider: "imsakiyem",
    city: params.city,
    countryCode: params.countryCode,
    countryName: params.countryName
  };

  if (!params.city) {
    return { debug: { ...debug, reason: "missing-city" } };
  }

  const districtCandidates = [];
  const seenDistricts = new Set();
  const addDistrict = (item, source) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const districtId = Number(
      item.districtId ||
        item.DistrictId ||
        item._id ||
        item.id ||
        item.ID ||
        item.placeId ||
        0
    );
    if (!(districtId > 0) || seenDistricts.has(districtId)) {
      return;
    }
    seenDistricts.add(districtId);
    districtCandidates.push({
      districtId,
      name: String(item.districtName || item.name || item.DistrictName || "").trim(),
      stateName: String(item.stateName || item.cityName || item.StateName || "").trim(),
      countryName: String(item.countryName || item.CountryName || "").trim(),
      source
    });
  };

  const districtsSearch = await imsakiyemGet(
    `/api/locations/search/districts?q=${encodeURIComponent(params.city)}`,
    "en"
  );
  for (const item of collectAnyRows(districtsSearch)) {
    addDistrict(item, "search-districts");
  }

  const statesSearch = await imsakiyemGet(
    `/api/locations/search/states?q=${encodeURIComponent(params.city)}`,
    "en"
  );
  const states = collectAnyRows(statesSearch);
  for (const state of states.slice(0, 8)) {
    const stateId = Number(state.stateId || state.state_id || state.id || state.StateId || state._id || 0);
    if (!(stateId > 0)) {
      continue;
    }
    const districtsByState = await imsakiyemGet(`/api/locations/districts?stateId=${stateId}`, "en");
    for (const item of collectAnyRows(districtsByState)) {
      addDistrict(item, "state->districts");
    }
  }

  const countryHints = normalizedCountryHints(params.countryCode, params.countryName);
  const cityNorm = normalizeText(params.city);

  const scored = districtCandidates
    .map((row) => {
      let score = 0;
      const districtNorm = normalizeText(row.name);
      const stateNorm = normalizeText(row.stateName);
      const countryNorm = normalizeText(row.countryName);

      if (districtNorm === cityNorm || stateNorm === cityNorm) {
        score += 100;
      } else if (
        districtNorm.includes(cityNorm) ||
        cityNorm.includes(districtNorm) ||
        stateNorm.includes(cityNorm) ||
        cityNorm.includes(stateNorm)
      ) {
        score += 50;
      }

      for (const hint of countryHints) {
        if (!hint) continue;
        if (countryNorm === hint) {
          score += 25;
        } else if (countryNorm.includes(hint) || hint.includes(countryNorm)) {
          score += 10;
        }
      }

      return { ...row, score };
    })
    .sort((a, b) => b.score - a.score || a.districtId - b.districtId);

  debug.candidateCount = scored.length;
  debug.topCandidates = scored.slice(0, 5).map((item) => ({
    districtId: item.districtId,
    name: item.name,
    stateName: item.stateName,
    countryName: item.countryName,
    score: item.score,
    source: item.source
  }));

  const ymd = toYmd(params.dateKey);
  for (const candidate of scored.slice(0, 8)) {
    const timingsData = await imsakiyemGet(
      `/api/prayer-times/${candidate.districtId}/monthly?startDate=${ymd}`,
      "en"
    );
    const timingsRows = collectAnyRows(timingsData);
    if (!Array.isArray(timingsRows) || timingsRows.length === 0) {
      continue;
    }
    const row = findByDate(timingsRows, params.dateKey);
    if (!row) {
      continue;
    }
    const times = mapTimings(row);
    if (!times) {
      continue;
    }
    return {
      districtId: candidate.districtId,
      times,
      debug: { ...debug, chosen: candidate.districtId }
    };
  }

  return { debug: { ...debug, reason: "no-usable-prayer-times" } };
}

async function getImsakiyemCountries(lang = "en") {
  const ttlMs = 24 * 60 * 60 * 1000;
  const cacheHit = countriesCache.get(lang);
  if (cacheHit && Date.now() - cacheHit.atMs < ttlMs) {
    return cacheHit.items;
  }

  const payload = await imsakiyemGet("/api/locations/countries", lang);
  const rows = collectAnyRows(payload);
  const map = new Map();

  for (const row of rows) {
    const id = Number(row?.countryId || row?.id || row?._id || 0);
    const name = String(row?.countryName || row?.name || "").trim();
    const code = String(row?.countryCode || row?.code || row?.iso2 || "").trim().toUpperCase();
    if (!(id > 0) || !name) continue;
    if (!map.has(id)) {
      map.set(id, { id, name, code });
    }
  }

  const items = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  countriesCache.set(lang, { atMs: Date.now(), items });
  return items;
}

async function getImsakiyemStates(countryId, lang = "en") {
  const ttlMs = 24 * 60 * 60 * 1000;
  const cacheKey = `${countryId}:${lang}`;
  const cacheHit = statesCache.get(cacheKey);
  if (cacheHit && Date.now() - cacheHit.atMs < ttlMs) {
    return cacheHit.items;
  }

  const payload = await imsakiyemGet(`/api/locations/states?countryId=${countryId}`, lang);
  const rows = collectAnyRows(payload);
  const map = new Map();

  for (const row of rows) {
    const id = Number(row?.stateId || row?.state_id || row?.id || row?._id || 0);
    const name = String(row?.stateName || row?.name || "").trim();
    if (!(id > 0) || !name) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        countryId
      });
    }
  }

  const items = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  statesCache.set(cacheKey, { atMs: Date.now(), items });
  return items;
}

async function getImsakiyemDistricts(stateId, lang = "en") {
  const ttlMs = 24 * 60 * 60 * 1000;
  const cacheKey = `${stateId}:${lang}`;
  const cacheHit = districtsCache.get(cacheKey);
  if (cacheHit && Date.now() - cacheHit.atMs < ttlMs) {
    return cacheHit.items;
  }

  const payload = await imsakiyemGet(`/api/locations/districts?stateId=${stateId}`, lang);
  const rows = collectAnyRows(payload);
  const map = new Map();

  for (const row of rows) {
    const id = Number(row?.districtId || row?.id || row?._id || 0);
    const name = String(row?.districtName || row?.name || "").trim();
    const latRaw = Number(row?.latitude ?? row?.lat ?? NaN);
    const lonRaw = Number(row?.longitude ?? row?.lon ?? row?.lng ?? NaN);
    if (!(id > 0) || !name) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        lat: Number.isFinite(latRaw) ? latRaw : null,
        lon: Number.isFinite(lonRaw) ? lonRaw : null
      });
    }
  }

  const items = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  districtsCache.set(cacheKey, { atMs: Date.now(), items });
  return items;
}

async function imsakiyemGet(path, lang = "en") {
  try {
    const response = await fetchWithTimeout(`https://ezanvakti.imsakiyem.com${path}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": `${lang};q=0.9,en;q=0.8,tr;q=0.7`
      }
    });
    if (!response.ok) {
      return null;
    }
    return await safeJson(response);
  } catch {
    return null;
  }
}

function collectAnyRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.value)) return payload.value;

  const obj = payload;
  const nestedArrays = Object.values(obj).filter((value) => Array.isArray(value));
  if (nestedArrays.length > 0) {
    return nestedArrays[0];
  }

  // Deep fallback: find first array node anywhere.
  const queue = [payload];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (Array.isArray(node)) {
      return node;
    }
    if (typeof node !== "object") continue;
    for (const value of Object.values(node)) {
      if (value && (typeof value === "object" || Array.isArray(value))) {
        queue.push(value);
      }
    }
  }
  return [];
}

function toYmd(dateKey) {
  const match = String(dateKey).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    return new Date().toISOString().slice(0, 10);
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

async function resolveCoordinatesFromLocationSelection(params) {
  if (params.stateId && params.districtId) {
    const districts = await getImsakiyemDistricts(params.stateId, params.lang);
    const match = districts.find((item) => item.id === params.districtId);
    if (match && Number.isFinite(match.lat) && Number.isFinite(match.lon)) {
      return { lat: match.lat, lon: match.lon, source: "district-list" };
    }
  }

  const districtClean = cleanDistrictName(params.district);
  const stateClean = cleanDistrictName(params.state);
  const countryClean = cleanDistrictName(params.country);

  const queries = [
    [districtClean, stateClean, countryClean].filter(Boolean).join(", "),
    [districtClean, countryClean].filter(Boolean).join(", "),
    districtClean
  ].filter((query) => query.length > 0);

  if (queries.length === 0) {
    return null;
  }

  for (const query of queries) {
    const geocoded = await geocodeOpenMeteo(query, params.countryCode, params.lang);
    if (geocoded) {
      return { lat: geocoded.lat, lon: geocoded.lon, source: "open-meteo" };
    }
  }

  return null;
}

async function geocodeOpenMeteo(query, countryCode, lang = "en") {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", normalizeLang(lang));
    if (countryCode && countryCode.length === 2) {
      url.searchParams.set("countryCode", countryCode.toUpperCase());
    }
    const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    const lat = Number(first?.latitude);
    const lon = Number(first?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return { lat, lon };
  } catch {
    return null;
  }
}

function resolveQuranConfig() {
  const apiKey = process.env.DIYANET_QURAN_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "Server not configured (missing DIYANET_QURAN_API_KEY)" };
  }
  const primaryBaseUrl = String(process.env.DIYANET_QURAN_API_BASE_URL || DIYANET_QURAN_DEFAULT_BASE)
    .trim()
    .replace(/\/+$/, "");
  const baseUrls = Array.from(
    new Set([
      primaryBaseUrl,
      "https://api.diyanet.gov.tr",
      "https://acikkaynakkuran-dev.diyanet.gov.tr"
    ])
  ).filter((url) => url.length > 0);
  return { ok: true, apiKey, baseUrl: primaryBaseUrl, baseUrls };
}

function quranHeaders(config) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    "x-auth-token": config.apiKey,
    "x-api-key": config.apiKey,
    "x-client-id": "go-to-go-prayer"
  };
}

function cacheQuranResponse(key, payload) {
  quranCache.set(key, {
    payload,
    expMs: Date.now() + QURAN_CACHE_TTL_MS
  });
}

function getCachedQuranResponse(key) {
  const hit = quranCache.get(key);
  if (!hit) {
    return null;
  }
  if (Date.now() > hit.expMs) {
    quranCache.delete(key);
    return null;
  }
  return hit.payload;
}

async function fetchQuranCandidateJson(config, candidates, query) {
  let lastError = null;
  const bases = Array.isArray(config.baseUrls) && config.baseUrls.length > 0 ? config.baseUrls : [config.baseUrl];
  for (const baseUrl of bases) {
    for (const path of candidates) {
      const cacheKey = `quran:${QURAN_CACHE_SCHEMA_VERSION}:${baseUrl}:${path}|${JSON.stringify(query || {})}`;
      const cached = getCachedQuranResponse(cacheKey);
      if (cached) {
        return cached;
      }

      const url = new URL(path, `${baseUrl}/`);
      if (query && typeof query === "object") {
        for (const [key, value] of Object.entries(query)) {
          if (value == null) continue;
          const clean = String(value).trim();
          if (clean.length === 0) continue;
          url.searchParams.set(key, clean);
        }
      }

      for (const method of ["GET"]) {
        try {
          const response = await fetchWithTimeout(url.toString(), {
            method,
            headers: quranHeaders(config)
          });
          if (!response.ok) {
            if (response.status === 404) {
              continue;
            }
            const payload = await safeJson(response);
            lastError = new Error(`HTTP ${response.status} url=${url.toString()} body=${JSON.stringify(payload)}`);
            continue;
          }
          const payload = await safeJson(response);
          if (payload && typeof payload === "object") {
            cacheQuranResponse(cacheKey, payload);
            return payload;
          }
        } catch (error) {
          lastError = error;
        }
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

function getValueByAnyKey(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null) {
      return obj[key];
    }
  }
  return null;
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseVerseKey(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,3})[:\-|](\d{1,3})$/);
  if (!match) {
    return null;
  }
  const surahId = Number(match[1]);
  const ayahNumber = Number(match[2]);
  if (!(surahId > 0) || !(ayahNumber > 0)) {
    return null;
  }
  return { surahId, ayahNumber, key: `${surahId}:${ayahNumber}` };
}

function isValidVerseKey(value) {
  return Boolean(parseVerseKey(value));
}

function normalizeSurahRows(payload) {
  const rows = collectObjects(payload);
  const map = new Map();

  for (const row of rows) {
    const id = toPositiveNumber(
      getValueByAnyKey(row, ["id", "surahId", "surahID", "surah_id", "number", "surahNo", "chapterId", "SureId"])
    );
    const nameArabic = String(
      getValueByAnyKey(row, [
        "nameArabic",
        "name_arabic",
        "arabicName",
        "surahNameArabic",
        "nameAr",
        "SureNameArabic"
      ]) || ""
    ).trim();
    const nameLatin = String(
      getValueByAnyKey(row, [
        "nameLatin",
        "name_latin",
        "name",
        "latinName",
        "surahName",
        "title",
        "nameTr",
        "nameEn",
        "SureNameTurkish",
        "SureNameEnglish"
      ]) || ""
    ).trim();
    const ayahCount = Number(
      getValueByAnyKey(row, ["ayahCount", "verseCount", "numberOfAyahs", "totalAyah", "totalVerse", "AyetCount"]) || 0
    );

    if (!id) continue;
    if (!nameArabic && !nameLatin) continue;
    if (!map.has(id)) {
      map.set(id, {
        id,
        nameArabic: nameArabic || nameLatin || `Surah ${id}`,
        nameLatin: nameLatin || nameArabic || `Surah ${id}`,
        ayahCount: Number.isFinite(ayahCount) && ayahCount > 0 ? ayahCount : 0
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id - b.id);
}

function normalizeVerseRows(payload, fallbackSurahId = null) {
  const rows = collectObjects(payload);
  const map = new Map();

  for (const row of rows) {
    const surahId = toPositiveNumber(
      getValueByAnyKey(row, [
        "surahId",
        "surahID",
        "surah_id",
        "chapterId",
        "sura",
        "surahNumber",
        "chapter_number",
        "SureId"
      ])
    ) || fallbackSurahId;
    const numberInSurah = toPositiveNumber(
      getValueByAnyKey(row, [
        "numberInSurah",
        "ayahNumber",
        "verseNumber",
        "verseNo",
        "number",
        "ayah",
        "verse",
        "verse_id_in_surah",
        "AyetId"
      ])
    );
    const arabicNested = row?.arabic_script && typeof row.arabic_script === "object" ? row.arabic_script : null;
    const translationNested = row?.translation && typeof row.translation === "object" ? row.translation : null;
    const arabic = String(
      getValueByAnyKey(row, [
        "arabic",
        "textArabic",
        "text_arabic",
        "arabicText",
        "ayetTextAr",
        "verseArabic",
        "text"
      ]) ||
        getValueByAnyKey(arabicNested || {}, ["text", "value", "content"]) ||
        ""
    ).trim();
    const translationTr = String(
      getValueByAnyKey(row, [
        "translationTr",
        "meal",
        "textTr",
        "textTurkish",
        "turkish",
        "ayetTextTr"
      ]) ||
        getValueByAnyKey(translationNested || {}, ["text", "value", "content"]) ||
        ""
    ).trim();

    if (!surahId || !numberInSurah || !arabic) {
      continue;
    }
    const key = `${surahId}:${numberInSurah}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        numberInSurah,
        arabic,
        translationTr
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.numberInSurah - b.numberInSurah);
}

function normalizeSurahMeta(payload, surahId, verses) {
  const rows = collectObjects(payload);
  for (const row of rows) {
    const rowId = toPositiveNumber(
      getValueByAnyKey(row, ["id", "surahId", "surahID", "surah_id", "number", "surahNo", "chapterId", "SureId"])
    );
    if (rowId !== surahId) {
      continue;
    }
    const nameArabic = String(
      getValueByAnyKey(row, [
        "nameArabic",
        "name_arabic",
        "arabicName",
        "surahNameArabic",
        "nameAr",
        "SureNameArabic"
      ]) || ""
    ).trim();
    const nameLatin = String(
      getValueByAnyKey(row, [
        "nameLatin",
        "name_latin",
        "name",
        "latinName",
        "surahName",
        "title",
        "nameTr",
        "nameEn",
        "SureNameTurkish",
        "SureNameEnglish"
      ]) || ""
    ).trim();
    const ayahCountRaw = Number(
      getValueByAnyKey(row, ["ayahCount", "verseCount", "numberOfAyahs", "totalAyah", "totalVerse", "AyetCount"]) || 0
    );
    return {
      id: surahId,
      nameArabic: nameArabic || nameLatin || `Surah ${surahId}`,
      nameLatin: nameLatin || nameArabic || `Surah ${surahId}`,
      ayahCount: Number.isFinite(ayahCountRaw) && ayahCountRaw > 0 ? ayahCountRaw : verses.length
    };
  }

  return {
    id: surahId,
    nameArabic: `Surah ${surahId}`,
    nameLatin: `Surah ${surahId}`,
    ayahCount: verses.length
  };
}

function normalizeAudioInfo(payload, fallbackSurahId, fallbackReciter) {
  const rows = collectObjects(payload);
  for (const row of rows) {
    const url = String(
      getValueByAnyKey(row, ["url", "audioUrl", "audio_url", "streamUrl", "mp3", "recitationUrl"]) || ""
    ).trim();
    if (!url || !/^https?:\/\//.test(url)) {
      continue;
    }
    const reciter = String(
      getValueByAnyKey(row, ["reciter", "reader", "reciterName", "readerName", "qari"]) || fallbackReciter || ""
    ).trim();
    return {
      available: true,
      source: "diyanet",
      audio: {
        surahId: fallbackSurahId,
        reciter: reciter || "default",
        url
      }
    };
  }
  return { available: false };
}

function buildSurahAudioFallback(surahId, reciterOverride) {
  const reciter = String(reciterOverride || QURAN_AUDIO_FALLBACK_RECITER || "ar.alafasy").trim();
  const allowedBitrates = new Set([32, 40, 48, 64, 128, 192]);
  const bitrate = allowedBitrates.has(QURAN_AUDIO_FALLBACK_BITRATE) ? QURAN_AUDIO_FALLBACK_BITRATE : 128;
  return {
    available: true,
    source: "fallback",
    audio: {
      surahId,
      reciter,
      url: `https://cdn.islamic.network/quran/audio-surah/${bitrate}/${encodeURIComponent(reciter)}/${surahId}.mp3`
    }
  };
}

const ALQURAN_CLOUD_BASE = "https://api.alquran.cloud/v1";
const ALQURAN_TURKISH_EDITIONS = ["tr.ozturk", "tr.golpinarli", "tr.yazir", "tr.diyanet"];

async function fetchAlQuranCloudData(path) {
  try {
    const response = await fetchWithTimeout(`${ALQURAN_CLOUD_BASE}${path}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const payload = await safeJson(response);
    if (!payload || payload.code !== 200 || !payload.data) {
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

function normalizeTranslationForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”„‟"''`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSingleRepeatedTranslation(verses) {
  const values = verses
    .map((row) => normalizeTranslationForComparison(row.translationTr || ""))
    .filter(Boolean);
  if (values.length < 2) {
    return false;
  }
  return new Set(values).size === 1;
}

async function fetchQuranSurahDetailFallbackFromAlQuranCloud(surahId) {
  const arabicData = await fetchAlQuranCloudData(`/surah/${surahId}/quran-uthmani`);
  const arabicRows = Array.isArray(arabicData?.ayahs) ? arabicData.ayahs : [];
  if (arabicRows.length === 0) {
    return null;
  }

  const arabicByNumber = new Map();
  for (const row of arabicRows) {
    const numberInSurah = toPositiveNumber(row?.numberInSurah);
    const text = String(row?.text || "").trim();
    if (!numberInSurah || !text) continue;
    arabicByNumber.set(numberInSurah, text);
  }

  let trByNumber = new Map();
  for (const edition of ALQURAN_TURKISH_EDITIONS) {
    const trData = await fetchAlQuranCloudData(`/surah/${surahId}/${edition}`);
    const trRows = Array.isArray(trData?.ayahs) ? trData.ayahs : [];
    const map = new Map();
    for (const row of trRows) {
      const numberInSurah = toPositiveNumber(row?.numberInSurah);
      const text = String(row?.text || "").trim();
      if (!numberInSurah || !text) continue;
      map.set(numberInSurah, text);
    }
    if (map.size === 0) {
      continue;
    }
    const uniq = new Set(Array.from(map.values()).map((value) => normalizeTranslationForComparison(value)));
    if (uniq.size > 1 || map.size === 1) {
      trByNumber = map;
      break;
    }
  }
  if (trByNumber.size === 0) {
    return null;
  }

  const upper = Math.max(arabicByNumber.size, trByNumber.size);
  const verses = [];
  for (let n = 1; n <= upper; n += 1) {
    const arabic = arabicByNumber.get(n) || "";
    const translationTr = trByNumber.get(n) || "";
    if (!arabic) continue;
    verses.push({
      key: `${surahId}:${n}`,
      numberInSurah: n,
      arabic,
      translationTr
    });
  }

  if (verses.length === 0) {
    return null;
  }

  return {
    surah: {
      id: surahId,
      nameArabic: String(arabicData?.name || `Surah ${surahId}`),
      nameLatin: String(arabicData?.englishName || `Surah ${surahId}`),
      ayahCount: Number.isFinite(Number(arabicData?.numberOfAyahs))
        ? Number(arabicData.numberOfAyahs)
        : verses.length
    },
    verses
  };
}

async function fetchQuranAyahFallbackFromAlQuranCloud(parsed) {
  const arabicData = await fetchAlQuranCloudData(`/ayah/${parsed.surahId}:${parsed.ayahNumber}/quran-uthmani`);
  let trData = null;
  for (const edition of ALQURAN_TURKISH_EDITIONS) {
    trData = await fetchAlQuranCloudData(`/ayah/${parsed.surahId}:${parsed.ayahNumber}/${edition}`);
    if (String(trData?.text || "").trim().length > 0) {
      break;
    }
  }
  const arabic = String(arabicData?.text || "").trim();
  const translationTr = String(trData?.text || "").trim();
  const numberInSurah = toPositiveNumber(arabicData?.numberInSurah) || toPositiveNumber(trData?.numberInSurah) || parsed.ayahNumber;
  if (!arabic || !numberInSurah) {
    return null;
  }
  return {
    key: `${parsed.surahId}:${numberInSurah}`,
    surahId: parsed.surahId,
    numberInSurah,
    arabic,
    translationTr
  };
}

async function fetchQuranSurahs(config, lang) {
  const payload = await fetchQuranCandidateJson(
    config,
    ["/api/v1/chapters", "/api/surahs", "/api/surah", "/surahs", "/quran/surahs", "/quran/chapters"],
    { lang }
  );
  const items = normalizeSurahRows(payload);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Quran surah list response is empty or not parseable.");
  }
  return items;
}

async function fetchQuranSurahDetail(config, surahId, lang) {
  const candidates = [
    `/api/verses/by-surah/${surahId}`,
    `/api/v1/chapters/${surahId}`,
    `/api/surahs/${surahId}`,
    `/api/surah/${surahId}`,
    `/api/chapters/${surahId}`,
    `/quran/surahs/${surahId}`,
    `/quran/surah/${surahId}`
  ];

  let expectedAyahCount = 0;
  let fromList = null;
  try {
    const allSurahs = await fetchQuranSurahs(config, lang);
    fromList = allSurahs.find((item) => item.id === surahId) || null;
    expectedAyahCount = fromList?.ayahCount > 0 ? fromList.ayahCount : 0;
  } catch {
    // Keep probing endpoints without list metadata.
  }

  let best = null;
  for (const candidate of candidates) {
    let payload = null;
    try {
      payload = await fetchQuranCandidateJson(config, [candidate], { lang, translation: "tr" });
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const verses = normalizeVerseRows(payload, surahId);
    if (!Array.isArray(verses) || verses.length === 0) {
      continue;
    }

    let surah = normalizeSurahMeta(payload, surahId, verses);
    if (fromList) {
      surah = {
        id: surahId,
        nameArabic: fromList.nameArabic || surah.nameArabic,
        nameLatin: fromList.nameLatin || surah.nameLatin,
        ayahCount: fromList.ayahCount > 0 ? fromList.ayahCount : surah.ayahCount
      };
    }

    const current = { surah, verses };
    if (!best || current.verses.length > best.verses.length) {
      best = current;
    }

    if (expectedAyahCount > 0 && current.verses.length >= expectedAyahCount) {
      return current;
    }
  }

  if (best) {
    const isIncomplete = expectedAyahCount > 0 && best.verses.length < expectedAyahCount;
    const hasSuspiciousRepeatedTr = hasSingleRepeatedTranslation(best.verses);
    if (isIncomplete || hasSuspiciousRepeatedTr) {
      const fallback = await fetchQuranSurahDetailFallbackFromAlQuranCloud(surahId);
      if (fallback && fallback.verses.length > 0) {
        if (fromList) {
          fallback.surah = {
            id: surahId,
            nameArabic: fromList.nameArabic || fallback.surah.nameArabic,
            nameLatin: fromList.nameLatin || fallback.surah.nameLatin,
            ayahCount: fromList.ayahCount > 0 ? fromList.ayahCount : fallback.surah.ayahCount
          };
        }
        return fallback;
      }
    }
    return best;
  }

  const fallback = await fetchQuranSurahDetailFallbackFromAlQuranCloud(surahId);
  if (fallback && fallback.verses.length > 0) {
    if (fromList) {
      fallback.surah = {
        id: surahId,
        nameArabic: fromList.nameArabic || fallback.surah.nameArabic,
        nameLatin: fromList.nameLatin || fallback.surah.nameLatin,
        ayahCount: fromList.ayahCount > 0 ? fromList.ayahCount : fallback.surah.ayahCount
      };
    }
    return fallback;
  }

  throw new Error("Surah not found");
}

async function fetchQuranAyah(config, verseKey, lang) {
  const parsed = parseVerseKey(verseKey);
  if (!parsed) {
    return null;
  }

  const candidates = [
    `/api/ayah/${parsed.key}`,
    `/api/ayah/${parsed.surahId}/${parsed.ayahNumber}`,
    `/api/verses/${parsed.key}`,
    `/api/verses/${parsed.surahId}/${parsed.ayahNumber}`,
    `/quran/ayah/${parsed.key}`,
    `/api/v1/chapters/${parsed.surahId}`,
    `/api/verses/by-surah/${parsed.surahId}`
  ];

  for (const candidate of candidates) {
    let payload = null;
    try {
      payload = await fetchQuranCandidateJson(config, [candidate], { lang, translation: "tr" });
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const verses = normalizeVerseRows(payload, parsed.surahId);
    const hit = verses.find((row) => row.numberInSurah === parsed.ayahNumber) || null;
    if (!hit) {
      continue;
    }
    return {
      key: `${parsed.surahId}:${hit.numberInSurah}`,
      surahId: parsed.surahId,
      numberInSurah: hit.numberInSurah,
      arabic: hit.arabic,
      translationTr: hit.translationTr
    };
  }

  try {
    const detail = await fetchQuranSurahDetail(config, parsed.surahId, lang);
    const hit = detail.verses.find((row) => row.numberInSurah === parsed.ayahNumber) || null;
    if (hit) {
      return {
        key: `${parsed.surahId}:${hit.numberInSurah}`,
        surahId: parsed.surahId,
        numberInSurah: hit.numberInSurah,
        arabic: hit.arabic,
        translationTr: hit.translationTr
      };
    }
  } catch {
    // Ignore fallback errors.
  }

  const fallback = await fetchQuranAyahFallbackFromAlQuranCloud(parsed);
  if (fallback) {
    return fallback;
  }

  return null;
}

async function fetchQuranAudio(config, surahId, reciter, lang) {
  try {
    const payload = await fetchQuranCandidateJson(
      config,
      [
        `/api/v1/surah-audio/${surahId}`,
        `/api/audio/surahs/${surahId}`,
        `/api/audio/surah/${surahId}`,
        `/api/surahs/${surahId}/audio`,
        `/api/recitations/surah/${surahId}`,
        `/quran/audio/${surahId}`
      ],
      { lang, reciter: reciter || undefined }
    );
    const normalized = normalizeAudioInfo(payload, surahId, reciter);
    if (normalized.available) {
      return normalized;
    }
  } catch {
    // Continue to fallback.
  }

  if (QURAN_AUDIO_FALLBACK_ENABLED) {
    return buildSurahAudioFallback(surahId, reciter);
  }
  return { available: false };
}

function buildRequestCacheKey(input) {
  const latRounded = Number(input.lat.toFixed(3));
  const lonRounded = Number(input.lon.toFixed(3));
  return [
    input.dateKey,
    latRounded,
    lonRounded,
    Number.isFinite(input.cityId) && input.cityId > 0 ? `cid:${Number(input.cityId)}` : "cid:none",
    `city:${normalizeText(input.city || "")}`,
    `country:${normalizeText(input.country || "")}`,
    `cc:${normalizeText(input.countryCode || "")}`
  ].join("|");
}

function buildMonthlyRequestCacheKey(input) {
  const latRounded = Number(input.lat.toFixed(3));
  const lonRounded = Number(input.lon.toFixed(3));
  return [
    `${input.year}-${String(input.month).padStart(2, "0")}`,
    latRounded,
    lonRounded,
    Number.isFinite(input.cityId) && input.cityId > 0 ? `cid:${Number(input.cityId)}` : "cid:none",
    `city:${normalizeText(input.city || "")}`,
    `country:${normalizeText(input.country || "")}`,
    `cc:${normalizeText(input.countryCode || "")}`
  ].join("|");
}

function getCachedTimingsResponse(key) {
  const hit = timingsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expMs) {
    timingsCache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheTimingsResponse(key, payload) {
  timingsCache.set(key, {
    payload,
    expMs: Date.now() + TIMINGS_CACHE_TTL_MS
  });
}

function extractRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object");
  if (typeof payload !== "object") return [];

  if (Array.isArray(payload.data)) return payload.data.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload.result)) return payload.result.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload.items)) return payload.items.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload.prayerTimeList)) return payload.prayerTimeList.filter((item) => item && typeof item === "object");

  if (hasTimingFields(payload) && hasDateField(payload)) return [payload];
  if (payload.data && typeof payload.data === "object" && hasTimingFields(payload.data) && hasDateField(payload.data)) {
    return [payload.data];
  }

  const deepRows = collectObjects(payload).filter((row) => hasTimingFields(row) && hasDateField(row));
  if (deepRows.length > 0) {
    return deepRows;
  }

  return collectObjects(payload).filter((row) => hasTimingFields(row));
}

function findByDate(rows, target) {
  return rows.find((row) => {
    const raw =
      row?.gregorianDateShortIso8601 ||
      row?.gregorianDateLongIso8601 ||
      row?.gregorianDate ||
      row?.date ||
      row?.day ||
      row?.miladiTarihUzunIso8601;
    return normalizeDate(raw) === target;
  });
}

function normalizeDate(raw) {
  if (raw == null) return null;
  const value = String(raw);
  const ddmmyyyy = value.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (ddmmyyyy) {
    const day = String(Number(ddmmyyyy[1])).padStart(2, "0");
    const month = String(Number(ddmmyyyy[2])).padStart(2, "0");
    return `${day}-${month}-${ddmmyyyy[3]}`;
  }
  const yyyymmdd = value.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (yyyymmdd) {
    const month = String(Number(yyyymmdd[2])).padStart(2, "0");
    const day = String(Number(yyyymmdd[3])).padStart(2, "0");
    return `${day}-${month}-${yyyymmdd[1]}`;
  }
  return null;
}

function mapTimings(row) {
  const times = row?.times && typeof row.times === "object" ? row.times : null;
  const Fajr = parseTime(row?.imsakVakti ?? row?.imsak ?? row?.fajr ?? times?.imsak ?? times?.fajr);
  const Sunrise = parseTime(row?.gunesVakti ?? row?.gunes ?? row?.sunrise ?? times?.gunes ?? times?.sunrise);
  const Dhuhr = parseTime(row?.ogleVakti ?? row?.ogle ?? row?.dhuhr ?? row?.zuhr ?? times?.ogle ?? times?.dhuhr ?? times?.zuhr);
  const Asr = parseTime(row?.ikindiVakti ?? row?.ikindi ?? row?.asr ?? times?.ikindi ?? times?.asr);
  const Maghrib = parseTime(row?.aksamVakti ?? row?.aksam ?? row?.maghrib ?? times?.aksam ?? times?.maghrib);
  const Isha = parseTime(row?.yatsiVakti ?? row?.yatsi ?? row?.isha ?? times?.yatsi ?? times?.isha);

  if (!Fajr || !Sunrise || !Dhuhr || !Asr || !Maghrib || !Isha) {
    return null;
  }
  return { Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha };
}

function toMonthlyTimesMap(rows, year, month) {
  const byDate = {};
  for (const row of rows) {
    const raw =
      row?.gregorianDateShortIso8601 ||
      row?.gregorianDateLongIso8601 ||
      row?.gregorianDate ||
      row?.date ||
      row?.day ||
      row?.miladiTarihUzunIso8601;
    const normalized = normalizeDate(raw);
    if (!normalized) continue;
    const parsed = parseDateKey(normalized);
    if (!parsed) continue;
    if (parsed.year !== year || parsed.month !== month) continue;
    const times = mapTimings(row);
    if (!times) continue;
    byDate[normalized] = times;
  }
  return byDate;
}

function parseDateKey(dateKey) {
  const match = String(dateKey).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3])
  };
}

function parseTime(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

function hasTimingFields(row) {
  return Boolean(
    row?.imsakVakti || row?.imsak || row?.fajr ||
      row?.gunesVakti || row?.gunes || row?.sunrise ||
      row?.ogleVakti || row?.ogle || row?.dhuhr || row?.zuhr ||
      row?.ikindiVakti || row?.ikindi || row?.asr ||
      row?.aksamVakti || row?.aksam || row?.maghrib ||
      row?.yatsiVakti || row?.yatsi || row?.isha
  );
}

function hasDateField(row) {
  return Boolean(
    row?.gregorianDateShortIso8601 ||
      row?.gregorianDateLongIso8601 ||
      row?.gregorianDate ||
      row?.date ||
      row?.day ||
      row?.miladiTarihUzunIso8601
  );
}

function firstNumber(payload, keys) {
  const queue = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;

    for (const key of keys) {
      const n = Number(current[key]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return null;
}

function collectObjects(payload) {
  const queue = [payload];
  const rows = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;
    rows.push(current);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return rows;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLang(raw) {
  const base = String(raw || "en")
    .split(",")[0]
    .split("-")[0]
    .trim()
    .toLowerCase();
  if (base === "tr" || base === "nl" || base === "en") {
    return base;
  }
  return "en";
}

function cleanDistrictName(raw) {
  return String(raw || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*[-/]\s*.*/g, "")
    .replace(/\bmerkez\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
