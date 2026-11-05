import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppTheme } from "@/theme/ThemeProvider";

export type RamadanDuaKind = "intention" | "iftar";

export function RamadanDuaModal(props: {
  kind: RamadanDuaKind | null;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const [fontsLoaded] = useFonts({
    QuranArabic: require("../../../assets/fonts/NotoNaskhArabic-Regular.ttf")
  });
  const isIftar = props.kind === "iftar";

  return (
    <Modal visible={Boolean(props.kind)} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.root}>
          <AppBackground />
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ramadan.close")}
              style={[styles.closeButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={props.onClose}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
              {isIftar ? t("ramadan.iftar_dua_title") : t("ramadan.intention_title")}
            </Text>
            <View style={styles.spacer} />
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              {isIftar && fontsLoaded ? (
                <Text style={[styles.arabic, { color: colors.textPrimary }]}>
                  اللّٰهُمَّ لَكَ صُمْتُ وَعَلَيْكَ تَوَكَّلْتُ وَعَلَى رِزْقِكَ أَفْطَرْتُ، تَقَبَّلْهُ مِنِّي إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ، ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللّٰهُ
                </Text>
              ) : null}
              {isIftar ? (
                <>
                  <Text style={[styles.transliteration, { color: colors.accent }]}>
                    {t("ramadan.iftar_dua_transliteration")}
                  </Text>
                  <Text style={[styles.body, { color: colors.textSecondary }]}>
                    {t("ramadan.iftar_dua_meaning")}
                  </Text>
                  <Text style={[styles.source, { color: colors.textSecondary }]}>
                    {t("ramadan.iftar_dua_source")}
                  </Text>
                </>
              ) : (
                <Text style={[styles.body, { color: colors.textSecondary }]}>
                  {t("ramadan.intention_body")}
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 14 },
  closeButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 23, fontWeight: "900" },
  spacer: { width: 44 },
  content: { paddingBottom: 32 },
  card: { borderRadius: 22, borderWidth: 1, padding: 20 },
  arabic: { fontFamily: "QuranArabic", fontSize: 31, lineHeight: 52, textAlign: "right", writingDirection: "rtl" },
  transliteration: { marginTop: 18, fontSize: 17, lineHeight: 27, fontStyle: "italic" },
  body: { fontSize: 17, lineHeight: 28 },
  source: { marginTop: 16, fontSize: 13, lineHeight: 20, fontWeight: "700" }
});
