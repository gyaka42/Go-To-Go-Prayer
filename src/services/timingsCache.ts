import { getTimingsBySettings } from "@/services/prayerTimes";
import { buildTimingsCacheKey, getCachedTimings, saveCachedTimings } from "@/services/storage";
import { Settings, Timings } from "@/types/prayer";
import { getDateKey, getTomorrow } from "@/utils/time";

interface LocationInput {
  lat: number;
  lon: number;
}

interface TodayTomorrowResult {
  today: Timings;
  tomorrow: Timings;
  source: "api" | "cache";
  lastUpdated: string;
}

async function fetchAndCacheRange(params: {
  startDate: Date;
  days: number;
  location: LocationInput;
  locationLabel?: string;
  settings: Settings;
}): Promise<Map<string, Timings>> {
  const result = new Map<string, Timings>();
  const batchSize = 4;
  const dates = Array.from({ length: params.days }, (_, index) => {
    const d = new Date(params.startDate);
    d.setDate(d.getDate() + index);
    return d;
  });

  for (let offset = 0; offset < dates.length; offset += batchSize) {
    const slice = dates.slice(offset, offset + batchSize);
    const rows = await Promise.all(
      slice.map(async (day) => {
        const timings = await getTimingsBySettings(
          day,
          params.location.lat,
          params.location.lon,
          params.settings,
          params.locationLabel
        );
        const dateKey = getDateKey(day);
        const cacheKey = buildTimingsCacheKey(
          dateKey,
          params.location.lat,
          params.location.lon,
          params.settings.methodId,
          params.settings.timingsProvider
        );
        const nowIso = new Date().toISOString();
        await saveCachedTimings(cacheKey, {
          timings,
          lastUpdated: nowIso,
          source: "api",
          latRounded: Number(params.location.lat.toFixed(2)),
          lonRounded: Number(params.location.lon.toFixed(2)),
          provider: params.settings.timingsProvider,
          methodId: params.settings.methodId
        });
        return { dateKey, timings };
      })
    );

    for (const row of rows) {
      result.set(row.dateKey, row.timings);
    }
  }

  return result;
}

export async function getTodayTomorrowTimings(params: {
  today: Date;
  location: LocationInput;
  locationLabel?: string;
  settings: Settings;
  forceRefresh?: boolean;
  rangeDays?: number;
}): Promise<TodayTomorrowResult> {
  const tomorrow = getTomorrow(params.today);
  const todayKey = getDateKey(params.today);
  const tomorrowKey = getDateKey(tomorrow);
  const todayCacheKey = buildTimingsCacheKey(
    todayKey,
    params.location.lat,
    params.location.lon,
    params.settings.methodId,
    params.settings.timingsProvider
  );
  const tomorrowCacheKey = buildTimingsCacheKey(
    tomorrowKey,
    params.location.lat,
    params.location.lon,
    params.settings.methodId,
    params.settings.timingsProvider
  );

  if (!params.forceRefresh) {
    const [cachedToday, cachedTomorrow] = await Promise.all([
      getCachedTimings(todayCacheKey),
      getCachedTimings(tomorrowCacheKey)
    ]);

    if (cachedToday?.timings && cachedTomorrow?.timings) {
      return {
        today: cachedToday.timings,
        tomorrow: cachedTomorrow.timings,
        source: "cache",
        lastUpdated: cachedToday.lastUpdated
      };
    }
  }

  const prefetched = await fetchAndCacheRange({
    startDate: params.today,
    days: params.rangeDays ?? 30,
    location: params.location,
    locationLabel: params.locationLabel,
    settings: params.settings
  });

  const todayTimings = prefetched.get(todayKey);
  const tomorrowTimings = prefetched.get(tomorrowKey);
  if (!todayTimings || !tomorrowTimings) {
    throw new Error("Failed to fetch cached 30-day timings window.");
  }

  return {
    today: todayTimings,
    tomorrow: tomorrowTimings,
    source: "api",
    lastUpdated: new Date().toISOString()
  };
}
