import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from "react-native";
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

        await replanAll({
          lat: location.lat,
          lon: location.lon,
          methodId: savedSettings.methodId,
          settings: savedSettings
        });
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.backgroundGlowTop} />
        <View style={styles.backgroundGlowBottom} />

        <View style={styles.headerRow}>
          <View style={styles.headerLocationBlock}>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={18} color="#2B8CEE" />
              <View style={styles.locationTextWrap}>
                <Text style={styles.locationCityText} numberOfLines={1}>
                  {locationParts.city}
                </Text>
                {locationParts.country ? (
                  <Text style={styles.locationCountryText} numberOfLines={1}>
                    {locationParts.country}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.dateText}>{todaysDateLabel}</Text>
          </View>
          <Pressable style={styles.refreshCircle} onPress={() => void onRefresh()}>
            <Ionicons name="refresh" size={24} color="#A7B7CC" />
          </Pressable>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>NEXT PRAYER</Text>
          <View style={styles.heroMainRow}>
            <Text style={styles.heroPrayer}>{nextPrayerName}</Text>
            <Text style={styles.heroCountdown}>in {countdown}</Text>
          </View>

          <View style={styles.heroBottomRow}>
            <View>
              <Text style={styles.heroScheduledLabel}>Scheduled Time</Text>
              <Text style={styles.heroTime}>{nextPrayerTime}</Text>
            </View>

            <Pressable style={styles.reminderButton} onPress={() => router.push("/(tabs)/alerts")}>
              <Ionicons name="notifications-outline" size={18} color="#1F7FE1" />
              <Text style={styles.reminderButtonText}>Set Reminder</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionTitle}>TODAY'S SCHEDULE</Text>
        <Text style={styles.metaLine}>
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
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2B8CEE" />}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isNext = item === nextPrayerName;
              const isEnabled = settings?.prayerNotifications[item].enabled ?? false;

              return (
                <View style={[styles.row, isNext && styles.rowNext]}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconWrap, isNext && styles.iconWrapNext]}>
                      <MaterialCommunityIcons
                        name={prayerIcon(item)}
                        size={20}
                        color={isNext ? "#F1F6FD" : "#7D8DA8"}
                      />
                    </View>

                    <View>
                      <Text style={[styles.rowPrayer, isNext && styles.rowPrayerNext]}>{item}</Text>
                      {isNext ? <Text style={styles.comingUpText}>COMING UP</Text> : null}
                    </View>
                  </View>

                  <View style={styles.rowRight}>
                    <Text style={[styles.rowTime, isNext && styles.rowTimeNext]}>{timings?.times[item] ?? "--:--"}</Text>
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
  backgroundGlowTop: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "#2B8CEE22"
  },
  backgroundGlowBottom: {
    position: "absolute",
    bottom: -80,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "#2B8CEE1A"
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
    flexWrap: "wrap",
    gap: 8
  },
  heroPrayer: {
    fontSize: 44,
    fontWeight: "800",
    color: "#F4FAFF"
  },
  heroCountdown: {
    marginBottom: 6,
    fontSize: 24,
    fontWeight: "500",
    color: "#D8ECFF"
  },
  heroBottomRow: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14
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
    minWidth: 180,
    height: 60,
    borderRadius: 16,
    backgroundColor: "#F4F8FF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18
  },
  reminderButtonText: {
    fontSize: 18,
    color: "#1F7FE1",
    fontWeight: "700"
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
