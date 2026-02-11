export interface DiyanetCountryOption {
  id: number;
  name: string;
  code: string;
}

export interface DiyanetStateOption {
  id: number;
  name: string;
  countryId: number;
}

export interface DiyanetDistrictOption {
  id: number;
  name: string;
  lat: number | null;
  lon: number | null;
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

export async function fetchDiyanetCountries(): Promise<DiyanetCountryOption[]> {
  const response = await fetch(`${getProxyBaseUrl()}/locations/countries`, {
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

export async function fetchDiyanetStates(countryId: number): Promise<DiyanetStateOption[]> {
  const response = await fetch(`${getProxyBaseUrl()}/locations/states?countryId=${countryId}`, {
    headers: { Accept: "application/json" }
  });
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
      const country = Number(item.countryId);
      if (!(id > 0) || !name) return null;
      return { id, name, countryId: country };
    })
    .filter((item): item is DiyanetStateOption => item !== null);
}

export async function fetchDiyanetDistricts(stateId: number): Promise<DiyanetDistrictOption[]> {
  const response = await fetch(`${getProxyBaseUrl()}/locations/districts?stateId=${stateId}`, {
    headers: { Accept: "application/json" }
  });
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
      const lat = item.lat === null ? null : Number(item.lat);
      const lon = item.lon === null ? null : Number(item.lon);
      if (!(id > 0) || !name) return null;
      return {
        id,
        name,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null
      };
    })
    .filter((item): item is DiyanetDistrictOption => item !== null);
}
