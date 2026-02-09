import * as Notifications from "expo-notifications";
import { getTimingsByCoordinates } from "@/services/aladhan";
import { getDateKey, getTomorrow, parsePrayerTimeForDate } from "@/utils/time";
import { PRAYER_NAMES, Settings, Timings } from "@/types/prayer";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true
  })
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

export async function schedulePrayerNotificationsForDay(
  date: Date,
  timings: Timings,
  settings: Settings
): Promise<void> {
  const now = new Date();

  for (const prayer of PRAYER_NAMES) {
    const prayerSetting = settings.prayerNotifications[prayer];
    if (!prayerSetting?.enabled) {
      continue;
    }

    const prayerAt = parsePrayerTimeForDate(date, timings.times[prayer]);
    const triggerAt = new Date(prayerAt.getTime() - prayerSetting.minutesBefore * 60 * 1000);
    if (triggerAt.getTime() <= now.getTime()) {
      continue;
    }

    const body =
      prayerSetting.minutesBefore === 0
        ? `It's time for ${prayer}.`
        : `${prayer} in ${prayerSetting.minutesBefore} minutes.`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Prayer time",
        body,
        data: {
          prayer,
          dateKey: timings.dateKey
        }
      },
      trigger: {
        type: "date",
        timestamp: triggerAt.getTime()
      } as any
    });
  }
}

export async function replanAll(params: {
  lat: number;
  lon: number;
  methodId: number;
  settings: Settings;
}): Promise<void> {
  const granted = await registerForLocalNotifications();
  if (!granted) {
    return;
  }

  await cancelAllScheduled();

  const today = new Date();
  const tomorrow = getTomorrow(today);

  const todayTimings = await getTimingsByCoordinates(today, params.lat, params.lon, params.methodId, 1);
  const tomorrowTimings = await getTimingsByCoordinates(tomorrow, params.lat, params.lon, params.methodId, 1);

  if (todayTimings.dateKey !== getDateKey(today)) {
    throw new Error("Today timings date mismatch.");
  }

  await schedulePrayerNotificationsForDay(today, todayTimings, params.settings);
  await schedulePrayerNotificationsForDay(tomorrow, tomorrowTimings, params.settings);
}
