import { getTimingsBySettings } from "@/services/prayerTimes";
import { getMonthlyTimingsByCoordinates } from "@/services/diyanet";
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

export interface MonthlyTimingsRow {
  date: Date;
  dateKey: string;
  timings: Timings | null;
  source: "cache" | "network" | "missing";
  lastUpdated: string | null;
}

export interface MonthlyTimingsResult {
  rows: MonthlyTimingsRow[];
  source: "cache" | "network" | "mixed";
  missingCount: number;
}

export interface MonthlyCacheSnapshot {
  rows: MonthlyTimingsRow[];
  missingDates: Date[];
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

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function monthDates(date: Date): Date[] {
  const monthStart = startOfMonth(date);
  const totalDays = daysInMonth(date);
  return Array.from({ length: totalDays }, (_, index) => {
    const value = new Date(monthStart);
    value.setDate(monthStart.getDate() + index);
    return value;
  });
}

async function fetchAndCacheDays(params: {
  dates: Date[];
  location: LocationInput;
  locationLabel?: string;
  settings: Settings;
}): Promise<Map<string, { timings: Timings; lastUpdated: string }>> {
  const result = new Map<string, { timings: Timings; lastUpdated: string }>();
  const batchSize = 3;

  for (let offset = 0; offset < params.dates.length; offset += batchSize) {
    const slice = params.dates.slice(offset, offset + batchSize);
    const rows = await Promise.all(
      slice.map(async (day) => {
        try {
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
          return { dateKey, timings, lastUpdated: nowIso };
        } catch {
          return null;
        }
      })
    );

    for (const row of rows) {
      if (!row) {
        continue;
      }
      result.set(row.dateKey, { timings: row.timings, lastUpdated: row.lastUpdated });
    }
  }

  return result;
}

export async function getMonthlyCacheSnapshot(params: {
  month: Date;
  location: LocationInput;
  settings: Settings;
}): Promise<MonthlyCacheSnapshot> {
  const dates = monthDates(params.month);
  const rows: MonthlyTimingsRow[] = [];
  const missingDates: Date[] = [];

  for (const day of dates) {
    const dateKey = getDateKey(day);
    const cacheKey = buildTimingsCacheKey(
      dateKey,
      params.location.lat,
      params.location.lon,
      params.settings.methodId,
      params.settings.timingsProvider
    );
    const cached = await getCachedTimings(cacheKey);
    if (cached?.timings) {
      rows.push({
        date: day,
        dateKey,
        timings: cached.timings,
        source: "cache",
        lastUpdated: cached.lastUpdated
      });
      continue;
    }

    rows.push({
      date: day,
      dateKey,
      timings: null,
      source: "missing",
      lastUpdated: null
    });
    missingDates.push(day);
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { rows, missingDates };
}

export async function prefetchMonthTimings(params: {
  year: number;
  monthIndex: number;
  location: LocationInput;
  locationLabel?: string;
  settings: Settings;
  dates?: Date[];
}): Promise<Record<string, Timings>> {
  const monthAllDates = monthDates(new Date(params.year, params.monthIndex, 1));
  const dates = params.dates && params.dates.length > 0 ? params.dates : monthAllDates;
  const hasExplicitDates = Array.isArray(params.dates) && params.dates.length > 0;
  const isFullMonthRequest = !hasExplicitDates || dates.length === monthAllDates.length;

  if (params.settings.timingsProvider === "diyanet" && isFullMonthRequest) {
    try {
      const cityHint = params.settings.locationMode === "manual" ? params.settings.manualLocation?.label : params.locationLabel;
      const monthly = await getMonthlyTimingsByCoordinates(
        params.year,
        params.monthIndex + 1,
        params.location.lat,
        params.location.lon,
        cityHint
      );
      const nowIso = new Date().toISOString();
      await Promise.all(
        Object.entries(monthly).map(async ([dateKey, timings]) => {
          const cacheKey = buildTimingsCacheKey(
            dateKey,
            params.location.lat,
            params.location.lon,
            params.settings.methodId,
            params.settings.timingsProvider
          );
          await saveCachedTimings(cacheKey, {
            timings,
            lastUpdated: nowIso,
            source: "api",
            latRounded: Number(params.location.lat.toFixed(2)),
            lonRounded: Number(params.location.lon.toFixed(2)),
            provider: params.settings.timingsProvider,
            methodId: params.settings.methodId
          });
        })
      );
      return monthly;
    } catch {
      // For full-month requests, avoid 28/30 per-day calls when monthly endpoint is unstable.
      // This prevents request storms while keeping existing cache data visible.
      return {};
    }
  }

  const fetched = await fetchAndCacheDays({
    dates,
    location: params.location,
    locationLabel: params.locationLabel,
    settings: params.settings
  });

  const result: Record<string, Timings> = {};
  for (const [dateKey, value] of fetched.entries()) {
    result[dateKey] = value.timings;
  }
  return result;
}

export async function getMonthlyTimings(params: {
  month: Date;
  location: LocationInput;
  locationLabel?: string;
  settings: Settings;
  forceRefresh?: boolean;
}): Promise<MonthlyTimingsResult> {
  if (params.forceRefresh) {
    const allDates = monthDates(params.month);
    const fetched = await fetchAndCacheDays({
      dates: allDates,
      location: params.location,
      locationLabel: params.locationLabel,
      settings: params.settings
    });
    const rows = allDates.map((day) => {
      const dateKey = getDateKey(day);
      const value = fetched.get(dateKey);
      return {
        date: day,
        dateKey,
        timings: value?.timings ?? null,
        source: value ? "network" : "missing",
        lastUpdated: value?.lastUpdated ?? null
      } as MonthlyTimingsRow;
    });
    return {
      rows,
      source: "network",
      missingCount: rows.filter((row) => row.source === "missing").length
    };
  }

  const snapshot = await getMonthlyCacheSnapshot({
    month: params.month,
    location: params.location,
    settings: params.settings
  });

  const missingDates = snapshot.missingDates;
  if (missingDates.length === 0) {
    return { rows: snapshot.rows, source: "cache", missingCount: 0 };
  }

  const fetched = await fetchAndCacheDays({
    dates: missingDates,
    location: params.location,
    locationLabel: params.locationLabel,
    settings: params.settings
  });

  const rows = snapshot.rows.map((row) => {
    if (row.timings) {
      return row;
    }
    const fetchedValue = fetched.get(row.dateKey);
    if (!fetchedValue) {
      return row;
    }
    return {
      ...row,
      timings: fetchedValue.timings,
      source: "network",
      lastUpdated: fetchedValue.lastUpdated
    } as MonthlyTimingsRow;
  });

  const networkCount = rows.filter((row) => row.source === "network").length;
  const cacheCount = rows.filter((row) => row.source === "cache").length;
  const source: MonthlyTimingsResult["source"] =
    networkCount > 0 && cacheCount > 0 ? "mixed" : networkCount > 0 ? "network" : "cache";

  return {
    rows,
    source,
    missingCount: rows.filter((row) => !row.timings).length
  };
}
