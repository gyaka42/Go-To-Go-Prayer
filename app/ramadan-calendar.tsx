import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { getRamadanDayNumber, getRamadanRange, localDateKey } from "@/ramadan/calendar";
import { RamadanCalendarTable } from "@/ramadan/components/RamadanCalendarTable";
import { RamadanScreenHeader } from "@/ramadan/components/RamadanScreenHeader";
import { RamadanStatusModal } from "@/ramadan/components/RamadanStatusModal";
import { loadRamadanTimingRows, RamadanTimingRow } from "@/ramadan/timings";
import {
  getRamadanState,
  getSettings,
  RamadanFastStatus,
  RamadanState,
  saveRamadanState
} from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "loading" | "ready" | "error";

export default function RamadanCalendarScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t, localeTag } = useI18n();
  const [state, setState] = useState<RamadanState | null>(null);
  const [rows, setRows] = useState<RamadanTimingRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedDay, setSelectedDay] = useState<RamadanTimingRow | null>(null);

  const range = useMemo(
    () => (state ? getRamadanRange(new Date(), state.dateCorrection) : null),
    [state]
  );
  const displayDate = new Date();
  const currentDay = range ? getRamadanDayNumber(displayDate, range) : null;
  const effectiveEntries = state?.days ?? {};

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const [saved, settings] = await Promise.all([getRamadanState(), getSettings()]);
      const nextRange = getRamadanRange(new Date(), saved.dateCorrection);
      setState(saved);
      if (!nextRange) throw new Error("range");
      const result = await loadRamadanTimingRows({ range: nextRange, settings });
      setRows(result.rows);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const formatDate = useCallback((date: Date) => {
    try {
      return new Intl.DateTimeFormat(localeTag, { weekday: "short", day: "numeric", month: "short" }).format(date);
    } catch {
      return `${date.getDate()}-${date.getMonth() + 1}`;
    }
  }, [localeTag]);

  const setDayStatus = useCallback(async (dateKey: string, status: RamadanFastStatus | null) => {
    if (!state) return;
    const days = { ...state.days };
    if (status) days[dateKey] = { status, updatedAt: Date.now() };
    else delete days[dateKey];
    const next = { ...state, days, updatedAt: Date.now() };
    setState(next);
    await saveRamadanState(next);
    setSelectedDay(null);
  }, [state]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.root}>
        <AppBackground />
        <RamadanScreenHeader
          title={t("ramadan.calendar_full_title")}
          subtitle={t("ramadan.calendar_full_subtitle")}
          backLabel={t("ramadan.back")}
          onBack={() => router.back()}
        />
        {loadState === "loading" ? (
          <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
        ) : loadState === "error" || !range ? (
          <View style={styles.centered}>
            <StatusChip visible tone="error" label={t("ramadan.load_error")} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.metaRow}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {range.days.length} {t("ramadan.days")}
              </Text>
            </View>
            <RamadanCalendarTable
              rows={rows}
              rangeStart={range.start}
              currentDay={currentDay}
              entries={effectiveEntries}
              formatDate={formatDate}
              onSelect={setSelectedDay}
              disabledAfterDate={displayDate}
            />
          </ScrollView>
        )}
      </View>
      {range ? (
        <RamadanStatusModal
          selectedDay={selectedDay}
          range={range}
          entries={effectiveEntries}
          formatDate={formatDate}
          onSelect={setDayStatus}
          onClose={() => setSelectedDay(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingBottom: 32 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  meta: { fontSize: 13, fontWeight: "700" }
});
