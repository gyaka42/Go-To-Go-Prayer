import AsyncStorage from "@react-native-async-storage/async-storage";
import { CachedLocation, CachedQibla, CachedTimings, PRAYER_NAMES, Settings } from "@/types/prayer";
import { MosquesSettings } from "@/types/mosque";

const SETTINGS_KEY = "settings:v1";
const LATEST_CACHE_KEY = "timings:latest:v1";
const QIBLA_CACHE_PREFIX = "qibla";
const LATEST_QIBLA_CACHE_KEY = "qibla:latest:v1";
const LATEST_LOCATION_CACHE_KEY = "location:latest:v1";
const HOME_DATE_MODE_KEY = "home:date_mode:v1";
const MOSQUES_CACHE_PREFIX = "mosques:cache:v1";
const MOSQUES_SETTINGS_KEY = "mosques:settings:v1";
const MOSQUES_FAVORITES_KEY = "mosques:favorites:v1";
const MOSQUES_DEFAULT_KEY = "mosques:default:v1";
const ZIKR_STATE_KEY = "zikr:state:v2";
const ZIKR_STATE_V1_KEY = "zikr:state:v1";
const ZIKR_SETTINGS_KEY = "zikr:settings:v1";

export type HomeDateMode = "gregorian" | "hijri";
export type ZikrKey = "subhanallah" | "alhamdulillah" | "allahuakbar" | "la_ilaha_illallah" | "custom";
export type ZikrEntry = {
  count: number;
  target: number;
  updatedAt: number;
  label?: string;
  subtitle?: string;
};
export type ZikrState = {
  activeKey: ZikrKey;
  entries: Record<ZikrKey, ZikrEntry>;
  updatedAt: number;
};
export type ZikrSettings = {
  hapticsEnabled: boolean;
};

