import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { getTimingsByCoordinates } from "@/services/aladhan";
import { resolveLocationForSettings } from "@/services/location";
import { replanAll } from "@/services/notifications";
import {
  buildTimingsCacheKey,
  getCachedTimings,
  getLatestCachedTimings,
  getSettings,
  saveCachedTimings
} from "@/services/storage";
import { PRAYER_NAMES, PrayerName, Settings, Timings } from "@/types/prayer";
import { formatDateTime } from "@/utils/date";
import { formatCountdown, getDateKey, getNextPrayer } from "@/utils/time";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "idle" | "loading" | "ready" | "error";

function prayerIcon(prayer: PrayerName): keyof typeof MaterialCommunityIcons.glyphMap {
  if (prayer === "Fajr") {
    return "weather-night";
  }
  if (prayer === "Sunrise") {
    return "weather-sunset-up";
  }
  if (prayer === "Dhuhr") {
    return "weather-sunny";
  }
  if (prayer === "Asr") {
    return "weather-partly-cloudy";
  }
  if (prayer === "Maghrib") {
    return "weather-sunset-down";
  }
  return "weather-night-partly-cloudy";
}

export default function HomeScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const isCompact = width <= 390;
  const [timings, setTimings] = useState<Timings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countdown, setCountdown] = useState("00:00:00");
  const [nextPrayerName, setNextPrayerName] = useState<string>("-");
  const [source, setSource] = useState<"api" | "cache" | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Locatie ophalen...");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locationName, setLocationName] = useState("Current Location");
  const lastReplanSignatureRef = useRef<string>("");

  const updateCountdown = useCallback((activeTimings: Timings) => {
    const now = new Date();
    const next = getNextPrayer(activeTimings, now);

    if (!next) {
      setNextPrayerName("Fajr (morgen)");
      setCountdown("00:00:00");
      return;
    }

    setNextPrayerName(next.prayer);
    setCountdown(formatCountdown(next.time.getTime() - now.getTime()));
  }, []);

  const loadData = useCallback(async () => {
    setLoadState("loading");
    setStatusMessage("Gebedstijden ophalen...");

    const savedSettings = await getSettings();
    setSettings(savedSettings);

    const today = new Date();
    const dateKey = getDateKey(today);

    try {
      const location = await resolveLocationForSettings(savedSettings);
      setCoords(location);
      setLocationName(location.label);

      const cacheKey = buildTimingsCacheKey(dateKey, location.lat, location.lon, savedSettings.methodId);

      try {
        const fromApi = await getTimingsByCoordinates(today, location.lat, location.lon, savedSettings.methodId, 1);
        setTimings(fromApi);
        setSource("api");
        const nowIso = new Date().toISOString();
        setLastUpdated(nowIso);
        setStatusMessage("Live data geladen.");

        await saveCachedTimings(cacheKey, {
          timings: fromApi,
          lastUpdated: nowIso,
          source: "api",
          latRounded: Number(location.lat.toFixed(2)),
          lonRounded: Number(location.lon.toFixed(2)),
          methodId: savedSettings.methodId
        });

        const dayKey = getDateKey(today);
        const replanSignature = [
          dayKey,
          savedSettings.methodId,
          location.lat.toFixed(3),
          location.lon.toFixed(3),
          JSON.stringify(savedSettings.prayerNotifications)
        ].join("|");

        if (lastReplanSignatureRef.current !== replanSignature) {
          await replanAll({
            lat: location.lat,
            lon: location.lon,
            methodId: savedSettings.methodId,
            settings: savedSettings
          });
          lastReplanSignatureRef.current = replanSignature;
        }
      } catch (apiError) {
        const cached = await getCachedTimings(cacheKey);
        if (!cached) {
          throw apiError;
        }

        setTimings(cached.timings);
        setSource("cache");
        setLastUpdated(cached.lastUpdated);
        setStatusMessage("API niet bereikbaar, cache gebruikt.");
      }

      setLoadState("ready");
    } catch {
      const latestCache = await getLatestCachedTimings();
      if (latestCache) {
        setTimings(latestCache.timings);
        setSource("cache");
        setLastUpdated(latestCache.lastUpdated);
        setStatusMessage("Locatie niet beschikbaar, laatste cache getoond.");
        setLoadState("ready");
        return;
      }

      setStatusMessage("Geen locatie- of cached data beschikbaar. Geef locatietoestemming in Settings.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (!timings) {
      return;
    }

    updateCountdown(timings);

    const interval = setInterval(() => {
      updateCountdown(timings);

      const nowKey = getDateKey(new Date());
      if (nowKey !== timings.dateKey) {
        void loadData();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loadData, timings, updateCountdown]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const locationLabel = useMemo(() => {
    return locationName;
  }, [locationName]);

  const locationParts = useMemo(() => {
    const [cityRaw, countryRaw] = locationLabel.split(",");
    const city = (cityRaw ?? "Current Location").trim();
    const country = (countryRaw ?? "").trim();
    return { city, country };
  }, [locationLabel]);

  const todaysDateLabel = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short"
    });
  }, []);

  const nextPrayerTime = useMemo(() => {
    if (!timings || !nextPrayerName || !PRAYER_NAMES.includes(nextPrayerName as PrayerName)) {
      return "--:--";
    }

    return timings.times[nextPrayerName as PrayerName] ?? "--:--";
  }, [nextPrayerName, timings]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />

        <View style={styles.headerRow}>
          <View style={styles.headerLocationBlock}>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={18} color="#2B8CEE" />
              <View style={styles.locationTextWrap}>
                <Text style={[styles.locationCityText, { color: colors.textPrimary }]} numberOfLines={1}>
                  {locationParts.city}
                </Text>
                {locationParts.country ? (
                  <Text style={[styles.locationCountryText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {locationParts.country}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={[styles.dateText, { color: colors.textSecondary }]}>{todaysDateLabel}</Text>
          </View>
          <Pressable style={styles.refreshCircle} onPress={() => void onRefresh()}>
            <Ionicons name="refresh" size={24} color="#A7B7CC" />
          </Pressable>
        </View>

        <View style={[styles.heroCard, isCompact && styles.heroCardCompact]}>
          <Text style={styles.heroLabel}>NEXT PRAYER</Text>
          <View style={styles.heroMainRow}>
            <Text
              style={[styles.heroPrayer, isCompact && styles.heroPrayerCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              {nextPrayerName}
            </Text>
            <Text style={[styles.heroCountdown, isCompact && styles.heroCountdownCompact]}>in {countdown}</Text>
          </View>

          <View style={[styles.heroBottomRow, isCompact && styles.heroBottomRowCompact]}>
            <View style={styles.heroScheduleBlock}>
              <Text style={styles.heroScheduledLabel}>Scheduled Time</Text>
              <Text style={styles.heroTime}>{nextPrayerTime}</Text>
            </View>

            <Pressable
              style={[styles.reminderButton, isCompact && styles.reminderButtonCompact]}
              onPress={() => router.push("/(tabs)/alerts")}
            >
              <Ionicons name="notifications-outline" size={18} color="#1F7FE1" />
              <Text style={[styles.reminderButtonText, isCompact && styles.reminderButtonTextCompact]} numberOfLines={1}>
                Set Reminder
              </Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>TODAY'S SCHEDULE</Text>
        <Text style={[styles.metaLine, { color: colors.textSecondary }]}>
          Source: {source ?? "-"} | Updated: {lastUpdated ? formatDateTime(lastUpdated) : "-"}
        </Text>

        {loadState === "loading" && !timings ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#2B8CEE" />
          </View>
        ) : (
          <FlatList
            data={PRAYER_NAMES}
            keyExtractor={(item) => item}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2B8CEE" />}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isNext = item === nextPrayerName;
              const isEnabled = settings?.prayerNotifications[item].enabled ?? false;
              const rowTextColor = resolvedTheme === "light" ? "#21384F" : "#E3EBF7";
              const rowTimeColor = resolvedTheme === "light" ? "#1C334A" : "#C8D6EA";
              const rowSubtleIconBg = resolvedTheme === "light" ? "#E6EEF7" : "#1A3047";
              const rowIconColor = resolvedTheme === "light" ? "#5D7390" : "#7D8DA8";
              const rowNextBackground = resolvedTheme === "light" ? "#DDEEFF" : "#173A5E";
              const rowNextBorder = resolvedTheme === "light" ? "#69A9EA" : "#2B8CEE";

              return (
                <View
                  style={[
                    styles.row,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder },
                    isNext && styles.rowNext,
                    isNext && { backgroundColor: rowNextBackground, borderColor: rowNextBorder }
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <View
                      style={[
                        styles.iconWrap,
                        { backgroundColor: rowSubtleIconBg },
                        isNext && styles.iconWrapNext
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={prayerIcon(item)}
                        size={20}
                        color={isNext ? "#F1F6FD" : rowIconColor}
                      />
                    </View>

                    <View>
                      <Text style={[styles.rowPrayer, { color: rowTextColor }, isNext && styles.rowPrayerNext]}>{item}</Text>
                      {isNext ? <Text style={styles.comingUpText}>COMING UP</Text> : null}
                    </View>
                  </View>

                  <View style={styles.rowRight}>
                    <Text style={[styles.rowTime, { color: rowTimeColor }, isNext && styles.rowTimeNext]}>
                      {timings?.times[item] ?? "--:--"}
                    </Text>
                    <Ionicons
                      name={isEnabled ? "notifications" : "notifications-off-outline"}
                      size={20}
                      color={isEnabled ? "#2B8CEE" : "#586A84"}
                    />
                  </View>
                </View>
              );
            }}
            ListFooterComponent={<Text style={styles.statusText}>{statusMessage}</Text>}
          />
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerLocationBlock: {
    flex: 1,
    paddingRight: 10
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  locationTextWrap: {
    flexShrink: 1,
    flex: 1
  },
  locationCityText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ECF2FB"
  },
  locationCountryText: {
    marginTop: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "#9BB0CA"
  },
  dateText: {
    marginTop: 6,
    marginLeft: 26,
    fontSize: 16,
    color: "#8EA4BF"
  },
  refreshCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#18283C",
    alignItems: "center",
    justifyContent: "center"
  },
  heroCard: {
    marginTop: 18,
    borderRadius: 24,
    backgroundColor: "#2B8CEE",
    padding: 22,
    shadowColor: "#2B8CEE",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 }
  },
  heroCardCompact: {
    padding: 18,
    borderRadius: 20
  },
  heroLabel: {
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 2,
    color: "#CFE6FF"
  },
  heroMainRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    gap: 4
  },
  heroPrayer: {
    flexShrink: 1,
    fontSize: 40,
    fontWeight: "800",
    color: "#F4FAFF",
    paddingRight: 2
  },
  heroPrayerCompact: {
    fontSize: 36
  },
  heroCountdown: {
    marginBottom: 6,
    minWidth: 96,
    textAlign: "left",
    fontSize: 20,
    fontWeight: "500",
    color: "#D8ECFF",
    fontVariant: ["tabular-nums"]
  },
  heroCountdownCompact: {
    minWidth: 88,
    fontSize: 18
  },
  heroBottomRow: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14
  },
  heroBottomRowCompact: {
    gap: 10
  },
  heroScheduleBlock: {
    flex: 1,
    paddingRight: 8
  },
  heroScheduledLabel: {
    fontSize: 18,
    color: "#D8ECFF"
  },
  heroTime: {
    marginTop: 6,
    fontSize: 36,
    fontWeight: "800",
    color: "#F5FAFF"
  },
  reminderButton: {
    minWidth: 168,
    height: 60,
    borderRadius: 16,
    backgroundColor: "#F4F8FF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18
  },
  reminderButtonCompact: {
    minWidth: 0,
    width: "52%",
    height: 54,
    paddingHorizontal: 12
  },
  reminderButtonText: {
    fontSize: 18,
    color: "#1F7FE1",
    fontWeight: "700"
  },
  reminderButtonTextCompact: {
    fontSize: 16
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 10,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: "#8EA4BF"
  },
  metaLine: {
    fontSize: 14,
    color: "#6D829E",
    marginBottom: 12
  },
  listContent: {
    paddingBottom: 40,
    gap: 12
  },
  row: {
    minHeight: 88,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#162638",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#1A2D42"
  },
  rowNext: {
    backgroundColor: "#173A5E",
    borderColor: "#2B8CEE"
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1A3047",
    alignItems: "center",
    justifyContent: "center"
  },
  iconWrapNext: {
    backgroundColor: "#2B8CEE"
  },
  rowPrayer: {
    fontSize: 18,
    fontWeight: "700",
    color: "#E3EBF7"
  },
  rowPrayerNext: {
    color: "#44A4FF"
  },
  comingUpText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#44A4FF",
    letterSpacing: 0.8
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  rowTime: {
    fontSize: 17,
    fontWeight: "700",
    color: "#C8D6EA"
  },
  rowTimeNext: {
    color: "#2B8CEE"
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  statusText: {
    marginTop: 12,
    color: "#7F93AD",
    fontSize: 14,
    textAlign: "center"
  }
});
