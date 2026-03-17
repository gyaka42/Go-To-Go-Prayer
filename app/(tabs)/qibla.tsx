import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EaseView } from "react-native-ease";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Vibration
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  easeEnterTransition,
  easeInitialFade,
  easeInitialLift,
  easePressTransition,
  easeStateTransition,
  easeVisibleFade,
  easeVisibleLift
} from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import * as Location from "expo-location";
import { AppBackground } from "@/components/AppBackground";
import { QiblaCompass } from "@/components/QiblaCompass";
import { StatusChip } from "@/components/StatusChip";
import { useCompassConfidence } from "@/hooks/useCompassConfidence";
import { useI18n } from "@/i18n/I18nProvider";
import { getCurrentLocationDetails } from "@/services/location";
import { getQiblaCompassImageUrl, getQiblaDirection } from "@/services/qibla";
import {
  buildQiblaCacheKey,
  getCachedQibla,
  getLatestCachedQibla,
  saveCachedQibla
} from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "idle" | "loading" | "ready" | "error";

function normalizeHeading(value: number): number {
  const v = value % 360;
  return v < 0 ? v + 360 : v;
}

function shortestDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export default function QiblaScreen() {
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isFocused = useIsFocused();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const stateTransition = useMotionTransition(easeStateTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const [bearing, setBearing] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locationName, setLocationName] = useState(t("common.current_location"));
  const [statusText, setStatusText] = useState(t("qibla.gps_connected"));
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [refreshPressed, setRefreshPressed] = useState(false);
  const [retryPressed, setRetryPressed] = useState(false);

  const [deviceHeading, setDeviceHeading] = useState<number | undefined>(undefined);
  const [headingAvailable, setHeadingAvailable] = useState(false);
  const [headingStable, setHeadingStable] = useState(false);

  const previousHeadingRef = useRef<number | undefined>(undefined);
  const deltaHistoryRef = useRef<number[]>([]);
  const alignmentArmedRef = useRef(true);
  const lastVibrationAtRef = useRef(0);
  const secondPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoadState("loading");
    setErrorText(null);

    try {
      const loc = await getCurrentLocationDetails();
      setCoords({ lat: loc.lat, lon: loc.lon });
      const displayName = loc.label;
      setLocationName(displayName);
      setStatusText(t("qibla.gps_connected"));

      const cacheKey = buildQiblaCacheKey(loc.lat, loc.lon);

      try {
        const qibla = await getQiblaDirection(loc.lat, loc.lon);
        setBearing(qibla);
        setIsCached(false);

        await saveCachedQibla(cacheKey, {
          bearing: qibla,
          locationName: displayName,
          updatedAt: new Date().toISOString(),
          latRounded: Number(loc.lat.toFixed(2)),
          lonRounded: Number(loc.lon.toFixed(2))
        });
      } catch (apiError) {
        const cached = await getCachedQibla(cacheKey);
        if (!cached) {
          throw apiError;
        }

        setBearing(cached.bearing);
        setLocationName(cached.locationName || displayName);
        setIsCached(true);
      }

      setLoadState("ready");
    } catch (error) {
      const latest = await getLatestCachedQibla();
      if (latest) {
        setBearing(latest.bearing);
        setLocationName(latest.locationName || t("qibla.cached_location"));
        setStatusText(t("qibla.permission_needed"));
        setIsCached(true);
        setErrorText(t("qibla.cached_message"));
        setLoadState("ready");
      } else {
        setLoadState("error");
        setStatusText(t("qibla.permission_needed"));
        setErrorText(
          String(error).includes("permission")
            ? t("qibla.permission_error")
            : t("qibla.load_error", { error: String(error) })
        );
      }
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let removeWatch: (() => void) | undefined;

      void (async () => {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (!active) {
            return;
          }
          if (permission.status !== "granted") {
            setHeadingAvailable(false);
            setHeadingStable(false);
            return;
          }

          setHeadingAvailable(true);
          setHeadingStable(false);
          deltaHistoryRef.current = [];
          previousHeadingRef.current = undefined;

          const subscription = await Location.watchHeadingAsync((headingData) => {
            const raw =
              typeof headingData.trueHeading === "number" && headingData.trueHeading >= 0
                ? headingData.trueHeading
                : headingData.magHeading;

            const headingDeg = normalizeHeading(Number(raw));
            const accuracy = Number(headingData.accuracy);

            if (!Number.isFinite(headingDeg)) {
              setHeadingStable(false);
              return;
            }

            setDeviceHeading(headingDeg);

            const prev = previousHeadingRef.current;
            previousHeadingRef.current = headingDeg;
            if (typeof prev !== "number") {
              return;
            }

            const delta = shortestDiff(prev, headingDeg);
            const list = [...deltaHistoryRef.current, delta].slice(-10);
            deltaHistoryRef.current = list;

            if (list.length >= 6) {
              const avg = list.reduce((sum, v) => sum + v, 0) / list.length;
              const accuracyGood = Number.isFinite(accuracy) ? accuracy <= 25 : false;
              setHeadingStable(avg < 20 && accuracyGood);
            }
          });
          removeWatch = () => subscription.remove();
        } catch {
          setHeadingAvailable(false);
          setHeadingStable(false);
        }
      })();

      return () => {
        active = false;
        if (removeWatch) {
          removeWatch();
        }
      };
    }, [])
  );

  const mode = useMemo<"live" | "fallback">(() => {
    if (headingAvailable && headingStable && typeof deviceHeading === "number") {
      return "live";
    }
    return "fallback";
  }, [deviceHeading, headingAvailable, headingStable]);

  const confidenceHeading = typeof deviceHeading === "number" ? deviceHeading : null;
  const confidenceEnabled = isFocused && headingAvailable && confidenceHeading !== null;
  const confidence = useCompassConfidence({
    headingDeg: confidenceHeading,
    enabled: confidenceEnabled
  });

  const confidenceLabel = useMemo(() => {
    if (confidence.status === "good") {
      return t("qibla.confidence.goodLabel");
    }
    if (confidence.status === "bad") {
      return t("qibla.confidence.badLabel");
    }
    return t("qibla.confidence.mehLabel");
  }, [confidence.status, t]);

  const confidenceTone = useMemo(() => {
    if (confidence.status === "good") {
      return "success" as const;
    }
    if (confidence.status === "bad") {
      return "error" as const;
    }
    return "warning" as const;
  }, [confidence.status]);

  const fallbackImageUrl = useMemo(() => {
    if (!coords) {
      return null;
    }
    return getQiblaCompassImageUrl(coords.lat, coords.lon, 512);
  }, [coords]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (secondPulseTimerRef.current) {
          clearTimeout(secondPulseTimerRef.current);
          secondPulseTimerRef.current = null;
        }
      };
    }, [])
  );

  useEffect(() => {
    if (mode !== "live" || typeof bearing !== "number" || typeof deviceHeading !== "number") {
      alignmentArmedRef.current = true;
      return;
    }

    const diff = shortestDiff(deviceHeading, bearing);
    const now = Date.now();

    const withinTrigger = diff <= 2.5;
    const movedAway = diff >= 7;
    const cooldownPassed = now - lastVibrationAtRef.current > 2200;

    if (withinTrigger && alignmentArmedRef.current && cooldownPassed) {
      alignmentArmedRef.current = false;
      lastVibrationAtRef.current = now;
      Vibration.vibrate(45);
      secondPulseTimerRef.current = setTimeout(() => {
        Vibration.vibrate(45);
      }, 120);
      return;
    }

    if (movedAway) {
      alignmentArmedRef.current = true;
    }
  }, [bearing, deviceHeading, mode]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{t("qibla.title")}</Text>
              <Text style={[styles.locationText, { color: colors.textSecondary }]}>{locationName}</Text>
              <Text style={styles.statusText}>{statusText}</Text>
            </View>
            <Pressable
              style={[
                styles.refreshButton,
                isLight ? { backgroundColor: "#E4EFFB" } : null
              ]}
              onPress={() => void refresh()}
              onPressIn={() => setRefreshPressed(true)}
              onPressOut={() => setRefreshPressed(false)}
            >
              <EaseView animate={{ scale: refreshPressed ? 0.92 : 1 }} transition={pressTransition}>
                <Ionicons name="refresh" size={20} color={isLight ? "#1E5FA3" : "#D9E8FA"} />
              </EaseView>
            </Pressable>
          </View>
        </EaseView>

        {bearing !== null ? (
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
            <Text style={[styles.qiblaText, { color: colors.accent }]}>
              {t("qibla.bearing", { deg: Math.round(bearing) })}
            </Text>
          </EaseView>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {loadState === "loading" ? (
            <EaseView
              initialAnimate={easeInitialFade}
              animate={easeVisibleFade}
              transition={stateTransition}
              style={styles.loaderWrap}
            >
              <ActivityIndicator color="#2B8CEE" size="large" />
            </EaseView>
          ) : null}

          {loadState === "error" ? (
            <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
              <View
                style={[
                  styles.errorCard,
                  isLight
                    ? { borderColor: "#E8C7D0", backgroundColor: "#FFF1F4" }
                    : null
                ]}
              >
                <Text style={[styles.errorTitle, isLight ? { color: "#B13D57" } : null]}>
                  {t("qibla.permission_needed")}
                </Text>
                <Text style={[styles.errorText, isLight ? { color: "#8D4153" } : null]}>{errorText}</Text>
                <EaseView animate={{ scale: retryPressed ? 0.985 : 1 }} transition={pressTransition}>
                  <Pressable
                    style={styles.retryButton}
                    onPress={() => void refresh()}
                    onPressIn={() => setRetryPressed(true)}
                    onPressOut={() => setRetryPressed(false)}
                  >
                    <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
                  </Pressable>
                </EaseView>
              </View>
            </EaseView>
          ) : null}

          {loadState === "ready" && bearing !== null ? (
            <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
              <View style={styles.contentWrap}>
              <QiblaCompass
                qiblaBearingDeg={bearing}
                deviceHeadingDeg={deviceHeading}
                mode={mode}
                lightMode={isLight}
              />

              <View style={styles.badge}>
                <StatusChip
                  label={mode === "live" ? t("qibla.live_on") : t("qibla.live_off")}
                  tone={mode === "live" ? "success" : "warning"}
                />
              </View>

              <EaseView
                style={[
                  styles.confidenceCard,
                  isLight
                    ? { borderColor: "#C7DAEE", backgroundColor: "#EEF6FF" }
                    : null
                ]}
                initialAnimate={easeInitialFade}
                animate={easeVisibleFade}
                transition={stateTransition}
              >
                <View style={styles.confidenceHeader}>
                  <Text style={[styles.confidenceTitle, isLight ? { color: "#173A59" } : null]}>
                    {t("qibla.confidence.title")}
                  </Text>
                  <StatusChip label={confidenceLabel} tone={confidenceTone} />
                </View>
                <Text style={[styles.confidenceTip, isLight ? { color: "#355777" } : null]}>
                  {t(confidence.messageKey)}
                </Text>
                {__DEV__ ? (
                  <Text style={[styles.confidenceDebug, isLight ? { color: "#56708B" } : null]}>
                    Field:{" "}
                    {typeof confidence.fieldStrength === "number"
                      ? `${confidence.fieldStrength.toFixed(1)} uT`
                      : "--"}{" "}
                    • Std:{" "}
                    {typeof confidence.headingStdDev === "number"
                      ? `${confidence.headingStdDev.toFixed(1)}deg`
                      : "--"}
                  </Text>
                ) : null}
              </EaseView>

              {isCached ? (
                <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                  <View style={styles.cacheChipWrap}>
                    <StatusChip label={t("qibla.using_cache")} tone="info" />
                  </View>
                </EaseView>
              ) : null}
              {isCached && errorText ? (
                <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={stateTransition}>
                  <View style={styles.cacheChipWrap}>
                    <StatusChip label={errorText} tone="warning" />
                  </View>
                </EaseView>
              ) : null}

              {mode === "fallback" && fallbackImageUrl ? (
                <EaseView
                  style={[
                    styles.fallbackCard,
                    isLight
                      ? { borderColor: "#C7DBEE", backgroundColor: "#F3F9FF" }
                      : null
                  ]}
                  initialAnimate={easeInitialFade}
                  animate={easeVisibleFade}
                  transition={stateTransition}
                >
                  <Text style={[styles.fallbackTitle, isLight ? { color: "#345677" } : null]}>
                    {t("qibla.fallback_image")}
                  </Text>
                  <Image source={{ uri: fallbackImageUrl }} style={styles.fallbackImage} resizeMode="contain" />
                </EaseView>
              ) : null}

              <EaseView
                style={[
                  styles.hintsCard,
                  isLight
                    ? { borderColor: "#C4D9ED", backgroundColor: "#EEF6FF" }
                    : null
                ]}
                initialAnimate={easeInitialFade}
                animate={easeVisibleFade}
                transition={stateTransition}
              >
                <Text style={[styles.hintsTitle, isLight ? { color: "#1D3D5C" } : null]}>{t("qibla.tips")}</Text>
                <Text style={[styles.hintItem, isLight ? { color: "#345677" } : null]}>
                  {t("qibla.tip1")}
                </Text>
                <Text style={[styles.hintItem, isLight ? { color: "#345677" } : null]}>
                  {t("qibla.tip2")}
                </Text>
                <Text style={[styles.hintItem, isLight ? { color: "#345677" } : null]}>
                  {t("qibla.tip3")}
                </Text>
              </EaseView>
              </View>
            </EaseView>
          ) : null}
        </ScrollView>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  locationText: {
    marginTop: 4,
    maxWidth: 290,
    fontSize: 14,
    color: "#AFC4DD"
  },
  statusText: {
    marginTop: 3,
    fontSize: 13,
    color: "#7EE2AF"
  },
  refreshButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#18334A",
    alignItems: "center",
    justifyContent: "center"
  },
  qiblaText: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: "800",
    color: "#2B8CEE"
  },
  scrollContent: {
    paddingTop: 14,
    paddingBottom: 30
  },
  loaderWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40
  },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3E2B36",
    backgroundColor: "#251922",
    padding: 14
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFC6D2"
  },
  errorText: {
    marginTop: 8,
    color: "#E6AFBF",
    fontSize: 13,
    lineHeight: 19
  },
  retryButton: {
    marginTop: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center"
  },
  retryButtonText: {
    color: "#F2F8FF",
    fontWeight: "700"
  },
  contentWrap: {
    alignItems: "center"
  },
  badge: {
    marginTop: 14,
    minHeight: 34
  },
  confidenceCard: {
    marginTop: 12,
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#244460",
    backgroundColor: "#13283A",
    padding: 14
  },
  confidenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  confidenceTitle: {
    color: "#E8F2FF",
    fontWeight: "800",
    fontSize: 15
  },
  confidenceTip: {
    marginTop: 8,
    color: "#B8CCE2",
    fontSize: 13,
    lineHeight: 18
  },
  confidenceDebug: {
    marginTop: 8,
    color: "#8FA9C5",
    fontSize: 11
  },
  cacheChipWrap: {
    marginTop: 8,
    alignSelf: "stretch"
  },
  fallbackCard: {
    marginTop: 16,
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1E354B",
    backgroundColor: "#122434",
    padding: 12,
    alignItems: "center"
  },
  fallbackTitle: {
    color: "#CFE2F7",
    marginBottom: 8,
    fontWeight: "700"
  },
  fallbackImage: {
    width: 220,
    height: 220,
    borderRadius: 10
  },
  hintsCard: {
    marginTop: 16,
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#244460",
    backgroundColor: "#13283A",
    padding: 14,
    gap: 6
  },
  hintsTitle: {
    color: "#E8F2FF",
    fontWeight: "800",
    marginBottom: 4
  },
  hintItem: {
    color: "#B8CCE2",
    fontSize: 13,
    lineHeight: 18
  }
});
