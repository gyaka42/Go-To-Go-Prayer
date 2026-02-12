import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  geocodeCityQuery,
  getCurrentLocationDetails,
  resolveLocationForSettings
} from "@/services/location";
import { AppBackground } from "@/components/AppBackground";
import { LanguageMode, useI18n } from "@/i18n/I18nProvider";
import { replanAll } from "@/services/notifications";
import {
  DiyanetCountryOption,
  DiyanetDistrictOption,
  DiyanetStateOption,
  fetchDiyanetCountries,
  fetchDiyanetDistricts,
  fetchDiyanetStates,
  resolveDiyanetDistrictCoordinates
} from "@/services/diyanetLocations";
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

type PickerType = "country" | "state" | "district" | null;

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode: themeMode, setMode: setThemeMode, resolvedTheme } = useAppTheme();
  const { t, prayerName, mode: languageMode, setMode: setLanguageMode, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [locationStatus, setLocationStatus] = useState(t("common.current_location"));
  const [countries, setCountries] = useState<DiyanetCountryOption[]>([]);
  const [states, setStates] = useState<DiyanetStateOption[]>([]);
  const [districts, setDistricts] = useState<DiyanetDistrictOption[]>([]);
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<number | null>(null);
  const [selectedDistrictId, setSelectedDistrictId] = useState<number | null>(null);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [countriesLoadError, setCountriesLoadError] = useState<string | null>(null);
  const [pickerType, setPickerType] = useState<PickerType>(null);
  const [pickerQuery, setPickerQuery] = useState("");

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

  useEffect(() => {
    void (async () => {
      setLoadingCountries(true);
      setCountriesLoadError(null);
      try {
        const result = await fetchDiyanetCountries(localeTag);
        setCountries(result);
      } catch (error) {
        setCountries([]);
        setCountriesLoadError(String(error));
      } finally {
        setLoadingCountries(false);
      }
    })();
  }, [localeTag]);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
      void loadLocationLabel();
    }, [loadLocationLabel, loadSettings])
  );

  useEffect(() => {
    if (!selectedCountryId) {
      setStates([]);
      setDistricts([]);
      setSelectedStateId(null);
      setSelectedDistrictId(null);
      return;
    }

    void (async () => {
      setLoadingStates(true);
      try {
        const result = await fetchDiyanetStates(selectedCountryId, localeTag);
        setStates(result);
      } catch {
        setStates([]);
      } finally {
        setLoadingStates(false);
      }
    })();
  }, [localeTag, selectedCountryId]);

  useEffect(() => {
    if (!selectedStateId) {
      setDistricts([]);
      setSelectedDistrictId(null);
      return;
    }

    void (async () => {
      setLoadingDistricts(true);
      try {
        const result = await fetchDiyanetDistricts(selectedStateId, localeTag);
        setDistricts(result);
      } catch {
        setDistricts([]);
      } finally {
        setLoadingDistricts(false);
      }
    })();
  }, [localeTag, selectedStateId]);

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
      const updated: Settings = {
        ...settings,
        locationMode: "gps"
      };
      setSettings(updated);
      await saveSettings(updated);

      await replanAll({
        lat: loc.lat,
        lon: loc.lon,
        methodId: updated.methodId,
        settings: updated
      });
    } catch (error) {
      Alert.alert(t("settings.location_title"), String(error));
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  const applyManualCity = useCallback(async () => {
    if (!settings) {
      return;
    }

    const selectedCountry = countries.find((item) => item.id === selectedCountryId);
    const selectedState = states.find((item) => item.id === selectedStateId);
    const selectedDistrict = districts.find((item) => item.id === selectedDistrictId);

    if (!selectedCountry || !selectedState || !selectedDistrict) {
      Alert.alert(t("settings.manual_city_title"), t("settings.select_all_location_levels"));
      return;
    }

    setSaving(true);
    try {
      const label = `${selectedDistrict.name}, ${selectedState.name}, ${selectedCountry.name}`;
      let lat = selectedDistrict.lat;
      let lon = selectedDistrict.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const resolved = await resolveDiyanetDistrictCoordinates({
          districtId: selectedDistrict.id,
          districtName: selectedDistrict.name,
          stateId: selectedState.id,
          stateName: selectedState.name,
          countryCode: selectedCountry.code,
          countryName: selectedCountry.name,
          locale: localeTag
        });
        if (resolved) {
          lat = resolved.lat;
          lon = resolved.lon;
        } else {
          // Client-side fallback chain for districts without usable backend coordinates.
          const fallbackQueries = [
            `${selectedDistrict.name}, ${selectedState.name}, ${selectedCountry.name}`,
            `${selectedDistrict.name}, ${selectedCountry.name}`,
            selectedDistrict.name
          ];
          let resolvedFallback: { lat: number; lon: number } | null = null;
          for (const query of fallbackQueries) {
            try {
              const geocoded = await geocodeCityQuery(query);
              resolvedFallback = { lat: geocoded.lat, lon: geocoded.lon };
              break;
            } catch {
              // Continue fallback chain.
            }
          }
          if (!resolvedFallback) {
            throw new Error(t("settings.coordinates_not_found"));
          }
          lat = resolvedFallback.lat;
          lon = resolvedFallback.lon;
        }
      }

      const updated: Settings = {
        ...settings,
        locationMode: "manual",
        manualLocation: {
          query: label,
          label,
          lat: lat as number,
          lon: lon as number
        }
      };
      setSettings(updated);
      setLocationStatus(label);
      await saveSettings(updated);

      Alert.alert(
        t("settings.manual_set_title"),
        t("settings.manual_set_body", { label })
      );
      setSelectedCountryId(null);
      setSelectedStateId(null);
      setSelectedDistrictId(null);
      setStates([]);
      setDistricts([]);

      void replanAll({
        lat: lat as number,
        lon: lon as number,
        methodId: updated.methodId,
        settings: updated
      }).catch((error) => {
        Alert.alert(
          t("common.warning"),
          t("settings.replan_failed", { error: String(error) })
        );
      });
    } catch (error) {
      Alert.alert(t("settings.manual_city_title"), String(error));
    } finally {
      setSaving(false);
    }
  }, [countries, districts, localeTag, selectedCountryId, selectedDistrictId, selectedStateId, settings, states, t]);

  const selectedCountry = countries.find((item) => item.id === selectedCountryId) || null;
  const selectedState = states.find((item) => item.id === selectedStateId) || null;
  const selectedDistrict = districts.find((item) => item.id === selectedDistrictId) || null;

  const countryDisplayNames = (() => {
    try {
      return new Intl.DisplayNames([localeTag], { type: "region" });
    } catch {
      return null;
    }
  })();

  const pickerItems =
    pickerType === "country"
      ? countries.map((item) => ({
          id: item.id,
          label: item.code && countryDisplayNames ? countryDisplayNames.of(item.code) || item.name : item.name
        }))
      : pickerType === "state"
        ? states.map((item) => ({ id: item.id, label: item.name }))
        : pickerType === "district"
          ? districts.map((item) => ({ id: item.id, label: item.name }))
          : [];

  const filteredPickerItems =
    pickerQuery.trim().length === 0
      ? pickerItems
      : pickerItems.filter((item) => item.label.toLowerCase().includes(pickerQuery.trim().toLowerCase()));

  const pickerTitle =
    pickerType === "country"
      ? t("settings.country_label")
      : pickerType === "state"
        ? t("settings.state_label")
        : t("settings.district_label");

  const onSelectPickerItem = useCallback(
    (id: number) => {
      if (pickerType === "country") {
        setSelectedCountryId(id);
        setSelectedStateId(null);
        setSelectedDistrictId(null);
      } else if (pickerType === "state") {
        setSelectedStateId(id);
        setSelectedDistrictId(null);
      } else if (pickerType === "district") {
        setSelectedDistrictId(id);
      }
      setPickerType(null);
      setPickerQuery("");
    },
    [pickerType]
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
          <Ionicons name="help-circle-outline" size={22} color={isLight ? "#617990" : "#B7C7DD"} />
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
                  <Ionicons name="book" size={20} color="#2B8CEE" />
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
            <View style={styles.locationRow}>
              <View style={[styles.locationIconWrap, isLight ? { backgroundColor: "#DFF5EA" } : null]}>
                <Ionicons name="locate" size={22} color="#23D18B" />
              </View>

              <View style={styles.locationCenter}>
                <Text style={[styles.settingTitle, isLight ? { color: "#1A2E45" } : null]}>
                  {t("settings.gps_connected")}
                </Text>
                <Text style={[styles.settingSub, isLight ? { color: "#4E647C" } : null]}>{locationStatus}</Text>
                <Text style={[styles.locationModeText, isLight ? { color: "#607890" } : null]}>
                  {t("settings.mode")}:{" "}
                  {settings.locationMode === "manual" ? t("settings.mode_manual") : t("settings.mode_gps")}
                </Text>
              </View>

              <Pressable
                style={[styles.refreshChip, isLight ? { backgroundColor: "#E4EFFB" } : null]}
                onPress={() => void refreshLocationAndReplan()}
              >
                <Text style={styles.refreshChipText}>{t("common.refresh").toUpperCase()}</Text>
              </Pressable>
            </View>
            <View style={[styles.manualWrap, { borderTopColor: colors.cardBorder }]}>
              <Pressable
                style={[
                  styles.selectorButton,
                  isLight ? { backgroundColor: "#F2F7FD", borderColor: "#C8DBEE" } : null
                ]}
                onPress={() => {
                  if (countries.length === 0) {
                    Alert.alert(
                      t("settings.location_title"),
                      countriesLoadError || t("settings.no_location_options")
                    );
                    return;
                  }
                  setPickerType("country");
                }}
              >
                <Text style={[styles.selectorLabel, isLight ? { color: "#607890" } : null]}>
                  {t("settings.country_label")}
                </Text>
                <Text style={[styles.selectorValue, isLight ? { color: "#1A2E45" } : null]}>
                  {selectedCountry
                    ? selectedCountry.code && countryDisplayNames
                      ? countryDisplayNames.of(selectedCountry.code) || selectedCountry.name
                      : selectedCountry.name
                    : t("settings.select_country")}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.selectorButton,
                  isLight ? { backgroundColor: "#F2F7FD", borderColor: "#C8DBEE" } : null,
                  !selectedCountryId ? { opacity: 0.6 } : null
                ]}
                onPress={() => setPickerType("state")}
                disabled={!selectedCountryId}
              >
                <Text style={[styles.selectorLabel, isLight ? { color: "#607890" } : null]}>
                  {t("settings.state_label")}
                </Text>
                <Text style={[styles.selectorValue, isLight ? { color: "#1A2E45" } : null]}>
                  {selectedState?.name || t("settings.select_state")}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.selectorButton,
                  isLight ? { backgroundColor: "#F2F7FD", borderColor: "#C8DBEE" } : null,
                  !selectedStateId ? { opacity: 0.6 } : null
                ]}
                onPress={() => setPickerType("district")}
                disabled={!selectedStateId}
              >
                <Text style={[styles.selectorLabel, isLight ? { color: "#607890" } : null]}>
                  {t("settings.district_label")}
                </Text>
                <Text style={[styles.selectorValue, isLight ? { color: "#1A2E45" } : null]}>
                  {selectedDistrict?.name || t("settings.select_district")}
                </Text>
              </Pressable>

              <Pressable style={styles.manualButton} onPress={() => void applyManualCity()} disabled={saving}>
                <Text style={styles.manualButtonText}>{t("settings.use_city")}</Text>
              </Pressable>
            </View>
            {loadingCountries || loadingStates || loadingDistricts ? (
              <View style={styles.suggestionsLoadingWrap}>
                <ActivityIndicator size="small" color="#2B8CEE" />
              </View>
            ) : null}
            {countriesLoadError ? (
              <Text style={[styles.loadErrorText, { color: isLight ? "#A33D3D" : "#FF8A8A" }]}>
                {t("settings.location_options_failed")}
              </Text>
            ) : null}
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

        <Modal transparent visible={pickerType !== null} animationType="fade" onRequestClose={() => setPickerType(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{pickerTitle}</Text>
              <TextInput
                style={[
                  styles.modalSearchInput,
                  isLight ? { backgroundColor: "#F2F7FD", borderColor: "#C8DBEE", color: "#1A2E45" } : null
                ]}
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder={t("methods.search_placeholder")}
                placeholderTextColor={isLight ? "#607890" : "#6F849D"}
              />
              <FlatList
                data={filteredPickerItems}
                keyExtractor={(item) => `${pickerType}-${item.id}`}
                style={[styles.modalList, { borderTopColor: colors.cardBorder }]}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.suggestionRow, { borderBottomColor: colors.cardBorder }]}
                    onPress={() => onSelectPickerItem(item.id)}
                  >
                    <Ionicons name="location-outline" size={14} color="#7EA0C3" />
                    <Text style={[styles.suggestionText, isLight ? { color: "#344E68" } : null]}>{item.label}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {loadingCountries || loadingStates || loadingDistricts
                      ? t("common.loading")
                      : t("settings.no_location_options")}
                  </Text>
                }
              />
              <Pressable style={[styles.cancelButton, { borderColor: colors.cardBorder }]} onPress={() => setPickerType(null)}>
                <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>{t("common.close")}</Text>
              </Pressable>
            </View>
          </View>
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
    gap: 12
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
    flex: 1
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
  manualWrap: {
    borderTopWidth: 1,
    borderTopColor: "#1D3349",
    padding: 12,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8
  },
  selectorButton: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: "#102131",
    borderWidth: 1,
    borderColor: "#23405B",
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center"
  },
  selectorLabel: {
    fontSize: 11,
    color: "#6F849D",
    fontWeight: "700",
    letterSpacing: 0.4
  },
  selectorValue: {
    fontSize: 14,
    color: "#EAF2FF",
    marginTop: 2,
    fontWeight: "600"
  },
  manualButton: {
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center"
  },
  manualButtonText: {
    color: "#F2F8FF",
    fontWeight: "700",
    fontSize: 13
  },
  suggestionsLoadingWrap: {
    paddingHorizontal: 12,
    paddingBottom: 8
  },
  suggestionsList: {
    borderTopWidth: 1,
    borderTopColor: "#1D3349"
  },
  suggestionRow: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1D3349"
  },
  suggestionText: {
    flex: 1,
    color: "#CFE0F4",
    fontSize: 13
  },
  loadErrorText: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 10
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 8, 16, 0.7)",
    justifyContent: "center",
    paddingHorizontal: 20
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: "72%",
    padding: 12
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  modalSearchInput: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: "#102131",
    borderWidth: 1,
    borderColor: "#23405B",
    color: "#EAF2FF",
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 8
  },
  modalList: {
    borderTopWidth: 1
  },
  cancelButton: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "700"
  },
  emptyText: {
    padding: 12,
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
