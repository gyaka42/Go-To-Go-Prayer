import { resolveLocationForSettings } from "@/services/location";
import {
  getLatestCachedLocation,
  saveLatestCachedLocation
} from "@/services/storage";
import {
  getMonthlyCacheSnapshot,
  prefetchMonthTimings
} from "@/services/timingsCache";
import { Settings, Timings } from "@/types/prayer";
import { localDateKey, RamadanRange } from "@/ramadan/calendar";

export type RamadanTimingRow = {
  date: Date;
  dateKey: string;
  timings: Timings | null;
  source: "cache" | "network" | "missing";
};

export type RamadanLocation = {
  lat: number;
  lon: number;
  label: string;
};

function uniqueMonths(range: RamadanRange): Date[] {
  const months = new Map<string, Date>();
  for (const day of range.days) {
    const key = `${day.getFullYear()}-${day.getMonth()}`;
    if (!months.has(key)) {
      months.set(key, new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }
  return Array.from(months.values());
}

export async function resolveRamadanLocation(settings: Settings): Promise<RamadanLocation | null> {
  if (settings.locationMode === "manual" && settings.manualLocation) {
    return {
      lat: settings.manualLocation.lat,
      lon: settings.manualLocation.lon,
      label: settings.manualLocation.label
    };
  }

  try {
    const location = await resolveLocationForSettings(settings);
    await saveLatestCachedLocation({
      ...location,
      mode: "gps",
      updatedAt: new Date().toISOString()
    });
    return location;
  } catch {
    const cached = await getLatestCachedLocation();
    return cached
      ? { lat: cached.lat, lon: cached.lon, label: cached.label }
      : null;
  }
}

export async function loadRamadanTimingRows(params: {
  range: RamadanRange;
  settings: Settings;
}): Promise<{ rows: RamadanTimingRow[]; location: RamadanLocation }> {
  const location = await resolveRamadanLocation(params.settings);
  if (!location) {
    throw new Error("RAMADAN_LOCATION_UNAVAILABLE");
  }

  const combined = new Map<string, RamadanTimingRow>();
  for (const month of uniqueMonths(params.range)) {
    let snapshot = await getMonthlyCacheSnapshot({
      month,
      location,
      settings: params.settings
    });
    let fetchedKeys = new Set<string>();
    if (snapshot.missingDates.length > 0) {
      const fetched = await prefetchMonthTimings({
        year: month.getFullYear(),
        monthIndex: month.getMonth(),
        location,
        locationLabel: location.label,
        settings: params.settings
      });
      fetchedKeys = new Set(Object.keys(fetched));
      snapshot = await getMonthlyCacheSnapshot({
        month,
        location,
        settings: params.settings
      });
    }

    for (const row of snapshot.rows) {
      combined.set(row.dateKey, {
        date: row.date,
        dateKey: row.dateKey,
        timings: row.timings,
        source: fetchedKeys.has(row.dateKey) ? "network" : row.source
      });
    }
  }

  const rows = params.range.days.map((date) => {
    const dateKey = localDateKey(date);
    return (
      combined.get(dateKey) ?? {
        date,
        dateKey,
        timings: null,
        source: "missing" as const
      }
    );
  });

  return { rows, location };
}

export function getRamadanPreviewRows(
  rows: RamadanTimingRow[],
  currentDay: number | null,
  isFinished: boolean,
  count = 5
): RamadanTimingRow[] {
  if (rows.length <= count) return rows;
  if (isFinished) return rows.slice(-count);
  if (!currentDay) return rows.slice(0, count);

  const currentIndex = currentDay - 1;
  const half = Math.floor(count / 2);
  const start = Math.min(
    Math.max(currentIndex - half, 0),
    rows.length - count
  );
  return rows.slice(start, start + count);
}
