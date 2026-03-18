export interface SurahSummary {
  id: number;
  nameArabic: string;
  nameLatin: string;
  ayahCount: number;
}

export interface SurahMeta {
  id: number;
  nameArabic: string;
  nameLatin: string;
  ayahCount: number;
}

export interface VerseRow {
  key: string;
  numberInSurah: number;
  arabic: string;
  translation: string;
}

export interface QuranAyah {
  key: string;
  surahId: number;
  numberInSurah: number;
  arabic: string;
  translation: string;
}

export interface QuranAudioInfo {
  available: boolean;
  source?: "diyanet" | "fallback";
  audio?: {
    surahId: number;
    reciter: string;
    url: string;
  };
}
