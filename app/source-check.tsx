import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { easeEnterTransition, easeInitialLift, easePressTransition, easeVisibleLift } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocationForSettings } from "@/services/location";
import { getSettings } from "@/services/storage";
import { buildTimingsCacheKey, getCachedTimings } from "@/services/storage";
import { analyzeTimingsSanity, TimingSanityIssue } from "@/services/timingValidation";
import { evaluateTimingTrust, TimingTrust } from "@/services/timingTrust";
import { getTodayTomorrowTimings } from "@/services/timingsCache";
import { useAppTheme } from "@/theme/ThemeProvider";
import { PrayerName, PRAYER_NAMES, Settings, Timings } from "@/types/prayer";
import { formatDateTime } from "@/utils/date";
import { getDateKey, getTomorrow } from "@/utils/time";

type LoadState = "idle" | "loading" | "ready" | "error";

type CheckResult = {
  settings: Settings;
  location: { lat: number; lon: number; label: string };
  today: Timings;
  tomorrow: Timings;
  source: "api" | "cache";
  lastUpdated: string;
  hadTodayCache: boolean;
  hadTomorrowCache: boolean;
  sanityIssues: TimingSanityIssue[];
};

function providerLabel(settings: Settings, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (settings.timingsProvider === "diyanet") {
    return t("source_check.provider_diyanet");
  }
  return t("source_check.provider_aladhan", { method: settings.methodId });
}

