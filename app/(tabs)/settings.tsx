import { Ionicons, MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  geocodeCityQuery,
  getCurrentLocationDetails,
  resolveLocationForSettings,
  searchCitySuggestions
} from "@/services/location";
import { AppBackground } from "@/components/AppBackground";
import { LanguageMode, useI18n } from "@/i18n/I18nProvider";
import { replanAll } from "@/services/notifications";
import { getTodayTomorrowTimings } from "@/services/timingsCache";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { ThemeMode } from "@/theme/theme";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

const MINUTES_OPTIONS: Array<0 | 5 | 10 | 15 | 30> = [0, 5, 10, 15, 30];

function nextMinutes(current: 0 | 5 | 10 | 15 | 30): 0 | 5 | 10 | 15 | 30 {
  const index = MINUTES_OPTIONS.indexOf(current);
  const nextIndex = (index + 1) % MINUTES_OPTIONS.length;
  return MINUTES_OPTIONS[nextIndex];
}

const PRESET_CITY_QUERIES = [
  "Makkah, Saudi Arabia",
  "Madinah, Saudi Arabia",
  "Riyadh, Saudi Arabia",
  "Jeddah, Saudi Arabia",
  "Dubai, United Arab Emirates",
  "Kuwait City, Kuwait",
  "Doha, Qatar",
  "Amman, Jordan",
  "Cairo, Egypt",
  "Istanbul, Turkiye",
  "Islamabad, Pakistan",
  "Karachi, Pakistan",
  "Lahore, Pakistan",
  "Dhaka, Bangladesh",
  "Mumbai, India",
  "Jakarta, Indonesia",
  "Kuala Lumpur, Malaysia",
  "Casablanca, Morocco",
  "London, United Kingdom",
  "Paris, France",
  "Amsterdam, Netherlands"
] as const;

