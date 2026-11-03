import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import {
  formatCountdown,
  getRamadanDayNumber,
  getRamadanRange,
  localDateKey,
  RamadanRange,
  timeOnDate
} from "@/ramadan/calendar";
import { useRamadanPreview } from "@/ramadan/RamadanPreviewProvider";
import { resolveLocationForSettings } from "@/services/location";
import {
  getRamadanNotificationScheduleSummary,
  registerForLocalNotifications,
  replanAll,
  scheduleRamadanTestNotification
} from "@/services/notifications";
import {
  getRamadanState,
  getSettings,
  getLatestCachedLocation,
  RamadanDayEntry,
  RamadanDailyPlanEntry,
  RamadanDailyPlanKey,
  RamadanFastStatus,
  RamadanNotificationSettings,
  RamadanReminderMinutes,
  RamadanState,
  saveLatestCachedLocation,
  saveRamadanState
} from "@/services/storage";
import { getMonthlyCacheSnapshot, prefetchMonthTimings } from "@/services/timingsCache";
import { Timings } from "@/types/prayer";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "idle" | "loading" | "ready" | "error";
type RamadanTimingRow = {
  date: Date;
  dateKey: string;
  timings: Timings | null;
  source: "cache" | "network" | "missing";
};

function dateAtStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isAfterDay(a: Date, b: Date): boolean {
  return dateAtStart(a).getTime() > dateAtStart(b).getTime();
}

