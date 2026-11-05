import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { RamadanCalendarTable } from "@/ramadan/components/RamadanCalendarTable";
import { RamadanDuaKind, RamadanDuaModal } from "@/ramadan/components/RamadanDuaModal";
import { RamadanStatusModal } from "@/ramadan/components/RamadanStatusModal";
import { useRamadanPreview } from "@/ramadan/RamadanPreviewProvider";
import {
  getRamadanState,
  getSettings,
  RamadanDayEntry,
  RamadanDailyPlanKey,
  RamadanFastStatus,
  RamadanState,
  saveRamadanState
} from "@/services/storage";
import { getRamadanPreviewRows, loadRamadanTimingRows, RamadanTimingRow } from "@/ramadan/timings";
import { useAppTheme } from "@/theme/ThemeProvider";

type LoadState = "idle" | "loading" | "ready" | "error";
function dateAtStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function statusIcon(status: RamadanFastStatus | undefined): keyof typeof Ionicons.glyphMap {
  if (status === "fasted") return "checkmark-circle";
  if (status === "make_up_later") return "time";
  if (status === "excused") return "heart";
  if (status === "made_up") return "checkmark-done-circle";
  return "ellipse-outline";
}

export function RamadanScreen({
  asTab = false,
  tabBarHeight = 0
}: {
  asTab?: boolean;
  tabBarHeight?: number;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, localeTag } = useI18n();
  const {
    previewDay,
    setPreviewDay,
    previewFastEntries,
    setPreviewFastStatus,
    previewDailyPlans,
    togglePreviewDailyPlanItem
  } = useRamadanPreview();
  const isLight = resolvedTheme === "light";

  const [state, setState] = useState<RamadanState | null>(null);
  const [rows, setRows] = useState<RamadanTimingRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [now, setNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<RamadanTimingRow | null>(null);
  const [selectedDua, setSelectedDua] = useState<RamadanDuaKind | null>(null);
  const [previewUnlocked, setPreviewUnlocked] = useState(false);

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
      const result = await loadRamadanTimingRows({ range: targetRange, settings });
      setLocationLabel(result.location.label);
      setRows(result.rows);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(
        error instanceof Error && error.message === "RAMADAN_LOCATION_UNAVAILABLE"
          ? t("ramadan.location_error")
          : error instanceof Error
            ? error.message
            : t("ramadan.load_error")
      );
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

  const setDayStatus = useCallback((dateKey: string, status: RamadanFastStatus | null) => {
    if (!state) return;
    if (previewDay) {
      setPreviewFastStatus(dateKey, status);
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
  }, [previewDay, setPreviewFastStatus, state, updateState]);

  const toggleDailyPlanItem = useCallback((key: RamadanDailyPlanKey) => {
    if (!state || !currentDay) return;
    if (previewDay) {
      togglePreviewDailyPlanItem(todayKey, key);
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
  }, [currentDay, previewDay, state, todayKey, togglePreviewDailyPlanItem, updateState]);

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

  const previewRows = getRamadanPreviewRows(rows, currentDay, isFinished, 5);
  const activeReminderCount = Number(state?.notifications.imsakEnabled) + Number(state?.notifications.iftarEnabled);

  if (!state || !range) {
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
          {!asTab ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ramadan.back")}
              style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("ramadan.title")}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("ramadan.subtitle")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ramadan.settings_title")}
            style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={() => router.push("/ramadan-settings" as never)}
          >
            <Ionicons name="settings-outline" size={21} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 28, tabBarHeight + 28) }
          ]}
        >
          <View style={[styles.hero, { backgroundColor: isLight ? "#E7F2FF" : "#102B47", borderColor: isLight ? "#B7D8FA" : "#28557F" }]}>
            <View style={styles.heroTop}>
              <View>
                <Text style={[currentDay ? styles.heroDay : styles.eyebrow, { color: colors.accent }]}>
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
              <View style={[styles.countdownWrap, Boolean(currentDay) && styles.countdownWrapDuring]}>
                <Text style={[styles.countdownLabel, { color: colors.textSecondary }]}>{nextMoment.label}</Text>
                <Text style={[styles.countdownValue, Boolean(currentDay) && styles.countdownValueDuring, { color: colors.textPrimary }]}>
                  {nextMoment.value}
                </Text>
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
          <View style={[styles.compactCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {([
              ["intention", "heart-outline", t("ramadan.intention_title")],
              ["iftar", "restaurant-outline", t("ramadan.iftar_dua_title")]
            ] as const).map(([kind, icon, label], index) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                style={[styles.compactRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.cardBorder }]}
                onPress={() => setSelectedDua(kind)}
              >
                <View style={[styles.compactIcon, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name={icon} size={21} color={colors.accent} />
                </View>
                <Text style={[styles.compactTitle, { color: colors.textPrimary }]}>{label}</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </Pressable>
            ))}
          </View>

          <View style={styles.calendarHeader}>
            <Text style={[styles.sectionTitle, styles.calendarTitle, { color: colors.textPrimary }]}>{t("ramadan.calendar")}</Text>
            <Text style={[styles.calendarMeta, { color: colors.textSecondary }]}>{range.days.length} {t("ramadan.days")}</Text>
          </View>
          <RamadanCalendarTable
            rows={previewRows}
            rangeStart={range.start}
            currentDay={currentDay}
            entries={effectiveFastEntries}
            formatDate={formatDate}
            onSelect={setSelectedDay}
            disabledAfterDate={displayNow}
            compact
          />
          <Pressable
            accessibilityRole="button"
            style={[styles.fullCalendarButton, { borderColor: colors.cardBorder }]}
            onPress={() => router.push("/ramadan-calendar" as never)}
          >
            <Text style={[styles.fullCalendarText, { color: colors.accent }]}>{t("ramadan.view_full_calendar")}</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.accent} />
          </Pressable>

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("ramadan.notifications_section")}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={() => router.push("/ramadan-reminders" as never)}
          >
            <View style={[styles.compactIcon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="notifications-outline" size={21} color={colors.accent} />
            </View>
            <View style={styles.reminderText}>
              <Text style={[styles.compactTitle, { color: colors.textPrimary }]}>{t("ramadan.notifications_section")}</Text>
              <Text style={[styles.compactSubtitle, { color: colors.textSecondary }]}>
                {t("ramadan.notifications_active_count", { count: activeReminderCount })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </Pressable>
        </ScrollView>
      </View>

      <RamadanStatusModal
        selectedDay={selectedDay}
        range={range}
        entries={effectiveFastEntries}
        formatDate={formatDate}
        onSelect={setDayStatus}
        onClose={() => setSelectedDay(null)}
      />
      <RamadanDuaModal kind={selectedDua} onClose={() => setSelectedDua(null)} />
    </SafeAreaView>
  );
}

export default function RamadanRoute() {
  return <RamadanScreen />;
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
  heroDay: { fontSize: 25, lineHeight: 30, fontWeight: "900" },
  heroDate: { marginTop: 5, fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
  countdownWrap: { marginTop: 22 },
  countdownWrapDuring: { marginTop: 14 },
  countdownLabel: { fontSize: 13, fontWeight: "700" },
  countdownValue: { marginTop: 3, fontSize: 38, fontWeight: "900", letterSpacing: -1 },
  countdownValueDuring: { fontSize: 30 },
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
  compactCard: { borderRadius: 17, borderWidth: 1, overflow: "hidden" },
  compactRow: { minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  compactIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  compactTitle: { flex: 1, fontSize: 15, fontWeight: "800" },
  compactSubtitle: { marginTop: 3, fontSize: 12, lineHeight: 16 },
  fullCalendarButton: { minHeight: 44, marginTop: 9, borderRadius: 13, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  fullCalendarText: { fontSize: 13, fontWeight: "800" },
  reminderCard: { minHeight: 66, borderRadius: 17, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  reminderText: { flex: 1 },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarTitle: { marginBottom: 10 },
  calendarMeta: { marginTop: 12, fontSize: 12, fontWeight: "700" }
});
