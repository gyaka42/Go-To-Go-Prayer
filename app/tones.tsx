import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import { replanAll } from "@/services/notifications";
import { getSettings, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PRAYER_NAMES, PrayerName, Settings } from "@/types/prayer";

const TONES: Array<"Adhan" | "Beep"> = ["Adhan", "Beep"];

export default function ToneSelectionScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, prayerName } = useI18n();
  const isLight = resolvedTheme === "light";
  const params = useLocalSearchParams<{ prayer?: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingTone, setSavingTone] = useState<string | null>(null);

  const prayer = useMemo<PrayerName | null>(() => {
    const value = Array.isArray(params.prayer) ? params.prayer[0] : params.prayer;
    return value && PRAYER_NAMES.includes(value as PrayerName) ? (value as PrayerName) : null;
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

  const onSelectTone = useCallback(
    async (tone: "Adhan" | "Beep") => {
      if (!settings || !prayer) {
        return;
      }

      if (settings.prayerNotifications[prayer].tone === tone) {
        router.back();
        return;
      }

      setSavingTone(tone);
      try {
        const updated: Settings = {
          ...settings,
          prayerNotifications: {
            ...settings.prayerNotifications,
            [prayer]: {
              ...settings.prayerNotifications[prayer],
              tone
            }
          }
        };

        await saveSettings(updated);
        setSettings(updated);

        try {
          const loc = await resolveLocationForSettings(updated);
          await replanAll({
            lat: loc.lat,
            lon: loc.lon,
            methodId: updated.methodId,
            settings: updated
          });
        } catch {
          // Keep tone save even if replanning fails now.
        }

        router.back();
      } finally {
        setSavingTone(null);
      }
    },
    [prayer, router, settings]
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

  const currentTone = settings?.prayerNotifications[prayer].tone ?? "Beep";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("alert.alert_tone")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t("alert.configure_for", { prayer: prayerName(prayer) })}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          {TONES.map((tone, index) => {
            const selected = currentTone === tone;
            return (
              <Pressable
                key={tone}
                style={[
                  styles.row,
                  index < TONES.length - 1 ? { borderBottomColor: colors.cardBorder, borderBottomWidth: 1 } : null,
                  selected
                    ? isLight
                      ? { backgroundColor: "#DDEEFF" }
                      : { backgroundColor: "#173A5E" }
                    : null
                ]}
                onPress={() => void onSelectTone(tone)}
                disabled={savingTone !== null}
              >
                <Text
                  style={[
                    styles.rowTitle,
                    { color: isLight ? "#1A2E45" : "#EAF2FF" },
                    selected ? { color: "#1E78D9" } : null
                  ]}
                >
                  {tone === "Adhan" ? t("alert.tone_adhan") : t("alert.tone_beep")}
                </Text>

                <View style={styles.rowRight}>
                  {savingTone === tone ? <ActivityIndicator size="small" color="#2B8CEE" /> : null}
                  {selected ? <Ionicons name="checkmark-circle" size={22} color="#2B8CEE" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
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
    justifyContent: "space-between"
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPlaceholder: {
    width: 34,
    height: 34
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 14,
    color: "#8EA4BF"
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1D3349",
    overflow: "hidden"
  },
  row: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  }
});
