import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import {
  getMonthlyCacheSnapshot,
  MonthlyTimingsRow,
  prefetchMonthTimings
} from "@/services/timingsCache";
import { getLatestCachedLocation, getSettings } from "@/services/storage";
import { PrayerName, Settings } from "@/types/prayer";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "idle" | "loading" | "ready" | "error";

const COLUMN_ORDER: Array<{ key: PrayerName; labelKey: string }> = [
  { key: "Fajr", labelKey: "monthly.fajr" },
  { key: "Sunrise", labelKey: "monthly.shoroq" },
  { key: "Dhuhr", labelKey: "monthly.dhuhr" },
  { key: "Asr", labelKey: "monthly.asr" },
  { key: "Maghrib", labelKey: "monthly.maghrib" },
  { key: "Isha", labelKey: "monthly.isha" }
];

function timingsSignature(row: MonthlyTimingsRow): string {
  if (!row.timings) {
    return "missing";
  }
  return COLUMN_ORDER.map((column) => row.timings?.times[column.key] ?? "--").join("|");
}

function shouldForceRefreshSuspiciousCache(rows: MonthlyTimingsRow[]): boolean {
  const withTimings = rows.filter((row) => !!row.timings);
  if (withTimings.length < 7) {
    return false;
  }
  const unique = new Set(withTimings.map(timingsSignature));
  // If almost every day has identical timings, cache is likely polluted/stale.
  return unique.size <= 2;
}

function normalizeMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function monthNameKey(monthIndex: number): string {
  const keys = [
    "months.jan",
    "months.feb",
    "months.mar",
    "months.apr",
    "months.may",
    "months.jun",
    "months.jul",
    "months.aug",
    "months.sep",
    "months.oct",
    "months.nov",
    "months.dec"
  ];
  return keys[monthIndex] ?? "months.jan";
}

interface ResolvedMonthlyContext {
  settings: Settings;
  location: { lat: number; lon: number; label: string };
}

