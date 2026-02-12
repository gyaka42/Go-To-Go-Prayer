import { NativeModules, Platform } from "react-native";
import { PrayerName, Timings } from "@/types/prayer";
import { getNextPrayer } from "@/utils/time";

type WidgetBridgeModule = {
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
  try {
    bridge.saveWidgetData(prayer, time, params.locationLabel);
  } catch {
    // Ignore widget sync failures so the main UI flow stays unaffected.
  }
}
