import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import { PrayerName } from "@/types/prayer";
import { AppLanguage, languageLocaleMap, prayerTranslations, translations } from "@/i18n/translations";

type TranslateParams = Record<string, string | number>;
export type LanguageMode = "system" | AppLanguage;
const LANGUAGE_MODE_KEY = "languageMode:v1";

type I18nContextValue = {
  mode: LanguageMode;
  language: AppLanguage;
  localeTag: string;
  t: (key: string, params?: TranslateParams) => string;
  prayerName: (prayer: PrayerName) => string;
  setMode: (mode: LanguageMode) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) {
    return template;
  }
  return Object.entries(params).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), String(value));
  }, template);
}

function resolveLanguageFromLocaleTag(localeTag: string): AppLanguage {
  const normalized = localeTag.toLowerCase().replace("_", "-");
  if (normalized.startsWith("nl")) {
    return "nl";
  }
  if (normalized.startsWith("tr")) {
    return "tr";
  }
  return "en";
}

function getNativeLocaleTag(): string | null {
  try {
    const platformLocales = (NativeModules as any)?.PlatformConstants?.locales;
    if (Array.isArray(platformLocales) && platformLocales.length > 0) {
      const first = platformLocales[0];
      if (typeof first === "string" && first.length > 0) {
        return first;
      }
      if (first && typeof first === "object") {
        const languageCode = String(first.languageCode || "").trim();
        const countryCode = String(first.countryCode || "").trim();
        if (languageCode && countryCode) {
          return `${languageCode}-${countryCode}`;
        }
        if (languageCode) {
          return languageCode;
        }
      }
    }

    if (Platform.OS === "ios") {
      const settings =
        (NativeModules as any)?.SettingsManager?.settings ??
        (NativeModules as any)?.SettingsManager?.getConstants?.()?.settings;
      const appleLocale = settings?.AppleLocale;
      const appleLanguages = settings?.AppleLanguages;
      if (typeof appleLocale === "string" && appleLocale.length > 0) {
        return appleLocale;
      }
      if (Array.isArray(appleLanguages) && typeof appleLanguages[0] === "string") {
        return appleLanguages[0];
      }
      if (typeof appleLanguages === "string" && appleLanguages.length > 0) {
        return appleLanguages;
      }
    }

    if (Platform.OS === "android") {
      const localeIdentifier =
        (NativeModules as any)?.I18nManager?.localeIdentifier ??
        (NativeModules as any)?.I18nManager?.getConstants?.()?.localeIdentifier;
      if (typeof localeIdentifier === "string" && localeIdentifier.length > 0) {
        return localeIdentifier;
      }
    }
  } catch {
    // Ignore and use Intl fallback.
  }

  return null;
}

export function getSystemLanguage(): AppLanguage {
  try {
    const localeTag = getNativeLocaleTag() || Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    return resolveLanguageFromLocaleTag(localeTag);
  } catch {
    return "en";
  }
}

export function translate(language: AppLanguage, key: string, params?: TranslateParams): string {
  const dict = translations[language] ?? translations.en;
  const fallback = translations.en[key] ?? key;
  const value = dict[key] ?? fallback;
  return interpolate(value, params);
}

export function translatePrayerName(language: AppLanguage, prayer: PrayerName): string {
  return prayerTranslations[language]?.[prayer] ?? prayerTranslations.en[prayer] ?? prayer;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LanguageMode>("system");
  const [systemLanguage, setSystemLanguage] = useState<AppLanguage>(() => getSystemLanguage());

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(LANGUAGE_MODE_KEY);
        if (raw === "system" || raw === "nl" || raw === "en" || raw === "tr") {
          setModeState(raw);
        }
      } catch {
        // Ignore and keep default mode.
      }
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      setSystemLanguage(getSystemLanguage());
    });
    return () => sub.remove();
  }, []);

  const language: AppLanguage = mode === "system" ? systemLanguage : mode;

  const localeTag = languageLocaleMap[language];

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      return translate(language, key, params);
    },
    [language]
  );

  const prayerName = useCallback(
    (prayer: PrayerName) => {
      return translatePrayerName(language, prayer);
    },
    [language]
  );

  const setMode = useCallback(async (next: LanguageMode) => {
    setModeState(next);
    await AsyncStorage.setItem(LANGUAGE_MODE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      language,
      localeTag,
      t,
      prayerName,
      setMode
    }),
    [mode, language, localeTag, t, prayerName, setMode]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return value;
}
