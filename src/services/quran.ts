import AsyncStorage from "@react-native-async-storage/async-storage";
import { QuranAudioInfo, QuranAyah, SurahMeta, SurahSummary, VerseRow } from "@/types/quran";
import { logDiagnostic } from "@/services/errorDiagnostics";
import { fetchJson } from "@/services/http";

const DEFAULT_DIYANET_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";
const UNSUPPORTED_QURAN_MARKS_REGEX = /[\u0610-\u061A\u06D6-\u06ED\u08D0-\u08FF\u{10EFD}-\u{10EFF}]/gu;
const QURAN_CACHE_PREFIX = "quran:cache:v1";

const inFlight = new Map<string, Promise<unknown>>();

type CacheEnvelope<T> = {
  savedAt: string;
  value: T;
};

export type QuranDataSource = "network" | "cache";

export type QuranResult<T> = {
  data: T;
  source: QuranDataSource;
};

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

function toTranslationLang(localeTag?: string): "tr" | "en" {
  const localeLang = toLocaleLang(localeTag);
  return localeLang === "en" ? "en" : "tr";
}

function sanitizeArabicForRendering(value: string): string {
  return value
    .replace(UNSUPPORTED_QURAN_MARKS_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeTranslationForComparison(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”„‟"''`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRepeatedTranslation(detail: { verses: VerseRow[] }): boolean {
  const values = detail.verses
    .map((row) => normalizeTranslationForComparison(row.translation))
    .filter((value) => value.length > 0);
  if (values.length < 2) {
    return false;
  }
  return new Set(values).size === 1;
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

function cacheKeyFor(parts: string[]): string {
  return `${QURAN_CACHE_PREFIX}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

async function readQuranCache<T>(key: string, validator: (value: unknown) => T): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<unknown>>;
    if (!parsed || typeof parsed !== "object" || !("value" in parsed)) {
      return null;
    }
    return validator(parsed.value);
  } catch {
    return null;
  }
}

async function saveQuranCache<T>(key: string, value: T): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = {
      savedAt: new Date().toISOString(),
      value
    };
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Cache is best-effort; Quran should still work if local storage is unavailable.
  }
}

function assertSurahSummaryRows(raw: unknown): SurahSummary[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).items)) {
    throw new Error("Invalid Quran surah list response.");
  }

  return (raw as any).items
    .map((item: any) => ({
      id: Number(item?.id),
      nameArabic: sanitizeArabicForRendering(String(item?.nameArabic || "").trim()),
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
    nameArabic: sanitizeArabicForRendering(String(surahRaw.nameArabic || "").trim()),
    nameLatin: String(surahRaw.nameLatin || "").trim(),
    ayahCount: Number(surahRaw.ayahCount || 0)
  };

  const verses: VerseRow[] = versesRaw
    .map((row: any) => ({
      key: String(row?.key || "").trim(),
      numberInSurah: Number(row?.numberInSurah || 0),
      arabic: sanitizeArabicForRendering(String(row?.arabic || "").trim()),
      translation: String(row?.translation || row?.translationTr || "").trim()
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
    arabic: sanitizeArabicForRendering(String(payload.arabic || "").trim()),
    translation: String(payload.translation || payload.translationTr || "").trim()
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

export async function getQuranSurahsWithSource(localeTag?: string): Promise<QuranResult<SurahSummary[]>> {
  const lang = toLocaleLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/surahs?lang=${encodeURIComponent(lang)}`;
  const key = `surahs:${lang}`;
  const cacheKey = cacheKeyFor(["surahs", lang]);

  return requestWithRetry(key, async () => {
    try {
      const payload = await fetchJson(url, { method: "GET", timeoutMs: 9000, retries: 1 });
      const rows = assertSurahSummaryRows(payload);
      await saveQuranCache(cacheKey, { items: rows });
      return { data: rows, source: "network" };
    } catch (error) {
      const cached = await readQuranCache(cacheKey, assertSurahSummaryRows);
      if (cached && cached.length > 0) {
        logDiagnostic("quran.surahs.cache_fallback", error, { lang, rows: cached.length });
        return { data: cached, source: "cache" };
      }
      logDiagnostic("quran.surahs.failed", error, { lang });
      throw error;
    }
  });
}

export async function getQuranSurahs(localeTag?: string): Promise<SurahSummary[]> {
  const result = await getQuranSurahsWithSource(localeTag);
  return result.data;
}

export async function getQuranSurahDetailWithSource(
  surahId: number,
  localeTag?: string
): Promise<QuranResult<{ surah: SurahMeta; verses: VerseRow[] }>> {
  const lang = toLocaleLang(localeTag);
  const translationLang = toTranslationLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/surahs/${surahId}?lang=${encodeURIComponent(lang)}&translation=${encodeURIComponent(translationLang)}`;
  const key = `surah:${surahId}:${lang}:${translationLang}`;
  const cacheKey = cacheKeyFor(["surah", String(surahId), lang, translationLang]);

  return requestWithRetry(key, async () => {
    try {
      const payload = await fetchJson(url, { method: "GET", timeoutMs: 10000, retries: 1 });
      const detail = assertSurahDetail(payload);

      if (translationLang === "en" || !hasRepeatedTranslation(detail)) {
        await saveQuranCache(cacheKey, detail);
        return { data: detail, source: "network" };
      }

      throw new Error("Quran translation response is repeated and could not be repaired by proxy.");
    } catch (error) {
      const cached = await readQuranCache(cacheKey, assertSurahDetail);
      if (cached) {
        logDiagnostic("quran.surah.cache_fallback", error, {
          surahId,
          lang,
          translationLang,
          verses: cached.verses.length
        });
        return { data: cached, source: "cache" };
      }
      logDiagnostic("quran.surah.failed", error, { surahId, lang, translationLang });
      throw error;
    }
  });
}

export async function getQuranSurahDetail(
  surahId: number,
  localeTag?: string
): Promise<{ surah: SurahMeta; verses: VerseRow[] }> {
  const result = await getQuranSurahDetailWithSource(surahId, localeTag);
  return result.data;
}

export async function getQuranAyahWithSource(verseKey: string, localeTag?: string): Promise<QuranResult<QuranAyah>> {
  const lang = toLocaleLang(localeTag);
  const translationLang = toTranslationLang(localeTag);
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/quran/ayah/${encodeURIComponent(verseKey)}?lang=${encodeURIComponent(lang)}&translation=${encodeURIComponent(translationLang)}`;
  const key = `ayah:${verseKey}:${lang}:${translationLang}`;
  const cacheKey = cacheKeyFor(["ayah", verseKey, lang, translationLang]);

  return requestWithRetry(key, async () => {
    try {
      const payload = await fetchJson(url, { method: "GET", timeoutMs: 9000, retries: 1 });
      const ayah = assertAyah(payload);
      await saveQuranCache(cacheKey, ayah);
      return { data: ayah, source: "network" };
    } catch (error) {
      const cached = await readQuranCache(cacheKey, assertAyah);
      if (cached) {
        logDiagnostic("quran.ayah.cache_fallback", error, { verseKey, lang, translationLang });
        return { data: cached, source: "cache" };
      }
      logDiagnostic("quran.ayah.failed", error, { verseKey, lang, translationLang });
      throw error;
    }
  });
}

export async function getQuranAyah(verseKey: string, localeTag?: string): Promise<QuranAyah> {
  const result = await getQuranAyahWithSource(verseKey, localeTag);
  return result.data;
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
      const payload = await fetchJson(url, { method: "GET", timeoutMs: 9000, retries: 0 });
      return assertAudioInfo(payload);
    },
    0
  ).catch(() => ({ available: false }));
}
