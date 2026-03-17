import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ExpoLocation from "expo-location";
import { Magnetometer } from "expo-sensors";
import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { EaseView } from "react-native-ease";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { getCurrentLocationDetails } from "@/services/location";
import { registerForLocalNotifications } from "@/services/notifications";
import { getSettings, saveOnboardingSeen, saveSettings } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

type StepId = "location" | "notifications" | "qibla" | "widgets";

type PermissionState = "idle" | "granted" | "denied";

const STEP_ORDER: StepId[] = ["location", "notifications", "qibla", "widgets"];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isLight = resolvedTheme === "light";

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [locationState, setLocationState] = useState<PermissionState>("idle");
  const [notificationState, setNotificationState] = useState<PermissionState>("idle");
  const [pressedAction, setPressedAction] = useState<string | null>(null);
  const enterTransition = useMotionTransition(easeEnterTransition);
  const pressTransition = useMotionTransition(easePressTransition);

  const step = STEP_ORDER[index];

  const statusText = useMemo(() => {
    if (step === "location") {
      if (locationState === "granted") return t("onboarding.status_granted");
      if (locationState === "denied") return t("onboarding.status_denied");
    }
    if (step === "notifications") {
      if (notificationState === "granted") return t("onboarding.status_granted");
      if (notificationState === "denied") return t("onboarding.status_denied");
    }
    if (step === "qibla") {
      return "";
    }
    return "";
  }, [locationState, notificationState, step, t]);

  const statusTone = useMemo(() => {
    if (!statusText) {
      return "info" as const;
    }
    if (locationState === "denied" || notificationState === "denied") {
      return "warning" as const;
    }
    if (locationState === "granted" || notificationState === "granted") {
      return "success" as const;
    }
    return "info" as const;
  }, [locationState, notificationState, statusText]);

  const nextStep = () => {
    if (index >= STEP_ORDER.length - 1) {
      return;
    }
    setIndex((current) => Math.min(current + 1, STEP_ORDER.length - 1));
  };

  const prevStep = () => {
    if (index <= 0) {
      return;
    }
    setIndex((current) => Math.max(current - 1, 0));
  };

  const finishOnboarding = async () => {
    setBusy(true);
    try {
      await saveOnboardingSeen(true);
      router.replace("/(tabs)");
    } finally {
      setBusy(false);
    }
  };

  const handleLocationPermission = async () => {
    setBusy(true);
    try {
      const permission = await ExpoLocation.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationState("denied");
        return;
      }

      const settings = await getSettings();
      await saveSettings({
        ...settings,
        locationMode: "gps"
      });
      await getCurrentLocationDetails().catch(() => null);
      setLocationState("granted");
      nextStep();
    } finally {
      setBusy(false);
    }
  };

  const handleNotificationsPermission = async () => {
    setBusy(true);
    try {
      const granted = await registerForLocalNotifications();
      setNotificationState(granted ? "granted" : "denied");
      if (granted) {
        nextStep();
      }
    } finally {
      setBusy(false);
    }
  };

  const goNextFromQibla = async () => {
    setBusy(true);
    try {
      // Optional check only for telemetry/future UX decisions.
      await Magnetometer.isAvailableAsync().catch(() => false);
      nextStep();
    } finally {
      setBusy(false);
    }
  };

  const renderIllustration = () => {
    if (step === "location") {
      return (
        <View style={styles.illustrationWrap}>
          <View style={[styles.bigCircle, { backgroundColor: isLight ? "#E7F1FD" : "#0F2A45" }]}>
            <Ionicons name="location" size={54} color="#2B8CEE" />
          </View>
          <View style={styles.smallBadge}>
            <Ionicons name="navigate" size={20} color="#EAF4FF" />
          </View>
        </View>
      );
    }

    if (step === "notifications") {
      return (
        <View style={[styles.illustrationCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
          <View style={styles.centerBlueDot}>
            <Ionicons name="notifications" size={48} color="#EAF4FF" />
          </View>
        </View>
      );
    }

    if (step === "qibla") {
      return (
        <View style={[styles.illustrationCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
          <View style={[styles.compassRing, { borderColor: isLight ? "#BCD8F4" : "#1F4467" }]}>
            <View style={[styles.centerBlueDot, { width: 116, height: 116, borderRadius: 58 }]}>
              <MaterialCommunityIcons name="compass-outline" size={50} color="#EAF4FF" />
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.illustrationCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
        <Image
          source={require("../assets/images/widgets.png")}
          style={[
            styles.widgetsImage,
            {
              tintColor: isLight ? "#2B8CEE" : "#EAF4FF"
            }
          ]}
          resizeMode="contain"
        />
      </View>
    );
  };

  const title =
    step === "location"
      ? t("onboarding.location_title")
      : step === "notifications"
        ? t("onboarding.notifications_title")
        : step === "qibla"
          ? t("onboarding.qibla_title")
          : t("onboarding.widgets_title");

  const description =
    step === "location"
      ? t("onboarding.location_body")
      : step === "notifications"
        ? t("onboarding.notifications_body")
        : step === "qibla"
          ? t("onboarding.qibla_body")
          : t("onboarding.widgets_body");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <AppBackground />

        <EaseView style={styles.topRow} initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <EaseView animate={{ scale: pressedAction === "back" ? 0.92 : 1, opacity: index === 0 ? 0.55 : 1 }} transition={pressTransition}>
            <Pressable
              onPress={prevStep}
              disabled={index === 0}
              style={styles.backButton}
              onPressIn={() => setPressedAction("back")}
              onPressOut={() => setPressedAction(null)}
            >
              <Ionicons
                name="arrow-back"
                size={24}
                color={index === 0 ? colors.textSecondary : colors.textPrimary}
              />
            </Pressable>
          </EaseView>
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t("onboarding.header")}</Text>
          <EaseView animate={{ scale: pressedAction === "close" ? 0.92 : 1 }} transition={pressTransition}>
            <Pressable
              onPress={() => void finishOnboarding()}
              style={styles.closeButton}
              onPressIn={() => setPressedAction("close")}
              onPressOut={() => setPressedAction(null)}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </EaseView>
        </EaseView>

        <EaseView style={styles.stepDots} initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
          {STEP_ORDER.map((_, dotIndex) => (
            <View
              key={`dot-${dotIndex}`}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    dotIndex === index ? "#2B8CEE" : isLight ? "#C6D9EE" : "#27435D"
                }
              ]}
            />
          ))}
        </EaseView>

        <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
          {renderIllustration()}
        </EaseView>

        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        </EaseView>
        <EaseView initialAnimate={easeInitialLift} animate={easeVisibleLift} transition={enterTransition}>
          <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
        </EaseView>

        {statusText ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
            <StatusChip label={statusText} tone={statusTone} />
          </EaseView>
        ) : null}

        {step === "qibla" ? (
          <EaseView initialAnimate={easeInitialFade} animate={easeVisibleFade} transition={enterTransition}>
            <View style={[styles.tipCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
              <Ionicons name="bulb-outline" size={18} color="#2B8CEE" />
              <Text style={[styles.tipText, { color: colors.textSecondary }]}>{t("onboarding.qibla_tip")}</Text>
            </View>
          </EaseView>
        ) : null}

        <View style={styles.actions}>
          {step === "location" ? (
            <>
              <EaseView animate={{ scale: pressedAction === "location-primary" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void handleLocationPermission()}
                  disabled={busy}
                  onPressIn={() => setPressedAction("location-primary")}
                  onPressOut={() => setPressedAction(null)}
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryLabel}>{t("onboarding.location_primary")}</Text>}
                </Pressable>
              </EaseView>
              <EaseView animate={{ scale: pressedAction === "location-secondary" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: colors.cardBorder }]}
                  onPress={nextStep}
                  disabled={busy}
                  onPressIn={() => setPressedAction("location-secondary")}
                  onPressOut={() => setPressedAction(null)}
                >
                  <Text style={[styles.secondaryLabel, { color: colors.textPrimary }]}>{t("onboarding.location_secondary")}</Text>
                </Pressable>
              </EaseView>
            </>
          ) : null}

          {step === "notifications" ? (
            <>
              <EaseView animate={{ scale: pressedAction === "notifications-primary" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void handleNotificationsPermission()}
                  disabled={busy}
                  onPressIn={() => setPressedAction("notifications-primary")}
                  onPressOut={() => setPressedAction(null)}
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryLabel}>{t("onboarding.notifications_primary")}</Text>}
                </Pressable>
              </EaseView>
              <EaseView animate={{ scale: pressedAction === "notifications-skip" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={[styles.textButton]}
                  onPress={nextStep}
                  disabled={busy}
                  onPressIn={() => setPressedAction("notifications-skip")}
                  onPressOut={() => setPressedAction(null)}
                >
                  <Text style={[styles.textButtonLabel, { color: colors.textSecondary }]}>{t("onboarding.skip_for_now")}</Text>
                </Pressable>
              </EaseView>
            </>
          ) : null}

          {step === "qibla" ? (
            <>
              <EaseView animate={{ scale: pressedAction === "qibla-next" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void goNextFromQibla()}
                  disabled={busy}
                  onPressIn={() => setPressedAction("qibla-next")}
                  onPressOut={() => setPressedAction(null)}
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryLabel}>{t("onboarding.next")}</Text>}
                </Pressable>
              </EaseView>
            </>
          ) : null}

          {step === "widgets" ? (
            <>
              <EaseView animate={{ scale: pressedAction === "widgets-primary" ? 0.985 : 1, opacity: busy ? 0.8 : 1 }} transition={pressTransition}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void finishOnboarding()}
                  disabled={busy}
                  onPressIn={() => setPressedAction("widgets-primary")}
                  onPressOut={() => setPressedAction(null)}
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryLabel}>{t("onboarding.widgets_primary")}</Text>}
                </Pressable>
              </EaseView>
              <Text style={[styles.footnote, { color: colors.textSecondary }]}>{t("onboarding.widgets_footnote")}</Text>
            </>
          ) : null}
        </View>
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
    paddingHorizontal: 22,
    paddingTop: 8
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  topTitle: {
    fontSize: 28,
    fontWeight: "800"
  },
  stepDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    marginBottom: 18
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  illustrationWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 18
  },
  bigCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: "center",
    justifyContent: "center"
  },
  smallBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2B8CEE",
    marginTop: -38,
    marginLeft: 136,
    borderWidth: 4,
    borderColor: "#FFFFFF"
  },
  illustrationCard: {
    height: 220,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20
  },
  centerBlueDot: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2B8CEE"
  },
  widgetsImage: {
    width: 110,
    height: 110
  },
  compassRing: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center"
  },
  title: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "800",
    textAlign: "center"
  },
  description: {
    marginTop: 16,
    fontSize: 25,
    lineHeight: 34,
    textAlign: "center"
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: "center",
    fontWeight: "700"
  },
  tipCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  tipText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20
  },
  actions: {
    marginTop: "auto",
    gap: 12
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "#2B8CEE",
    alignItems: "center",
    justifyContent: "center"
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800"
  },
  secondaryButton: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryLabel: {
    fontSize: 22,
    fontWeight: "700"
  },
  textButton: {
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  textButtonLabel: {
    fontSize: 20,
    fontWeight: "500"
  },
  footnote: {
    textAlign: "center",
    fontSize: 15
  }
});
