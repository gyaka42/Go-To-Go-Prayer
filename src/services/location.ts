import * as Location from "expo-location";
import { Settings } from "@/types/prayer";

export async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission denied.");
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced
  });

  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude
  };
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function fallbackLabel(lat: number, lon: number): string {
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

export async function getLocationName(lat: number, lon: number): Promise<string> {
  try {
    const reverse = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lon
    });
    const first = reverse[0];
    if (!first) {
      return "Unknown location";
    }

    const city = firstNonEmpty([first.city, first.subregion, first.region, first.district]);
    const region = firstNonEmpty([first.region, first.subregion]);
    const country = firstNonEmpty([first.country, first.isoCountryCode]);

    const parts = [city, region, country].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(", ");
    }
    return "Unknown location";
  } catch {
    return "Unknown location";
  }
}

export async function getCurrentLocationDetails(): Promise<{ lat: number; lon: number; label: string }> {
  const { lat, lon } = await getCurrentLocation();

  try {
    const label = await getLocationName(lat, lon);
    if (label === "Unknown location") {
      return { lat, lon, label: fallbackLabel(lat, lon) };
    }
    return { lat, lon, label };
  } catch {
    return { lat, lon, label: fallbackLabel(lat, lon) };
  }
}

export async function geocodeCityQuery(query: string): Promise<{ lat: number; lon: number; label: string }> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Please enter a city name.");
  }

  const results = await Location.geocodeAsync(trimmed);
  const first = results[0];
  if (!first) {
    throw new Error("City not found. Try a more specific query.");
  }

  const reverse = await Location.reverseGeocodeAsync({
    latitude: first.latitude,
    longitude: first.longitude
  });
  const entry = reverse[0];
  const city = firstNonEmpty([entry?.city, entry?.subregion, entry?.region]);
  const country = firstNonEmpty([entry?.country, entry?.isoCountryCode]);
  const label = city && country ? `${city}, ${country}` : city || country || trimmed;

  return {
    lat: first.latitude,
    lon: first.longitude,
    label
  };
}

export interface CitySuggestion {
  query: string;
  label: string;
  lat: number;
  lon: number;
}

function normalizeLocaleTag(localeTag?: string): string {
  const raw = (localeTag || "en").trim();
  return raw.length > 0 ? raw : "en";
}

function localeLanguage(localeTag?: string): string {
  return normalizeLocaleTag(localeTag).split("-")[0].toLowerCase();
}

function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildSuggestionLabel(city: string | null, state: string | null, country: string | null, fallback: string): string {
  const parts = [city, state, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : fallback;
}

function makeSuggestionKey(label: string, lat: number, lon: number): string {
  return `${normalizeQuery(label)}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
}

function localizedCountryName(countryName: string | null, countryCode: string | null, localeTag?: string): string | null {
  if (!countryCode || countryCode.length !== 2) {
    return countryName;
  }

  try {
    const displayNames = new Intl.DisplayNames([normalizeLocaleTag(localeTag)], { type: "region" });
    return displayNames.of(countryCode.toUpperCase()) || countryName;
  } catch {
    return countryName;
  }
}

async function fetchOpenMeteoSuggestions(trimmed: string, localeTag?: string): Promise<CitySuggestion[]> {
  const lang = localeLanguage(localeTag);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=12&language=${encodeURIComponent(lang)}&format=json`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { results?: Array<any> };
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return rows
    .map((item) => {
      const lat = Number(item?.latitude);
      const lon = Number(item?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }

      const city = firstNonEmpty([item?.name, item?.admin3, item?.admin2, item?.admin1]);
      const state = firstNonEmpty([item?.admin1, item?.admin2]);
      const rawCountry = firstNonEmpty([item?.country]);
      const rawCountryCode = firstNonEmpty([item?.country_code]);
      const country = localizedCountryName(rawCountry, rawCountryCode, localeTag);
      return {
        query: trimmed,
        label: buildSuggestionLabel(city, state, country, String(item?.name || trimmed)),
        lat,
        lon
      } as CitySuggestion;
    })
    .filter((item): item is CitySuggestion => item !== null);
}

async function fetchNominatimSuggestions(trimmed: string, localeTag?: string): Promise<CitySuggestion[]> {
  const acceptLanguage = normalizeLocaleTag(localeTag);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&accept-language=${encodeURIComponent(acceptLanguage)}&q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": acceptLanguage
    }
  });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as Array<any>;
  return payload
    .map((item) => {
      const lat = Number(item?.lat);
      const lon = Number(item?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }

      const city = firstNonEmpty([
        item?.address?.city,
        item?.address?.town,
        item?.address?.village,
        item?.address?.municipality,
        item?.address?.state
      ]);
      const state = firstNonEmpty([item?.address?.state, item?.address?.county]);
      const rawCountry = firstNonEmpty([item?.address?.country]);
      const rawCountryCode = firstNonEmpty([item?.address?.country_code]);
      const country = localizedCountryName(rawCountry, rawCountryCode, localeTag);
      return {
        query: trimmed,
        label: buildSuggestionLabel(city, state, country, String(item?.display_name || trimmed)),
        lat,
        lon
      } as CitySuggestion;
    })
    .filter((item): item is CitySuggestion => item !== null);
}

export async function searchCitySuggestions(query: string, localeTag?: string): Promise<CitySuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  try {
    const [openMeteo, nominatim] = await Promise.allSettled([
      fetchOpenMeteoSuggestions(trimmed, localeTag),
      fetchNominatimSuggestions(trimmed, localeTag)
    ]);

    const merged = [
      ...(openMeteo.status === "fulfilled" ? openMeteo.value : []),
      ...(nominatim.status === "fulfilled" ? nominatim.value : [])
    ];

    const normalizedQuery = normalizeQuery(trimmed);
    const ranked = merged.sort((a, b) => {
      const aLabel = normalizeQuery(a.label);
      const bLabel = normalizeQuery(b.label);
      const aStarts = aLabel.startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = bLabel.startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      return aLabel.localeCompare(bLabel, normalizeLocaleTag(localeTag));
    });

    const deduped: CitySuggestion[] = [];
    const seen = new Set<string>();
    for (const item of ranked) {
      const key = makeSuggestionKey(item.label, item.lat, item.lon);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= 10) {
        break;
      }
    }

    return deduped;
  } catch {
    return [];
  }
}

export async function resolveLocationForSettings(settings: Settings): Promise<{ lat: number; lon: number; label: string }> {
  if (settings.locationMode === "manual" && settings.manualLocation) {
    return {
      lat: settings.manualLocation.lat,
      lon: settings.manualLocation.lon,
      label: settings.manualLocation.label
    };
  }

  return getCurrentLocationDetails();
}
