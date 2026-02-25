import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import * as Location from "expo-location";
import { AppBackground } from "@/components/AppBackground";
import { QiblaCompass } from "@/components/QiblaCompass";
import { useCompassConfidence } from "@/hooks/useCompassConfidence";
import { useI18n } from "@/i18n/I18nProvider";
import { getLocationName, resolveLocationForSettings } from "@/services/location";
import { getQiblaCompassImageUrl, getQiblaDirection } from "@/services/qibla";
import {
  buildQiblaCacheKey,
  getCachedQibla,
  getLatestCachedQibla,
  getSettings,
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
  const [bearing, setBearing] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locationName, setLocationName] = useState(t("common.current_location"));
  const [statusText, setStatusText] = useState(t("qibla.gps_connected"));
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

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
      const settings = await getSettings();
      const loc = await resolveLocationForSettings(settings);
      setCoords({ lat: loc.lat, lon: loc.lon });

      const resolvedName = await getLocationName(loc.lat, loc.lon);
      const displayName = resolvedName === "Unknown location" ? loc.label : resolvedName;
      setLocationName(displayName);
      setStatusText(settings.locationMode === "manual" ? t("qibla.manual_active") : t("qibla.gps_connected"));

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
          >
            <Ionicons name="refresh" size={20} color={isLight ? "#1E5FA3" : "#D9E8FA"} />
          </Pressable>
        </View>

        {bearing !== null ? (
          <Text style={[styles.qiblaText, { color: colors.accent }]}>
            {t("qibla.bearing", { deg: Math.round(bearing) })}
          </Text>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {loadState === "loading" ? (
            <View style={styles.loaderWrap}>
              <ActivityIndicator color="#2B8CEE" size="large" />
            </View>
          ) : null}

          {loadState === "error" ? (
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
              <Pressable style={styles.retryButton} onPress={() => void refresh()}>
                <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : null}

          {loadState === "ready" && bearing !== null ? (
            <View style={styles.contentWrap}>
              <QiblaCompass
                qiblaBearingDeg={bearing}
                deviceHeadingDeg={deviceHeading}
                mode={mode}
                lightMode={isLight}
              />

              <View
                style={[
                  styles.badge,
                  mode === "live"
                    ? isLight
                      ? { backgroundColor: "#DFF5E8" }
                      : styles.badgeLive
                    : isLight
                      ? { backgroundColor: "#FFF0DB" }
                      : styles.badgeFallback
                ]}
              >
                <Text style={[styles.badgeText, isLight ? { color: "#274462" } : null]}>
                  {mode === "live" ? t("qibla.live_on") : t("qibla.live_off")}
                </Text>
              </View>

              <View
                style={[
                  styles.confidenceCard,
                  isLight
                    ? { borderColor: "#C7DAEE", backgroundColor: "#EEF6FF" }
                    : null
                ]}
              >
                <View style={styles.confidenceHeader}>
                  <Text style={[styles.confidenceTitle, isLight ? { color: "#173A59" } : null]}>
                    {t("qibla.confidence.title")}
                  </Text>
                  <Text
                    style={[
                      styles.confidenceLabel,
                      confidence.status === "good"
                        ? isLight
                          ? { color: "#1D7A48" }
                          : { color: "#8CE2B1" }
                        : confidence.status === "bad"
                          ? isLight
                            ? { color: "#AD334D" }
                            : { color: "#FF9AB0" }
                          : isLight
                            ? { color: "#8A6A2B" }
                            : { color: "#FFD89A" }
                    ]}
                  >
                    {confidenceLabel}
                  </Text>
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
              </View>

              {isCached ? (
                <Text style={[styles.cachedText, isLight ? { color: "#5B718A" } : null]}>
                  {t("qibla.using_cache")}
                </Text>
              ) : null}
              {isCached && errorText ? (
                <Text style={[styles.cachedWarning, isLight ? { color: "#8A6A40" } : null]}>{errorText}</Text>
              ) : null}

              {mode === "fallback" && fallbackImageUrl ? (
                <View
                  style={[
                    styles.fallbackCard,
                    isLight
                      ? { borderColor: "#C7DBEE", backgroundColor: "#F3F9FF" }
                      : null
                  ]}
                >
                  <Text style={[styles.fallbackTitle, isLight ? { color: "#345677" } : null]}>
                    {t("qibla.fallback_image")}
                  </Text>
                  <Image source={{ uri: fallbackImageUrl }} style={styles.fallbackImage} resizeMode="contain" />
                </View>
              ) : null}

              <View
                style={[
                  styles.hintsCard,
                  isLight
                    ? { borderColor: "#C4D9ED", backgroundColor: "#EEF6FF" }
                    : null
                ]}
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
              </View>
            </View>
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
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  badgeLive: {
    backgroundColor: "#173F34"
  },
  badgeFallback: {
    backgroundColor: "#3A2F1C"
  },
  badgeText: {
    color: "#E8F2FF",
    fontSize: 13,
    fontWeight: "700"
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
  confidenceLabel: {
    fontSize: 13,
    fontWeight: "800"
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
  cachedText: {
    marginTop: 8,
    fontSize: 12,
    color: "#9FB3CC"
  },
  cachedWarning: {
    marginTop: 6,
    fontSize: 12,
    color: "#D9B88F",
    textAlign: "center"
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