export default function MonthlyScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  const [selectedMonth, setSelectedMonth] = useState<Date>(normalizeMonth(new Date()));
  const [pickerMonth, setPickerMonth] = useState<Date>(normalizeMonth(new Date()));
  const [pickerOpen, setPickerOpen] = useState(false);

  const [rows, setRows] = useState<MonthlyTimingsRow[]>([]);
  const [source, setSource] = useState<"cache" | "network" | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [partialError, setPartialError] = useState(false);

  const loadRequestRef = useRef(0);
  const contextRef = useRef<ResolvedMonthlyContext | null>(null);

  const monthTitle = `${t(monthNameKey(selectedMonth.getMonth()))} ${selectedMonth.getFullYear()}`;

  const todayDate = useMemo(() => new Date(), []);
  const shouldHighlightToday = sameMonth(selectedMonth, todayDate);

  const getContext = useCallback(async (): Promise<ResolvedMonthlyContext> => {
    if (contextRef.current) {
      return contextRef.current;
    }

    const settings = await getSettings();
    const cachedLocation = await getLatestCachedLocation();

    const location =
      settings.locationMode === "manual" && settings.manualLocation
        ? {
            lat: settings.manualLocation.lat,
            lon: settings.manualLocation.lon,
            label: settings.manualLocation.label
          }
        : cachedLocation && cachedLocation.mode === "gps"
          ? {
              lat: cachedLocation.lat,
              lon: cachedLocation.lon,
              label: cachedLocation.label
            }
          : await resolveLocationForSettings(settings);

    const resolved = { settings, location };
    contextRef.current = resolved;
    return resolved;
  }, []);

  const loadMonthly = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      const requestId = ++loadRequestRef.current;
      const isStale = () => requestId !== loadRequestRef.current;

      const forceRefresh = opts?.forceRefresh === true;
      setErrorMessage(null);
      setPartialError(false);

      if (forceRefresh) {
        setIsPrefetching(true);
      } else {
        setLoadState("loading");
      }

      try {
        const ctx = await getContext();
        if (isStale()) {
          return;
        }

        if (forceRefresh) {
          const fetched = await prefetchMonthTimings({
            year: selectedMonth.getFullYear(),
            monthIndex: selectedMonth.getMonth(),
            location: {
              lat: ctx.location.lat,
              lon: ctx.location.lon
            },
            locationLabel: ctx.location.label,
            settings: ctx.settings
          });

          if (isStale()) {
            return;
          }

          const afterForce = await getMonthlyCacheSnapshot({
            month: selectedMonth,
            location: {
              lat: ctx.location.lat,
              lon: ctx.location.lon
            },
            settings: ctx.settings
          });

          if (isStale()) {
            return;
          }

          setRows(afterForce.rows);
          setSource("network");
          setPartialError(Object.keys(fetched).length < afterForce.rows.length);
          setLoadState("ready");
          setIsPrefetching(false);
          return;
        }

        const snapshot = await getMonthlyCacheSnapshot({
          month: selectedMonth,
          location: {
            lat: ctx.location.lat,
            lon: ctx.location.lon
          },
          settings: ctx.settings
        });

        if (isStale()) {
          return;
        }

        setRows(snapshot.rows);
        setSource("cache");
        setLoadState("ready");

        const needsSuspiciousRefresh = shouldForceRefreshSuspiciousCache(snapshot.rows);
        const needsBackgroundFetch = snapshot.missingDates.length > 0 || needsSuspiciousRefresh;

        if (!needsBackgroundFetch) {
          setIsPrefetching(false);
          return;
        }

        setIsPrefetching(true);
        const fetched = await prefetchMonthTimings({
          year: selectedMonth.getFullYear(),
          monthIndex: selectedMonth.getMonth(),
          location: {
            lat: ctx.location.lat,
            lon: ctx.location.lon
          },
          locationLabel: ctx.location.label,
          settings: ctx.settings,
          dates: needsSuspiciousRefresh ? undefined : snapshot.missingDates
        });

        if (isStale()) {
          return;
        }

        const refreshed = await getMonthlyCacheSnapshot({
          month: selectedMonth,
          location: {
            lat: ctx.location.lat,
            lon: ctx.location.lon
          },
          settings: ctx.settings
        });

        if (isStale()) {
          return;
        }

        const hadNetworkRows = Object.keys(fetched).length > 0;
        setRows(refreshed.rows);
        setSource(hadNetworkRows ? "network" : "cache");
        setPartialError(refreshed.missingDates.length > 0);
        setIsPrefetching(false);
      } catch (error) {
        if (isStale()) {
          return;
        }
        setLoadState("error");
        setIsPrefetching(false);
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
      }
    },
    [getContext, selectedMonth]
  );

  useFocusEffect(
    useCallback(() => {
      void loadMonthly();
    }, [loadMonthly])
  );

  const movePickerMonth = (delta: number) => {
    setPickerMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const applyPickerMonth = () => {
    setSelectedMonth(normalizeMonth(pickerMonth));
    setPickerOpen(false);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}> 
      <View style={styles.container}>
        <AppBackground />

        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={[styles.circleButton, isLight ? styles.circleButtonLight : null]}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </Pressable>

          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t("monthly.title")}</Text>

          <Pressable
            onPress={() => {
              setPickerMonth(selectedMonth);
              setPickerOpen(true);
            }}
            hitSlop={8}
            style={[styles.circleButton, isLight ? styles.circleButtonLight : null]}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.subHeaderRow}>
          <Text style={[styles.monthLabel, { color: colors.textPrimary }]}>{monthTitle}</Text>
          <Pressable style={styles.refreshBtn} onPress={() => void loadMonthly({ forceRefresh: true })}>
            <Ionicons name="refresh" size={16} color="#FFFFFF" />
            <Text style={styles.refreshLabel}>{t("monthly.refresh")}</Text>
          </Pressable>
        </View>

        <Text style={[styles.sourceLine, { color: colors.textSecondary }]}>
          {t("monthly.source", { source: source === "network" ? t("mosques.source_network") : t("mosques.source_cache") })}
          {isPrefetching ? ` • ${t("monthly.loading")}` : ""}
        </Text>

        <View style={[styles.tableShell, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}> 
          {loadState === "loading" ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#2B8CEE" size="small" />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{t("monthly.loading")}</Text>
            </View>
          ) : loadState === "error" ? (
            <View style={styles.loadingWrap}>
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{errorMessage ?? t("monthly.loading")}</Text>
              <Pressable style={styles.retryBtn} onPress={() => void loadMonthly()}>
                <Text style={styles.retryLabel}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.tableWrap}>
                  <View style={[styles.tableHeaderRow, { borderBottomColor: colors.cardBorder }]}> 
                    <Text style={[styles.dateHeaderCell, { color: colors.textSecondary }]}> </Text>
                    {COLUMN_ORDER.map((column) => (
                      <Text
                        key={column.key}
                        style={[
                          styles.headerCell,
                          {
                            color: column.key === "Fajr" ? colors.accent : colors.textSecondary,
                            fontWeight: column.key === "Fajr" ? "800" : "700"
                          }
                        ]}
                      >
                        {t(column.labelKey)}
                      </Text>
                    ))}
                  </View>

                  <ScrollView style={styles.rowsScroll} showsVerticalScrollIndicator={false}>
                    {rows.map((row) => {
                      const isToday =
                        shouldHighlightToday &&
                        row.date.getDate() === todayDate.getDate() &&
                        row.date.getMonth() === todayDate.getMonth() &&
                        row.date.getFullYear() === todayDate.getFullYear();

                      return (
                        <View
                          key={row.dateKey}
                          style={[
                            styles.tableDataRow,
                            {
                              borderBottomColor: colors.cardBorder,
                              backgroundColor: isToday ? (isLight ? "#EAF4FF" : "rgba(43,140,238,0.12)") : "transparent"
                            }
                          ]}
                        >
                          <Text style={[styles.dateCell, { color: colors.textPrimary }]}>
                            {`${row.date.getDate()} ${t(monthNameKey(row.date.getMonth()))}`}
                          </Text>
                          {COLUMN_ORDER.map((column) => (
                            <Text key={`${row.dateKey}-${column.key}`} style={[styles.timeCell, { color: colors.textPrimary }]}>
                              {row.timings?.times[column.key] ?? "—"}
                            </Text>
                          ))}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              </ScrollView>

              {partialError ? (
                <Text style={[styles.partialError, { color: colors.textSecondary }]}>{t("monthly.partialError")}</Text>
              ) : null}
            </>
          )}
        </View>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}> 
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t("monthly.pickMonth")}</Text>
            <Text style={[styles.modalMonthLabel, { color: colors.textPrimary }]}>
              {t(monthNameKey(pickerMonth.getMonth()))} {pickerMonth.getFullYear()}
            </Text>

            <View style={styles.modalRow}>
              <Pressable style={[styles.modalButton, styles.modalHalf]} onPress={() => movePickerMonth(-1)}>
                <Text style={styles.modalButtonLabel}>{t("monthly.prevMonth")}</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalHalf]} onPress={() => movePickerMonth(1)}>
                <Text style={styles.modalButtonLabel}>{t("monthly.nextMonth")}</Text>
              </Pressable>
            </View>

            <View style={styles.modalRow}>
              <Pressable style={[styles.modalButton, styles.modalHalf, styles.modalGhost]} onPress={() => setPickerOpen(false)}>
                <Text style={[styles.modalButtonLabel, styles.modalGhostLabel]}>{t("monthly.close")}</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalHalf]} onPress={applyPickerMonth}>
                <Text style={styles.modalButtonLabel}>{t("monthly.apply")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  subHeaderRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  monthLabel: {
    fontSize: 20,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  refreshBtn: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: "#2B8CEE",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6
  },
  refreshLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700"
  },
  circleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,44,68,0.9)",
    borderWidth: 1,
    borderColor: "rgba(77,117,153,0.35)"
  },
  circleButtonLight: {
    backgroundColor: "#EAF2FC",
    borderColor: "#BFD4EA"
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800"
  },
  sourceLine: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 13,
    fontWeight: "600"
  },
  tableShell: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden"
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20
  },
  loadingText: {
    fontSize: 15,
    textAlign: "center"
  },
  retryBtn: {
    marginTop: 4,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#2B8CEE",
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  retryLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  },
  tableWrap: {
    minWidth: 720,
    flex: 1
  },
  tableHeaderRow: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 8
  },
  tableDataRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 8
  },
  rowsScroll: {
    flex: 1
  },
  dateHeaderCell: {
    width: 92,
    fontSize: 15,
    fontWeight: "700"
  },
  dateCell: {
    width: 92,
    fontSize: 15,
    fontWeight: "700"
  },
  headerCell: {
    width: 104,
    fontSize: 15,
    fontWeight: "700"
  },
  timeCell: {
    width: 104,
    fontSize: 17,
    fontWeight: "600"
  },
  partialError: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: "600"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24
  },
  modalCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800"
  },
  modalMonthLabel: {
    fontSize: 18,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  modalRow: {
    flexDirection: "row",
    gap: 10
  },
  modalButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  modalHalf: {
    flex: 1
  },
  modalButtonLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  },
  modalGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#9FB6CC"
  },
  modalGhostLabel: {
    color: "#46617D"
  }
});