function uniqueMonths(range: RamadanRange): Date[] {
  const months = new Map<string, Date>();
  for (const day of range.days) {
    const key = `${day.getFullYear()}-${day.getMonth()}`;
    if (!months.has(key)) {
      months.set(key, new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }
  return Array.from(months.values());
}

function statusIcon(status: RamadanFastStatus | undefined): keyof typeof Ionicons.glyphMap {
  if (status === "fasted") return "checkmark-circle";
  if (status === "make_up_later") return "time";
  if (status === "excused") return "heart";
  if (status === "made_up") return "checkmark-done-circle";
  return "ellipse-outline";
}

export default function RamadanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const { previewDay, setPreviewDay } = useRamadanPreview();
  const isLight = resolvedTheme === "light";
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });

  const [state, setState] = useState<RamadanState | null>(null);
  const [rows, setRows] = useState<RamadanTimingRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<RamadanTimingRow | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<{
    tone: "success" | "error";
    label: string;
  } | null>(null);
  const [previewUnlocked, setPreviewUnlocked] = useState(false);
  const [previewFastEntries, setPreviewFastEntries] = useState<Record<string, RamadanDayEntry>>({});
  const [previewDailyPlans, setPreviewDailyPlans] = useState<Record<string, RamadanDailyPlanEntry>>({});

  const range = useMemo(
    () => (state ? getRamadanRange(now, state.dateCorrection) : null),
    [now, state]
  );
  const displayNow = useMemo(() => {
    if (!previewDay || !range) return now;
    const simulatedDate = range.days[Math.min(previewDay - 1, range.days.length - 1)];
    return new Date(
      simulatedDate.getFullYear(),
      simulatedDate.getMonth(),
      simulatedDate.getDate(),
      12,
      0,
      0,
      0
    );
  }, [now, previewDay, range]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (previewDay !== null) {
      setPreviewUnlocked(true);
    }
  }, [previewDay]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getRamadanState().then((saved) => {
        if (active) setState(saved);
      });
      return () => {
        active = false;
      };
    }, [])
  );

  const loadTimings = useCallback(async (targetRange: RamadanRange) => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const settings = await getSettings();
      let location: { lat: number; lon: number; label: string };
      if (settings.locationMode === "manual" && settings.manualLocation) {
        location = {
          lat: settings.manualLocation.lat,
          lon: settings.manualLocation.lon,
          label: settings.manualLocation.label
        };
      } else {
        try {
          location = await resolveLocationForSettings(settings);
          await saveLatestCachedLocation({
            ...location,
            mode: "gps",
            updatedAt: new Date().toISOString()
          });
        } catch {
          const cached = await getLatestCachedLocation();
          if (!cached) throw new Error(t("ramadan.location_error"));
          location = { lat: cached.lat, lon: cached.lon, label: cached.label };
        }
      }

      setLocationLabel(location.label);
      setResolvedLocation({ lat: location.lat, lon: location.lon });
      const combined = new Map<string, RamadanTimingRow>();
      for (const month of uniqueMonths(targetRange)) {
        let snapshot = await getMonthlyCacheSnapshot({ month, location, settings });
        let fetchedKeys = new Set<string>();
        if (snapshot.missingDates.length > 0) {
          const fetched = await prefetchMonthTimings({
            year: month.getFullYear(),
            monthIndex: month.getMonth(),
            location,
            locationLabel: location.label,
            settings
          });
          fetchedKeys = new Set(Object.keys(fetched));
          snapshot = await getMonthlyCacheSnapshot({ month, location, settings });
        }
        for (const row of snapshot.rows) {
          combined.set(row.dateKey, {
            date: row.date,
            dateKey: row.dateKey,
            timings: row.timings,
            source: fetchedKeys.has(row.dateKey) ? "network" : row.source
          });
        }
      }

      const ramadanRows = targetRange.days.map((date) => {
        const dateKey = localDateKey(date);
        return (
          combined.get(dateKey) ?? {
            date,
            dateKey,
            timings: null,
            source: "missing" as const
          }
        );
      });
      setRows(ramadanRows);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : t("ramadan.load_error"));
    }
  }, [t]);

  useEffect(() => {
    if (!range) return;
    void loadTimings(range);
  }, [loadTimings, range?.hijriYear, range?.start.getTime()]);

  const todayKey = localDateKey(displayNow);
  const currentDay = range ? getRamadanDayNumber(displayNow, range) : null;
  const todayRow = rows.find((row) => row.dateKey === todayKey) ?? null;
  const isUpcoming = Boolean(range && dateAtStart(displayNow) < dateAtStart(range.start));
  const isFinished = Boolean(range && dateAtStart(displayNow) > dateAtStart(range.end));
  const displayRow = currentDay
    ? todayRow
    : isUpcoming
      ? rows[0] ?? null
      : rows[rows.length - 1] ?? null;

  const nextMoment = useMemo(() => {
    if (!range) return null;
    if (isUpcoming) {
      return {
        label: t("ramadan.until_start"),
        value: formatCountdown(dateAtStart(range.start).getTime() - displayNow.getTime())
      };
    }
    if (isFinished) {
      return { label: t("ramadan.completed"), value: t("ramadan.completed_short") };
    }
    if (!todayRow?.timings) return null;
    const imsak = timeOnDate(displayNow, todayRow.timings.times.Fajr);
    const iftar = timeOnDate(displayNow, todayRow.timings.times.Maghrib);
    if (imsak && displayNow < imsak) {
      return { label: t("ramadan.until_imsak"), value: formatCountdown(imsak.getTime() - displayNow.getTime()) };
    }
    if (iftar && displayNow < iftar) {
      return { label: t("ramadan.until_iftar"), value: formatCountdown(iftar.getTime() - displayNow.getTime()) };
    }
    const tomorrow = rows.find((row) => row.date.getTime() > todayRow.date.getTime() && row.timings);
    const tomorrowImsak = tomorrow?.timings ? timeOnDate(tomorrow.date, tomorrow.timings.times.Fajr) : null;
    return tomorrowImsak
      ? { label: t("ramadan.until_tomorrow_imsak"), value: formatCountdown(tomorrowImsak.getTime() - displayNow.getTime()) }
      : { label: t("ramadan.completed"), value: t("ramadan.completed_short") };
  }, [displayNow, isFinished, isUpcoming, range, rows, t, todayRow]);

  const effectiveFastEntries = previewDay ? previewFastEntries : (state?.days ?? {});
  const effectiveDailyPlans = previewDay ? previewDailyPlans : (state?.dailyPlans ?? {});

  const summary = useMemo(() => {
    const validKeys = new Set(range?.days.map(localDateKey) ?? []);
    return Object.entries(effectiveFastEntries).reduce(
      (acc, [key, entry]) => {
        if (!validKeys.has(key)) return acc;
        if (entry.status === "fasted") acc.fasted += 1;
        if (entry.status === "make_up_later") acc.makeUp += 1;
        if (entry.status === "excused") acc.excused += 1;
        if (entry.status === "made_up") acc.madeUp += 1;
        return acc;
      },
      { fasted: 0, makeUp: 0, excused: 0, madeUp: 0 }
    );
  }, [effectiveFastEntries, range]);

  const dailyPlanKeys: RamadanDailyPlanKey[] = ["quran", "zikr", "dua", "charity"];
  const todayPlan = effectiveDailyPlans[todayKey] ?? null;
  const dailyPlanCompleted = dailyPlanKeys.filter((key) => todayPlan?.[key]).length;

  const missingTimingCount = useMemo(
    () => rows.filter((row) => !row.timings).length,
    [rows]
  );

  const updateState = useCallback(async (next: RamadanState) => {
    setState(next);
    await saveRamadanState(next);
  }, []);

  const replanForRamadanState = useCallback(async (next: RamadanState) => {
    await updateState(next);
    if (!resolvedLocation) return;
    const settings = await getSettings();
    await replanAll({
      lat: resolvedLocation.lat,
      lon: resolvedLocation.lon,
      methodId: settings.methodId,
      settings
    });
  }, [resolvedLocation, updateState]);

  const changeCorrection = useCallback((correction: -1 | 0 | 1) => {
    if (!state || correction === state.dateCorrection) return;
    void replanForRamadanState({ ...state, dateCorrection: correction, updatedAt: Date.now() });
  }, [replanForRamadanState, state]);

  const updateNotificationSettings = useCallback(async (
    patch: Partial<RamadanNotificationSettings>
  ) => {
    if (!state || savingNotifications) return;
    const nextNotifications = { ...state.notifications, ...patch };
    const enabling =
      (nextNotifications.imsakEnabled || nextNotifications.iftarEnabled) &&
      !state.notifications.imsakEnabled &&
      !state.notifications.iftarEnabled;
    setSavingNotifications(true);
    setNotificationStatus(null);
    try {
      if (enabling) {
        const granted = await registerForLocalNotifications();
        if (!granted) {
          setNotificationStatus({ tone: "error", label: t("ramadan.notifications_permission_denied") });
          return;
        }
      }
      const next = { ...state, notifications: nextNotifications, updatedAt: Date.now() };
      await replanForRamadanState(next);
      const summary = await getRamadanNotificationScheduleSummary().catch(() => null);
      setNotificationStatus({
        tone: "success",
        label: summary?.total
          ? t("ramadan.notifications_scheduled", { count: summary.total })
          : t("ramadan.notifications_saved")
      });
    } catch {
      setNotificationStatus({ tone: "error", label: t("ramadan.notifications_save_error") });
    } finally {
      setSavingNotifications(false);
    }
  }, [replanForRamadanState, savingNotifications, state, t]);

  const sendTestNotification = useCallback(async () => {
    if (!state || savingNotifications) return;
    setSavingNotifications(true);
    setNotificationStatus(null);
    try {
      const scheduled = await scheduleRamadanTestNotification(state.notifications);
      setNotificationStatus({
        tone: scheduled ? "success" : "error",
        label: scheduled
          ? t("ramadan.notifications_test_sent")
          : t("ramadan.notifications_permission_denied")
      });
    } catch {
      setNotificationStatus({ tone: "error", label: t("ramadan.notifications_save_error") });
    } finally {
      setSavingNotifications(false);
    }
  }, [savingNotifications, state, t]);

  const setDayStatus = useCallback((dateKey: string, status: RamadanFastStatus | null) => {
    if (!state) return;
    if (previewDay) {
      setPreviewFastEntries((current) => {
        const next = { ...current };
        if (status) {
          next[dateKey] = { status, updatedAt: Date.now() };
        } else {
          delete next[dateKey];
        }
        return next;
      });
      setSelectedDay(null);
      return;
    }
    const days = { ...state.days };
    if (status) {
      days[dateKey] = { status, updatedAt: Date.now() };
    } else {
      delete days[dateKey];
    }
    void updateState({ ...state, days, updatedAt: Date.now() });
    setSelectedDay(null);
  }, [previewDay, state, updateState]);

  const toggleDailyPlanItem = useCallback((key: RamadanDailyPlanKey) => {
    if (!state || !currentDay) return;
    if (previewDay) {
      setPreviewDailyPlans((current) => {
        const previous = current[todayKey] ?? {
          quran: false,
          zikr: false,
          dua: false,
          charity: false,
          updatedAt: Date.now()
        };
        return {
          ...current,
          [todayKey]: {
            ...previous,
            [key]: !previous[key],
            updatedAt: Date.now()
          }
        };
      });
      return;
    }
    const previous = state.dailyPlans[todayKey] ?? {
      quran: false,
      zikr: false,
      dua: false,
      charity: false,
      updatedAt: Date.now()
    };
    void updateState({
      ...state,
      dailyPlans: {
        ...state.dailyPlans,
        [todayKey]: {
          ...previous,
          [key]: !previous[key],
          updatedAt: Date.now()
        }
      },
      updatedAt: Date.now()
    });
  }, [currentDay, previewDay, state, todayKey, updateState]);

  const formatDate = useCallback((date: Date) => {
    try {
      return new Intl.DateTimeFormat(localeTag, { weekday: "short", day: "numeric", month: "short" }).format(date);
    } catch {
      return `${date.getDate()}-${date.getMonth() + 1}`;
    }
  }, [localeTag]);

  const statusLabel = useCallback((entry?: RamadanDayEntry) => {
    if (!entry) return t("ramadan.status_not_set");
    return t(`ramadan.status_${entry.status}`);
  }, [t]);

  if (!state || !range || !fontsLoaded) {
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
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ramadan.back")}
            style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("ramadan.title")}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("ramadan.subtitle")}</Text>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 28 }]}
        >
          <View style={[styles.hero, { backgroundColor: isLight ? "#E7F2FF" : "#102B47", borderColor: isLight ? "#B7D8FA" : "#28557F" }]}>
            <View style={styles.heroTop}>
              <View>
                <Text style={[styles.eyebrow, { color: colors.accent }]}>
                  {currentDay
                    ? t("ramadan.day_of", { day: currentDay, total: range.days.length })
                    : isUpcoming
                      ? t("ramadan.upcoming", { year: range.hijriYear })
                      : t("ramadan.finished", { year: range.hijriYear })}
                </Text>
                <Text style={[styles.heroDate, { color: colors.textPrimary }]}>
                  {formatDate(displayRow?.date ?? range.start)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("ramadan.preview_unlock")}
                delayLongPress={1200}
                onLongPress={() => setPreviewUnlocked(true)}
              >
                <Ionicons name="moon" size={34} color={colors.accent} />
              </Pressable>
            </View>
            {nextMoment ? (
              <View style={styles.countdownWrap}>
                <Text style={[styles.countdownLabel, { color: colors.textSecondary }]}>{nextMoment.label}</Text>
                <Text style={[styles.countdownValue, { color: colors.textPrimary }]}>{nextMoment.value}</Text>
              </View>
            ) : null}
            {locationLabel ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
                <Text style={[styles.locationText, { color: colors.textSecondary }]} numberOfLines={1}>{locationLabel}</Text>
              </View>
            ) : null}
          </View>

          {previewUnlocked ? (
            <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.previewHeader}>
                <View style={styles.previewTitleWrap}>
                  <Ionicons name="flask-outline" size={20} color={colors.accent} />
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.preview_title")}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("ramadan.preview_close")}
                  onPress={() => {
                    setPreviewDay(null);
                    setPreviewUnlocked(false);
                    setSelectedDay(null);
                  }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={[styles.previewHelp, { color: colors.textSecondary }]}>{t("ramadan.preview_help")}</Text>
              <View style={styles.previewOptions}>
                {([null, 1, 15, 29] as const).map((value) => {
                  const active = previewDay === value;
                  return (
                    <Pressable
                      key={value ?? "off"}
                      style={[
                        styles.previewButton,
                        { borderColor: colors.cardBorder },
                        active && { backgroundColor: colors.accent, borderColor: colors.accent }
                      ]}
                      onPress={() => {
                        setPreviewDay(value);
                        setSelectedDay(null);
                      }}
                    >
                      <Text style={[styles.previewButtonText, { color: active ? "#FFFFFF" : colors.textPrimary }]}>
                        {value ? t("ramadan.preview_day", { day: value }) : t("ramadan.preview_off")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {previewDay ? (
                <View style={styles.previewStatus}>
                  <StatusChip visible tone="warning" label={t("ramadan.preview_active", { day: previewDay })} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.timeRow}>
            <View style={[styles.timeCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="sunny-outline" size={22} color="#F59E0B" />
              <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t("ramadan.imsak")}</Text>
              <Text style={[styles.timeValue, { color: colors.textPrimary }]}>{displayRow?.timings?.times.Fajr ?? "--:--"}</Text>
              <Text style={[styles.timeHint, { color: colors.textSecondary }]}>{t("ramadan.suhoor_ends")}</Text>
            </View>
            <View style={[styles.timeCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="partly-sunny-outline" size={22} color="#F97316" />
              <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t("ramadan.iftar")}</Text>
              <Text style={[styles.timeValue, { color: colors.textPrimary }]}>{displayRow?.timings?.times.Maghrib ?? "--:--"}</Text>
              <Text style={[styles.timeHint, { color: colors.textSecondary }]}>{t("ramadan.fast_ends")}</Text>
            </View>
          </View>

          {loadState === "loading" ? <StatusChip visible tone="loading" label={t("ramadan.loading")} /> : null}
          {loadState === "error" ? (
            <View style={styles.statusBlock}>
              <StatusChip visible tone="error" label={errorMessage ?? t("ramadan.load_error")} />
              <Pressable style={styles.retryButton} onPress={() => void loadTimings(range)}>
                <Text style={styles.retryText}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : null}
          {loadState === "ready" && missingTimingCount > 0 ? (
            <View style={styles.statusBlock}>
              <StatusChip
                visible
                tone="warning"
                label={t("ramadan.partial_times", { count: missingTimingCount })}
              />
              <Pressable style={styles.retryButton} onPress={() => void loadTimings(range)}>
                <Text style={styles.retryText}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("ramadan.progress")}</Text>
          <View style={styles.summaryRow}>
            {[
              ["checkmark-circle", summary.fasted, t("ramadan.summary_fasted"), "#22C55E"],
              ["time", summary.makeUp, t("ramadan.summary_make_up"), "#F59E0B"],
              ["heart", summary.excused, t("ramadan.summary_excused"), "#A855F7"],
              ["checkmark-done-circle", summary.madeUp, t("ramadan.summary_made_up"), colors.accent]
            ].map(([icon, count, label, color]) => (
              <View key={String(label)} style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={String(color)} />
                <Text style={[styles.summaryCount, { color: colors.textPrimary }]}>{String(count)}</Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={2}>{String(label)}</Text>
              </View>
            ))}
          </View>

          {currentDay && todayRow ? (
            <Pressable
              style={[styles.todayTracker, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => setSelectedDay(todayRow)}
            >
              <View style={styles.todayTrackerText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.track_today")}</Text>
                <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                  {statusLabel(effectiveFastEntries[todayKey])}
                </Text>
              </View>
              <Ionicons name={statusIcon(effectiveFastEntries[todayKey]?.status)} size={26} color={colors.accent} />
            </Pressable>
          ) : null}

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("ramadan.daily_plan")}
          </Text>
          <View style={[styles.dailyPlanCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {currentDay ? (
              <>
                <View style={styles.dailyPlanHeader}>
                  <View>
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                      {t("ramadan.daily_plan_day", { day: currentDay })}
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                      {t("ramadan.daily_plan_progress", { completed: dailyPlanCompleted, total: dailyPlanKeys.length })}
                    </Text>
                  </View>
                  <Text style={[styles.dailyPlanPercent, { color: colors.accent }]}>
                    {Math.round((dailyPlanCompleted / dailyPlanKeys.length) * 100)}%
                  </Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.cardBorder }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.accent, width: `${(dailyPlanCompleted / dailyPlanKeys.length) * 100}%` }
                    ]}
                  />
                </View>
                {([
                  ["quran", "book-outline", "/quran"],
                  ["zikr", "radio-button-on-outline", "/zikr"],
                  ["dua", "hand-left-outline", "/namaz"],
                  ["charity", "heart-outline", null]
                ] as const).map(([key, icon, route]) => {
                  const completed = Boolean(todayPlan?.[key]);
                  return (
                    <View key={key} style={[styles.planItem, { borderTopColor: colors.cardBorder }]}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: completed }}
                        style={styles.planToggle}
                        onPress={() => toggleDailyPlanItem(key)}
                      >
                        <Ionicons
                          name={completed ? "checkmark-circle" : icon}
                          size={23}
                          color={completed ? "#22C55E" : colors.accent}
                        />
                        <View style={styles.planItemText}>
                          <Text style={[styles.planItemTitle, { color: colors.textPrimary }]}>
                            {t(`ramadan.plan_${key}`)}
                          </Text>
                          <Text style={[styles.planItemSubtitle, { color: colors.textSecondary }]}>
                            {t(`ramadan.plan_${key}_hint`)}
                          </Text>
                        </View>
                      </Pressable>
                      {route ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("ramadan.open_activity")}
                          style={[styles.openActivityButton, { backgroundColor: colors.accentSoft }]}
                          onPress={() => router.push(route as never)}
                        >
                          <Ionicons name="arrow-forward" size={17} color={colors.accent} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </>
            ) : (
              <View style={styles.dailyPlanLocked}>
                <Ionicons name="calendar-outline" size={26} color={colors.accent} />
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.daily_plan_upcoming")}</Text>
                <Text style={[styles.cardSubtitle, styles.dailyPlanLockedText, { color: colors.textSecondary }]}>
                  {t("ramadan.daily_plan_upcoming_hint")}
                </Text>
              </View>
            )}
          </View>

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("ramadan.duas_section")}
          </Text>
          <View style={[styles.duaCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.intention_title")}</Text>
            <Text style={[styles.duaBody, { color: colors.textSecondary }]}>{t("ramadan.intention_body")}</Text>
          </View>
          <View style={[styles.duaCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.iftar_dua_title")}</Text>
            <Text style={[styles.arabicDua, { color: colors.textPrimary }]}>
              اللّٰهُمَّ لَكَ صُمْتُ وَعَلَيْكَ تَوَكَّلْتُ وَعَلَى رِزْقِكَ أَفْطَرْتُ، تَقَبَّلْهُ مِنِّي إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ، ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللّٰهُ
            </Text>
            <Text style={[styles.transliteration, { color: colors.accent }]}>{t("ramadan.iftar_dua_transliteration")}</Text>
            <Text style={[styles.duaBody, { color: colors.textSecondary }]}>{t("ramadan.iftar_dua_meaning")}</Text>
            <Text style={[styles.duaSource, { color: colors.textSecondary }]}>{t("ramadan.iftar_dua_source")}</Text>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("ramadan.notifications_section")}
          </Text>
          <View style={[styles.notificationCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.cardSubtitle, styles.notificationHelp, { color: colors.textSecondary }]}>
              {t("ramadan.notifications_help")}
            </Text>
            {(["imsak", "iftar"] as const).map((event) => {
              const enabledKey = event === "imsak" ? "imsakEnabled" : "iftarEnabled";
              const minutesKey = event === "imsak" ? "imsakMinutesBefore" : "iftarMinutesBefore";
              const enabled = state.notifications[enabledKey];
              const minutes = state.notifications[minutesKey];
              return (
                <View key={event} style={[styles.notificationEvent, { borderTopColor: colors.cardBorder }]}>
                  <View style={styles.notificationEventHeader}>
                    <View style={styles.notificationEventText}>
                      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                        {t(`ramadan.${event}_reminder`)}
                      </Text>
                      <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                        {t("ramadan.minutes_before", { mins: minutes })}
                      </Text>
                    </View>
                    <Switch
                      value={enabled}
                      disabled={savingNotifications}
                      onValueChange={(value) => void updateNotificationSettings({ [enabledKey]: value })}
                      trackColor={{ false: colors.cardBorder, true: colors.accent }}
                    />
                  </View>
                  {enabled ? (
                    <View style={styles.minuteOptions}>
                      {([5, 10, 15, 30, 60] as RamadanReminderMinutes[]).map((value) => (
                        <Pressable
                          key={value}
                          disabled={savingNotifications}
                          onPress={() => void updateNotificationSettings({ [minutesKey]: value })}
                          style={[
                            styles.minuteButton,
                            { borderColor: colors.cardBorder },
                            minutes === value && { backgroundColor: colors.accent, borderColor: colors.accent }
                          ]}
                        >
                          <Text style={[styles.minuteButtonText, { color: minutes === value ? "#FFFFFF" : colors.textPrimary }]}>
                            {value}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            <View style={[styles.notificationPreferences, { borderTopColor: colors.cardBorder }]}>
              <View style={styles.preferenceRow}>
                <Text style={[styles.preferenceLabel, { color: colors.textPrimary }]}>{t("ramadan.notification_sound")}</Text>
                <Switch
                  value={state.notifications.playSound}
                  disabled={savingNotifications}
                  onValueChange={(value) => void updateNotificationSettings({ playSound: value })}
                  trackColor={{ false: colors.cardBorder, true: colors.accent }}
                />
              </View>
              <View style={styles.preferenceRow}>
                <Text style={[styles.preferenceLabel, { color: colors.textPrimary }]}>{t("ramadan.notification_vibration")}</Text>
                <Switch
                  value={state.notifications.vibration}
                  disabled={savingNotifications}
                  onValueChange={(value) => void updateNotificationSettings({ vibration: value })}
                  trackColor={{ false: colors.cardBorder, true: colors.accent }}
                />
              </View>
            </View>
            <Pressable
              disabled={savingNotifications}
              style={[styles.testNotificationButton, { backgroundColor: colors.accent }, savingNotifications && { opacity: 0.6 }]}
              onPress={() => void sendTestNotification()}
            >
              <Ionicons name="notifications-outline" size={17} color="#FFFFFF" />
              <Text style={styles.testNotificationText}>{t("ramadan.notifications_test")}</Text>
            </Pressable>
            {savingNotifications ? <ActivityIndicator style={styles.notificationLoader} color={colors.accent} /> : null}
            {notificationStatus ? (
              <View style={styles.notificationStatus}>
                <StatusChip visible tone={notificationStatus.tone} label={notificationStatus.label} />
              </View>
            ) : null}
          </View>

          <View style={[styles.correctionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.correctionHeader}>
              <View style={styles.correctionText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("ramadan.date_correction")}</Text>
                <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>{t("ramadan.date_correction_help")}</Text>
              </View>
              <View style={styles.correctionControls}>
                {([-1, 0, 1] as const).map((value) => (
                  <Pressable
                    key={value}
                    style={[
                      styles.correctionButton,
                      { borderColor: colors.cardBorder },
                      state.dateCorrection === value && { backgroundColor: colors.accent, borderColor: colors.accent }
                    ]}
                    onPress={() => changeCorrection(value)}
                  >
                    <Text style={[styles.correctionButtonText, { color: state.dateCorrection === value ? "#FFFFFF" : colors.textPrimary }]}>
                      {value > 0 ? `+${value}` : value}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>{t("ramadan.local_announcement")}</Text>
          </View>

          <View style={styles.calendarHeader}>
            <Text style={[styles.sectionTitle, styles.calendarTitle, { color: colors.textPrimary }]}>{t("ramadan.calendar")}</Text>
            <Text style={[styles.calendarMeta, { color: colors.textSecondary }]}>{range.days.length} {t("ramadan.days")}</Text>
          </View>

          <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={[styles.calendarRow, styles.calendarColumns, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.dayColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.day")}</Text>
              <Text style={[styles.dateColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.date")}</Text>
              <Text style={[styles.timeColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.imsak")}</Text>
              <Text style={[styles.timeColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.iftar")}</Text>
              <View style={styles.statusColumn} />
            </View>
            {rows.map((row, index) => {
              const entry = effectiveFastEntries[row.dateKey];
              const future = isAfterDay(row.date, displayNow);
              const today = row.dateKey === todayKey;
              return (
                <Pressable
                  key={row.dateKey}
                  disabled={future}
                  onPress={() => setSelectedDay(row)}
                  style={[
                    styles.calendarRow,
                    index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder },
                    today && { backgroundColor: colors.accentSoft },
                    future && { opacity: 0.76 }
                  ]}
                >
                  <Text style={[styles.dayColumn, styles.dayNumber, { color: today ? colors.accent : colors.textPrimary }]}>{index + 1}</Text>
                  <Text style={[styles.dateColumn, styles.rowText, { color: colors.textSecondary }]} numberOfLines={1}>{formatDate(row.date)}</Text>
                  <Text style={[styles.timeColumn, styles.rowTime, { color: colors.textPrimary }]}>{row.timings?.times.Fajr ?? "—"}</Text>
                  <Text style={[styles.timeColumn, styles.rowTime, { color: colors.textPrimary }]}>{row.timings?.times.Maghrib ?? "—"}</Text>
                  <View style={styles.statusColumn}>
                    <Ionicons name={statusIcon(entry?.status)} size={19} color={entry ? colors.accent : colors.textSecondary} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <Modal visible={Boolean(selectedDay)} transparent animationType="fade" onRequestClose={() => setSelectedDay(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedDay(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={() => undefined}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t("ramadan.record_day")}</Text>
            <Text style={[styles.modalDate, { color: colors.textSecondary }]}>
              {selectedDay ? `${formatDate(selectedDay.date)} • ${t("ramadan.day")} ${range.days.findIndex((day) => localDateKey(day) === selectedDay.dateKey) + 1}` : ""}
            </Text>
            {([
              ["fasted", "checkmark-circle", "#22C55E"],
              ["make_up_later", "time", "#F59E0B"],
              ["excused", "heart", "#A855F7"],
              ["made_up", "checkmark-done-circle", colors.accent]
            ] as const).map(([status, icon, color]) => (
              <Pressable
                key={status}
                style={[styles.modalOption, { borderColor: colors.cardBorder }, effectiveFastEntries[selectedDay?.dateKey ?? ""]?.status === status && { backgroundColor: colors.accentSoft }]}
                onPress={() => selectedDay && setDayStatus(selectedDay.dateKey, status)}
              >
                <Ionicons name={icon} size={22} color={color} />
                <Text style={[styles.modalOptionText, { color: colors.textPrimary }]}>{t(`ramadan.status_${status}`)}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.clearButton} onPress={() => selectedDay && setDayStatus(selectedDay.dateKey, null)}>
              <Text style={[styles.clearButtonText, { color: colors.textSecondary }]}>{t("ramadan.clear_status")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1, width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 14 },
  circleButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  title: { fontSize: 25, fontWeight: "900" },
  subtitle: { marginTop: 2, fontSize: 13 },
  scrollContent: { paddingBottom: 28 },
  hero: { borderRadius: 22, borderWidth: 1, padding: 18 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: { fontSize: 13, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  heroDate: { marginTop: 5, fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
  countdownWrap: { marginTop: 22 },
  countdownLabel: { fontSize: 13, fontWeight: "700" },
  countdownValue: { marginTop: 3, fontSize: 38, fontWeight: "900", letterSpacing: -1 },
  locationRow: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 5 },
  locationText: { flex: 1, fontSize: 12 },
  previewCard: { marginTop: 12, borderRadius: 17, borderWidth: 1, padding: 14 },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  previewTitleWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewHelp: { marginTop: 7, fontSize: 11, lineHeight: 16 },
  previewOptions: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  previewButton: { minHeight: 36, borderRadius: 11, borderWidth: 1, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  previewButtonText: { fontSize: 12, fontWeight: "800" },
  previewStatus: { marginTop: 10 },
  timeRow: { marginTop: 12, flexDirection: "row", gap: 10 },
  timeCard: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 14 },
  timeLabel: { marginTop: 8, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  timeValue: { marginTop: 3, fontSize: 28, fontWeight: "900" },
  timeHint: { marginTop: 2, fontSize: 11 },
  statusBlock: { marginTop: 10 },
  retryButton: { alignSelf: "flex-start", marginTop: 8, borderRadius: 999, backgroundColor: "#2B8CEE", paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  sectionTitle: { marginTop: 22, marginBottom: 10, fontSize: 19, fontWeight: "900" },
  summaryRow: { flexDirection: "row", gap: 7 },
  summaryCard: { flex: 1, minHeight: 94, borderRadius: 15, borderWidth: 1, padding: 10, alignItems: "center" },
  summaryCount: { marginTop: 4, fontSize: 20, fontWeight: "900" },
  summaryLabel: { marginTop: 2, textAlign: "center", fontSize: 10, lineHeight: 13 },
  todayTracker: { marginTop: 12, minHeight: 74, borderRadius: 17, borderWidth: 1, paddingHorizontal: 15, flexDirection: "row", alignItems: "center" },
  todayTrackerText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  cardSubtitle: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  dailyPlanCard: { borderRadius: 17, borderWidth: 1, padding: 15 },
  dailyPlanHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dailyPlanPercent: { fontSize: 20, fontWeight: "900" },
  progressTrack: { marginTop: 12, height: 7, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999 },
  planItem: { minHeight: 66, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center" },
  planToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  planItemText: { flex: 1 },
  planItemTitle: { fontSize: 14, fontWeight: "800" },
  planItemSubtitle: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  openActivityButton: { width: 36, height: 36, marginLeft: 8, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dailyPlanLocked: { alignItems: "center", paddingVertical: 9 },
  dailyPlanLockedText: { maxWidth: 360, textAlign: "center" },
  duaCard: { marginBottom: 10, borderRadius: 17, borderWidth: 1, padding: 15 },
  arabicDua: { marginTop: 14, fontFamily: "QuranArabic", fontSize: 25, lineHeight: 44, textAlign: "right", writingDirection: "rtl" },
  transliteration: { marginTop: 10, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
  duaBody: { marginTop: 9, fontSize: 12, lineHeight: 18 },
  duaSource: { marginTop: 10, fontSize: 10, fontWeight: "700" },
  notificationCard: { borderRadius: 17, borderWidth: 1, paddingHorizontal: 15, paddingBottom: 14 },
  notificationHelp: { marginTop: 14, marginBottom: 2 },
  notificationEvent: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  notificationEventHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  notificationEventText: { flex: 1 },
  minuteOptions: { marginTop: 11, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  minuteButton: { minWidth: 42, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  minuteButtonText: { fontSize: 12, fontWeight: "900" },
  notificationPreferences: { marginTop: 14, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  preferenceRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  preferenceLabel: { fontSize: 14, fontWeight: "700" },
  testNotificationButton: { marginTop: 10, minHeight: 42, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  testNotificationText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  notificationLoader: { marginTop: 8, alignSelf: "flex-start" },
  notificationStatus: { marginTop: 8 },
  correctionCard: { marginTop: 14, borderRadius: 17, borderWidth: 1, padding: 15 },
  correctionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  correctionText: { flex: 1 },
  correctionControls: { flexDirection: "row", gap: 5 },
  correctionButton: { width: 36, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  correctionButtonText: { fontSize: 13, fontWeight: "900" },
  disclaimer: { marginTop: 12, fontSize: 11, lineHeight: 16 },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarTitle: { marginBottom: 10 },
  calendarMeta: { marginTop: 12, fontSize: 12, fontWeight: "700" },
  calendarCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  calendarRow: { minHeight: 49, paddingHorizontal: 10, flexDirection: "row", alignItems: "center" },
  calendarColumns: { minHeight: 38, borderBottomWidth: 1 },
  dayColumn: { width: 34 },
  dateColumn: { flex: 1.45 },
  timeColumn: { width: 58, textAlign: "center" },
  statusColumn: { width: 28, alignItems: "flex-end" },
  columnLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  dayNumber: { fontSize: 13, fontWeight: "900" },
  rowText: { fontSize: 11, textTransform: "capitalize" },
  rowTime: { fontSize: 13, fontWeight: "800" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 460, borderRadius: 22, borderWidth: 1, padding: 18 },
  modalTitle: { fontSize: 21, fontWeight: "900" },
  modalDate: { marginTop: 4, marginBottom: 14, fontSize: 13, textTransform: "capitalize" },
  modalOption: { minHeight: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 11 },
  modalOptionText: { fontSize: 15, fontWeight: "700" },
  clearButton: { marginTop: 14, alignItems: "center", paddingVertical: 9 },
  clearButtonText: { fontSize: 13, fontWeight: "700" }
});
