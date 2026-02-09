import AsyncStorage from "@react-native-async-storage/async-storage";
import { CachedTimings, PRAYER_NAMES, Settings } from "@/types/prayer";

const SETTINGS_KEY = "settings:v1";
const LATEST_CACHE_KEY = "timings:latest:v1";

function createDefaultSettings(): Settings {
  return {
    methodId: 3,
    methodName: "Muslim World League",
    hanafiOnly: true,
    locationMode: "gps",
    prayerNotifications: PRAYER_NAMES.reduce((acc, prayer) => {
      acc[prayer] = {
        enabled: true,
        minutesBefore: 0,
        playSound: true,
        tone: "Adhan - Makkah (Normal)",
        volume: 75,
        vibration: true
      };
      return acc;
    }, {} as Settings["prayerNotifications"])
  };
}

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return createDefaultSettings();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const defaults = createDefaultSettings();

    return {
      methodId:
        typeof (parsed as any).methodId === "number"
          ? (parsed as any).methodId
          : typeof (parsed as any).method === "number"
            ? (parsed as any).method
            : defaults.methodId,
      methodName:
        typeof (parsed as any).methodName === "string"
          ? (parsed as any).methodName
          : defaults.methodName,
      hanafiOnly:
        typeof (parsed as any).hanafiOnly === "boolean"
          ? (parsed as any).hanafiOnly
          : defaults.hanafiOnly,
      locationMode:
        (parsed as any).locationMode === "manual" || (parsed as any).locationMode === "gps"
          ? (parsed as any).locationMode
          : defaults.locationMode,
      manualLocation:
        typeof (parsed as any).manualLocation?.query === "string" &&
        typeof (parsed as any).manualLocation?.label === "string" &&
        typeof (parsed as any).manualLocation?.lat === "number" &&
        typeof (parsed as any).manualLocation?.lon === "number"
          ? {
              query: (parsed as any).manualLocation.query,
              label: (parsed as any).manualLocation.label,
              lat: (parsed as any).manualLocation.lat,
              lon: (parsed as any).manualLocation.lon
            }
          : undefined,
      prayerNotifications: PRAYER_NAMES.reduce((acc, prayer) => {
        const value = parsed.prayerNotifications?.[prayer];
        acc[prayer] = {
          enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.prayerNotifications[prayer].enabled,
          minutesBefore:
            value?.minutesBefore === 0 ||
            value?.minutesBefore === 5 ||
            value?.minutesBefore === 10 ||
            value?.minutesBefore === 15 ||
            value?.minutesBefore === 30
              ? value.minutesBefore
              : defaults.prayerNotifications[prayer].minutesBefore,
          playSound:
            typeof value?.playSound === "boolean"
              ? value.playSound
              : defaults.prayerNotifications[prayer].playSound,
          tone:
            value?.tone === "Adhan - Makkah (Normal)" ||
            value?.tone === "Adhan - Madinah (Soft)" ||
            value?.tone === "Beep"
              ? value.tone
              : defaults.prayerNotifications[prayer].tone,
          volume:
            typeof value?.volume === "number" && value.volume >= 0 && value.volume <= 100
              ? value.volume
              : defaults.prayerNotifications[prayer].volume,
          vibration:
            typeof value?.vibration === "boolean"
              ? value.vibration
              : defaults.prayerNotifications[prayer].vibration
        };
        return acc;
      }, {} as Settings["prayerNotifications"])
    };
  } catch {
    return createDefaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function buildTimingsCacheKey(dateKey: string, lat: number, lon: number, methodId: number): string {
  const latRounded = Number(lat.toFixed(2));
  const lonRounded = Number(lon.toFixed(2));
  return `timings:${dateKey}:${latRounded}:${lonRounded}:m${methodId}`;
}

export async function getCachedTimings(key: string): Promise<CachedTimings | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedTimings;
  } catch {
    return null;
  }
}

export async function saveCachedTimings(key: string, data: CachedTimings): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(data));
  await AsyncStorage.setItem(LATEST_CACHE_KEY, JSON.stringify(data));
}

export async function getLatestCachedTimings(): Promise<CachedTimings | null> {
  const raw = await AsyncStorage.getItem(LATEST_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedTimings;
  } catch {
    return null;
  }
}
