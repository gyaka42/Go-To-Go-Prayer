import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { getCurrentLocationDetails } from "@/services/location";
import { getMosques } from "@/services/mosqueService";
import {
  getCachedTimingsForDate,
  getDefaultMosqueId,
  getLatestCachedTimings,
  getMosquesFavorites,
  getMosquesSettings,
  setDefaultMosqueId,
  setMosquesFavorites
} from "@/services/storage";
import { Mosque, MosquesSettings } from "@/types/mosque";
import { Timings } from "@/types/prayer";
import { useAppTheme } from "@/theme/ThemeProvider";
import { getDateKey, getNextPrayer, getTomorrow, parsePrayerTimeForDate } from "@/utils/time";

type LoadState = "idle" | "loading" | "ready" | "error" | "permission_denied";
type ActiveFilter = "all" | "favorites";
type MosqueListItem = Mosque & {
  etaMinutes: number;
  isFeasible: boolean | null;
  timeLeftMinutes: number | null;
  isFavorite: boolean;
  isDefault: boolean;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  const normalized =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : raw;

  const int = Number.parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

const FEASIBILITY_BUFFER_MIN = 10;
const TRAVEL_SPEEDS_KMH: Record<MosquesSettings["travelMode"], number> = {
  walk: 5,
  drive: 30
};

export default function MosquesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { localeTag, t } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const isLight = resolvedTheme === "light";

  const [state, setState] = useState<LoadState>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"cache" | "network" | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [mosques, setMosques] = useState<Mosque[]>([]);
  const [mosquesSettings, setMosquesSettings] = useState<MosquesSettings>({ radiusKm: 5, travelMode: "walk" });
  const [timeLeftMinutes, setTimeLeftMinutes] = useState<number | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [defaultMosqueId, setDefaultMosqueIdState] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const isFocused = useIsFocused();
  const mosquesSettingsRef = useRef<MosquesSettings>({ radiusKm: 5, travelMode: "walk" });
  const mosquesCountRef = useRef(0);
  const loadDedupRef = useRef<{ at: number; radiusKm: number; travelMode: MosquesSettings["travelMode"] } | null>(null);

  useEffect(() => {
    mosquesSettingsRef.current = mosquesSettings;
  }, [mosquesSettings]);

  useEffect(() => {
    mosquesCountRef.current = mosques.length;
  }, [mosques.length]);

  useEffect(() => {
    setActiveFilter(params.filter === "favorites" ? "favorites" : "all");
  }, [params.filter]);

  const speedKmH = TRAVEL_SPEEDS_KMH[mosquesSettings.travelMode];
  const modeLabel = mosquesSettings.travelMode === "walk" ? t("mosques.mode_walk") : t("mosques.mode_drive");
  const listBottomPadding = insets.bottom + 96;
  const bgRgb = useMemo(() => hexToRgb(colors.background), [colors.background]);
  const topFadeLayers = useMemo(
    () =>
      [0.14, 0.1, 0.07, 0.05, 0.03, 0.02].map((alpha, index) => (
        <View
          key={`top-${index}`}
          pointerEvents="none"
          style={[
            styles.edgeFadeStrip,
            {
              top: index * 3,
              backgroundColor: `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`
            }
          ]}
        />
      )),
    [bgRgb.b, bgRgb.g, bgRgb.r]
  );
  const bottomFadeLayers = useMemo(
    () =>
      [0.03, 0.05, 0.07, 0.1, 0.12, 0.15].map((alpha, index) => (
        <View
          key={`bottom-${index}`}
          pointerEvents="none"
          style={[
            styles.edgeFadeStrip,
            {
              bottom: index * 3,
              backgroundColor: `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`
            }
          ]}
        />
      )),
    [bgRgb.b, bgRgb.g, bgRgb.r]
  );

  const formatDistance = useCallback(
    (distanceKm: number) => {
      if (distanceKm < 1) {
        return `${Math.max(1, Math.round(distanceKm * 1000))} m`;
      }
      return `${new Intl.NumberFormat(localeTag, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(distanceKm)} km`;
    },
    [localeTag]
  );

  const formatRelativeUpdated = useCallback((timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const minutes = Math.max(0, Math.floor(diffMs / 60000));
    if (minutes < 1) {
      return t("mosques.updated_just_now");
    }
    if (minutes < 60) {
      return t("mosques.updated_minutes_ago", { mins: minutes });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return t("mosques.updated_hours_ago", { hours });
    }
    const days = Math.floor(hours / 24);
    return t("mosques.updated_days_ago", { days });
  }, [t]);

  const resolveTimeLeftMinutes = useCallback(async (): Promise<number | null> => {
    const now = new Date();
    const todayKey = getDateKey(now);
    const latest = await getLatestCachedTimings();
    if (!latest) {
      return null;
    }

    const provider = latest.provider ?? "aladhan";
    const methodId = latest.methodId;
    let todayTimings: Timings | null = null;

    if (latest.timings.dateKey === todayKey) {
      todayTimings = latest.timings;
    } else {
      const cachedToday = await getCachedTimingsForDate(todayKey, provider, methodId);
      todayTimings = cachedToday?.timings ?? null;
    }

    if (todayTimings) {
      const next = getNextPrayer(todayTimings, now);
      if (next) {
        return Math.max(0, Math.ceil((next.time.getTime() - now.getTime()) / 60000));
      }
    }

    const tomorrow = getTomorrow(now);
    const tomorrowKey = getDateKey(tomorrow);
    const cachedTomorrow = await getCachedTimingsForDate(tomorrowKey, provider, methodId);
    if (!cachedTomorrow?.timings?.times?.Fajr) {
      return null;
    }

    const tomorrowFajr = parsePrayerTimeForDate(tomorrow, cachedTomorrow.timings.times.Fajr);
    return Math.max(0, Math.ceil((tomorrowFajr.getTime() - now.getTime()) / 60000));
  }, []);

  const loadMosques = useCallback(
    async (forceRefresh: boolean, overrideSettings?: MosquesSettings) => {
      const activeSettings = overrideSettings ?? mosquesSettingsRef.current;
      const nowMs = Date.now();
      const dedup = loadDedupRef.current;

      if (
        !forceRefresh &&
        dedup &&
        nowMs - dedup.at < 1200 &&
        dedup.radiusKm === activeSettings.radiusKm &&
        dedup.travelMode === activeSettings.travelMode
      ) {
        return;
      }

      loadDedupRef.current = {
        at: nowMs,
        radiusKm: activeSettings.radiusKm,
        travelMode: activeSettings.travelMode
      };

      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setState("loading");
      }
      setError(null);
      setWarningMessage(null);

      try {
        const location = await getCurrentLocationDetails();
        setLocationLabel((prev) => (prev === location.label ? prev : location.label));

        const result = await getMosques({
          lat: location.lat,
          lon: location.lon,
          radiusKm: activeSettings.radiusKm,
          forceRefresh
        });
        const nextTimeLeft = await resolveTimeLeftMinutes();

        setMosques(result.mosques);
        setSource(result.source);
        setTimeLeftMinutes(nextTimeLeft);
        setState("ready");

        const preview = result.mosques[0];
        console.log(
          `[mosques] travelMode=${activeSettings.travelMode} speedKmH=${TRAVEL_SPEEDS_KMH[activeSettings.travelMode]} timeLeftMinutes=${nextTimeLeft ?? "n/a"}`
        );
        if (preview) {
          const eta = Math.max(1, Math.ceil((preview.distanceKm / TRAVEL_SPEEDS_KMH[activeSettings.travelMode]) * 60));
          const feasible = nextTimeLeft === null ? "n/a" : eta + FEASIBILITY_BUFFER_MIN <= nextTimeLeft;
          console.log(`[mosques] first name="${preview.name}" eta=${eta} feasible=${feasible}`);
        }
      } catch (err) {
        const message = String(err);
        if (message.toLowerCase().includes("permission denied")) {
          setState("permission_denied");
          return;
        }

        const hasExistingData = mosquesCountRef.current > 0;
        if (hasExistingData) {
          setWarningMessage(t("mosques.refresh_failed_cache"));
          setState("ready");
        } else {
          setState("error");
          setError(message);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [resolveTimeLeftMinutes, t]
  );

  useEffect(() => {
    void loadMosques(false);
  }, [loadMosques]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let active = true;
    void (async () => {
      const [latestSettings, savedFavorites, savedDefault] = await Promise.all([
        getMosquesSettings(),
        getMosquesFavorites(),
        getDefaultMosqueId()
      ]);
      if (!active) {
        return;
      }

      const current = mosquesSettingsRef.current;
      const settingsChanged = current.radiusKm !== latestSettings.radiusKm || current.travelMode !== latestSettings.travelMode;

      if (settingsChanged) {
        setMosquesSettings(latestSettings);
        void loadMosques(false, latestSettings);
      }

      setFavorites((prev) => {
        if (prev.length === savedFavorites.length && prev.every((id, idx) => id === savedFavorites[idx])) {
          return prev;
        }
        return savedFavorites;
      });

      setDefaultMosqueIdState((prev) => (prev === savedDefault ? prev : savedDefault));
    })();

    return () => {
      active = false;
    };
  }, [isFocused, loadMosques]);

  const toggleFavorite = useCallback(async (id: string) => {
    setFavorites((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
      void setMosquesFavorites(next);

      if (exists && defaultMosqueId === id) {
        setDefaultMosqueIdState(null);
        void setDefaultMosqueId(null);
      }
      return next;
    });
  }, [defaultMosqueId]);

  const toggleDefaultMosque = useCallback(async (id: string) => {
    setDefaultMosqueIdState((prev) => {
      const nextDefault = prev === id ? null : id;
      void setDefaultMosqueId(nextDefault);
      if (nextDefault) {
        setFavorites((favoritePrev) => {
          if (favoritePrev.includes(nextDefault)) {
            return favoritePrev;
          }
          const nextFavorites = [...favoritePrev, nextDefault];
          void setMosquesFavorites(nextFavorites);
          return nextFavorites;
        });
      }
      return nextDefault;
    });
  }, []);

  const openInMaps = useCallback(async (mosque: Mosque) => {
    const label = encodeURIComponent(mosque.name);
    const googleUrl = `comgooglemaps://?center=${mosque.lat},${mosque.lon}&q=${label}`;
    const appleUrl = `https://maps.apple.com/?ll=${mosque.lat},${mosque.lon}&q=${label}`;

    try {
      await Linking.openURL(googleUrl);
      return;
    } catch {
      // Ignore and fallback to Apple Maps.
    }

    try {
      await Linking.openURL(appleUrl);
      return;
    } catch {
      Alert.alert(t("mosques.maps_alert_title"), t("mosques.maps_alert_body"));
    }
  }, [t]);

  const openRoute = useCallback(
    async (mosque: Mosque) => {
      const dirflg = mosquesSettings.travelMode === "walk" ? "w" : "d";
      const googleMode = mosquesSettings.travelMode === "walk" ? "walking" : "driving";
      const googleUrl = `comgooglemaps://?daddr=${mosque.lat},${mosque.lon}&directionsmode=${googleMode}`;
      const appleUrl = `https://maps.apple.com/?daddr=${mosque.lat},${mosque.lon}&dirflg=${dirflg}`;

      try {
        await Linking.openURL(googleUrl);
        return;
      } catch {
        // Ignore and fallback to Apple Maps.
      }

      try {
        await Linking.openURL(appleUrl);
        return;
      } catch {
        Alert.alert(t("mosques.route_alert_title"), t("mosques.route_alert_body"));
      }
    },
    [mosquesSettings.travelMode, t]
  );

  const mosqueItems = useMemo(() => {
    const favoritesSet = new Set(favorites);
    const query = searchQuery.trim().toLowerCase();
    const items: MosqueListItem[] = mosques.map((mosque) => {
      const etaMinutes = Math.max(1, Math.ceil((mosque.distanceKm / speedKmH) * 60));
      const isFeasible = timeLeftMinutes === null ? null : etaMinutes + FEASIBILITY_BUFFER_MIN <= timeLeftMinutes;
      const isDefault = defaultMosqueId === mosque.id;
      const isFavorite = isDefault || favoritesSet.has(mosque.id);
      return {
        ...mosque,
        etaMinutes,
        isFeasible,
        timeLeftMinutes,
        isFavorite,
        isDefault
      };
    });

    const filteredByName = query.length > 0 ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    const filtered = activeFilter === "favorites" ? filteredByName.filter((item) => item.isFavorite) : filteredByName;

    filtered.sort((a, b) => {
      if (timeLeftMinutes !== null) {
        const aRank = a.isFeasible ? 0 : 1;
        const bRank = b.isFeasible ? 0 : 1;
        if (aRank !== bRank) {
          return aRank - bRank;
        }
      }
      if (a.etaMinutes !== b.etaMinutes) {
        return a.etaMinutes - b.etaMinutes;
      }
      return a.distanceKm - b.distanceKm;
    });

    return filtered;
  }, [activeFilter, defaultMosqueId, favorites, mosques, searchQuery, speedKmH, timeLeftMinutes]);

  const listEmptyText = useMemo(() => {
    if (mosques.length === 0) {
      return t("mosques.empty_no_mosques", { radius: mosquesSettings.radiusKm });
    }
    if (activeFilter === "favorites") {
      return t("mosques.empty_no_favorites");
    }
    if (searchQuery.trim().length > 0) {
      return t("mosques.empty_no_search");
    }
    return t("mosques.empty_default");
  }, [activeFilter, mosques.length, mosquesSettings.radiusKm, searchQuery, t]);

  const renderCard = useCallback(
    ({ item }: { item: MosqueListItem }) => (
      <View style={[styles.mosqueCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.mosqueName, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          <Pressable onPress={() => void toggleFavorite(item.id)} style={styles.favoriteButton} hitSlop={8}>
            <Ionicons
              name={item.isFavorite ? "star" : "star-outline"}
              size={20}
              color={item.isFavorite ? "#F5C445" : isLight ? "#637D98" : "#9CB3CD"}
            />
          </Pressable>
        </View>

        {item.isDefault ? (
          <View style={styles.defaultBadge}>
            <Ionicons name="pin" size={12} color="#F2F8FF" />
            <Text style={styles.defaultBadgeText}>{t("mosques.default_badge")}</Text>
          </View>
        ) : null}

        <Text style={[styles.mosqueDistance, { color: colors.accent }]}>{formatDistance(item.distanceKm)}</Text>
        <Text style={[styles.mosqueMeta, { color: colors.textSecondary }]}>
          {t("mosques.last_updated_prefix")}: {formatRelativeUpdated(item.lastUpdated)}
        </Text>
        <View style={styles.mosqueEtaRow}>
          <Text style={[styles.mosqueEta, { color: colors.textSecondary }]}>{t("mosques.eta_prefix", { mins: item.etaMinutes })}</Text>
          {item.isFeasible === null ? null : (
            <>
              <Text style={[styles.mosqueEta, { color: colors.textSecondary }]}> • </Text>
              {item.isFeasible ? (
                <View style={styles.feasibleRow}>
                  <Text style={[styles.mosqueEta, { color: colors.textSecondary }]}>{t("mosques.feasible_yes_plain")}</Text>
                  <Image source={require("../assets/images/check.png")} style={styles.feasibleCheckIcon} resizeMode="contain" />
                </View>
              ) : (
                <Text style={[styles.mosqueEta, { color: colors.textSecondary }]}>{t("mosques.feasible_no")}</Text>
              )}
            </>
          )}
        </View>

        <View style={styles.cardActionRow}>
          <Pressable style={[styles.cardActionButton, { borderColor: colors.cardBorder }]} onPress={() => void openRoute(item)}>
            <Ionicons name="navigate-outline" size={16} color={isLight ? "#4A6A8E" : "#A8BDD7"} />
            <Text style={[styles.cardActionText, { color: colors.textPrimary }]}>{t("mosques.route_action")}</Text>
          </Pressable>
          <Pressable style={[styles.cardActionButton, { borderColor: colors.cardBorder }]} onPress={() => void openInMaps(item)}>
            <Ionicons name="map-outline" size={16} color={isLight ? "#4A6A8E" : "#A8BDD7"} />
            <Text style={[styles.cardActionText, { color: colors.textPrimary }]}>{t("mosques.open_maps_action")}</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.defaultButton, { borderColor: colors.cardBorder }]} onPress={() => void toggleDefaultMosque(item.id)}>
          <Text style={[styles.defaultButtonText, { color: colors.textPrimary }]}>
            {item.isDefault ? t("mosques.default_remove") : t("mosques.default_make")}
          </Text>
        </Pressable>
      </View>
    ),
    [colors.card, colors.cardBorder, colors.textPrimary, colors.textSecondary, colors.accent, formatDistance, formatRelativeUpdated, isLight, openInMaps, openRoute, t, toggleDefaultMosque, toggleFavorite]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={[styles.backButton, isLight ? styles.backButtonLight : null]}>
            <Ionicons name="chevron-back" size={20} color={isLight ? "#5B7490" : "#B7C7DD"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("mosques.title")}</Text>
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("mosques.subtitle")}</Text>
        {source ? (
          <Text style={[styles.statusLine, { color: colors.textSecondary }]}>
            {t("mosques.status_line", {
              radius: mosquesSettings.radiusKm,
              mode: modeLabel,
              source: source === "cache" ? t("mosques.source_cache") : t("mosques.source_network")
            })}
            {locationLabel ? ` • ${t("mosques.location_prefix")}: ${locationLabel}` : ""}
          </Text>
        ) : null}
        {warningMessage ? <Text style={[styles.warningLine, { color: colors.textSecondary }]}>{warningMessage}</Text> : null}
        {timeLeftMinutes === null ? (
          <Text style={[styles.timingsHint, { color: colors.textSecondary }]}>{t("mosques.timings_unavailable")}</Text>
        ) : null}

        {state === "loading" ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color="#2B8CEE" />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>{t("mosques.loading")}</Text>
          </View>
        ) : null}

        {state === "permission_denied" ? (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>{t("mosques.permission_title")}</Text>
            <Text style={[styles.infoBody, { color: colors.textSecondary }]}>{t("mosques.permission_body")}</Text>
            <View style={styles.infoActions}>
              <Pressable style={[styles.infoActionButton, { backgroundColor: colors.accent }]} onPress={() => void Linking.openSettings()}>
                <Text style={styles.infoActionText}>{t("mosques.permission_action")}</Text>
              </Pressable>
              <Pressable style={[styles.infoActionGhost, { borderColor: colors.cardBorder }]} onPress={() => void loadMosques(false)}>
                <Text style={[styles.infoActionGhostText, { color: colors.textPrimary }]}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {state === "error" ? (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>{t("mosques.fetch_failed_title")}</Text>
            <Text style={[styles.infoBody, { color: colors.textSecondary }]}>{error || t("mosques.fetch_failed_body")}</Text>
            <Pressable style={[styles.infoActionButton, { backgroundColor: colors.accent }]} onPress={() => void loadMosques(false)}>
              <Text style={styles.infoActionText}>{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        {state === "ready" ? (
          <>
            <View style={styles.stickyControls}>
              <View style={[styles.searchWrap, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
                <Ionicons name="search" size={18} color={isLight ? "#5E7894" : "#8AA1BC"} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t("mosques.search_placeholder")}
                  placeholderTextColor={isLight ? "#7A8EA5" : "#7D93AE"}
                  style={[styles.searchInput, { color: colors.textPrimary }]}
                />
                {searchQuery.length > 0 ? (
                  <Pressable onPress={() => setSearchQuery("")}>
                    <Ionicons name="close-circle" size={20} color={isLight ? "#768CA5" : "#8EA5C1"} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.filterRow}>
                <Pressable
                  style={[
                    styles.filterChip,
                    { borderColor: colors.cardBorder, backgroundColor: colors.card },
                    activeFilter === "all" ? { backgroundColor: colors.accent, borderColor: colors.accent } : null
                  ]}
                  onPress={() => setActiveFilter("all")}
                >
                  <Text style={[styles.filterText, { color: activeFilter === "all" ? "#F2F8FF" : colors.textPrimary }]}>
                    {t("mosques.filter_all")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.filterChip,
                    { borderColor: colors.cardBorder, backgroundColor: colors.card },
                    activeFilter === "favorites" ? { backgroundColor: colors.accent, borderColor: colors.accent } : null
                  ]}
                  onPress={() => setActiveFilter("favorites")}
                >
                  <Text style={[styles.filterText, { color: activeFilter === "favorites" ? "#F2F8FF" : colors.textPrimary }]}>
                    {t("mosques.filter_favorites")}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.listViewport}>
              <FlatList
                data={mosqueItems}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadMosques(true)} tintColor="#2B8CEE" />}
                ListEmptyComponent={
                  <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.infoBody, { color: colors.textSecondary }]}>{listEmptyText}</Text>
                  </View>
                }
                renderItem={renderCard}
              />
              <View pointerEvents="none" style={styles.edgeFadeTop}>
                {topFadeLayers}
              </View>
              <View pointerEvents="none" style={styles.edgeFadeBottom}>
                {bottomFadeLayers}
              </View>
            </View>
          </>
        ) : null}
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
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(26, 45, 66, 0.9)"
  },
  backButtonLight: {
    backgroundColor: "#E7F0FA",
    borderWidth: 1,
    borderColor: "#C2D5E9"
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14
  },
  statusLine: {
    marginTop: 8,
    fontSize: 12
  },
  warningLine: {
    marginTop: 6,
    fontSize: 12
  },
  timingsHint: {
    marginTop: 6,
    fontSize: 12
  },
  centerWrap: {
    marginTop: 24,
    alignItems: "center",
    gap: 10
  },
  helperText: {
    fontSize: 14
  },
  stickyControls: {
    marginTop: 12,
    marginBottom: 6
  },
  listViewport: {
    flex: 1,
    position: "relative"
  },
  searchWrap: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10
  },
  filterRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  filterText: {
    fontSize: 13,
    fontWeight: "700"
  },
  infoCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  infoBody: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20
  },
  infoActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10
  },
  infoActionButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  infoActionText: {
    color: "#F2F8FF",
    fontWeight: "700"
  },
  infoActionGhost: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  infoActionGhostText: {
    fontWeight: "700"
  },
  listContent: {
    gap: 12
  },
  edgeFadeTop: {
    position: "absolute",
    top: 0,
    left: -4,
    right: -4,
    height: 18
  },
  edgeFadeBottom: {
    position: "absolute",
    bottom: 0,
    left: -4,
    right: -4,
    height: 22
  },
  edgeFadeStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3
  },
  mosqueCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  favoriteButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center"
  },
  mosqueName: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700"
  },
  defaultBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    minHeight: 24,
    borderRadius: 999,
    backgroundColor: "#2B8CEE"
  },
  defaultBadgeText: {
    color: "#F2F8FF",
    fontSize: 12,
    fontWeight: "700"
  },
  mosqueDistance: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: "700"
  },
  mosqueMeta: {
    marginTop: 6,
    fontSize: 12
  },
  mosqueEta: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "600"
  },
  mosqueEtaRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap"
  },
  feasibleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  feasibleCheckIcon: {
    width: 16,
    height: 16
  },
  cardActionRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8
  },
  cardActionButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  cardActionText: {
    fontSize: 14,
    fontWeight: "600"
  },
  defaultButton: {
    marginTop: 10,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  defaultButtonText: {
    fontSize: 13,
    fontWeight: "700"
  }
});
