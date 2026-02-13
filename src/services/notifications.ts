import * as Notifications from "expo-notifications";
import { getSystemLanguage, translate, translatePrayerName } from "@/i18n/I18nProvider";
import { getTodayTomorrowTimings } from "@/services/timingsCache";
import { getDateKey, getTomorrow, parsePrayerTimeForDate } from "@/utils/time";
import { PRAYER_NAMES, PrayerNotificationSetting, Settings, Timings } from "@/types/prayer";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as { playSound?: boolean };
    return {
      shouldPlaySound: data.playSound !== false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true
    };
  }
});

export async function registerForLocalNotifications(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const request = await Notifications.requestPermissionsAsync();
  return request.granted || request.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function cancelAllScheduled(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

let replanQueue: Promise<void> = Promise.resolve();
let lastAppliedSignature = "";
let lastAppliedAt = 0;

type ScheduledIntent = "offset" | "at_time";
const ADHAN_SOUND_FILE = "adhan_short.wav";

export function resolveNotificationSound(
  playSound: boolean,
  tone: PrayerNotificationSetting["tone"]
): string | undefined {
  if (!playSound) {
    return undefined;
  }
  return tone === "Adhan" ? ADHAN_SOUND_FILE : "default";
}

function createReplanSignature(params: {
  lat: number;
  lon: number;
  methodId: number;
  settings: Settings;
}): string {
  const roundedLat = Number(params.lat.toFixed(4));
  const roundedLon = Number(params.lon.toFixed(4));
  return JSON.stringify({
    lat: roundedLat,
    lon: roundedLon,
    provider: params.settings.timingsProvider,
    methodId: params.methodId,
    locationMode: params.settings.locationMode,
    manualLocation: params.settings.manualLocation
      ? {
          label: params.settings.manualLocation.label,
          lat: Number(params.settings.manualLocation.lat.toFixed(4)),
          lon: Number(params.settings.manualLocation.lon.toFixed(4))
        }
      : null,
    prayers: PRAYER_NAMES.map((prayer) => ({
      prayer,
      enabled: params.settings.prayerNotifications[prayer].enabled,
      minutesBefore: params.settings.prayerNotifications[prayer].minutesBefore
    }))
  });
}

async function scheduleOne(params: {
  triggerAt: Date;
  prayer: (typeof PRAYER_NAMES)[number];
  dateKey: string;
  intent: ScheduledIntent;
  minutesBefore: number;
  playSound: boolean;
  tone: PrayerNotificationSetting["tone"];
  dedupeSet: Set<string>;
}): Promise<void> {
  const now = Date.now();
  if (params.triggerAt.getTime() <= now) {
    return;
  }

  const dedupeKey = [
    params.dateKey,
    params.prayer,
    params.intent,
    params.minutesBefore,
    params.triggerAt.getTime()
  ].join(":");

  if (params.dedupeSet.has(dedupeKey)) {
    return;
  }
  params.dedupeSet.add(dedupeKey);

  const language = getSystemLanguage();
  const prayerLabel = translatePrayerName(language, params.prayer);
  const body =
    params.intent === "offset"
      ? translate(language, "notifications.body_offset", {
          prayer: prayerLabel,
          mins: params.minutesBefore
        })
      : translate(language, "notifications.body_at_time", { prayer: prayerLabel });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(language, "notifications.title"),
      body,
      data: {
        prayer: params.prayer,
        dateKey: params.dateKey,
        intent: params.intent,
        minutesBefore: params.minutesBefore,
        playSound: params.playSound,
        tone: params.tone,
        dedupeKey
      },
      sound: resolveNotificationSound(params.playSound, params.tone)
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.triggerAt
    }
  });
}

