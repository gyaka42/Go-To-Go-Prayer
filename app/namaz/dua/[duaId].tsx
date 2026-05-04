import { Audio, AVPlaybackStatus } from "expo-av";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialFade, easeInitialLift, easeStateTransition, easeVisibleFade } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { duaAudioSources, getDuaDetail } from "@/services/namazContent";
import { getRecentContentById, isContentFavorite, saveRecentContent, toggleContentFavorite } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

type AudioUiState = "ready" | "preparing" | "playing" | "paused" | "finished" | "error";

function resolveMeaning(content: NonNullable<ReturnType<typeof getDuaDetail>>, localeTag: string): string {
  const lang = String(localeTag || "tr").split("-")[0].toLowerCase();
  if (lang === "en") {
    return content.meaningEn;
  }
  if (lang === "nl") {
    return content.meaningNl;
  }
  return content.meaningTr;
}

export default function NamazDuaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ duaId?: string; resume?: string }>();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const duaId = useMemo(() => {
    const value = Array.isArray(params.duaId) ? params.duaId[0] : params.duaId;
    return String(value || "").trim();
  }, [params.duaId]);

  const shouldResume = useMemo(() => {
    const value = Array.isArray(params.resume) ? params.resume[0] : params.resume;
    return value === "1";
  }, [params.resume]);

  const detail = getDuaDetail(duaId);
  const title = detail ? t(detail.titleKey) : t("namaz.invalid_item");
  const audioSource = detail ? duaAudioSources[detail.id as keyof typeof duaAudioSources] : undefined;
  const [isFavorite, setIsFavorite] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPressed, setAudioPressed] = useState(false);
  const [audioState, setAudioState] = useState<AudioUiState>("ready");
  const scrollViewRef = useRef<ScrollView | null>(null);
  const lastRecentSaveRef = useRef(0);
  const didRestoreScrollRef = useRef(false);
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

  useEffect(() => {
    if (!detail) {
      return;
    }
    void getRecentContentById(`dua:${detail.id}`)
      .then((recent) =>
        saveRecentContent({
          id: `dua:${detail.id}`,
          kind: "namaz_dua",
          route: `/namaz/dua/${detail.id}`,
          title,
          titleKey: detail.titleKey,
          subtitle: t("namaz.section_duas"),
          scrollY: recent?.id === `dua:${detail.id}` ? recent.scrollY : undefined
        })
      )
      .catch(() => undefined);
  }, [detail, t, title]);

  useEffect(() => {
    didRestoreScrollRef.current = false;
    void cleanupSound();
  }, [duaId]);

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
    if (!shouldResume || !detail || didRestoreScrollRef.current) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void getRecentContentById(`dua:${detail.id}`).then((recent) => {
        if (!active || recent?.id !== `dua:${detail.id}` || !recent.scrollY || recent.scrollY <= 0) {
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
  }, [detail, shouldResume]);

  const saveScrollPosition = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!detail) {
        return;
      }
      const now = Date.now();
      if (now - lastRecentSaveRef.current < 700) {
        return;
      }
      lastRecentSaveRef.current = now;
      void saveRecentContent({
        id: `dua:${detail.id}`,
        kind: "namaz_dua",
        route: `/namaz/dua/${detail.id}`,
        title,
        titleKey: detail.titleKey,
        subtitle: t("namaz.section_duas"),
        scrollY: Math.max(0, event.nativeEvent.contentOffset.y)
      }).catch(() => undefined);
    },
    [detail, t, title]
  );

  useEffect(() => {
    if (!detail) {
      setIsFavorite(false);
      return;
    }
    let active = true;
    void isContentFavorite(`dua:${detail.id}`).then((value) => {
      if (active) {
        setIsFavorite(value);
      }
    });
    return () => {
      active = false;
    };
  }, [detail]);

  const toggleFavorite = useCallback(async () => {
    if (!detail) {
      return;
    }
    const next = await toggleContentFavorite({
      id: `dua:${detail.id}`,
      kind: "namaz_dua",
      route: `/namaz/dua/${detail.id}`,
      title,
      titleKey: detail.titleKey,
      subtitle: t("namaz.section_duas")
    });
    setIsFavorite(next);
  }, [detail, t, title]);

  const toggleAudio = useCallback(async () => {
    if (!audioSource) {
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
        const duration = status.durationMillis ?? 0;
        const position = status.positionMillis ?? 0;
        if (duration > 0 && position >= duration - 400) {
          await existing.setPositionAsync(0);
        }
        await existing.playAsync();
        setAudioState("playing");
        return;
      }

      try {
        setAudioState("preparing");
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false
        });
        const { sound } = await Audio.Sound.createAsync(audioSource, { shouldPlay: false });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) {
            setAudioState("error");
            return;
          }
          if (status.didJustFinish) {
            setAudioState("finished");
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
        await sound.playAsync();
        setAudioState("playing");
      } catch {
        await cleanupSound();
        setAudioState("error");
      }
    });
  }, [audioSource, cleanupSound, queueAudioAction]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <Pressable onPress={() => void toggleFavorite()} style={styles.headerButton} disabled={!detail}>
            <Ionicons
              name={isFavorite ? "star" : "star-outline"}
              size={22}
              color={isFavorite ? "#F5B942" : isLight ? "#617990" : "#8EA4BF"}
            />
          </Pressable>
        </View>

        {detail ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition} style={styles.scrollWrap}>
            <ScrollView
              ref={scrollViewRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              onScroll={saveScrollPosition}
              scrollEventThrottle={120}
            >
              {audioSource ? (
                <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                  <View style={styles.audioWrap}>
                    <Pressable
                      style={[
                        styles.audioButton,
                        audioState === "playing" ? { backgroundColor: "#D86076" } : { backgroundColor: "#2B8CEE" },
                        audioBusy ? { opacity: 0.65 } : null,
                        audioPressed ? { transform: [{ scale: 0.985 }] } : null
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
                  </View>
                </EaseView>
              ) : null}

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.arabic_text")}</Text>
                  <Text
                    style={[
                      styles.arabicText,
                      { color: colors.textPrimary },
                      fontsLoaded ? styles.quranArabicFont : null
                    ]}
                  >
                    {detail.arabic}
                  </Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.transliteration")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{detail.transliteration}</Text>
                </View>
              </EaseView>

              <EaseView initialAnimate={easeInitialLift} animate={{ opacity: 1, translateY: 0 }} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("namaz.meaning")}</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{resolveMeaning(detail, localeTag)}</Text>
                </View>
              </EaseView>

              {!audioSource ? (
                <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                  <StatusChip label={t("namaz.audio_not_available")} tone="info" />
                </EaseView>
              ) : null}
            </ScrollView>
          </EaseView>
        ) : (
          <EaseView
            initialAnimate={easeInitialFade}
            animate={easeVisibleFade}
            transition={stateTransition}
            style={styles.centerWrap}
          >
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("namaz.invalid_item")}</Text>
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
  scrollWrap: {
    flex: 1
  },
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10
  },
  audioWrap: {
    marginBottom: 2,
    alignItems: "center",
    gap: 6
  },
  audioButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
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
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#8EA4BF",
    marginBottom: 6
  },
  arabicText: {
    fontSize: 27,
    lineHeight: 43,
    textAlign: "right",
    writingDirection: "rtl",
    color: "#EDF4FF"
  },
  quranArabicFont: {
    fontFamily: "QuranArabic",
    fontWeight: "400"
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
    color: "#EDF4FF"
  },
  helperText: {
    fontSize: 13,
    color: "#8EA4BF"
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  }
});
