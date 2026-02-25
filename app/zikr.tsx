import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import {
  getZikrSettings,
  getZikrState,
  saveZikrSettings,
  saveZikrState,
  ZikrEntry,
  ZikrKey,
  ZikrSettings,
  ZikrState
} from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

const ZIKR_KEYS: ZikrKey[] = ["subhanallah", "alhamdulillah", "allahuakbar", "la_ilaha_illallah", "custom"];

function zikrNameKey(key: ZikrKey): string {
  switch (key) {
    case "subhanallah":
      return "zikr.subhanallah";
    case "alhamdulillah":
      return "zikr.alhamdulillah";
    case "allahuakbar":
      return "zikr.allahuakbar";
    case "la_ilaha_illallah":
      return "zikr.lailahaillallah";
    default:
      return "zikr.custom";
  }
}

function zikrSubtitleKey(key: ZikrKey): string | null {
  switch (key) {
    case "subhanallah":
      return "zikr.subhanallahSubtitle";
    case "alhamdulillah":
      return "zikr.alhamdulillahSubtitle";
    case "allahuakbar":
      return "zikr.allahuakbarSubtitle";
    case "la_ilaha_illallah":
      return "zikr.lailahaillallahSubtitle";
    default:
      return null;
  }
}

export default function ZikrScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  const [state, setState] = useState<ZikrState | null>(null);
  const [zikrSettings, setZikrSettings] = useState<ZikrSettings>({ hapticsEnabled: true });
  const [loading, setLoading] = useState(true);

  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState("100");
  const [targetError, setTargetError] = useState<string | null>(null);

  const [showSelectorModal, setShowSelectorModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customLabelInput, setCustomLabelInput] = useState("");
  const [customSubtitleInput, setCustomSubtitleInput] = useState("");

  const activeEntry: ZikrEntry =
    state?.entries[state.activeKey] ?? { count: 0, target: 100, updatedAt: Date.now(), label: "Custom", subtitle: "" };

  const activeLabel = useMemo(() => {
    if (!state) {
      return t("zikr.subhanallah");
    }
    if (state.activeKey === "custom") {
      return activeEntry.label?.trim() || t("zikr.custom");
    }
    return t(zikrNameKey(state.activeKey));
  }, [activeEntry.label, state, t]);

  const activeSubtitle = useMemo(() => {
    if (!state) {
      return t("zikr.subhanallahSubtitle");
    }
    if (state.activeKey === "custom") {
      return activeEntry.subtitle?.trim() ?? "";
    }
    const key = zikrSubtitleKey(state.activeKey);
    return key ? t(key) : "";
  }, [activeEntry.subtitle, state, t]);

  const progressRatio = useMemo(() => {
    if (activeEntry.target <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(activeEntry.count / activeEntry.target, 1));
  }, [activeEntry.count, activeEntry.target]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [savedState, savedSettings] = await Promise.all([getZikrState(), getZikrSettings()]);
      if (!mounted) {
        return;
      }
      setState(savedState);
      setZikrSettings(savedSettings);
      setTargetInput(String(savedState.entries[savedState.activeKey].target));
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const updateState = async (next: ZikrState) => {
    setState(next);
    await saveZikrState(next);
  };

  const updateActiveEntry = (updater: (entry: ZikrEntry) => ZikrEntry) => {
    if (!state) {
      return;
    }
    const nextEntry = updater(state.entries[state.activeKey]);
    const next: ZikrState = {
      ...state,
      entries: {
        ...state.entries,
        [state.activeKey]: nextEntry
      },
      updatedAt: Date.now()
    };
    void updateState(next);
  };

  const handleIncrement = () => {
    if (!state) {
      return;
    }
    const currentEntry = state.entries[state.activeKey];
    const nextCount = currentEntry.count + 1;

    if (zikrSettings.hapticsEnabled) {
      Vibration.vibrate(10);
      if (currentEntry.count < currentEntry.target && nextCount === currentEntry.target) {
        Vibration.vibrate([0, 30, 50, 30]);
      }
    }

    updateActiveEntry((entry) => ({
      ...entry,
      count: nextCount,
      updatedAt: Date.now()
    }));
  };

  const handleReset = () => {
    updateActiveEntry((entry) => ({
      ...entry,
      count: 0,
      updatedAt: Date.now()
    }));
  };

  const handleSaveTarget = () => {
    const parsed = Number.parseInt(targetInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100000) {
      setTargetError(t("zikr.invalidTarget"));
      return;
    }

    setTargetError(null);
    setShowTargetModal(false);
    updateActiveEntry((entry) => ({
      ...entry,
      target: parsed,
      updatedAt: Date.now()
    }));
  };

  const handleToggleHaptics = (value: boolean) => {
    const next = { hapticsEnabled: value };
    setZikrSettings(next);
    void saveZikrSettings(next);
  };

  const toggleHaptics = () => {
    handleToggleHaptics(!zikrSettings.hapticsEnabled);
  };

  const handleSelectZikr = (key: ZikrKey) => {
    if (!state) {
      return;
    }
    if (state.activeKey === key) {
      setShowSelectorModal(false);
      return;
    }
    const next: ZikrState = {
      ...state,
      activeKey: key,
      updatedAt: Date.now()
    };
    setShowSelectorModal(false);
    setTargetInput(String(next.entries[key].target));
    void updateState(next);
  };

  const openCustomEditor = () => {
    if (!state) {
      return;
    }
    setShowSelectorModal(false);
    setCustomLabelInput(state.entries.custom.label || t("zikr.custom"));
    setCustomSubtitleInput(state.entries.custom.subtitle || "");
    setTimeout(() => {
      setShowCustomModal(true);
    }, 0);
  };

  const saveCustomMeta = () => {
    if (!state) {
      return;
    }
    const label = customLabelInput.trim();
    const subtitle = customSubtitleInput.trim();
    const next: ZikrState = {
      ...state,
      entries: {
        ...state.entries,
        custom: {
          ...state.entries.custom,
          label: label.length > 0 ? label : t("zikr.custom"),
          subtitle,
          updatedAt: Date.now()
        }
      },
      updatedAt: Date.now()
    };
    setShowCustomModal(false);
    void updateState(next);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />

        <View style={styles.headerRow}>
          <Pressable
            style={[
              styles.backButton,
              {
                borderColor: colors.cardBorder,
                backgroundColor: isLight ? "#EAF2FC" : "#162638"
              }
            ]}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={22} color={isLight ? "#5D7690" : "#A8BED6"} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("zikr.title")}</Text>
        </View>

        <View style={[styles.goalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}> 
          <Text style={[styles.goalLabel, { color: colors.textSecondary }]}>{t("zikr.currentGoal")}</Text>
          <Text style={[styles.goalValue, { color: colors.textPrimary }]}> 
            {activeEntry.count} / {activeEntry.target}
          </Text>
        </View>

        <Pressable
          style={[
            styles.ring,
            {
              borderColor: isLight ? "#88B9EC" : "#2C8DEE",
              backgroundColor: isLight ? "#E9F3FF" : "#10253A"
            }
          ]}
          onPress={handleIncrement}
          disabled={loading || !state}
        >
          <Text style={[styles.ringCount, { color: colors.textPrimary }]}>{activeEntry.count}</Text>
          <Text style={[styles.ringHint, { color: colors.textSecondary }]}>{loading ? t("common.loading") : "+1"}</Text>
        </Pressable>
        <View
          style={[
            styles.progressTrack,
            { borderColor: colors.cardBorder, backgroundColor: isLight ? "#E4EEF9" : "#122334" }
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(progressRatio * 100)}%`,
                backgroundColor: colors.accent
              }
            ]}
          />
        </View>

        <Pressable
          style={[styles.zikrTextWrap, { borderColor: colors.cardBorder }]}
          onPress={() => setShowSelectorModal(true)}
          disabled={!state}
        >
          <Text style={[styles.zikrName, { color: colors.textPrimary }]}>{activeLabel}</Text>
          {activeSubtitle ? <Text style={[styles.zikrSubtitle, { color: colors.textSecondary }]}>{activeSubtitle}</Text> : null}
        </Pressable>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={handleReset}
            disabled={!state}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons name="refresh-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>{t("zikr.reset")}</Text>
            </View>
          </Pressable>
          <Pressable
            style={[
              styles.actionButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder
              }
            ]}
            disabled={!state}
            onPress={() => {
              if (!state) {
                return;
              }
              setTargetError(null);
              setTargetInput(String(state.entries[state.activeKey].target));
              setShowTargetModal(true);
            }}
          >
            <View style={styles.actionButtonContent}>
              <Image
                source={require("../assets/images/target.png")}
                style={[styles.actionPngIcon, { tintColor: colors.textPrimary }]}
                resizeMode="contain"
              />
              <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>{t("zikr.target")}</Text>
            </View>
          </Pressable>
        </View>

        <Pressable style={styles.hapticsRow} onPress={toggleHaptics}>
          <View
            style={[
              styles.hapticIconWrap,
              {
                borderColor: isLight ? "#BFD2E7" : "#284766",
                backgroundColor: "transparent"
              },
              !zikrSettings.hapticsEnabled
                ? {
                    backgroundColor: isLight ? "#5D7690" : "#7E9BB9",
                    borderColor: isLight ? "#5D7690" : "#7E9BB9"
                  }
                : null
            ]}
          >
            <Image
              source={require("../assets/images/haptic.png")}
              style={[
                styles.hapticPngIcon,
                {
                  tintColor: zikrSettings.hapticsEnabled
                    ? isLight
                      ? "#587391"
                      : "#8EA4BF"
                    : "#FFFFFF"
                }
              ]}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.hapticsText, { color: colors.textSecondary }]}>
            {zikrSettings.hapticsEnabled ? t("zikr.hapticEnabled") : t("zikr.hapticDisabled")}
          </Text>
        </Pressable>
      </View>

      <Modal visible={showTargetModal} animationType="fade" transparent onRequestClose={() => setShowTargetModal(false)}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder
              }
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t("zikr.setTargetTitle")}</Text>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{t("zikr.presets")}</Text>
            <View style={styles.presetRow}>
              {[33, 99, 100, 1000].map((preset) => (
                <Pressable
                  key={preset}
                  style={[
                    styles.presetChip,
                    { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EFF5FC" : "#1A2D42" }
                  ]}
                  onPress={() => {
                    setTargetError(null);
                    setTargetInput(String(preset));
                  }}
                >
                  <Text style={[styles.presetChipText, { color: colors.textPrimary }]}>{preset}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={targetInput}
              onChangeText={(value) => {
                setTargetError(null);
                setTargetInput(value.replace(/[^0-9]/g, ""));
              }}
              keyboardType="number-pad"
              placeholder="100"
              placeholderTextColor={isLight ? "#8AA0B7" : "#7A94B0"}
              style={[
                styles.targetInput,
                {
                  borderColor: colors.cardBorder,
                  color: colors.textPrimary,
                  backgroundColor: isLight ? "#F6FAFF" : "#112235"
                }
              ]}
            />
            {targetError ? <Text style={styles.errorText}>{targetError}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable
                style={[
                  styles.modalButton,
                  { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EFF5FC" : "#1A2D42" }
                ]}
                onPress={() => setShowTargetModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>{t("zikr.cancel")}</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalButtonPrimary]} onPress={handleSaveTarget}>
                <Text style={[styles.modalButtonText, styles.modalButtonPrimaryText]}>{t("zikr.save")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSelectorModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowSelectorModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder
              }
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t("zikr.selectTitle")}</Text>
            <View style={styles.selectorList}>
              {state
                ? ZIKR_KEYS.map((key) => {
                    const entry = state.entries[key];
                    const isActive = state.activeKey === key;
                    const label = key === "custom" ? entry.label?.trim() || t("zikr.custom") : t(zikrNameKey(key));
                    return (
                      <View key={key} style={styles.selectorRow}>
                        <Pressable
                          style={[
                            styles.selectorItem,
                            {
                              borderColor: isActive ? colors.accent : colors.cardBorder,
                              backgroundColor: isActive ? (isLight ? "#E9F3FF" : "#143257") : isLight ? "#EFF5FC" : "#1A2D42"
                            }
                          ]}
                          onPress={() => handleSelectZikr(key)}
                        >
                          <Text style={[styles.selectorItemTitle, { color: colors.textPrimary }]}>{label}</Text>
                          <Text style={[styles.selectorItemMeta, { color: colors.textSecondary }]}>
                            {entry.count} / {entry.target}
                          </Text>
                        </Pressable>
                        {key === "custom" ? (
                          <Pressable
                            style={[styles.editButton, { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EFF5FC" : "#1A2D42" }]}
                            onPress={openCustomEditor}
                          >
                            <Text style={[styles.editButtonText, { color: colors.textPrimary }]}>{t("zikr.editCustom")}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                : null}
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={[
                  styles.modalButton,
                  { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EFF5FC" : "#1A2D42" }
                ]}
                onPress={() => setShowSelectorModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>{t("zikr.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCustomModal} animationType="fade" transparent onRequestClose={() => setShowCustomModal(false)}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder
              }
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t("zikr.editCustom")}</Text>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{t("zikr.customLabel")}</Text>
            <TextInput
              value={customLabelInput}
              onChangeText={setCustomLabelInput}
              placeholder={t("zikr.custom")}
              placeholderTextColor={isLight ? "#8AA0B7" : "#7A94B0"}
              style={[
                styles.targetInput,
                {
                  marginTop: 8,
                  borderColor: colors.cardBorder,
                  color: colors.textPrimary,
                  backgroundColor: isLight ? "#F6FAFF" : "#112235"
                }
              ]}
            />

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>{t("zikr.customSubtitle")}</Text>
            <TextInput
              value={customSubtitleInput}
              onChangeText={setCustomSubtitleInput}
              placeholder={t("zikr.customSubtitle")}
              placeholderTextColor={isLight ? "#8AA0B7" : "#7A94B0"}
              style={[
                styles.targetInput,
                {
                  marginTop: 8,
                  borderColor: colors.cardBorder,
                  color: colors.textPrimary,
                  backgroundColor: isLight ? "#F6FAFF" : "#112235"
                }
              ]}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[
                  styles.modalButton,
                  { borderColor: colors.cardBorder, backgroundColor: isLight ? "#EFF5FC" : "#1A2D42" }
                ]}
                onPress={() => setShowCustomModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>{t("zikr.cancel")}</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalButtonPrimary]} onPress={saveCustomMeta}>
                <Text style={[styles.modalButtonText, styles.modalButtonPrimaryText]}>{t("zikr.save")}</Text>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  goalCard: {
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  goalLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#8EA4BF"
  },
  goalValue: {
    marginTop: 8,
    fontSize: 34,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  ring: {
    marginTop: 20,
    width: 248,
    height: 248,
    borderRadius: 124,
    borderWidth: 8,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center"
  },
  ringCount: {
    fontSize: 56,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  ringHint: {
    marginTop: 8,
    fontSize: 14,
    color: "#8EA4BF"
  },
  progressTrack: {
    marginTop: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    alignSelf: "center",
    width: "80%"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999
  },
  zikrTextWrap: {
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 6
  },
  zikrName: {
    fontSize: 26,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  zikrSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#8EA4BF"
  },
  buttonRow: {
    marginTop: 20,
    flexDirection: "row",
    gap: 10
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: "700"
  },
  actionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  actionPngIcon: {
    width: 18,
    height: 18
  },
  hapticsRow: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  hapticIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  hapticPngIcon: {
    width: 14,
    height: 14
  },
  hapticsText: {
    fontSize: 12,
    letterSpacing: 1.8,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000077",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20
  },
  modalCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    maxWidth: 560
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800"
  },
  modalLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700"
  },
  presetRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  presetChip: {
    minWidth: 62,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  presetChipText: {
    fontSize: 14,
    fontWeight: "700"
  },
  targetInput: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: "700"
  },
  errorText: {
    marginTop: 8,
    color: "#B63852",
    fontSize: 13,
    fontWeight: "600"
  },
  modalActions: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10
  },
  modalButton: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  modalButtonPrimary: {
    borderWidth: 0,
    backgroundColor: "#2B8CEE"
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "700"
  },
  modalButtonPrimaryText: {
    color: "#FFFFFF"
  },
  selectorList: {
    marginTop: 12,
    gap: 10
  },
  selectorRow: {
    gap: 8
  },
  selectorItem: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  selectorItemTitle: {
    fontSize: 17,
    fontWeight: "700"
  },
  selectorItemMeta: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600"
  },
  editButton: {
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: "700"
  }
});
