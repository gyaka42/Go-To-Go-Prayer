import { PrayerName, Timings } from "@/types/prayer";

const BASE_URL = "https://api.aladhan.com/v1";
const REQUIRED_PRAYERS: PrayerName[] = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function parseTime(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing prayer time in Aladhan response.");
  }

  const match = raw.match(/(\d{1,2}:\d{2})/);
  if (!match) {
    throw new Error(`Invalid prayer time format: ${raw}`);
  }

  return match[1];
}

export async function getTimingsByCoordinates(
  date: Date,
  lat: number,
  lon: number,
  methodId: number,
  school: 0 | 1 = 1,
  tuneCsv?: string
): Promise<Timings> {
  const dateKey = toDateKey(date);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    method: String(methodId),
    school: String(school)
  });
  if (tuneCsv) {
    params.set("tune", tuneCsv);
  }

  const url = `${BASE_URL}/timings/${dateKey}?${params.toString()}`;
  let response: Response | null = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url);
    if (response.ok) {
      break;
    }
    lastStatus = response.status;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) {
      break;
    }
    await sleep(700 * (attempt + 1));
  }
  if (!response || !response.ok) {
    throw new Error(`Aladhan API error: ${lastStatus || response?.status || "unknown"}`);
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Invalid Aladhan JSON response: ${String(error)}`);
  }

  const timingsData = payload?.data?.timings;
  const timezone = payload?.data?.meta?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timingsData) {
    throw new Error("Aladhan response does not include timings.");
  }

  const times = REQUIRED_PRAYERS.reduce((acc, prayer) => {
    acc[prayer] = parseTime(timingsData[prayer]);
    return acc;
  }, {} as Record<PrayerName, string>);

  return {
    dateKey,
    timezone,
    times
  };
}
