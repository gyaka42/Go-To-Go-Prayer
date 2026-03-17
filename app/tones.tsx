import { Audio, AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  easeButtonStateTransition,
  easeEnterTransition,
  easeInitialFade,
  easeInitialLift,
  easePressTransition,
  easeStateTransition,
  easeVisibleFade,
  easeVisibleLift
} from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import { replanAll } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

const TONES: Array<"Adhan" | "Beep"> = ["Adhan", "Beep"];
type PreviewState = "idle" | "preparing" | "playing" | "error";
type InlineStatusTone = "success" | "loading" | "error" | "info" | "warning";

export default function ToneSelectionScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, prayerName } = useI18n();
  const isLight = resolvedTheme === "light";
  const params = useLocalSearchParams<{ prayer?: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingTone, setSavingTone] = useState<string | null>(null);
  const [pressedTone, setPressedTone] = useState<string | null>(null);
  const [pressedPreviewTone, setPressedPreviewTone] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewTone, setPreviewTone] = useState<"Adhan" | "Beep" | null>(null);
  const [inlineStatus, setInlineStatus] = useState<{ label: string; tone: InlineStatusTone } | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const buttonTransition = useMotionTransition(easeButtonStateTransition);
  const stateTransition = useMotionTransition(easeStateTransition);

  const prayer = useMemo<PrayerName | null>(() => {
    const value = Array.isArray(params.prayer) ? params.prayer[0] : params.prayer;
    return value && PRAYER_NAMES.includes(value as PrayerName) ? (value as PrayerName) : null;
  }, [params.prayer]);

  const clearInlineStatusTimeout = useCallback(() => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  }, []);

  const showInlineStatus = useCallback(
    (label: string, tone: InlineStatusTone, durationMs = 2200) => {
      clearInlineStatusTimeout();
      setInlineStatus({ label, tone });
      if (durationMs > 0) {
        statusTimeoutRef.current = setTimeout(() => {
          setInlineStatus(null);
          statusTimeoutRef.current = null;
        }, durationMs);
      }
    },
    [clearInlineStatusTimeout]
  );

  const load = useCallback(async () => {
    const saved = await getSettings();
    setSettings(saved);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        clearInlineStatusTimeout();
        if (soundRef.current) {
          const sound = soundRef.current;
          soundRef.current = null;
          setPreviewState("idle");
          setPreviewTone(null);
          void sound.stopAsync().catch(() => undefined);
          void sound.unloadAsync().catch(() => undefined);
        }
      };
    }, [load])
  );

  useEffect(() => {
    return () => {
      clearInlineStatusTimeout();
    };
  }, [clearInlineStatusTimeout]);

  const cleanupPreview = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      setPreviewState("idle");
      setPreviewTone(null);
      return;
    }

    soundRef.current = null;

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

    setPreviewState("idle");
    setPreviewTone(null);
  }, []);

  const onSelectTone = useCallback(
    async (tone: "Adhan" | "Beep") => {
      if (!settings || !prayer) {
        return;
      }

      if (settings.prayerNotifications[prayer].tone === tone) {
        router.back();
        return;
      }

      setSavingTone(tone);
      try {
        const updated: Settings = {
          ...settings,
          prayerNotifications: {
            ...settings.prayerNotifications,
            [prayer]: {
              ...settings.prayerNotifications[prayer],
              tone
            }
          }
        };

        await saveSettings(updated);
        setSettings(updated);

        try {
          const loc = await resolveLocationForSettings(updated);
          await replanAll({
            lat: loc.lat,
            lon: loc.lon,
            methodId: updated.methodId,
            settings: updated
          });
        } catch {
          // Keep tone save even if replanning fails now.
        }

        router.back();
      } finally {
        setSavingTone(null);
      }
    },
    [prayer, router, settings]
  );

  if (!prayer) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.container}>
          <AppBackground />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("alert.not_found")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentTone = settings?.prayerNotifications[prayer].tone ?? "Beep";

  const onPreviewTone = useCallback(
    async (tone: "Adhan" | "Beep") => {
      if (savingTone) {
        return;
      }

      if (tone === "Beep") {
        showInlineStatus(t("alert.inline_preview_unavailable"), "info");
        return;
      }

      try {
        if (previewTone === "Adhan" && previewState === "playing") {
          await cleanupPreview();
          showInlineStatus(t("alert.inline_preview_stopped"), "info", 1500);
          return;
        }

        clearInlineStatusTimeout();
        setInlineStatus({ label: t("alert.inline_preview_playing"), tone: "loading" });
        setPreviewState("preparing");
        setPreviewTone("Adhan");

        await cleanupPreview();
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false
        });

        const { sound } = await Audio.Sound.createAsync(require("../assets/sounds/adhan_short.wav"));
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) {
            return;
          }
          if (status.didJustFinish) {
            setPreviewState("idle");
            setPreviewTone(null);
            showInlineStatus(t("alert.inline_preview_stopped"), "info", 1500);
            const finishedSound = soundRef.current;
            soundRef.current = null;
            if (finishedSound) {
              void finishedSound.unloadAsync().catch(() => undefined);
            }
            return;
          }
          if (status.isPlaying) {
            setPreviewState("playing");
            setPreviewTone("Adhan");
          }
        });

        await sound.playAsync();
        setPreviewState("playing");
        setPreviewTone("Adhan");
      } catch {
        await cleanupPreview();
        setPreviewState("error");
        setPreviewTone("Adhan");
        showInlineStatus(t("alert.inline_preview_error"), "error", 2200);
      }
    },
    [cleanupPreview, clearInlineStatusTimeout, previewState, previewTone, savingTone, showInlineStatus, t]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("alert.alert_tone")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t("alert.configure_for", { prayer: prayerName(prayer) })}
          </Text>
        </EaseView>

        <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
          <StatusChip label={inlineStatus?.label ?? ""} tone={inlineStatus?.tone ?? "info"} visible={!!inlineStatus} />
        </EaseView>

        <EaseView
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          initialAnimate={easeInitialFade}
          animate={easeVisibleFade}
          transition={enterTransition}
        >
          {TONES.map((tone, index) => {
            const selected = currentTone === tone;
            const previewActive = previewTone === tone && previewState === "playing";
            const previewBusy = previewTone === tone && previewState === "preparing";
            const tonePressed = pressedTone === tone;
            const previewPressed = pressedPreviewTone === tone;
            return (
              <EaseView
                key={tone}
                animate={{ scale: tonePressed ? 0.992 : 1 }}
                transition={pressTransition}
              >
                <Pressable
                  style={[
                    styles.row,
                    index < TONES.length - 1 ? { borderBottomColor: colors.cardBorder, borderBottomWidth: 1 } : null,
                    selected
                      ? isLight
                        ? { backgroundColor: "#DDEEFF" }
                        : { backgroundColor: "#173A5E" }
                      : null
                  ]}
                  onPress={() => void onSelectTone(tone)}
                  onPressIn={() => setPressedTone(tone)}
                  onPressOut={() => setPressedTone(null)}
                  disabled={savingTone !== null}
                >
                  <View style={styles.rowTextWrap}>
                    <Text
                      style={[
                        styles.rowTitle,
                        { color: isLight ? "#1A2E45" : "#EAF2FF" },
                        selected ? { color: "#1E78D9" } : null
                      ]}
                    >
                      {tone === "Adhan" ? t("alert.tone_adhan") : t("alert.tone_beep")}
                    </Text>
                  </View>

                  <View style={styles.rowRight}>
                    <EaseView
                      animate={{
                        scale: previewPressed ? 0.95 : 1,
                        opacity: savingTone !== null && savingTone !== tone ? 0.55 : 1
                      }}
                      transition={buttonTransition}
                    >
                      <Pressable
                        onPress={() => void onPreviewTone(tone)}
                        onPressIn={() => setPressedPreviewTone(tone)}
                        onPressOut={() => setPressedPreviewTone(null)}
                        disabled={savingTone !== null || previewBusy}
                        style={[
                          styles.previewButton,
                          previewActive
                            ? isLight
                              ? { backgroundColor: "#DDEEFF" }
                              : { backgroundColor: "#204564" }
                            : isLight
                              ? { backgroundColor: "#EEF4FA" }
                              : { backgroundColor: "#14293D" }
                        ]}
                      >
                        {previewBusy ? (
                          <ActivityIndicator size="small" color="#2B8CEE" />
                        ) : (
                          <Ionicons
                            name={previewActive ? "stop-circle" : "play-circle"}
                            size={22}
                            color="#2B8CEE"
                          />
                        )}
                      </Pressable>
                    </EaseView>
                    {savingTone === tone ? <ActivityIndicator size="small" color="#2B8CEE" /> : null}
                    {selected ? <Ionicons name="checkmark-circle" size={22} color="#2B8CEE" /> : null}
                  </View>
                </Pressable>
              </EaseView>
            );
          })}
        </EaseView>
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
    color: "#8EA4BF"
  },
  card: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1D3349",
    overflow: "hidden"
  },
  row: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: 12
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  previewButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center"
  }
});
