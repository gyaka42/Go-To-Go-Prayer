import { Ionicons } from "@expo/vector-icons";
import { EaseView } from "react-native-ease";
import { StyleSheet, Text, View } from "react-native";
import { easeInitialFade, easeStatusChipTransition, easeVisibleFade } from "@/animation/ease";
import { useMotionTransition } from "@/animation/useReducedMotion";
import { useAppTheme } from "@/theme/ThemeProvider";

type StatusTone = "success" | "loading" | "error" | "info" | "warning";

interface StatusChipProps {
  label: string;
  tone?: StatusTone;
  visible?: boolean;
}

function toneStyles(tone: StatusTone, isLight: boolean) {
  switch (tone) {
    case "success":
      return {
        backgroundColor: isLight ? "#DCF7E9" : "#173F34",
        textColor: isLight ? "#1E7D4C" : "#9BE1B8",
        icon: "checkmark-circle" as const
      };
    case "loading":
      return {
        backgroundColor: isLight ? "#E4F1FF" : "#173553",
        textColor: isLight ? "#2369B7" : "#A8D0FF",
        icon: "sync-circle" as const
      };
    case "error":
      return {
        backgroundColor: isLight ? "#FFE7EC" : "#3A2230",
        textColor: isLight ? "#B0415E" : "#FFB2C3",
        icon: "alert-circle" as const
      };
    case "warning":
      return {
        backgroundColor: isLight ? "#FFF1DB" : "#3A2F1C",
        textColor: isLight ? "#9C6A19" : "#FFD996",
        icon: "warning" as const
      };
    case "info":
    default:
      return {
        backgroundColor: isLight ? "#EAF2FC" : "#1B2D41",
        textColor: isLight ? "#466784" : "#B4CBE4",
        icon: "information-circle" as const
      };
  }
}

export function StatusChip({ label, tone = "info", visible = true }: StatusChipProps) {
  const { resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";
  const transition = useMotionTransition(easeStatusChipTransition);
  const tones = toneStyles(tone, isLight);

  if (!visible || !label) {
    return null;
  }

  return (
    <EaseView
      style={styles.wrap}
      initialAnimate={easeInitialFade}
      animate={{
        ...easeVisibleFade,
        backgroundColor: tones.backgroundColor
      }}
      transition={transition}
    >
      <View style={styles.content}>
        <Ionicons name={tones.icon} size={14} color={tones.textColor} />
        <Text style={[styles.label, { color: tones.textColor }]}>{label}</Text>
      </View>
    </EaseView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
    justifyContent: "center"
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  label: {
    fontSize: 12,
    fontWeight: "700"
  }
});
