import { getTimingsByCoordinates as getAladhanTimings } from "@/services/aladhan";
import { getTimingsByCoordinates as getDiyanetTimings } from "@/services/diyanet";
import { Settings, Timings } from "@/types/prayer";

export async function getTimingsBySettings(
  date: Date,
  lat: number,
  lon: number,
  settings: Settings,
  cityHintOverride?: string
): Promise<Timings> {
  if (settings.timingsProvider === "diyanet") {
    const cityHint = settings.locationMode === "manual" ? settings.manualLocation?.label : cityHintOverride;
    return getDiyanetTimings(date, lat, lon, cityHint);
  }

  return getAladhanTimings(date, lat, lon, settings.methodId, 1);
}
