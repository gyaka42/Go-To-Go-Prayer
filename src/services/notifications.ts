import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { AppLanguage } from "@/i18n/translations";
import { getPreferredLanguage, translate, translatePrayerName } from "@/i18n/I18nProvider";
import {
  addCalendarDays,
  getRamadanDayNumber,
  getRamadanRange,
  localDateKey,
  RamadanRange
} from "@/ramadan/calendar";
import { getLocationName } from "@/services/location";
import { getRamadanState, RamadanNotificationSettings, RamadanState } from "@/services/storage";
import { getTodayTomorrowTimings } from "@/services/timingsCache";
import { getDateKey, getTomorrow, parsePrayerTimeForDate } from "@/utils/time";
import { PRAYER_NAMES, PrayerNotificationSetting, Settings, Timings } from "@/types/prayer";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as { playSound?: boolean };
    return {
      // Sound is a user preference only; silent prayer alerts must still be shown.
      shouldPlaySound: data.playSound !== false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true
    };
  }
});

export function isNotificationPermissionGranted(
  permission: Notifications.NotificationPermissionsStatus
): boolean {
  return (
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

export async function registerForLocalNotifications(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (isNotificationPermissionGranted(settings)) {
    return true;
  }

  const request = await Notifications.requestPermissionsAsync();
  return isNotificationPermissionGranted(request);
}

export async function cancelAllScheduled(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

let replanQueue: Promise<void> = Promise.resolve();
let lastAppliedSignature = "";
let lastAppliedAt = 0;

type ScheduledIntent = "offset" | "at_time";
type RamadanSeasonAnnouncement = "week_before" | "kadir_day_before";
const ADHAN_SOUND_FILE = "adhan_short.wav";
const ANDROID_VIBRATION_PATTERN = [0, 250, 180, 250];
const RAMADAN_ANNOUNCEMENT_HOUR = 10;

export async function ensureAndroidPrayerNotificationChannel(params: {
  playSound: boolean;
  tone: PrayerNotificationSetting["tone"];
  vibration: boolean;
}): Promise<string | undefined> {
  if (Platform.OS !== "android") {
    return undefined;
  }

  const soundKey = params.playSound ? (params.tone === "Adhan" ? "adhan" : "default") : "silent";
  const vibrationKey = params.vibration ? "vibrate" : "still";
  const channelId = `prayer-${soundKey}-${vibrationKey}-v1`;
  const sound = params.playSound
    ? params.tone === "Adhan"
      ? ADHAN_SOUND_FILE
      : "default"
    : null;

  await Notifications.setNotificationChannelAsync(channelId, {
    name: `Prayer alerts (${soundKey}, ${vibrationKey})`,
    description: "Prayer time reminders from GoToGo Prayer",
    importance: Notifications.AndroidImportance.HIGH,
    sound,
    enableVibrate: params.vibration,
    vibrationPattern: params.vibration ? ANDROID_VIBRATION_PATTERN : null,
    showBadge: false,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION
    }
  });

  return channelId;
}

export interface PrayerNotificationScheduleSummary {
  total: number;
  atTime: number;
  offset: number;
  byPrayer: Record<(typeof PRAYER_NAMES)[number], number>;
}

export interface RamadanNotificationScheduleSummary {
  total: number;
  imsak: number;
  iftar: number;
}

export async function getRamadanNotificationScheduleSummary(): Promise<RamadanNotificationScheduleSummary> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  let imsak = 0;
  let iftar = 0;
  for (const request of scheduled) {
    const event = (request.content.data ?? {}).ramadanEvent;
    if (event === "imsak") imsak += 1;
    if (event === "iftar") iftar += 1;
  }
  return { total: imsak + iftar, imsak, iftar };
}

export async function scheduleRamadanTestNotification(
  settings: RamadanNotificationSettings
): Promise<boolean> {
  const granted = await registerForLocalNotifications();
  if (!granted) return false;
  const language = await getPreferredLanguage();
  const channelId = await ensureAndroidPrayerNotificationChannel({
    playSound: settings.playSound,
    tone: "Beep",
    vibration: settings.vibration
  });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(language, "ramadan.notifications_title"),
      body: translate(language, "ramadan.notifications_test_body"),
      data: {
        ramadanEvent: "test",
        playSound: settings.playSound,
        vibration: settings.vibration
      },
      sound: settings.playSound ? "default" : false,
      vibrate: settings.vibration ? ANDROID_VIBRATION_PATTERN : []
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
      repeats: false,
      ...(channelId ? { channelId } : {})
    }
  });
  return true;
}

