export type HijriDateParts = {
  year: number;
  month: number;
  day: number;
};

export type RamadanRange = {
  start: Date;
  end: Date;
  days: Date[];
  hijriYear: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function atLocalNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

export function addCalendarDays(date: Date, amount: number): Date {
  const next = atLocalNoon(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function localDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function getCalculatedHijriDateParts(date: Date): HijriDateParts {
  const gregorianYear = date.getFullYear();
  const gregorianMonth = date.getMonth() + 1;
  const gregorianDay = date.getDate();
  const adjustment = Math.floor((14 - gregorianMonth) / 12);
  const adjustedYear = gregorianYear + 4800 - adjustment;
  const adjustedMonth = gregorianMonth + 12 * adjustment - 3;
  const julianDay =
    gregorianDay +
    Math.floor((153 * adjustedMonth + 2) / 5) +
    365 * adjustedYear +
    Math.floor(adjustedYear / 4) -
    Math.floor(adjustedYear / 100) +
    Math.floor(adjustedYear / 400) -
    32045;

  let remainder = julianDay - 1948440 + 10632;
  const cycle = Math.floor((remainder - 1) / 10631);
  remainder = remainder - 10631 * cycle + 354;
  const yearInCycle =
    Math.floor((10985 - remainder) / 5316) * Math.floor((50 * remainder) / 17719) +
    Math.floor(remainder / 5670) * Math.floor((43 * remainder) / 15238);
  remainder =
    remainder -
    Math.floor((30 - yearInCycle) / 15) * Math.floor((17719 * yearInCycle) / 50) -
    Math.floor(yearInCycle / 16) * Math.floor((15238 * yearInCycle) / 43) +
    29;
  const month = Math.floor((24 * remainder) / 709);
  const day = remainder - Math.floor((709 * month) / 24);
  const year = 30 * cycle + yearInCycle - 30;
  return { year, month, day };
}

export function getHijriDateParts(date: Date): HijriDateParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
      year: "numeric",
      month: "numeric",
      day: "numeric"
    });
    const parts = formatter.formatToParts(atLocalNoon(date));
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return getCalculatedHijriDateParts(date);
    }
    return { year, month, day };
  } catch {
    return getCalculatedHijriDateParts(date);
  }
}

function dateDiffDays(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / DAY_MS);
}

function findCalculatedRamadan(referenceDate: Date): RamadanRange | null {
  const searchStart = addCalendarDays(referenceDate, -35);
  const searchEnd = addCalendarDays(referenceDate, 430);
  let start: Date | null = null;
  let hijriYear = 0;

  for (let cursor = searchStart; cursor <= searchEnd; cursor = addCalendarDays(cursor, 1)) {
    const hijri = getHijriDateParts(cursor);
    const previous = getHijriDateParts(addCalendarDays(cursor, -1));
    if (hijri?.month === 9 && previous?.month !== 9) {
      const candidateEnd = (() => {
        let last = cursor;
        for (let offset = 1; offset <= 31; offset += 1) {
          const next = addCalendarDays(cursor, offset);
          if (getHijriDateParts(next)?.month !== 9) {
            return last;
          }
          last = next;
        }
        return last;
      })();

      if (referenceDate <= addCalendarDays(candidateEnd, 35)) {
        start = cursor;
        hijriYear = hijri.year;
        break;
      }
    }
  }

  if (!start) {
    return null;
  }

  const days: Date[] = [];
  for (let offset = 0; offset < 31; offset += 1) {
    const day = addCalendarDays(start, offset);
    if (getHijriDateParts(day)?.month !== 9) {
      break;
    }
    days.push(day);
  }

  if (days.length < 29) {
    return null;
  }

  return {
    start: days[0],
    end: days[days.length - 1],
    days,
    hijriYear
  };
}

export function getRamadanRange(referenceDate: Date, correctionDays: -1 | 0 | 1): RamadanRange | null {
  const calculated = findCalculatedRamadan(referenceDate);
  if (!calculated) {
    return null;
  }
  const days = calculated.days.map((day) => addCalendarDays(day, correctionDays));
  return {
    ...calculated,
    start: days[0],
    end: days[days.length - 1],
    days
  };
}

export function getRamadanDayNumber(date: Date, range: RamadanRange): number | null {
  const difference = dateDiffDays(range.start, date);
  if (difference < 0 || difference >= range.days.length) {
    return null;
  }
  return difference + 1;
}

export function timeOnDate(date: Date, hhmm: string | undefined): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

export function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
