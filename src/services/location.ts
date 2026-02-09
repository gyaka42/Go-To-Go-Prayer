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

export async function searchCitySuggestions(query: string): Promise<CitySuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Suggestions error ${response.status}`);
    }

    const payload = (await response.json()) as Array<any>;
    return payload
      .map((item) => {
        const city = firstNonEmpty([
          item?.address?.city,
          item?.address?.town,
          item?.address?.village,
          item?.address?.state
        ]);
        const country = firstNonEmpty([item?.address?.country]);
        const label = city && country ? `${city}, ${country}` : item?.display_name || trimmed;

        return {
          query: trimmed,
          label,
          lat: Number(item?.lat),
          lon: Number(item?.lon)
        } as CitySuggestion;
      })
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
      .slice(0, 6);
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
