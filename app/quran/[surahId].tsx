import { Audio, AVPlaybackStatus } from "expo-av";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easePressTransition, easeStateTransition, easeVisibleFade, easeVisibleLift } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { logDiagnostic, quranErrorTranslationKey } from "@/services/errorDiagnostics";
import { getQuranSurahAudio, getQuranSurahDetailWithSource, QuranDataSource } from "@/services/quran";
import { clearAudioProgress, getAudioProgress, getRecentContentById, isContentFavorite, saveAudioProgress, saveRecentContent, toggleContentFavorite } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { QuranAudioInfo, SurahMeta, VerseRow } from "@/types/quran";

type AudioUiState = "ready" | "preparing" | "playing" | "paused" | "finished" | "error";

export default function QuranSurahDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    surahId?: string;
    fromAyah?: string;
    toAyah?: string;
    titleOverride?: string;
    resume?: string;
  }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const pressTransition = useMotionTransition(easePressTransition);
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

  const shouldResume = useMemo(() => {
    const value = Array.isArray(params.resume) ? params.resume[0] : params.resume;
    return value === "1";
  }, [params.resume]);

  const [surah, setSurah] = useState<SurahMeta | null>(null);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [audioInfo, setAudioInfo] = useState<QuranAudioInfo>({ available: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<QuranDataSource | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPressed, setAudioPressed] = useState(false);
  const [audioState, setAudioState] = useState<AudioUiState>("ready");

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());
  const audioTokenRef = useRef(0);
  const audioProgressIdRef = useRef("");
  const resumeAudioPositionRef = useRef(0);
  const lastAudioProgressSaveRef = useRef(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const lastRecentSaveRef = useRef(0);
  const didRestoreScrollRef = useRef(false);

  const cleanupSound = useCallback(async () => {
    const sound = soundRef.current;
    const progressId = audioProgressIdRef.current;
    audioTokenRef.current += 1;
    if (!sound) {
      return;
    }
    sound.setOnPlaybackStatusUpdate(null);
    try {
      const status = await sound.getStatusAsync();
      if (progressId && status.isLoaded) {
        const position = status.positionMillis ?? 0;
        const duration = status.durationMillis ?? 0;
        if (duration > 0 && position >= duration - 1000) {
          resumeAudioPositionRef.current = 0;
          await clearAudioProgress(progressId);
        } else if (position > 1000) {
          resumeAudioPositionRef.current = position;
          await saveAudioProgress({ id: progressId, positionMillis: position, durationMillis: duration || undefined });
        }
      }
    } catch {
      // Ignore progress persistence errors during teardown.
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
    setAudioState("ready");
  }, []);

  const persistAudioProgress = useCallback((status: AVPlaybackStatus, force = false) => {
    if (!status.isLoaded) {
      return;
    }
    const progressId = audioProgressIdRef.current;
    if (!progressId) {
      return;
    }
    const duration = status.durationMillis ?? 0;
    const position = status.positionMillis ?? 0;
    if (duration > 0 && position >= duration - 1000) {
      resumeAudioPositionRef.current = 0;
      void clearAudioProgress(progressId).catch(() => undefined);
      return;
    }
    if (position <= 1000) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastAudioProgressSaveRef.current < 1500) {
      return;
    }
    lastAudioProgressSaveRef.current = now;
    resumeAudioPositionRef.current = position;
    void saveAudioProgress({
      id: progressId,
      positionMillis: position,
      durationMillis: duration || undefined
    }).catch(() => undefined);
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
        getQuranSurahDetailWithSource(surahId, localeTag),
        getQuranSurahAudio(surahId, undefined, localeTag)
      ]);
      const quranDetail = detail.data;
      const filteredVerses =
        fromAyah && toAyah && fromAyah <= toAyah
          ? quranDetail.verses.filter((row) => row.numberInSurah >= fromAyah && row.numberInSurah <= toAyah)
          : quranDetail.verses;
      setSurah(quranDetail.surah);
      setVerses(filteredVerses.length > 0 ? filteredVerses : quranDetail.verses);
      setDataSource(detail.source);
      audioProgressIdRef.current = `quran:${quranDetail.surah.id}`;
      resumeAudioPositionRef.current = 0;
      void getRecentContentById(`quran:${quranDetail.surah.id}`)
        .then((recent) =>
          saveRecentContent({
            id: `quran:${quranDetail.surah.id}`,
            kind: "quran_surah",
            route: `/quran/${quranDetail.surah.id}`,
            title: quranDetail.surah.nameLatin,
            subtitle: t("quran.ayah_count", { count: quranDetail.surah.ayahCount }),
            scrollY: recent?.id === `quran:${quranDetail.surah.id}` ? recent.scrollY : undefined,
            ayahNumber: recent?.id === `quran:${quranDetail.surah.id}` ? recent.ayahNumber : undefined
          })
        )
        .catch(() => undefined);
      setAudioInfo(audio);
      const progress = audio.available ? await getAudioProgress(`quran:${quranDetail.surah.id}`) : null;
      const position = progress?.positionMillis ?? 0;
      resumeAudioPositionRef.current = position > 1000 ? position : 0;
      setAudioState(position > 1000 ? "paused" : "ready");
    } catch (err) {
      logDiagnostic("screen.quran.detail.load", err, { surahId, localeTag, fromAyah, toAyah });
      setError(t(quranErrorTranslationKey(err)));
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    didRestoreScrollRef.current = false;
  }, [surahId]);

  useEffect(() => {
    if (!shouldResume || loading || error || !surah || verses.length === 0 || didRestoreScrollRef.current) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void getRecentContentById(`quran:${surah.id}`).then((recent) => {
        if (!active || recent?.id !== `quran:${surah.id}` || !recent.scrollY || recent.scrollY <= 0) {
          return;
        }
        didRestoreScrollRef.current = true;
        scrollViewRef.current?.scrollTo({ y: recent.scrollY, animated: false });
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [error, loading, shouldResume, surah, verses.length]);

  const saveScrollPosition = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!surah) {
        return;
      }
      const now = Date.now();
      if (now - lastRecentSaveRef.current < 700) {
        return;
      }
      lastRecentSaveRef.current = now;
      const scrollY = Math.max(0, event.nativeEvent.contentOffset.y);
      const estimatedIndex = Math.min(verses.length - 1, Math.max(0, Math.floor(scrollY / 230)));
      const ayahNumber = verses[estimatedIndex]?.numberInSurah;
      void saveRecentContent({
        id: `quran:${surah.id}`,
        kind: "quran_surah",
        route: `/quran/${surah.id}`,
        title: surah.nameLatin,
        subtitle: ayahNumber
          ? `${t("quran.ayah_count", { count: surah.ayahCount })} • ${t("quran.ayah_label")} ${ayahNumber}`
          : t("quran.ayah_count", { count: surah.ayahCount }),
        scrollY,
        ayahNumber
      }).catch(() => undefined);
    },
    [surah, t, verses]
  );

  useEffect(() => {
    if (!surah) {
      setIsFavorite(false);
      return;
    }
    let active = true;
    void isContentFavorite(`quran:${surah.id}`).then((value) => {
      if (active) {
        setIsFavorite(value);
      }
    });
    return () => {
      active = false;
    };
  }, [surah]);

  const toggleFavorite = useCallback(async () => {
    if (!surah) {
      return;
    }
    const next = await toggleContentFavorite({
      id: `quran:${surah.id}`,
      kind: "quran_surah",
      route: `/quran/${surah.id}`,
      title: surah.nameLatin,
      subtitle: t("quran.ayah_count", { count: surah.ayahCount })
    });
    setIsFavorite(next);
  }, [surah, t]);

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
          setAudioState("error");
          return;
        }

        if (status.isPlaying) {
          persistAudioProgress(status, true);
          await existing.pauseAsync();
          setAudioState("paused");
          return;
        }

        const duration = status.durationMillis ?? 0;
        const position = status.positionMillis ?? 0;
        if (duration > 0 && position >= duration - 400) {
          await clearAudioProgress(audioProgressIdRef.current);
          resumeAudioPositionRef.current = 0;
          await existing.setPositionAsync(0);
        }
        await existing.playAsync();
        setAudioState("playing");
        return;
      }

      try {
        const token = audioTokenRef.current + 1;
        audioTokenRef.current = token;
        setAudioState("preparing");
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: false }
        );
        if (token !== audioTokenRef.current) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (token !== audioTokenRef.current) {
            return;
          }
          if (!status.isLoaded) {
            setAudioState("error");
            return;
          }
          if (status.didJustFinish) {
            resumeAudioPositionRef.current = 0;
            void clearAudioProgress(audioProgressIdRef.current).catch(() => undefined);
            setAudioState("finished");
            return;
          }
          persistAudioProgress(status);
          if (status.isPlaying) {
            setAudioState("playing");
            return;
          }
          const duration = status.durationMillis ?? 0;
          const position = status.positionMillis ?? 0;
          if (duration > 0 && position >= duration - 400) {
            resumeAudioPositionRef.current = 0;
            void clearAudioProgress(audioProgressIdRef.current).catch(() => undefined);
            setAudioState("finished");
            return;
          }
          if (position > 0) {
            setAudioState("paused");
            return;
          }
          setAudioState("ready");
        });
        const resumePosition = resumeAudioPositionRef.current;
        if (resumePosition > 1000) {
          await sound.setPositionAsync(resumePosition);
        }
        await sound.playAsync();
        setAudioState("playing");
      } catch {
        await cleanupSound();
        setAudioState("error");
      }
    });
  }, [audioInfo.audio, audioInfo.available, cleanupSound, persistAudioProgress, queueAudioAction]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{titleOverride || surah?.nameLatin || t("quran.title")}</Text>
          <Pressable onPress={() => void toggleFavorite()} style={styles.headerButton} disabled={!surah}>
            <Ionicons
              name={isFavorite ? "star" : "star-outline"}
              size={22}
              color={isFavorite ? "#F5B942" : isLight ? "#617990" : "#8EA4BF"}
            />
          </Pressable>
        </View>

        {surah && subtitleMeta ? (
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              <Text style={fontsLoaded ? styles.quranArabicFont : null}>{surah.nameArabic}</Text>
              {" • "}
              {subtitleMeta}
            </Text>
          </EaseView>
        ) : null}

        <View style={styles.statusWrap}>
          <StatusChip
            visible={!loading && !error && Boolean(dataSource)}
            label={dataSource === "cache" ? t("quran.status_cache") : t("quran.status_network")}
            tone={dataSource === "cache" ? "warning" : "success"}
          />
        </View>

        {audioInfo.available ? (
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
              {audioInfo.source === "fallback" ? (
                <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                  <Text style={[styles.audioHintText, { color: colors.textSecondary }]}>
                    {t("quran.audio_fallback_hint")}
                  </Text>
                </EaseView>
              ) : null}
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
            <ScrollView
              ref={scrollViewRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              onScroll={saveScrollPosition}
              scrollEventThrottle={120}
            >
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
                    {row.translation || "—"}
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
