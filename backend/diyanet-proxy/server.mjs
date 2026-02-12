import http from "node:http";

const DIYANET_BASE = "https://awqatsalah.diyanet.gov.tr";
const PORT = Number(process.env.PORT || 3000);
const TIMINGS_CACHE_TTL_MS = Number(process.env.TIMINGS_CACHE_TTL_MS || 12 * 60 * 60 * 1000);

let tokenState = null; // { token: string, expMs: number }
let citiesState = null; // { items: Array<City>, atMs: number }
const timingsCache = new Map(); // key -> { payload, expMs }
const countriesCache = new Map(); // lang -> { atMs, items }
const statesCache = new Map(); // countryId -> { atMs, items }
const districtsCache = new Map(); // stateId -> { atMs, items }
const localizedNameCache = new Map(); // key -> localized label

const countryAliases = {
  DE: ["germany", "deutschland", "almanya"],
  NL: ["netherlands", "nederland", "holland", "hollanda"],
  TR: ["turkey", "turkiye", "tuerkiye"],
  GB: ["uk", "unitedkingdom", "england", "birlesikkrallik"],
  US: ["usa", "unitedstates", "amerika"]
};

const exonymMap = {
  almanya: { en: "Germany", nl: "Duitsland" },
  arjantin: { en: "Argentina", nl: "Argentinie" },
  hollanda: { en: "Netherlands", nl: "Nederland" },
  ingiltere: { en: "United Kingdom", nl: "Verenigd Koninkrijk" },
  amerika: { en: "United States", nl: "Verenigde Staten" },
  isvicre: { en: "Switzerland", nl: "Zwitserland" },
  avusturya: { en: "Austria", nl: "Oostenrijk" },
  belcika: { en: "Belgium", nl: "Belgie" },
  yunanistan: { en: "Greece", nl: "Griekenland" },
  ispanya: { en: "Spain", nl: "Spanje" },
  italya: { en: "Italy", nl: "Italie" },
  fransa: { en: "France", nl: "Frankrijk" },
  londra: { en: "London", nl: "Londen" },
  viyana: { en: "Vienna", nl: "Wenen" },
  atina: { en: "Athens", nl: "Athene" },
  moskova: { en: "Moscow", nl: "Moskou" },
  kolonya: { en: "Cologne", nl: "Keulen" },
  munih: { en: "Munich", nl: "Munchen" }
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
    sendJson(res, 200, { ok: true, service: "diyanet-proxy", at: new Date().toISOString() });
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
    const countries = await getImsakiyemCountries("en");
    const countryMeta = countries.find((item) => item.id === countryId) || null;
    const localizedStates = await localizeOptions(states, lang, {
      countryCode: countryMeta?.code || "",
      countryName: countryMeta?.name || ""
    });
    sendJson(res, 200, { countryId, items: localizedStates });
    return;
  }

  if (req.method === "GET" && url.pathname === "/locations/districts") {
    const stateId = Number(url.searchParams.get("stateId"));
    if (!Number.isFinite(stateId) || stateId <= 0) {
      sendJson(res, 400, { error: "Missing stateId" });
      return;
    }

    const districts = await getImsakiyemDistricts(stateId, lang);
    const localizedDistricts = await localizeOptions(districts, lang);
    sendJson(res, 200, { stateId, items: localizedDistricts });
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

  const token = await login(username, password);
  const candidates = [];
  const seen = new Set();
  const addCandidate = (id, source) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      candidates.push({ cityId: n, source });
    }
  };

  if (Number.isFinite(cityIdParam) && cityIdParam > 0) {
    addCandidate(cityIdParam, "query-cityId");
  }

  const byGeo = await resolveCityIdByGeo(token, lat, lon);
  if (byGeo) {
    addCandidate(byGeo, "diyanet-geocode");
  }

  const reverse = await reverseGeocode(lat, lon);
  const resolvedCity = cityQuery || reverse.city || "";
  const resolvedCountryCode = countryCodeQuery || reverse.countryCode || "";
  const resolvedCountryName = countryQuery || reverse.country || "";

  const cities = await getCities(token);
  const matched = matchCities(cities, {
    lat,
    lon,
    city: resolvedCity,
    countryCode: resolvedCountryCode,
    countryName: resolvedCountryName
  });
  for (const id of matched) {
    addCandidate(id, "cities-match");
  }

  for (const item of nearestCities(cities, lat, lon, 30)) {
    addCandidate(item.id, "nearest");
  }

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
        citiesLoaded: cities.length,
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

    if (daily.rows.length === 0) {
      continue;
    }

    const row = findByDate(daily.rows, dateKey) || daily.rows[0];
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
      const response = await fetch(`${DIYANET_BASE}${path}`, {
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
    const response = await fetch(url, {
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

  const response = await fetch(`${DIYANET_BASE}/api/Place/Cities`, {
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

async function reverseGeocode(lat, lon, lang = "en") {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${normalizeLang(
      lang
    )}&count=1`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    return {
      city: String(first?.city || first?.name || first?.admin2 || "").trim(),
      country: String(first?.country || "").trim(),
      countryCode: String(first?.country_code || "").trim().toUpperCase()
    };
  } catch {
    return { city: "", country: "", countryCode: "" };
  }
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
  const endpoints = [
    `${DIYANET_BASE}/api/PrayerTime/Daily/${cityId}`,
    `${DIYANET_BASE}/api/AwqatSalah/Daily/${cityId}`,
    `${DIYANET_BASE}/api/PrayerTime/Daily/${cityId}?date=${dateKey}`,
    `${DIYANET_BASE}/api/AwqatSalah/Daily/${cityId}?date=${dateKey}`,
    `${DIYANET_BASE}/api/PrayerTime/Monthly/${cityId}`,
    `${DIYANET_BASE}/api/AwqatSalah/Monthly/${cityId}`
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    const payload = await safeJson(response);
    const rows = extractRows(payload);
    if (rows.length > 0) {
      return { rows, endpoint, status: response.status };
    }
  }

  return { rows: [], endpoint: null, status: 0 };
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
    const row = findByDate(timingsRows, params.dateKey) || timingsRows[0];
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
        countryId,
        displayName: name
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
        displayName: name,
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
    const response = await fetch(`https://ezanvakti.imsakiyem.com${path}`, {
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
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    const lat = Number(first?.latitude);
    const lon = Number(first?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return { lat, lon, name: String(first?.name || "").trim() };
  } catch {
    return null;
  }
}

async function localizeOptions(items, lang, context = {}) {
  if (normalizeLang(lang) === "tr" || !Array.isArray(items) || items.length === 0) {
    return items.map((item) => ({ ...item, displayName: item.displayName || item.name }));
  }

  const maxLocalize = items.length > 300 ? 120 : items.length;
  const out = [...items];
  for (let i = 0; i < maxLocalize; i += 1) {
    const item = out[i];
    const localized = await localizeName(item.name, lang, {
      countryCode: context.countryCode,
      countryName: context.countryName,
      lat: item.lat,
      lon: item.lon
    });
    out[i] = { ...item, displayName: localized || item.name };
  }
  for (let i = maxLocalize; i < out.length; i += 1) {
    out[i] = { ...out[i], displayName: out[i].displayName || out[i].name };
  }
  return out;
}

async function localizeName(name, lang, context = {}) {
  const targetLang = normalizeLang(lang);
  if (!name || targetLang === "tr") {
    return name;
  }
  const key = `${targetLang}|${normalizeText(name)}|${normalizeText(context.countryCode || "")}|${normalizeText(
    context.countryName || ""
  )}`;
  const cached = localizedNameCache.get(key);
  if (cached) {
    return cached;
  }

  const normalized = normalizeText(name);
  const exonym = exonymMap[normalized];
  if (exonym?.[targetLang]) {
    localizedNameCache.set(key, exonym[targetLang]);
    return exonym[targetLang];
  }

  if (Number.isFinite(context.lat) && Number.isFinite(context.lon)) {
    const reverse = await reverseGeocode(context.lat, context.lon, targetLang);
    if (reverse?.city) {
      localizedNameCache.set(key, reverse.city);
      return reverse.city;
    }
  }

  const query = [name, context.countryName].filter(Boolean).join(", ");
  const geo = await geocodeOpenMeteo(query, context.countryCode, targetLang);
  if (geo?.name) {
    localizedNameCache.set(key, geo.name);
    return geo.name;
  }

  localizedNameCache.set(key, name);
  return name;
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

  if (hasTimingFields(payload)) return [payload];
  if (payload.data && typeof payload.data === "object" && hasTimingFields(payload.data)) return [payload.data];

  const deepRows = collectObjects(payload);
  for (const row of deepRows) {
    if (hasTimingFields(row)) {
      return [row];
    }
  }
  return [];
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
  if (!raw || typeof raw !== "string") return null;
  const ddmmyyyy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[1]}-${ddmmyyyy[2]}-${ddmmyyyy[3]}`;
  const yyyymmdd = raw.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/);
  if (yyyymmdd) return `${yyyymmdd[3]}-${yyyymmdd[2]}-${yyyymmdd[1]}`;
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
