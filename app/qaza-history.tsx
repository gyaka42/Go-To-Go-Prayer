import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  easeEnterTransition,
  easeInitialFade,
  easeInitialLift,
  easePressTransition,
  easeVisibleFade,
  easeVisibleLift
} from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { QazaEvent, QazaKey, getQazaState } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

function formatDateTime(ts: number, localeTag: string): string {
  try {
    return new Intl.DateTimeFormat(localeTag, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function prayerLabelKey(key: QazaKey): string {
  return `prayer.${key}`;
}

export default function QazaHistoryScreen() {
  const router = useRouter();
  const { t, localeTag } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  const [events, setEvents] = useState<QazaEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "month">("all");
  const [pressedFilter, setPressedFilter] = useState<"all" | "month" | null>(null);
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const state = await getQazaState();
      if (!mounted) {
        return;
      }
      setEvents(state.events.slice().reverse());
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") {
      return events;
    }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return events.filter((event) => event.at >= monthStart);
  }, [events, filter]);

  const historyStatus = useMemo(() => {
    if (events.length === 0) {
      return { label: t("qaza.history_empty_state"), tone: "info" as const };
    }
    if (filter === "month") {
      return {
        label: t("qaza.history_month_count", { count: filtered.length }),
        tone: "success" as const
      };
    }
    return {
      label: t("qaza.history_all_count", { count: filtered.length }),
      tone: "info" as const
    };
  }, [events.length, filter, filtered.length, t]);

  const describeEvent = (event: QazaEvent): string => {
    if (event.type === "quick_add") {
      return t("qaza.actionQuickAdd");
    }
    if (event.type === "reset") {
      return t("qaza.actionReset");
    }

    const prayer = event.prayerKey ? t(prayerLabelKey(event.prayerKey)) : "";
    if (event.type === "inc") {
      return t("qaza.actionInc", { prayer });
    }
    if (event.type === "dec") {
      return t("qaza.actionDec", { prayer });
    }
    return t("qaza.history");
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}> 
      <View style={styles.container}>
        <AppBackground />

        <EaseView style={styles.headerRow} initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Pressable
            style={[
              styles.headerIconButton,
              { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EAF2FC" : "#162638" }
            ]}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={22} color={isLight ? "#5D7690" : "#A8BED6"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("qaza.historyTitle")}</Text>
          <View style={styles.headerSpacer} />
        </EaseView>

        <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
          <StatusChip label={historyStatus.label} tone={historyStatus.tone} />
        </EaseView>

        <EaseView style={styles.filterRow} initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
          <EaseView animate={{ scale: pressedFilter === "all" ? 0.96 : 1 }} transition={pressTransition}>
            <Pressable
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === "all" ? colors.accent : colors.card,
                  borderColor: colors.cardBorder
                }
              ]}
              onPress={() => setFilter("all")}
              onPressIn={() => setPressedFilter("all")}
              onPressOut={() => setPressedFilter(null)}
            >
              <Text style={[styles.filterText, { color: filter === "all" ? "#FFFFFF" : colors.textPrimary }]}>
                {t("qaza.all")}
              </Text>
            </Pressable>
          </EaseView>
          <EaseView animate={{ scale: pressedFilter === "month" ? 0.96 : 1 }} transition={pressTransition}>
            <Pressable
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === "month" ? colors.accent : colors.card,
                  borderColor: colors.cardBorder
                }
              ]}
              onPress={() => setFilter("month")}
              onPressIn={() => setPressedFilter("month")}
              onPressOut={() => setPressedFilter(null)}
            >
              <Text style={[styles.filterText, { color: filter === "month" ? "#FFFFFF" : colors.textPrimary }]}>
                {t("qaza.thisMonth")}
              </Text>
            </Pressable>
          </EaseView>
        </EaseView>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <EaseView
              style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              initialAnimate={easeInitialFade}
              animate={easeVisibleFade}
              transition={enterTransition}
            > 
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t("qaza.noHistory")}</Text>
            </EaseView>
          ) : (
            filtered.map((event) => (
              <EaseView
                key={event.id}
                style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                initialAnimate={easeInitialFade}
                animate={easeVisibleFade}
                transition={enterTransition}
              > 
                <Text style={[styles.eventTitle, { color: colors.textPrimary }]}>{describeEvent(event)}</Text>
                <Text style={[styles.eventMeta, { color: colors.textSecondary }]}>
                  {formatDateTime(event.at, localeTag)}
                </Text>
              </EaseView>
            ))
          )}
        </ScrollView>
      </View>
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
    paddingTop: 14
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerIconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "800"
  },
  headerSpacer: {
    width: 44,
    height: 44
  },
  filterRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10
  },
  filterChip: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  filterText: {
    fontSize: 14,
    fontWeight: "700"
  },
  scrollContent: {
    marginTop: 12,
    paddingBottom: 24,
    gap: 10
  },
  eventCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  eventMeta: {
    marginTop: 6,
    fontSize: 13
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 24,
    alignItems: "center"
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600"
  }
});
