import { CachedTimings, PRAYER_NAMES, PrayerName, Timings } from "@/types/prayer";

const HHMM_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(value: string): number | null {
  const match = value.match(HHMM_REGEX);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidTimings(value: unknown, expectedDateKey?: string): value is Timings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const timings = value as Partial<Timings>;
  if (typeof timings.dateKey !== "string" || timings.dateKey.length === 0) {
    return false;
  }
  if (expectedDateKey && timings.dateKey !== expectedDateKey) {
    return false;
  }
  if (typeof timings.timezone !== "string" || timings.timezone.length === 0) {
    return false;
  }
  if (!timings.times || typeof timings.times !== "object") {
    return false;
  }

  const minutes = PRAYER_NAMES.map((prayer) => timeToMinutes((timings.times as Record<PrayerName, string>)[prayer]));
  if (minutes.some((value) => value === null)) {
    return false;
  }

  if (minutes[5] !== null && minutes[4] !== null && minutes[5] <= minutes[4]) {
    minutes[5] += 24 * 60;
  }

  for (let index = 1; index < minutes.length; index += 1) {
    const previous = minutes[index - 1];
    const current = minutes[index];
    if (previous === null || current === null || current <= previous) {
      return false;
    }
  }

  return true;
}

export function isValidCachedTimings(
  value: unknown,
  params?: {
    dateKey?: string;
    provider?: "aladhan" | "diyanet";
    methodId?: number;
  }
): value is CachedTimings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const cached = value as Partial<CachedTimings>;
  if (!isValidTimings(cached.timings, params?.dateKey)) {
    return false;
  }
  if (params?.methodId != null && cached.methodId !== params.methodId) {
    return false;
  }
  if (params?.provider && (cached.provider ?? "aladhan") !== params.provider) {
    return false;
  }
  if (typeof cached.lastUpdated !== "string" || Number.isNaN(new Date(cached.lastUpdated).getTime())) {
    return false;
  }

  return true;
}
