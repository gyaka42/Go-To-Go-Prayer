import { QuranAudioInfo, QuranAyah, SurahMeta, SurahSummary, VerseRow } from "@/types/quran";

const DEFAULT_DIYANET_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";

const inFlight = new Map<string, Promise<unknown>>();

function normalizeProxyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function getProxyBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_DIYANET_PROXY_URL?.trim() || DEFAULT_DIYANET_PROXY_URL;
  return normalizeProxyBaseUrl(raw);
}

function toLocaleLang(localeTag?: string): string {
  const base = String(localeTag || "tr")
    .split(",")[0]
    .split("-")[0]
    .trim()
    .toLowerCase();
  if (base === "tr" || base === "nl" || base === "en") {
    return base;
  }
  return "tr";
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestWithRetry<T>(
  key: string,
  factory: () => Promise<T>,
  retries: number = 1
): Promise<T> {
  const current = inFlight.get(key) as Promise<T> | undefined;
  if (current) {
    return current;
  }

  const run = (async () => {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= retries) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt <= retries) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })();

  inFlight.set(key, run as Promise<unknown>);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

function assertSurahSummaryRows(raw: unknown): SurahSummary[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).items)) {
    throw new Error("Invalid Quran surah list response.");
  }

  return (raw as any).items
    .map((item: any) => ({
      id: Number(item?.id),
      nameArabic: String(item?.nameArabic || "").trim(),
      nameLatin: String(item?.nameLatin || "").trim(),
      ayahCount: Number(item?.ayahCount || 0)
    }))
    .filter((item: SurahSummary) => item.id > 0 && item.nameArabic.length > 0 && item.nameLatin.length > 0)
    .sort((a: SurahSummary, b: SurahSummary) => a.id - b.id);
}

function assertSurahDetail(raw: unknown): { surah: SurahMeta; verses: VerseRow[] } {
  const payload = raw as any;
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Quran surah detail response.");
  }

  const surahRaw = payload.surah;
  const versesRaw = payload.verses;
  if (!surahRaw || typeof surahRaw !== "object" || !Array.isArray(versesRaw)) {
    throw new Error("Invalid Quran surah detail response.");
  }

  const surah: SurahMeta = {
    id: Number(surahRaw.id),
    nameArabic: String(surahRaw.nameArabic || "").trim(),
    nameLatin: String(surahRaw.nameLatin || "").trim(),
    ayahCount: Number(surahRaw.ayahCount || 0)
  };

  const verses: VerseRow[] = versesRaw
    .map((row: any) => ({
      key: String(row?.key || "").trim(),
      numberInSurah: Number(row?.numberInSurah || 0),
      arabic: String(row?.arabic || "").trim(),
      translationTr: String(row?.translationTr || "").trim()
    }))
    .filter((row: VerseRow) => row.key.length > 0 && row.numberInSurah > 0 && row.arabic.length > 0)
    .sort((a: VerseRow, b: VerseRow) => a.numberInSurah - b.numberInSurah);

  if (!(surah.id > 0) || surah.nameArabic.length === 0 || surah.nameLatin.length === 0 || verses.length === 0) {
    throw new Error("Quran surah detail is empty.");
  }

  return { surah, verses };
}

function assertAyah(raw: unknown): QuranAyah {
  const payload = raw as any;
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Quran ayah response.");
  }
  const value: QuranAyah = {
    key: String(payload.key || "").trim(),
    surahId: Number(payload.surahId || 0),
    numberInSurah: Number(payload.numberInSurah || 0),
    arabic: String(payload.arabic || "").trim(),
    translationTr: String(payload.translationTr || "").trim()
  };
  if (
    value.key.length === 0 ||
    !(value.surahId > 0) ||
    !(value.numberInSurah > 0) ||
    value.arabic.length === 0
  ) {
    throw new Error("Invalid Quran ayah response.");
  }
  return value;
}

function assertAudioInfo(raw: unknown): QuranAudioInfo {
  const payload = raw as any;
  if (!payload || typeof payload !== "object") {
    return { available: false };
  }

  if (payload.available !== true) {
    return { available: false };
  }

  const url = String(payload?.audio?.url || "").trim();
  if (!/^https?:\/\//.test(url)) {
    return { available: false };
  }

  return {
    available: true,
    source: payload?.source === "fallback" ? "fallback" : "diyanet",
    audio: {
      surahId: Number(payload?.audio?.surahId || 0),
      reciter: String(payload?.audio?.reciter || "default"),
      url
    }
  };
}

export async function getQuranSurahs(localeTag?: string): Promise<SurahSummary[]> {
  const lang = toLocaleLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/surahs?lang=${encodeURIComponent(lang)}`;
  const key = `surahs:${lang}`;

  return requestWithRetry(key, async () => {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error((payload as any)?.error || `HTTP ${response.status}`);
    }
    return assertSurahSummaryRows(payload);
  });
}

export async function getQuranSurahDetail(surahId: number, localeTag?: string): Promise<{ surah: SurahMeta; verses: VerseRow[] }> {
  const lang = toLocaleLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/surahs/${surahId}?lang=${encodeURIComponent(lang)}&translation=tr`;
  const key = `surah:${surahId}:${lang}`;

  return requestWithRetry(key, async () => {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error((payload as any)?.error || `HTTP ${response.status}`);
    }
    return assertSurahDetail(payload);
  });
}

export async function getQuranAyah(verseKey: string, localeTag?: string): Promise<QuranAyah> {
  const lang = toLocaleLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/ayah/${encodeURIComponent(verseKey)}?lang=${encodeURIComponent(lang)}&translation=tr`;
  const key = `ayah:${verseKey}:${lang}`;

  return requestWithRetry(key, async () => {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error((payload as any)?.error || `HTTP ${response.status}`);
    }
    return assertAyah(payload);
  });
}

export async function getQuranSurahAudio(
  surahId: number,
  reciter?: string,
  localeTag?: string
): Promise<QuranAudioInfo> {
  const lang = toLocaleLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const reciterQuery = reciter && reciter.trim().length > 0 ? `&reciter=${encodeURIComponent(reciter)}` : "";
  const url = `${baseUrl}/quran/audio/${surahId}?lang=${encodeURIComponent(lang)}${reciterQuery}`;
  const key = `audio:${surahId}:${lang}:${reciter || "default"}`;

  return requestWithRetry(
    key,
    async () => {
      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error((payload as any)?.error || `HTTP ${response.status}`);
      }
      return assertAudioInfo(payload);
    },
    0
  ).catch(() => ({ available: false }));
}
