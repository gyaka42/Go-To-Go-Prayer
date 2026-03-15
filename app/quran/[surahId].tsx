import { Audio, AVPlaybackStatus } from "expo-av";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easePressTransition, easeStateTransition, easeVisibleFade, easeVisibleLift } from "@/animation/ease";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { getQuranSurahAudio, getQuranSurahDetail } from "@/services/quran";
import { useAppTheme } from "@/theme/ThemeProvider";
import { QuranAudioInfo, SurahMeta, VerseRow } from "@/types/quran";

export default function QuranSurahDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surahId?: string; fromAyah?: string; toAyah?: string; titleOverride?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const surahId = useMemo(() => {
    const value = Array.isArray(params.surahId) ? params.surahId[0] : params.surahId;
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [params.surahId]);

  const fromAyah = useMemo(() => {
    const value = Array.isArray(params.fromAyah) ? params.fromAyah[0] : params.fromAyah;
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.fromAyah]);

  const toAyah = useMemo(() => {
    const value = Array.isArray(params.toAyah) ? params.toAyah[0] : params.toAyah;
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.toAyah]);

  const titleOverride = useMemo(() => {
    const value = Array.isArray(params.titleOverride) ? params.titleOverride[0] : params.titleOverride;
    return String(value || "").trim();
  }, [params.titleOverride]);

  const [surah, setSurah] = useState<SurahMeta | null>(null);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [audioInfo, setAudioInfo] = useState<QuranAudioInfo>({ available: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPressed, setAudioPressed] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      const filteredVerses =
        fromAyah && toAyah && fromAyah <= toAyah
          ? detail.verses.filter((row) => row.numberInSurah >= fromAyah && row.numberInSurah <= toAyah)
          : detail.verses;
      setSurah(detail.surah);
      setVerses(filteredVerses.length > 0 ? filteredVerses : detail.verses);
      setAudioInfo(audio);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [fromAyah, localeTag, surahId, t, toAyah]);

  const subtitleMeta = useMemo(() => {
    if (!surah) {
      return null;
    }
    if (fromAyah && toAyah) {
      return t("quran.ayah_range", { from: fromAyah, to: toAyah });
    }
    return t("quran.ayah_count", { count: surah.ayahCount });
  }, [fromAyah, surah, t, toAyah]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAudio = useCallback(async () => {
    if (!audioInfo.available || !audioInfo.audio?.url) {
      return;
    }
    const audioUrl = audioInfo.audio.url;
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

        const duration = status.durationMillis ?? 0;
        const position = status.positionMillis ?? 0;
        if (duration > 0 && position >= duration - 400) {
          await existing.setPositionAsync(0);
        }
        await existing.playAsync();
        setPlaying(true);
        return;
      }

      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: false }
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) {
            return;
          }
          if (status.didJustFinish) {
            setPlaying(false);
            return;
          }
          setPlaying(status.isPlaying);
        });
        await sound.playAsync();
        setPlaying(true);
      } catch {
        await cleanupSound();
      }
    });
  }, [audioInfo.audio, audioInfo.available, cleanupSound, queueAudioAction]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{titleOverride || surah?.nameLatin || t("quran.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        {surah && subtitleMeta ? (
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={easeEnterTransition}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              <Text style={fontsLoaded ? styles.quranArabicFont : null}>{surah.nameArabic}</Text>
              {" • "}
              {subtitleMeta}
            </Text>
          </EaseView>
        ) : null}

        {audioInfo.available ? (
          <EaseView
            initialAnimate={easeInitialLift}
            animate={{ opacity: 1, translateY: 0, scale: audioPressed ? 0.98 : 1 }}
            transition={audioPressed ? easePressTransition : easeEnterTransition}
          >
            <View style={styles.audioWrap}>
              <Pressable
                style={[
                  styles.audioButton,
                  playing ? { backgroundColor: "#D86076" } : { backgroundColor: "#2B8CEE" },
                  audioBusy ? { opacity: 0.65 } : null
                ]}
                onPress={() => void toggleAudio()}
                onPressIn={() => setAudioPressed(true)}
                onPressOut={() => setAudioPressed(false)}
                disabled={audioBusy}
              >
                <Ionicons name={playing ? "pause" : "play"} size={16} color="#FFFFFF" />
                <Text style={styles.audioButtonText}>
                  {playing ? t("quran.audio_pause") : t("quran.audio_play")}
                </Text>
              </Pressable>
              {audioInfo.source === "fallback" ? (
                <Text style={[styles.audioHintText, { color: colors.textSecondary }]}>
                  {t("quran.audio_fallback_hint")}
                </Text>
              ) : null}
            </View>
          </EaseView>
        ) : null}

        {loading ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={easeStateTransition}
            style={styles.centerWrap}
          >
            <ActivityIndicator color="#2B8CEE" size="large" />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.loading")}</Text>
          </EaseView>
        ) : error ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={easeStateTransition}
            style={styles.centerWrap}
          >
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.error_load")}</Text>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
            </Pressable>
          </EaseView>
        ) : (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={easeEnterTransition} style={styles.scrollWrap}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {verses.map((row) => (
                <View key={row.key} style={[styles.ayahCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.ayahIndex, { color: isLight ? "#1E78D9" : "#8DBEFF" }]}>{row.numberInSurah}</Text>
                  <Text
                    style={[
                      styles.ayahArabic,
                      { color: colors.textPrimary },
                      fontsLoaded ? styles.quranArabicFont : null
                    ]}
                  >
                    {row.arabic}
                  </Text>
                  <Text style={[styles.ayahTranslation, { color: colors.textSecondary }]}>
                    {row.translationTr || "—"}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </EaseView>
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
  scrollWrap: {
    flex: 1
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