export async function getPrayerNotificationScheduleSummary(): Promise<PrayerNotificationScheduleSummary> {
  const byPrayer = PRAYER_NAMES.reduce((acc, prayer) => {
    acc[prayer] = 0;
    return acc;
  }, {} as Record<(typeof PRAYER_NAMES)[number], number>);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  let atTime = 0;
  let offset = 0;

  for (const request of scheduled) {
    const data = (request.content.data ?? {}) as { prayer?: string; intent?: ScheduledIntent };
    if (!PRAYER_NAMES.includes(data.prayer as (typeof PRAYER_NAMES)[number])) {
      continue;
    }

    byPrayer[data.prayer as (typeof PRAYER_NAMES)[number]] += 1;
    if (data.intent === "offset") {
      offset += 1;
    } else {
      atTime += 1;
    }
  }

  return {
    total: atTime + offset,
    atTime,
    offset,
    byPrayer
  };
}

function toNotificationLocationLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const firstPart = value
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  return firstPart || null;
}

export function resolveNotificationSound(
  playSound: boolean,
  tone: PrayerNotificationSetting["tone"]
): boolean | string {
  if (!playSound) {
    return false;
  }
  return tone === "Adhan" ? ADHAN_SOUND_FILE : "default";
}

function createReplanSignature(params: {
  lat: number;
  lon: number;
  methodId: number;
  settings: Settings;
  language: AppLanguage;
  ramadanState: RamadanState;
}): string {
  const roundedLat = Number(params.lat.toFixed(4));
  const roundedLon = Number(params.lon.toFixed(4));
  return JSON.stringify({
    lat: roundedLat,
    lon: roundedLon,
    provider: params.settings.timingsProvider,
    methodId: params.methodId,
    language: params.language,
    locationMode: params.settings.locationMode,
    manualLocation: params.settings.manualLocation
      ? {
          label: params.settings.manualLocation.label,
          lat: Number(params.settings.manualLocation.lat.toFixed(4)),
          lon: Number(params.settings.manualLocation.lon.toFixed(4))
        }
      : null,
    ramadan: {
      dateCorrection: params.ramadanState.dateCorrection,
      notifications: params.ramadanState.notifications
    },
    prayers: PRAYER_NAMES.map((prayer) => {
      const setting = params.settings.prayerNotifications[prayer];
      return {
        prayer,
        enabled: setting.enabled,
        minutesBefore: setting.minutesBefore,
        playSound: setting.playSound,
        tone: setting.tone,
        volume: setting.volume,
        vibration: setting.vibration
      };
    })
  });
}

async function scheduleRamadanReminder(params: {
  triggerAt: Date;
  event: "imsak" | "iftar";
  dateKey: string;
  minutesBefore: number;
  settings: RamadanNotificationSettings;
  language: AppLanguage;
  dedupeSet: Set<string>;
}): Promise<boolean> {
  if (params.triggerAt.getTime() <= Date.now()) {
    return false;
  }

  const dedupeKey = [
    "ramadan",
    params.dateKey,
    params.event,
    params.minutesBefore,
    params.triggerAt.getTime()
  ].join(":");
  if (params.dedupeSet.has(dedupeKey)) {
    return false;
  }
  params.dedupeSet.add(dedupeKey);

  const channelId = await ensureAndroidPrayerNotificationChannel({
    playSound: params.settings.playSound,
    tone: "Beep",
    vibration: params.settings.vibration
  });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(params.language, "ramadan.notifications_title"),
      body: translate(
        params.language,
        params.event === "imsak"
          ? "ramadan.notifications_imsak_body"
          : "ramadan.notifications_iftar_body",
        { mins: params.minutesBefore }
      ),
      data: {
        ramadanEvent: params.event,
        dateKey: params.dateKey,
        minutesBefore: params.minutesBefore,
        playSound: params.settings.playSound,
        vibration: params.settings.vibration,
        dedupeKey
      },
      sound: params.settings.playSound ? "default" : false,
      vibrate: params.settings.vibration ? ANDROID_VIBRATION_PATTERN : []
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.triggerAt,
      ...(channelId ? { channelId } : {})
    }
  });
  return true;
}

