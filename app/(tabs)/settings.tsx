import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
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
  CitySuggestion,
  geocodeCityQuery,
  getCurrentLocationDetails,
  resolveLocationForSettings,
  searchCitySuggestions
} from "@/services/location";
import { AppBackground } from "@/components/AppBackground";
import { replanAll } from "@/services/notifications";
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

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode, setMode } = useAppTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Current Location");
  const [manualCityQuery, setManualCityQuery] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<CitySuggestion | null>(null);

  const loadSettings = useCallback(async () => {
    const saved = await getSettings();
    setSettings(saved);
    setManualCityQuery("");
    setSelectedSuggestion(null);
    setCitySuggestions([]);
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
    const query = manualCityQuery.trim();
    setSelectedSuggestion((prev) => (prev && prev.label === query ? prev : null));

    if (query.length < 2) {
      setCitySuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const timeout = setTimeout(() => {
      void (async () => {
        setLoadingSuggestions(true);
        try {
          const list = await searchCitySuggestions(query);
          setCitySuggestions(list);
        } finally {
          setLoadingSuggestions(false);
        }
      })();
    }, 300);

    return () => clearTimeout(timeout);
  }, [manualCityQuery]);

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
      Alert.alert("Location", String(error));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const applyManualCity = useCallback(async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      const manual =
        selectedSuggestion && selectedSuggestion.label === manualCityQuery.trim()
          ? selectedSuggestion
          : await geocodeCityQuery(manualCityQuery);
      const updated: Settings = {
        ...settings,
        locationMode: "manual",
        manualLocation: {
          query: manualCityQuery.trim(),
          label: manual.label,
          lat: manual.lat,
          lon: manual.lon
        }
      };
      setSettings(updated);
      setLocationStatus(manual.label);
      setManualCityQuery("");
      setSelectedSuggestion(null);
      setCitySuggestions([]);
      await saveSettings(updated);

      await replanAll({
        lat: manual.lat,
        lon: manual.lon,
        methodId: updated.methodId,
        settings: updated
      });

      Alert.alert("Manual location set", `${manual.label} is now used for prayer times.`);
    } catch (error) {
      Alert.alert("Manual city", String(error));
    } finally {
      setSaving(false);
    }
  }, [manualCityQuery, settings]);

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

      Alert.alert("Saved", "Settings saved and notifications replanned.");
    } catch (error) {
      Alert.alert("Warning", `Saved settings, but notification replan failed: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (!settings) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <AppBackground />
          <Text style={styles.pageTitle}>App Settings</Text>
          <Text style={styles.mutedText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>App Settings</Text>
          <Ionicons name="help-circle-outline" size={22} color="#B7C7DD" />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>APPEARANCE</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.themeModeRow}>
              {(["system", "dark", "light"] as ThemeMode[]).map((option) => {
                const selected = mode === option;
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.themeModeButton,
                      { borderColor: colors.cardBorder },
                      selected && { backgroundColor: colors.accent, borderColor: colors.accent }
                    ]}
                    onPress={() => void setMode(option)}
                  >
                    <Text style={[styles.themeModeButtonText, { color: selected ? "#F2F8FF" : colors.textPrimary }]}>
                      {option === "system" ? "System" : option === "dark" ? "Dark" : "Light"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>CALCULATION</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.settingRowWithBorder}>
              <View style={styles.settingLeft}>
                <View style={styles.iconBox}>
                  <Ionicons name="book" size={20} color="#2B8CEE" />
                </View>
                <View>
                  <Text style={styles.settingTitle}>Hanafi Only</Text>
                  <Text style={styles.settingSub}>Asr method (fixed)</Text>
                </View>
              </View>
              <Switch value={true} disabled />
            </View>

            <Pressable style={styles.settingRow} onPress={() => router.push("/methods")}>
              <View style={styles.settingLeft}>
                <View style={styles.iconBox}>
                  <MaterialIcons name="calculate" size={20} color="#2B8CEE" />
                </View>
                <View>
                  <Text style={styles.settingTitle}>Calculation Method</Text>
                  <Text style={styles.settingSub}>{settings.methodName}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8EA4BF" />
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>LOCATION & REGION</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.locationRow}>
              <View style={styles.locationIconWrap}>
                <Ionicons name="locate" size={22} color="#23D18B" />
              </View>

              <View style={styles.locationCenter}>
                <Text style={styles.settingTitle}>GPS Connected</Text>
                <Text style={styles.settingSub}>{locationStatus}</Text>
                <Text style={styles.locationModeText}>
                  Mode: {settings.locationMode === "manual" ? "Manual city" : "GPS"}
                </Text>
              </View>

              <Pressable style={styles.refreshChip} onPress={() => void refreshLocationAndReplan()}>
                <Text style={styles.refreshChipText}>REFRESH</Text>
              </Pressable>
            </View>
            <View style={styles.manualWrap}>
              <TextInput
                style={styles.manualInput}
                value={manualCityQuery}
                onChangeText={(value) => {
                  setManualCityQuery(value);
                }}
                placeholder="Manual fallback: Select city..."
                placeholderTextColor="#6F849D"
                autoCapitalize="words"
              />
              <Pressable style={styles.manualButton} onPress={() => void applyManualCity()} disabled={saving}>
                <Text style={styles.manualButtonText}>Use City</Text>
              </Pressable>
            </View>
            {loadingSuggestions ? (
              <View style={styles.suggestionsLoadingWrap}>
                <ActivityIndicator size="small" color="#2B8CEE" />
              </View>
            ) : null}
            {citySuggestions.length > 0 ? (
              <FlatList
                data={citySuggestions}
                keyExtractor={(item, index) => `${item.label}-${index}`}
                scrollEnabled={false}
                style={styles.suggestionsList}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.suggestionRow}
                    onPress={() => {
                      setManualCityQuery(item.label);
                      setSelectedSuggestion(item);
                      setCitySuggestions([]);
                    }}
                  >
                    <Ionicons name="location-outline" size={14} color="#7EA0C3" />
                    <Text style={styles.suggestionText}>{item.label}</Text>
                  </Pressable>
                )}
              />
            ) : null}
          </View>

          <View style={styles.notificationHeader}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>NOTIFICATIONS</Text>
            <Text style={styles.minutesBeforeLabel}>MINUTES BEFORE</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {PRAYER_NAMES.map((prayer, index) => {
              const entry = settings.prayerNotifications[prayer];
              const hasBorder = index < PRAYER_NAMES.length - 1;

              return (
                <View key={prayer} style={[styles.notificationRow, hasBorder && styles.notificationRowBorder]}>
                  <Text style={styles.notificationPrayer}>{prayer}</Text>

                  <View style={styles.notificationRight}>
                    <Pressable onPress={() => cyclePrayerMinutes(prayer)}>
                      <Text style={styles.minutesText}>{entry.minutesBefore} mins</Text>
                    </Pressable>
                    <Switch value={entry.enabled} onValueChange={(value) => togglePrayer(prayer, value)} />
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable style={[styles.saveButton, { backgroundColor: colors.accent }]} onPress={() => void persistAndReplan()} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? "Saving..." : "Save Settings"}</Text>
          </Pressable>
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
  themeModeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  manualInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: "#102131",
    borderWidth: 1,
    borderColor: "#23405B",
    color: "#EAF2FF",
    paddingHorizontal: 12,
    fontSize: 14
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
