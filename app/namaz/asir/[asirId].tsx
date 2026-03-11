import { Audio, AVPlaybackStatus } from "expo-av";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { getAsirItem } from "@/services/namazContent";
import { getQuranAyah, getQuranSurahDetail } from "@/services/quran";
import { useAppTheme } from "@/theme/ThemeProvider";
import { SurahMeta, VerseRow } from "@/types/quran";

export default function NamazAsirDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ asirId?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const asirId = useMemo(() => {
    const value = Array.isArray(params.asirId) ? params.asirId[0] : params.asirId;
    return String(value || "").trim();
  }, [params.asirId]);

  const asir = useMemo(() => getAsirItem(asirId), [asirId]);

  const [surah, setSurah] = useState<SurahMeta | null>(null);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());

  const cleanupSound = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      return;
    }
    try {
      await sound.stopAsync();
    } catch {}
    try {
      await sound.unloadAsync();
    } catch {}
    soundRef.current = null;
    setPlaying(false);
  }, []);

  const queueAudioAction = useCallback(async (action: () => Promise<void>) => {
    audioQueueRef.current = audioQueueRef.current
      .then(async () => {
        setAudioBusy(true);
        try {
          await action();
        } finally {
          setAudioBusy(false);
        }
      })
      .catch(() => {
        setAudioBusy(false);
      });
    await audioQueueRef.current;
  }, []);

  useEffect(() => {
    return () => {
      void cleanupSound();
    };
  }, [cleanupSound]);

  const fetchAyahAudioUrl = useCallback(async (verseKey: string): Promise<string | null> => {
    try {
      const response = await fetch(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(verseKey)}/ar.alafasy`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      const url = String(payload?.data?.audio || "").trim();
      return /^https?:\/\//.test(url) ? url : null;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!asir) {
      setError(t("namaz.invalid_item"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const detail = await getQuranSurahDetail(asir.surahId, localeTag);
      const directRange = detail.verses.filter(
        (row) => row.numberInSurah >= asir.fromAyah && row.numberInSurah <= asir.toAyah
      );

      let filtered = directRange;
      if (filtered.length === 0) {
        const count = asir.toAyah - asir.fromAyah + 1;
        const fallbackAyahs = await Promise.all(
          Array.from({ length: count }).map((_, idx) =>
            getQuranAyah(`${asir.surahId}:${asir.fromAyah + idx}`, localeTag).catch(() => null)
          )
        );
        filtered = fallbackAyahs
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => ({
            key: item.key,
            numberInSurah: item.numberInSurah,
            arabic: item.arabic,
            translationTr: item.translationTr
          }))
          .sort((a, b) => a.numberInSurah - b.numberInSurah);
      }

      setSurah(detail.surah);
      setVerses(filtered);
      setCurrentAudioIndex(0);
      void cleanupSound();

      const keys = filtered.map((row) => row.key);
      const urls = (await Promise.all(keys.map((key) => fetchAyahAudioUrl(key)))).filter(
        (value): value is string => Boolean(value)
      );
      setAudioUrls(urls);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [asir, cleanupSound, fetchAyahAudioUrl, localeTag, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const playAudioIndex = useCallback(
    async (index: number) => {
      if (index < 0 || index >= audioUrls.length) {
        setPlaying(false);
        setCurrentAudioIndex(0);
        return;
      }

      setCurrentAudioIndex(index);
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrls[index] },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          void queueAudioAction(async () => {
            await cleanupSound();
            const next = index + 1;
            if (next < audioUrls.length) {
              await playAudioIndex(next);
            } else {
              setPlaying(false);
              setCurrentAudioIndex(0);
            }
          });
          return;
        }
        setPlaying(status.isPlaying);
      });
      setPlaying(true);
    },
    [audioUrls, cleanupSound, queueAudioAction]
  );

  const toggleAudio = useCallback(async () => {
    if (audioUrls.length === 0) {
      return;
    }
    await queueAudioAction(async () => {
      const existing = soundRef.current;
      if (existing) {
        const status = await existing.getStatusAsync();
        if (!status.isLoaded) {
          await cleanupSound();
          return;
        }
        if (status.isPlaying) {
          await existing.pauseAsync();
          setPlaying(false);
          return;
        }
        await existing.playAsync();
        setPlaying(true);
        return;
      }

      const startAt =
        currentAudioIndex >= 0 && currentAudioIndex < audioUrls.length
          ? currentAudioIndex
          : 0;
      await playAudioIndex(startAt);
    });
  }, [audioUrls, cleanupSound, currentAudioIndex, playAudioIndex, queueAudioAction]);

  const title = asir ? t(asir.titleKey) : t("namaz.invalid_item");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        {surah && asir ? (
          <View style={styles.subtitleRow}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {`\u200E${t("quran.ayah_range", { from: asir.fromAyah, to: asir.toAyah })}\u200E`}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{" • "}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }, fontsLoaded ? styles.quranArabicFont : null]}>
              {surah.nameArabic}
            </Text>
          </View>
        ) : null}

        {audioUrls.length > 0 ? (
          <View style={styles.audioWrap}>
            <Pressable
              style={[
                styles.audioButton,
                playing ? { backgroundColor: "#D86076" } : { backgroundColor: "#2B8CEE" },
                audioBusy ? { opacity: 0.65 } : null
              ]}
              onPress={() => void toggleAudio()}
              disabled={audioBusy}
            >
              <Ionicons name={playing ? "pause" : "play"} size={16} color="#FFFFFF" />
              <Text style={styles.audioButtonText}>
                {playing ? t("quran.audio_pause") : t("quran.audio_play")}
              </Text>
            </Pressable>
            <Text style={[styles.audioHintText, { color: colors.textSecondary }]}>
              {t("namaz.asir_audio_hint", {
                current: Math.min(currentAudioIndex + 1, Math.max(audioUrls.length, 1)),
                total: audioUrls.length
              })}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color="#2B8CEE" size="large" />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.loading")}</Text>
          </View>
        ) : error ? (
          <View style={styles.centerWrap}>
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.error_load")}</Text>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {verses.map((row) => (
              <View key={row.key} style={[styles.ayahCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.ayahIndex, { color: isLight ? "#1E78D9" : "#8DBEFF" }]}>{row.numberInSurah}</Text>
                <Text style={[styles.ayahArabic, { color: colors.textPrimary }, fontsLoaded ? styles.quranArabicFont : null]}>
                  {row.arabic}
                </Text>
                <Text style={[styles.ayahTranslation, { color: colors.textSecondary }]}>{row.translationTr || "—"}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#081321"
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 14
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPlaceholder: {
    width: 34,
    height: 34
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitleRow: {
    marginTop: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  subtitle: {
    fontSize: 14,
    color: "#8EA4BF",
    textAlign: "center"
  },
  audioButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 8
  },
  audioWrap: {
    marginBottom: 10,
    alignItems: "center",
    gap: 6
  },
  audioButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14
  },
  audioHintText: {
    fontSize: 12,
    color: "#8EA4BF"
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  helperText: {
    fontSize: 14,
    color: "#8EA4BF"
  },
  retryButton: {
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#2B8CEE"
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700"
  },
  scrollContent: {
    paddingBottom: 20,
    gap: 10
  },
  ayahCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  ayahIndex: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
    color: "#2B8CEE"
  },
  ayahArabic: {
    fontSize: 27,
    lineHeight: 42,
    textAlign: "right",
    writingDirection: "rtl",
    color: "#EDF4FF"
  },
  ayahTranslation: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#8EA4BF"
  },
  quranArabicFont: {
    fontFamily: "QuranArabic",
    fontWeight: "400"
  }
});
