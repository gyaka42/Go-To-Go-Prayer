import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AppBackground } from "@/components/AppBackground";
import { resolveLocationForSettings } from "@/services/location";
import { registerForLocalNotifications, replanAll } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

const MINUTES_OPTIONS: Array<0 | 5 | 10 | 15 | 30> = [0, 5, 10, 15, 30];
const TONES: Array<"Adhan - Makkah (Normal)" | "Adhan - Madinah (Soft)" | "Beep"> = [
  "Adhan - Makkah (Normal)",
  "Adhan - Madinah (Soft)",
  "Beep"
];

export default function PrayerAlertPreferencesScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";
  const params = useLocalSearchParams<{ prayer?: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  const prayer = useMemo<PrayerName | null>(() => {
    if (!params.prayer) {
      return null;
    }

    const value = Array.isArray(params.prayer) ? params.prayer[0] : params.prayer;
    return PRAYER_NAMES.includes(value as PrayerName) ? (value as PrayerName) : null;
  }, [params.prayer]);

  useEffect(() => {
    void (async () => {
      const saved = await getSettings();
      setSettings(saved);
    })();
  }, []);

  const updatePrayerSettings = (patch: Partial<Settings["prayerNotifications"][PrayerName]>) => {
    if (!prayer) {
      return;
    }

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
            ...patch
          }
        }
      };
    });
  };

  if (!prayer) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.container}>
          <AppBackground />
          <Text style={[styles.title, { color: colors.textPrimary }]}>Prayer not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const entry = settings?.prayerNotifications[prayer];

  const onSave = async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      await saveSettings(settings);

      try {
        const loc = await resolveLocationForSettings(settings);
        await replanAll({
          lat: loc.lat,
          lon: loc.lon,
          methodId: settings.methodId,
          settings
        });
      } catch {
        // Save should still succeed even if replan cannot run now.
      }

      router.back();
    } finally {
      setSaving(false);
    }
  };

  const onTestNotification = async () => {
    if (!entry) {
      return;
    }

    const granted = await registerForLocalNotifications();
    if (!granted) {
      Alert.alert("Notifications", "Notification permission is required.");
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Prayer time",
        body:
          entry.minutesBefore === 0
            ? `It's time for ${prayer}.`
            : `${prayer} in ${entry.minutesBefore} minutes.`
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        repeats: false
      }
    });

    Alert.alert("Test sent", "You should receive a local notification in a few seconds.");
  };

  const onResetToDefault = () => {
    updatePrayerSettings({
      enabled: true,
      minutesBefore: 0,
      playSound: true,
      tone: "Adhan - Makkah (Normal)",
      volume: 75,
      vibration: true
    });
  };

  const cycleTone = () => {
    if (!entry) {
      return;
    }

    const index = TONES.indexOf(entry.tone);
    const next = TONES[(index + 1) % TONES.length];
    updatePrayerSettings({ tone: next });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable onPress={() => router.back()} style={styles.headerIconButton}>
              <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
            </Pressable>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{prayer} Notifications</Text>
          </View>

          <Pressable onPress={() => void onSave()} style={styles.saveLink}>
            <Text style={styles.saveLinkText}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.alertHeadRow}>
            <View style={[styles.alertHeadIconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
              <Ionicons name="notifications" size={22} color="#2B8CEE" />
            </View>
            <View>
              <Text style={[styles.alertHeadTitle, isLight ? { color: "#10253A" } : null]}>Alert Settings</Text>
              <Text style={[styles.alertHeadSub, isLight ? { color: "#4E647C" } : null]}>
                Configure how you're notified for {prayer}
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionLabel, isLight ? { color: "#617990" } : null]}>SOUND & AUDIO</Text>
          <View
            style={[
              styles.card,
              isLight ? { backgroundColor: "#FFFFFF", borderColor: "#D7E2EF" } : null
            ]}
          >
            <View style={[styles.rowBordered, isLight ? { borderBottomColor: "#E4EDF7" } : null]}>
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#EAF2FC" : "#1C3550" }]}>
                  <Ionicons name="volume-high" size={18} color="#59A7FF" />
                </View>
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>Play Sound</Text>
              </View>
              <Switch
                value={entry?.playSound ?? true}
                onValueChange={(value) => updatePrayerSettings({ playSound: value })}
              />
            </View>

            <Pressable style={[styles.rowBordered, isLight ? { borderBottomColor: "#E4EDF7" } : null]} onPress={cycleTone}>
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#EEE9FF" : "#352159" }]}>
                  <Ionicons name="musical-notes" size={18} color="#C797FF" />
                </View>
                <View>
                  <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>Alert Tone</Text>
                  <Text style={[styles.rowSub, isLight ? { color: "#4E647C" } : null]}>
                    {entry?.tone ?? "Adhan - Makkah (Normal)"}
                  </Text>
                </View>
              </View>

              <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
            </Pressable>

            <View style={styles.volumeWrap}>
              <Pressable
                style={styles.volButton}
                onPress={() => updatePrayerSettings({ volume: Math.max(0, (entry?.volume ?? 75) - 5) })}
              >
                <Ionicons name="volume-low" size={16} color={isLight ? "#5C738A" : "#7F93AD"} />
              </Pressable>

              <View style={[styles.sliderTrack, isLight ? { backgroundColor: "#DCE7F4" } : null]}>
                <View style={[styles.sliderFill, { width: `${entry?.volume ?? 75}%` }]} />
                <View style={[styles.sliderThumb, { left: `${Math.max(3, (entry?.volume ?? 75) - 2)}%` }]} />
              </View>

              <Pressable
                style={styles.volButton}
                onPress={() => updatePrayerSettings({ volume: Math.min(100, (entry?.volume ?? 75) + 5) })}
              >
                <Ionicons name="volume-high" size={16} color={isLight ? "#5C738A" : "#7F93AD"} />
              </Pressable>
            </View>
          </View>
          <Text style={[styles.helpText, isLight ? { color: "#617990" } : null]}>
            Custom volume levels will override system settings for this alert.
          </Text>

          <Text style={[styles.sectionLabel, isLight ? { color: "#617990" } : null]}>HAPTICS</Text>
          <View
            style={[
              styles.card,
              isLight ? { backgroundColor: "#FFFFFF", borderColor: "#D7E2EF" } : null
            ]}
          >
            <View style={styles.rowPlain}>
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#FFF0DE" : "#443020" }]}>
                  <MaterialIcons name="vibration" size={18} color="#FFB15B" />
                </View>
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>Vibration</Text>
              </View>
              <Switch
                value={entry?.vibration ?? true}
                onValueChange={(value) => updatePrayerSettings({ vibration: value })}
              />
            </View>
          </View>

          <Pressable style={styles.testButton} onPress={() => void onTestNotification()}>
            <Ionicons name="play-circle" size={18} color="#F2F8FF" />
            <Text style={styles.testButtonText}>Test Notification</Text>
          </Pressable>

          <Text style={[styles.helpCenterText, isLight ? { color: "#617990" } : null]}>
            Send a test notification to check your volume and vibration preferences.
          </Text>

          <View
            style={[
              styles.card,
              isLight ? { backgroundColor: "#FFFFFF", borderColor: "#D7E2EF" } : null
            ]}
          >
            <Pressable
              style={[styles.rowBordered, isLight ? { borderBottomColor: "#E4EDF7" } : null]}
              onPress={() => {
                if (!entry) {
                  return;
                }
                const index = MINUTES_OPTIONS.indexOf(entry.minutesBefore);
                const next = MINUTES_OPTIONS[(index + 1) % MINUTES_OPTIONS.length];
                updatePrayerSettings({ minutesBefore: next });
              }}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#DFF5EE" : "#133D36" }]}>
                  <Ionicons name="time" size={18} color="#46D9B0" />
                </View>
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>Alert Offset</Text>
              </View>

              <View style={styles.rightLabelWrap}>
                <Text style={[styles.rightLabelText, isLight ? { color: "#4E647C" } : null]}>
                  {entry?.minutesBefore === 0 ? "At prayer time" : `${entry?.minutesBefore} mins before`}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
              </View>
            </Pressable>

            <Pressable style={styles.rowPlain} onPress={onResetToDefault}>
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#FFE8EE" : "#4B1F2B" }]}>
                  <Ionicons name="trash" size={18} color="#FF667D" />
                </View>
                <Text style={styles.resetText}>Reset to Default</Text>
              </View>
            </Pressable>
          </View>

          <Pressable style={styles.saveButton} onPress={() => void onSave()} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? "Saving..." : "Save Preferences"}</Text>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  saveLink: {
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  saveLinkText: {
    color: "#2B8CEE",
    fontSize: 16,
    fontWeight: "700"
  },
  scrollContent: {
    paddingBottom: 48
  },
  alertHeadRow: {
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  alertHeadIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  alertHeadTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  alertHeadSub: {
    marginTop: 2,
    fontSize: 14,
    color: "#8EA4BF"
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#7F93AD",
    marginBottom: 8
  },
  card: {
    borderRadius: 18,
    backgroundColor: "#162638",
    borderWidth: 1,
    borderColor: "#1D3349",
    overflow: "hidden",
    marginBottom: 10
  },
  rowBordered: {
    minHeight: 68,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#1D3349"
  },
  rowPlain: {
    minHeight: 68,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  smallIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ECF3FF"
  },
  rowSub: {
    marginTop: 2,
    fontSize: 13,
    color: "#8EA4BF"
  },
  volumeWrap: {
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  volButton: {
    width: 22,
    alignItems: "center"
  },
  sliderTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2C3F57",
    justifyContent: "center"
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: "#2B8CEE"
  },
  sliderThumb: {
    position: "absolute",
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#F4F8FF",
    borderWidth: 2,
    borderColor: "#2B8CEE"
  },
  helpText: {
    marginTop: 2,
    marginBottom: 18,
    fontSize: 12,
    color: "#7F93AD"
  },
  testButton: {
    marginTop: 4,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  testButtonText: {
    color: "#F2F8FF",
    fontSize: 18,
    fontWeight: "700"
  },
  helpCenterText: {
    marginTop: 10,
    marginBottom: 20,
    fontSize: 12,
    color: "#7F93AD",
    textAlign: "center"
  },
  rightLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  rightLabelText: {
    fontSize: 14,
    color: "#8EA4BF"
  },
  resetText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF596F"
  },
  saveButton: {
    marginTop: 6,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center"
  },
  saveButtonText: {
    color: "#2B8CEE",
    fontSize: 16,
    fontWeight: "700"
  }
});
