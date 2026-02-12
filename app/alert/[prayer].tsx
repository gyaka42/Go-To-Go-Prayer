import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  Vibration
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import { registerForLocalNotifications, replanAll, resolveNotificationSound } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

const MINUTES_OPTIONS: Array<0 | 5 | 10 | 15 | 30> = [0, 5, 10, 15, 30];
export default function PrayerAlertPreferencesScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, prayerName } = useI18n();
  const isLight = resolvedTheme === "light";
  const params = useLocalSearchParams<{ prayer?: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [sliderTrackWidth, setSliderTrackWidth] = useState(0);
  const [isSliding, setIsSliding] = useState(false);

  const prayer = useMemo<PrayerName | null>(() => {
    if (!params.prayer) {
      return null;
    }

    const value = Array.isArray(params.prayer) ? params.prayer[0] : params.prayer;
    return PRAYER_NAMES.includes(value as PrayerName) ? (value as PrayerName) : null;
  }, [params.prayer]);

  const load = useCallback(async () => {
    const saved = await getSettings();
    setSettings(saved);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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

  const setVolumeFromX = useCallback(
    (locationX: number) => {
      if (!prayer || sliderTrackWidth <= 0) {
        return;
      }
      const normalized = Math.min(1, Math.max(0, locationX / sliderTrackWidth));
      const nextVolume = Math.round(normalized * 100);
      updatePrayerSettings({ volume: nextVolume });
    },
    [prayer, sliderTrackWidth]
  );

  const sliderResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (event) => {
          setIsSliding(true);
          setVolumeFromX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => setVolumeFromX(event.nativeEvent.locationX),
        onPanResponderRelease: () => setIsSliding(false),
        onPanResponderTerminate: () => setIsSliding(false)
      }),
    [setVolumeFromX]
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

  const entry = settings?.prayerNotifications[prayer];
  const prayerLabel = prayerName(prayer);
  const minutesBeforeValue = entry?.minutesBefore ?? 0;
  const volumeValue = entry?.volume ?? 75;
  const thumbLeftPercent = Math.max(0, Math.min(100, volumeValue));

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
      Alert.alert(t("alert.notifications_title"), t("alert.notifications_permission"));
      return;
    }

    if (entry.vibration) {
      Vibration.vibrate(45);
      setTimeout(() => Vibration.vibrate(45), 120);
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: t("notifications.title"),
        body:
          entry.minutesBefore === 0
            ? t("notifications.body_at_time", { prayer: prayerLabel })
            : t("notifications.body_offset", { prayer: prayerLabel, mins: entry.minutesBefore }),
        data: {
          playSound: entry.playSound,
          tone: entry.tone
        },
        sound: resolveNotificationSound(entry.playSound, entry.tone)
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        repeats: false
      }
    });

    Alert.alert(
      t("alert.test_sent_title"),
      t("alert.test_sent_body")
    );
  };

  const onResetToDefault = () => {
    updatePrayerSettings({
      enabled: true,
      minutesBefore: 0,
      playSound: true,
      tone: "Adhan",
      volume: 75,
      vibration: true
    });
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
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t("alert.title", { prayer: prayerLabel })}
            </Text>
          </View>

          <Pressable onPress={() => void onSave()} style={styles.saveLink}>
            <Text style={styles.saveLinkText}>{t("common.save")}</Text>
          </Pressable>
        </View>

        <ScrollView
          scrollEnabled={!isSliding}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.alertHeadRow}>
            <View style={[styles.alertHeadIconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
              <Ionicons name="notifications" size={22} color="#2B8CEE" />
            </View>
            <View>
              <Text style={[styles.alertHeadTitle, isLight ? { color: "#10253A" } : null]}>{t("alert.alert_settings")}</Text>
              <Text style={[styles.alertHeadSub, isLight ? { color: "#4E647C" } : null]}>
                {t("alert.configure_for", { prayer: prayerLabel })}
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionLabel, isLight ? { color: "#617990" } : null]}>{t("alert.sound_audio")}</Text>
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
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>{t("alert.play_sound")}</Text>
              </View>
              <View style={styles.switchWrap}>
                <Switch
                  value={entry?.playSound ?? true}
                  onValueChange={(value) => updatePrayerSettings({ playSound: value })}
                />
              </View>
            </View>

            <Pressable
              style={[styles.rowBordered, isLight ? { borderBottomColor: "#E4EDF7" } : null]}
              onPress={() => router.push(`/tones?prayer=${prayer}`)}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#EEE9FF" : "#352159" }]}>
                  <Ionicons name="musical-notes" size={18} color="#C797FF" />
                </View>
                <View>
                  <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>{t("alert.alert_tone")}</Text>
                  <Text style={[styles.rowSub, isLight ? { color: "#4E647C" } : null]}>
                    {(entry?.tone ?? "Adhan") === "Adhan" ? t("alert.tone_adhan") : t("alert.tone_beep")}
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

              <View
                style={styles.sliderTouchArea}
                onLayout={(event: LayoutChangeEvent) => setSliderTrackWidth(event.nativeEvent.layout.width)}
                {...sliderResponder.panHandlers}
              >
                <View style={[styles.sliderTrack, isLight ? { backgroundColor: "#DCE7F4" } : null]}>
                  <View style={[styles.sliderFill, { width: `${volumeValue}%` }]} />
                  <View style={[styles.sliderThumb, { left: `${thumbLeftPercent}%` }]} pointerEvents="none" />
                </View>
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
            {t("alert.volume_help")}
          </Text>

          <Text style={[styles.sectionLabel, isLight ? { color: "#617990" } : null]}>{t("alert.haptics")}</Text>
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
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>{t("alert.vibration")}</Text>
              </View>
              <View style={styles.switchWrap}>
                <Switch
                  value={entry?.vibration ?? true}
                  onValueChange={(value) => updatePrayerSettings({ vibration: value })}
                />
              </View>
            </View>
          </View>

          <Pressable style={styles.testButton} onPress={() => void onTestNotification()}>
            <Ionicons name="play-circle" size={18} color="#F2F8FF" />
            <Text style={styles.testButtonText}>{t("alert.test_notification")}</Text>
          </Pressable>

          <Text style={[styles.helpCenterText, isLight ? { color: "#617990" } : null]}>
            {t("alert.test_help")}
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
                <Text style={[styles.rowTitle, isLight ? { color: "#1A2E45" } : null]}>{t("alert.alert_offset")}</Text>
              </View>

              <View style={styles.rightLabelWrap}>
                <Text style={[styles.rightLabelText, isLight ? { color: "#4E647C" } : null]}>
                  {minutesBeforeValue === 0
                    ? t("alert.at_prayer_time")
                    : t("alert.mins_before", { mins: minutesBeforeValue })}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
              </View>
            </Pressable>

            <Pressable style={styles.rowPlain} onPress={onResetToDefault}>
              <View style={styles.rowLeft}>
                <View style={[styles.smallIcon, { backgroundColor: isLight ? "#FFE8EE" : "#4B1F2B" }]}>
                  <Ionicons name="trash" size={18} color="#FF667D" />
                </View>
                <Text style={styles.resetText}>{t("alert.reset_default")}</Text>
              </View>
            </Pressable>
          </View>

          <Pressable style={styles.saveButton} onPress={() => void onSave()} disabled={saving}>
            <Text style={styles.saveButtonText}>
              {saving ? t("settings.saving") : t("alert.save_preferences")}
            </Text>
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
    gap: 12,
    flex: 1,
    minWidth: 0
  },
  switchWrap: {
    width: 58,
    alignItems: "flex-end",
    justifyContent: "center"
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
    width: 28,
    alignItems: "center"
  },
  sliderTouchArea: {
    flex: 1,
    minHeight: 34,
    justifyContent: "center"
  },
  sliderTrack: {
    width: "100%",
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
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
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
