import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "@/theme/ThemeProvider";

export function RamadanScreenHeader(props: {
  title: string;
  subtitle?: string;
  backLabel: string;
  onBack: () => void;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.backLabel}
        style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        onPress={props.onBack}
      >
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </Pressable>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.actionIcon && props.onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.actionLabel}
          style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onPress={props.onAction}
        >
          <Ionicons name={props.actionIcon} size={22} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    paddingBottom: 14
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  textWrap: { flex: 1 },
  title: { fontSize: 25, fontWeight: "900" },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  spacer: { width: 44, height: 44 }
});
