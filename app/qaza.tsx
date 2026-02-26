import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { QazaEvent, QazaKey, QazaState, getQazaState, saveQazaState } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

type UndoPayload = {
  id: string;
  message: string;
  snapshotBefore: {
    remaining: Record<QazaKey, number>;
    completed: number;
    goal: number;
  };
};

const QAZA_ORDER: QazaKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha", "witr"];
const UNDO_DURATION_MS = 4000;

function prayerKeyToLabelKey(key: QazaKey): string {
  return `prayer.${key}`;
}

function prayerKeyToIconName(key: QazaKey): keyof typeof MaterialCommunityIcons.glyphMap {
  if (key === "fajr") {
    return "weather-night";
  }
  if (key === "dhuhr") {
    return "weather-sunny";
  }
  if (key === "asr") {
    return "weather-partly-cloudy";
  }
  if (key === "maghrib") {
    return "weather-sunset-down";
  }
  return "weather-night-partly-cloudy";
}

function remainingTotal(state: QazaState): number {
  return QAZA_ORDER.reduce((acc, key) => acc + state.remaining[key], 0);
}

function nowMonthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function previousMonthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
}

function nextMonthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

function completedDeltaForRange(events: QazaEvent[], startMs: number, endMs: number): number {
  let total = 0;
  for (const event of events) {
    if (event.at < startMs || event.at >= endMs) {
      continue;
    }
    if (event.type === "dec") {
      total += 1;
    }
  }
  return total;
}

function snapshotFromState(state: QazaState) {
  return {
    remaining: { ...state.remaining },
    completed: state.completed,
    goal: state.goal
  };
}