function compactLocation(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function sourceDetail(timings: Timings, t: (key: string, params?: Record<string, string | number>) => string): string {
  const rows = [
    timings.source ? t("source_check.detail_source", { value: timings.source }) : null,
    timings.cityId ? t("source_check.detail_city_id", { value: timings.cityId }) : null,
    timings.citySource ? t("source_check.detail_city_source", { value: timings.citySource }) : null,
    timings.resolvedCityName ? t("source_check.detail_resolved_city", { value: timings.resolvedCityName }) : null,
    typeof timings.cityDistanceKm === "number"
      ? t("source_check.detail_distance", { value: timings.cityDistanceKm.toFixed(1) })
      : null
  ].filter((item): item is string => Boolean(item));

  return rows.length > 0 ? rows.join(" • ") : t("source_check.detail_not_available");
}

export default function SourceCheckScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, prayerName, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);
  const [state, setState] = useState<LoadState>("idle");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const settings = await getSettings();
      const location = await resolveLocationForSettings(settings);
      const today = new Date();
      const tomorrow = getTomorrow(today);
      const todayKey = getDateKey(today);
      const tomorrowKey = getDateKey(tomorrow);
      const [cachedToday, cachedTomorrow] = await Promise.all([
        getCachedTimings(
          buildTimingsCacheKey(
            todayKey,
            location.lat,
            location.lon,
            settings.methodId,
            settings.timingsProvider
          )
        ),
        getCachedTimings(
          buildTimingsCacheKey(
            tomorrowKey,
            location.lat,
            location.lon,
            settings.methodId,
            settings.timingsProvider
          )
        )
      ]);

      const timings = await getTodayTomorrowTimings({
        today,
        location,
        locationLabel: location.label,
        settings,
        forceRefresh: true,
        rangeDays: 2
      });

      setResult({
        settings,
        location,
        today: timings.today,
        tomorrow: timings.tomorrow,
        source: timings.source,
        lastUpdated: timings.lastUpdated,
        hadTodayCache: Boolean(cachedToday?.timings),
        hadTomorrowCache: Boolean(cachedTomorrow?.timings),
        sanityIssues: analyzeTimingsSanity({
          timings: timings.today,
          nextDayTimings: timings.tomorrow,
          provider: settings.timingsProvider
        })
      });
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trust = useMemo(
    () =>
      result
        ? evaluateTimingTrust({
            source: result.source,
            lastUpdated: result.lastUpdated,
            hasWarnings: result.sanityIssues.some((issue) => issue.severity === "error" || issue.severity === "warning")
          })
        : null,
    [result]
  );

  const inlineStatus = useMemo(() => {
    if (state === "loading") {
      return { label: t("source_check.status_checking"), tone: "loading" as const };
    }
    if (state === "error") {
      return { label: t("source_check.status_error"), tone: "error" as const };
    }
    if (trust === "needs-check" || trust === "stale-cache") {
      return { label: t("source_check.status_attention"), tone: "warning" as const };
    }
    if (trust === "live") {
      return { label: t("source_check.status_live"), tone: "success" as const };
    }
    if (trust === "recent-cache") {
      return { label: t("source_check.status_cache"), tone: "warning" as const };
    }
    return { label: t("source_check.status_idle"), tone: "info" as const };
  }, [state, t, trust]);

  const renderPrayerRow = (timings: Timings, prayer: PrayerName) => (
    <View key={`${timings.dateKey}-${prayer}`} style={[styles.prayerRow, { borderColor: colors.cardBorder }]}>
      <Text style={[styles.prayerLabel, { color: colors.textPrimary }]}>{prayerName(prayer)}</Text>
      <Text style={[styles.prayerTime, { color: colors.textPrimary }]}>{timings.times[prayer]}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={isLight ? "#1E3D5C" : "#EAF2FF"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("source_check.title")}</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        >
          <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("source_check.subtitle")}</Text>
            <View style={styles.statusWrap}>
              <StatusChip label={inlineStatus.label} tone={inlineStatus.tone} />
            </View>
          </EaseView>

          {state === "loading" && !result ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#2B8CEE" />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                {t("source_check.loading_body")}
              </Text>
            </View>
          ) : null}

          {state === "error" ? (
            <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("source_check.error_title")}</Text>
                <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                  {error || t("source_check.error_body")}
                </Text>
                <Pressable
                  style={[
                    styles.primaryButton,
                    { transform: [{ scale: pressed ? 0.985 : 1 }] }
                  ]}
                  onPress={() => void load()}
                  onPressIn={() => setPressed(true)}
                  onPressOut={() => setPressed(false)}
                >
                  <Text style={styles.primaryButtonText}>{t("common.retry")}</Text>
                </Pressable>
              </View>
            </EaseView>
          ) : null}

          {result ? (
            <>
              <TrustSummaryCard trust={trust ?? "unknown"} />

              <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                    {t("source_check.overview_title")}
                  </Text>
                  <InfoRow label={t("source_check.location")} value={compactLocation(result.location.label)} />
                  <InfoRow
                    label={t("source_check.coordinates")}
                    value={`${result.location.lat.toFixed(4)}, ${result.location.lon.toFixed(4)}`}
                  />
                  <InfoRow label={t("source_check.provider")} value={providerLabel(result.settings, t)} />
                  <InfoRow
                    label={t("source_check.updated")}
                    value={formatDateTime(result.lastUpdated, localeTag)}
                  />
                  <InfoRow
                    label={t("source_check.cache")}
                    value={
                      result.hadTodayCache && result.hadTomorrowCache
                        ? t("source_check.cache_ready")
                        : t("source_check.cache_partial")
                    }
                  />
                </View>
              </EaseView>

              <SanityCard issues={result.sanityIssues} />

              <TimingCard
                title={t("source_check.today_title")}
                timings={result.today}
                detail={sourceDetail(result.today, t)}
                renderPrayerRow={renderPrayerRow}
                colors={colors}
              />
              <TimingCard
                title={t("source_check.tomorrow_title")}
                timings={result.tomorrow}
                detail={sourceDetail(result.tomorrow, t)}
                renderPrayerRow={renderPrayerRow}
                colors={colors}
              />

              <EaseView
                initialAnimate={easeInitialLift}
                animate={{ ...easeVisibleLift, scale: pressed ? 0.985 : 1 }}
                transition={pressed ? pressTransition : enterTransition}
              >
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void load()}
                  onPressIn={() => setPressed(true)}
                  onPressOut={() => setPressed(false)}
                >
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>{t("source_check.refresh")}</Text>
                </Pressable>
              </EaseView>
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.infoRow, { borderColor: colors.cardBorder }]}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function TrustSummaryCard({ trust }: { trust: TimingTrust }) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const transition = useMotionTransition(easeEnterTransition);
  const content = {
    live: {
      label: t("source_check.trust_live_title"),
      body: t("source_check.trust_live_body"),
      tone: "success" as const
    },
    "recent-cache": {
      label: t("source_check.trust_cache_title"),
      body: t("source_check.trust_cache_body"),
      tone: "info" as const
    },
    "stale-cache": {
      label: t("source_check.trust_stale_title"),
      body: t("source_check.trust_stale_body"),
      tone: "warning" as const
    },
    "needs-check": {
      label: t("source_check.trust_attention_title"),
      body: t("source_check.trust_attention_body"),
      tone: "warning" as const
    },
    unknown: {
      label: t("source_check.status_idle"),
      body: t("source_check.trust_unknown_body"),
      tone: "info" as const
    }
  }[trust];

  return (
    <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={transition}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("source_check.trust_title")}</Text>
        <View style={styles.statusWrapTight}>
          <StatusChip label={content.label} tone={content.tone} />
        </View>
        <Text style={[styles.bodyTextCompact, { color: colors.textSecondary }]}>{content.body}</Text>
      </View>
    </EaseView>
  );
}

