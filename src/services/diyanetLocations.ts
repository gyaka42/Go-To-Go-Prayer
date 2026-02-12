export interface DiyanetCountryOption {
  id: number;
  name: string;
  code: string;
}

export interface DiyanetStateOption {
  id: number;
  name: string;
  displayName: string;
  countryId: number;
}

export interface DiyanetDistrictOption {
  id: number;
  name: string;
  displayName: string;
  lat: number | null;
  lon: number | null;
}

export interface ResolvedCoordinates {
  lat: number;
  lon: number;
}

function getProxyBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim();
  if (!raw) {
    throw new Error("Diyanet proxy missing. Set EXPO_PUBLIC_DIYANET_PROXY_URL.");
  }
  return raw.replace(/\/+$/, "");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchDiyanetCountries(locale?: string): Promise<DiyanetCountryOption[]> {
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const response = await fetch(`${getProxyBaseUrl()}/locations/countries?lang=${encodeURIComponent(lang)}`, {
    headers: { Accept: "application/json" }
  });
  const payload = (await safeJson(response)) as { items?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Countries request failed (${response.status})`);
  }

  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const id = Number(item.id);
      const name = String(item.name || "").trim();
      const code = String(item.code || "").trim().toUpperCase();
      if (!(id > 0) || !name) return null;
      return { id, name, code };
    })
    .filter((item): item is DiyanetCountryOption => item !== null);
}

export async function fetchDiyanetStates(countryId: number, locale?: string): Promise<DiyanetStateOption[]> {
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const response = await fetch(
    `${getProxyBaseUrl()}/locations/states?countryId=${countryId}&lang=${encodeURIComponent(lang)}`,
    {
      headers: { Accept: "application/json" }
    }
  );
  const payload = (await safeJson(response)) as { items?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `States request failed (${response.status})`);
  }

  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const id = Number(item.id);
      const name = String(item.name || "").trim();
      const displayName = String(item.displayName || item.name || "").trim();
      const country = Number(item.countryId);
      if (!(id > 0) || !name) return null;
      return { id, name, displayName: displayName || name, countryId: country };
    })
    .filter((item): item is DiyanetStateOption => item !== null);
}

export async function fetchDiyanetDistricts(stateId: number, locale?: string): Promise<DiyanetDistrictOption[]> {
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const response = await fetch(
    `${getProxyBaseUrl()}/locations/districts?stateId=${stateId}&lang=${encodeURIComponent(lang)}`,
    {
      headers: { Accept: "application/json" }
    }
  );
  const payload = (await safeJson(response)) as { items?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Districts request failed (${response.status})`);
  }

  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const id = Number(item.id);
      const name = String(item.name || "").trim();
      const displayName = String(item.displayName || item.name || "").trim();
      const lat = item.lat === null ? null : Number(item.lat);
      const lon = item.lon === null ? null : Number(item.lon);
      if (!(id > 0) || !name) return null;
      return {
        id,
        name,
        displayName: displayName || name,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null
      };
    })
    .filter((item): item is DiyanetDistrictOption => item !== null);
}

export async function resolveDiyanetDistrictCoordinates(params: {
  districtId: number;
  districtName: string;
  stateId: number;
  stateName: string;
  countryCode?: string;
  countryName?: string;
  locale?: string;
}): Promise<ResolvedCoordinates | null> {
  const lang = (params.locale || "en").split("-")[0].toLowerCase();
  const url = new URL(`${getProxyBaseUrl()}/locations/resolve-coordinates`);
  url.searchParams.set("districtId", String(params.districtId));
  url.searchParams.set("district", params.districtName);
  url.searchParams.set("stateId", String(params.stateId));
  url.searchParams.set("state", params.stateName);
  if (params.countryCode) {
    url.searchParams.set("countryCode", params.countryCode);
  }
  if (params.countryName) {
    url.searchParams.set("country", params.countryName);
  }
  url.searchParams.set("lang", lang);

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const payload = (await safeJson(response)) as { lat?: unknown; lon?: unknown; error?: unknown } | null;
  if (!response.ok) {
    return null;
  }

  const lat = Number(payload?.lat);
  const lon = Number(payload?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { lat, lon };
}

// Keep old name compatibility for current imports if any call site lags.
export async function fetchDiyanetStatesLegacy(countryId: number): Promise<DiyanetStateOption[]> {
  return fetchDiyanetStates(countryId);
}

export async function fetchDiyanetDistrictsLegacy(stateId: number): Promise<DiyanetDistrictOption[]> {
  return fetchDiyanetDistricts(stateId);
}