export default function QazaScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  const [state, setState] = useState<QazaState | null>(null);
  const [undoPayload, setUndoPayload] = useState<UndoPayload | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = await getQazaState();
      const total = remainingTotal(saved);
      const goal = saved.goal > 0 ? saved.goal : saved.completed + total;
      const normalized = goal === saved.goal ? saved : { ...saved, goal, updatedAt: Date.now() };
      setState(normalized);
      if (goal !== saved.goal) {
        await saveQazaState(normalized);
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const persistState = async (next: QazaState) => {
    setState(next);
    await saveQazaState(next);
  };

  const setUndo = (payload: UndoPayload | null) => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    setUndoPayload(payload);

    if (payload) {
      undoTimerRef.current = setTimeout(() => {
        setUndoPayload(null);
        undoTimerRef.current = null;
      }, UNDO_DURATION_MS);
    }
  };

  const total = useMemo(() => (state ? remainingTotal(state) : 0), [state]);
  const goal = useMemo(() => {
    if (!state) {
      return 0;
    }
    const fallback = state.completed + total;
    return state.goal > 0 ? Math.max(state.goal, state.completed) : fallback;
  }, [state, total]);

  const progress = useMemo(() => {
    if (!state || goal <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(state.completed / goal, 1));
  }, [state, goal]);

  const trend = useMemo(() => {
    if (!state) {
      return { label: `— ${t("qaza.trendThisMonth")}`, color: colors.textSecondary };
    }

    const now = new Date();
    const thisStart = nowMonthStart(now).getTime();
    const nextStart = nextMonthStart(now).getTime();
    const prevStart = previousMonthStart(now).getTime();

    const thisMonth = completedDeltaForRange(state.events, thisStart, nextStart);
    const lastMonth = completedDeltaForRange(state.events, prevStart, thisStart);

    if (lastMonth <= 0) {
      if (thisMonth <= 0) {
        return { label: `— ${t("qaza.trendThisMonth")}`, color: colors.textSecondary };
      }
      return { label: `↑ 100% ${t("qaza.trendThisMonth")}`, color: "#1BBF84" };
    }

    const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
    if (pct > 0) {
      return { label: `↑ ${pct}% ${t("qaza.trendThisMonth")}`, color: "#1BBF84" };
    }
    if (pct < 0) {
      return { label: `↓ ${Math.abs(pct)}% ${t("qaza.trendThisMonth")}`, color: "#D66B6B" };
    }
    return { label: `— 0% ${t("qaza.trendThisMonth")}`, color: colors.textSecondary };
  }, [state, t, colors.textSecondary]);

  const applyMutation = async (opts: {
    type: QazaEvent["type"];
    message: string;
    prayerKey?: QazaKey;
    delta?: Partial<Record<QazaKey, number>>;
    updater: (prev: QazaState) => QazaState;
    vibrateMs?: number;
  }) => {
    if (!state) {
      return;
    }

    const before = snapshotFromState(state);
    const next = opts.updater(state);
    const normalizedGoal = next.goal > 0 ? Math.max(next.goal, next.completed) : next.completed + remainingTotal(next);
    const adjusted = {
      ...next,
      goal: normalizedGoal,
      updatedAt: Date.now()
    };

    const event: QazaEvent = {
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      type: opts.type,
      at: Date.now(),
      prayerKey: opts.prayerKey,
      delta: opts.delta,
      snapshotBefore: before,
      snapshotAfter: snapshotFromState(adjusted)
    };

    adjusted.events = [...adjusted.events, event].slice(-500);

    if (opts.vibrateMs) {
      Vibration.vibrate(opts.vibrateMs);
    }

    setUndo({ id: event.id, message: opts.message, snapshotBefore: before });
    await persistState(adjusted);
  };

  const handleStep = (key: QazaKey, delta: 1 | -1) => {
    if (!state) {
      return;
    }
    const current = state.remaining[key];
    const nextValue = Math.max(0, current + delta);
    if (nextValue === current) {
      return;
    }

    if (delta === 1) {
      void applyMutation({
        type: "inc",
        prayerKey: key,
        delta: { [key]: 1 },
        message: t("qaza.actionInc", { prayer: t(prayerKeyToLabelKey(key)) }),
        updater: (prev) => ({
          ...prev,
          remaining: {
            ...prev.remaining,
            [key]: nextValue
          }
        }),
        vibrateMs: 8
      });
      return;
    }

    void applyMutation({
      type: "dec",
      prayerKey: key,
      delta: { [key]: -1 },
      message: t("qaza.actionDec", { prayer: t(prayerKeyToLabelKey(key)) }),
      updater: (prev) => ({
        ...prev,
        remaining: {
          ...prev.remaining,
          [key]: nextValue
        },
        completed: prev.completed + 1
      }),
      vibrateMs: 8
    });
  };

  const handleQuickAdd = () => {
    if (!state) {
      return;
    }

    const delta: Partial<Record<QazaKey, number>> = {};
    for (const prayerKey of QAZA_ORDER) {
      delta[prayerKey] = 1;
    }

    void applyMutation({
      type: "quick_add",
      delta,
      message: t("qaza.actionQuickAdd"),
      updater: (prev) => {
        const nextRemaining = { ...prev.remaining };
        for (const prayerKey of QAZA_ORDER) {
          nextRemaining[prayerKey] += 1;
        }
        return {
          ...prev,
          remaining: nextRemaining
        };
      },
      vibrateMs: 12
    });
  };

  const runReset = () => {
    if (!state) {
      return;
    }

    void applyMutation({
      type: "reset",
      message: t("qaza.actionReset"),
      updater: (prev) => ({
        ...prev,
        remaining: {
          fajr: 0,
          dhuhr: 0,
          asr: 0,
          maghrib: 0,
          isha: 0,
          witr: 0
        },
        completed: 0
      })
    });
  };

  const confirmReset = () => {
    Alert.alert(t("qaza.confirmResetTitle"), t("qaza.confirmResetBody"), [
      { text: t("qaza.cancel"), style: "cancel" },
      { text: t("qaza.reset"), style: "destructive", onPress: runReset }
    ]);
  };

  const handleUndo = async () => {
    if (!state || !undoPayload) {
      return;
    }

    const before = undoPayload.snapshotBefore;
    const next: QazaState = {
      ...state,
      remaining: { ...before.remaining },
      completed: before.completed,
      goal: before.goal,
      events: state.events.slice(0, -1),
      updatedAt: Date.now()
    };

    setUndo(null);
    await persistState(next);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}> 
      <View style={styles.container}>
        <AppBackground />
        <View style={styles.topSection}>
          <View style={styles.headerRow}>
            <Pressable
              style={[
                styles.headerIconButton,
                { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EAF2FC" : "#162638" }
              ]}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={22} color={isLight ? "#5D7690" : "#A8BED6"} />
            </Pressable>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("qaza.title")}</Text>
            <Pressable
              style={[
                styles.headerIconButton,
                { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EAF2FC" : "#162638" }
              ]}
              onPress={() => router.push("/qaza-history" as never)}
            >
              <Ionicons name="time-outline" size={18} color={isLight ? "#5D7690" : "#A8BED6"} />
            </Pressable>
          </View>

          <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.totalHeadRow}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>{t("qaza.totalMissed")}</Text>
              <View style={[styles.trendBadge, { backgroundColor: isLight ? "#E8F8F1" : "#0C3C31" }]}>
                <Text style={[styles.trendText, { color: trend.color }]}>{trend.label}</Text>
              </View>
            </View>

            <Text style={[styles.totalValue, { color: colors.textPrimary }]}>{total.toLocaleString()}</Text>

            <View style={[styles.progressTrack, { backgroundColor: isLight ? "#E6EFFA" : "#102238" }]}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.accent }]} />
            </View>

            <View style={styles.progressMetaRow}>
              <Text style={[styles.progressMetaText, { color: colors.textSecondary }]}>
                {t("qaza.completed")}: {state?.completed ?? 0}
              </Text>
              <Text style={[styles.progressMetaText, { color: colors.textSecondary }]}>
                {t("qaza.goal")}: {goal}
              </Text>
            </View>
          </View>

          <Pressable
            style={[styles.quickAddButton, { backgroundColor: colors.accent }]}
            onPress={handleQuickAdd}
            disabled={!state}
          >
            <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
            <Text style={styles.quickAddText}>{t("qaza.quickAdd")}</Text>
          </Pressable>

          <View style={styles.logHeaderRow}>
            <Text style={[styles.logHeaderTitle, { color: colors.textPrimary }]}>{t("qaza.prayerLog")}</Text>
            <Pressable onPress={confirmReset}>
              <Text style={[styles.logHeaderReset, { color: colors.accent }]}>{t("qaza.resetCounts")}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.listScroll} contentContainerStyle={styles.listWrap} showsVerticalScrollIndicator={false}>
          <View style={styles.listInner}>
            {QAZA_ORDER.map((key) => {
              const count = state?.remaining[key] ?? 0;
              return (
                <View key={key} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}> 
                  <View style={[styles.rowIcon, { backgroundColor: isLight ? "#EAF2FC" : "#1B3148" }]}>
                    <MaterialCommunityIcons
                      name={prayerKeyToIconName(key)}
                      size={18}
                      color={colors.accent}
                    />
                  </View>

                  <View style={styles.rowTextWrap}>
                    <Text style={[styles.rowPrayerName, { color: colors.textPrimary }]}>{t(prayerKeyToLabelKey(key))}</Text>
                    <Text style={[styles.rowRemaining, { color: colors.textSecondary }]}>
                      {count} {t("qaza.remaining")}
                    </Text>
                  </View>

                  <View style={[styles.stepper, { borderColor: colors.cardBorder, backgroundColor: isLight ? "#F7FBFF" : "#102238" }]}> 
                    <Pressable style={styles.stepperButton} onPress={() => handleStep(key, -1)}>
                      <Ionicons name="remove" size={18} color={colors.textPrimary} />
                    </Pressable>
                    <Text style={[styles.stepperValue, { color: colors.textPrimary }]}>{count}</Text>
                    <Pressable style={styles.stepperButton} onPress={() => handleStep(key, 1)}>
                      <Ionicons name="add" size={18} color={colors.textPrimary} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {undoPayload ? (
          <View
            style={[
              styles.snackbar,
              {
                backgroundColor: isLight ? "#E8F2FD" : "#13304B",
                borderColor: colors.cardBorder
              }
            ]}
          >
            <Text numberOfLines={1} style={[styles.snackbarText, { color: colors.textPrimary }]}>
              {undoPayload.message}
            </Text>
            <Pressable onPress={handleUndo} style={styles.snackbarButton}>
              <Text style={[styles.snackbarButtonText, { color: colors.accent }]}>{t("qaza.undo")}</Text>
            </Pressable>
          </View>
        ) : null}
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
  topSection: {
    flexShrink: 0
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
    fontSize: 30,
    fontWeight: "800"
  },
  totalCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16
  },
  totalHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  trendBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  trendText: {
    fontSize: 13,
    fontWeight: "700"
  },
  totalLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontWeight: "700"
  },
  totalValue: {
    marginTop: 10,
    fontSize: 38,
    fontWeight: "800"
  },
  progressTrack: {
    marginTop: 14,
    height: 10,
    borderRadius: 999,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999
  },
  progressMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  progressMetaText: {
    fontSize: 13,
    fontWeight: "600"
  },
  quickAddButton: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  quickAddText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800"
  },
  logHeaderRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  logHeaderTitle: {
    fontSize: 21,
    fontWeight: "800"
  },
  logHeaderReset: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  listScroll: {
    flex: 1,
    marginTop: 10
  },
  listWrap: {
    paddingBottom: 90
  },
  listInner: {
    marginTop: 10,
    gap: 10
  },
  rowCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center"
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10
  },
  rowTextWrap: {
    flex: 1
  },
  rowPrayerName: {
    fontSize: 18,
    fontWeight: "700"
  },
  rowRemaining: {
    marginTop: 2,
    fontSize: 13
  },
  stepper: {
    minWidth: 124,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6
  },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "800",
    minWidth: 30,
    textAlign: "center"
  },
  snackbar: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 18,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  snackbarText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600"
  },
  snackbarButton: {
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  snackbarButtonText: {
    fontSize: 13,
    fontWeight: "800"
  }
});
