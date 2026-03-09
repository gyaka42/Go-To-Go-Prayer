import { Audio, AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { getQuranSurahAudio, getQuranSurahDetail } from "@/services/quran";
import { useAppTheme } from "@/theme/ThemeProvider";
import { QuranAudioInfo, SurahMeta, VerseRow } from "@/types/quran";

export default function QuranSurahDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surahId?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";

  const surahId = useMemo(() => {
    const value = Array.isArray(params.surahId) ? params.surahId[0] : params.surahId;
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [params.surahId]);

  const [surah, setSurah] = useState<SurahMeta | null>(null);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [audioInfo, setAudioInfo] = useState<QuranAudioInfo>({ available: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);

  const cleanupSound = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      return;
    }
    try {
      await sound.stopAsync();
    } catch {
      // Ignore cleanup errors.
    }
    try {
      await sound.unloadAsync();
    } catch {
      // Ignore cleanup errors.
    }
    soundRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      void cleanupSound();
    };
  }, [cleanupSound]);

  const load = useCallback(async () => {
    if (!(surahId > 0)) {
      setError(t("quran.invalid_surah"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [detail, audio] = await Promise.all([
        getQuranSurahDetail(surahId, localeTag),
        getQuranSurahAudio(surahId, undefined, localeTag)
      ]);
      setSurah(detail.surah);
      setVerses(detail.verses);
      setAudioInfo(audio);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [localeTag, surahId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAudio = useCallback(async () => {
    if (!audioInfo.available || !audioInfo.audio?.url) {
      return;
    }
    if (playing) {
      await cleanupSound();
      return;
    }

    await cleanupSound();
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioInfo.audio.url },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) {
          return;
        }
        if (status.didJustFinish) {
          void cleanupSound();
        }
      });
    } catch {
      await cleanupSound();
    }
  }, [audioInfo.audio?.url, audioInfo.available, cleanupSound, playing]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{surah?.nameLatin || t("quran.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        {surah ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {surah.nameArabic} • {t("quran.ayah_count", { count: surah.ayahCount })}
          </Text>
        ) : null}

        {audioInfo.available ? (
          <Pressable
            style={[styles.audioButton, playing ? { backgroundColor: "#D86076" } : { backgroundColor: "#2B8CEE" }]}
            onPress={() => void toggleAudio()}
          >
            <Ionicons name={playing ? "pause" : "play"} size={16} color="#FFFFFF" />
            <Text style={styles.audioButtonText}>
              {playing ? t("quran.audio_stop") : t("quran.audio_play")}
            </Text>
          </Pressable>
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
                <Text style={[styles.ayahArabic, { color: colors.textPrimary }]}>{row.arabic}</Text>
                <Text style={[styles.ayahTranslation, { color: colors.textSecondary }]}>
                  {row.translationTr || "—"}
                </Text>
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
  subtitle: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 14,
    color: "#8EA4BF",
    textAlign: "center"
  },
  audioButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 8
  },
  audioButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14
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
  }
});
