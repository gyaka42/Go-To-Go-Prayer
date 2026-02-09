import { PRAYER_NAMES, PrayerName, Timings } from "@/types/prayer";

export function parsePrayerTimeForDate(day: Date, timeHHmm: string): Date {
  const [hours, minutes] = timeHHmm.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
}

export function getDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export function getNextPrayer(timings: Timings, now: Date): { prayer: PrayerName; time: Date } | null {
  for (const prayer of PRAYER_NAMES) {
    const prayerDate = parsePrayerTimeForDate(now, timings.times[prayer]);
    if (prayerDate.getTime() > now.getTime()) {
      return {
        prayer,
        time: prayerDate
      };
    }
  }

  return null;
}

export function getTomorrow(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}