function createDefaultSettings(): Settings {
  return {
    timingsProvider: "diyanet",
    methodId: 3,
    methodName: "Diyanet Official API",
    hanafiOnly: true,
    locationMode: "gps",
    prayerNotifications: PRAYER_NAMES.reduce((acc, prayer) => {
      acc[prayer] = {
        enabled: prayer !== "Sunrise",
        minutesBefore: 0,
        playSound: true,
        tone: "Beep",
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
    const parsedProvider = (parsed as any).timingsProvider ?? (parsed as any).provider;
    const resolvedProvider =
      parsedProvider === "diyanet" || parsedProvider === "aladhan" ? parsedProvider : defaults.timingsProvider;

    return {
      timingsProvider: resolvedProvider,
      methodId:
        typeof (parsed as any).methodId === "number"
          ? (parsed as any).methodId
          : typeof (parsed as any).method === "number"
            ? (parsed as any).method
            : defaults.methodId,
      methodName:
        typeof (parsed as any).methodName === "string"
          ? (parsed as any).methodName
          : resolvedProvider === "diyanet"
            ? "Diyanet Official API"
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
            value?.tone === "Beep"
              ? "Beep"
              : value?.tone === "Adhan" ||
                  value?.tone === "Adhan - Makkah (Normal)" ||
                  value?.tone === "Adhan - Madinah (Soft)"
                ? "Adhan"
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

export function buildTimingsCacheKey(
  dateKey: string,
  lat: number,
  lon: number,
  methodId: number,
  provider: "aladhan" | "diyanet" = "aladhan"
): string {
  const latRounded = Number(lat.toFixed(2));
  const lonRounded = Number(lon.toFixed(2));
  return `timings:${dateKey}:${latRounded}:${lonRounded}:p${provider}:m${methodId}`;
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

export async function getCachedTimingsForDate(
  dateKey: string,
  provider: "aladhan" | "diyanet",
  methodId: number
): Promise<CachedTimings | null> {
  const prefix = `timings:${dateKey}:`;
  const suffix = `:p${provider}:m${methodId}`;

  const keys = (await AsyncStorage.getAllKeys()).filter(
    (key) => key.startsWith(prefix) && key.endsWith(suffix)
  );
  if (keys.length === 0) {
    return null;
  }

  const rows = await AsyncStorage.multiGet(keys);
  let newest: CachedTimings | null = null;
  for (const [, raw] of rows) {
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as CachedTimings;
      if (parsed.timings?.dateKey !== dateKey) {
        continue;
      }
      if (parsed.methodId !== methodId) {
        continue;
      }
      if ((parsed.provider ?? "aladhan") !== provider) {
        continue;
      }

      if (!newest) {
        newest = parsed;
        continue;
      }

      const currentTs = new Date(parsed.lastUpdated).getTime();
      const newestTs = new Date(newest.lastUpdated).getTime();
      if (Number.isFinite(currentTs) && (!Number.isFinite(newestTs) || currentTs > newestTs)) {
        newest = parsed;
      }
    } catch {
      // Ignore invalid cache rows.
    }
  }

  return newest;
}

export function buildQiblaCacheKey(lat: number, lon: number): string {
  const latRounded = Number(lat.toFixed(2));
  const lonRounded = Number(lon.toFixed(2));
  return `${QIBLA_CACHE_PREFIX}:${latRounded}:${lonRounded}`;
}

export async function getCachedQibla(key: string): Promise<CachedQibla | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedQibla;
  } catch {
    return null;
  }
}

export async function saveCachedQibla(key: string, value: CachedQibla): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
  await AsyncStorage.setItem(LATEST_QIBLA_CACHE_KEY, JSON.stringify(value));
}

export async function getLatestCachedQibla(): Promise<CachedQibla | null> {
  const raw = await AsyncStorage.getItem(LATEST_QIBLA_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedQibla;
  } catch {
    return null;
  }
}

export async function saveLatestCachedLocation(value: CachedLocation): Promise<void> {
  await AsyncStorage.setItem(LATEST_LOCATION_CACHE_KEY, JSON.stringify(value));
}

export async function getLatestCachedLocation(): Promise<CachedLocation | null> {
  const raw = await AsyncStorage.getItem(LATEST_LOCATION_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedLocation;
  } catch {
    return null;
  }
}

export async function getHomeDateMode(): Promise<HomeDateMode> {
  const value = await AsyncStorage.getItem(HOME_DATE_MODE_KEY);
  if (value === "hijri") {
    return "hijri";
  }
  return "gregorian";
}

export async function saveHomeDateMode(mode: HomeDateMode): Promise<void> {
  await AsyncStorage.setItem(HOME_DATE_MODE_KEY, mode);
}

export function buildMosquesCacheKey(lat: number, lon: number, radiusKm: number): string {
  const latRounded = Number(lat.toFixed(2));
  const lonRounded = Number(lon.toFixed(2));
  const radiusRounded = Number(radiusKm.toFixed(2));
  return `${MOSQUES_CACHE_PREFIX}:${latRounded}:${lonRounded}:${radiusRounded}`;
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveCachedJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function createDefaultMosquesSettings(): MosquesSettings {
  return {
    radiusKm: 5,
    travelMode: "walk"
  };
}

export async function getMosquesSettings(): Promise<MosquesSettings> {
  const raw = await AsyncStorage.getItem(MOSQUES_SETTINGS_KEY);
  if (!raw) {
    return createDefaultMosquesSettings();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MosquesSettings>;
    const defaults = createDefaultMosquesSettings();
    let radiusKm: MosquesSettings["radiusKm"] = defaults.radiusKm;
    if (parsed.radiusKm === 2 || parsed.radiusKm === 5 || parsed.radiusKm === 10 || parsed.radiusKm === 20) {
      radiusKm = parsed.radiusKm;
    }

    let travelMode: MosquesSettings["travelMode"] = defaults.travelMode;
    if (parsed.travelMode === "walk" || parsed.travelMode === "drive") {
      travelMode = parsed.travelMode;
    }

    return {
      radiusKm,
      travelMode
    };
  } catch {
    return createDefaultMosquesSettings();
  }
}

export async function saveMosquesSettings(value: MosquesSettings): Promise<void> {
  await AsyncStorage.setItem(MOSQUES_SETTINGS_KEY, JSON.stringify(value));
}

export async function getMosquesFavorites(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(MOSQUES_FAVORITES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export async function setMosquesFavorites(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
  await AsyncStorage.setItem(MOSQUES_FAVORITES_KEY, JSON.stringify(unique));
}

export async function getDefaultMosqueId(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(MOSQUES_DEFAULT_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function setDefaultMosqueId(id: string | null): Promise<void> {
  if (!id) {
    await AsyncStorage.removeItem(MOSQUES_DEFAULT_KEY);
    return;
  }

  await AsyncStorage.setItem(MOSQUES_DEFAULT_KEY, JSON.stringify(id));
}

function createDefaultZikrState(): ZikrState {
  const now = Date.now();
  return {
    activeKey: "subhanallah",
    entries: {
      subhanallah: { count: 0, target: 33, updatedAt: now },
      alhamdulillah: { count: 0, target: 33, updatedAt: now },
      allahuakbar: { count: 0, target: 34, updatedAt: now },
      la_ilaha_illallah: { count: 0, target: 100, updatedAt: now },
      custom: { count: 0, target: 100, updatedAt: now, label: "Custom", subtitle: "" }
    },
    updatedAt: now
  };
}

export async function getZikrState(): Promise<ZikrState> {
  const defaults = createDefaultZikrState();
  const rawV2 = await AsyncStorage.getItem(ZIKR_STATE_KEY);
  if (rawV2) {
    try {
      const parsed = JSON.parse(rawV2) as Partial<ZikrState>;
      return sanitizeZikrState(parsed, defaults);
    } catch {
      return defaults;
    }
  }

  const rawV1 = await AsyncStorage.getItem(ZIKR_STATE_V1_KEY);
  if (!rawV1) {
    return defaults;
  }

  try {
    const parsedV1 = JSON.parse(rawV1) as Partial<{
      count: number;
      target: number;
      zikrKey: string;
      updatedAt: number;
    }>;
    const migrated = migrateV1ToV2(parsedV1, defaults);
    await saveZikrState(migrated);
    return migrated;
  } catch {
    return defaults;
  }
}

export async function saveZikrState(state: ZikrState): Promise<void> {
  const sanitized = sanitizeZikrState(state, createDefaultZikrState());
  await AsyncStorage.setItem(
    ZIKR_STATE_KEY,
    JSON.stringify(sanitized)
  );
}

function isZikrKey(value: string): value is ZikrKey {
  return (
    value === "subhanallah" ||
    value === "alhamdulillah" ||
    value === "allahuakbar" ||
    value === "la_ilaha_illallah" ||
    value === "custom"
  );
}

function sanitizeZikrEntry(value: Partial<ZikrEntry> | undefined, fallback: ZikrEntry): ZikrEntry {
  return {
    count: typeof value?.count === "number" && value.count >= 0 ? Math.floor(value.count) : fallback.count,
    target: typeof value?.target === "number" && value.target > 0 ? Math.floor(value.target) : fallback.target,
    updatedAt:
      typeof value?.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : fallback.updatedAt,
    label: typeof value?.label === "string" && value.label.trim().length > 0 ? value.label.trim() : fallback.label,
    subtitle: typeof value?.subtitle === "string" ? value.subtitle.trim() : fallback.subtitle
  };
}

function sanitizeZikrState(value: Partial<ZikrState>, defaults: ZikrState): ZikrState {
  const activeKey =
    typeof value.activeKey === "string" && isZikrKey(value.activeKey) ? value.activeKey : defaults.activeKey;

  const entries: Record<ZikrKey, ZikrEntry> = {
    subhanallah: sanitizeZikrEntry(value.entries?.subhanallah, defaults.entries.subhanallah),
    alhamdulillah: sanitizeZikrEntry(value.entries?.alhamdulillah, defaults.entries.alhamdulillah),
    allahuakbar: sanitizeZikrEntry(value.entries?.allahuakbar, defaults.entries.allahuakbar),
    la_ilaha_illallah: sanitizeZikrEntry(value.entries?.la_ilaha_illallah, defaults.entries.la_ilaha_illallah),
    custom: sanitizeZikrEntry(value.entries?.custom, defaults.entries.custom)
  };

  return {
    activeKey,
    entries,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now()
  };
}

function migrateV1ToV2(
  v1: Partial<{ count: number; target: number; zikrKey: string; updatedAt: number }>,
  defaults: ZikrState
): ZikrState {
  const migrated: ZikrState = {
    ...defaults,
    entries: {
      ...defaults.entries
    }
  };

  const activeKey = typeof v1.zikrKey === "string" && isZikrKey(v1.zikrKey) ? v1.zikrKey : defaults.activeKey;
  const fallbackEntry = migrated.entries[activeKey];
  migrated.entries[activeKey] = sanitizeZikrEntry(
    {
      count: v1.count,
      target: v1.target,
      updatedAt: v1.updatedAt
    },
    fallbackEntry
  );
  migrated.activeKey = activeKey;
  migrated.updatedAt = Date.now();
  return migrated;
}

function createDefaultZikrSettings(): ZikrSettings {
  return {
    hapticsEnabled: true
  };
}

export async function getZikrSettings(): Promise<ZikrSettings> {
  const raw = await AsyncStorage.getItem(ZIKR_SETTINGS_KEY);
  const defaults = createDefaultZikrSettings();
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ZikrSettings>;
    return {
      hapticsEnabled:
        typeof parsed.hapticsEnabled === "boolean" ? parsed.hapticsEnabled : defaults.hapticsEnabled
    };
  } catch {
    return defaults;
  }
}

export async function saveZikrSettings(settings: ZikrSettings): Promise<void> {
  await AsyncStorage.setItem(
    ZIKR_SETTINGS_KEY,
    JSON.stringify({
      hapticsEnabled: Boolean(settings.hapticsEnabled)
    })
  );
}
