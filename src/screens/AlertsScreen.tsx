import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EaseView } from "react-native-ease";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { easeEnterTransition, easeInitialLift, easePressTransition, easeVisibleLift } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import { getPrayerNotificationScheduleSummary, PrayerNotificationScheduleSummary, registerForLocalNotifications, replanAll } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

type AlertsScreenProps = {
  showBackButton?: boolean;
};
type PermissionState = "unknown" | "granted" | "needed";

export default function AlertsScreen({ showBackButton = false }: AlertsScreenProps) {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, prayerName } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pressedPrayer, setPressedPrayer] = useState<PrayerName | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>("unknown");
  const [scheduleSummary, setScheduleSummary] = useState<PrayerNotificationScheduleSummary | null>(null);
  const [checkingSchedule, setCheckingSchedule] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const showFeedback = useCallback((label: string, delayMs = 1800) => {
    clearFeedbackTimer();
    setFeedback(label);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, delayMs);
  }, [clearFeedbackTimer]);

  useEffect(() => {
    return () => {
      clearFeedbackTimer();
    };
  }, [clearFeedbackTimer]);

  const refreshScheduleSummary = useCallback(async () => {
    const summary = await getPrayerNotificationScheduleSummary().catch(() => null);
    setScheduleSummary(summary);
    return summary;
  }, []);

  const load = useCallback(async () => {
    const [saved, permissions, summary] = await Promise.all([
      getSettings(),
      Notifications.getPermissionsAsync().catch(() => null),
      getPrayerNotificationScheduleSummary().catch(() => null)
    ]);
    setSettings(saved);
    setScheduleSummary(summary);
    setPermissionState(
      permissions?.granted || permissions?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
        ? "granted"
        : "needed"
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const activeCount = useMemo(() => {
    if (!settings) {
      return 0;
    }
    return PRAYER_NAMES.filter((prayer) => settings.prayerNotifications[prayer]?.enabled).length;
  }, [settings]);

  const replanWithSettings = useCallback(
    async (nextSettings: Settings) => {
      try {
        const permissions = await Notifications.getPermissionsAsync();
        const canSchedule =
          permissions.granted || permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
        setPermissionState(canSchedule ? "granted" : "needed");

        if (!canSchedule) {
          showFeedback(t("alerts.inline_saved_replan_later"), 2800);
          return;
        }

        const loc = await resolveLocationForSettings(nextSettings);
        await replanAll({
          lat: loc.lat,
          lon: loc.lon,
          methodId: nextSettings.methodId,
          settings: nextSettings
        });
        await refreshScheduleSummary();
        showFeedback(t("alerts.inline_replanned"));
      } catch {
        showFeedback(t("alerts.inline_saved_replan_later"), 2800);
      }
    },
    [refreshScheduleSummary, showFeedback, t]
  );

  const ensureNotificationPermission = useCallback(async () => {
    const granted = await registerForLocalNotifications();
    setPermissionState(granted ? "granted" : "needed");
    if (!granted) {
      showFeedback(t("alerts.permission_needed"), 2800);
    }
    return granted;
  }, [showFeedback, t]);

  const togglePrayer = useCallback(async (prayer: PrayerName, enabled: boolean) => {
    if (!settings) {
      return;
    }
    if (enabled) {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        return;
      }
    }

    const next: Settings = {
      ...settings,
      prayerNotifications: {
        ...settings.prayerNotifications,
        [prayer]: {
          ...settings.prayerNotifications[prayer],
          enabled
        }
      }
    };

    setSettings(next);
    await saveSettings(next);
    showFeedback(t("alerts.inline_updated", { prayer: prayerName(prayer) }));
    await replanWithSettings(next);
  }, [ensureNotificationPermission, prayerName, replanWithSettings, settings, showFeedback, t]);

  const enableNotifications = useCallback(async () => {
    if (!settings) {
      return;
    }
    const granted = await ensureNotificationPermission();
    if (granted) {
      await replanWithSettings(settings);
    }
  }, [ensureNotificationPermission, replanWithSettings, settings]);

  const checkSchedule = useCallback(async () => {
    if (!settings || checkingSchedule) {
      return;
    }

    setCheckingSchedule(true);
    try {
      const granted = await ensureNotificationPermission();
      if (granted) {
        await replanWithSettings(settings);
      } else {
        await refreshScheduleSummary();
      }
    } finally {
      setCheckingSchedule(false);
    }
  }, [checkingSchedule, ensureNotificationPermission, refreshScheduleSummary, replanWithSettings, settings]);

  const notificationMeta = useCallback(
    (prayer: PrayerName) => {
      const item = settings?.prayerNotifications[prayer];
      if (!item) {
        return t("alerts.loading");
      }
      const timing =
        item.minutesBefore === 0 ? t("alert.at_prayer_time") : t("alerts.mins_before", { mins: item.minutesBefore });
      const sound = item.playSound ? t("alerts.sound_on") : t("alerts.sound_off");
      return `${timing} • ${sound}`;
    },
    [settings, t]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        {showBackButton ? (
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => router.back()}
                hitSlop={8}
                style={[styles.backButton, isLight ? styles.backButtonLight : null]}
              >
                <Ionicons name="chevron-back" size={20} color={isLight ? "#5B7490" : "#B7C7DD"} />
              </Pressable>
            </View>
          </EaseView>
        ) : null}
        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("alerts.title")}</Text>
        </EaseView>
        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t("alerts.subtitle")}
          </Text>
        </EaseView>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <View style={styles.feedbackWrap}>
            <StatusChip label={feedback ?? ""} tone="success" visible={Boolean(feedback)} />
            <StatusChip label={t("alerts.loading")} tone="loading" visible={!settings} />
          </View>
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.summaryTopRow}>
                <View style={styles.summaryLeft}>
                  <View style={[styles.iconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
                    <Ionicons name="shield-checkmark" size={18} color="#2B8CEE" />
                  </View>
                  <View>
                    <Text style={[styles.summaryTitle, { color: colors.textPrimary }]}>
                      {t("alerts.summary_title")}
                    </Text>
                    <Text style={[styles.summaryBody, { color: colors.textSecondary }]}>
                      {t("alerts.active_summary", { active: activeCount, total: PRAYER_NAMES.length })}
                    </Text>
                    <Text style={[styles.summaryBody, { color: colors.textSecondary }]}>
                      {scheduleSummary
                        ? t("alerts.scheduled_summary", { scheduled: scheduleSummary.total })
                        : t("alerts.schedule_checking")}
                    </Text>
                  </View>
                </View>
                <StatusChip
                  label={
                    permissionState === "granted"
                      ? t("alerts.permission_ready")
                      : permissionState === "needed"
                        ? t("alerts.permission_needed")
                        : t("alerts.loading")
                  }
                  tone={permissionState === "granted" ? "success" : permissionState === "needed" ? "warning" : "loading"}
                />
              </View>
              {permissionState === "needed" ? (
                <Pressable style={styles.summaryButton} onPress={() => void enableNotifications()}>
                  <Ionicons name="notifications" size={16} color="#F2F8FF" />
                  <Text style={styles.summaryButtonText}>{t("alerts.enable_notifications")}</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.summaryButton} onPress={() => void checkSchedule()}>
                  <Ionicons name="refresh" size={16} color="#F2F8FF" />
                  <Text style={styles.summaryButtonText}>
                    {checkingSchedule ? t("alerts.checking_schedule") : t("alerts.check_schedule")}
                  </Text>
                </Pressable>
              )}
            </View>
          </EaseView>
          {PRAYER_NAMES.map((prayer) => {
            const item = settings?.prayerNotifications[prayer];
            return (
              <EaseView
                key={prayer}
                animate={{ scale: pressedPrayer === prayer ? 0.985 : 1 }}
                transition={pressTransition}
              >
                <Pressable
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                  onPress={() => router.push(`/alert/${prayer}`)}
                  onPressIn={() => setPressedPrayer(prayer)}
                  onPressOut={() => setPressedPrayer(null)}
                >
                  <View style={styles.left}>
                    <View
                      style={[
                        styles.iconWrap,
                        isLight ? { backgroundColor: "#EAF2FC" } : null
                      ]}
                    >
                      <Ionicons name="notifications" size={18} color="#2B8CEE" />
                    </View>
                    <View>
                      <Text style={[styles.prayer, isLight ? { color: "#1A2E45" } : null]}>{prayerName(prayer)}</Text>
                      <Text style={[styles.meta, isLight ? { color: "#4E647C" } : null]}>
                        {notificationMeta(prayer)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.right}>
                    <Switch
                      value={item?.enabled ?? false}
                      onValueChange={(value) => void togglePrayer(prayer, value)}
                    />
                    <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
                  </View>
                </Pressable>
              </EaseView>
            );
          })}
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
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4
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
    marginTop: 6,
    marginBottom: 14,
    fontSize: 14,
    color: "#8EA4BF"
  },
  list: {
    gap: 12,
    paddingBottom: 32
  },
  feedbackWrap: {
    minHeight: 32,
    marginBottom: 4
  },
  summaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap"
  },
  summaryLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 190
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "800"
  },
  summaryBody: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18
  },
  summaryButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#2B8CEE",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  summaryButtonText: {
    color: "#F2F8FF",
    fontSize: 15,
    fontWeight: "800"
  },
  row: {
    minHeight: 84,
    borderRadius: 16,
    backgroundColor: "#162638",
    borderWidth: 1,
    borderColor: "#1D3349",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  prayer: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ECF3FF"
  },
  meta: {
    marginTop: 2,
    fontSize: 13,
    color: "#8FA2BC"
  }
});