export function getRamadanSeasonAnnouncementDates(range: RamadanRange): Record<RamadanSeasonAnnouncement, Date> {
  const atAnnouncementTime = (date: Date) =>
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      RAMADAN_ANNOUNCEMENT_HOUR,
      0,
      0,
      0
    );

  return {
    week_before: atAnnouncementTime(addCalendarDays(range.start, -7)),
    // Diyanet observes Kadir Gecesi on the evening of 26 Ramadan (the 27th night).
    // Schedule on Ramadan day 25 so the user receives it one full day beforehand.
    kadir_day_before: atAnnouncementTime(range.days[24])
  };
}

async function scheduleRamadanSeasonAnnouncement(params: {
  triggerAt: Date;
  event: RamadanSeasonAnnouncement;
  settings: RamadanNotificationSettings;
  language: AppLanguage;
  dedupeSet: Set<string>;
}): Promise<boolean> {
  if (params.triggerAt.getTime() <= Date.now()) {
    return false;
  }

  const dateKey = localDateKey(params.triggerAt);
  const dedupeKey = ["ramadan", dateKey, params.event, params.triggerAt.getTime()].join(":");
  if (params.dedupeSet.has(dedupeKey)) {
    return false;
  }
  params.dedupeSet.add(dedupeKey);

  const isWeekBefore = params.event === "week_before";
  const channelId = await ensureAndroidPrayerNotificationChannel({
    playSound: params.settings.playSound,
    tone: "Beep",
    vibration: params.settings.vibration
  });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(
        params.language,
        isWeekBefore ? "ramadan.announcement_week_title" : "ramadan.announcement_kadir_title"
      ),
      body: translate(
        params.language,
        isWeekBefore ? "ramadan.announcement_week_body" : "ramadan.announcement_kadir_body"
      ),
      data: {
        ramadanEvent: params.event,
        dateKey,
        playSound: params.settings.playSound,
        vibration: params.settings.vibration,
        dedupeKey
      },
      sound: params.settings.playSound ? "default" : false,
      vibrate: params.settings.vibration ? ANDROID_VIBRATION_PATTERN : []
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.triggerAt,
      ...(channelId ? { channelId } : {})
    }
  });
  return true;
}

async function scheduleOne(params: {
  triggerAt: Date;
  prayer: (typeof PRAYER_NAMES)[number];
  dateKey: string;
  intent: ScheduledIntent;
  minutesBefore: number;
  playSound: boolean;
  tone: PrayerNotificationSetting["tone"];
  vibration: boolean;
  language: AppLanguage;
  locationLabel?: string | null;
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

  const prayerLabel = translatePrayerName(params.language, params.prayer);
  const body =
    params.intent === "offset"
      ? params.locationLabel
        ? translate(params.language, "notifications.body_offset_with_location", {
            prayer: prayerLabel,
            mins: params.minutesBefore,
            location: params.locationLabel
          })
        : translate(params.language, "notifications.body_offset", {
            prayer: prayerLabel,
            mins: params.minutesBefore
          })
      : params.locationLabel
        ? translate(params.language, "notifications.body_at_time_with_location", {
            prayer: prayerLabel,
            location: params.locationLabel
          })
        : translate(params.language, "notifications.body_at_time", { prayer: prayerLabel });

  const channelId = await ensureAndroidPrayerNotificationChannel({
    playSound: params.playSound,
    tone: params.tone,
    vibration: params.vibration
  });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(params.language, "notifications.title"),
      body,
      data: {
        prayer: params.prayer,
        dateKey: params.dateKey,
        intent: params.intent,
        minutesBefore: params.minutesBefore,
        playSound: params.playSound,
        tone: params.tone,
        vibration: params.vibration,
        dedupeKey
      },
      sound: resolveNotificationSound(params.playSound, params.tone),
      vibrate: params.vibration ? ANDROID_VIBRATION_PATTERN : []
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.triggerAt,
      ...(channelId ? { channelId } : {})
    }
  });
}

