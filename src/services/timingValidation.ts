import { CachedTimings, PRAYER_NAMES, PrayerName, Timings } from "@/types/prayer";

const HHMM_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export type TimingSanitySeverity = "info" | "warning" | "error";

export type TimingSanityIssue = {
  severity: TimingSanitySeverity;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string | number>;
};

export function timeToMinutes(value: string): number | null {
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

function normalizedDayDiff(current: number, next: number): number {
  const direct = Math.abs(next - current);
  return Math.min(direct, Math.abs(next + 24 * 60 - current), Math.abs(current + 24 * 60 - next));
}

function gap(current: number | null, next: number | null): number | null {
  if (current === null || next === null) {
    return null;
  }
  return next > current ? next - current : next + 24 * 60 - current;
}

function pushGapIssue(
  issues: TimingSanityIssue[],
  value: number | null,
  min: number,
  max: number,
  label: string
) {
  if (value === null || (value >= min && value <= max)) {
    return;
  }
  issues.push({
    severity: "warning",
    titleKey: "source_check.sanity_gap_title",
    bodyKey: "source_check.sanity_gap_body",
    params: { label, minutes: value }
  });
}

export function analyzeTimingsSanity(params: {
  timings: Timings;
  nextDayTimings?: Timings | null;
  provider?: "aladhan" | "diyanet";
}): TimingSanityIssue[] {
  const issues: TimingSanityIssue[] = [];

  if (!isValidTimings(params.timings, params.timings.dateKey)) {
    issues.push({
      severity: "error",
      titleKey: "source_check.sanity_invalid_title",
      bodyKey: "source_check.sanity_invalid_body"
    });
    return issues;
  }

  const times = params.timings.times;
  const minutes = {
    Fajr: timeToMinutes(times.Fajr),
    Sunrise: timeToMinutes(times.Sunrise),
    Dhuhr: timeToMinutes(times.Dhuhr),
    Asr: timeToMinutes(times.Asr),
    Maghrib: timeToMinutes(times.Maghrib),
    Isha: timeToMinutes(times.Isha)
  };

  pushGapIssue(issues, gap(minutes.Fajr, minutes.Sunrise), 45, 220, "Fajr-Sunrise");
  pushGapIssue(issues, gap(minutes.Sunrise, minutes.Dhuhr), 240, 570, "Sunrise-Dhuhr");
  pushGapIssue(issues, gap(minutes.Dhuhr, minutes.Asr), 90, 430, "Dhuhr-Asr");
  pushGapIssue(issues, gap(minutes.Asr, minutes.Maghrib), 90, 430, "Asr-Maghrib");
  pushGapIssue(issues, gap(minutes.Maghrib, minutes.Isha), 45, 260, "Maghrib-Isha");

  const source = params.timings.source ?? "";
  if (params.provider === "diyanet" && !params.timings.cityId && !source.includes("aladhan")) {
    issues.push({
      severity: "warning",
      titleKey: "source_check.sanity_city_missing_title",
      bodyKey: "source_check.sanity_city_missing_body"
    });
  }

  if (source.includes("coordinate-fallback")) {
    issues.push({
      severity: "warning",
      titleKey: "source_check.sanity_coordinate_fallback_title",
      bodyKey: "source_check.sanity_coordinate_fallback_body"
    });
  }

  if (params.timings.citySource === "regional-diyanet-fallback") {
    issues.push({
      severity: "info",
      titleKey: "source_check.sanity_regional_fallback_title",
      bodyKey: "source_check.sanity_regional_fallback_body",
      params: {
        city: params.timings.resolvedCityName || "-",
        distance: typeof params.timings.cityDistanceKm === "number" ? params.timings.cityDistanceKm.toFixed(1) : "-"
      }
    });
  }

  if (params.nextDayTimings && isValidTimings(params.nextDayTimings, params.nextDayTimings.dateKey)) {
    for (const prayer of PRAYER_NAMES) {
      const current = timeToMinutes(params.timings.times[prayer]);
      const next = timeToMinutes(params.nextDayTimings.times[prayer]);
      if (current === null || next === null) {
        continue;
      }
      const diff = normalizedDayDiff(current, next);
      if (diff > 20) {
        issues.push({
          severity: "warning",
          titleKey: "source_check.sanity_day_jump_title",
          bodyKey: "source_check.sanity_day_jump_body",
          params: { prayer, minutes: diff }
        });
      }
    }
  }

  return issues;
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