function issueTone(severity: TimingSanityIssue["severity"]): "success" | "info" | "warning" | "error" {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "info";
}

function SanityCard({ issues }: { issues: TimingSanityIssue[] }) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const transition = useMotionTransition(easeEnterTransition);
  const highestSeverity = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : "success";

  return (
    <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={transition}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("source_check.sanity_title")}</Text>
        <View style={styles.statusWrapTight}>
          <StatusChip
            label={issues.length === 0 ? t("source_check.sanity_ok") : t("source_check.sanity_attention")}
            tone={highestSeverity}
          />
        </View>
        {issues.length === 0 ? (
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{t("source_check.sanity_ok_body")}</Text>
        ) : (
          <View style={styles.issueList}>
            {issues.map((issue, index) => (
              <View key={`${issue.titleKey}-${index}`} style={[styles.issueRow, { borderColor: colors.cardBorder }]}>
                <StatusChip label={t(issue.titleKey)} tone={issueTone(issue.severity)} />
                <Text style={[styles.issueBody, { color: colors.textSecondary }]}>
                  {t(issue.bodyKey, issue.params)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </EaseView>
  );
}

function TimingCard({
  title,
  timings,
  detail,
  renderPrayerRow,
  colors
}: {
  title: string;
  timings: Timings;
  detail: string;
  renderPrayerRow: (timings: Timings, prayer: PrayerName) => ReactElement;
  colors: ReturnType<typeof useAppTheme>["colors"];
}) {
  const transition = useMotionTransition(easeEnterTransition);
  return (
    <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={transition}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.detailText, { color: colors.textSecondary }]}>{detail}</Text>
        <View style={styles.prayerRows}>{PRAYER_NAMES.map((prayer) => renderPrayerRow(timings, prayer))}</View>
      </View>
    </EaseView>
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
    paddingTop: 14
  },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPlaceholder: {
    width: 40,
    height: 40
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "900"
  },
  scrollContent: {
    paddingTop: 10
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22
  },
  statusWrap: {
    marginTop: 12,
    marginBottom: 14
  },
  statusWrapTight: {
    marginBottom: 10
  },
  loadingWrap: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 14
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600"
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 10
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14
  },
  bodyTextCompact: {
    fontSize: 14,
    lineHeight: 21
  },
  issueList: {
    gap: 12
  },
  issueRow: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8
  },
  issueBody: {
    fontSize: 13,
    lineHeight: 19
  },
  detailText: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8
  },
  infoRow: {
    borderTopWidth: 1,
    paddingVertical: 10,
    gap: 4
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "700"
  },
  prayerRows: {
    marginTop: 4
  },
  prayerRow: {
    minHeight: 42,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  prayerLabel: {
    fontSize: 15,
    fontWeight: "700"
  },
  prayerTime: {
    fontSize: 18,
    fontWeight: "900"
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 14
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900"
  }
});
