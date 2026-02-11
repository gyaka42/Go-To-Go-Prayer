export type PrayerName = "Fajr" | "Sunrise" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

export const PRAYER_NAMES: PrayerName[] = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

export interface Timings {
  dateKey: string;
  timezone: string;
  times: Record<PrayerName, string>;
}

export interface PrayerNotificationSetting {
  enabled: boolean;
  minutesBefore: 0 | 5 | 10 | 15 | 30;
  playSound: boolean;
  tone: "Adhan" | "Beep";
  volume: number;
  vibration: boolean;
}

export interface Settings {
  timingsProvider: "aladhan" | "diyanet";
  methodId: number;
  methodName: string;
  hanafiOnly: boolean;
  locationMode: "gps" | "manual";
  manualLocation?: {
    query: string;
    label: string;
    lat: number;
    lon: number;
  };
  prayerNotifications: Record<PrayerName, PrayerNotificationSetting>;
}

export interface CachedTimings {
  timings: Timings;
  lastUpdated: string;
  source: "api" | "cache";
  latRounded: number;
  lonRounded: number;
  provider?: "aladhan" | "diyanet";
  methodId: number;
}

export interface CachedQibla {
  bearing: number;
  locationName: string;
  updatedAt: string;
  latRounded: number;
  lonRounded: number;
}

export interface CachedLocation {
  lat: number;
  lon: number;
  label: string;
  mode: "gps" | "manual";
  updatedAt: string;
}
