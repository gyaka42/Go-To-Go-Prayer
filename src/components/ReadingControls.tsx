import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ReadingSettings, ReadingTextSize } from "@/services/storage";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppTheme } from "@/theme/ThemeProvider";

type ReadingControlsProps = {
  settings: ReadingSettings;
  onChange: (settings: ReadingSettings) => void;
  showTransliterationToggle?: boolean;
};

const textSizeOptions: Array<{ value: ReadingTextSize; labelKey: string; sample: string }> = [
  { value: "small", labelKey: "reading.text_small", sample: "A-" },
  { value: "medium", labelKey: "reading.text_medium", sample: "A" },
  { value: "large", labelKey: "reading.text_large", sample: "A+" }
];

export function ReadingControls({
  settings,
  onChange,
  showTransliterationToggle = false
}: ReadingControlsProps) {
  const { t } = useI18n();
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  const update = (patch: Partial<ReadingSettings>) => {
    onChange({ ...settings, ...patch });
  };

  const activeBackground = isLight ? "#DDEEFF" : "#173553";
  const inactiveBackground = isLight ? "#F1F6FC" : "#0F1D2C";

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="book-outline" size={16} color={colors.accent} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("reading.title")}</Text>
        </View>
        <Text style={[styles.caption, { color: colors.textSecondary }]}>{t("reading.text_size")}</Text>
      </View>

      <View style={styles.optionRow}>
        {textSizeOptions.map((item) => {
          const selected = settings.textSize === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.sizeChip,
                {
                  backgroundColor: selected ? activeBackground : inactiveBackground,
                  borderColor: selected ? colors.accent : colors.cardBorder
                }
              ]}
              onPress={() => update({ textSize: item.value })}
            >
              <Text style={[styles.sizeSample, { color: selected ? colors.accent : colors.textPrimary }]}>
                {item.sample}
              </Text>
              <Text style={[styles.sizeLabel, { color: colors.textSecondary }]}>{t(item.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <ToggleChip
          active={settings.showTranslation}
          label={t("reading.translation")}
          onPress={() => update({ showTranslation: !settings.showTranslation })}
        />
        {showTransliterationToggle ? (
          <ToggleChip
            active={settings.showTransliteration}
            label={t("reading.transliteration")}
            onPress={() => update({ showTransliteration: !settings.showTransliteration })}
          />
        ) : null}
      </View>
    </View>
  );
}

function ToggleChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { colors, resolvedTheme } = useAppTheme();
  const isLight = resolvedTheme === "light";

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      style={[
        styles.toggleChip,
        {
          backgroundColor: active ? (isLight ? "#DCF7E9" : "#173F34") : isLight ? "#F1F6FC" : "#0F1D2C",
          borderColor: active ? "#35C66B" : colors.cardBorder
        }
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={active ? "eye-outline" : "eye-off-outline"}
        size={15}
        color={active ? "#1E9E58" : colors.textSecondary}
      />
      <Text style={[styles.toggleLabel, { color: active ? "#1E9E58" : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 10,
    marginBottom: 12
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  title: {
    fontSize: 14,
    fontWeight: "800"
  },
  caption: {
    fontSize: 12,
    fontWeight: "700"
  },
  optionRow: {
    flexDirection: "row",
    gap: 8
  },
  sizeChip: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7
  },
  sizeSample: {
    fontSize: 16,
    fontWeight: "900"
  },
  sizeLabel: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1
  },
  toggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  toggleChip: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: "800"
  }
});
