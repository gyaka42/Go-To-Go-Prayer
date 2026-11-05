import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { RamadanScreenHeader } from "@/ramadan/components/RamadanScreenHeader";
import { resolveRamadanLocation } from "@/ramadan/timings";
import { replanAll } from "@/services/notifications";
import { getRamadanState, getSettings, RamadanState, saveRamadanState } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

export default function RamadanSettingsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const [state, setState] = useState<RamadanState | null>(null);
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);

  const load = useCallback(async () => {
    const [saved, settings] = await Promise.all([getRamadanState(), getSettings()]);
    setState(saved);
    const resolved = await resolveRamadanLocation(settings);
    setLocation(resolved ? { lat: resolved.lat, lon: resolved.lon } : null);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const changeCorrection = useCallback(async (correction: -1 | 0 | 1) => {
    if (!state || correction === state.dateCorrection) return;
    const next = { ...state, dateCorrection: correction, updatedAt: Date.now() };
    setState(next);
    await saveRamadanState(next);
    if (!location) return;
    const settings = await getSettings();
    await replanAll({ lat: location.lat, lon: location.lon, methodId: settings.methodId, settings });
  }, [location, state]);

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
          title={t("ramadan.settings_title")}
          subtitle={t("ramadan.settings_subtitle")}
          backLabel={t("ramadan.back")}
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("ramadan.date_correction")}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("ramadan.date_correction_help")}</Text>
            <View style={styles.controls}>
              {([-1, 0, 1] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: state.dateCorrection === value }}
                  style={[
                    styles.button,
                    { borderColor: colors.cardBorder },
                    state.dateCorrection === value && { backgroundColor: colors.accent, borderColor: colors.accent }
                  ]}
                  onPress={() => void changeCorrection(value)}
                >
                  <Text style={[styles.buttonText, { color: state.dateCorrection === value ? "#FFFFFF" : colors.textPrimary }]}>
                    {value > 0 ? `+${value}` : value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>{t("ramadan.local_announcement")}</Text>
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
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  title: { fontSize: 19, fontWeight: "900" },
  subtitle: { marginTop: 5, fontSize: 14, lineHeight: 20 },
  controls: { marginTop: 18, flexDirection: "row", gap: 10 },
  button: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 17, fontWeight: "900" },
  disclaimer: { marginTop: 18, fontSize: 13, lineHeight: 20 }
});
