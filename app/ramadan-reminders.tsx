import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { RamadanScreenHeader } from "@/ramadan/components/RamadanScreenHeader";
import { resolveRamadanLocation } from "@/ramadan/timings";
import {
  getRamadanNotificationScheduleSummary,
  registerForLocalNotifications,
  replanAll,
  scheduleRamadanTestNotification
} from "@/services/notifications";
import {
  getRamadanState,
  getSettings,
  RamadanNotificationSettings,
  RamadanReminderMinutes,
  RamadanState,
  saveRamadanState
} from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

export default function RamadanRemindersScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const [state, setState] = useState<RamadanState | null>(null);
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; label: string } | null>(null);

  const load = useCallback(async () => {
    const [saved, settings] = await Promise.all([getRamadanState(), getSettings()]);
    setState(saved);
    const resolved = await resolveRamadanLocation(settings);
    setLocation(resolved ? { lat: resolved.lat, lon: resolved.lon } : null);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const persist = useCallback(async (next: RamadanState) => {
    setState(next);
    await saveRamadanState(next);
    if (!location) return;
    const settings = await getSettings();
    await replanAll({ lat: location.lat, lon: location.lon, methodId: settings.methodId, settings });
  }, [location]);

  const updateNotifications = useCallback(async (patch: Partial<RamadanNotificationSettings>) => {
    if (!state || saving) return;
    const nextNotifications = { ...state.notifications, ...patch };
    const enabling =
      (nextNotifications.imsakEnabled || nextNotifications.iftarEnabled) &&
      !state.notifications.imsakEnabled &&
      !state.notifications.iftarEnabled;
    setSaving(true);
    setStatus(null);
    try {
      if (enabling) {
        const granted = await registerForLocalNotifications();
        if (!granted) {
          setStatus({ tone: "error", label: t("ramadan.notifications_permission_denied") });
          return;
        }
      }
      const next = { ...state, notifications: nextNotifications, updatedAt: Date.now() };
      await persist(next);
      const summary = await getRamadanNotificationScheduleSummary().catch(() => null);
      setStatus({
        tone: "success",
        label: summary?.total
          ? t("ramadan.notifications_scheduled", { count: summary.total })
          : t("ramadan.notifications_saved")
      });
    } catch {
      setStatus({ tone: "error", label: t("ramadan.notifications_save_error") });
    } finally {
      setSaving(false);
    }
  }, [persist, saving, state, t]);

  const sendTest = useCallback(async () => {
    if (!state || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const scheduled = await scheduleRamadanTestNotification(state.notifications);
      setStatus({
        tone: scheduled ? "success" : "error",
        label: scheduled
          ? t("ramadan.notifications_test_sent")
          : t("ramadan.notifications_permission_denied")
      });
    } catch {
      setStatus({ tone: "error", label: t("ramadan.notifications_save_error") });
    } finally {
      setSaving(false);
    }
  }, [saving, state, t]);

  if (!state) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.root}>
        <AppBackground />
        <RamadanScreenHeader
          title={t("ramadan.notifications_section")}
          subtitle={t("ramadan.notifications_help")}
          backLabel={t("ramadan.back")}
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {(["imsak", "iftar"] as const).map((event, index) => {
              const enabledKey = event === "imsak" ? "imsakEnabled" : "iftarEnabled";
              const minutesKey = event === "imsak" ? "imsakMinutesBefore" : "iftarMinutesBefore";
              const enabled = state.notifications[enabledKey];
              const minutes = state.notifications[minutesKey];
              return (
                <View key={event} style={[styles.event, index > 0 && { borderTopColor: colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={styles.eventHeader}>
                    <View style={styles.eventText}>
                      <Text style={[styles.title, { color: colors.textPrimary }]}>{t(`ramadan.${event}_reminder`)}</Text>
                      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("ramadan.minutes_before", { mins: minutes })}</Text>
                    </View>
                    <Switch
                      value={enabled}
                      disabled={saving}
                      onValueChange={(value) => void updateNotifications({ [enabledKey]: value })}
                      trackColor={{ false: colors.cardBorder, true: colors.accent }}
                    />
                  </View>
                  {enabled ? (
                    <View style={styles.minutes}>
                      {([5, 10, 15, 30, 60] as RamadanReminderMinutes[]).map((value) => (
                        <Pressable
                          key={value}
                          disabled={saving}
                          style={[
                            styles.minuteButton,
                            { borderColor: colors.cardBorder },
                            minutes === value && { backgroundColor: colors.accent, borderColor: colors.accent }
                          ]}
                          onPress={() => void updateNotifications({ [minutesKey]: value })}
                        >
                          <Text style={[styles.minuteText, { color: minutes === value ? "#FFFFFF" : colors.textPrimary }]}>{value}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            <View style={[styles.preferences, { borderTopColor: colors.cardBorder }]}>
              <View style={styles.preferenceRow}>
                <Text style={[styles.preferenceLabel, { color: colors.textPrimary }]}>{t("ramadan.notification_sound")}</Text>
                <Switch
                  value={state.notifications.playSound}
                  disabled={saving}
                  onValueChange={(value) => void updateNotifications({ playSound: value })}
                  trackColor={{ false: colors.cardBorder, true: colors.accent }}
                />
              </View>
              <View style={styles.preferenceRow}>
                <Text style={[styles.preferenceLabel, { color: colors.textPrimary }]}>{t("ramadan.notification_vibration")}</Text>
                <Switch
                  value={state.notifications.vibration}
                  disabled={saving}
                  onValueChange={(value) => void updateNotifications({ vibration: value })}
                  trackColor={{ false: colors.cardBorder, true: colors.accent }}
                />
              </View>
            </View>
            <Pressable
              disabled={saving}
              style={[styles.testButton, { backgroundColor: colors.accent }, saving && { opacity: 0.6 }]}
              onPress={() => void sendTest()}
            >
              <Ionicons name="notifications-outline" size={18} color="#FFFFFF" />
              <Text style={styles.testText}>{t("ramadan.notifications_test")}</Text>
            </Pressable>
            {status ? (
              <View style={styles.status}><StatusChip visible tone={status.tone} label={status.label} /></View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingBottom: 32 },
  card: { borderRadius: 20, borderWidth: 1, padding: 16 },
  event: { paddingVertical: 14 },
  eventHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  eventText: { flex: 1 },
  title: { fontSize: 17, fontWeight: "800" },
  subtitle: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  minutes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  minuteButton: { minWidth: 48, minHeight: 42, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  minuteText: { fontSize: 14, fontWeight: "800" },
  preferences: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  preferenceRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  preferenceLabel: { flex: 1, fontSize: 16, fontWeight: "700" },
  testButton: { minHeight: 52, marginTop: 12, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16 },
  testText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  status: { marginTop: 12 }
});