export async function schedulePrayerNotificationsForDay(
  date: Date,
  timings: Timings,
  settings: Settings,
  dedupeSet: Set<string>
): Promise<void> {
  const language = await getPreferredLanguage();
  let locationLabel =
    settings.locationMode === "manual" ? toNotificationLocationLabel(settings.manualLocation?.label) : null;
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
        vibration: prayerSetting.vibration,
        language,
        locationLabel,
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
      vibration: prayerSetting.vibration,
      language,
      locationLabel,
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

  const language = await getPreferredLanguage();
  const ramadanState = await getRamadanState();
  const signature = createReplanSignature({ ...params, language, ramadanState });
  if (signature === lastAppliedSignature && Date.now() - lastAppliedAt < 10_000) {
    const hasEnabledPrayer = PRAYER_NAMES.some((prayer) => params.settings.prayerNotifications[prayer]?.enabled);
    const summary = await getPrayerNotificationScheduleSummary().catch(() => null);
    if (!hasEnabledPrayer || (summary?.total ?? 0) > 0) {
      return;
    }
  }

  await cancelAllScheduled();

  const today = new Date();
  const tomorrow = getTomorrow(today);
  const stats = {
    scheduled: 0,
    atTime: 0,
    offset: 0,
    ramadan: 0,
    seasonal: 0
  };

  const resolved = await getTodayTomorrowTimings({
    today,
    location: { lat: params.lat, lon: params.lon },
    settings: params.settings,
    forceRefresh: false,
    rangeDays: 2
  });
  const todayTimings = resolved.today;
  const tomorrowTimings = resolved.tomorrow;
  let locationLabel =
    params.settings.locationMode === "manual"
      ? toNotificationLocationLabel(params.settings.manualLocation?.label)
      : null;
  if (!locationLabel) {
    try {
      const resolvedLabel = await getLocationName(params.lat, params.lon);
      locationLabel = resolvedLabel === "Unknown location" ? null : toNotificationLocationLabel(resolvedLabel);
    } catch {
      locationLabel = null;
    }
  }

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
          vibration: prayerSetting.vibration,
          language,
          locationLabel,
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
        vibration: prayerSetting.vibration,
        language,
        locationLabel,
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

  const ramadanRange = getRamadanRange(today, ramadanState.dateCorrection);
  const scheduleRamadanForDate = async (date: Date, timings: Timings) => {
    if (!ramadanRange || !getRamadanDayNumber(date, ramadanRange)) {
      return;
    }
    const reminderSettings = ramadanState.notifications;
    const reminders = [
      {
        enabled: reminderSettings.imsakEnabled,
        event: "imsak" as const,
        time: timings.times.Fajr,
        minutesBefore: reminderSettings.imsakMinutesBefore
      },
      {
        enabled: reminderSettings.iftarEnabled,
        event: "iftar" as const,
        time: timings.times.Maghrib,
        minutesBefore: reminderSettings.iftarMinutesBefore
      }
    ];
    for (const reminder of reminders) {
      if (!reminder.enabled) continue;
      const eventAt = parsePrayerTimeForDate(date, reminder.time);
      const triggerAt = new Date(eventAt.getTime() - reminder.minutesBefore * 60 * 1000);
      const scheduled = await scheduleRamadanReminder({
        triggerAt,
        event: reminder.event,
        dateKey: timings.dateKey,
        minutesBefore: reminder.minutesBefore,
        settings: reminderSettings,
        language,
        dedupeSet
      });
      if (scheduled) stats.ramadan += 1;
    }
  };
  await scheduleRamadanForDate(today, todayTimings);
  await scheduleRamadanForDate(tomorrow, tomorrowTimings);

  if (ramadanRange) {
    const announcementDates = getRamadanSeasonAnnouncementDates(ramadanRange);
    for (const event of ["week_before", "kadir_day_before"] as const) {
      const scheduled = await scheduleRamadanSeasonAnnouncement({
        triggerAt: announcementDates[event],
        event,
        settings: ramadanState.notifications,
        language,
        dedupeSet
      });
      if (scheduled) stats.seasonal += 1;
    }
  }

  lastAppliedSignature = signature;
  lastAppliedAt = Date.now();

  if (__DEV__) {
    console.log(
      `[notifications] replanned total=${stats.scheduled + stats.ramadan + stats.seasonal} at_time=${stats.atTime} offset=${stats.offset} ramadan=${stats.ramadan} seasonal=${stats.seasonal} provider=${params.settings.timingsProvider} method=${params.methodId}`
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