export async function schedulePrayerNotificationsForDay(
  date: Date,
  timings: Timings,
  settings: Settings,
  dedupeSet: Set<string>
): Promise<void> {
  for (const prayer of PRAYER_NAMES) {
    const prayerSetting = settings.prayerNotifications[prayer];
    if (!prayerSetting?.enabled) {
      continue;
    }

    const prayerAt = parsePrayerTimeForDate(date, timings.times[prayer]);

    if (prayerSetting.minutesBefore > 0) {
      const beforeAt = new Date(prayerAt.getTime() - prayerSetting.minutesBefore * 60 * 1000);
      await scheduleOne({
        triggerAt: beforeAt,
        prayer,
        dateKey: timings.dateKey,
        intent: "offset",
        minutesBefore: prayerSetting.minutesBefore,
        playSound: prayerSetting.playSound,
        tone: prayerSetting.tone,
        dedupeSet
      });
    }

    await scheduleOne({
      triggerAt: prayerAt,
      prayer,
      dateKey: timings.dateKey,
      intent: "at_time",
      minutesBefore: prayerSetting.minutesBefore,
      playSound: prayerSetting.playSound,
      tone: prayerSetting.tone,
      dedupeSet
    });
  }
}

async function replanAllOnce(params: {
  lat: number;
  lon: number;
  methodId: number;
  settings: Settings;
}): Promise<void> {
  const granted = await registerForLocalNotifications();
  if (!granted) {
    return;
  }

  const signature = createReplanSignature(params);
  if (signature === lastAppliedSignature && Date.now() - lastAppliedAt < 10_000) {
    return;
  }

  await cancelAllScheduled();

  const today = new Date();
  const tomorrow = getTomorrow(today);
  const stats = {
    scheduled: 0,
    atTime: 0,
    offset: 0
  };

  const resolved = await getTodayTomorrowTimings({
    today,
    location: { lat: params.lat, lon: params.lon },
    settings: params.settings,
    forceRefresh: false,
    rangeDays: params.settings.timingsProvider === "aladhan" ? 2 : 30
  });
  const todayTimings = resolved.today;
  const tomorrowTimings = resolved.tomorrow;

  if (todayTimings.dateKey !== getDateKey(today)) {
    throw new Error("Today timings date mismatch.");
  }

  const dedupeSet = new Set<string>();
  const scheduleWithStats = async (date: Date, timings: Timings) => {
    for (const prayer of PRAYER_NAMES) {
      const prayerSetting = params.settings.prayerNotifications[prayer];
      if (!prayerSetting?.enabled) {
        continue;
      }

      const prayerAt = parsePrayerTimeForDate(date, timings.times[prayer]);
      const beforeAt = new Date(prayerAt.getTime() - prayerSetting.minutesBefore * 60 * 1000);

      const beforeCount = dedupeSet.size;
      if (prayerSetting.minutesBefore > 0) {
        await scheduleOne({
          triggerAt: beforeAt,
          prayer,
          dateKey: timings.dateKey,
          intent: "offset",
          minutesBefore: prayerSetting.minutesBefore,
          playSound: prayerSetting.playSound,
          tone: prayerSetting.tone,
          dedupeSet
        });
        if (dedupeSet.size > beforeCount) {
          stats.scheduled += 1;
          stats.offset += 1;
        }
      }

      const beforeAtTimeCount = dedupeSet.size;
      await scheduleOne({
        triggerAt: prayerAt,
        prayer,
        dateKey: timings.dateKey,
        intent: "at_time",
        minutesBefore: prayerSetting.minutesBefore,
        playSound: prayerSetting.playSound,
        tone: prayerSetting.tone,
        dedupeSet
      });
      if (dedupeSet.size > beforeAtTimeCount) {
        stats.scheduled += 1;
        stats.atTime += 1;
      }
    }
  };
  await scheduleWithStats(today, todayTimings);
  await scheduleWithStats(tomorrow, tomorrowTimings);

  lastAppliedSignature = signature;
  lastAppliedAt = Date.now();

  if (__DEV__) {
    console.log(
      `[notifications] replanned total=${stats.scheduled} at_time=${stats.atTime} offset=${stats.offset} provider=${params.settings.timingsProvider} method=${params.methodId}`
    );
  }
}

export function replanAll(params: {
  lat: number;
  lon: number;
  methodId: number;
  settings: Settings;
}): Promise<void> {
  replanQueue = replanQueue.then(
    () => replanAllOnce(params),
    () => replanAllOnce(params)
  );
  return replanQueue;
}