function isMissingProxyError(error: unknown): boolean {
  return String(error).toLowerCase().includes("diyanet proxy missing");
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode: themeMode, setMode: setThemeMode, resolvedTheme } = useAppTheme();
  const { t, prayerName, mode: languageMode, setMode: setLanguageMode, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [locationStatus, setLocationStatus] = useState(t("common.current_location"));
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [citySearchLoading, setCitySearchLoading] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<Array<{ label: string; lat: number; lon: number; query: string }>>([]);
  const [showAppInfo, setShowAppInfo] = useState(false);
  const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "Onbekend";
  const appBuild = Application.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber ?? "-";

  const loadSettings = useCallback(async () => {
    const saved = await getSettings();
    setSettings(saved);
  }, []);

  const loadLocationLabel = useCallback(async () => {
    try {
      const saved = await getSettings();
      const loc = await resolveLocationForSettings(saved);
      setLocationStatus(loc.label);
    } catch {
      // Keep existing label if location is not available.
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
      void loadLocationLabel();
    }, [loadLocationLabel, loadSettings])
  );

  useEffect(() => {
    const query = cityQuery.trim();
    if (query.length < 2) {
      setCitySuggestions([]);
      setCitySearchLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        setCitySearchLoading(true);
        try {
          const suggestions = await searchCitySuggestions(query);
          setCitySuggestions(suggestions);
        } catch {
          setCitySuggestions([]);
        } finally {
          setCitySearchLoading(false);
        }
      })();
    }, 220);

    return () => clearTimeout(timer);
  }, [cityQuery, localeTag]);

  const applyManualLocation = useCallback(
    async (location: { lat: number; lon: number; label: string; query?: string }) => {
      if (!settings) {
        return;
      }

      setSaving(true);
      try {
        const updated: Settings = {
          ...settings,
          locationMode: "manual",
          manualLocation: {
            query: location.query ?? location.label,
            label: location.label,
            lat: location.lat,
            lon: location.lon
          }
        };
        setSettings(updated);
        setLocationStatus(location.label);
        await saveSettings(updated);
        setLocationModalVisible(false);
        setCityQuery("");
        setCitySuggestions([]);

        await replanAll({
          lat: location.lat,
          lon: location.lon,
          methodId: updated.methodId,
          settings: updated
        }).catch((error) => {
          if (!isMissingProxyError(error)) {
            throw error;
          }
        });

        Alert.alert(
          t("settings.manual_set_title"),
          t("settings.manual_set_body", { label: location.label })
        );
      } catch (error) {
        Alert.alert(t("settings.manual_city_title"), String(error));
      } finally {
        setSaving(false);
      }
    },
    [settings, t]
  );

  const togglePrayer = useCallback((prayer: PrayerName, enabled: boolean) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        prayerNotifications: {
          ...prev.prayerNotifications,
          [prayer]: {
            ...prev.prayerNotifications[prayer],
            enabled
          }
        }
      };
    });
  }, []);

  const cyclePrayerMinutes = useCallback((prayer: PrayerName) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }

      const current = prev.prayerNotifications[prayer].minutesBefore;
      return {
        ...prev,
        prayerNotifications: {
          ...prev.prayerNotifications,
          [prayer]: {
            ...prev.prayerNotifications[prayer],
            minutesBefore: nextMinutes(current)
          }
        }
      };
    });
  }, []);

  const refreshLocationAndReplan = useCallback(async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      const loc = await getCurrentLocationDetails();
      setLocationStatus(loc.label);
      setLocationModalVisible(false);
      const updated: Settings = {
        ...settings,
        locationMode: "gps"
      };
      setSettings(updated);
      await saveSettings(updated);

      // Force a fresh API fetch to refill the 30-day cache window for GPS location.
      await getTodayTomorrowTimings({
        today: new Date(),
        location: { lat: loc.lat, lon: loc.lon },
        locationLabel: loc.label,
        settings: updated,
        forceRefresh: true
      }).catch(() => {
        // Keep GPS switch usable even if provider resolve temporarily fails.
      });

      await replanAll({
        lat: loc.lat,
        lon: loc.lon,
        methodId: updated.methodId,
        settings: updated
      }).catch((error) => {
        if (!isMissingProxyError(error)) {
          throw error;
        }
      });

      Alert.alert(
        t("settings.gps_set_title"),
        t("settings.gps_set_body", { label: loc.label })
      );
    } catch (error) {
      Alert.alert(t("settings.location_title"), String(error));
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  const selectPresetCity = useCallback(
    async (query: string) => {
      try {
        const result = await geocodeCityQuery(query);
        await applyManualLocation({
          lat: result.lat,
          lon: result.lon,
          label: result.label,
          query
        });
      } catch (error) {
        Alert.alert(t("settings.manual_city_title"), String(error));
      }
    },
    [applyManualLocation, t]
  );

  const onSuggestionPress = useCallback(
    async (suggestion: { label: string; lat: number; lon: number; query: string }) => {
      await applyManualLocation({
        label: suggestion.label,
        lat: suggestion.lat,
        lon: suggestion.lon,
        query: suggestion.query
      });
    },
    [applyManualLocation]
  );

  const persistAndReplan = useCallback(async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      await saveSettings(settings);

      const loc = await resolveLocationForSettings(settings);
      setLocationStatus(loc.label);

      await replanAll({
        lat: loc.lat,
        lon: loc.lon,
        methodId: settings.methodId,
        settings
      });

      Alert.alert(t("common.saved"), t("settings.saved_body"));
    } catch (error) {
      if (isMissingProxyError(error)) {
        Alert.alert(t("common.saved"), t("settings.saved_body"));
        return;
      }
      Alert.alert(
        t("common.warning"),
        t("settings.replan_failed", { error: String(error) })
      );
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  if (!settings) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.container}>
          <AppBackground />
          <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>{t("settings.title")}</Text>
          <Text style={[styles.mutedText, { color: colors.textSecondary }]}>{t("common.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>{t("settings.title")}</Text>
          <Pressable onPress={() => setShowAppInfo(true)} hitSlop={8}>
            <Ionicons name="help-circle-outline" size={22} color={isLight ? "#617990" : "#B7C7DD"} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("settings.appearance")}</Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={[styles.settingRowWithBorder, { borderBottomColor: colors.cardBorder }]}>
              <View style={styles.settingLeft}>
                <View style={[styles.iconBox, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                  <Ionicons name="color-palette" size={20} color="#2B8CEE" />
                </View>
                <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                  {t("settings.appearance")}
                </Text>
              </View>
            </View>

            <View style={styles.themeModeRow}>
              {(["system", "dark", "light"] as ThemeMode[]).map((option) => {
                const selected = themeMode === option;
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.themeModeButton,
                      { borderColor: colors.cardBorder },
                      selected && { backgroundColor: colors.accent, borderColor: colors.accent }
                    ]}
                    onPress={() => void setThemeMode(option)}
                  >
                    <Text style={[styles.themeModeButtonText, { color: selected ? "#F2F8FF" : colors.textPrimary }]}>
                      {option === "system"
                        ? t("settings.system")
                        : option === "dark"
                          ? t("settings.dark")
                          : t("settings.light")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={[styles.settingRowWithBorder, { borderBottomColor: colors.cardBorder }]}>
              <View style={styles.settingLeft}>
                <View style={[styles.iconBox, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                  <Ionicons name="language" size={20} color="#2B8CEE" />
                </View>
                <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                  {t("settings.language")}
                </Text>
              </View>
            </View>

            <View style={styles.languageModeRow}>
              {(["system", "nl", "en", "tr"] as LanguageMode[]).map((option) => {
                const selected = languageMode === option;
                const label =
                  option === "system"
                    ? t("settings.lang_system")
                    : option === "nl"
                      ? t("settings.lang_nl")
                      : option === "en"
                        ? t("settings.lang_en")
                        : t("settings.lang_tr");
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.themeModeButton,
                      styles.languageModeButton,
                      { borderColor: colors.cardBorder },
                      selected && { backgroundColor: colors.accent, borderColor: colors.accent }
                    ]}
                    onPress={() => void setLanguageMode(option)}
                  >
                    <Text style={[styles.themeModeButtonText, { color: selected ? "#F2F8FF" : colors.textPrimary }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("settings.calculation")}</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={[styles.settingRowWithBorder, { borderBottomColor: colors.cardBorder }]}>
              <View style={styles.settingLeft}>
                <View style={[styles.iconBox, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                  <MaterialCommunityIcons name="abjad-arabic" size={24} color="#2B8CEE" />
                </View>
                <View>
                  <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                    {t("settings.hanafi_only")}
                  </Text>
                  <Text style={[styles.settingSub, isLight ? { color: "#4E647C" } : null]}>
                    {t("settings.asr_fixed")}
                  </Text>
                </View>
              </View>
              <Switch value={true} disabled />
            </View>

            <Pressable style={styles.settingRow} onPress={() => router.push("/methods")}>
              <View style={styles.settingLeft}>
                <View style={[styles.iconBox, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                  <MaterialIcons name="calculate" size={20} color="#2B8CEE" />
                </View>
                <View>
                  <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                    {t("settings.calculation_method")}
                  </Text>
                  <Text style={[styles.settingSub, isLight ? { color: "#4E647C" } : null]}>
                    {settings.methodName}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
            </Pressable>

          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("settings.location_region")}</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Pressable style={styles.locationRow} onPress={() => setLocationModalVisible(true)}>
              <View style={[styles.locationIconWrap, isLight ? { backgroundColor: "#DFF5EA" } : null]}>
                <Ionicons name="locate" size={22} color="#23D18B" />
              </View>

              <View style={styles.locationCenter}>
                <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                  {t("settings.location_title")}
                </Text>
                <Text style={[styles.settingSub, isLight ? { color: "#4E647C" } : null]}>{locationStatus}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
            </Pressable>
            <View style={[styles.locationFooter, { borderTopColor: colors.cardBorder }]}>
              <Text style={[styles.locationModeText, isLight ? { color: "#607890" } : null]}>
                {t("settings.mode")}:{" "}
                {settings.locationMode === "manual" ? t("settings.mode_manual") : t("settings.mode_gps")}
              </Text>
              <Pressable
                style={[styles.refreshChip, isLight ? { backgroundColor: "#E4EFFB" } : null]}
                onPress={() => void refreshLocationAndReplan()}
              >
                <Text style={styles.refreshChipText}>{t("common.refresh").toUpperCase()}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.notificationHeader}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("settings.notifications")}</Text>
            <Text style={[styles.minutesBeforeLabel, isLight ? { color: "#607890" } : null]}>
              {t("settings.minutes_before")}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {PRAYER_NAMES.map((prayer, index) => {
              const entry = settings.prayerNotifications[prayer];
              const hasBorder = index < PRAYER_NAMES.length - 1;

              return (
                <View
                  key={prayer}
                  style={[
                    styles.notificationRow,
                    hasBorder && styles.notificationRowBorder,
                    hasBorder ? { borderBottomColor: colors.cardBorder } : null
                  ]}
                >
                  <Text style={[styles.notificationPrayer, isLight ? { color: "#1A2E45" } : null]}>
                    {prayerName(prayer)}
                  </Text>

                  <View style={styles.notificationRight}>
                    <Pressable onPress={() => cyclePrayerMinutes(prayer)}>
                      <Text style={styles.minutesText}>{t("settings.mins_before", { mins: entry.minutesBefore })}</Text>
                    </Pressable>
                    <Switch value={entry.enabled} onValueChange={(value) => togglePrayer(prayer, value)} />
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable style={[styles.saveButton, { backgroundColor: colors.accent }]} onPress={() => void persistAndReplan()} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? t("settings.saving") : t("settings.save_settings")}</Text>
          </Pressable>
        </ScrollView>

        <Modal
          visible={locationModalVisible}
          animationType="slide"
          onRequestClose={() => setLocationModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={[styles.locationModalScreen, { backgroundColor: colors.background }]}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <AppBackground />
            <SafeAreaView style={[styles.locationModalSafe, { paddingTop: insets.top + 12 }]} edges={[]}>
              <View style={styles.locationModalHeader}>
                <View>
                  <Text style={[styles.locationModalTitle, { color: colors.textPrimary }]}>
                    {t("settings.location_title")}
                  </Text>
                  <Text style={[styles.locationModalSubtitle, { color: colors.textSecondary }]}>
                    {locationStatus}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setLocationModalVisible(false)}
                  style={[
                    styles.locationCloseButton,
                    isLight
                      ? {
                          backgroundColor: "#D3E3F4",
                          borderWidth: 1,
                          borderColor: "#B3C8DE",
                          shadowColor: "#1B334D",
                          shadowOpacity: 0.12,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 3 }
                        }
                      : null
                  ]}
                >
                  <Ionicons name="close" size={22} color={isLight ? "#55708C" : "#A7BDD7"} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.locationModalContent, { paddingBottom: insets.bottom + 28 }]}
              >
                <Pressable
                  style={[styles.gpsActionButton, saving ? { opacity: 0.7 } : null]}
                  onPress={() => void refreshLocationAndReplan()}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#F2F8FF" />
                  ) : (
                    <>
                      <Ionicons name="navigate" size={20} color="#F2F8FF" />
                      <Text style={styles.gpsActionText}>{t("settings.use_my_location")}</Text>
                    </>
                  )}
                </Pressable>

                <Text style={[styles.manualCityLabel, { color: colors.textSecondary }]}>
                  {t("settings.mode_manual")}
                </Text>
                <View
                  style={[
                    styles.citySearchField,
                    isLight ? { backgroundColor: "#EEF4FB", borderColor: "#C4D6EA" } : null
                  ]}
                >
                  <Ionicons name="search" size={28} color={isLight ? "#5E7894" : "#8AA1BC"} />
                  <TextInput
                    value={cityQuery}
                    onChangeText={setCityQuery}
                    style={[styles.citySearchInput, { color: colors.textPrimary }]}
                    placeholder={t("settings.search_city_placeholder")}
                    placeholderTextColor={isLight ? "#7A8EA5" : "#7D93AE"}
                  />
                  {cityQuery.trim().length > 0 ? (
                    <Pressable onPress={() => setCityQuery("")} style={styles.clearQueryButton}>
                      <Ionicons name="close-circle" size={22} color={isLight ? "#768CA5" : "#8EA5C1"} />
                    </Pressable>
                  ) : null}
                </View>

                {cityQuery.trim().length >= 2 ? (
                  <View style={styles.searchResultList}>
                    {citySearchLoading ? (
                      <View style={styles.suggestionsLoadingWrap}>
                        <ActivityIndicator size="small" color="#2B8CEE" />
                      </View>
                    ) : citySuggestions.length === 0 ? (
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        {t("settings.no_location_options")}
                      </Text>
                    ) : (
                      citySuggestions.map((suggestion, idx) => (
                        <Pressable
                          key={`${suggestion.label}-${suggestion.lat}-${suggestion.lon}-${idx}`}
                          style={[
                            styles.searchResultRow,
                            { borderColor: colors.cardBorder, backgroundColor: colors.card }
                          ]}
                          onPress={() => void onSuggestionPress(suggestion)}
                        >
                          <View>
                            <Text style={[styles.searchResultTitle, { color: colors.textPrimary }]}>
                              {suggestion.label.split(",")[0] || suggestion.label}
                            </Text>
                            <Text style={[styles.searchResultSub, { color: colors.textSecondary }]}>
                              {suggestion.label}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={isLight ? "#6A819D" : "#8AA1BC"} />
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : (
                  <View style={styles.presetGrid}>
                    {PRESET_CITY_QUERIES.map((query) => (
                      <Pressable
                        key={query}
                        style={[
                          styles.presetChip,
                          { borderColor: colors.cardBorder, backgroundColor: colors.card }
                        ]}
                        onPress={() => void selectPresetCity(query)}
                      >
                        <Text style={[styles.presetChipText, { color: colors.textPrimary }]}>
                          {query.split(",")[0]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </ScrollView>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Modal>

        <Modal transparent visible={showAppInfo} animationType="fade" onRequestClose={() => setShowAppInfo(false)}>
          <Pressable style={styles.infoOverlay} onPress={() => setShowAppInfo(false)}>
            <Pressable
              style={[
                styles.infoBubble,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder
                }
              ]}
              onPress={() => {}}
            >
              <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>Go-To-Go Prayer</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>Versie: {appVersion}</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>Build: {appBuild}</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>Developer: Gökhan Yaka</Text>
            </Pressable>
          </Pressable>
        </Modal>
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
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 48
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: "#8CA2BE",
    marginBottom: 10
  },
  themeModeRow: {
    flexDirection: "row",
    gap: 8,
    padding: 14
  },
  languageModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 14
  },
  themeModeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  languageModeButton: {
    flexBasis: "48%"
  },
  themeModeButtonText: {
    fontWeight: "700",
    fontSize: 13
  },
  card: {
    backgroundColor: "#162638",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1D3349",
    marginBottom: 20,
    overflow: "hidden"
  },
  settingRowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1D3349"
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C3550"
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ECF3FF"
  },
  settingSub: {
    marginTop: 3,
    fontSize: 14,
    color: "#8FA2BC"
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    justifyContent: "space-between"
  },
  locationIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#11372D"
  },
  locationCenter: {
    flex: 1,
    paddingRight: 10
  },
  locationFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  locationModeText: {
    marginTop: 2,
    fontSize: 12,
    color: "#6F849D"
  },
  refreshChip: {
    height: 34,
    borderRadius: 18,
    backgroundColor: "#163A5E",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  refreshChipText: {
    color: "#2B8CEE",
    fontWeight: "800",
    fontSize: 13
  },
  suggestionsLoadingWrap: {
    paddingVertical: 16,
    alignItems: "center"
  },
  locationModalScreen: {
    flex: 1
  },
  locationModalSafe: {
    flex: 1,
    paddingHorizontal: 20
  },
  locationModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16
  },
  locationModalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800"
  },
  locationModalSubtitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "500"
  },
  locationCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#20384F"
  },
  locationModalContent: {
    paddingTop: 8,
    flexGrow: 1
  },
  gpsActionButton: {
    height: 72,
    borderRadius: 16,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    shadowColor: "#2B8CEE",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }
  },
  gpsActionText: {
    color: "#F2F8FF",
    fontSize: 16,
    fontWeight: "800"
  },
  manualCityLabel: {
    marginTop: 20,
    marginBottom: 8,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.9
  },
  citySearchField: {
    minHeight: 66,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#24415E",
    backgroundColor: "#102131",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8
  },
  citySearchInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    minHeight: 52
  },
  clearQueryButton: {
    padding: 4
  },
  searchResultList: {
    marginTop: 12,
    gap: 8
  },
  searchResultRow: {
    minHeight: 66,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  searchResultTitle: {
    fontSize: 22,
    fontWeight: "700"
  },
  searchResultSub: {
    marginTop: 2,
    fontSize: 16
  },
  presetGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  presetChip: {
    width: "31%",
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  infoOverlay: {
    flex: 1,
    backgroundColor: "rgba(2, 8, 16, 0.18)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    paddingTop: 86,
    paddingRight: 20
  },
  infoBubble: {
    width: 228,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6
  },
  infoText: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 2
  },
  emptyText: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    fontSize: 13
  },
  notificationHeader: {
    marginTop: 2,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  minutesBeforeLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6E849F"
  },
  notificationRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  notificationRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#1D3349"
  },
  notificationPrayer: {
    fontSize: 17,
    color: "#E9F1FC",
    fontWeight: "600"
  },
  notificationRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  minutesText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2B8CEE"
  },
  saveButton: {
    marginTop: 2,
    height: 62,
    borderRadius: 16,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B8CEE",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 }
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#F2F8FF"
  },
  mutedText: {
    fontSize: 16,
    color: "#8EA4BF"
  }
});
