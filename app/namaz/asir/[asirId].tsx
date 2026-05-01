import { Audio, AVPlaybackStatus } from "expo-av";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easePressTransition, easeStateTransition, easeVisibleFade } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { logDiagnostic, quranErrorTranslationKey } from "@/services/errorDiagnostics";
import { getAsirItem } from "@/services/namazContent";
import { getQuranAyahWithSource, getQuranSurahDetailWithSource, QuranDataSource } from "@/services/quran";
import { useAppTheme } from "@/theme/ThemeProvider";
import { SurahMeta, VerseRow } from "@/types/quran";

type AudioUiState = "ready" | "preparing" | "playing" | "paused" | "finished" | "error";

export default function NamazAsirDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ asirId?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const pressTransition = useMotionTransition(easePressTransition);
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
  const [dataSource, setDataSource] = useState<QuranDataSource | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPressed, setAudioPressed] = useState(false);
  const [audioState, setAudioState] = useState<AudioUiState>("ready");

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
    setAudioState("ready");
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
      const detailResult = await getQuranSurahDetailWithSource(asir.surahId, localeTag);
      const detail = detailResult.data;
      let nextDataSource = detailResult.source;
      const directRange = detail.verses.filter(
        (row) => row.numberInSurah >= asir.fromAyah && row.numberInSurah <= asir.toAyah
      );

      let filtered = directRange;
      if (filtered.length === 0) {
        const count = asir.toAyah - asir.fromAyah + 1;
        const fallbackAyahs = await Promise.all(
          Array.from({ length: count }).map((_, idx) =>
            getQuranAyahWithSource(`${asir.surahId}:${asir.fromAyah + idx}`, localeTag).catch(() => null)
          )
        );
        if (fallbackAyahs.some((item) => item?.source === "cache")) {
          nextDataSource = "cache";
        }
        filtered = fallbackAyahs
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => ({
            key: item.data.key,
            numberInSurah: item.data.numberInSurah,
            arabic: item.data.arabic,
            translation: item.data.translation
          }))
          .sort((a, b) => a.numberInSurah - b.numberInSurah);
      }

      setSurah(detail.surah);
      setVerses(filtered);
      setDataSource(nextDataSource);
      setCurrentAudioIndex(0);
      void cleanupSound();
      setAudioState("ready");

      const keys = filtered.map((row) => row.key);
      const urls = (await Promise.all(keys.map((key) => fetchAyahAudioUrl(key)))).filter(
        (value): value is string => Boolean(value)
      );
      setAudioUrls(urls);
    } catch (err) {
      logDiagnostic("screen.namaz.asir.load", err, { asirId, localeTag });
      setError(t(quranErrorTranslationKey(err)));
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
        setAudioState("finished");
        setCurrentAudioIndex(0);
        return;
      }

      setCurrentAudioIndex(index);
      setAudioState("preparing");
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
        if (!status.isLoaded) {
          setAudioState("error");
          return;
        }
        if (status.didJustFinish) {
          void queueAudioAction(async () => {
            await cleanupSound();
            const next = index + 1;
            if (next < audioUrls.length) {
              await playAudioIndex(next);
            } else {
              setAudioState("finished");
              setCurrentAudioIndex(0);
            }
          });
          return;
        }
        if (status.isPlaying) {
          setAudioState("playing");
          return;
        }
        const duration = status.durationMillis ?? 0;
        const position = status.positionMillis ?? 0;
        if (duration > 0 && position >= duration - 400) {
          setAudioState("finished");
          return;
        }
        if (position > 0) {
          setAudioState("paused");
          return;
        }
        setAudioState("ready");
      });
      setAudioState("playing");
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
          setAudioState("error");
          return;
        }
        if (status.isPlaying) {
          await existing.pauseAsync();
          setAudioState("paused");
          return;
        }
        await existing.playAsync();
        setAudioState("playing");
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
  const audioStateLabel = useMemo(() => {
    if (audioBusy || audioState === "preparing") {
      return t("quran.audio_state_loading");
    }
    if (audioState === "playing") {
      return t("quran.audio_state_playing");
    }
    if (audioState === "paused") {
      return t("quran.audio_state_paused");
    }
    if (audioState === "finished") {
      return t("quran.audio_state_finished");
    }
    if (audioState === "error") {
      return t("quran.audio_state_error");
    }
    return t("quran.audio_state_ready");
  }, [audioBusy, audioState, t]);

  const audioStateTone = useMemo(() => {
    if (audioBusy || audioState === "preparing") {
      return "loading" as const;
    }
    if (audioState === "playing") {
      return "info" as const;
    }
    if (audioState === "paused") {
      return "warning" as const;
    }
    if (audioState === "finished") {
      return "success" as const;
    }
    if (audioState === "error") {
      return "error" as const;
    }
    return "success" as const;
  }, [audioBusy, audioState]);

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
          <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
            <View style={styles.subtitleRow}>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {`\u200E${t("quran.ayah_range", { from: asir.fromAyah, to: asir.toAyah })}\u200E`}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{" • "}</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }, fontsLoaded ? styles.quranArabicFont : null]}>
                {surah.nameArabic}
              </Text>
            </View>
          </EaseView>
        ) : null}

        <View style={styles.statusWrap}>
          <StatusChip
            visible={!loading && !error && Boolean(dataSource)}
            label={dataSource === "cache" ? t("quran.status_cache") : t("quran.status_network")}
            tone={dataSource === "cache" ? "warning" : "success"}
          />
        </View>

        {audioUrls.length > 0 ? (
          <EaseView
            initialAnimate={easeInitialLift}
            animate={{ opacity: 1, translateY: 0, scale: audioPressed ? 0.98 : 1 }}
            transition={audioPressed ? pressTransition : enterTransition}
          >
            <View style={styles.audioWrap}>
              <Pressable
                style={[
                  styles.audioButton,
                  audioState === "playing" ? { backgroundColor: "#D86076" } : { backgroundColor: "#2B8CEE" },
                  audioBusy ? { opacity: 0.65 } : null
                ]}
                onPress={() => void toggleAudio()}
                onPressIn={() => setAudioPressed(true)}
                onPressOut={() => setAudioPressed(false)}
                disabled={audioBusy}
              >
                <Ionicons name={audioState === "playing" ? "pause" : "play"} size={16} color="#FFFFFF" />
                <Text style={styles.audioButtonText}>
                  {audioState === "playing" ? t("quran.audio_pause") : t("quran.audio_play")}
                </Text>
              </Pressable>
              <StatusChip label={audioStateLabel} tone={audioStateTone} />
              <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                <Text style={[styles.audioHintText, { color: colors.textSecondary }]}>
                  {t("namaz.asir_audio_hint", {
                    current: Math.min(currentAudioIndex + 1, Math.max(audioUrls.length, 1)),
                    total: audioUrls.length
                  })}
                </Text>
              </EaseView>
            </View>
          </EaseView>
        ) : null}

        {loading ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={stateTransition}
            style={styles.centerWrap}
          >
            <ActivityIndicator color="#2B8CEE" size="large" />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("quran.loading")}</Text>
          </EaseView>
        ) : error ? (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={stateTransition}
            style={styles.centerWrap}
          >
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{error || t("quran.error_load")}</Text>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
            </Pressable>
          </EaseView>
        ) : (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition} style={styles.scrollWrap}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {verses.map((row) => (
                <View key={row.key} style={[styles.ayahCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.ayahIndex, { color: isLight ? "#1E78D9" : "#8DBEFF" }]}>{row.numberInSurah}</Text>
                  <Text style={[styles.ayahArabic, { color: colors.textPrimary }, fontsLoaded ? styles.quranArabicFont : null]}>
                    {row.arabic}
                  </Text>
                  <Text style={[styles.ayahTranslation, { color: colors.textSecondary }]}>{row.translation || "—"}</Text>
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
  statusWrap: {
    minHeight: 30,
    marginBottom: 8,
    alignItems: "center"
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
