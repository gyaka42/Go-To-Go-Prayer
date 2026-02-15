import { NativeModules, Platform } from "react-native";
import { PrayerName, Timings } from "@/types/prayer";
import { getNextPrayer } from "@/utils/time";

type WidgetBridgeModule = {
  saveWidgetStateJSON?: (payloadJSON: string) => void;
  saveWidgetState: (payload: Record<string, string>) => void;
  saveWidgetData: (nextPrayer: string, time: string, location: string) => void;
};

function getBridge(): WidgetBridgeModule | null {
  if (Platform.OS !== "ios") {
    return null;
  }
  const mod = (NativeModules as Record<string, unknown>).WidgetBridge as WidgetBridgeModule | undefined;
  if (!mod || typeof mod.saveWidgetData !== "function") {
    return null;
  }
  return mod;
}

export function syncWidgetWithTimings(params: {
  today: Timings;
  tomorrow: Timings | null;
  locationLabel: string;
  localeTag: string;
}): void {
  const bridge = getBridge();
  if (!bridge) {
    return;
  }

  const now = new Date();
  const next = getNextPrayer(params.today, now);

  let prayer: PrayerName = "Fajr";
  let time = "--:--";

  if (next) {
    prayer = next.prayer;
    time = params.today.times[next.prayer];
  } else if (params.tomorrow) {
    prayer = "Fajr";
    time = params.tomorrow.times.Fajr;
  }

  const currentPrayer = getCurrentPrayer(params.today, now);
  const currentPrayerName = currentPrayer ?? prayer;
  const tomorrowFajr = params.tomorrow?.times.Fajr ?? "--:--";
  const payload: Record<string, string> = {
    currentPrayer: currentPrayerName,
    nextPrayer: prayer,
    nextTime: time,
    location: params.locationLabel,
    localeTag: params.localeTag,
    fajr: params.today.times.Fajr,
    sunrise: params.today.times.Sunrise,
    dhuhr: params.today.times.Dhuhr,
    asr: params.today.times.Asr,
    maghrib: params.today.times.Maghrib,
    isha: params.today.times.Isha,
    tomorrowFajr
  };

  try {
    if (typeof bridge.saveWidgetStateJSON === "function") {
      bridge.saveWidgetStateJSON(JSON.stringify(payload));
    } else if (typeof bridge.saveWidgetState === "function") {
      bridge.saveWidgetState(payload);
    } else {
      bridge.saveWidgetData(prayer, time, params.locationLabel);
    }
  } catch {
    // Ignore widget sync failures so the main UI flow stays unaffected.
  }
}

function getCurrentPrayer(today: Timings, now: Date): PrayerName | null {
  const starts: Array<{ prayer: PrayerName; at: Date }> = [
    { prayer: "Fajr", at: parseTime(today.times.Fajr, now) },
    { prayer: "Dhuhr", at: parseTime(today.times.Dhuhr, now) },
    { prayer: "Asr", at: parseTime(today.times.Asr, now) },
    { prayer: "Maghrib", at: parseTime(today.times.Maghrib, now) },
    { prayer: "Isha", at: parseTime(today.times.Isha, now) }
  ];

  let current: PrayerName | null = null;
  for (const item of starts) {
    if (item.at.getTime() <= now.getTime()) {
      current = item.prayer;
    }
  }
  return current ?? "Isha";
}

function parseTime(value: string, baseDate: Date): Date {
  const [hh, mm] = value.split(":").map((v) => Number(v));
  const d = new Date(baseDate);
  d.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  return d;
}
