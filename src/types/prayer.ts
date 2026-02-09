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
  tone: "Adhan - Makkah (Normal)" | "Adhan - Madinah (Soft)" | "Beep";
  volume: number;
  vibration: boolean;
}

export interface Settings {
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
  methodId: number;
}
