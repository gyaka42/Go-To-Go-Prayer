import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/i18n/I18nProvider";
import { RamadanTimingRow } from "@/ramadan/timings";
import { RamadanDayEntry } from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";

function statusIcon(entry?: RamadanDayEntry): keyof typeof Ionicons.glyphMap {
  if (entry?.status === "fasted") return "checkmark-circle";
  if (entry?.status === "make_up_later") return "time";
  if (entry?.status === "excused") return "heart";
  if (entry?.status === "made_up") return "checkmark-done-circle";
  return "ellipse-outline";
}

export function RamadanCalendarTable(props: {
  rows: RamadanTimingRow[];
  rangeStart: Date;
  currentDay: number | null;
  entries: Record<string, RamadanDayEntry>;
  formatDate: (date: Date) => string;
  onSelect: (row: RamadanTimingRow) => void;
  disabledAfterDate?: Date;
  compact?: boolean;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();

  const dayNumber = (row: RamadanTimingRow) => {
    const startUtc = Date.UTC(props.rangeStart.getFullYear(), props.rangeStart.getMonth(), props.rangeStart.getDate());
    const rowUtc = Date.UTC(row.date.getFullYear(), row.date.getMonth(), row.date.getDate());
    return Math.round((rowUtc - startUtc) / 86_400_000) + 1;
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={[styles.row, styles.columns, { borderBottomColor: colors.cardBorder }]}>
        <Text style={[styles.dayColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.day")}</Text>
        <Text style={[styles.dateColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.date")}</Text>
        <Text style={[styles.timeColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.imsak")}</Text>
        <Text style={[styles.timeColumn, styles.columnLabel, { color: colors.textSecondary }]}>{t("ramadan.iftar")}</Text>
        <View style={styles.statusColumn} />
      </View>
      {props.rows.map((row, index) => {
        const number = dayNumber(row);
        const today = number === props.currentDay;
        const entry = props.entries[row.dateKey];
        const disabled = props.disabledAfterDate
          ? new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate()).getTime() >
            new Date(
              props.disabledAfterDate.getFullYear(),
              props.disabledAfterDate.getMonth(),
              props.disabledAfterDate.getDate()
            ).getTime()
          : false;
        return (
          <Pressable
            key={row.dateKey}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            style={[
              styles.row,
              props.compact && styles.compactRow,
              index < props.rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder },
              today && { backgroundColor: colors.accentSoft },
              disabled && styles.disabled
            ]}
            onPress={() => props.onSelect(row)}
          >
            <Text style={[styles.dayColumn, styles.dayNumber, { color: today ? colors.accent : colors.textPrimary }]}>{number}</Text>
            <Text style={[styles.dateColumn, styles.rowText, { color: colors.textSecondary }]} numberOfLines={1}>
              {props.formatDate(row.date)}
            </Text>
            <Text style={[styles.timeColumn, styles.rowTime, { color: colors.textPrimary }]}>{row.timings?.times.Fajr ?? "—"}</Text>
            <Text style={[styles.timeColumn, styles.rowTime, { color: colors.textPrimary }]}>{row.timings?.times.Maghrib ?? "—"}</Text>
            <View style={styles.statusColumn}>
              <Ionicons name={statusIcon(entry)} size={19} color={entry ? colors.accent : colors.textSecondary} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 60, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  compactRow: { minHeight: 50 },
  columns: { minHeight: 42, borderBottomWidth: 1 },
  columnLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  dayColumn: { width: 34 },
  dateColumn: { flex: 1, minWidth: 68 },
  timeColumn: { width: 58, textAlign: "center" },
  statusColumn: { width: 26, alignItems: "flex-end" },
  dayNumber: { fontSize: 15, fontWeight: "900" },
  rowText: { fontSize: 12, textTransform: "capitalize" },
  rowTime: { fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.7 }
});
