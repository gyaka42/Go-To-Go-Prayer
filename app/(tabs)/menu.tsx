import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppTheme } from "@/theme/ThemeProvider";

export default function MenuScreen() {
  const router = useRouter();
  const { colors, resolvedTheme } = useAppTheme();
  const { t } = useI18n();
  const isLight = resolvedTheme === "light";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <AppBackground />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("menu.title")}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("menu.subtitle")}</Text>

        <Pressable
          style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onPress={() => router.push("/mosques" as never)}
        >
          <View style={[styles.iconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
            <Ionicons name="location-outline" size={20} color="#2B8CEE" />
          </View>
          <View style={styles.cardTextWrap}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("menu.mosques_title")}</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t("menu.mosques_subtitle")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
        </Pressable>

        <Pressable
          style={[styles.menuCard, styles.menuCardSpaced, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onPress={() => router.push("/mosques?filter=favorites" as never)}
        >
          <View style={[styles.iconWrap, isLight ? { backgroundColor: "#EAF2FC" } : null]}>
            <Ionicons name="star-outline" size={20} color="#2B8CEE" />
          </View>
          <View style={styles.cardTextWrap}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{t("menu.favorites_title")}</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t("menu.favorites_subtitle")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={isLight ? "#617990" : "#8EA4BF"} />
        </Pressable>
      </View>
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
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 14,
    fontSize: 14,
    color: "#8EA4BF"
  },
  menuCard: {
    minHeight: 86,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  menuCardSpaced: {
    marginTop: 10
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#1C3550",
    alignItems: "center",
    justifyContent: "center"
  },
  cardTextWrap: {
    flex: 1
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ECF3FF"
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#8FA2BC"
  }
});
