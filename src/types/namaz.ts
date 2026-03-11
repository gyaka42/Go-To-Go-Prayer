export type NamazSectionKind = "surah" | "dua" | "asir";

export interface NamazSurahItem {
  id: string;
  kind: "surah";
  titleKey: string;
  surahId: number;
}

export interface NamazDuaItem {
  id: string;
  kind: "dua";
  titleKey: string;
}

export interface NamazAsirItem {
  id: string;
  kind: "asir";
  titleKey: string;
  surahId: number;
  fromAyah: number;
  toAyah: number;
}

export type NamazListItem = NamazSurahItem | NamazDuaItem | NamazAsirItem;

export interface NamazSection {
  id: string;
  titleKey: string;
  items: NamazListItem[];
}

export interface DuaDetailContent {
  id: string;
  titleKey: string;
  arabic: string;
  transliteration: string;
  meaningTr: string;
  meaningEn: string;
  meaningNl: string;
}
