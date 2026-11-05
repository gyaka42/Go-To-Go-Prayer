import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/i18n/I18nProvider";
import { localDateKey, RamadanRange } from "@/ramadan/calendar";
import { RamadanTimingRow } from "@/ramadan/timings";
import { RamadanDayEntry, RamadanFastStatus } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

function statusIcon(status: RamadanFastStatus): keyof typeof Ionicons.glyphMap {
  if (status === "fasted") return "checkmark-circle";
  if (status === "make_up_later") return "time";
  if (status === "excused") return "heart";
  return "checkmark-done-circle";
}

export function RamadanStatusModal(props: {
  selectedDay: RamadanTimingRow | null;
  range: RamadanRange;
  entries: Record<string, RamadanDayEntry>;
  formatDate: (date: Date) => string;
  onSelect: (dateKey: string, status: RamadanFastStatus | null) => void | Promise<void>;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const selectedKey = props.selectedDay?.dateKey ?? "";
  const selectedStatus = props.entries[selectedKey]?.status;

  return (
    <Modal
      visible={Boolean(props.selectedDay)}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <Pressable style={styles.overlay} onPress={props.onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onPress={() => undefined}
        >
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("ramadan.record_day")}</Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {props.selectedDay
              ? `${props.formatDate(props.selectedDay.date)} • ${t("ramadan.day")} ${
                  props.range.days.findIndex((day) => localDateKey(day) === props.selectedDay?.dateKey) + 1
                }`
              : ""}
          </Text>
          {([
            ["fasted", "#22C55E"],
            ["make_up_later", "#F59E0B"],
            ["excused", "#A855F7"],
            ["made_up", colors.accent]
          ] as const).map(([status, color]) => (
            <Pressable
              key={status}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedStatus === status }}
              style={[
                styles.option,
                { borderColor: colors.cardBorder },
                selectedStatus === status && { backgroundColor: colors.accentSoft }
              ]}
              onPress={() => {
                if (props.selectedDay) void props.onSelect(props.selectedDay.dateKey, status);
              }}
            >
              <Ionicons name={statusIcon(status)} size={22} color={color} />
              <Text style={[styles.optionText, { color: colors.textPrimary }]}>
                {t(`ramadan.status_${status}`)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.clearButton}
            onPress={() => {
              if (props.selectedDay) void props.onSelect(props.selectedDay.dateKey, null);
            }}
          >
            <Text style={[styles.clearText, { color: colors.textSecondary }]}>
              {t("ramadan.clear_status")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  card: { width: "100%", maxWidth: 460, borderRadius: 22, borderWidth: 1, padding: 18 },
  title: { fontSize: 21, fontWeight: "900" },
  date: { marginTop: 4, marginBottom: 14, fontSize: 13, textTransform: "capitalize" },
  option: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 9,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  optionText: { fontSize: 15, fontWeight: "700", flex: 1 },
  clearButton: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 8 },
  clearText: { fontSize: 13, fontWeight: "700" }
});
